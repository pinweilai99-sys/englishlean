// 回忆卡中心（模块⑥）：May I 秒答 / 听答反推 / 看图说词 / 复述 / ou 归类
import { h, toast, starFly } from './dom.js?v=1793659532';
import * as tts from '../services/tts.js?v=1793659532';

export function renderRecall(ctx, unit) {
  const cards = unit.reviewCards;
  const session = ctx.session;
  if (typeof session.recallIndex !== 'number') session.recallIndex = 0;
  if (!session.recallResults) session.recallResults = {};

  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const i = session.recallIndex % cards.length;
    const c = cards[i];
    const res = session.recallResults[c.id];

    wrap.appendChild(h('div', { class: 'card-title', text: '🃏 回忆卡中心' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `第 ${i + 1} / ${cards.length} 张　合书也能答，才是真会了` }));

    wrap.appendChild(h('div', { class: 'story-text', style: 'text-align:center;font-size:var(--fs-lg);font-weight:800;margin:16px 0' }, [c.prompt]));

    const actions = h('div', { class: 'btn-row', style: 'justify-content:center' });
    if (c.speak) {
      actions.appendChild(h('button', { class: 'btn ghost', text: '🔊 听一听', onclick: () => tts.speak(c.speak) }));
    }
    if (c.type === 'listen_reverse') {
      actions.appendChild(h('button', { class: 'btn', text: '🔊 播放答句', onclick: () => tts.speak(c.speak) }));
    }
    actions.appendChild(h('button', {
      class: 'btn leaf', text: '✅ 我答对了',
      onclick: () => {
        session.recallResults[c.id] = true;
        ctx.addStars(1); starFly(1);
        toast('太棒了，记忆很牢！');
        session.recallIndex = (i + 1) % cards.length;
        render();
      },
    }));
    actions.appendChild(h('button', {
      class: 'btn ghost', text: '🤔 再看看',
      onclick: () => {
        session.recallResults[c.id] = false;
        ctx.addWrong({ unit: unit.id, type: c.type, q: c.prompt, a: c.answer, chosen: '（没答出）' });
        toast('没关系，已放进错题本，过几天再来～');
        session.recallIndex = (i + 1) % cards.length;
        render();
      },
    }));
    wrap.appendChild(actions);

    if (res !== undefined) {
      wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center;margin-top:12px', text: `参考答案：${c.answer}` }));
    }

    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:18px;justify-content:center' }, [
      h('button', { class: 'btn ghost', text: '⬅️ 上一张', onclick: () => { session.recallIndex = (i - 1 + cards.length) % cards.length; render(); } }),
      h('button', { class: 'btn ghost', text: '➡️ 下一张', onclick: () => { session.recallIndex = (i + 1) % cards.length; render(); } }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回单元', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
