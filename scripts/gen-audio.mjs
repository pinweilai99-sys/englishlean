#!/usr/bin/env node
// 预生成发音音频（macOS 专用）：用系统英音 Daniel（与课本英式音标口径一致）把单元数据里
// 所有会被 tts.speak() 朗读的文本生成为 .m4a，输出到 assets/audio/，并写 manifest.json。
// 背景：手机浏览器普遍没有英语 TTS 引擎，speechSynthesis 静默失败；预生成音频任何手机都能播。
// 用法：node scripts/gen-audio.mjs   （数据变更后重跑；已生成的且文本未变的文件会跳过）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioSlug } from '../js/services/audio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'assets/audio');
const VOICE = 'Daniel';   // en-GB 英音，匹配课本音标
const RATE = '150';       // 词/分，接近 App 内 TTS rate 0.85 的语速
const TMP = '/tmp/englishlean-say.aiff';

// ---------- 1. 枚举全部可发声文本（与 js 里 tts.speak 的调用点一一对应） ----------
function collectTexts() {
  const texts = new Set();
  const dir = join(root, 'data/units');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const u = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    // 单词 + 记词分块
    (u.words || []).forEach((w) => {
      texts.add(w.tts || w.w);
      (w.chunks || []).forEach((c) => texts.add(String(c).toLowerCase()));
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
    // 角色扮演：孩子台词（模板 × 槽位 + 默认 pet）+ 家长应答
    const rp = u.roleplay || {};
    if (rp.child) {
      texts.add(rp.child.replace('___', 'pet'));
      (s.slots || []).forEach((slot) => texts.add(rp.child.replace('___', slot)));
    }
    (rp.parent || []).forEach((a) => texts.add(a));
    // 主动回忆卡
    (u.reviewCards || []).forEach((c) => { if (c.speak) texts.add(c.speak); });
    // 故事 + 故事问题
    (u.stories || []).forEach((st) => {
      if (st.text) texts.add(st.text);
      (st.questions || []).forEach((q) => { if (q.speak) texts.add(q.speak); });
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
