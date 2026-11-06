// TTS 发音服务：优先播预生成音频文件（手机无 TTS 引擎也能出声），speechSynthesis 兜底
// 降级原则：没有音频能力时隐藏喇叭、改为"手动确认"，绝不让页面报错或阻塞学习。
// 能力检测在调用时进行（而非导入时），确保环境变化（含测试注入）即时生效。
import { hasAudio, playAudio, stopAudio } from './audio.js';

const state = {
  enabled: true,
  current: null,
};

function synth() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

function pickVoice(s) {
  const voices = (typeof s.getVoices === 'function' ? s.getVoices() : []) || [];
  return chooseVoice(voices);
}

// 搞笑/特效音黑名单：macOS/iOS 自带大量 novelty voices（Albert、Zarvox、Bells 等），
// 它们的 lang 也是 en-US，旧逻辑"取第一个 en-US"会抓到它们，把单词读成怪声。
const NOVELTY_RE = new RegExp(
  'albert|bad day|bad news|bahh|bells|bloat|boing|bubbles|cellos|deranged'
  + '|good news|hysterical|jester|junior|kathy|organ|rocko|sandy|shelley'
  + '|eddy|flo|grandma|grandpa|reed|ralph|trinoids|whisper|wobble|superstar|zarvox|fred',
  'i',
);
// 已知发音自然、适合跟读的语音（命中者优先）
const NATURAL_RE = new RegExp(
  'google (us|uk) english|microsoft (aria|jenny|guy|emma|ava|andrew|brian|sonia|liz)'
  + '|samantha|^ava$|allison|victoria|susan|zoe|daniel|karen|moira|tessa|serena|fiona|nicky',
  'i',
);

// 选音（纯函数，可测试）：本项目发音标准 = 课本音标（2026-11-03 家长定版：以课本词表英式
// 音标为准，如 /həʊld/ /ʃɒp/ /ˈklevə(r)/），故 TTS 优先英音 en-GB 朗读，与音标口径一致。
// 英语语音里先剔除特效音，再严格优先 en-GB（自然音 > 普通音），en-US 仅作无英音时的最后兜底。
// 口径：自然 en-GB → 普通 en-GB → 自然 en-US → en-US → 第一个普通英语音；全是特效音也绝不返回 null。
export function chooseVoice(voices) {
  const list = (voices || []).filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
  if (!list.length) return null;
  const normal = list.filter((v) => !NOVELTY_RE.test(v.name || ''));
  const pool = normal.length ? normal : list;
  return (
    pool.find((v) => NATURAL_RE.test(v.name || '') && /en-GB/i.test(v.lang || ''))
    || pool.find((v) => /en-GB/i.test(v.lang || ''))
    || pool.find((v) => NATURAL_RE.test(v.name || '') && /en-US/i.test(v.lang || ''))
    || pool.find((v) => /en-US/i.test(v.lang || ''))
    || pool[0]
  );
}

export function isAvailable() {
  return !!synth();
}

export function isEnabled() {
  return state.enabled;
}

export function setEnabled(flag) {
  state.enabled = !!flag;
  if (!state.enabled) cancel();
}

export function cancel() {
  stopAudio();
  const s = synth();
  if (!s) return;
  try { s.cancel(); } catch (e) { /* 忽略 */ }
  state.current = null;
}

// 朗读文本（入口）：优先播预生成音频文件（手机无 TTS 引擎也能出声），失败退回 speechSynthesis。
// 返回 Promise，播放结束或失败时 resolve。
export async function speak(text, opts = {}) {
  if (!state.enabled || !text) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  if (hasAudio(text)) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await playAudio(text, undefined, { playbackRate: opts.playbackRate });
    if (ok) return { ok: true, via: 'audio' };
  }
  return speakSynth(text, opts);
}

// 慢速朗读整词（拼读示范用）：预生成音频放慢，没有音频时退到慢速 TTS。
// 为什么需要慢速：预生成音频是整词正常语速的录音，
// 孩子只听到一个"整体音"，听不出里面由哪几块拼成；放慢后音素边界更清楚。
export async function speakSlow(text, opts = {}) {
  if (!state.enabled || !text) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const rate = opts.rate || 0.6;
  if (hasAudio(text)) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await playAudio(text, undefined, { playbackRate: rate });
    if (ok) return { ok: true, via: 'audio' };
  }
  return speakSynth(text, { ...opts, rate });
}

// speechSynthesis 兜底通道（原实现）
function speakSynth(text, opts = {}) {
  const { rate = 0.85, pitch = 1.0, lang = 'en-US' } = opts;
  const s = synth();
  if (!s || !state.enabled || !text) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  cancel();
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      state.current = null;
      resolve({ ok });
    };
    try {
      const utter = new window.SpeechSynthesisUtterance(String(text));
      utter.rate = rate;
      utter.pitch = pitch;
      utter.lang = lang;
      const v = pickVoice(s);
      if (v) utter.voice = v;
      utter.onend = () => finish(true);
      utter.onerror = () => finish(false);
      state.current = utter;
      s.speak(utter);
      // 兜底：某些浏览器不触发 onend
      const maxMs = Math.min(12000, 1200 + String(text).length * 120);
      setTimeout(() => finish(true), maxMs);
    } catch (e) {
      finish(false);
    }
  });
}

// 朗读队列：依次读多句（不叠加）
export async function speakSequence(items, opts = {}) {
  for (const it of items) {
    // eslint-disable-next-line no-await-in-loop
    await speak(it, opts);
  }
}

// 拼读示范（拆音 → 合音）：按音块逐段朗读，每段开始时回调 onSegment(段索引)，
// 让 UI 能同步高亮正在发声的音块（孩子看着"哪一块在响"，而不是干听）。
// 设计取舍（2026-11-06 家长提问后定版）：
//  - 只拆"音节级"音块（chunks 已是音节切分，如 rab·bit），**不拆单字母**。
//    单字母交给 TTS 会被念成字母名（em / ay），把孩子教成"念字母名"而不是"读音"，反而错。
//  - 顺序 = 整词先听一遍（建立目标音）→ 拆开逐块听 → 合回整词，
//    这是自然拼读教学的标准三步（听整词 → 拆音 → 合音）。
export async function speakBlend(parts, { onSegment, gapMs = 420 } = {}) {
  const list = Array.isArray(parts) ? parts : [];
  for (let i = 0; i < list.length; i++) {
    const text = list[i];
    if (typeof onSegment === 'function') onSegment(i, text);
    // eslint-disable-next-line no-await-in-loop
    await speak(text);
    // 段间留白，孩子听得清"这是两块"
    // eslint-disable-next-line no-await-in-loop
    if (i < list.length - 1 && gapMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}
