import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateUnit } from '../js/core/validate.js';
import { audioSlug } from '../js/services/audio.js';
import { chunkSay } from '../js/core/phonics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, '../data/units/u5.json'), 'utf8'));
const audioSlugs = new Set(JSON.parse(readFileSync(join(__dirname, '../assets/audio/manifest.json'), 'utf8')).slugs);

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

test('拼读拆分 split（2026-11-06 家长提问新增）：每词都有、拼合=单词本身', () => {
  raw.words.forEach((w) => {
    assert.ok(Array.isArray(w.split) && w.split.length >= 1, `${w.w} 缺少 split 拼读拆分`);
    const joined = w.split.join('').toLowerCase().replace(/[^a-z]/g, '');
    assert.equal(joined, w.w.toLowerCase().replace(/[^a-z]/g, ''),
      `${w.w} 的拼读拆分 ${JSON.stringify(w.split)} 拼合后应等于单词本身`);
    w.split.forEach((p, i) => {
      assert.equal(typeof p, 'string', `${w.w}.split[${i}] 应为字符串`);
      assert.ok(p.trim().length > 0, `${w.w}.split[${i}] 不应为空`);
    });
  });
  // 关键回归点：may 原先 chunks=['may']（整词当一块，等于没拆），
  // 现在必须拆出真实的拼读结构 m + ay，否则"拼读拆分"对单音节词毫无意义。
  const may = raw.words.find((w) => w.w === 'may');
  assert.deepEqual(may.split, ['m', 'ay'], 'may 应拆成 m + ay（提示里写明"单音节 m-ay"）');
  const pet = raw.words.find((w) => w.w === 'pet');
  assert.deepEqual(pet.split, ['p', 'e', 't'], 'pet 应拆成 p + e + t（提示里写明"三个字母各读各的音"）');
  // 多音节词的拼读拆分应与音节级音块一致（音节=可独立发音的块）
  raw.words.forEach((w) => {
    if (w.chunks.length > 1) {
      assert.deepEqual(w.split, w.chunks, `${w.w} 的 split 应与音节级 chunks 一致`);
    }
  });
  // Mrs 是尊称缩写，按单词整体记（拆成 M-r-s 会教错）
  const mrs = raw.words.find((w) => w.w === 'Mrs');
  assert.deepEqual(mrs.split, ['Mrs'], 'Mrs 应按整体记，不拆成字母');
});

