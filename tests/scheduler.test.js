import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_OFFSETS, toDateKey, addDays, buildReviewPlan, dueReviews, markReviewDone, pendingCount } from '../js/core/scheduler.js';

test('复习间隔为第 1/3/7 天', () => {
  assert.deepEqual(REVIEW_OFFSETS, [1, 3, 7]);
});

test('addDays 跨月跨年正确', () => {
  assert.equal(addDays('2026-11-02', 1), '2026-11-03');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('buildReviewPlan 生成 3 条计划且到期日正确', () => {
  const plan = buildReviewPlan('2026-11-02', ['rc1', 'rc2']);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.dueDate), ['2026-11-03', '2026-11-05', '2026-11-09']);
  assert.deepEqual(plan[0].taskIds, ['rc1', 'rc2']);
  assert.ok(plan.every((p) => p.done === false));
});

test('dueReviews 只取到期未完成的任务', () => {
  const plan = buildReviewPlan('2026-11-02', ['rc1']);
  // 第 1 天：只有第 1 条到期
  assert.equal(dueReviews(plan, '2026-11-03').length, 1);
  // 第 5 天：第 1、2 条到期
  assert.equal(dueReviews(plan, '2026-11-05').length, 2);
  // 第 9 天：全部到期
  assert.equal(dueReviews(plan, '2026-11-09').length, 3);
  // 学习当天无到期
  assert.equal(dueReviews(plan, '2026-11-02').length, 0);
});

test('markReviewDone 标记后不再重复推送', () => {
  let plan = buildReviewPlan('2026-11-02', ['rc1']);
  plan = markReviewDone(plan, 1);
  assert.equal(plan[0].done, true);
  assert.equal(dueReviews(plan, '2026-11-09').length, 2);
  assert.equal(pendingCount(plan), 2);
});

test('pendingCount 统计未完成', () => {
  const plan = buildReviewPlan('2026-11-02', ['rc1']);
  assert.equal(pendingCount(plan), 3);
  assert.equal(pendingCount(null), 0);
});

test('toDateKey 使用本地时区格式', () => {
  assert.equal(toDateKey(new Date(2026, 10, 2)), '2026-11-02');
});
