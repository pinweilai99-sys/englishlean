import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStage1Passed, computeStagePassed, canEnterStage, maxUnlockedStage,
  addStars, checkIn, dateKey, getUnitProgress, setUnitProgress, unitStars, defaultUnitProgress,
} from '../js/core/progress.js';

const WORDS12 = Array.from({ length: 12 }, (_, i) => `w${i}`);

test('Stage1：词未点亮 → 不通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: ['may', 'pet'], listenScore: 1 };
  assert.equal(isStage1Passed(p, { wordTotal: 12 }), false);
});

test('Stage1：词全亮但听辨 60% → 不通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: 0.6 };
  assert.equal(isStage1Passed(p, { wordTotal: 12 }), false);
});

test('Stage1：词全亮且听辨 80% → 通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: 0.8 };
  assert.equal(isStage1Passed(p, { wordTotal: 12 }), true);
});

test('Stage1：听辨分数缺失 → 不通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: null };
  assert.equal(isStage1Passed(p, { wordTotal: 12 }), false);
});

test('Stage1：四会词拼写未完成 → 不通过（认读词不要求拼写）', () => {
  const base = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: 0.9 };
  assert.equal(isStage1Passed(base, { wordTotal: 12, spellingTotal: 5 }), false, '拼写未完成不应通过');
  const ok = { ...base, spellingDone: ['may', 'pet', 'rabbit', 'feed'] };
  assert.equal(isStage1Passed(ok, { wordTotal: 12, spellingTotal: 5 }), false, '拼了 4/5 也不行');
  const all = { ...base, spellingDone: ['may', 'pet', 'rabbit', 'feed', 'hold'] };
  assert.equal(isStage1Passed(all, { wordTotal: 12, spellingTotal: 5 }), true, '5 词全拼过才通过');
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
  const p = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: 0.9,
              spellingDone: ['a', 'b', 'c', 'd', 'e'] };
  const r = computeStagePassed(p, { wordTotal: 12, spellingTotal: 5, sentenceOk: true, outputOk: true, quizBest: 0.8 });
  assert.deepEqual(r, [true, true, true, true]);

  const r2 = computeStagePassed(p, { wordTotal: 12, spellingTotal: 5, sentenceOk: false, outputOk: true, quizBest: 0.9 });
  assert.deepEqual(r2, [true, false, false, false]);
});

test('computeStagePassed：微测 <80% 时 Stage4 不通过', () => {
  const p = { ...defaultUnitProgress(), wordsDone: WORDS12, listenScore: 0.9,
              spellingDone: ['a', 'b', 'c', 'd', 'e'] };
  const r = computeStagePassed(p, { wordTotal: 12, spellingTotal: 5, sentenceOk: true, outputOk: true, quizBest: 0.5 });
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

// ── stage1Checklist：Stage1 通关进度清单（学习路径页"还差哪件事"） ──
import { stage1Checklist } from '../js/core/progress.js';

const U4WORDS = [
  ...['pencil', 'ruler', 'eraser', 'dictionary', 'glue', 'brush', 'notebook', 'blackboard', 'borrow'].map((w) => ({ w, tier: 'four' })),
  ...['use', 'English book', 'Chinese book'].map((w) => ({ w, tier: 'read' })),
];

test('进度清单：全新进度 → 三项全未完成，文案给引导', () => {
  const rows = stage1Checklist({ words: U4WORDS }, defaultUnitProgress());
  assert.deepEqual(rows.map((r) => r.done), [false, false, false]);
  assert.match(rows[0].text, /单词点亮 0\/12/);
  assert.match(rows[1].text, /还没测/);
  assert.match(rows[2].text, /四会拼写 0\/9/);
  assert.ok(rows.every((r) => r.hint && r.hint.length > 4), '每项都要有去哪做的引导');
});

test('进度清单：只点亮了词 → 点亮✓，听辨/拼写仍⬜（这就是"练习做完了却进不了句型"的典型态）', () => {
  const p = { ...defaultUnitProgress(), wordsDone: U4WORDS.map((w) => w.w) };
  const rows = stage1Checklist({ words: U4WORDS }, p);
  assert.deepEqual(rows.map((r) => r.done), [true, false, false]);
});

test('进度清单：听辨 60% 显示百分比且未达标，80% 达标', () => {
  const p = { ...defaultUnitProgress(), wordsDone: U4WORDS.map((w) => w.w), listenScore: 0.6, spellingDone: U4WORDS.filter((w) => w.tier === 'four').map((w) => w.w) };
  const rows = stage1Checklist({ words: U4WORDS }, p);
  assert.match(rows[1].text, /60%/);
  assert.equal(rows[1].done, false);
  const rows2 = stage1Checklist({ words: U4WORDS }, { ...p, listenScore: 0.8 });
  assert.equal(rows2[1].done, true);
  assert.match(rows2[1].text, /80%/);
});

test('进度清单：三项全达标 → 全✓（此时 Stage1 应自动通关）', () => {
  const p = {
    ...defaultUnitProgress(),
    wordsDone: U4WORDS.map((w) => w.w),
    listenScore: 1,
    spellingDone: U4WORDS.filter((w) => w.tier === 'four').map((w) => w.w),
  };
  const rows = stage1Checklist({ words: U4WORDS }, p);
  assert.ok(rows.every((r) => r.done), '三项应全部✓');
  // 与通关判定联动：这个进度应判 Stage1 通过
  assert.equal(isStage1Passed(p, { wordTotal: 12, spellingTotal: 9 }), true);
});
