// TTS 发音服务：SpeechSynthesis 封装 + 不可用时的降级
// 降级原则：没有音频能力时隐藏喇叭、改为"手动确认"，绝不让页面报错或阻塞学习。
// 能力检测在调用时进行（而非导入时），确保环境变化（含测试注入）即时生效。

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
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
  if (!en.length) return null;
  // 优先英美口音，其次任意英语
  return en.find((v) => /en-US/i.test(v.lang)) || en.find((v) => /en-GB/i.test(v.lang)) || en[0];
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
  const s = synth();
  if (!s) return;
  try { s.cancel(); } catch (e) { /* 忽略 */ }
  state.current = null;
}

// 朗读文本；返回 Promise，播放结束或失败时 resolve
export function speak(text, opts = {}) {
  const { rate = 0.85, pitch = 1.05, lang = 'en-US' } = opts;
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
