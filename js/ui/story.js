// Stage4 巩固拓展：故事屋 + ou chant + 考点微测
import { h, toast, starFly, confetti } from './dom.js?v=1793707658';
import * as tts from '../services/tts.js?v=1793707658';

export function renderStories(ctx, unit) {
  const session = ctx.session;
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: '📚 故事屋' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '听一听、读一读、演一演' }));

    unit.stories.forEach((st) => {
      const done = (session.storiesDone || []).includes(st.id);
      const box = h('div', { class: 'card soft', style: 'margin-bottom:14px' }, [
        h('div', { class: 'card-title', style: 'font-size:var(--fs-md)', text: `${st.id} · ${st.title}` }),
        h('p', { class: 'card-sub', text: st.titleEn }),
        h('div', { class: 'story-text', style: 'margin-top:10px', text: st.text }),
        h('div', { class: 'pill-row', style: 'margin-top:10px' }, st.tasks.map((t) => h('span', { class: 'pill', text: t }))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
          h('button', { class: 'btn ghost', text: '🔊 听故事', onclick: () => tts.speak(st.text, { rate: 0.8 }) }),
          h('button', {
            class: `btn ${done ? 'ghost' : 'leaf'}`, text: done ? '✅ 已完成' : '✅ 我读完并演了',
            onclick: () => {
              const arr = session.storiesDone || [];
              if (!arr.includes(st.id)) {
                session.storiesDone = [...arr, st.id];
                ctx.addStars(2); starFly(2);
                toast('故事完成！');
              }
              render();
            },
          }),
        ]),
      ]);
      wrap.appendChild(box);
    });
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}

export function renderQuiz(ctx, unit) {
  const session = ctx.session;
  if (typeof session.quizIndex !== 'number') session.quizIndex = 0;
  if (!session.quizAnswers) session.quizAnswers = {};

  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const qs = unit.quiz;
    const answered = Object.keys(session.quizAnswers).length;
    wrap.appendChild(h('div', { class: 'card-title', text: '📝 考点微测' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `共 ${qs.length} 题，答对 80% 即通过　已答 ${answered} 题` }));

    const bar = h('div', { class: 'progress-line', style: 'margin:10px 0 18px' });
    const fill = h('div', { class: 'progress-fill', style: `width:${(answered / qs.length) * 100}%` });
    bar.appendChild(fill);
    wrap.appendChild(bar);

    qs.forEach((q, qi) => {
      const chosen = session.quizAnswers[q.id];
      const box = h('div', { style: 'margin-bottom:18px' }, [
        h('div', { style: 'font-weight:800;font-size:var(--fs-md);margin-bottom:8px', text: `${qi + 1}. ${q.prompt}` }),
      ]);
      if (q.speak && q.type === 'listen_choice') {
        box.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:8px' }, [
          h('button', { class: 'btn ghost', text: '🔊 听一遍', onclick: () => tts.speak(q.speak) }),
        ]));
      }
      q.options.forEach((opt, oi) => {
        let cls = 'option';
        if (chosen !== undefined) {
          if (oi === q.answer) cls += ' is-correct';
          else if (oi === chosen) cls += ' is-wrong';
        }
        box.appendChild(h('button', {
          class: cls, text: opt,
          onclick: () => {
            if (session.quizAnswers[q.id] !== undefined) return;
            session.quizAnswers[q.id] = oi;
            if (oi === q.answer) {
              ctx.addStars(1); starFly(1);
              toast('答对啦！');
            } else {
              ctx.addWrong({ unit: unit.id, type: q.type, q: q.prompt, a: q.options[q.answer], chosen: opt });
              toast('这题错了，已放进错题本～');
            }
            render();
            const total = Object.keys(session.quizAnswers).length;
            if (total === qs.length) {
              const right = Object.entries(session.quizAnswers).filter(([id, oi]) => qs.find((x) => x.id === id)?.answer === oi).length;
              const score = right / qs.length;
              ctx.updateUnitProgress(unit.id, (up) => ({ ...up, quizBest: Math.max(up.quizBest ?? 0, score) }));
              if (score >= 0.8) {
                toast(`🎉 测得不错！${right}/${qs.length}`, 3000);
                confetti();
              } else {
                toast(`答对 ${right}/${qs.length}，再练一练就能过～`, 3200);
              }
            }
          },
        }));
      });
      if (chosen !== undefined) {
        box.appendChild(h('p', { class: 'hint', text: `💡 ${q.explain || ''}` }));
      }
      wrap.appendChild(box);
    });

    const total = Object.keys(session.quizAnswers).length;
    const right = Object.entries(session.quizAnswers).filter(([id, oi]) => qs.find((x) => x.id === id)?.answer === oi).length;
    const done = total === qs.length;
    wrap.appendChild(h('div', { class: 'btn-row' }, [
      h('button', {
        class: 'btn', text: done && right / qs.length >= 0.8 ? '🎉 完成巩固阶段' : (done ? '🔒 正确率不足 80%' : `🔒 还剩 ${qs.length - total} 题`),
        onclick: () => {
          if (!done) { toast('把题做完再来～'); return; }
          if (right / qs.length < 0.8) { toast('正确率要 80% 以上哦，错题本可以再练'); return; }
          ctx.completeStage(unit.id, 3);
          toast('🎉 Unit 5 通关啦！', 3000);
          confetti();
        },
      }),
      h('button', {
        class: 'btn ghost', text: '🔄 重做',
        onclick: () => { session.quizAnswers = {}; render(); },
      }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
