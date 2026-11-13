// 单元数据校验：缺字段即报错并指明字段，不静默出错
// 纯逻辑，可被 node --test 直接引入。

const TIERS = ['four', 'read'];

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }

export function validateUnit(data) {
  const errors = [];
  const push = (path, msg) => errors.push(`${path}: ${msg}`);

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['root: 单元数据必须是对象'] };
  }

  if (!isStr(data.id)) push('id', '必须是非空字符串');
  if (!Number.isInteger(data.no)) push('no', '必须是整数');
  if (!isStr(data.title)) push('title', '必须是非空字符串');

  if (!data.objective || typeof data.objective !== 'object') {
    push('objective', '必须存在');
  } else {
    if (!isStr(data.objective.child)) push('objective.child', '必须是非空字符串');
    if (!isStr(data.objective.parent)) push('objective.parent', '必须是非空字符串');
  }

  if (!Array.isArray(data.words) || data.words.length === 0) {
    push('words', '必须是非空数组');
  } else {
    data.words.forEach((w, i) => {
      if (!w || typeof w !== 'object') { push(`words[${i}]`, '必须是对象'); return; }
      if (!isStr(w.w)) push(`words[${i}].w`, '必须是非空字符串');
      if (!isStr(w.ipa)) push(`words[${i}].ipa`, '必须是非空字符串');
      if (!isStr(w.zh)) push(`words[${i}].zh`, '必须是非空字符串');
      if (!TIERS.includes(w.tier)) push(`words[${i}].tier`, `必须是 ${TIERS.join(' 或 ')}`);
    });
  }

  if (!data.phonics || typeof data.phonics !== 'object') push('phonics', '必须存在');
  else {
    if (!isStr(data.phonics.pattern)) push('phonics.pattern', '必须是非空字符串');
    if (!Array.isArray(data.phonics.words) || data.phonics.words.length === 0) push('phonics.words', '必须是非空数组');
  }

  if (!Array.isArray(data.listenPairs) || data.listenPairs.length === 0) push('listenPairs', '必须是非空数组');
  else data.listenPairs.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(isStr)) push(`listenPairs[${i}]`, '必须是两个非空字符串组成的数组');
  });

  if (!data.sentences || typeof data.sentences !== 'object') push('sentences', '必须存在');
  else {
    if (!isStr(data.sentences.pattern)) push('sentences.pattern', '必须是非空字符串');
    if (!Array.isArray(data.sentences.slots) || data.sentences.slots.length === 0) push('sentences.slots', '必须是非空数组');
    if (!Array.isArray(data.sentences.answers) || data.sentences.answers.length === 0) push('sentences.answers', '必须是非空数组');
    // U6 选择疑问句单元声明 cueMode='choice'（应答配对改按「想要哪一件」线索判定）。
    // 不声明 = 默认 polarity（U4/U5 零回归）；拼错值会静默退回极性模式 → 必须拦下。
    if (data.sentences.cueMode !== undefined && !['choice', 'polarity'].includes(data.sentences.cueMode)) {
      push('sentences.cueMode', `必须是 choice 或 polarity，实际 ${data.sentences.cueMode}`);
    }
  }

  if (!data.roleplay || typeof data.roleplay !== 'object') push('roleplay', '必须存在');
  else {
    if (!isStr(data.roleplay.child)) push('roleplay.child', '必须是非空字符串');
    if (!Array.isArray(data.roleplay.parent) || data.roleplay.parent.length === 0) push('roleplay.parent', '必须是非空数组');
  }

  // Let's Write 选句题：accept（可选）声明"多句课本都合法的答语"，点中任意一句都算对。
  // 结构须合法：含主答案 a、每项都在 opts 里，且 a 本身必须在 opts 里。
  // 防止把合法答语摆进 opts 却漏进可接受集合（那样会被误判成错，家长 2026-11-10 反馈）。
  if (data.writing && Array.isArray(data.writing.items)) {
    data.writing.items.forEach((it, i) => {
      if (!it || typeof it !== 'object') { push(`writing.items[${i}]`, '必须是对象'); return; }
      if (!isStr(it.a)) push(`writing.items[${i}].a`, '必须是非空字符串');
      if (!Array.isArray(it.opts) || it.opts.length === 0) { push(`writing.items[${i}].opts`, '必须是非空数组'); return; }
      if (!it.opts.includes(it.a)) push(`writing.items[${i}].a`, '主答案 a 必须在 opts 里');
      if (it.accept !== undefined) {
        if (!Array.isArray(it.accept) || it.accept.length === 0) {
          push(`writing.items[${i}].accept`, '必须是非空数组');
        } else {
          if (!it.accept.includes(it.a)) push(`writing.items[${i}].accept`, '必须包含主答案 a');
          it.accept.forEach((x, xi) => {
            if (!isStr(x)) push(`writing.items[${i}].accept[${xi}]`, '必须是非空字符串');
            else if (!it.opts.includes(x)) push(`writing.items[${i}].accept[${xi}]`, `必须是 opts 之一：${x}`);
          });
        }
      }
      // 逐项解答（家长 2026-11-10）：答完后对每个选项给中文解说。
      // 必须覆盖全部 opts、纯中文、不含裸英文（英文答案行单独由渲染层配 🔊）。
      if (it.explain !== undefined) {
        if (!it.explain || typeof it.explain !== 'object' || Array.isArray(it.explain)) {
          push(`writing.items[${i}].explain`, '必须是对象');
        } else {
          it.opts.forEach((o) => {
            if (!isStr(it.explain[o])) push(`writing.items[${i}].explain[${o}]`, '每个选项都要有非空中文解答');
            else if (/[A-Za-z]/.test(it.explain[o])) push(`writing.items[${i}].explain[${o}]`, '解答必须是纯中文，不能含裸英文');
          });
        }
      }
    });
  }

  if (!data.mindmap || !Array.isArray(data.mindmap.chain) || data.mindmap.chain.length === 0) push('mindmap.chain', '必须是非空数组');

  // 单元主题词（渲染层文案数据驱动，勿硬编码"宠物"——U4 是借文具）
  if (!data.theme || typeof data.theme !== 'object') push('theme', '必须存在（真实输出页文案数据驱动）');
  else {
    ['topic', 'roleplay', 'mindmap', 'introNoun', 'slotDefault'].forEach((k) => {
      if (!isStr(data.theme[k])) push(`theme.${k}`, '必须是非空字符串');
    });
  }

  // 思维导图四问：每一问都必须有可点选项，否则孩子永远选不完 → 永远解锁不了
  if (data.mindmap && Array.isArray(data.mindmap.steps)) {
    data.mindmap.steps.forEach((st, i) => {
      if (!st || typeof st !== 'object') { push(`mindmap.steps[${i}]`, '必须是对象'); return; }
      if (!isStr(st.q)) push(`mindmap.steps[${i}].q`, '必须是非空字符串');
      const opts = Array.isArray(st.opts) ? st.opts : [];
      const fba = st.featureByAnimal && typeof st.featureByAnimal === 'object' ? st.featureByAnimal : {};
      const hasLinked = Object.keys(fba).length > 0;
      if (!opts.length && !hasLinked && !st.extra) {
        push(`mindmap.steps[${i}]`, '必须至少有 1 个可点选项（opts / featureByAnimal / extra 三者之一，否则该问选不了、思维导图永远解锁不了）');
      }
    });
  }

  if (!Array.isArray(data.stories) || data.stories.length === 0) push('stories', '必须是非空数组');
  else data.stories.forEach((s, i) => {
    if (!s || typeof s !== 'object') { push(`stories[${i}]`, '必须是对象'); return; }
    if (!isStr(s.id)) push(`stories[${i}].id`, '必须是非空字符串');
    if (!isStr(s.title)) push(`stories[${i}].title`, '必须是非空字符串');
    if (!isStr(s.text)) push(`stories[${i}].text`, '必须是非空字符串');
    // 阅读理解题：渲染器 story.js 读 opts（choice 题），缺字段会让整个故事屋白屏
    (s.quiz || []).forEach((q, qi) => {
      if (!q || typeof q !== 'object') { push(`stories[${i}].quiz[${qi}]`, '必须是对象'); return; }
      if (!isStr(q.q)) push(`stories[${i}].quiz[${qi}].q`, '必须是非空字符串');
      if (!isStr(q.qZh)) push(`stories[${i}].quiz[${qi}].qZh`, '必须是非空字符串（答对后的中文门控）');
      if (!isStr(q.a)) push(`stories[${i}].quiz[${qi}].a`, '必须是非空字符串');
      if (q.type === 'tf') {
        if (q.a !== 'T' && q.a !== 'F') push(`stories[${i}].quiz[${qi}].a`, `tf 题答案必须是 T/F，实际 ${q.a}`);
      } else if (q.type === 'choice') {
        if (!Array.isArray(q.opts) || q.opts.length === 0) push(`stories[${i}].quiz[${qi}].opts`, 'choice 题必须是非空数组 opts（不是 options）');
        else if (!q.opts.includes(q.a)) push(`stories[${i}].quiz[${qi}].a`, `必须是 opts 之一：${q.a}`);
      } else {
        push(`stories[${i}].quiz[${qi}].type`, `必须是 tf 或 choice，实际 ${q.type}`);
      }
    });
  });

  if (!Array.isArray(data.quiz) || data.quiz.length === 0) push('quiz', '必须是非空数组');
  else data.quiz.forEach((q, i) => {
    if (!q || typeof q !== 'object') { push(`quiz[${i}]`, '必须是对象'); return; }
    if (!isStr(q.id)) push(`quiz[${i}].id`, '必须是非空字符串');
    if (!isStr(q.type)) push(`quiz[${i}].type`, '必须是非空字符串');
    if (!isStr(q.prompt)) push(`quiz[${i}].prompt`, '必须是非空字符串');
    if (!Array.isArray(q.options) || q.options.length === 0) push(`quiz[${i}].options`, '必须是非空数组');
    if (!Number.isInteger(q.answer)) push(`quiz[${i}].answer`, '必须是整数');
    else if (Array.isArray(q.options) && (q.answer < 0 || q.answer >= q.options.length)) push(`quiz[${i}].answer`, `越界(应在 0~${q.options.length - 1})`);
  });

  if (!Array.isArray(data.reviewCards) || data.reviewCards.length === 0) push('reviewCards', '必须是非空数组');
  if (!data.grammar || !Array.isArray(data.grammar.parentCard) || data.grammar.parentCard.length === 0) push('grammar.parentCard', '必须是非空数组');

  return { valid: errors.length === 0, errors };
}
