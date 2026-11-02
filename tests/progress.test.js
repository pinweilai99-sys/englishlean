import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStage1Passed, computeStagePassed, canEnterStage, maxUnlockedStage,
  addStars, checkIn, dateKey, getUnitProgress, setUnitProgress, unitStars, defaultUnitProgress,
} from '../js/core/progress.js';

test('Stage1：词未点亮 → 不通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: ['may', 'pet'], listenScore: 1 };
  assert.equal(isStage1Passed(p, 12, p.listenScore), false);
});

test('Stage1：词全亮但听辨 60% → 不通过', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const p = { ...defaultUnitProgress(), wordsDone: words, listenScore: 0.6 };
  assert.equal(isStage1Passed(p, 12, p.listenScore), false);
});

test('Stage1：词全亮且听辨 80% → 通过', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const p = { ...defaultUnitProgress(), wordsDone: words, listenScore: 0.8 };
  assert.equal(isStage1Passed(p, 12, p.listenScore), true);
});

test('Stage1：听辨分数缺失 → 不通过', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const p = { ...defaultUnitProgress(), wordsDone: words, listenScore: null };
  assert.equal(isStage1Passed(p, 12, p.listenScore), false);
});

test('阶段串行解锁：Stage2 必须 Stage1 先过', () => {
  assert.equal(canEnterStage([false, false, false, false], 1), false);
  assert.equal(canEnterStage([true, false, false, false], 1), true);
  assert.equal(canEnterStage([true, false, false, false], 2), false);
  assert.equal(canEnterStage([true, true, false, false], 2), true);
  assert.equal(canEnterStage([false, false, false, false], 0), true);
});

test('maxUnlockedStage 反映实际可进入阶段', () => {
  assert.equal(maxUnlockedStage([false, false, false, false]), 0);
  assert.equal(maxUnlockedStage([true, false, false, false]), 1);
  assert.equal(maxUnlockedStage([true, true, true, false]), 3);
  assert.equal(maxUnlockedStage([true, true, true, true]), 3);
});

test('computeStagePassed 依赖前序阶段', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const p = { ...defaultUnitProgress(), wordsDone: words, listenScore: 0.9 };
  const r = computeStagePassed(p, { wordTotal: 12, sentenceOk: true, outputOk: true, quizBest: 0.8 });
  assert.deepEqual(r, [true, true, true, true]);

  const r2 = computeStagePassed(p, { wordTotal: 12, sentenceOk: false, outputOk: true, quizBest: 0.9 });
  assert.deepEqual(r2, [true, false, false, false]);
});

test('computeStagePassed：微测 <80% 时 Stage4 不通过', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const p = { ...defaultUnitProgress(), wordsDone: words, listenScore: 0.9 };
  const r = computeStagePassed(p, { wordTotal: 12, sentenceOk: true, outputOk: true, quizBest: 0.5 });
  assert.equal(r[3], false);
});

test('addStars 累加星星', () => {
  const s = { stars: 3 };
  assert.equal(addStars(s, 2).stars, 5);
  assert.equal(s.stars, 3, '原对象不应被修改');
});

test('打卡：连续天数逻辑', () => {
  const d1 = new Date(2026, 10, 2);
  const d2 = new Date(2026, 10, 3);
  const d5 = new Date(2026, 10, 5);
  let s = { streak: 0, lastStudyDate: null };
  s = checkIn(s, d1);
  assert.equal(s.streak, 1);
  s = checkIn(s, d2);
  assert.equal(s.streak, 2);
  // 同一天重复打卡不重复计数
  s = checkIn(s, d2);
  assert.equal(s.streak, 2);
  // 断签后重置
  s = checkIn(s, d5);
  assert.equal(s.streak, 1);
});

test('dateKey 使用本地时区', () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('单元进度读写与星星统计', () => {
  let state = { progress: {} };
  state = setUnitProgress(state, 'u5', { ...defaultUnitProgress(), wordsDone: ['a', 'b', 'c'], stagePassed: [true, true, false, false] });
  assert.deepEqual(getUnitProgress(state, 'u5').wordsDone, ['a', 'b', 'c']);
  // 3 词 + 2 个阶段 * 5
  assert.equal(unitStars(state, 'u5'), 3 + 10);
});
