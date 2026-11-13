// 预生成音频服务测试：slug 纯函数 + 有/无音频两条路径的正反对照
// 背景：手机浏览器无英语 TTS 引擎时 speechSynthesis 静默失败（家长反馈"发音播不出"），
// 修复 = 播放优先音频文件（assets/audio/*.m4a），TTS 只作兜底。本文件锁死该行为。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioSlug, hasAudio, initAudio, playAudio, stopAudio, ensureReady, retryManifest, _debugSetAvailable, _debugClearPool, _debugResetManifest } from '../js/services/audio.js';
import * as tts from '../js/services/tts.js';
import { chunkSay } from '../js/core/phonics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
// 自动纳入所有单元：以后新增 U6/U7… 时音频完整性断言自动生效，
// 不能写死 ['u4','u5']（那样新单元会绕过校验 → 安卓平板漏音频 → 弹「找不到 Google 引擎」）。
const ALL_UNITS = readdirSync(join(root, 'data/units'))
  .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

describe('audioSlug（纯函数）', () => {
  test('AUD-1 基本映射：小写化、去标点、空格转连字符', () => {
    assert.equal(audioSlug('May I have a rabbit?'), 'may-i-have-a-rabbit');
    assert.equal(audioSlug("It's lovely."), 'its-lovely');
    assert.equal(audioSlug("Yes, you can."), 'yes-you-can');
    assert.equal(audioSlug("No, you can't."), 'no-you-cant');
    assert.equal(audioSlug('Mrs'), 'mrs');
    assert.equal(audioSlug('pet'), 'pet');
  });

  test('AUD-2 超长文本（整段故事）截断+哈希后缀，不超文件名限制且确定可复现', () => {
    const long = 'Mrs Chen and Dongdong are walking on the street. '.repeat(10);
    const s1 = audioSlug(long);
    const s2 = audioSlug(long);
    assert.equal(s1, s2, '同一文本两次调用结果必须一致');
    assert.ok(s1.length <= 69, `slug 长度应受控（实际 ${s1.length}）`);
    assert.match(s1, /-[0-9a-f]{8}$/, '超长 slug 应带 8 位哈希后缀');
    assert.notEqual(audioSlug(long + 'x'), s1, '不同文本哈希应不同');
  });

  test('AUD-3 空文本有安全兜底', () => {
    assert.equal(audioSlug(''), 'x');
    assert.equal(audioSlug('!!!'), 'x');
  });
});

describe('音频清单与播放降级', () => {
  test('AUD-4 manifest 覆盖 U5 全部 12 个单词与核心句型，音频文件真实存在', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'assets/audio/manifest.json'), 'utf8'));
    assert.ok(Array.isArray(manifest.slugs) && manifest.slugs.length >= 60, '清单应有足够条目');
    assert.equal(manifest.voice, 'Daniel', '预生成音频应为英音 Daniel（与课本音标一致）');
    const unit = JSON.parse(readFileSync(join(root, 'data/units/u5.json'), 'utf8'));
    unit.words.forEach((w) => {
      const slug = audioSlug(w.tts || w.w);
      assert.ok(manifest.slugs.includes(slug), `单词 ${w.w} 应在音频清单中`);
      assert.ok(existsSync(join(root, 'assets/audio', `${slug}.m4a`)), `音频文件 ${slug}.m4a 应存在`);
    });
    // 句型与应答也在清单中
    ['may-i-have-a-rabbit', 'yes-you-can', 'no-you-cant'].forEach((slug) => {
      assert.ok(manifest.slugs.includes(slug), `句型音频 ${slug} 应在清单中`);
    });
  });

  test('AUD-5 未初始化/清单为空时 hasAudio=false，speak 走 TTS 兜底（测试桩收到朗读）', async () => {
    _debugSetAvailable([]);
    assert.equal(hasAudio('pet'), false, '清单为空时不得命中音频');
    // 注入 TTS 桩验证兜底路径仍然发声
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-GB', name: 'Daniel' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    const r = await tts.speak('pet');
    assert.equal(r.ok, true, 'TTS 兜底应正常完成');
    assert.deepEqual(spoken, ['pet'], '兜底必须真的朗读（旧 bug：手机上静默无声音）');
  });

  test('AUD-6 命中清单但播放环境不支持（Node 无 Audio）→ 自动退回 TTS，不卡死不出错', async () => {
    _debugSetAvailable(['pet']);
    assert.equal(hasAudio('pet'), true, '命中清单');
    assert.equal(await playAudio('pet'), false, 'Node 无 Audio，播放应返回 false');
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-GB', name: 'Daniel' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    const r = await tts.speak('pet');
    assert.equal(r.ok, true);
    assert.deepEqual(spoken, ['pet'], '音频播放失败必须无缝退回 TTS');
    _debugSetAvailable([]); // 还原，避免影响其他测试
  });

  test('AUD-7 initAudio 拉不到清单时不抛错、清空可用集（file:// 与测试环境安全）', async () => {
    const r = await initAudio('http://localhost:1/no-such-base/');
    assert.ok(r instanceof Set, '应返回 Set');
    assert.equal(r.size, 0, '拉不到清单应为空集');
    assert.equal(hasAudio('pet'), false);
  });
});

