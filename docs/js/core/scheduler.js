// 间隔复习排期：第 1 / 3 / 7 天
// 纯逻辑，可被 node --test 直接引入。

export const REVIEW_OFFSETS = [1, 3, 7];

export function toDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toDateKey(dt);
}

// 生成复习计划
export function buildReviewPlan(studyDateKey, taskIds) {
  const ids = Array.isArray(taskIds) ? taskIds : [];
  return REVIEW_OFFSETS.map((offset) => ({
    offset,
    dueDate: addDays(studyDateKey, offset),
    taskIds: ids.slice(),
    done: false,
  }));
}

// 取出到期未完成的复习任务
export function dueReviews(plan, todayKey) {
  if (!Array.isArray(plan)) return [];
  return plan.filter((p) => !p.done && p.dueDate <= todayKey);
}

// 标记某条复习完成
export function markReviewDone(plan, offset) {
  if (!Array.isArray(plan)) return [];
  return plan.map((p) => (p.offset === offset ? { ...p, done: true } : p));
}

// 剩余待复习数量
export function pendingCount(plan) {
  if (!Array.isArray(plan)) return 0;
  return plan.filter((p) => !p.done).length;
}