test('拼读拆分不引入超纲朗读文本：只有音节级音块才有预生成音频，单字母不单独发音', () => {
  // 自然拼读的经典陷阱：单字母交给 TTS 会被念成字母名（em / ay），
  // 教成"念字母名"而不是"读音"。因此拆音阶段只念音节级音块。
  // 分块朗读走重拼写（chunkSay）：显示真实字母，朗读用重拼写后的文本，
  // 所以预生成音频的 slug 必须按 chunkSay(text) 查，而非原始字母。
  raw.words.forEach((w) => {
    (w.chunks || []).forEach((c) => {
      const slug = audioSlug(chunkSay(String(c).toLowerCase()));
      assert.ok(audioSlugs.has(slug), `${w.w} 的音块「${c}」(重拼写 ${chunkSay(String(c).toLowerCase())}) 缺预生成音频（拆音阶段要念它）`);
    });
  });
  // 反向对照：单字母拆分块（m/ay/p/e/t…）**不应**被当成可朗读音块
  const letterSplits = raw.words.flatMap((w) => (w.split || []).filter((p) => p.length === 1));
  assert.ok(letterSplits.length > 0, '应有单字母拆分块（may=m+ay 等）');
  raw.words.forEach((w) => {
    (w.split || []).forEach((p) => {
      if (p.length === 1) {
        assert.ok(!w.chunks.includes(p),
          `${w.w} 的单字母拆分「${p}」不应同时出现在 chunks（否则会被单独念成字母名）`);
      }
    });
  });
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

test('II5 听音选图与核心词一致：speak 应为 goldfish（不含超纲 bowl），题干为金鱼', () => {
  const q = raw.quiz.find((x) => x.id === 'II5');
  assert.equal(q.speak, 'goldfish', 'II5 应读教材核心词 goldfish，而非 a goldfish bowl');
  assert.equal(q.prompt, '听音选图：金鱼', 'II5 题干应与选项/音频一致（金鱼）');
});

test('rc3 听答反推问题：No, you can\'t. 对应 May I touch him?（导盲犬故事）', () => {
  const c = raw.reviewCards.find((x) => x.id === 'rc3');
  assert.equal(c.speak, "No, you can't.", 'rc3 听句应为 No, you can\'t.');
  assert.equal(c.answer, 'May I touch him?', 'rc3 反推问题应对应导盲犬故事里的 May I touch him?');
});

// ── 应答配对：题型效度（同一问句不得把课本认可的另一句答语判错）────────────
// 课本 B/C 部分：May I ...? 的答语由「情境（点头/摇头）」决定，Yes/No 两句都合法。
// 因此每题必须给出 cue，且干扰项只能是「主语错位」或「与 cue 极性冲突」的真错项。
function expectedSubject(q) {
  if (q.startsWith('May I')) return 'you';
  if (q.startsWith('Can you')) return 'I';
  if (q.startsWith('Can he')) return 'he';
  return '?';
}
function answerSubject(q, a) {
  if (q.startsWith('May I') && a.startsWith('Sure.')) return 'you';
  if (/\bhe\b/.test(a)) return 'he';
  if (/\bI\b/.test(a)) return 'I';
  if (/\byou\b/.test(a)) return 'you';
  return '?';
}
function answerPolarity(a) {
  return /^No\b|can't/.test(a) ? 'no' : 'yes';
}
function defensible(q, a, cue) {
  return answerSubject(q, a) === expectedSubject(q) && answerPolarity(a) === cue;
}
function findDefensibleDistractors(dialogues) {
  const bad = [];
  for (const [animal, pairs] of Object.entries(dialogues)) {
    for (const p of pairs) {
      const tag = `${animal}|${p.q}`;
      if (p.cue !== 'yes' && p.cue !== 'no') bad.push(`${tag}: 缺 cue 情境线索`);
      if (!p.cueZh) bad.push(`${tag}: 缺 cueZh`);
      if (!p.rule) bad.push(`${tag}: 缺 rule 规则解说`);
      // 英语必有播放铁律：中文解说区不得混入无 🔊 音频的英文文本
      if (/[A-Za-z]/.test(p.rule || '') || /[A-Za-z]/.test(p.cueZh || '')) {
        bad.push(`${tag}: cueZh/rule 含英文却无 🔊，违反英语必有播放铁律`);
      }
      if (!p.opts.includes(p.a)) bad.push(`${tag}: 正确答案不在选项内`);
      if (new Set(p.opts).size !== p.opts.length) bad.push(`${tag}: 选项重复`);
      if (!defensible(p.q, p.a, p.cue)) bad.push(`${tag}: 正确答案本身不可辩护`);
      for (const o of p.opts) {
        if (o !== p.a && defensible(p.q, o, p.cue)) bad.push(`${tag}: 合法答语被判错 -> ${o}`);
      }
    }
  }
  return bad;
}

test('应答配对 12 题：每题有情境线索，且不存在「合法答语被判错」', () => {
  const dlg = raw.sentences.dialogues;
  const total = Object.values(dlg).reduce((n, ps) => n + ps.length, 0);
  assert.equal(total, 12, '应答配对应保持 12 题（6 动物 × 2 题）');
  assert.deepEqual(findDefensibleDistractors(dlg), [], '不应存在多个可辩护答案');
});

test('效度检测器有效：把旧版合法干扰项 Sure. 塞回肯定题，必须被检出（防止测试摆设）', () => {
  const dlg = structuredClone(raw.sentences.dialogues);
  dlg.pet[0].opts = ['Yes, you can.', "No, you can't.", 'Sure.'];
  const bad = findDefensibleDistractors(dlg);
  assert.ok(bad.some((x) => x.includes('Sure.')), '检测器应能发现旧版多解缺陷');
});

test('截图两题防退化：goldfish 组的情境线索与真错干扰项', () => {
  const gf = raw.sentences.dialogues.goldfish;
  const q1 = gf.find((p) => p.q === 'May I have a goldfish?');
  // 前置：课本 C 部分 Yes/No 两解并列 → 必须给「摇头」线索，答案才唯一
  assert.equal(q1.cue, 'no', '金鱼题必须给摇头线索，否则 Yes, you can. 也是合法答语');
  assert.equal(q1.a, "No, you can't. But you can feed it.");
  assert.ok(q1.opts.includes('Yes, you can.'), '红框里的 Yes, you can. 保留为干扰项');
  assert.equal(defensible(q1.q, 'Yes, you can.', q1.cue), false,
    '有摇头线索后，Yes, you can. 因极性冲突成为明确错项（不是「也对」）');
  const q2 = gf.find((p) => p.q === 'May I feed it?');
  assert.equal(q2.cue, 'yes');
  assert.equal(q2.a, 'Sure.');
  assert.ok(q2.opts.includes('OK. Yes, I can.'), '红框 2 的主语错位项保留');
  assert.equal(answerSubject(q2.q, 'OK. Yes, I can.'), 'I');
  assert.equal(expectedSubject(q2.q), 'you', 'May I 问句应答主语必须是 you');
});

// ── 本单元语法知识点进孩子侧（需求变更：语法不再只归家长中心）────────────
test('需求变更正反对照：语法归纳卡已进孩子侧，家长深度参考卡保留且超纲点未下沉', () => {
  // 前置断言：证明旧规格仍在、只是被扩展（不是把家长卡删了搬过来）
  assert.equal(raw.grammar.parentCard.length, 6, '家长中心 6 条深度参考卡必须保留');
  const cards = raw.grammar.childCards;
  assert.ok(Array.isArray(cards) && cards.length === 3, '孩子侧应有 3 条本单元规律归纳卡');
  // 新规格：孩子侧只讲本单元句型能直接看出的规律，超纲语法点仍只在家长侧
  const childText = cards.map((c) => `${c.title}${c.note}`).join('');
  assert.ok(!/三单|进行时|宾格/.test(childText), '三单/进行时/宾格等超纲点不得下沉给孩子');
  assert.match(childText, /问「.*吗」，答/, '孩子侧应聚焦本单元一问一答的主语互换');
});

test('孩子侧语法卡铁律：中文规律区无裸英文，英文例句均有预生成音频', () => {
  for (const c of raw.grammar.childCards) {
    assert.ok(c.title && c.note && c.q && c.a, '每条规律需有标题/说明/一问一答例句');
    assert.ok(!/[A-Za-z]/.test(c.title), `规律标题不得含无 🔊 英文：${c.title}`);
    assert.ok(!/[A-Za-z]/.test(c.note), `规律说明不得含无 🔊 英文：${c.note}`);
    for (const t of [c.q, c.a]) {
      const slug = audioSlug(t);
      assert.ok(audioSlugs.has(slug), `例句缺预生成音频清单：${t}`);
      assert.ok(existsSync(join(__dirname, '../assets/audio', `${slug}.m4a`)), `例句音频文件缺失：${t}`);
    }
  }
});

// ── 手机端版式适配（2026-11-06 家长需求"内容都不变，页面改成方便手机阅览的版本"）──
// 说明：Chrome 在部分沙箱环境无法启动（GPU 进程崩溃），无法做真机截图回归，
// 因此本组用「CSS 静态断言 + 盒模型算术」锁死关键的手机端约束。
//
// ⚠️ 生效位置：手机端区块**内联在 styles/app.css 末尾**，不单独引 mobile.css。
// 原因：GitHub Pages 的 CDN 对**新增文件**收录极慢（实测 >7 分钟仍 404），
// 新文件 404 会让整次上线看起来"没生效"；改存量文件 app.css 则 1-3 分钟即刷新。
// styles/mobile.css 保留为独立可维护源文件，由 scripts/sync-mobile-css.py 同步。
test('手机端适配：样式已内联进 app.css（避免新增文件 CDN 404 拖垮上线）', () => {
  const app = readFileSync(join(__dirname, '../styles/app.css'), 'utf8');
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  assert.match(app, /手机端版式适配（2026-11-06）/,
    'app.css 必须包含手机端区块（CDN 对新增文件收录慢，改存量文件才稳）');
  assert.match(app, /@media \(max-width: 640px\)/,
    'app.css 必须包含手机端断点');
  // 不得再单独引用 mobile.css（否则它 404 时浏览器会报一串错误）
  assert.doesNotMatch(html, /styles\/mobile\.css/,
    'index.html 不应再单独引用 mobile.css（新增文件 CDN 未收录时会 404）');
  // 同步脚本必须存在（保证源文件与生效副本不会漂移）
  assert.ok(existsSync(join(__dirname, '../scripts/sync-mobile-css.py')),
    'scripts/sync-mobile-css.py 必须存在（mobile.css → app.css 的同步脚本）');
});

test('手机端适配：源文件与生效副本一致（sync-mobile-css.py 可重复执行且幂等）', () => {
  const mob = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8').trim();
  const app = readFileSync(join(__dirname, '../styles/app.css'), 'utf8');
  assert.ok(app.includes(mob),
    'app.css 的手机端区块必须与 styles/mobile.css 内容一致（跑 sync-mobile-css.py 同步）');
});

test('手机端适配：核心内容一个都没少（只改版式，不改内容）', () => {
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  // 不得用 display:none 隐藏学习内容
  const hidden = css.match(/display\s*:\s*none/g) || [];
  // 唯一允许的用途：隐藏横向滚动条（.tabbar::-webkit-scrollbar）
  const hideScrollbar = (css.match(/::-webkit-scrollbar[^{]*\{[^}]*display\s*:\s*none/g) || []).length;
  assert.equal(hidden.length - hideScrollbar, 0,
    '手机端样式不得隐藏内容（发现 ' + (hidden.length - hideScrollbar) + ' 处 display:none）');
  // 字号绝对下限 11px（低于此值孩子看不清）；次要内容（记词分块/拼读拆分）可到此下限
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const tooSmall = sizes.filter((s) => s > 0 && s < 11);
  assert.equal(tooSmall.length, 0, '手机端字号不得小于 11px（绝对可读底线），发现：' + tooSmall.join(','));
});

test('手机端适配：次要内容（记词分块/拼读拆分/记忆提示）已降级为小字，明显小于单词主体', () => {
  // 2026-11-06 家长本轮要求："那边不是重点的内容变成小字，比如记词分块/拼读拆分的字变小点"。
  // 用静态断言锁死：这些次要元素的字号必须是显式的小字，且 < 单词主体 word-text 的字号。
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  const num = (re) => { const m = css.match(re); return m ? Number(m[1]) : null; };
  // 单词主体字号取自 ≤640 断点的 --fs-xxl（本文件为 30px）
  const xxl = num(/:root\s*\{[^}]*--fs-xxl:\s*(\d+)px/);
  assert.ok(xxl, '应能从 :root 读出单词主体字号 --fs-xxl');
  const pairs = [
    ['.memo-title', /\.memo-title\s*\{[^}]*font-size:\s*(\d+)px/],
    ['.split-title', /\.split-title\s*\{[^}]*font-size:\s*(\d+)px/],
    ['.memo-hint', /\.memo-hint\s*\{[^}]*font-size:\s*(\d+)px/],
    ['.chunk-btn', /\.chunk-btn\s*\{[^}]*font-size:\s*(\d+)px/],
    ['.split-piece', /\.split-piece\s*\{[^}]*font-size:\s*(\d+)px/],
  ];
  for (const [name, re] of pairs) {
    const v = num(re);
    assert.ok(v != null, `${name} 必须显式设成小字（font-size: Npx）`);
    assert.ok(v < xxl, `${name}（${v}px）必须小于单词主体 word-text（${xxl}px），即降级为小字`);
  }
});

test('手机端适配：可点区域满足儿童手指精度（≥44px）', () => {
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  const tap = css.match(/--tap:\s*(\d+)px/);
  assert.ok(tap, 'mobile.css 必须覆盖 --tap');
  assert.ok(Number(tap[1]) >= 44, '--tap 应 ≥44px，实际 ' + tap[1] + 'px');
  // 可点元素（按钮/选项/输入框/浮窗按钮）的 min-height 不得低于 44px；
  // 纯展示元素（如 .step 步骤标签）不受此限。
  const clickable = ['.btn', '.option', '.text-input', '.fab', '.icon-btn', '.tab'];
  for (const sel of clickable) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*min-height:\\s*(\\d+)px');
    const m = css.match(re);
    if (m) {
      assert.ok(Number(m[1]) >= 44,
        sel + ' 的 min-height 不得低于 44px（儿童手指精度），实际 ' + m[1] + 'px');
    }
  }
});

test('手机端适配：安全区适配齐全（刘海屏 + 底部横条）', () => {
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  assert.match(css, /env\(safe-area-inset-top/, '顶栏必须避让刘海（safe-area-inset-top）');
  assert.match(css, /env\(safe-area-inset-bottom/, '底部必须避让横条（safe-area-inset-bottom）');
  // 底部浮窗是 fixed，若内容区 padding 没算上横条，横条会盖住最后一行内容
  const mainPad = css.match(/\.app-main\s*\{[^}]*padding:[^;]*env\(safe-area-inset-bottom/);
  assert.ok(mainPad, '.app-main 的底部 padding 必须计入 safe-area-inset-bottom（否则内容被横条盖住）');
});

test('手机端适配：360px 小屏不横向溢出（盒模型算术）', () => {
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  const num = (re, dflt) => {
    const m = css.match(re);
    return m ? Number(m[1]) : dflt;
  };
  const screenW = 360;
  const mainPadX = num(/\.app-main\s*\{[^}]*padding:\s*[\d.]+px\s+([\d.]+)px/, 8);
  const contentW = screenW - mainPadX * 2;
  assert.ok(contentW > 300, '内容区宽度应足够（' + contentW + 'px）');
  // 主按钮独占一行 → 不会并排挤爆
  assert.match(css, /\.btn-row \.btn\s*\{[^}]*flex:\s*1 1 100%/, '主按钮在手机上应独占一行');
  // 单元卡单列 → 每格宽度 = 内容宽，不会被挤成竖条
  assert.match(css, /\.unit-grid\s*\{\s*grid-template-columns:\s*1fr/, '单元卡在手机上应为单列（长标题不再挤压）');
  // 单词进度点允许换行（flex-wrap 已开），但单个点不能过大
  const dot = num(/\.word-dot\s*\{[^}]*width:\s*(\d+)px/, 22);
  assert.ok(dot <= 26, '单词进度点直径应 ≤26px（12 个才排得下），实际 ' + dot + 'px');
  // 单词图不能太大（否则一屏只剩一张图）
  const pic = num(/\.word-pic\s*\{[^}]*font-size:\s*(\d+)px/, 66);
  assert.ok(pic <= 70, '单词图片字号应 ≤70px（手机上别把一屏占满），实际 ' + pic + 'px');
});

test('手机端适配：长文本可换行（英文例句/故事不横向滚动）', () => {
  const css = readFileSync(join(__dirname, '../styles/mobile.css'), 'utf8');
  assert.match(css, /overflow-wrap:\s*anywhere/, '必须允许长文本换行（避免横向滚动）');
  assert.match(css, /word-break:\s*break-word/, '必须允许长单词折行');
  assert.match(css, /\.modal\s*\{[^}]*max-height/, '弹层必须限制高度（手机上超出会难滚动）');
});

// ---------- Unit 4（湘少版，按 U5 同 schema 创建，2026-11-08） ----------
const u4 = JSON.parse(readFileSync(join(__dirname, '../data/units/u4.json'), 'utf8'));

test('u4.json 通过校验', () => {
  const r = validateUnit(u4);
  assert.equal(r.valid, true, '校验失败: ' + r.errors.join(' | '));
  assert.deepEqual(r.errors, []);
});

test('u4.json 内容与课本/同步优学一致：12 词、四会 9、认读 3', () => {
  assert.equal(u4.words.length, 12);
  const four = u4.words.filter((w) => w.tier === 'four').map((w) => w.w);
  const read = u4.words.filter((w) => w.tier === 'read').map((w) => w.w);
  assert.equal(four.length, 9, 'U4 四会词应为 9');
  assert.equal(read.length, 3, 'U4 认读词应为 3（use / English book / Chinese book）');
  assert.ok(read.includes('use'));
  assert.ok(read.includes('English book'));
});

test('u4.json 含 3 个故事（Kaikai 做风筝 / Dino 借东西 / Emma 魔法书包）', () => {
  // 前置（证明行为已变化）：旧版只有 D/F 两个故事，IX 绘本缺失导致微测 IX 题无原文可读。
  assert.equal(u4.stories.length, 3, '应为 3 个故事（旧版 2 个，IX 绘本已补）');
  const ids = u4.stories.map((s) => s.id).sort();
  assert.deepEqual(ids, ['D', 'F', 'IX']);
  u4.stories.forEach((s) => assert.ok(Array.isArray(s.lines) && s.lines.length > 0, s.id + ' 必须有 lines'));
});

test('u4.json 故事说话人标注正确（2026-11-08 审计修复）', () => {
  const dino = u4.stories.find((s) => s.id === 'D');
  const kite = u4.stories.find((s) => s.id === 'F');
  // 前置（证明行为已变化）：旧版 D 篇把「同伴对 Dino 说的话」标成了 Dino 自己说。
  assert.equal(dino.lines[0].who, '🧒 同伴', 'D 篇第 1 句是同伴对 Dino 说，不应标 Dino');
  assert.equal(dino.lines[1].who, '🦖 Dino', '"Sure." 应是 Dino 回答');
  // "Thank you all." 是 Kaikai 说的（旧版误标 Xiaoxiao）。
  const thanks = kite.lines.find((l) => l.t.includes('Thank you all'));
  assert.ok(thanks, 'F 篇应有 Thank you all 一句');
  assert.equal(thanks.who, '🧒 Kaikai', 'Thank you all 是 Kaikai 说的');
  // "Hello, my friends!"（机器人）与 "Thank you, Tim."（同伴）必须分行，不得合并。
  const hello = dino.lines.find((l) => l.t.includes('Hello, my friends'));
  assert.ok(hello && !hello.t.includes('Thank'), '机器人问好不应与感谢句合并成一行');
  assert.ok(dino.lines.some((l) => l.t === 'Thank you, Tim.'), '感谢 Tim 应为独立一行');
  // Emma 绘本（IX）须含魔法铅笔情节（与微测 IX5 对应）。
  const emma = u4.stories.find((s) => s.id === 'IX');
  assert.ok(/sharpens itself/.test(emma.text), 'Emma 绘本应含 sharpens itself 情节');
});

test('u4.json 语法卡含 3 条 childCard（Excuse me / 借物 / 致谢）', () => {
  assert.equal(u4.grammar.childCards.length, 3);
  const titles = u4.grammar.childCards.map((c) => c.title).join('|');
  assert.match(titles, /Excuse me/);
  assert.match(titles, /谢谢|致谢/);
});

test('u4.json 考点微测覆盖同步优学 I–IX 九类题型 + oo 语音（P 类）', () => {
  const families = new Set(u4.quiz.map((q) => q.id.replace(/\d+$/, '')));
  const want = ['I', 'II', 'III', 'IV', 'VI', 'VIII', 'IX', 'P'];
  want.forEach((f) => assert.ok(families.has(f), '考点微测缺少题型 ' + f));
  assert.equal(families.has('V'), false, 'V（任务卡连线）未做成交互题，应为空');
  assert.equal(families.has('VII'), false, 'VII（补全对话）未做成交互题，应为空');
  assert.ok(families.has('P'), '缺少 oo 语音题（P 类，U4 语音考点）');
  assert.ok(u4.quiz.every((q) => q.answer >= 0 && q.answer < q.options.length), '所有 answer 必须在 options 范围内');
});

test('u4.json 核心句型对话对覆盖 6 个槽位 × 2（use/borrow）= 12 对', () => {
  assert.equal(u4.sentences.slots.length, 6);
  const pairs = Object.values(u4.sentences.dialogues).reduce((s, a) => s + a.length, 0);
  assert.equal(pairs, 12, '应答配对应为 12 对');
});

// ── U4 应答配对「灵活化」需求（2026-11-09 家长：截图里全是"点头：可以"，能考得活一点吗？比如不同意）──
// 旧口径：12 题全是点头同意，正确答案永远排第一，孩子不用看表情点第一个就全对 → 题型失效。
// 新口径：点头/摇头混合，use/borrow 两种问法各自都练到同意与婉拒两种答语，正确答案位置均匀轮转。
// 沿用题型效度铁律：每题必须有 cue（答题前可见）+ 纯中文 rule；干扰项只能是
//   「与 cue 极性冲突」或「答非所问」的真错，绝不把与 cue 一致的另一句合法答语判错。
const U4_YES = 'Sure. Here you are.';
const U4_NO = "Sorry, I'm using it.";
function u4AnswerKind(a) {
  if (/^No\b|can't|^Sorry\b|using it|working now/.test(a)) return 'no';
  if (/^Sure\b|^Yes\b|Here you are|^OK\b/.test(a)) return 'yes';
  return 'offtopic'; // 如 Thank you.：根本没回答"能不能借"
}
function u4DialogueDefects(dialogues) {
  const bad = [];
  for (const [slot, pairs] of Object.entries(dialogues)) {
    for (const p of pairs) {
      const tag = `${slot}|${p.q}`;
      if (p.cue !== 'yes' && p.cue !== 'no') bad.push(`${tag}: 缺/非法 cue`);
      if (!p.cueZh) bad.push(`${tag}: 缺 cueZh`);
      if (!p.rule) bad.push(`${tag}: 缺 rule`);
      if (!p.zh) bad.push(`${tag}: 缺 zh 中文意思`);
      // 中文解说区不得混入无 🔊 英文（英语必有播放铁律）
      if (/[A-Za-z]/.test(p.rule || '') || /[A-Za-z]/.test(p.cueZh || '')) bad.push(`${tag}: cueZh/rule 含裸英文`);
      if (!Array.isArray(p.opts) || p.opts.length !== 3) bad.push(`${tag}: 应有 3 个选项`);
      if (!p.opts?.includes(p.a)) bad.push(`${tag}: 正确答案不在选项内`);
      if (new Set(p.opts).size !== p.opts.length) bad.push(`${tag}: 选项重复`);
      // 正确答案的极性必须与表情一致
      if (u4AnswerKind(p.a) !== p.cue) bad.push(`${tag}: 正确答案与表情极性不符 -> ${p.a}`);
      // 干扰项不得是"与表情一致的另一句合法答语"（否则孩子答对却被判错）
      for (const o of p.opts || []) {
        if (o !== p.a && u4AnswerKind(o) === p.cue) bad.push(`${tag}: 与表情一致的合法答语被判错 -> ${o}`);
      }
    }
  }
  return bad;
}

// 纯函数：判定一份配对题数据是否"灵活"（正反对照用，不写死当前值）
function u4IsFlexible(dialogues) {
  const pairs = Object.values(dialogues).flat();
  if (pairs.length !== 12) return false;
  // ① 点头/摇头都要有，且各占一半（否则又退化成另一种固定套路）
  if (pairs.filter((p) => p.cue === 'yes').length !== 6) return false;
  // ② use / borrow 两种问法各自都必须能考同意与婉拒
  for (const re of [/use your/, /borrow your/]) {
    const g = pairs.filter((p) => re.test(p.q));
    if (g.length !== 6 || !g.some((p) => p.cue === 'yes') || !g.some((p) => p.cue === 'no')) return false;
  }
  // ③ 正确答案均匀落在三个位置（旧版永远第一位，点第一个就全对）
  const pos = [0, 1, 2].map((i) => pairs.filter((p) => p.opts.indexOf(p.a) === i).length);
  if (pos.some((n) => n < 2)) return false;
  return true;
}

test('U4 应答配对灵活化：正反对照——不再"全是同意"，答案也不再永远第一位', () => {
  const dlg = u4.sentences.dialogues;
  const pairs = Object.values(dlg).flat();
  assert.equal(pairs.length, 12);
  // 前置对照断言：构造"旧版"（12 题全点头、答案全在第一个），证明行为确实变了、测试非摆设
  const oldStyle = structuredClone(dlg);
  for (const ps of Object.values(oldStyle)) {
    for (const p of ps) {
      p.cue = 'yes';
      p.cueZh = '点头：可以';
      p.a = U4_YES;
      p.opts = [U4_YES, U4_NO, 'Thank you.'];
    }
  }
  assert.equal(u4IsFlexible(oldStyle), false, '旧版"全同意+答案固定第一"必须被判为不灵活');
  assert.equal(u4IsFlexible(dlg), true, '新规格必须判为灵活');

  // 新规格逐项断言（给出可读诊断）
  const cues = new Set(pairs.map((p) => p.cue));
  assert.deepEqual([...cues].sort(), ['no', 'yes'], '必须同时有点头同意与摇头婉拒');
  assert.equal(pairs.filter((p) => p.cue === 'yes').length, 6, '一半点头一半摇头');
  for (const [label, re] of [['use', /use your/], ['borrow', /borrow your/]]) {
    const g = pairs.filter((p) => re.test(p.q));
    assert.ok(g.some((p) => p.cue === 'yes') && g.some((p) => p.cue === 'no'),
      `${label} 问法必须既能考"同意"也能考"不方便"`);
  }
  const posDist = [0, 1, 2].map((i) => pairs.filter((p) => p.opts.indexOf(p.a) === i).length);
  assert.deepEqual(posDist, [4, 4, 4], '正确答案应均匀分布在三个位置');
  // 干扰项类型丰富：既有极性冲突项，也有"答非所问"项（家长要的"别的等等"）
  assert.ok(pairs.some((p) => p.opts.includes('Thank you.')), '应含"道谢=没回答问题"这类干扰项');
  assert.ok(pairs.every((p) => p.opts.includes(U4_YES) && p.opts.includes(U4_NO)),
    '每题都应让同意/婉拒两句同时出现，靠表情来选');
});

test('U4 应答配对题型效度：每题有可见线索+纯中文解说，无"合法答语被判错"', () => {
  const dlg = u4.sentences.dialogues;
  assert.deepEqual(u4DialogueDefects(dlg), [], '不应存在效度缺陷');
  // 检测器有效性对照 ①：点头题里塞入第二句"同意"合法答语当干扰项 → 必须检出多解
  const multi = structuredClone(dlg);
  const yesPair = Object.values(multi).flat().find((p) => p.cue === 'yes');
  yesPair.opts[yesPair.opts.findIndex((o) => o === 'Thank you.')] = 'Sure. Here you are!';
  assert.ok(u4DialogueDefects(multi).some((x) => x.includes('合法答语被判错')),
    '点头题出现第二句同意答语 -> 必须报多解');
  // 检测器有效性对照 ②：rule 塞裸英文 → 必须检出违反英语必有播放铁律
  const engRule = structuredClone(dlg);
  Object.values(engRule).flat()[0].rule = '答 Sure. 就对了';
  assert.ok(u4DialogueDefects(engRule).some((x) => x.includes('含裸英文')),
    '中文解说混入英文必须被检出');
  // 检测器有效性对照 ③：去掉表情线索 → 必须检出缺 cueZh
  const noCue = structuredClone(dlg);
  delete Object.values(noCue).flat()[0].cueZh;
  assert.ok(u4DialogueDefects(noCue).some((x) => x.includes('缺 cueZh')));
});

test('U4 应答配对所有英文题干/选项都有预生成音频（英语必有播放铁律）', () => {
  for (const pairs of Object.values(u4.sentences.dialogues)) {
    for (const p of pairs) {
      for (const t of [p.q, ...p.opts]) {
        assert.ok(audioSlugs.has(audioSlug(t)), `缺少音频: ${t} -> ${audioSlug(t)}`);
      }
    }
  }
});

test('u4.json 关键英语文本都已生成预生成音频', () => {
  const need = [
    'Can I use your pencil, please?',
    'Sure. Here you are.',
    'You\'re welcome.',
    'Excuse me.',
    'Thank you.',
    'pencil', 'eraser', 'dictionary', 'glue', 'brush', 'notebook', 'blackboard', 'borrow',
  ];
  need.forEach((t) => assert.ok(audioSlugs.has(audioSlug(t)), '缺少音频: ' + t + ' -> ' + audioSlug(t)));
});
