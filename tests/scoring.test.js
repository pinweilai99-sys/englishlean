import test from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, similarity, scorePronunciation, applyMisheardFix, normalizeSpoken, scoreFeedback } from '../js/core/scoring.js';

test('levenshtein 距离正确', () => {
  assert.equal(levenshtein('rabbit', 'rabbit'), 0);
  assert.equal(levenshtein('rabbit', 'rabit'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('similarity 在 0~1 之间且同词为 1', () => {
  assert.equal(similarity('may', 'may'), 1);
  assert.equal(similarity('may', ''), 0);
  const s = similarity('rabbit', 'rabit');
  assert.ok(s > 0.8 && s < 1);
});

test('完全一致 → 100 分且 matched', () => {
  const r = scorePronunciation('rabbit', 'rabbit');
  assert.equal(r.score, 100);
  assert.equal(r.level, 'good');
  assert.equal(r.matched, true);
});

test('近音误写命中容错表 → 高分', () => {
  const r = scorePronunciation('rabbit', 'rabit');
  assert.equal(r.level, 'good');
  assert.equal(r.matched, true);
  assert.ok(r.score >= 80);
});

test('完全无关 → 低分且不 matched', () => {
  const r = scorePronunciation('rabbit', 'elephant');
  assert.equal(r.matched, false);
  assert.ok(r.score < 50);
});

test('空语音 → 返回 no-speech，不误判为 0 分错误', () => {
  const r = scorePronunciation('rabbit', '');
  assert.equal(r.reason, 'no-speech');
  assert.equal(r.level, 'retry');
  assert.match(scoreFeedback(r), /没听清/);
});

test('整句中包含目标词 → contains 高分', () => {
  const r = scorePronunciation('rabbit', 'May I have a rabbit');
  assert.equal(r.reason, 'contains');
  assert.ok(r.score >= 90);
});

test('normalizeSpoken 去标点与多余空格', () => {
  assert.equal(normalizeSpoken('  Yes,  you can! '), 'yes you can');
});

test('applyMisheardFix 修正常见错写', () => {
  assert.equal(applyMisheardFix('gold fis'), 'goldfish');
  assert.equal(applyMisheardFix('parrott'), 'parrot');
});

test('反馈文案为鼓励型（不出现否定评价）', () => {
  const good = scoreFeedback(scorePronunciation('may', 'may'));
  assert.match(good, /很棒/);
  const partial = scoreFeedback(scorePronunciation('may', 'my'));
  assert.match(partial, /再来|更/);
});
