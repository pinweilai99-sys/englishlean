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

test('TTS-3 优先命中自然音清单（Google/Microsoft/Samantha 等）', () => {
  const voices = [
    { lang: 'en-US', name: 'Alex' },
    { lang: 'en-US', name: 'Microsoft Aria Online (Natural) - English (United States)' },
    { lang: 'en-GB', name: 'Sonia' },
  ];
  const v = chooseVoice(voices);
  assert.match(v.name, /Aria/, '应优先选自然清单中的 Aria');
});

test('TTS-6 美音标准（本项目定版）：英音自然音在列时，仍必须优先选美音', () => {
  // 旧口径会选英音 Daniel（自然音优先于普通美音）；新口径锁死美音优先
  const voices = [
    { lang: 'en-GB', name: 'Daniel' },   // 英音自然音
    { lang: 'en-US', name: 'Alex' },     // 普通美音
  ];
  const v = chooseVoice(voices);
  assert.equal(v.lang, 'en-US', '有美音可用时不得选英音（教材配套录音为美音）');
  // 只有英音自然音 + 特效音美音时：选普通美音也优先于英音? 特效音被过滤后无美音 → 才退英音
  const voices2 = [
    { lang: 'en-GB', name: 'Daniel' },
    { lang: 'en-US', name: 'Zarvox' },   // 美音特效音
  ];
  const v2 = chooseVoice(voices2);
  assert.equal(v2.lang, 'en-GB', '美音只剩特效音时才允许退到英音自然音');
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
