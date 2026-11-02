import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateUnit } from '../js/core/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, '../data/units/u5.json'), 'utf8'));

test('u5.json 通过校验', () => {
  const r = validateUnit(raw);
  assert.equal(r.valid, true, `校验失败: ${r.errors.join(' | ')}`);
  assert.deepEqual(r.errors, []);
});

test('u5.json 内容与存档一致：12 词、四会 5、认读 7', () => {
  assert.equal(raw.words.length, 12);
  const four = raw.words.filter((w) => w.tier === 'four').map((w) => w.w);
  const read = raw.words.filter((w) => w.tier === 'read').map((w) => w.w);
  assert.deepEqual(four.sort(), ['feed', 'hold', 'may', 'pet', 'rabbit']);
  assert.equal(read.length, 7);
  assert.ok(read.includes('goldfish'));
  assert.ok(read.includes('parrot'));
});

test('u5.json 含 4 个故事（Dongdong/鹦鹉/导盲犬/Ben&Mia）', () => {
  assert.equal(raw.stories.length, 4);
  const ids = raw.stories.map((s) => s.id).sort();
  assert.deepEqual(ids, ['A', 'D', 'F', 'X']);
});

test('ou 例词包含 mouse/mouth/cloud/south', () => {
  ['mouse', 'mouth', 'cloud', 'south'].forEach((w) => {
    assert.ok(raw.phonics.words.includes(w), `缺少 ${w}`);
  });
});

test('微测题目 answer 全部在 options 范围内', () => {
  raw.quiz.forEach((q) => {
    assert.ok(q.answer >= 0 && q.answer < q.options.length, `${q.id} answer 越界`);
  });
});

test('缺少 words 字段 → 报错并指明字段', () => {
  const bad = { ...raw };
  delete bad.words;
  const r = validateUnit(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('words:')));
});

test('tier 非法值 → 报错', () => {
  const bad = structuredClone(raw);
  bad.words[0].tier = 'three';
  const r = validateUnit(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('words[0].tier')));
});

test('quiz answer 越界 → 报错', () => {
  const bad = structuredClone(raw);
  bad.quiz[0].answer = 99;
  const r = validateUnit(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('quiz[0].answer')));
});

test('非对象数据 → 报错', () => {
  const r = validateUnit(null);
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 1);
});
