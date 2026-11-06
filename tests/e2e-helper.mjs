// E2E 辅助：把 jsdom 的 window/document/localStorage 注入为全局，
// 然后以缓存击穿方式导入 app.js —— 用"接近真实浏览器"的方式驱动整个应用。
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const unitData = JSON.parse(readFileSync(join(root, 'data/units/u5.json'), 'utf8'));

let bootSeq = 0;

export async function freshApp({ seed = null, stubAudio = true, realAudio = false } = {}) {
  bootSeq += 1;
  const dom = new JSDOM(html, { url: 'http://localhost:8080/', pretendToBeVisual: true });
  const { window } = dom;

  // --- 全局注入（核心模块与 UI 模块都通过全局访问 DOM/存储） ---
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.Node = window.Node;
  globalThis.Blob = window.Blob;

  window.__disableLocalAsr = true; // jsdom 无法执行 wasm，E2E 一律禁用本地模型后台加载
  window.localStorage.clear();
  if (seed) window.localStorage.setItem('englishlean_v1', JSON.stringify(seed));

  // --- 音频桩 ---
  if (stubAudio) {
    window.speechSynthesis = {
      __spoken: [],
      getVoices: () => [{ lang: 'en-US', name: 'TestVoice' }],
      speak(u) { this.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
      cancel() {},
    };
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    // realAudio=true：模拟**预生成音频**的真实播放（有时长、推进 timeupdate 进度），
    // 用于验证"拼读示范高亮跟着声音走"这类只有真实播放路径才有的行为。
    // 默认 false（走 TTS 兜底，立即结束），保持既有断言的稳定。
    if (realAudio) {
      window.HTMLMediaElement = class {};
      globalThis.Audio = class {
        constructor(src) {
          this.src = src;
          this.playbackRate = 1;
          this.currentTime = 0;
          this.duration = 0.9; // 单词音频典型时长
          this.readyState = 1;
          this.preload = 'auto';
          this._h = {};
        }
        addEventListener(t, fn) { (this._h[t] ||= []).push(fn); }
        removeEventListener(t, fn) { this._h[t] = (this._h[t] || []).filter((x) => x !== fn); }
        _emit(t) { (this._h[t] || []).forEach((fn) => fn()); }
        play() {
          const dur = (this.duration / (this.playbackRate || 1)) * 1000;
          const step = 100;
          let elapsed = 0;
          this._timer = setInterval(() => {
            elapsed += step;
            this.currentTime = Math.min(this.duration, elapsed / 1000);
            this._emit('timeupdate');
            if (elapsed >= dur) {
              clearInterval(this._timer);
              this._emit('ended');
              if (this.onended) this.onended();
            }
          }, step);
          return Promise.resolve();
        }
        pause() { clearInterval(this._timer); }
      };
      // 让清单命中（hasAudio=true）
      const { _debugSetAvailable } = await import('../js/services/audio.js');
      const manifest = JSON.parse(readFileSync(join(root, 'assets/audio/manifest.json'), 'utf8'));
      _debugSetAvailable(manifest.slugs);
    }
    window.__nextTranscript = null;
    window.SpeechRecognition = class {
      constructor() { this.lang = ''; }
      start() {
        setTimeout(() => {
          if (this.onresult) this.onresult({ results: [[{ transcript: window.__nextTranscript ?? 'rabbit' }]] });
        }, 5);
      }
      abort() {}
    };
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 5); }
    };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [] }) },
      configurable: true,
    });
    // AudioContext 桩：音量监测用；__micLevel>0 表示"有声音"
    window.__micLevel = 0;
    window.AudioContext = class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 1024,
          getFloatTimeDomainData(buf) { if (window.__micLevel > 0) buf.fill(window.__micLevel); },
        };
      }
      close() {}
    };
  } else {
    // 不注入任何音频能力 → 走降级路径
    delete window.speechSynthesis;
    delete window.SpeechRecognition;
    delete window.MediaRecorder;
  }

  // --- fetch 桩：直接读本地数据文件 ---
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => unitData,
    text: async () => JSON.stringify(unitData),
  });

  // --- 导入应用（缓存击穿，保证每个用例独立实例） ---
  const appUrl = pathToFileURL(join(root, 'js/app.js')).href + `?boot=${bootSeq}`;
  await import(appUrl);

  // 等待 boot 完成
  for (let i = 0; i < 100; i++) {
    if (window.__APP__?.state?.data) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!window.__APP__?.state?.data) throw new Error('应用启动失败：数据未加载');

  return {
    dom,
    window,
    app: window.__APP__,
    cleanup() {
      globalThis.fetch = realFetch;
      dom.window.close();
    },
  };
}

// ---- 交互工具 ----
export function buttons(window) {
  return Array.from(window.document.querySelectorAll('button'));
}

export async function clickButton(window, text, { within = null } = {}) {
  const scope = within || window.document;
  const nodes = Array.from(scope.querySelectorAll('button')).filter(
    (b) => (b.textContent || '').includes(text),
  );
  if (!nodes.length) throw new Error(`找不到按钮「${text}」`);
  nodes[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  return nodes[0];
}

export async function navigate(window, app, hash) {
  app.navigate(hash);
  await new Promise((r) => setTimeout(r, 40));
  // 兜底：jsdom 的 hashchange 事件偶发延迟，render 幂等，重绘一次保证路由生效
  app.render();
  await new Promise((r) => setTimeout(r, 20));
}

export function mainText(window) {
  return window.document.getElementById('main')?.textContent || '';
}

export function persisted(window) {
  return JSON.parse(window.localStorage.getItem('englishlean_v1') || 'null');
}

export const UNIT = unitData;
