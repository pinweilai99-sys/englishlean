// 预生成音频服务（assets/audio/*.m4a + manifest.json）
// 背景：手机浏览器（尤其国产安卓 / 微信内置浏览器）普遍没有英语 TTS 引擎，
// speechSynthesis 会"静默失败"——页面不报错但没有任何声音（2026-11-03 家长反馈）。
// 解决：用桌面端系统 TTS（英音 Daniel，与课本英式音标口径一致）把全部发音文本
// 预生成为音频文件，随站点同源部署；播放时优先播音频文件，speechSynthesis 只作兜底。
// manifest.json 由 scripts/gen-audio.mjs 生成；未命中的文本自动退回 TTS。

const AUDIO_BASE = 'assets/audio/';
let available = null; // Set<string> | null（null = 尚未初始化）
let currentEl = null;
let currentFinish = null; // 当前播放的结算回调（stopAudio 时必须调用，否则等待者永久悬挂）
let readyPromise = null;   // 清单加载中的 Promise（供 ensureReady 等待）
let readyWaiters = [];    // 等待清单就绪的回调（清单到达时统一唤醒）
const elPool = new Map();  // slug → HTMLAudioElement（复用+预加载，避免每次点按都重新下载/连接）

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
// 重试：弱网下首次拉取失败会导致「有音频却播不出来」，重试 2 次仍失败才降级。
export async function initAudio(base = AUDIO_BASE, attempt = 0) {
  try {
    const res = await fetch(`${base}manifest.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`manifest http ${res.status}`);
    const data = await res.json();
    available = new Set(data.slugs || []);
  } catch (e) {
    if (attempt < 2) {
      // 退避重试（300ms / 900ms），弱网下这一层决定了「读不出来」还是「读得出来」
      await new Promise((r) => setTimeout(r, attempt === 0 ? 300 : 900));
      const r = await initAudio(base, attempt + 1);
      return r;
    }
    available = new Set();
  }
  notifyReady(); // 唤醒正在等待清单的调用方
  return available;
}

// 重新拉取清单（2026-11-11 家长反馈：安卓平板弹「找不到 Google 引擎」且整局无声）。
//
// 根因：initAudio 只在启动时尝试 3 次；国内网络（github.io 被限速/拦截）下
// 这 3 次可能全部失败 → available 变成**空集且永不重试** → 之后每一次点喇叭
// 都判定「没有预生成音频」→ 退 speechSynthesis → 安卓平板没装 Google TTS 引擎
// → 弹出系统级「找不到 Google 引擎」对话框 + 永远无声。
//
// 这里提供「按需重拉」：当上层发现既没音频也没可用语音时，主动重拉一次清单，
// 弱网一恢复就立刻能用上预生成音频（这是安卓/国产设备唯一可靠的出声通道）。
// 返回 true = 清单成功重拉且非空；false = 仍不可用。
export async function retryManifest(timeoutMs = 3000) {
  if (available && available.size > 0) return true; // 已有可用清单，无需重拉
  const p = initAudio();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const r = await Promise.race([p, timeout]);
  return !!(r && r.size > 0);
}

// 等待音频清单就绪（最多 timeoutMs）。
// 为什么需要：initAudio 是异步的，用户首屏点「听一听」时清单可能还没到，
// 此时 hasAudio() 返回 false → 直接退回 speechSynthesis → 国产安卓/微信内置浏览器
// 没有英语 TTS 引擎 → 静默无声（家长反馈"读不出来"的典型成因）。
//
// 语义：available === null 表示"尚未加载"（等待）；空 Set 表示"已加载但无匹配"（终态，立即返回）。
export function ensureReady(timeoutMs = 2500) {
  if (available) return Promise.resolve(available); // 已就绪（含"已加载但为空"）
  if (!readyPromise) readyPromise = initAudio();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const i = readyWaiters.indexOf(finish);
      if (i >= 0) readyWaiters.splice(i, 1);
      resolve(available || new Set());
    };
    readyWaiters.push(finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}

// 清单就绪时唤醒所有等待者（initAudio 成功/失败、测试注入都走这里）
function notifyReady() {
  readyWaiters.slice().forEach((f) => f());
}

export function hasAudio(text) {
  return !!available && available.has(audioSlug(text));
}

// 播放预生成音频；resolve(true)=已播放，false=失败（调用方应退回 TTS）。
// 测试/Node 环境（无 Audio 构造器）直接 resolve(false)，保证行为可预测。
// opts.playbackRate：慢速拼读用（0.62 左右）。预生成音频是整词录音，
// 放慢后音素边界更清楚，孩子能听出"这个词是由几块拼出来的"。
//
// 2026-11-06 家长反馈"有时候读不出来 / 有时候要等好久"，根因修复（4 处）：
//  ① **自适应超时**：旧实现固定等 20 秒。个别内核不触发 onended 时，
//     一次「听一听」就要干等 20 秒 → 现在按音频真实时长计算
//     （duration / playbackRate + 缓冲），上限 8 秒，绝不长时间空等。
//  ② **元素复用**：每次播放都 new Audio() 会重新建立连接、重新下载（弱网更慢），
//     现在同一 slug 复用同一个 Audio 元素并预加载，第二次起几乎瞬时出声。
//  ③ **释放挂起的等待者**：stopAudio() 会把 onended 置空，之前那个 Promise
//     永远不会 resolve → 上层 await 永久卡住。现在 stopAudio 会主动结算。
//  ④ **不阻塞降级**：播放失败立即返回 false，由上层退回 TTS，不拖时间。
export function playAudio(text, base = AUDIO_BASE, opts = {}) {
  return new Promise((resolve) => {
    try {
      if (typeof Audio === 'undefined') return resolve(false);
      stopAudio();
      const slug = audioSlug(text);
      const key = `${base}${slug}`;
      let el = elPool.get(key);
      if (!el) {
        el = new Audio(`${base}${slug}.m4a`);
        el.preload = 'auto';
        elPool.set(key, el);
      }
      const rate = opts.playbackRate > 0 ? opts.playbackRate : 1;
      try {
        el.playbackRate = rate;
        el.currentTime = 0;
      } catch (e) { /* 某些内核在未加载时不允许设 currentTime */ }

      let done = false;
      let timer = null;
      // ⚠️ 2026-11-11 关键修复（家长：安卓平板莫名弹「找不到 Google 引擎」）：
      // 连点两个喇叭时，第二次播放会 stopAudio() 打断第一个 → 第一个的 Promise 被
      // 主动结算为 false → 上层 speak() 把"**被打断**"误判为"**播放失败**" →
      // 退 TTS 兜底 → 无引擎设备弹系统框 / 应用内误报"发不出声音"。
      // 现在区分两种结算：interrupted=true 表示"被新播放打断"（正常，不算失败），
      // 上层据此直接返回 cancelled，不再误触发降级与提示。
      let interrupted = false;
      const finish = (ok, isInterrupt) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (currentFinish === finish) currentFinish = null;
        if (currentEl === el) currentEl = null;
        // 被新播放打断时返回带标记的对象，让上层区分"打断"与"失败"
        resolve(isInterrupt ? { ok: false, reason: 'interrupted' } : ok);
      };
      currentFinish = finish;
      currentEl = el;

      // 自适应超时：拿到 metadata 后按真实时长算；拿不到就用保守上限。
      const armTimer = () => {
        const d = Number(el.duration);
        if (Number.isFinite(d) && d > 0) {
          const ms = Math.ceil((d / rate) * 1000) + 1200;
          clearTimeout(timer);
          timer = setTimeout(() => finish(true), Math.min(8000, Math.max(1500, ms)));
        }
      };
      // ⚠️ 顺序很重要：先装兜底，再让 armTimer 覆盖它。
      // 反过来写（先 armTimer 后装兜底）会让兜底把自适应定时器冲掉 → 又变回固定 8 秒。
      timer = setTimeout(() => finish(true), 8000); // 元数据迟迟不来时的兜底上限
      if (el.readyState >= 1) armTimer();
      else el.addEventListener('loadedmetadata', armTimer, { once: true });

      el.onended = () => finish(true);
      el.onerror = () => finish(false);
      // 进度回调：让 UI 的高亮跟着声音走（拼读示范靠它做"同步点亮"，
      // 而不是靠固定 setTimeout 空等——那样会产生 1-2 秒纯静音）
      if (typeof opts.onProgress === 'function') {
        const onTick = () => {
          try {
            opts.onProgress(Number(el.currentTime) || 0, Number(el.duration) || 0);
          } catch (e) { /* 忽略 */ }
        };
        el.addEventListener('timeupdate', onTick);
        const drop = () => el.removeEventListener('timeupdate', onTick);
        el.addEventListener('ended', drop, { once: true });
        el.addEventListener('error', drop, { once: true });
      }
      const pr = typeof el.play === 'function' ? el.play() : null;
      if (pr && typeof pr.catch === 'function') pr.catch(() => finish(false));
    } catch (e) {
      resolve(false);
    }
  });
}

// 停掉正在播的音频（切题/点新按钮时调用，避免叠音）。
// 必须结算挂起的等待者：否则调用方 await playAudio() 会永久卡住
// （2026-11-06 修复：onended 被置空后 Promise 再也不会 resolve）。
export function stopAudio() {
  if (currentEl) {
    try {
      currentEl.onended = null;
      currentEl.onerror = null;
      currentEl.pause();
    } catch (e) { /* 忽略 */ }
    currentEl = null;
  }
  if (currentFinish) {
    const f = currentFinish;
    currentFinish = null;
    f(false, true); // 第二参=true → 标记为「被新播放打断」而非「播放失败」
  }
}

// 仅供测试：直接注入可用清单（绕过 fetch）
export function _debugSetAvailable(slugs) {
  available = new Set(slugs || []);
  readyPromise = null; // 让 ensureReady 能重新等待（否则会拿到旧的已 resolve promise）
  notifyReady();       // 立刻唤醒等待者（模拟"清单刚刚到达"）
}

// 仅供测试：清空 Audio 元素池（让复用测试可从干净状态开始）
export function _debugClearPool() {
  elPool.clear();
}

// 仅供测试：复位到"清单尚未加载"状态（available = null，与真实首屏一致）
export function _debugResetManifest() {
  available = null;
  readyPromise = null;
  readyWaiters = [];
}
