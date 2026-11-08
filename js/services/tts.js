// TTS 发音服务：优先播预生成音频文件（手机无 TTS 引擎也能出声），speechSynthesis 兜底
// 降级原则：没有音频能力时隐藏喇叭、改为"手动确认"，绝不让页面报错或阻塞学习。
// 能力检测在调用时进行（而非导入时），确保环境变化（含测试注入）即时生效。
import { hasAudio, playAudio, stopAudio, ensureReady } from './audio.js?v=1794121897';

const state = {
  enabled: true,
  current: null,
  gen: 0, // 取消代号：cancel() 时 +1，用于识别"播放途中被取消"，避免取消后又出声
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
  state.gen += 1; // 代号 +1：正在等待的 speak 会检测到并放弃后续动作
  stopCurrent();
}

// 仅打断当前正在播放的声音（不推进取消代号）。
// 与 cancel() 分开的原因：speakSynth 每次开始朗读都要先打断上一个，
// 若复用 cancel() 会推进代号，导致并发的另一条 speak 被误判为"已取消"而不出声。
function stopCurrent() {
  stopAudio();
  const s = synth();
  if (!s) return;
  try { s.cancel(); } catch (e) { /* 忽略 */ }
  state.current = null;
}

// 朗读文本（入口）：优先播预生成音频文件（手机无 TTS 引擎也能出声），失败退回 speechSynthesis。
// 返回 Promise，播放结束或失败时 resolve。
//
// 2026-11-06 修复（家长反馈"有时候读不出来"）：
// 音频清单是异步加载的，用户首屏点「听一听」时清单可能还没到 → hasAudio() 返回 false
// → 直接退 speechSynthesis → 国产安卓/微信内置浏览器没有英语 TTS 引擎 → 彻底无声。
// 现在：**清单尚未就绪时先等它（最多 2.5s）**，再决定走音频还是 TTS。
// 已就绪则零等待，不拖慢任何正常播放。
export async function speak(text, opts = {}) {
  if (!state.enabled || !text) {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const gen = state.gen;
  if (!hasAudio(text)) await ensureReady(opts.readyTimeoutMs ?? 2500);
  if (gen !== state.gen) return { ok: false, reason: 'cancelled' }; // 等待期间被取消
  if (hasAudio(text)) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await playAudio(text, undefined, { playbackRate: opts.playbackRate });
    if (gen !== state.gen) return { ok: false, reason: 'cancelled' };
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
  const gen = state.gen;
  const rate = opts.rate || 0.6;
  if (!hasAudio(text)) await ensureReady(opts.readyTimeoutMs ?? 2500);
  if (gen !== state.gen) return { ok: false, reason: 'cancelled' };
  if (hasAudio(text)) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await playAudio(text, undefined, { playbackRate: rate, onProgress: opts.onProgress });
    if (gen !== state.gen) return { ok: false, reason: 'cancelled' };
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
  stopCurrent();
  return new Promise((resolve) => {
    let done = false;
    let progressTimer = null;
    // 进度模拟（2026-11-06）：降级到 TTS 时 speechSynthesis 没有真实进度回调，
    // 若不模拟，拼读示范的"同步高亮"会卡在第一块不动——而手机无英语 TTS 引擎时
    // 走的恰恰就是这条降级路（家长反馈"读不出来"的那批设备）。
    // 按估算时长推进进度，保证降级路径下高亮照样跟声音走。
    const maxMs = Math.min(8000, 900 + String(text).length * 80);
    if (typeof opts.onProgress === 'function') {
      const step = 120;
      let elapsed = 0;
      progressTimer = setInterval(() => {
        elapsed += step;
        try {
          opts.onProgress(Math.min(elapsed, maxMs) / 1000, maxMs / 1000);
        } catch (e) { /* 忽略 */ }
        if (elapsed >= maxMs) clearInterval(progressTimer);
      }, step);
    }
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (progressTimer) clearInterval(progressTimer);
      // 结束时补一次终态进度：保证"同步高亮"至少被触发过
      // （真实 TTS 朗读约 0.8s，但某些内核/测试桩会立即 onend，
      //   不补这一次，高亮会停在第一块不动）。
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(maxMs / 1000, maxMs / 1000); } catch (e) { /* 忽略 */ }
      }
      state.current = null;
      resolve({ ok });
    };    try {
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
      // 兜底：某些浏览器不触发 onend。
      // 2026-11-06 修复：旧实现最长等 12 秒（家长反馈"要等好久"）。
      // 现在按文本长度估算，短词最多等 ~2.5 秒，长句按比例放宽但设上限。
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
