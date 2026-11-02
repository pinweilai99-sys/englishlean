// 进度核心：阶段解锁判定、通关判定、星星累计、打卡连续天数
// 纯逻辑，可被 node --test 直接引入。

export const STAGE_NAMES = ['单词奠基', '核心句型', '真实输出', '巩固拓展'];

// 单元进度的默认形状（与存储层共用）
export function defaultUnitProgress() {
  return {
    stagePassed: [false, false, false, false],
    wordsDone: [],
    listenScore: null,
    quizBest: null,
  };
}

// Stage1 通关条件：所有四会+认读词全部点亮，且听辨正确率 >= 0.8
export function isStage1Passed(unitProgress, wordTotal, listenScore) {
  if (!unitProgress) return false;
  const wordsDone = Array.isArray(unitProgress.wordsDone) ? unitProgress.wordsDone : [];
  if (wordTotal > 0 && wordsDone.length < wordTotal) return false;
  if (listenScore === null || listenScore === undefined) return false;
  return listenScore >= 0.8;
}

// 计算 4 个阶段的通过状态
export function computeStagePassed(unitProgress, opts) {
  const { wordTotal = 0, sentenceOk = false, outputOk = false, quizBest = null } = opts || {};
  const p = unitProgress || {};
  const s1 = isStage1Passed(p, wordTotal, p.listenScore);
  const s2 = s1 && !!sentenceOk;
  const s3 = s2 && !!outputOk;
  const s4 = s3 && quizBest !== null && quizBest !== undefined && quizBest >= 0.8;
  return [s1, s2, s3, s4];
}

// 能否进入第 stage 个阶段（从 0 开始）：前一个阶段必须已通过
export function canEnterStage(stagePassed, stageIndex) {
  if (stageIndex <= 0) return true;
  const prev = stagePassed[stageIndex - 1];
  return prev === true;
}

// 已解锁的最大阶段索引（阶段索引从 0 开始，最大为 stagePassed.length - 1）
export function maxUnlockedStage(stagePassed) {
  const total = stagePassed.length;
  let idx = 0;
  for (let i = 0; i < total - 1; i++) {
    if (canEnterStage(stagePassed, i + 1)) idx = i + 1;
    else break;
  }
  return idx;
}

export function addStars(state, delta) {
  const next = { ...state, stars: (state.stars || 0) + delta };
  return next;
}

// 日期工具（使用本地时区，避免 UTC 偏移导致跨天误判）
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yesterdayKey(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - 1);
  return dateKey(t);
}

// 打卡：今天已打过 → 连续天数不变；昨天打过 → +1；否则重置为 1
export function checkIn(state, today = new Date()) {
  const todayK = dateKey(today);
  if (state.lastStudyDate === todayK) {
    return { ...state, streak: state.streak || 1 };
  }
  const streak = state.lastStudyDate === yesterdayKey(today) ? (state.streak || 0) + 1 : 1;
  return { ...state, streak, lastStudyDate: todayK };
}

// 单元进度读写
export function getUnitProgress(state, unitId) {
  return (state.progress && state.progress[unitId]) || null;
}

export function setUnitProgress(state, unitId, unitProgress) {
  return {
    ...state,
    progress: { ...(state.progress || {}), [unitId]: unitProgress },
  };
}

export function unitStars(state, unitId) {
  const p = getUnitProgress(state, unitId);
  if (!p) return 0;
  const words = Array.isArray(p.wordsDone) ? p.wordsDone.length : 0;
  const passed = Array.isArray(p.stagePassed) ? p.stagePassed.filter(Boolean).length : 0;
  return words + passed * 5;
}
