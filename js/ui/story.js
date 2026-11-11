// Stage4 巩固拓展：故事屋 + ou chant + 考点微测
import { h, toast, starFly, confetti, stage3Nav } from './dom.js?v=1794382806';
import * as tts from '../services/tts.js?v=1794382806';

export function renderStories(ctx, unit) {
  const session = ctx.session;
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: '📚 故事屋' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '听一听、读一读、演一演' }));

    unit.stories.forEach((st) => {
      const done = (session.storiesDone || []).includes(st.id);
      session.stQuizOk = session.stQuizOk || {};
      // 中文对照门控：答完该篇全部阅读理解（全对锁定）才出现中文，防止孩子只读中文（家长定版）
      const quizOkCount = (st.quiz || []).filter((_, qi) => session.stQuizOk[`${st.id}-${qi}`]).length;
      const zhShow = !(st.quiz && st.quiz.length) || quizOkCount === st.quiz.length;
      const box = h('div', { class: 'card soft', style: 'margin-bottom:14px' }, [
        h('div', { class: 'card-title', style: 'font-size:var(--fs-md)', text: `${st.id} · ${st.title}` }),
        h('p', { class: 'card-sub', text: st.titleEn }),
      ]);

      // 对话型故事：背景旁白外置（家长要求），对话按课本标准格式分行
      if (st.lines && st.lines.length) {
        if (st.narration) {
          box.appendChild(h('div', { class: 'story-text', style: 'margin-top:10px;display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap' }, [
            h('strong', { text: '📖 背景：' }),
            h('span', {
              text: st.narration, style: 'cursor:pointer', title: '点一句听一句',
              onclick: () => tts.speak(st.narration),
            }),
            h('button', {
              class: 'st-narr-speak', title: '听背景', text: '🔊',
              style: 'border:none;background:none;cursor:pointer;font-size:inherit',
              onclick: (e) => { e.stopPropagation(); tts.speak(st.narration); },
            }),
          ]));
          if (st.narrationZh && zhShow) box.appendChild(h('p', { class: 'hint st-zh', style: 'color:var(--muted,#666)', text: `💬 ${st.narrationZh}` }));
        }
        st.lines.forEach((l) => {
          const kids = [
            h('strong', { text: `${l.who}：` }),
            h('span', {
              text: l.t, style: 'cursor:pointer', title: '点一句听一句',
              onclick: () => tts.speak(l.t),
            }),
          ];
          if (zhShow) kids.push(h('span', { class: 'st-zh', text: `（${l.zh}）`, style: 'font-size:0.78em;font-weight:600;color:var(--muted,#888)' }));
          kids.push(h('button', {
            class: 'st-line-speak', title: '听这句', text: '🔊',
            style: 'border:none;background:none;cursor:pointer;font-size:inherit',
            onclick: (e) => { e.stopPropagation(); tts.speak(l.t); },
          }));
          box.appendChild(h('div', { class: 'story-text', style: 'margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, kids));
        });
        // 中文未解锁时的引导提示（不说"错了"，只说再看一遍）
        if (st.quiz && st.quiz.length && !zhShow) {
          box.appendChild(h('p', { class: 'hint st-zh-lock', style: 'margin-top:8px', text: `👀 先读英文，答完下面的 ${st.quiz.length} 道题，中文对照就会出现哦！（已答对 ${quizOkCount}/${st.quiz.length}）` }));
        }
      } else {
        // 叙述型故事：保持课文段落文体
        box.appendChild(h('div', { class: 'story-text', style: 'margin-top:10px', text: st.text }));
      }

      box.appendChild(h('div', { class: 'pill-row', style: 'margin-top:10px' }, st.tasks.map((t) => h('span', { class: 'pill', text: t }))));

      // 阅读理解（考试题型）：判断正误 + 选择正确答案；题干中文答对该题后才出现（家长定版）
      if (st.quiz && st.quiz.length) {
        box.appendChild(h('p', { class: 'hint', style: 'margin-top:14px;font-weight:700', text: '🤔 阅读理解·考试题型练一练' }));
        box.appendChild(h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: '根据故事内容答题：先判断正误（T=对，F=错），再选出正确答案。答对一题，它的中文意思就会出现哦。' }));
        st.quiz.forEach((q, qi) => {
          const okKey = `${st.id}-${qi}`;
          const ok = !!session.stQuizOk[okKey];
          const qBox = h('div', { style: 'margin-top:8px' }, [
            h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700' }, [
              h('span', { text: `${qi + 1}. ${q.q}` }),
              h('button', {
                class: 'st-q-speak', title: '听题目', text: '🔊',
                style: 'border:none;background:none;cursor:pointer;font-size:inherit',
                onclick: () => tts.speak(q.q),
              }),
            ]),
          ]);
          // 题干中文门控：答对该题（锁定）后才显示
          if (ok) qBox.appendChild(h('p', { class: 'hint st-q-zh', style: 'color:var(--muted,#666)', text: `💬 ${q.qZh}` }));
          const row = h('div', { class: 'btn-row', style: 'margin-top:6px' });
          const opts = q.type === 'tf' ? ['T', 'F'] : q.opts;
          const labelOf = (o) => (q.type === 'tf' ? (o === 'T' ? 'T 对' : 'F 错') : o);
          opts.forEach((o) => {
            row.appendChild(h('button', {
              class: `option ${ok && o === q.a ? 'is-correct' : ''}`,
              style: 'width:auto;min-width:120px;margin-bottom:0',
              onclick: () => {
                if (session.stQuizOk[okKey]) return; // 答对锁定
                if (o === q.a) {
                  session.stQuizOk[okKey] = true;
                  ctx.addStars(1); starFly(1);
                  toast('答对啦！你真的读懂了！');
                } else {
                  ctx.addWrong({ unit: unit.id, type: 'story_quiz', q: q.q, a: q.a, chosen: o });
                  toast('再读一读，想一想～');
                }
                render();
              },
            }, [
              h('span', {
                class: 'st-opt-speak', text: '🔊', title: '听这个选项',
                style: 'margin-right:6px;cursor:pointer',
                onclick: (e) => { e.stopPropagation(); tts.speak(labelOf(o).replace(/ (对|错)$/, '')); },
              }),
              document.createTextNode(labelOf(o)),
            ]));
          });
          qBox.appendChild(row);
          box.appendChild(qBox);
        });
      }

      const allLines = st.lines && st.lines.length
        ? [st.narration, ...st.lines.map((l) => l.t)].filter(Boolean)
        : [st.text];
      box.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
        h('button', { class: 'btn ghost', text: '🔊 听整篇', onclick: () => tts.speakSequence(allLines) }),
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
      ]));
      wrap.appendChild(box);
    });
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    stage3Nav(ctx, unit, 'stories'),
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
      if (q.speak) {
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
        // 家长定版：答完（无论对错）都明确给出正确答案与解说
        box.appendChild(h('div', { class: 'quiz-explain', style: 'margin-top:8px;padding:10px 12px;background:var(--soft,#f4f7fb);border-radius:10px' }, [
          h('p', { style: 'margin:0 0 4px;font-weight:800;color:var(--ok,#1a9c6b)', text: `✅ 正确答案：${q.options[q.answer]}` }),
          h('p', { class: 'hint', style: 'margin:0', text: `💡 ${q.explain || ''}` }),
        ]));
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
    stage3Nav(ctx, unit, 'quiz'),
    wrap,
  ]);
}
