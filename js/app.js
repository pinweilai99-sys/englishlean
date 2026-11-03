// 应用入口：状态管理、路由、渲染调度
import { loadState, saveState, defaultState } from './core/storage.js?v=1793704406';
import {
  defaultUnitProgress, computeStagePassed, canEnterStage, isStage1Passed,
  addStars as addStarsCore, checkIn, getUnitProgress, setUnitProgress, dateKey,
} from './core/progress.js?v=1793704406';
import { buildReviewPlan, dueReviews, pendingCount } from './core/scheduler.js?v=1793704406';
import { validateUnit } from './core/validate.js?v=1793704406';
import { h, clear, toast, confetti, starFly } from './ui/dom.js?v=1793704406';
import { renderHome, UNITS } from './ui/home.js?v=1793704406';
import { renderUnit } from './ui/unit.js?v=1793704406';
import { renderWordCard } from './ui/wordcard.js?v=1793704406';
import { renderListen } from './ui/listen.js?v=1793704406';
import { renderPhonics } from './ui/phonics.js?v=1793704406';
import { renderSpelling } from './ui/spelling.js?v=1793704406';
import { renderHandwriting } from './ui/handwriting.js?v=1793704406';
import { renderSentence } from './ui/sentence.js?v=1793704406';
import { renderOutput } from './ui/output.js?v=1793704406';
import { renderStories, renderQuiz } from './ui/story.js?v=1793704406';
import { renderRecall } from './ui/recall.js?v=1793704406';
import { renderParent } from './ui/parent.js?v=1793704406';
import * as tts from './services/tts.js?v=1793704406';
import { initAudio } from './services/audio.js?v=1793704406';

const UNIT_ID = 'u5';
const state = {
  data: null,        // 单元内容数据
  state: defaultState(),
  session: {},       // 页面内临时状态
  route: { name: 'home' },
};

const els = {
  topbar: null,
  main: null,
  floatbar: null,
};

// ---------- 状态操作 ----------
function save() {
  state.state = saveState(localStorage, state.state);
}

function setUnitProgressLocal(unitId, updater) {
  const cur = getUnitProgress(state.state, unitId) || defaultUnitProgress();
  const next = updater(cur);
  state.state = setUnitProgress(state.state, unitId, next);
  save();
}

function addStars(delta) {
  state.state = addStarsCore(state.state, delta);
  save();
  starFly(delta);
  renderTopbar();
}

function addWrong(item) {
  const wb = Array.isArray(state.state.wrongBank) ? state.state.wrongBank.slice() : [];
  wb.push({ ...item, at: new Date().toISOString() });
  state.state = { ...state.state, wrongBank: wb };
  save();
}

// 阶段完成：重算全部阶段状态并生成复习计划
function completeStage(unitId, stageIdx) {
  setUnitProgressLocal(unitId, (up) => {
    const stagePassed = [...(up.stagePassed || [false, false, false, false])];
    stagePassed[stageIdx] = true;
    return { ...up, stagePassed };
  });
  // 全部阶段通过 → 生成间隔复习计划
  const up = getUnitProgress(state.state, unitId);
  if (up?.stagePassed?.every(Boolean)) {
    state.state = {
      ...state.state,
      reviewPlan: buildReviewPlan(dateKey(), (state.data?.reviewCards || []).map((c) => c.id)),
    };
    save();
  }
}

// Stage1 自动通关检查：满足条件立即标记通过并解锁 Stage2
function checkStage1(unitId) {
  const unit = state.data;
  if (!unit) return;
  const p = getUnitProgress(state.state, unitId);
  if (!p || p.stagePassed?.[0]) return;
  const wordTotal = unit.words.length;
  const spellingTotal = unit.words.filter((w) => w.tier === 'four').length;
  if (isStage1Passed(p, { wordTotal, spellingTotal })) {
    completeStage(unitId, 0);
    toast('🎉 单词奠基通关！核心句型已解锁！', 3200);
    confetti();
  }
}

