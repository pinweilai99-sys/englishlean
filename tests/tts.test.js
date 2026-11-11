// TTS 选音测试：修复"第一个 en-US 可能是特效音导致单词读音怪异"的问题
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseVoice } from '../js/services/tts.js';

test('TTS-1 旧口径对照：列表第一个 en-US 是特效音时，必须跳过选自然音', () => {
  const voices = [
    { lang: 'en-US', name: 'Albert' },   // macOS 特效音（旧逻辑会选它 → 读音怪异）
    { lang: 'en-US', name: 'Samantha' }, // 自然的英语语音
    { lang: 'zh-CN', name: 'Ting-Ting' },
  ];
  const v = chooseVoice(voices);
  assert.equal(v.name, 'Samantha', '应跳过特效音 Albert，选中 Samantha');
});

test('TTS-2 特效音黑名单覆盖 macOS 常见 novelty voices', () => {
  const novelty = ['Albert', 'Zarvox', 'Bells', 'Trinoids', 'Whisper', 'Bad News', 'Bahh', 'Jester', 'Fred'];
  for (const name of novelty) {
    const voices = [
      { lang: 'en-US', name },
      { lang: 'en-GB', name: 'Daniel' },
    ];
    assert.equal(chooseVoice(voices).name, 'Daniel', `${name} 应被视为特效音跳过`);
  }
});

test('TTS-3 优先命中自然音清单（Google/Microsoft/Samantha 等）且英音自然音优先于美音自然音', () => {
  const voices = [
    { lang: 'en-US', name: 'Alex' },
    { lang: 'en-US', name: 'Microsoft Aria Online (Natural) - English (United States)' },
    { lang: 'en-GB', name: 'Sonia' },
  ];
  const v = chooseVoice(voices);
  assert.match(v.name, /Sonia/, '英音自然音 Sonia 应优先（课本音标为英式）');
  // 只有美音时仍能选中自然清单里的 Aria（而非普通 Alex）
  const usOnly = [
    { lang: 'en-US', name: 'Alex' },
    { lang: 'en-US', name: 'Microsoft Aria Online (Natural) - English (United States)' },
  ];
  assert.match(chooseVoice(usOnly).name, /Aria/, '无英音时应在美音里选自然音 Aria');
});

test('TTS-6 课本音标标准（2026-11-03 定版：与课本英式音标一致）：美音在列时仍必须优先选英音', () => {
  // 旧美音口径会选 Alex；新口径锁死英音优先（课本音标为英式 /həʊld/ /ʃɒp/ 等）
  const voices = [
    { lang: 'en-GB', name: 'Daniel' },   // 英音自然音
    { lang: 'en-US', name: 'Alex' },     // 普通美音
  ];
  const v = chooseVoice(voices);
  assert.equal(v.lang, 'en-GB', '有英音可用时不得选美音（课本音标为英式）');
  // 只有美音自然音 + 特效音英音时：特效英音被过滤 → 无英音 → 才退美音
  const voices2 = [
    { lang: 'en-GB', name: 'Bells' },    // 英音特效音
    { lang: 'en-US', name: 'Alex' },
  ];
  const v2 = chooseVoice(voices2);
  assert.equal(v2.lang, 'en-US', '英音只剩特效音时才允许退到美音自然音');
});

test('TTS-4 全是特效音也不返回 null（降级到第一个英语音，不能没声音）', () => {
  const voices = [
    { lang: 'en-US', name: 'Zarvox' },
    { lang: 'en-US', name: 'Bells' },
  ];
  const v = chooseVoice(voices);
  assert.ok(v, '应返回一个语音兜底');
  assert.match(v.lang, /^en/, '且是英语语音');
});

test('TTS-5 边界：无英语语音 / 空列表 → null', () => {
  assert.equal(chooseVoice([{ lang: 'zh-CN', name: 'Ting-Ting' }]), null);
  assert.equal(chooseVoice([]), null);
  assert.equal(chooseVoice(null), null);
});

// ── 2026-11-11 家长反馈：安卓平板提示「找不到 Google 引擎」且无声 ──
// 根因链：安卓平板未安装 Google TTS 引擎 → 浏览器 speechSynthesis 报
// 「找不到语音引擎」系统弹窗且永远不出声。而本项目的预生成音频本可正常播放，
// 但只要 manifest 未就绪 / 音频加载失败，就会掉进 speechSynthesis 兜底 → 弹窗。
// 修复方向：
//  ① 无可用英语语音时，绝不调用 speechSynthesis（不触发系统弹窗）；
//  ② 预生成音频是唯一可靠通道，必须优先且失败可诊断；
//  ③ 给用户应用内的中文提示，而不是系统弹窗。
import { speak, hasUsableVoice } from '../js/services/tts.js';

function stubWindow({ voices, speakSpy }) {
  globalThis.window = {
    speechSynthesis: {
      getVoices: () => voices,
      speak(u) { speakSpy.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
      cancel() {},
    },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
  };
}

test('TTS-7 安卓无语音引擎（getVoices 为空）时不得调用 speechSynthesis（否则弹系统窗）', async () => {
  const spy = [];
  stubWindow({ voices: [], speakSpy: spy });
  assert.equal(hasUsableVoice(), false, '无英语语音时应判定为不可用');
  const r = await speak('Hello.');
  assert.equal(r.ok, false, '无语音引擎时不应假装成功');
  assert.equal(r.reason, 'no-voice', '应给出可诊断的原因 no-voice');
  assert.deepEqual(spy, [], '绝不能调用 speechSynthesis（会触发安卓「找不到 Google 引擎」弹窗）');
  delete globalThis.window;
});

test('TTS-8 只有非英语语音时同样不得调用 speechSynthesis', async () => {
  const spy = [];
  stubWindow({ voices: [{ lang: 'zh-CN', name: 'Ting-Ting' }], speakSpy: spy });
  assert.equal(hasUsableVoice(), false, '只有中文语音 → 无可用英语语音');
  const r = await speak('Hello.');
  assert.equal(r.reason, 'no-voice');
  assert.deepEqual(spy, [], '不得用中文语音念英语（也避免系统弹窗）');
  delete globalThis.window;
});

test('TTS-9 有英语语音时仍正常朗读（不破坏桌面端）', async () => {
  const spy = [];
  stubWindow({ voices: [{ lang: 'en-GB', name: 'Daniel' }], speakSpy: spy });
  assert.equal(hasUsableVoice(), true, '有英语语音应判定为可用');
  const r = await speak('Hello.');
  assert.equal(r.ok, true);
  assert.deepEqual(spy, ['Hello.'], '桌面端行为不变');
  delete globalThis.window;
});

test('TTS-10 完全没有 speechSynthesis 时应返回不可用且不抛错', async () => {
  delete globalThis.window;
  const r = await speak('Hello.');
  assert.equal(r.ok, false);
  assert.ok(['unavailable', 'no-voice'].includes(r.reason), `原因应可诊断，实际 ${r.reason}`);
});
