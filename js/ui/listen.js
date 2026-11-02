// 听辨游戏：最小对立对（pet/get, may/my …），答错自动入错题本
import { h, toast, starFly } from './dom.js';
import * as tts from '../services/tts.js';

export function renderListen(ctx, unit) {
  const pairs = unit.listenPairs;
  const session = ctx.session;
  if (typeof session.listenIndex !== 'number') session.listenIndex = 0;
  if (typeof session.listenRight !== 'number') session.listenRight = -1;
  if (typeof session.listenCorrect !== 'number') session.listenCorrect = 0;

  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const i = session.listenIndex % pairs.length;
    const [a, b] = pairs[i];

    wrap.appendChild(h('div', { class: 'card-title', text: '👂 听音选词' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `第 ${i + 1} / ${pairs.length} 题　答对 ${session.listenCorrect} 题` }));

    const play = h('button', {
      class: 'btn', text: '🔊 播放这个词',
      onclick: async () => {
        // 随机播放其中一个，制造真正的辨音任务
        const word = Math.random() < 0.5 ? a : b;
        await tts.speak(word);
      },
    });
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin:14px 0' }, [play]));

    const opts = h('div', {});
    [a, b].forEach((w, oi) => {
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
          setTimeout(() => {
            session.listenIndex = (i + 1) % pairs.length;
            session.listenRight = -1;
            session.listenAnswer = null;
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
