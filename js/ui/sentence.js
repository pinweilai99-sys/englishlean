// Stage2 核心句型：句型块呈现 → 替换操练 → 应答配对
import { h, toast, starFly, confetti } from './dom.js';
import * as tts from '../services/tts.js';

export function renderSentence(ctx, unit) {
  const s = unit.sentences;
  const session = ctx.session;
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: '💬 核心句型' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '你已经会读单词啦，现在把它们放进句子！' }));

    // 1. 句型块
    const slot = session.slot || s.slots[0];
    const sentence = s.pattern.replace('___', slot);
    const patternBox = h('div', { class: 'story-text', style: 'text-align:center;font-size:var(--fs-xl);font-weight:900' }, [
      s.pattern.replace('___', h('span', { style: 'color:var(--brand-strong)', text: slot })),
    ]);
    wrap.appendChild(patternBox);
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin:12px 0' }, [
      h('button', { class: 'btn', text: '🔊 听整句', onclick: () => tts.speak(sentence) }),
    ]));

    // 2. 替换操练
    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:16px', text: '🔁 换一换：点动物换进句子里' }));
    const slotRow = h('div', { class: 'word-bank', style: 'margin-top:10px' });
    s.slots.forEach((w) => {
      slotRow.appendChild(h('button', {
        class: `word-bank-item ${w === slot ? 'is-done' : ''}`,
        text: w,
        onclick: () => { session.slot = w; render(); },
      }));
    });
    wrap.appendChild(slotRow);

    const used = new Set(session.usedSlots || []);
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
      h('button', {
        class: 'btn leaf', text: '🎤 我读出来了',
        onclick: () => {
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
    wrap.appendChild(h('p', { class: 'hint', text: `已成功替换 ${used.size} / 3 种动物（达到 3 种即完成）` }));

    // 3. 应答配对
    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '↔️ 应答配对' }));
    const pairs = [
      { q: 'May I have a pet?', a: 'Yes, you can.' },
      { q: 'May I have a rabbit?', a: 'No, you can\'t.' },
      { q: 'May I hold it?', a: 'Sure.' },
    ];
    pairs.forEach((pair, i) => {
      const answered = session.answers?.[i];
      const box = h('div', { style: 'margin-bottom:12px' }, [
        h('div', { class: 'story-text', style: 'font-weight:800', text: pair.q }),
      ]);
      const row = h('div', { class: 'btn-row', style: 'margin-top:8px' });
      s.answers.concat(['Sure.']).forEach((ans) => {
        row.appendChild(h('button', {
          class: `option ${answered ? (ans === pair.a ? 'is-correct' : 'is-wrong') : ''}`,
          style: 'width:auto;min-width:150px;margin-bottom:0',
          text: ans,
          onclick: () => {
            if (answered !== undefined) return;
            session.answers = session.answers || {};
            session.answers[i] = ans;
            if (ans === pair.a) {
              ctx.addStars(1); starFly(1);
              toast('配对正确！');
            } else {
              ctx.addWrong({ unit: unit.id, type: 'answer_match', q: pair.q, a: pair.a, chosen: ans });
              toast('再想想看～');
            }
            render();
            const ok = Object.values(session.answers || {}).filter((v, idx) => v === pairs[idx].a).length;
            if (ok === pairs.length) {
              toast('🎉 应答全部配对成功！', 3000);
              confetti();
              ctx.completeStage(unit.id, 1);
            }
          },
        }));
      });
      box.appendChild(row);
      wrap.appendChild(box);
    });

    const done = session.usedSlots?.length >= 3;
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:18px' }, [
      h('button', {
        class: 'btn', text: done ? '✅ 完成句型阶段' : '🔒 完成替换 3 种动物后解锁',
        onclick: () => {
          if (!done) { toast('再替换几种动物吧～'); return; }
          ctx.completeStage(unit.id, 1);
          toast('🎉 核心句型完成！', 3000);
          confetti();
        },
      }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