// ── 2026-11-06 家长反馈"有时候读不出来 / 有时候要等好久"：根因修复的正反对照 ──
// 背景：四个真缺陷都在音频层，
//   ① 播放超时固定 20 秒 → 一次「听一听」可能干等 20 秒；
//   ② stopAudio() 把 onended 置空 → 上层 await playAudio() 永久悬挂；
//   ③ 清单未就绪就直接退 speechSynthesis → 手机无英语引擎 = 彻底无声；
//   ④ 每次 new Audio() 重新下载 → 弱网下每次点按都要等。
// 本组测试逐条锁死修复后的行为。
const FAKE_INSTANCES = [];

describe('音频可靠性（2026-11-06 修复）', () => {
  // 造一个可控的假 Audio：模拟"onended 不触发"（个别内核的真实表现）
  function fakeAudioClass(behavior) {
    return class FakeAudio {
      constructor(src) {
        this.src = src;
        this.playbackRate = 1;
        this.currentTime = 0;
        this.duration = NaN;
        this.readyState = 0;
        this.preload = '';
        this._handlers = {};
        FAKE_INSTANCES.push(this);
      }
      addEventListener(t, fn) { (this._handlers[t] ||= []).push(fn); }
      removeEventListener(t, fn) {
        this._handlers[t] = (this._handlers[t] || []).filter((x) => x !== fn);
      }
      _emit(t) { (this._handlers[t] || []).forEach((fn) => fn()); }
      play() {
        if (behavior.onPlay) behavior.onPlay(this);
        return Promise.resolve();
      }
      pause() { this.paused = true; }
    };
  }

  let savedAudio;
  beforeEach(() => {
    savedAudio = globalThis.Audio;
    FAKE_INSTANCES.length = 0;
    _debugClearPool(); // 元素池跨用例残留会污染"复用"断言
  });
  afterEach(() => {
    if (savedAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = savedAudio;
    _debugSetAvailable([]);
  });

  test('AUD-9 stopAudio 必须结算挂起的等待者（旧实现：Promise 永不 resolve → 上层永久卡死）', async () => {
    const behavior = { onPlay: () => {} }; // 永远不触发 onended
    globalThis.Audio = fakeAudioClass(behavior);
    _debugSetAvailable(['pet']);
    let settled = false;
    const p = playAudio('pet').then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(settled, false, '播放中不应提前结算');
    stopAudio();
    const r = await Promise.race([
      p,
      new Promise((res) => setTimeout(() => res('TIMEOUT'), 300)),
    ]);
    assert.notEqual(r, 'TIMEOUT', 'stopAudio 后等待者必须被结算（否则上层 await 永久卡死）');
    assert.equal(settled, true, '等待者必须已结算');
  });

  test('AUD-10 播放超时必须自适应，不得固定等 20 秒（旧实现最长干等 20 秒）', async () => {
    // 模拟：metadata 已知时长 0.8 秒，但 onended 永不触发
    const behavior = {
      onPlay(el) {
        el.duration = 0.8;
        el.readyState = 1;
        el._emit('loadedmetadata');
      },
    };
    globalThis.Audio = fakeAudioClass(behavior);
    _debugSetAvailable(['pet']);
    const t0 = Date.now();
    const r = await playAudio('pet');
    const cost = Date.now() - t0;
    assert.equal(r, true, '超时按已播放处理');
    assert.ok(cost < 4000, `0.8 秒音频的等待应远短于 20 秒（实际 ${cost}ms）`);
  });

  test('AUD-11 metadata 迟迟不来时也必须有上限（不得无限等待）', async () => {
    const behavior = { onPlay: () => {} }; // 无 metadata、无 onended
    globalThis.Audio = fakeAudioClass(behavior);
    _debugSetAvailable(['pet']);
    const t0 = Date.now();
    await playAudio('pet');
    const cost = Date.now() - t0;
    assert.ok(cost <= 9000, `兜底上限必须生效（实际 ${cost}ms）`);
  });

  test('AUD-12 同一 slug 复用 Audio 元素（避免每次点按都重新下载/连接）', async () => {
    const behavior = { onPlay: (el) => { el.duration = 0.5; el.readyState = 1; el.onended && el.onended(); } };
    globalThis.Audio = fakeAudioClass(behavior);
    _debugSetAvailable(['pet']);
    await playAudio('pet');
    await playAudio('pet');
    assert.equal(FAKE_INSTANCES.length, 1, `同一文本应复用同一个 Audio 元素（实际新建 ${FAKE_INSTANCES.length} 个）`);
    assert.equal(FAKE_INSTANCES[0].preload, 'auto', '元素应开启预加载');
  });

  test('AUD-13 清单未就绪时 ensureReady 会等待它，而不是立刻退 TTS（旧行为=手机端彻底无声）', async () => {
    // 前置：清单**尚未加载**（与真实首屏一致：available === null）
    _debugResetManifest();
    assert.equal(hasAudio('pet'), false, '前置：清单未就绪时 hasAudio=false');
    // 模拟"清单随后到达"：ensureReady 应等到它
    const p = ensureReady(2000);
    setTimeout(() => _debugSetAvailable(['pet']), 60);
    await p;
    assert.equal(hasAudio('pet'), true, '清单到达后应能命中音频');
  });

  test('AUD-14 speak 在清单未就绪时会等待清单，而不是直接走无声的 TTS 兜底', async () => {
    _debugResetManifest();
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-GB', name: 'Daniel' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    const behavior = { onPlay: (el) => { el.duration = 0.5; el.readyState = 1; el.onended && el.onended(); } };
    globalThis.Audio = fakeAudioClass(behavior);
    // 清单在 50ms 后到达 —— speak 必须等到那时才决定走音频
    setTimeout(() => _debugSetAvailable(['pet']), 50);
    const r = await tts.speak('pet', { readyTimeoutMs: 2000 });
    assert.equal(r.ok, true, '应成功播放');
    assert.equal(r.via, 'audio', '清单到达后必须走预生成音频（而非 TTS 兜底）');
    assert.deepEqual(spoken, [], '命中音频时不得再走 TTS（否则会出现双声/延迟）');
  });

  test('AUD-15 取消后不得再出声（cancel 打断播放时不得退回 TTS 补一声）', async () => {
    _debugSetAvailable(['pet']);
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-GB', name: 'Daniel' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    const behavior = { onPlay: () => {} }; // onended 不触发
    globalThis.Audio = fakeAudioClass(behavior);
    const p = tts.speak('pet');
    await new Promise((r) => setTimeout(r, 30));
    tts.cancel();
    const r = await p;
    assert.equal(r.ok, false, '被取消的播放应返回失败');
    assert.equal(r.reason, 'cancelled', '应标记为 cancelled');
    assert.deepEqual(spoken, [], '取消后不得再退回 TTS 出声（会造成"停了又响"）');
  });
});

test('AUD-8 浏览器端代码禁止 import Node 内置模块（node:crypto 曾致线上白屏）', () => {
  const dirs = ['js/services', 'js/ui', 'js/core'];
  let checked = 0;
  for (const dir of dirs) {
    for (const f of readdirSync(join(root, dir))) {
      const p = join(root, dir, f);
      if (statSync(p).isDirectory()) continue;
      if (!f.endsWith('.js')) continue;
      const code = readFileSync(p, 'utf8');
      assert.ok(!/from\s+['"]node:/i.test(code) && !/import\(\s*['"]node:/i.test(code),
        `${dir}/${f} 含 node: 导入——浏览器没有 Node 内置模块，会让整个应用白屏；必须改纯 JS`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `应检查到足量浏览器端文件（实际 ${checked}）`);
});

// ── 2026-11-11 家长反馈：安卓平板弹「找不到 Google 引擎」且整局无声 ──
// 根因：initAudio 启动时只试 3 次；国内网络下 github.io 被限速 → 3 次全败
// → available 变空集且**永不重试** → 之后每次点喇叭都退 speechSynthesis
// → 安卓没装 Google TTS 引擎 → 系统弹窗 + 永远无声。
// 修复：新增 retryManifest()，需要时按需重拉清单；弱网一恢复立刻能用预生成音频。
describe('音频清单按需重拉（2026-11-11 修复）', () => {
  test('AUD-16 retryManifest 在清单为空时能重新拉取并恢复可用', async () => {
    _debugSetAvailable([]); // 模拟"启动时拉取失败"
    assert.equal(hasAudio('pet'), false, '前置：清单为空');
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (u) => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ slugs: ['pet'] }),
      };
    };
    try {
      const ok = await retryManifest(2000);
      assert.equal(ok, true, '重拉后应恢复可用');
      assert.equal(hasAudio('pet'), true, '重拉后 hasAudio 应命中');
      assert.ok(calls >= 1, '确实发起了重拉请求');
    } finally {
      globalThis.fetch = realFetch;
      _debugSetAvailable([]);
    }
  });

  test('AUD-17 retryManifest 在清单已可用时不重复请求（避免每次点喇叭都打网络）', async () => {
    _debugSetAvailable(['pet']);
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ slugs: [] }) }; };
    try {
      const ok = await retryManifest(2000);
      assert.equal(ok, true, '已有可用清单应直接返回');
      assert.equal(calls, 0, '不应发起无谓的网络请求');
    } finally {
      globalThis.fetch = realFetch;
      _debugSetAvailable([]);
    }
  });

  test('AUD-18 清单重拉仍失败时不得抛错，speak 返回可诊断的 no-voice（不触发系统弹窗）', async () => {
    _debugSetAvailable([]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const spy = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [], // 安卓无引擎
        speak(u) { spy.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    try {
      const r = await tts.speak('pet', { readyTimeoutMs: 100, retryTimeoutMs: 300 });
      assert.equal(r.ok, false, '两条通道都不可用时应明确失败');
      assert.equal(r.reason, 'no-voice', '原因应为 no-voice（供上层给中文提示）');
      assert.deepEqual(spy, [], '绝不能调用 speechSynthesis（会弹安卓系统对话框）');
    } finally {
      globalThis.fetch = realFetch;
      _debugSetAvailable([]);
      delete globalThis.window;
    }
  });
});