// ---------- 渲染 ----------
function renderTopbar() {
  const bar = els.topbar;
  if (!bar) return;
  clear(bar);
  const inner = h('div', { class: 'topbar-inner' }, [
    h('span', { class: 'brand' }, [h('span', { class: 'brand-mark', text: '🐶' }), h('span', { text: '英语乐园' })]),
  ]);

  const tabbar = h('div', { class: 'tabbar' });
  UNITS.forEach((u) => {
    tabbar.appendChild(h('button', {
      class: `tab ${u.id === UNIT_ID ? 'is-active' : ''} ${u.open ? '' : 'is-locked'}`,
      text: `U${u.no}`,
      onclick: () => {
        if (!u.open) { toast('这个单元还在准备中～'); return; }
        navigate(`#/unit/${u.id}`);
      },
    }));
  });
  inner.appendChild(tabbar);

  inner.appendChild(h('div', { class: 'topbar-actions' }, [
    h('span', { class: 'chip', text: `⭐ ${state.state.stars || 0}` }),
    h('button', {
      class: 'icon-btn', title: '声音开关', text: state.state.settings?.audioOn ? '🔊' : '🔇',
      onclick: () => {
        const on = !state.state.settings.audioOn;
        state.state = { ...state.state, settings: { ...state.state.settings, audioOn: on } };
        tts.setEnabled(on);
        save();
        renderTopbar();
      },
    }),
    h('button', { class: 'icon-btn', title: '家长中心', text: '👨‍👩‍👦', onclick: () => navigate(`#/parent`) }),
  ]));
  bar.appendChild(inner);
}

function renderFloatbar() {
  const bar = els.floatbar;
  if (!bar) return;
  clear(bar);
  const due = dueReviews(state.state.reviewPlan, dateKey());
  const inner = h('div', { class: 'floatbar-inner' }, [
    h('button', { class: 'fab', text: '🃏 回忆卡', onclick: () => navigate(`#/recall`) }),
    h('button', {
      class: `fab ${due.length ? 'alert' : ''}`,
      text: `🔔 复习${due.length ? ` ${due.length}` : ''}`,
      onclick: () => {
        if (!due.length) { toast('暂时没有到期的复习～'); return; }
        navigate(`#/recall`);
      },
    }),
    h('button', {
      class: 'fab', text: '📅 打卡',
      onclick: () => {
        state.state = checkIn(state.state, new Date());
        save();
        toast(`打卡成功！连续 ${state.state.streak} 天 🔥`);
        renderTopbar();
      },
    }),
  ]);
  bar.appendChild(inner);
}

function parseRoute() {
  const hash = window.location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'unit') {
    const unitId = parts[1] || UNIT_ID;
    if (parts[2] === 'stage') {
      const stage = Number(parts[3] || 0);
      const mod = parts[4] || '';
      return { name: 'stage', unitId, stage, mod };
    }
    return { name: 'unit', unitId };
  }
  if (parts[0] === 'recall') return { name: 'recall' };
  if (parts[0] === 'parent') return { name: 'parent' };
  return { name: 'home' };
}

function navigate(hash) {
  if (window.location.hash === hash) { render(); return; }
  window.location.hash = hash;
}

