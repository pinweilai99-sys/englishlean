// 预生成音频服务（assets/audio/*.m4a + manifest.json）
// 背景：手机浏览器（尤其国产安卓 / 微信内置浏览器）普遍没有英语 TTS 引擎，
// speechSynthesis 会"静默失败"——页面不报错但没有任何声音（2026-11-03 家长反馈）。
// 解决：用桌面端系统 TTS（英音 Daniel，与课本英式音标口径一致）把全部发音文本
// 预生成为音频文件，随站点同源部署；播放时优先播音频文件，speechSynthesis 只作兜底。
// manifest.json 由 scripts/gen-audio.mjs 生成；未命中的文本自动退回 TTS。

const AUDIO_BASE = 'assets/audio/';
let available = null; // Set<string> | null（null = 尚未初始化）
let currentEl = null;

// 文本 → 音频文件名（纯函数，生成脚本与运行时共用同一实现，保证命名一致）。
// 例："May I have a rabbit?" → may-i-have-a-rabbit；"It's lovely." → its-lovely
// 超长文本（如整段故事）：截断 + 8 位哈希后缀，既不超文件名限制又保证不重名。
// ⚠️ 哈希用纯 JS 的 FNV-1a（浏览器/Node 通用）。绝不能 import 'node:crypto'——
//    浏览器没有该模块，会让整个 app 模块图加载失败 → 白屏（2026-11-03 线上事故）。
function fnv1aHex(s) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function audioSlug(text) {
  let s = String(text)
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) return 'x';
  if (s.length > 60) {
    s = `${s.slice(0, 60).replace(/-+$/, '')}-${fnv1aHex(s)}`;
  }
  return s;
}

// 启动时拉取清单（失败不报错——本地 file:// 或测试环境拉不到就全部走 TTS 兜底）
export async function initAudio(base = AUDIO_BASE) {
  try {
    const res = await fetch(`${base}manifest.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`manifest http ${res.status}`);
    const data = await res.json();
    available = new Set(data.slugs || []);
  } catch (e) {
    available = new Set();
  }
  return available;
}

export function hasAudio(text) {
  return !!available && available.has(audioSlug(text));
}

// 播放预生成音频；resolve(true)=已播��，false=失败（调用方应退回 TTS）。
// 测试/Node 环境（无 Audio 构造器）直接 resolve(false)，保证行为可预测。
// opts.playbackRate：慢速拼读用（0.62 左右）。预生成音频是整词录音，
// 放慢后音素边界更清楚，孩子能听出"这个词是由几块拼出来的"。
export function playAudio(text, base = AUDIO_BASE, opts = {}) {
  return new Promise((resolve) => {
    try {
      if (typeof Audio === 'undefined') return resolve(false);
      stopAudio();
      const el = new Audio(`${base}${audioSlug(text)}.m4a`);
      if (opts.playbackRate && opts.playbackRate > 0) {
        try { el.playbackRate = opts.playbackRate; } catch (e) { /* 忽略 */ }
      }
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (currentEl === el) currentEl = null;
        resolve(ok);
      };
      currentEl = el;
      el.onended = () => finish(true);
      el.onerror = () => finish(false);
      const pr = typeof el.play === 'function' ? el.play() : null;
      if (pr && typeof pr.catch === 'function') pr.catch(() => finish(false));
      // 兜底：个别内核不触发 onended；超时按成功处理（避免等待卡死）
      setTimeout(() => finish(true), 20000);
    } catch (e) {
      resolve(false);
    }
  });
}

// 停掉正在播的音频（切题/点新按钮时调用，避免叠音）
export function stopAudio() {
  if (currentEl) {
    try {
      currentEl.onended = null;
      currentEl.onerror = null;
      currentEl.pause();
    } catch (e) { /* 忽略 */ }
    currentEl = null;
  }
}

// 仅供测试：直接注入可用清单（绕过 fetch）
export function _debugSetAvailable(slugs) {
  available = new Set(slugs || []);
}
