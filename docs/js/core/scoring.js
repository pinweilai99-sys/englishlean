// 发音打分：纯逻辑
// 策略：优先用语音识别转写文本做匹配（相似度）；无识别结果时返回 null（不误判为 0 分）。

// Levenshtein 距离
export function levenshtein(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[t.length];
}

// 归一化相似度 0~1
export function similarity(a, b) {
  const s = String(a ?? '').toLowerCase().trim();
  const t = String(b ?? '').toLowerCase().trim();
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  const maxLen = Math.max(s.length, t.length);
  return 1 - levenshtein(s, t) / maxLen;
}

// 常见识别容错：把明显错写的词映射回目标词
export const COMMON_MISHEARD = {
  rabit: 'rabbit', rabit_: 'rabbit', rabbb: 'rabbit',
  goldfsh: 'goldfish', 'gold fis': 'goldfish',
  parrott: 'parrot', parrrot: 'parrot',
  holdd: 'hold', hoId: 'hold',
  feedd: 'feed', fead: 'feed',
  pet_: 'pet', peet: 'pet',
  may_: 'may', my_: 'my',
  mrs_: 'mrs', miss: 'miss',
};

export function normalizeSpoken(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 若识别文本命中容错表则修正
// 先处理多词短语（如 "gold fis" → "goldfish"），再处理单词
export function applyMisheardFix(text) {
  const t = normalizeSpoken(text);
  if (!t) return '';
  // 多词短语：整段替换为占位符，避免后续单词拆分把短语拆散
  const phrases = Object.keys(COMMON_MISHEARD).filter((k) => k.includes(' '));
  let tmp = t;
  const placeholders = [];
  phrases.forEach((phrase, i) => {
    const token = `__phrase${i}__`;
    if (tmp.includes(phrase)) {
      tmp = tmp.split(phrase).join(token);
      placeholders.push([token, COMMON_MISHEARD[phrase]]);
    }
  });
  let out = tmp.split(' ').map((w) => COMMON_MISHEARD[w] || w).join(' ');
  placeholders.forEach(([token, real]) => {
    out = out.split(token).join(real);
  });
  return out;
}

// 打分：target 目标词，spoken 识别/转写文本
// 返回 { score: 0~100, level: 'good'|'ok'|'retry', matched: bool }
// spoken 为空 → score 0 且 level 'retry'（表示"没听清"，不是"完全错误"）
export function scorePronunciation(target, spoken) {
  const t = normalizeSpoken(target);
  const s = applyMisheardFix(spoken);
  if (!s) return { score: 0, level: 'retry', matched: false, reason: 'no-speech' };
  if (s === t) return { score: 100, level: 'good', matched: true, reason: 'exact' };
  // 目标词包含在识别结果中（如说出 "May I have a rabbit" 命中 rabbit）
  if (s.split(' ').includes(t)) return { score: 95, level: 'good', matched: true, reason: 'contains' };
  const sim = similarity(t, s);
  if (sim >= 0.8) return { score: Math.round(sim * 100), level: 'good', matched: true, reason: 'close' };
  if (sim >= 0.5) return { score: Math.round(sim * 100), level: 'ok', matched: false, reason: 'partial' };
  return { score: Math.round(sim * 100), level: 'retry', matched: false, reason: 'far' };
}

// 鼓励型反馈文案（成长型思维：夸努力不夸天赋）
export function scoreFeedback(result) {
  if (!result || result.reason === 'no-speech') return '没听清哦，再来一次试试～';
  if (result.level === 'good') return '发音很棒！就是你！';
  if (result.level === 'ok') return '很接近啦，再读一次会更好！';
  return '别着急，慢慢来，我们再来一次～';
}
