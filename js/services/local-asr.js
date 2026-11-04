// 本地语音识别（Whisper WASM）：后台渐进加载，就绪后离线转写打分
// 策略（用户确认）：
//  - 桌面端页面打开后空闲时后台慢慢下载模型（首次约 41MB，同源优先，失败回落 hf-mirror）
//  - **移动端/省流量模式不自动下载**（2026-11-03 家长反馈手机打不开：一进页面就吞 41MB，
//    弱网下带宽被占满、页面像卡死）。手机上改为用户点"🎤 我来读"时按需加载。
//  - 不急于首次使用：没就绪就走现有降级链（浏览器识别 / 音量诚实反馈 / 手动点亮）
//  - 就绪后自动启用："我来读"优先本地转写，任何浏览器离线可打分
// 状态机：idle → loading(带进度) → ready | failed（失败静默，可重试）

// 是否应在页面启动时自动后台下载模型（纯函数，可测）。
// 返回 false 的情形：移动端设备 / 开启省流量 / 网络为 2G/3G / 无法判定设备。
// 语义：nav 传 undefined 时用全局 navigator（浏览器正常调用）；传 null 视为无环境。
export function shouldAutoLoad(nav) {
  const n = nav === undefined
    ? (typeof globalThis !== 'undefined' ? globalThis.navigator : undefined)
    : nav;
  if (!n) return false;
  const ua = String(n.userAgent || '');
  if (!ua) return false;   // 拿不到 UA 不猜，保守不下载（41MB 不能乱花）
  // 手机/平板：41MB 模型不自动下载（点麦克风时再按需加载）
  if (/Mobile|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua)) return false;
  const c = n.connection || n.mozConnection || n.webkitConnection;
  if (c) {
    if (c.saveData === true) return false;
    if (/^(slow-2g|2g|3g)$/i.test(String(c.effectiveType || ''))) return false;
  }
  return true;
}

// 启动时按需预热：仅在桌面 + 非省流量 + 网络尚可时后台下载。
export function maybeAutoLoad(nav) {
  if (!shouldAutoLoad(nav)) return false;
  startBackgroundDownload();
  return true;
}

const state = {
  status: 'idle',        // idle | loading | ready | failed
  progress: 0,           // 0~100（近似：按最大单文件进度）
  asr: null,             // pipeline 实例
  loadingPromise: null,
  error: null,
};

export function getStatus() {
  return { status: state.status, progress: state.progress, error: state.error };
}

export function isReady() {
  return state.status === 'ready';
}

// 后台加载（幂等：重复调用返回同一个进行中的 promise）
export function startBackgroundDownload() {
  if (state.status === 'ready') return Promise.resolve({ ok: true, already: true });
  if (state.loadingPromise) return state.loadingPromise;
  state.status = 'loading';
  state.progress = 0;
  state.error = null;
  state.loadingPromise = (async () => {
    try {
      const { pipeline, env } = await import('../vendor/transformers.min.js?v=1793765311');
      // 模型加载两级 fallback：
      // 1) 同源 ./models/（跟网页同一个域名——家长能打开网页就能下模型，中国直连无依赖）
      // 2) 失败自动回落 hf-mirror.com 镜像
      env.allowLocalModels = true;
      env.localModelPath = './models/';
      env.allowRemoteModels = true;
      env.remoteHost = 'https://hf-mirror.com';
      state.asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        quantized: true,
        progress_callback: (p) => {
          if (p && p.status === 'progress' && typeof p.progress === 'number') {
            if (p.progress > state.progress) state.progress = Math.round(p.progress);
          }
        },
      });
      state.status = 'ready';
      state.progress = 100;
      return { ok: true };
    } catch (e) {
      state.status = 'failed';
      state.error = String((e && e.message) || e);
      console.warn('本地识别模型加载失败（不影响学习，稍后可重试）:', state.error);
      return { ok: false, error: state.error };
    }
  })();
  return state.loadingPromise;
}

// 录音 Blob → Float32Array（16kHz 单声道），供 Whisper 使用
export async function blobToAudio16k(blob) {
  const arr = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const decoded = await ac.decodeAudioData(arr);
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    try { await ac.close(); } catch (e) { /* 忽略 */ }
  }
}

// 转写。未就绪/无音频 → null（调用方走降级链）
// 返回 { ok, text } 或 { ok:false, error }
export async function transcribe(blob) {
  if (!isReady() || !blob) return null;
  try {
    const audio = await blobToAudio16k(blob);
    if (!audio || audio.length === 0) return { ok: false, error: 'empty-audio' };
    const out = await state.asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
    return { ok: true, text: (out && out.text ? String(out.text) : '').trim() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 测试/调试钩子：强制置为就绪（注入假转写器），仅影响当前会话
export function __forceReady(fakeAsr) {
  state.status = 'ready';
  state.progress = 100;
  state.asr = fakeAsr;
}