function render() {
  const main = els.main;
  if (!main) return;
  state.route = parseRoute();
  clear(main);

  if (!state.data) {
    main.appendChild(h('div', { class: 'card', text: '正在加载单元内容…' }));
    return;
  }

  const unit = state.data;
  const p = getUnitProgress(state.state, unit.id) || defaultUnitProgress();
  const stagePassed = p.stagePassed || [false, false, false, false];

  const ctx = {
    get state() { return state.state; },
    get session() { return state.session; },
    getUnitProgress: (id) => getUnitProgress(state.state, id),
    updateUnitProgress: (id, updater) => { setUnitProgressLocal(id, updater); },
    addStars,
    addWrong,
    completeStage,
    checkStage1,
    navigate,
    render,
    replaceState: (s) => { state.state = s; save(); },
  };

  const r = state.route;
  if (r.name === 'home') {
    main.appendChild(renderHome(ctx));
  } else if (r.name === 'unit') {
    main.appendChild(renderUnit(ctx, unit));
  } else if (r.name === 'recall') {
    main.appendChild(renderRecall(ctx, unit));
  } else if (r.name === 'parent') {
    main.appendChild(renderParent(ctx, unit));
  } else if (r.name === 'stage') {
    const s = r.stage;
    const open = canEnterStage(stagePassed, s);
    if (!open) {
      main.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'card-title', text: '🔒 这一关还没解锁' }),
        h('p', { class: 'hint', text: '先完成前面的阶段，才能来这里哦。' }),
        h('button', { class: 'btn', text: '← 返回学习路径', onclick: () => navigate(`#/unit/${unit.id}`) }),
      ]));
    } else if (s === 0) {
      if (r.mod === 'listen') main.appendChild(renderListen(ctx, unit));
      else if (r.mod === 'phonics') main.appendChild(renderPhonics(ctx, unit));
      else if (r.mod === 'spelling') main.appendChild(renderSpelling(ctx, unit));
      else if (r.mod === 'handwriting') main.appendChild(renderHandwriting(ctx, unit));
      else main.appendChild(renderWordCard(ctx, unit));
    } else if (s === 1) {
      main.appendChild(renderSentence(ctx, unit));
    } else if (s === 2) {
      main.appendChild(renderOutput(ctx, unit));
    } else if (s === 3) {
      if (r.mod === 'quiz') main.appendChild(renderQuiz(ctx, unit));
      else main.appendChild(renderStories(ctx, unit));
    }
  }

  renderTopbar();
  renderFloatbar();
}

// ---------- 启动 ----------
async function boot() {
  els.topbar = document.getElementById('topbar');
  els.main = document.getElementById('main');
  els.floatbar = document.getElementById('floatbar');

  state.state = loadState(localStorage);
  tts.setEnabled(state.state.settings?.audioOn !== false);

  try {
    const res = await fetch('data/units/u5.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const v = validateUnit(data);
    if (!v.valid) {
      console.error('单元数据校验失败：', v.errors);
      if (els.main) {
        els.main.innerHTML = '';
        els.main.appendChild(h('div', { class: 'card' }, [
          h('div', { class: 'card-title', text: '😢 内容数据有问题' }),
          h('p', { class: 'hint', text: `请把下面的信息发给开发者：${v.errors.join('；')}` }),
        ]));
      }
      return;
    }
    state.data = data;
  } catch (e) {
    console.error(e);
    if (els.main) {
      els.main.innerHTML = '';
      els.main.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'card-title', text: '😢 加载失败' }),
        h('p', { class: 'hint', text: '请用本地服务器打开（不能用 file:// 直接打开）。' }),
      ]));
    }
    return;
  }

  window.addEventListener('hashchange', render);
  render();

  // 拉取预生成音频清单（assets/audio/manifest.json）：手机没有英语 TTS 引擎也能播放发音。
  // 拉取失败不阻塞（全部退回 speechSynthesis）。
  initAudio();

  // 后台渐进加载本地识别模型（Whisper WASM，约 41MB）：不阻塞学习。
  // 仅桌面端 + 非省流量 + 网络尚可才自动下载；手机/弱网不下载（否则会占满带宽，
  // 页面表现像卡死/打不开），改为用户点"🎤 我来读"时按需加载。
  // E2E 测试通过 __disableLocalAsr 禁用（jsdom 无法执行 wasm）。
  if (window.__disableLocalAsr !== true) {
    setTimeout(() => {
      import('./services/local-asr.js?v=1793704406')
        .then((m) => m.maybeAutoLoad())
        .catch(() => { /* 静默：降级链已在 */ });
    }, 5000);
  }
}

boot();

// 暴露给测试与调试
window.__APP__ = { state, render, navigate };
