// Stage2 核心句型：① 句型填空（选动物填空+跟读） → ② 应答配对
// 结构：两张独立卡片，层级清晰（填空是第一步，配对是第二步）
import { h, toast, starFly, confetti } from './dom.js?v=1793705814';
import * as tts from '../services/tts.js?v=1793705814';

export function renderSentence(ctx, unit) {
  const s = unit.sentences;
  const session = ctx.session;
  const wrap = h('div');

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
    cardPair.appendChild(h('p', { class: 'card-sub', text: '换一种动物，对话就不一样——选出正确的回答。' }));
    // 动物 → 该动物的两组对话（全部取自课本：May I have/hold/touch/feed...、take good care of、导盲犬 Can he...）
    const animal = slot || 'pet';
    const dialogues = (s.dialogues && s.dialogues[animal]) || [
      { q: `May I have a ${animal}?`, a: 'Yes, you can.', zh: `我可以养一只${animal}吗？——可以。`, opts: ['Yes, you can.', "No, you can't.", 'Sure.'] },
      { q: 'May I hold it?', a: 'Sure.', zh: '我可以抱抱它吗？——当然可以。', opts: ['Sure.', 'Yes, you can.', "No, you can't."] },
    ];
    // 答案按「动物|题干」记录：换动物后所有题目（含第 2 题）自动清空重练；
    // 星标按题干记录：同题干换动物不重复加星（防刷星）
    const keyOf = (q) => `${animal}|${q}`;
    session.zhShown = session.zhShown || {};
    dialogues.forEach((pair) => {
      const answeredOk = !!session.answeredOk?.[keyOf(pair.q)];
      const chosen = session.answers?.[keyOf(pair.q)];
      // 题干行：题干 + 🔊 听题目 + 👀 中文意思（零基础支架：先自己试，卡住再扶）
      const qRow = h('div', { class: 'story-text', style: 'font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
        h('span', { text: pair.q }),
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
              toast('配对正确！');
            } else {
              ctx.addWrong({ unit: unit.id, type: 'answer_match', q: pair.q, a: pair.a, chosen: ans });
              toast('再想想看～');
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
      if (chosen && !answeredOk) box.querySelector('.story-text').appendChild(h('span', { class: 'hint', text: '（刚才选错了，再试一次）' }));
      box.appendChild(row);
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
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
