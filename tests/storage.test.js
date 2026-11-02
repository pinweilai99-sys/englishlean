import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, CURRENT_VERSION, defaultState, defaultUnitProgress,
  loadState, saveState, exportState, importState, resetState,
  createMemoryStorage, mergeState, migrate,
} from '../js/core/storage.js';

test('首次读取返回默认结构', () => {
  const s = createMemoryStorage();
  const state = loadState(s);
  assert.equal(state.version, CURRENT_VERSION);
  assert.equal(state.stars, 0);
  assert.equal(state.streak, 0);
  assert.deepEqual(state.progress, {});
  assert.deepEqual(state.wrongBank, []);
  assert.deepEqual(state.reviewPlan, []);
  assert.equal(state.settings.audioOn, true);
});

test('写入后读取一致', () => {
  const s = createMemoryStorage();
  const state = defaultState();
  state.stars = 12;
  state.progress.u5 = { ...defaultUnitProgress(), wordsDone: ['may', 'pet'], stagePassed: [true, false, false, false] };
  saveState(s, state);
  const loaded = loadState(s);
  assert.equal(loaded.stars, 12);
  assert.deepEqual(loaded.progress.u5.wordsDone, ['may', 'pet']);
  assert.deepEqual(loaded.progress.u5.stagePassed, [true, false, false, false]);
});

test('缺字段自动补齐，且不丢已有字段', () => {
  const s = createMemoryStorage();
  s.setItem(STORAGE_KEY, JSON.stringify({ stars: 5, progress: { u5: { wordsDone: ['may'] } } }));
  const loaded = loadState(s);
  assert.equal(loaded.stars, 5);
  assert.deepEqual(loaded.progress.u5.wordsDone, ['may']);
  // 缺失字段补默认值
  assert.deepEqual(loaded.progress.u5.stagePassed, [false, false, false, false]);
  assert.equal(loaded.progress.u5.quizBest, null);
  assert.equal(loaded.settings.audioOn, true);
});

test('版本高于当前 → 导入报错且不覆盖本地数据', () => {
  const s = createMemoryStorage();
  saveState(s, { ...defaultState(), stars: 7 });
  const backup = JSON.stringify({ version: CURRENT_VERSION + 1, stars: 999 });
  const res = importState(s, backup);
  assert.equal(res.ok, false);
  assert.match(res.error, /版本/);
  // 本地数据未被覆盖
  assert.equal(loadState(s).stars, 7);
});

test('导出的 JSON 可被导入还原（字段级一致）', () => {
  const s = createMemoryStorage();
  const state = defaultState();
  state.stars = 33;
  state.streak = 4;
  state.wrongBank = [{ unit: 'u5', type: 'listen_choice', q: 'x', a: 'y' }];
  state.progress.u5 = { ...defaultUnitProgress(), wordsDone: ['rabbit'], listenScore: 0.9 };
  saveState(s, state);

  const backup = exportState(state);
  const s2 = createMemoryStorage();
  const res = importState(s2, backup);
  assert.equal(res.ok, true);
  const back = loadState(s2);
  assert.equal(back.stars, 33);
  assert.equal(back.streak, 4);
  assert.equal(back.wrongBank.length, 1);
  assert.deepEqual(back.progress.u5.wordsDone, ['rabbit']);
  assert.equal(back.progress.u5.listenScore, 0.9);
});

test('非法 JSON 导入返回错误，不抛异常', () => {
  const s = createMemoryStorage();
  const res = importState(s, '{ not json');
  assert.equal(res.ok, false);
  assert.match(res.error, /JSON/);
});

test('重置后回到默认状态', () => {
  const s = createMemoryStorage();
  saveState(s, { ...defaultState(), stars: 99 });
  assert.equal(loadState(s).stars, 99);
  const after = resetState(s);
  assert.equal(after.stars, 0);
  assert.equal(s.getItem(STORAGE_KEY), null);
});

test('损坏的存储内容不会导致崩溃', () => {
  const s = createMemoryStorage();
  s.setItem(STORAGE_KEY, '{broken');
  const state = loadState(s);
  assert.equal(state.stars, 0);
  assert.deepEqual(state.progress, {});
});

test('mergeState 不覆盖已有 settings', () => {
  const merged = mergeState({ settings: { audioOn: false } });
  assert.equal(merged.settings.audioOn, false);
  assert.equal(merged.version, CURRENT_VERSION);
});

test('migrate 把旧版本提升到当前版本', () => {
  const m = migrate({ version: 0, stars: 3 });
  assert.equal(m.version, CURRENT_VERSION);
  assert.equal(m.stars, 3);
});
