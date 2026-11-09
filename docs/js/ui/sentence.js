// Stage2 核心句型：① 句型填空（选动物填空+跟读） → ② 应答配对
// 结构：两张独立卡片，层级清晰（填空是第一步，配对是第二步）
import { h, toast, starFly, confetti } from './dom.js?v=1794213575';
import * as tts from '../services/tts.js?v=1794213575';

export function renderSentence(ctx, unit) {
  const s = unit.sentences;
  const session = ctx.session;
  const wrap = h('div');
  // 答错后的即时对照卡：只活在当前页面生命周期，不写入 session/存档（不留失败痕迹）；答对即消失
  const feedback = {};

  function render() {
    wrap.innerHTML = '';

    // 模块总标题（层级：核心句型 → 第 1 步 → 第 2 步）
    wrap.appendChild(h('div', { class: 'card-title', style: 'font-size:var(--fs-xl);margin:4px 0 12px', text: '💬 核心句型' }));

    // ───────── 卡片 1：句型填空 ─────────
    const cardFill = h('div', { class: 'card' });
    cardFill.appendChild(h('div', { class: 'card-title', text: '💬 第 1 步 · 句型填空' }));
    cardFill.appendChild(h('p', { class: 'card-sub', text: '选一个动物填进空格，再把整句读出来！' }));

    const slot = session.slot || null;
    const sentence = slot ? s.pattern.replace('___', slot) : null;
    const patternBox = h('div', { class: 'story-text', style: 'text-align:center;font-size:var(--fs-xl);font-weight:900' });
    const patternParts = s.pattern.split('___');
    patternBox.appendChild(document.createTextNode(patternParts[0]));
    patternBox.appendChild(h('span', {
      class: `blank-slot ${slot ? 'is-filled' : 'is-empty'}`,
      text: slot || '＿＿＿＿',
    }));
    patternBox.appendChild(document.createTextNode(patternParts[1] || ''));
    cardFill.appendChild(patternBox);
    cardFill.appendChild(h('div', { class: 'btn-row', style: 'margin:12px 0' }, [
      h('button', {
        class: 'btn', text: '🔊 听整句',
        onclick: () => {
          if (!sentence) { toast('先在下面选一个动物填进空格里吧！'); return; }
          tts.speak(sentence);
        },
      }),
    ]));

    // 填空操练：点动物填空 + 跟读确认
    cardFill.appendChild(h('div', { class: 'card-title', style: 'margin-top:16px', text: '🖊️ 填空：点一个动物填进空格里' }));
    const slotRow = h('div', { class: 'word-bank', style: 'margin-top:10px' });
    s.slots.forEach((w) => {
      slotRow.appendChild(h('button', {
        class: `word-bank-item ${w === slot ? 'is-done' : ''}`,
        text: w,
        onclick: () => {
          session.slot = w;
          render();
          tts.speak(s.pattern.replace('___', w));
        },
      }));
    });
    cardFill.appendChild(slotRow);

    const used = new Set(session.usedSlots || []);
    cardFill.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
      h('button', {
        class: 'btn leaf', text: '🎤 我读出来了',
        onclick: () => {
          if (!slot) { toast('先选一个动物填进空格里！'); return; }
          used.add(slot);
          session.usedSlots = Array.from(used);
          ctx.addStars(1);
          starFly(1);
          tts.speak(sentence);
          toast('读得真棒！再换一个试试～');
          render();
        },
      }),
    ]));
    cardFill.appendChild(h('p', { class: 'hint', text: `已填读过 ${used.size} / 3 种动物（达到 3 种即完成）` }));
    wrap.appendChild(cardFill);

    // ───────── 卡片 2：应答配对（每只动物一组课本对话，举一反三） ─────────
    const cardPair = h('div', { class: 'card' });
    cardPair.appendChild(h('div', { class: 'card-title', text: '↔️ 第 2 步 · 应答配对' }));
    cardPair.appendChild(h('p', { class: 'card-sub', text: '看表情，选出合适的回答——换一种动物，对话就不一样。' }));
    // 动物 → 该动物的两组对话（全部取自课本：May I have/hold/touch/feed...、take good care of、导盲犬 Can he...）
    // cue 是「题目条件」而非答案译文：必须答题前可见。课本 C 部分同一问句 Yes/No 两解并列，
    // 若不给出情境线索，多个选项都是合法答语，题型即失去效度（孩子答对却被判错）。
    const animal = slot || 'pet';
    const dialogues = (s.dialogues && s.dialogues[animal]) || [
      { q: `May I have a ${animal}?`, a: 'Yes, you can.', zh: `我可以养一只${animal}吗？——可以。`, cue: 'yes', cueZh: '点头：可以', opts: ['Yes, you can.', "No, you can't.", 'Yes, I can.'], rule: '点头＝同意。问『我可以吗』要答『你可以』；答『我能』是主语错。' },
      { q: 'May I hold it?', a: 'Sure.', zh: '我可以抱抱它吗？——当然可以。', cue: 'yes', cueZh: '点头：可以', opts: ['Sure.', "No, you can't.", 'OK. Yes, I can.'], rule: '点头＝可以，用『当然可以』来答；答『我能』是主语错。' },
    ];
    // 答案按「动物|题干」记录：换动物后所有题目（含第 2 题）自动清空重练；
    // 星标按题干记录：同题干换动物不重复加星（防刷星）
    const keyOf = (q) => `${animal}|${q}`;
    // 答错对照卡：讲清「这句本身没错 / 它答的是哪类问题 / 这题该怎么答」，不剧透英文答案
    const subjectRule = (q) => {
      if (q.startsWith('May I')) return '这题问「我可以吗」，回答要说「你可以」～';
      if (q.startsWith('Can you')) return '这题问「你能吗」，回答要说「我能」～';
      if (q.startsWith('Can he')) return '这题问「它能吗」，回答要说「它能」～';
      return '再听听谁在问、谁在答～';
    };
    const feedbackText = (pair, kind) => (kind === 'polarity'
      ? `💡 看看表情：这题是${pair.cue === 'no' ? '摇头（不行）' : '点头（可以）'}，要选意思对得上的回答～`
      : `💡 这句英文本身没错，只是答的不是这道题。${subjectRule(pair.q)}`);
    session.zhShown = session.zhShown || {};
    dialogues.forEach((pair) => {
      const answeredOk = !!session.answeredOk?.[keyOf(pair.q)];
      // 题干行：题干 + 🔊 听题目 + 👀 中文意思（零基础支架：先自己试，卡住再扶）
      const qRow = h('div', { class: 'story-text', style: 'font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
        h('span', { text: pair.q }),
        // 情境线索徽标：答题前就可见（题目条件，不进中文门控）；对齐考点 IX「看图表情定答语」
        h('span', {
          class: 'cue-badge',
          title: '看表情，判断对方是同意还是拒绝',
          text: `${pair.cue === 'no' ? '🙅' : '😊'} ${pair.cueZh || (pair.cue === 'no' ? '摇头：不行' : '点头：可以')}`,
          style: 'font-size:0.7em;font-weight:500;padding:3px 9px;border-radius:999px;white-space:nowrap;'
            + (pair.cue === 'no' ? 'background:#FAECE7;color:#712B13;' : 'background:#E1F5EE;color:#085041;'),
        }),
        h('button', {
          class: 'q-speak', title: '听题目', text: '🔊',
          style: 'border:none;background:none;cursor:pointer;font-size:inherit',
          onclick: (e) => { e.stopPropagation(); tts.speak(pair.q); },
        }),
        h('button', {
          class: 'q-zh', title: '看中文意思', text: session.zhShown[keyOf(pair.q)] ? '🙈 藏起来' : '👀 中文意思',
          style: 'border:none;background:none;cursor:pointer;font-size:0.75em;color:var(--muted,#888)',
          onclick: (e) => {
            e.stopPropagation();
            session.zhShown[keyOf(pair.q)] = !session.zhShown[keyOf(pair.q)];
            render();
          },
        }),
      ]);
      const box = h('div', { style: 'margin-bottom:12px' }, [qRow]);
      if (session.zhShown[keyOf(pair.q)] && pair.zh) {
        box.appendChild(h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: `💬 ${pair.zh}` }));
      }
      const row = h('div', { class: 'btn-row', style: 'margin-top:8px' });
      (pair.opts || s.answers.concat(['Sure.'])).forEach((ans) => {
        row.appendChild(h('button', {
          // 答对后只标绿正确项，其余恢复中性——不给孩子看"红色错误"残留（成长型思维：不留失败痕迹）
          class: `option ${answeredOk && ans === pair.a ? 'is-correct' : ''}`,
          style: 'width:auto;min-width:150px;margin-bottom:0',
          onclick: () => {
            if (answeredOk) return; // 答对的题锁定；答错可重试
            if (ans === pair.a) {
              session.answers = session.answers || {};
              session.answeredOk = session.answeredOk || {};
              session.answers[keyOf(pair.q)] = ans;
              session.answeredOk[keyOf(pair.q)] = true;
              if (!session.starredOk?.[pair.q]) {
                session.starredOk = session.starredOk || {};
                session.starredOk[pair.q] = true;
                ctx.addStars(1); starFly(1);
              }
              delete feedback[keyOf(pair.q)];
              toast('配对正确！你看懂表情啦～');
            } else {
              ctx.addWrong({ unit: unit.id, type: 'answer_match', q: pair.q, a: pair.a, chosen: ans });
              // 支架式即时纠正：不剧透答案，把注意力引回「表情极性」或「谁在问、谁在答」
              const isNo = /(^No\b|can't)/.test(ans);
              const polarityClash = pair.cue === 'no' ? !isNo : isNo;
              feedback[keyOf(pair.q)] = polarityClash ? 'polarity' : 'subject';
              toast(polarityClash ? '看看表情，是点头还是摇头呀？' : '这句答的是别的问题哦，看看下面的 💡～');
            }
            render();
            const ok = dialogues.every((p) => session.answeredOk?.[keyOf(p.q)]);
            if (ok) {
              toast('🎉 应答全部配对成功！', 3000);
              confetti();
              ctx.completeStage(unit.id, 1);
            }
          },
        }, [
          // 🔊 听选项：点喇叭只朗读不判分（零基础孩子先听清选项再决定）
          h('span', {
            class: 'opt-speak', text: '🔊', title: '听这个选项',
            style: 'margin-right:6px;cursor:pointer',
            onclick: (e) => { e.stopPropagation(); tts.speak(ans); },
          }),
          document.createTextNode(ans),
        ]));
      });
      box.appendChild(row);
      // 答错后留一张可反复看的中性对照卡：不标红、不进存档、答对即消失（不留失败痕迹）
      if (!answeredOk && feedback[keyOf(pair.q)]) {
        box.appendChild(h('p', {
          class: 'answer-feedback hint',
          style: 'color:var(--muted,#666);margin:8px 0 0',
          text: feedbackText(pair, feedback[keyOf(pair.q)]),
        }));
      }
      // 答对后立刻讲清规则（即时反馈落在规则上，不落在猜答案上）；纯中文，不触发英语朗读铁律
      if (answeredOk && pair.rule) {
        box.appendChild(h('p', { class: 'hint', style: 'color:var(--muted,#666);margin:8px 0 0', text: `💡 ${pair.rule}` }));
      }
      cardPair.appendChild(box);
    });

    const done = session.usedSlots?.length >= 3 && dialogues.every((p) => session.answeredOk?.[keyOf(p.q)]);
    cardPair.appendChild(h('div', { class: 'btn-row', style: 'margin-top:18px' }, [
      h('button', {
        class: 'btn', text: done ? '✅ 完成句型阶段' : '🔒 完成 3 种动物跟读和应答配对后解锁',
        onclick: () => {
          if (!done) { toast('再替换几种动物吧～'); return; }
          ctx.completeStage(unit.id, 1);
          toast('🎉 核心句型完成！', 3000);
          confetti();
        },
      }),
    ]));
    wrap.appendChild(cardPair);

    // ───────── 卡片 3：本单元语法归纳（孩子侧） ─────────
    // 教育决策：语法不单列第 5 阶段，而是挂在 Stage2 末尾，从「刚做过的应答配对例句」里归纳。
    // 家长中心的 parentCard（三单/进行时/宾格等拓展点）仍只给家长，不下沉给孩子。
    const childCards = unit.grammar?.childCards || [];
    if (childCards.length) {
      const cardRule = h('div', { class: 'card' });
      cardRule.appendChild(h('div', { class: 'card-title', text: '🔍 第 3 步 · 我发现了一个规律' }));
      cardRule.appendChild(h('p', { class: 'card-sub', text: '刚做完的对话里藏着 3 个小规律，先自己想一想，再对照看看～' }));
      childCards.forEach((c, i) => {
        // 英文例句必有 🔊（英语必有播放铁律）；用 span 而非 button，
        // 避免被应答配对的题目块定位器（.card > div 且含 button）误匹配。
        const speak = (text, title) => h('span', {
          class: 'grammar-speak', text: '🔊', title,
          style: 'cursor:pointer;margin-left:4px',
          onclick: () => tts.speak(text),
        });
        cardRule.appendChild(h('div', {
          class: 'grammar-rule',
          style: 'margin-bottom:12px;padding:10px 12px;border-radius:12px;background:var(--color-background-secondary,#f7f7f5)',
        }, [
          h('div', { style: 'font-weight:800;margin-bottom:6px', text: `${i + 1}. ${c.title}` }),
          h('div', { class: 'story-text', style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' }, [
            // 归纳卡若带 cue（如「看表情，定答语」），把表情徽标显示在问句前，
            // 和应答配对题保持一致，让孩子在卡片上也能直接看到该点头还是摇头
            ...(c.cue ? [h('span', {
              class: 'cue-badge',
              title: '看表情，判断对方是同意还是拒绝',
              text: `${c.cue === 'no' ? '🙅' : '😊'} ${c.cueZh || (c.cue === 'no' ? '摇头：不行' : '点头：可以')}`,
              style: 'font-size:0.7em;font-weight:500;padding:3px 9px;border-radius:999px;white-space:nowrap;margin-right:2px;'
                + (c.cue === 'no' ? 'background:#FAECE7;color:#712B13;' : 'background:#E1F5EE;color:#085041;'),
            })] : []),
            document.createTextNode(c.q), speak(c.q, '听这个句子'),
          ]),
          h('div', { class: 'story-text', style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' }, [
            document.createTextNode(`↳ ${c.a}`), speak(c.a, '听这个回答'),
          ]),
          h('p', { class: 'hint', style: 'color:var(--muted,#666);margin:6px 0 0', text: c.note }),
        ]));
      });
      // 纯展示卡：不判分、不加星、不设通关闸门（成长型思维：不留失败痕迹）
      wrap.appendChild(cardRule);
    }
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
