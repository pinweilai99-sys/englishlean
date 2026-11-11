#!/usr/bin/env node
// 预生成发音音频（macOS 专用）：用系统英音 Daniel（与课本英式音标口径一致）把单元数据里
// 所有会被 tts.speak() 朗读的文本生成为 .m4a，输出到 assets/audio/，并写 manifest.json。
// 背景：手机浏览器普遍没有英语 TTS 引擎，speechSynthesis 静默失败；预生成音频任何手机都能播。
// 用法：node scripts/gen-audio.mjs   （数据变更后重跑；已生成的且文本未变的文件会跳过）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioSlug } from '../js/services/audio.js';
import { chunkSay } from '../js/core/phonics.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'assets/audio');
const VOICE = 'Daniel';   // en-GB 英音，匹配课本音标
const RATE = '150';       // 词/分，接近 App 内 TTS rate 0.85 的语速
const TMP = '/tmp/englishlean-say.aiff';

// ---------- 1. 枚举全部可发声文本（与 js 里 tts.speak 的调用点一一对应） ----------
// （导出供 scripts/audit-audio.mjs 复用：机器听写审计所有音频）
export function collectTexts() {
  const texts = new Set();
  const dir = join(root, 'data/units');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const u = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    // 单词 + 记词分块（分块朗读用重拼写 chunkSay，避免孤立音节怪音/字母名）
    (u.words || []).forEach((w) => {
      texts.add(w.tts || w.w);
      (w.chunks || []).forEach((c) => texts.add(chunkSay(String(c).toLowerCase())));
    });
    // 自然拼读：例词 + chant
    if (u.phonics) {
      (u.phonics.words || []).forEach((w) => texts.add(w));
      if (u.phonics.chant) texts.add(u.phonics.chant);
    }
    // 核心句型：句型 × 槽位词、应答句、拓展对（键与值都会被朗读）
    const s = u.sentences || {};
    (s.slots || []).forEach((slot) => { if (s.pattern) texts.add(s.pattern.replace('___', slot)); });
    (s.answers || []).forEach((a) => texts.add(a));
    Object.entries(s.extra || {}).forEach(([k, v]) => { texts.add(k); texts.add(v); });
    // 每只动物一组对话（题干 + 正确答案 + 全部选项都会被朗读）
    Object.values(s.dialogues || {}).forEach((pairs) => pairs.forEach((p) => {
      texts.add(p.q); texts.add(p.a);
      (p.opts || []).forEach((o) => texts.add(o));
    }));
    // 角色扮演：孩子台词（模板 × 本单元全部槽位）+ 家长应答
    // 注意：默认槽位取**本单元 slots[0]**（U4=pencil，U5=rabbit），与 output.js 运行时一致；
    // 不能写死 'pet'——那会生成 U4 用不到的音频，且与运行时默认值不一致。
    const rp = u.roleplay || {};
    if (rp.child) {
      (s.slots || []).forEach((slot) => texts.add(rp.child.replace('___', slot)));
    }
    (rp.parent || []).forEach((a) => texts.add(a));
    // 写作情境句 + 孩子台词 + **每个可选答案**（Let's Write 情境卡：英文情境描述、孩子问句、
    // 以及每个选项旁的 🔊 都要能出声）。
    // ⚠️ 2026-11-11 修复：旧版只收 ctx/ask，漏收 opts → U4「借画笔/借水」两题的「Sorry.」
    // 选项音频文件虽存在但**不在 manifest** → 点该选项 🔊 判定"没有预生成音频"
    // → 退 speechSynthesis → 安卓平板弹「找不到 Google 引擎」。漏收 = 致命。
    ((u.writing || {}).items || []).forEach((it) => {
      if (it.ctx) texts.add(it.ctx);
      if (it.ask) texts.add(it.ask);
      (it.opts || []).forEach((o) => { if (o) texts.add(o); });
    });
    // 范文对话（挑战区示范对话：每一句都要 🔊）
    const sd = (u.writing || {}).sampleDialogue;
    if (sd) (sd.lines || []).forEach((l) => { if (l.t) texts.add(l.t); });
    // 思维导图：问题句（🔊 听问题）+ 每问全部候选句 + 动物特征句 + 结尾句（拼装介绍词逐句朗读）
    const mm = u.mindmap || {};
    if (mm.sample) texts.add(mm.sample);
    (mm.chain || []).forEach((q) => texts.add(q));
    (mm.steps || []).forEach((st) => {
      texts.add(st.q);
      (st.opts || []).forEach((o) => texts.add(o.t));
      Object.values(st.featureByAnimal || {}).forEach((o) => texts.add(o.t));
      if (st.extra) texts.add(st.extra.t);
    });
    if (mm.ending) texts.add(mm.ending.t);
    // 语法小规律卡：例句 q/a（UI 配了 🔊 听例句）
    // ⚠️ 2026-11-11 补：旧版完全没收集 grammar.childCards → U4 卡的「Yes?」等例句
    // 点 🔊 会退 TTS 兜底 → 安卓平板弹「找不到 Google 引擎」。
    ((u.grammar || {}).childCards || []).forEach((c) => {
      if (c.q) texts.add(c.q);
      if (c.a) texts.add(c.a);
    });
    // 主动回忆卡
    (u.reviewCards || []).forEach((c) => { if (c.speak) texts.add(c.speak); });
    // 故事 + 故事问题
    (u.stories || []).forEach((st) => {
      if (st.text) texts.add(st.text);
      if (st.narration) texts.add(st.narration);
      (st.lines || []).forEach((l) => { if (l.t) texts.add(l.t); });
      (st.questions || []).forEach((q) => { if (q.speak) texts.add(q.speak); });
      // 故事阅读理解题：题干 + **每个选项**（UI 每个选项旁都有 🔊，缺音频就会退 TTS 兜底）
      (st.quiz || []).forEach((q) => {
        if (q.q) texts.add(q.q);
        (q.opts || []).forEach((o) => {
          const t = typeof o === 'string' ? o : (o.t || o.label || '');
          if (t) texts.add(t);
        });
      });
    });
    // 微测
    (u.quiz || []).forEach((q) => { if (q.speak) texts.add(q.speak); });
  }
  // 字母（拼写屋点字母读字母名）
  for (let i = 0; i < 26; i++) texts.add(String.fromCharCode(97 + i));
  return [...texts];
}