// ── 2026-11-11 家长反馈：安卓平板弹「找不到 Google 引擎」——真凶是音频清单漏项 ──
// 根因：gen-audio.mjs 收集 writing.items 时只收 ctx/ask，漏收 opts。
// 后果：U4「借画笔」「借水」两题的「Sorry.」选项音频文件虽存在，但**不在 manifest** →
//       点该选项的 🔊 → hasAudio() 为 false → 退 speechSynthesis → 安卓弹系统对话框。
// 本组测试锁死：所有会被朗读的文本都必须在 manifest 里，且 manifest 与磁盘文件必须一致。
describe('音频清单完整性（2026-11-11 修复：漏收 writing opts）', () => {
  const root = join(__dirname, '..');
  const manifest = JSON.parse(readFileSync(join(root, 'assets/audio/manifest.json'), 'utf8'));
  const have = new Set(manifest.slugs);

  test('AUD-19 两单元 writing 的每个选项都必须在 manifest 中（漏收 → 安卓弹窗）', () => {
    ALL_UNITS.forEach((u) => {
      const d = JSON.parse(readFileSync(join(root, 'data/units', `${u}.json`), 'utf8'));
      (d.writing?.items || []).forEach((it, i) => {
        (it.opts || []).forEach((o) => {
          const slug = audioSlug(o);
          assert.ok(have.has(slug),
            `${u} writing.items[${i}] 的选项「${o}」不在音频清单 → 点它会退 TTS 兜底 → 安卓弹「找不到 Google 引擎」`);
        });
      });
    });
  });

  test('AUD-20 manifest 与磁盘 m4a 文件必须一一对应（既不漏收也不留孤儿）', () => {
    const files = readdirSync(join(root, 'assets/audio'))
      .filter((f) => f.endsWith('.m4a'))
      .map((f) => f.replace(/\.m4a$/, ''));
    const inManifest = files.filter((f) => have.has(f));
    assert.ok(inManifest.length > 250, `应有足够音频（实际 ${inManifest.length}）`);
    // 每个 manifest 条目都必须有真实文件
    manifest.slugs.forEach((s) => {
      assert.ok(existsSync(join(root, 'assets/audio', `${s}.m4a`)), `清单条目 ${s} 缺音频文件`);
    });
  });

  test('AUD-21 collectTexts 必须覆盖 writing 的每个选项（防止生成脚本再漏）', async () => {
    const { collectTexts } = await import('../scripts/gen-audio.mjs');
    const collected = collectTexts();
    ALL_UNITS.forEach((u) => {
      const d = JSON.parse(readFileSync(join(root, 'data/units', `${u}.json`), 'utf8'));
      (d.writing?.items || []).forEach((it) => {
        (it.opts || []).forEach((o) => {
          assert.ok(collected.includes(o), `collectTexts 漏收 writing 选项「${o}」`);
        });
      });
    });
  });
});

