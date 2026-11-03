// 存储层：localStorage 读写、默认值合并、版本校验、导入导出、重置
// 纯逻辑，不依赖 DOM，可被 node --test 直接引入。

import { defaultUnitProgress } from './progress.js?v=1793668920';

export const STORAGE_KEY = 'englishlean_v1';
export const CURRENT_VERSION = 1;

export function defaultState() {
  return {
    version: CURRENT_VERSION,
    stars: 0,
    streak: 0,
    lastStudyDate: null,
    progress: {},
    wrongBank: [],
    reviewPlan: [],
    settings: { audioOn: true },
  };
}

export { defaultUnitProgress };

// 深合并：保证缺失字段补默认值，但绝不覆盖已有用户数据
function mergeUnitProgress(raw) {
  const base = defaultUnitProgress();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  if (Array.isArray(raw.stagePassed)) {
    out.stagePassed = base.stagePassed.map((v, i) => Boolean(raw.stagePassed[i]));
  }
  if (Array.isArray(raw.wordsDone)) out.wordsDone = raw.wordsDone.filter((w) => typeof w === 'string');
  if (raw.listenScore === null || typeof raw.listenScore === 'number') out.listenScore = raw.listenScore ?? null;
  if (raw.quizBest === null || typeof raw.quizBest === 'number') out.quizBest = raw.quizBest ?? null;
  if (Array.isArray(raw.spellingDone)) out.spellingDone = raw.spellingDone.filter((w) => typeof w === 'string');
  if (Array.isArray(raw.spellingWrong)) out.spellingWrong = raw.spellingWrong.filter((w) => typeof w === 'string');
  if (Array.isArray(raw.handwritingDone)) out.handwritingDone = raw.handwritingDone.filter((w) => typeof w === 'string');
  if (raw.reviewCount && typeof raw.reviewCount === 'object') {
    out.reviewCount = {};
    for (const [w, n] of Object.entries(raw.reviewCount)) {
      if (typeof w === 'string' && Number.isFinite(n)) out.reviewCount[w] = n;
    }
  }
  if (Number.isFinite(raw.learnRound)) out.learnRound = Math.max(1, Math.floor(raw.learnRound));
  return out;
}

export function mergeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  out.version = typeof raw.version === 'number' ? raw.version : base.version;
  out.stars = Number.isFinite(raw.stars) ? raw.stars : base.stars;
  out.streak = Number.isFinite(raw.streak) ? raw.streak : base.streak;
  out.lastStudyDate = typeof raw.lastStudyDate === 'string' ? raw.lastStudyDate : null;
  if (raw.progress && typeof raw.progress === 'object') {
    out.progress = {};
    for (const [unitId, up] of Object.entries(raw.progress)) {
      out.progress[unitId] = mergeUnitProgress(up);
    }
  }
  if (Array.isArray(raw.wrongBank)) out.wrongBank = raw.wrongBank.slice();
  if (Array.isArray(raw.reviewPlan)) out.reviewPlan = raw.reviewPlan.slice();
  if (raw.settings && typeof raw.settings === 'object') {
    out.settings = { ...base.settings, ...raw.settings };
  }
  return out;
}

// 版本迁移：只做「补字段」这类安全的向前迁移；不丢弃用户已有数据
export function migrate(raw) {
  const state = mergeState(raw);
  state.version = CURRENT_VERSION;
  return state;
}

export function loadState(storage) {
  try {
    const txt = storage.getItem(STORAGE_KEY);
    if (txt === null || txt === undefined) return defaultState();
    return migrate(JSON.parse(txt));
  } catch (e) {
    return defaultState();
  }
}

export function saveState(storage, state) {
  const payload = { ...state, version: CURRENT_VERSION };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function exportState(state) {
  return JSON.stringify({ ...state, version: CURRENT_VERSION }, null, 2);
}

// 导入：版本过高 → 报错且不覆盖；版本较低 → 迁移后覆盖
export function importState(storage, jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '文件格式不正确' };
  }
  if (typeof parsed.version === 'number' && parsed.version > CURRENT_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前程序(${CURRENT_VERSION})，无法恢复` };
  }
  const state = migrate(parsed);
  saveState(storage, state);
  return { ok: true, state };
}

export function resetState(storage) {
  storage.removeItem(STORAGE_KEY);
  return defaultState();
}

// 内存版 storage，供测试使用
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get size() { return map.size; },
  };
}
