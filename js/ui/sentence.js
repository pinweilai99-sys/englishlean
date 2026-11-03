// Stage2 核心句型：① 句型填空（选动物填空+跟读） → ② 应答配对
// 结构：两张独立卡片，层级清晰（填空是第一步，配对是第二步）
import { h, toast, starFly, confetti } from './dom.js';
import * as tts from '../services/tts.js';

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

    // ───────── 卡片 2：应答配对 ─────────
    const cardPair = h('div', { class: 'card' });
    cardPair.appendChild(h('div', { class: 'card-title', text: '↔️ 第 2 步 · 应答配对' }));
    cardPair.appendChild(h('p', { class: 'card-sub', text: '听问题，选出正确的回答。' }));
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
      cardPair.appendChild(box);
    });

    const done = session.usedSlots?.length >= 3;
    cardPair.appendChild(h('div', { class: 'btn-row', style: 'margin-top:18px' }, [
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
    wrap.appendChild(cardPair);
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