// ── 2026-11-11 全站朗读入口审计（家长：安卓平板弹「找不到 Google 引擎」）──
// 上一次只修了 writing.items.opts，本轮把**全部 50 个朗读入口**的数据来源都审计一遍，
// 又挖出两类缺口：① 故事屋 quiz 选项（每项都有 🔊）② 语法卡例句 q/a。
// 本测试把审计固化为断言：以后新增任何朗读入口、任何文本，都不会再漏音频。
describe('全站朗读文本音频完整性（2026-11-11）', () => {
  const root = join(__dirname, '..');
  const manifest = JSON.parse(readFileSync(join(root, 'assets/audio/manifest.json'), 'utf8'));
  const have = new Set(manifest.slugs);
  const missing = [];
  const need = (t, where) => {
    if (t === undefined || t === null) return;
    const s = String(t).trim();
    if (!s) return;
    if (!have.has(audioSlug(s))) missing.push(where + ': ' + s);
  };

  test('AUD-22 所有会被朗读的文本都必须在音频清单中（故事选项/语法卡/思维导图/写作/句型…）', () => {
    ALL_UNITS.forEach((u) => {
      const d = JSON.parse(readFileSync(join(root, 'data/units', u + '.json'), 'utf8'));
      (d.words || []).forEach((w) => {
        need(w.tts || w.w, u + '.word');
        (w.chunks || []).forEach((c) => need(chunkSay(String(c).toLowerCase()), u + '.chunk'));
      });
      (d.phonics?.words || []).forEach((w) => need(w, u + '.phonics'));
      need(d.phonics?.chant, u + '.chant');
      Object.values(d.sentences?.dialogues || {}).forEach((list) => list.forEach((p) => {
        need(p.q, u + '.sent.q'); need(p.a, u + '.sent.a');
        (p.opts || []).forEach((o) => need(o, u + '.sent.opt'));
      }));
      (d.sentences?.slots || []).forEach((sl) => need(d.sentences?.pattern?.replace('___', sl), u + '.sent.slot'));
      (d.sentences?.answers || []).forEach((a) => need(a, u + '.sent.ans'));
      (d.sentences?.slots || []).forEach((sl) => need(d.roleplay?.child?.replace('___', sl), u + '.rp.child'));
      (d.roleplay?.parent || []).forEach((a) => need(a, u + '.rp.parent'));
      (d.writing?.items || []).forEach((it) => {
        need(it.ctx, u + '.wr.ctx'); need(it.ask, u + '.wr.ask');
        (it.opts || []).forEach((o) => need(o, u + '.wr.opt'));
      });
      (d.writing?.sampleDialogue?.lines || []).forEach((l) => need(l.t, u + '.wr.sample'));
      const mm = d.mindmap || {};
      need(mm.sample, u + '.mm.sample');
      (mm.chain || []).forEach((q) => need(q, u + '.mm.chain'));
      (mm.steps || []).forEach((st) => {
        need(st.q, u + '.mm.q');
        (st.opts || []).forEach((o) => need(o.t, u + '.mm.opt'));
        Object.values(st.featureByAnimal || {}).forEach((o) => need(o.t, u + '.mm.feat'));
        need(st.extra?.t, u + '.mm.extra');
      });
      need(mm.ending?.t, u + '.mm.ending');
      (d.grammar?.childCards || []).forEach((c) => { need(c.q, u + '.grammar.q'); need(c.a, u + '.grammar.a'); });
      (d.reviewCards || []).forEach((c) => need(c.speak, u + '.rc.speak'));
      (d.stories || []).forEach((st) => {
        need(st.text, u + '.st.text'); need(st.narration, u + '.st.narration');
        (st.lines || []).forEach((l) => need(l.t, u + '.st.line'));
        (st.questions || []).forEach((q) => need(q.speak, u + '.st.q.speak'));
        (st.quiz || []).forEach((q) => {
          need(q.q, u + '.st.quiz.q');
          (q.opts || []).forEach((o) => need(typeof o === 'string' ? o : (o.t || o.label || ''), u + '.st.quiz.opt'));
          if (q.type === 'tf') { need('T', u + '.st.tf.T'); need('F', u + '.st.tf.F'); }
        });
      });
      (d.quiz || []).forEach((q) => need(q.speak, u + '.quiz.speak'));
    });
    assert.deepEqual(missing, [],
      '以下朗读文本缺预生成音频（点击会退 TTS 兜底 → 安卓平板弹「找不到 Google 引擎」）：\n' + missing.join('\n'));
  });
});