// ---------- 2. 逐条生成 ----------
function genOne(text, outFile) {
  // 2.1 say 生成 AIFF（Daniel 英音）
  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', TMP, text], { timeout: 30000 });
  // 2.2 afconvert 转 AAC/m4a（体积小、全平台可播）
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', TMP, outFile], { timeout: 30000 });
  unlinkSync(TMP);
}

// 仅直接运行本脚本时执行生成主流程（被 audit-audio.mjs 导入 collectTexts 时跳过）
const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
const texts = collectTexts();
mkdirSync(OUT, { recursive: true });
const generated = [];
const skipped = [];
for (const text of texts) {
  const slug = audioSlug(text);
  const file = join(OUT, `${slug}.m4a`);
  if (existsSync(file)) { skipped.push(slug); continue; }
  genOne(text, file);
  generated.push(slug);
}

// ---------- 3. 写清单（slug 去重；运行时据此决定播文件还是退 TTS） ----------
const slugs = [...new Set(texts.map(audioSlug))].sort();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ voice: VOICE, slugs }, null, 1));
console.log(`✅ 音频生成完成：新 ${generated.length} 条，已有 ${skipped.length} 条，清单共 ${slugs.length} 条 → ${OUT}`);
if (generated.length) console.log('   新增:', generated.slice(0, 10).join(', '), generated.length > 10 ? '…' : '');
}
