// 听音选词（听写）：本单元全部 12 词逐词听写，一词一题。
// 每题播放目标词（listenPairs[i][0]），孩子从两个选项中选出听到的词。
// 答错自动入错题本；一轮 12 题全部完成后结束并展示成绩，
// 由孩子/家长选择"再来一轮"或返回，不再自动无限循环。
import { h, toast, starFly } from './dom.js?v=1793840999';
import * as tts from '../services/tts.js?v=1793840999';

export function renderListen(ctx, unit) {
  const pairs = unit.listenPairs; // [目标词, 干扰词]，播放的永远是目标词
  const session = ctx.session;
  if (typeof session.listenIndex !== 'number') session.listenIndex = 0;
  if (typeof session.listenRight !== 'number') session.listenRight = -1;
  if (typeof session.listenCorrect !== 'number') session.listenCorrect = 0;
  if (typeof session.roundTotal !== 'number') session.roundTotal = 0;
  if (typeof session.roundCorrect !== 'number') session.roundCorrect = 0;
  if (session.listenDone !== true) session.listenDone = false;

  const wrap = h('div', { class: 'card' });

  // 一轮结束：正确率落盘并检查 Stage1 自动通关
  function finishRound() {
    const total = session.roundTotal;
    const correct = session.roundCorrect;
    const score = correct / total;
    ctx.updateUnitProgress(unit.id, (up) => ({ ...up, listenScore: Math.max(up.listenScore ?? 0, score) }));
    ctx.checkStage1(unit.id);
    session.roundTotal = 0;
    session.roundCorrect = 0;
    session.listenLast = { correct, total, score };
    session.listenDone = true;
    renderDone();
  }

  // 完成页：展示本轮成绩，由用户决定是否再来一轮（不自动循环）
  function renderDone() {
    const { correct, total, score } = session.listenLast;
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: '🎉 本轮听音选词完成！' }));
    wrap.appendChild(h('p', {
      class: 'card-sub',
      text: `${pairs.length} 个单词都听写完了　本轮答对 ${correct} / ${total} 题`,
    }));
    const msg = score === 1 ? '🌟 满分！小耳朵真灵～'
      : score >= 0.8 ? '👍 很棒，达到通关线啦！'
        : '💪 再听一轮会更厉害，试试吧！';
    wrap.appendChild(h('p', { text: msg, style: 'margin:12px 0 16px;font-size:17px' }));
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:6px' }, [
      h('button', {
        class: 'btn',
        text: '🔁 再来一轮（重新听写）',
        onclick: () => {
          session.listenIndex = 0;
          session.roundTotal = 0;
          session.roundCorrect = 0;
          session.listenRight = -1;
          session.listenAnswer = null;
          session.listenDone = false;
          render();
        },
      }),
    ]));
  }

  function render() {
    // 一轮已完成（无论是否中途离开过）→ 停在完成页，直到点"再来一轮"
    if (session.listenDone && session.listenLast) { renderDone(); return; }
    wrap.innerHTML = '';
    const i = session.listenIndex;
    const [target, distractor] = pairs[i];
    // 关键：播放的词就是本题正确答案（听什么选什么）
    session.listenAnswer = target;
    // 选项顺序按题号交错排布（稳定、防"第一个总是答案"的规律）
    const options = i % 2 === 0 ? [target, distractor] : [distractor, target];

    wrap.appendChild(h('div', { class: 'card-title', text: '👂 听音选词' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `本轮第 ${session.roundTotal + 1} / ${pairs.length} 题　本轮答对 ${session.roundCorrect} 题` }));

    const play = h('button', {
      class: 'btn', text: '🔊 播放这个词',
      onclick: async () => { await tts.speak(session.listenAnswer); },
    });
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin:14px 0' }, [play]));

    const opts = h('div', {});
    options.forEach((w) => {
      const btn = h('button', {
        class: 'option', text: w,
        onclick: () => {
          if (session.listenRight !== -1) return;
          const chosen = w;
          const correctWord = target;
          if (chosen === correctWord) {
            session.listenRight = 1;
            btn.classList.add('is-correct');
            session.listenCorrect += 1;
            session.roundCorrect += 1;
            ctx.addStars(1);
            starFly(1);
            toast('答对啦！耳朵真灵～');
          } else {
            session.listenRight = 0;
            btn.classList.add('is-wrong');
            ctx.addWrong({
              unit: unit.id, type: 'listen_choice',
              q: `听音选词（${target} / ${distractor}）`, a: correctWord,
              chosen,
            });
            toast('这次没选对，已经放进错题本啦～');
          }
          session.roundTotal += 1;
          setTimeout(() => {
            session.listenRight = -1;
            session.listenAnswer = null;
            if (session.roundTotal >= pairs.length) {
              finishRound(); // 一轮结束：出完成页，不再自动出题
            } else {
              session.listenIndex = i + 1;
              render();
            }
          }, 1200);
        },
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);
  }

  render();

  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
