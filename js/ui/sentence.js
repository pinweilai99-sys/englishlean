// Stage2 核心句型：① 句型填空（选动物填空+跟读） → ② 应答配对
// 结构：两张独立卡片，层级清晰（填空是第一步，配对是第二步）
import { h, toast, starFly, confetti } from './dom.js?v=1793688775';
import * as tts from '../services/tts.js?v=1793688775';

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

    // ───────── 卡片 2：应答配对（跟随所选动物出题） ─────────
    const cardPair = h('div', { class: 'card' });
    cardPair.appendChild(h('div', { class: 'card-title', text: '↔️ 第 2 步 · 应答配对' }));
    cardPair.appendChild(h('p', { class: 'card-sub', text: '用你选的动物提问，选出正确的回答。' }));
    // 题干跟随当前所选动物（未选时退回课本原句 pet）；按题干文本记录答案，换动物后题目自动重置
    const pairs = [
      { q: `May I have a ${slot || 'pet'}?`, a: 'Yes, you can.' },
      { q: 'May I hold it?', a: 'Sure.' },
    ];
    pairs.forEach((pair) => {
      const answeredOk = !!session.answeredOk?.[pair.q];
      const chosen = session.answers?.[pair.q];
      const box = h('div', { style: 'margin-bottom:12px' }, [
        h('div', { class: 'story-text', style: 'font-weight:800', text: pair.q }),
      ]);
      const row = h('div', { class: 'btn-row', style: 'margin-top:8px' });
      s.answers.concat(['Sure.']).forEach((ans) => {
        row.appendChild(h('button', {
          class: `option ${answeredOk ? (ans === pair.a ? 'is-correct' : 'is-wrong') : ''}`,
          style: 'width:auto;min-width:150px;margin-bottom:0',
          text: ans,
          onclick: () => {
            if (answeredOk) return; // 答对的题锁定；答错可重试
            if (ans === pair.a) {
              session.answers = session.answers || {};
              session.answeredOk = session.answeredOk || {};
              session.answers[pair.q] = ans;
              session.answeredOk[pair.q] = true;
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
            const ok = pairs.every((p) => session.answeredOk?.[p.q]);
            if (ok) {
              toast('🎉 应答全部配对成功！', 3000);
              confetti();
              ctx.completeStage(unit.id, 1);
            }
          },
        }));
      });
      if (chosen && !answeredOk) box.querySelector('.story-text').appendChild(h('span', { class: 'hint', text: '（刚才选错了，再试一次）' }));
      box.appendChild(row);
      cardPair.appendChild(box);
    });

    const done = session.usedSlots?.length >= 3 && pairs.every((p) => session.answeredOk?.[p.q]);
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
