// 预生成音频服务测试：slug 纯函数 + 有/无音频两条路径的正反对照
// 背景：手机浏览器无英语 TTS 引擎时 speechSynthesis 静默失败（家长反馈"发音播不出"），
// 修复 = 播放优先音频文件（assets/audio/*.m4a），TTS 只作兜底。本文件锁死该行为。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioSlug, hasAudio, initAudio, playAudio, _debugSetAvailable } from '../js/services/audio.js';
import * as tts from '../js/services/tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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