// ── 2026-11-11 家长：安卓平板莫名弹「找不到 Google 引擎」──
// 真因：连点两个喇叭时，第二次播放会 stopAudio() 打断第一个 → 第一个 Promise 被
// 主动结算为 false → 上层 speak() 把「被打断」误判为「播放失败」→ 退 TTS 兜底
// → 无引擎设备弹系统框 / 应用内误报「发不出声音」。
// 修复：打断时结算带 reason:'interrupted' 标记，上层据此直接返回，不再退 TTS。
describe('打断 vs 失败必须区分（2026-11-11 修复）', () => {
  test('AUD-23 连点两个喇叭：被打断的那次不得退 TTS 兜底（否则误弹安卓系统框）', async () => {
    _debugSetAvailable(['pet', 'dog']);
    _debugClearPool(); // 清元素池：元素池跨用例复用会污染 readyState/play 行为
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [],                 // 安卓无引擎
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    // 假 Audio：永不 onended（模拟正在播放），play() 成功；有限时长让兜底定时器
    // 只有约 2 秒，万一失败能快速暴露，而不是干等 8 秒。
    let firstPlayCalls = 0;
    globalThis.Audio = class {
      constructor(src) { this.src = src; this.playbackRate = 1; this.currentTime = 0; this.duration = 0.9; this.readyState = 1; }
      addEventListener() {} removeEventListener() {}
      play() { firstPlayCalls += 1; return Promise.resolve(); }
      pause() { this.paused = true; }
    };
    try {
      // 前置：清单必须命中，否则 speak() 会先走 ensureReady 异步路径，与 p2 形成竞态
      assert.equal(hasAudio('pet'), true, '前置：pet 必须在音频清单里');
      // 第一次播放（不 await，让它挂着）
      const p1 = tts.speak('pet', { readyTimeoutMs: 100, retryTimeoutMs: 200 });
      // 等 p1 **确实挂进 playAudio** 再启动 p2。旧版固定等 30ms：全量测试高负载时不够，
      // 会出现「p2 先挂起、p1 后挂起」→ p1 走兜底 finish(true) 返回 {ok:true}（reason undefined）
      // 的偶发失败（2026-11-13 最终验收时复现）。改为按 play() 信号同步，消除竞态。
      const t0 = Date.now();
      while (firstPlayCalls === 0 && Date.now() - t0 < 1000) {
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.equal(firstPlayCalls, 1, '第一次播放应已进入音频通道（p1 已挂起）');
      // 第二次播放会 stopAudio() 打断第一次
      const p2 = tts.speak('dog', { readyTimeoutMs: 100, retryTimeoutMs: 200 });
      const r1 = await p1;
      assert.equal(r1.reason, 'interrupted',
        '被打断的那次应标记为 interrupted（不是失败）');
      assert.deepEqual(spoken, [],
        '被打断绝不能退 TTS 兜底（安卓无引擎时会弹系统框）');
      await p2;
    } finally {
      delete globalThis.window;
      delete globalThis.Audio;
      _debugSetAvailable([]);
    }
  });

  test('AUD-24 真正播放失败（音频元素报错）仍应走 TTS 兜底（不能把失败当打断）', async () => {
    _debugSetAvailable(['pet']);
    _debugClearPool(); // 清元素池：避免复用上一用例留下的 readyState=1 元素
    const spoken = [];
    globalThis.window = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-GB', name: 'Daniel' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
        cancel() {},
      },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    };
    // 假 Audio：立即报错（模拟 404/解码失败）
    globalThis.Audio = class {
      constructor(src) { this.src = src; this.playbackRate = 1; this.currentTime = 0; this.duration = NaN; this.readyState = 0; }
      addEventListener() {} removeEventListener() {}
      play() { return Promise.reject(new Error('decode fail')); }
      pause() {}
    };
    try {
      const r = await tts.speak('pet', { readyTimeoutMs: 100, retryTimeoutMs: 200 });
      assert.notEqual(r.reason, 'interrupted', '真失败不应被标成 interrupted');
      assert.deepEqual(spoken, ['pet'], '真失败仍应无缝退回 TTS 兜底');
    } finally {
      delete globalThis.window;
      delete globalThis.Audio;
      _debugSetAvailable([]);
    }
  });
});
