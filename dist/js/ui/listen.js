// 听辨游戏：最小对立对（pet/get, may/my …），答错自动入错题本
// 每轮结束把正确率落盘 listenScore，并触发 Stage1 自动通关检查。
import { h, toast, starFly } from './dom.js?v=1793627245';
import * as tts from '../services/tts.js?v=1793627245';

export function renderListen(ctx, unit) {
  const pairs = unit.listenPairs;
  const session = ctx.session;
  if (typeof session.listenIndex !== 'number') session.listenIndex = 0;
  if (typeof session.listenRight !== 'number') session.listenRight = -1;
  if (typeof session.listenCorrect !== 'number') session.listenCorrect = 0;
  if (typeof session.roundTotal !== 'number') session.roundTotal = 0;
  if (typeof session.roundCorrect !== 'number') session.roundCorrect = 0;

  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const i = session.listenIndex % pairs.length;
    const [a, b] = pairs[i];
    // 每题开始时生成本题正确答案（上一题答完后被置空）
    if (!session.listenAnswer) {
      session.listenAnswer = Math.random() < 0.5 ? a : b;
    }

    wrap.appendChild(h('div', { class: 'card-title', text: '👂 听音选词' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `本轮第 ${session.roundTotal + 1} / ${pairs.length} 题　本轮答对 ${session.roundCorrect} 题` }));

    const play = h('button', {
      class: 'btn', text: '🔊 播放这个词',
      onclick: async () => {
        // 关键：播放的词就是本轮的正确答案，孩子听什么选什么（真正的辨音）
        await tts.speak(session.listenAnswer);
      },
    });
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin:14px 0' }, [play]));

    const opts = h('div', {});
    [a, b].forEach((w) => {
      const btn = h('button', {
        class: 'option', text: w,
        onclick: () => {
          if (session.listenRight !== -1) return;
          const chosen = w;
          const correctWord = session.listenAnswer || a;
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
              q: `听音选词（${a} / ${b}）`, a: correctWord,
              chosen,
            });
            toast('这次没选对，已经放进错题本啦～');
          }
          session.roundTotal += 1;
          setTimeout(() => {
            session.listenIndex = (i + 1) % pairs.length;
            session.listenRight = -1;
            session.listenAnswer = null;
            // 一轮结束：正确率落盘并检查 Stage1 自动通关
            if (session.roundTotal >= pairs.length) {
              const score = session.roundCorrect / session.roundTotal;
              ctx.updateUnitProgress(unit.id, (up) => ({ ...up, listenScore: Math.max(up.listenScore ?? 0, score) }));
              session.roundTotal = 0;
              session.roundCorrect = 0;
              ctx.checkStage1(unit.id);
            }
            render();
          }, 1200);
        },
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);
  }

  // 每次刷新时确定本轮正确答案（播放前先确定，避免与播放不一致）
  function nextAnswer() {
    const i = session.listenIndex % pairs.length;
    const [a, b] = pairs[i];
    session.listenAnswer = Math.random() < 0.5 ? a : b;
  }
  nextAnswer();
  render();

  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
