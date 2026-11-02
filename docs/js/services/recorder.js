// 录音服务：MediaRecorder 封装 + 本地音量/时长检测（不依赖任何云端服务）
// 无麦克风权限 / 不支持时优雅降级（isSupported() 返回 false，UI 走"手动点亮"路径）
// 能力检测在调用时进行，构造器通过 window 限定，确保环境变化即时生效。

const state = {
  recorder: null,
  chunks: [],
  stream: null,
  audioCtx: null,
  rafId: null,
  maxRms: 0,
  startTime: 0,
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

// 本地音量监测：持续采样 RMS，记录峰值（识别失败时也能确认"收到声音"）
function startLevelMeter(stream) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !analyserSupported()) return;
    state.audioCtx = new AC();
    const source = state.audioCtx.createMediaStreamSource(stream);
    const analyser = state.audioCtx.createAnalyser();
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    state.maxRms = 0;
    state.startTime = Date.now();
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms > state.maxRms) state.maxRms = rms;
      state.rafId = window.requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    // 音量监测不可用不影响录音本身
  }
}

function analyserSupported() {
  return typeof window !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
    && typeof Float32Array === 'function';
}

function stopLevelMeter() {
  if (state.rafId) {
    window.cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  if (state.audioCtx) {
    try { state.audioCtx.close(); } catch (e) { /* 忽略 */ }
    state.audioCtx = null;
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
    startLevelMeter(stream);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'permission' };
  }
}

// 停止录音，返回 { blob, durationMs, maxRms }（blob 可能为 null；maxRms=null 表示音量监测不可用）
export function stop() {
  return new Promise((resolve) => {
    if (!state.recorder) { resolve(null); return; }
    const rec = state.recorder;
    const durationMs = state.startTime ? Date.now() - state.startTime : 0;
    const maxRms = state.maxRms;
    const hadMeter = state.rafId !== null || state.maxRms > 0;
    rec.onstop = () => {
      const blob = state.chunks.length ? new window.Blob(state.chunks, { type: 'audio/webm' }) : null;
      if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
      state.recorder = null; state.stream = null; state.chunks = [];
      stopLevelMeter();
      resolve({ blob, durationMs, maxRms: hadMeter ? maxRms : null });
    };
    try { rec.stop(); } catch (e) { resolve(null); }
  });
}

export function isRecording() {
  return !!state.recorder && state.recorder.state === 'recording';
}
