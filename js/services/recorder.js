// 录音服务：MediaRecorder 封装
// 无麦克风权限 / 不支持时优雅降级（isSupported() 返回 false，UI 走"手动点亮"路径）
// 能力检测在调用时进行，构造器通过 window 限定，确保环境变化即时生效。

const state = {
  recorder: null,
  chunks: [],
  stream: null,
};

export function isSupported() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

export async function ensurePermission() {
  if (!isSupported()) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    return false;
  }
}

// 开始录音；返回 { ok, error }
export async function start() {
  if (!isSupported()) return { ok: false, error: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.stream = stream;
    state.chunks = [];
    const recorder = new window.MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    recorder.start();
    state.recorder = recorder;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'permission' };
  }
}

// 停止录音，返回 Blob（可能为 null）
export function stop() {
  return new Promise((resolve) => {
    if (!state.recorder) { resolve(null); return; }
    const rec = state.recorder;
    rec.onstop = () => {
      const blob = state.chunks.length ? new window.Blob(state.chunks, { type: 'audio/webm' }) : null;
      if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
      state.recorder = null; state.stream = null; state.chunks = [];
      resolve(blob);
    };
    try { rec.stop(); } catch (e) { resolve(null); }
  });
}

export function isRecording() {
  return !!state.recorder && state.recorder.state === 'recording';
}
