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

test('考点微测覆盖同步优学 I–X 十类题型 + ou 语音（U5 真考点）', () => {
  const families = new Set(raw.quiz.map((q) => q.id.replace(/\d+$/, '')));
  const want = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  want.forEach((f) => assert.ok(families.has(f), `考点微测缺少题型 ${f}`));
  assert.ok(families.has('P'), '缺少 ou 语音题（P 类，U5 语音考点）');
  // III（听短语选词填空）与 VI（选词填空）必须有题，且各带正确英语文本
  const iii = raw.quiz.filter((q) => q.id.startsWith('III'));
  const vi = raw.quiz.filter((q) => q.id.startsWith('VI'));
  assert.ok(iii.length >= 1, '缺少 III 听短语选词填空');
  assert.ok(iii.every((q) => typeof q.speak === 'string' && q.speak.length > 0), 'III 每题必须有听短语文本 speak');
  assert.ok(vi.length >= 1, '缺少 VI 选词填空');
  assert.ok(vi.every((q) => !('speak' in q)), 'VI 选词填空不需音频（纯阅读填空）');
});

test('II1 硬错已修复：听 pet shop 答案应为宠物店🏪（非银行🏦）', () => {
  const q = raw.quiz.find((x) => x.id === 'II1');
  assert.equal(q.options[q.answer], '🏪 宠物店', 'II1 正确答案应是宠物店');
  assert.ok(!q.options.includes('🏦'), 'II1 选项不应再含银行🏦');
});

test('IV 类已改回近音辨析且覆盖四会动词 feed/touch', () => {
  const iv = raw.quiz.filter((q) => q.id.startsWith('IV'));
  assert.equal(iv.length, 5, 'IV 类应补齐到 5 题');
  const words = iv.map((q) => q.options[q.answer]);
  assert.ok(words.includes('feed'), 'IV 应覆盖 feed（四会动词）');
  assert.ok(words.includes('touch'), 'IV 应覆盖 touch（二会动词）');
  assert.ok(words.includes('mouse'), 'IV 应覆盖 mouse≠mouth 近音辨析');
});

test('II/VII/VIII/IX/X 各类补齐到各 5 题（除 IX 仿写 3 宠、X 阅读 4 题）', () => {
  // 精确前缀匹配（避免 II 误匹配 III、VII 误匹配 VIII）
  const cnt = (f) => raw.quiz.filter((q) => new RegExp('^' + f + '\\d').test(q.id)).length;
  assert.equal(cnt('II'), 5, 'II 听音选图应 5 题');
  assert.equal(cnt('VII'), 5, 'VII 图句判断应 5 题');
  assert.equal(cnt('VIII'), 5, 'VIII 情景交际应 5 题');
  assert.ok(cnt('IX') >= 3, 'IX 仿写至少覆盖 3 种宠物');
  assert.ok(cnt('X') >= 4, 'X 阅读至少 4 题');
});

test('听音选词：12 个单元单词逐词出现（每词都是一题的目标词）', () => {
  const targets = raw.listenPairs.map((p) => p[0]);
  assert.equal(raw.listenPairs.length, raw.words.length, '题数应等于单词数');
  raw.words.forEach((w) => {
    assert.ok(targets.includes(w.w), `单词 ${w.w} 未出现在听音选词中`);
  });
  // 干扰词不能与目标词相同（否则二选一无意义）
  raw.listenPairs.forEach(([t, d]) => assert.notEqual(t, d, `${t} 的干扰词不能是自身`));
});

test('记词分块：每词都有 chunks（分块字母拼合=单词本身）与非空 memo 记忆提示', () => {
  raw.words.forEach((w) => {
    assert.ok(Array.isArray(w.chunks) && w.chunks.length >= 1, `${w.w} 缺少 chunks`);
    const joined = w.chunks.join('').toLowerCase().replace(/[^a-z]/g, '');
    assert.equal(joined, w.w.toLowerCase().replace(/[^a-z]/g, ''),
      `${w.w} 的分块 ${JSON.stringify(w.chunks)} 拼合后应等于单词本身`);
    assert.equal(typeof w.memo, 'string');
    assert.ok(w.memo.trim().length >= 6, `${w.w} 的 memo 记忆提示不应为空`);
  });
  // 分块数>1 的词应覆盖多音节/合成词/后缀词
  const multi = raw.words.filter((w) => w.chunks.length > 1).map((w) => w.w);
  for (const need of ['rabbit', 'lovely', 'goldfish', 'clever', 'parrot']) {
    assert.ok(multi.includes(need), `${need} 应有多块拆分`);
  }
});

test('音标必须与课本词表逐词一致（2026-11-03 家长定版：以课本英式音标为准）', () => {
  // 课本 Unit 5 词表逐词音标（2026-11-03 家长拍照核对，勿改动）
  const BOOK = {
    may: '/meɪ/', pet: '/pet/', Mrs: '/ˈmɪsɪz/', rabbit: '/ˈræbɪt/',
    lovely: '/ˈlʌvli/', hold: '/həʊld/', goldfish: '/ˈgəʊldfɪʃ/', feed: '/fiːd/',
    clever: '/ˈklevə(r)/', shop: '/ʃɒp/', parrot: '/ˈpærət/', back: '/bæk/',
  };
  const ipa = Object.fromEntries(raw.words.map((w) => [w.w, w.ipa]));
  for (const [w, want] of Object.entries(BOOK)) {
    assert.equal(ipa[w], want, `${w} 的音标必须与课本一致（课本 ${want}）`);
  }
  // 反向对照：昨天误改的美音记法必须不存在（证明口径确实已切回课本）
  assert.notEqual(ipa.hold, '/hoʊld/', '不得使用美音 /oʊ/ 记法');
  assert.notEqual(ipa.shop, '/ʃɑːp/', '不得使用美音 /ɑː/ 记法');
  assert.notEqual(ipa.clever, '/ˈklevər/', '不得使用美音卷舌 /ər/ 记法');
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
