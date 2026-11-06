// Stage3 真实输出：角色扮演 / Let's Write / 思维导图
import { h, toast, starFly, confetti } from './dom.js?v=1793940690';
import * as tts from '../services/tts.js?v=1793940690';
import * as recorder from '../services/recorder.js?v=1793940690';

export function renderOutput(ctx, unit) {
  const session = ctx.session;
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: '🎭 真实输出' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '把学到的用出来，才是真会了' }));

    // 1. 角色扮演
    const rp = unit.roleplay;
    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:12px', text: '① 宠物店角色扮演' }));
    wrap.appendChild(h('p', { class: 'hint', text: rp.scene }));
    const pick = session.rpSlot || rp.child;
    const grid = h('div', { class: 'word-bank', style: 'margin-top:10px' });
    unit.sentences.slots.forEach((w) => {
      grid.appendChild(h('button', {
        class: `word-bank-item ${w === session.rpSlot ? 'is-done' : ''}`,
        text: w,
        onclick: () => { session.rpSlot = w; render(); },
      }));
    });
    wrap.appendChild(grid);

    const kidLine = rp.child.replace('___', session.rpSlot || 'pet');
    const kidZh = (rp.childZh || '').replace('___', session.rpSlot || '小宠物');
    const dialog = h('div', { class: 'story-text', style: 'margin-top:12px' }, [
      h('div', { style: 'margin-bottom:10px' }, [h('strong', { text: '🧒 孩子：' }), kidLine]),
      kidZh ? (session.rpDone
        ? h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: `💬 ${kidZh}` })
        : h('p', { class: 'hint', style: 'color:var(--muted,#aaa)', text: '💬（演完后看中文）' })) : null,
      h('div', { style: 'margin-bottom:10px' }, [h('strong', { text: '👨‍👩‍👦 家长：' }), session.rpParent || '（请家长选一句）']),
    ]);
    wrap.appendChild(dialog);

    // 家长支架：看中文意思 → 点 🔊 听发音 → 照着说出这句英语（家长也不一定认识英文）
    wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: '👨‍👩‍👦 家长照着说：看中文 → 点 🔊 听发音 → 大声说出这句话' }));

    const parentRow = h('div', { class: 'btn-row', style: 'margin-top:10px' });
    rp.parent.forEach((a) => {
      const zh = rp.parentZh && rp.parentZh[a];
      parentRow.appendChild(h('button', {
        class: `option ${session.rpParent === a ? 'is-correct' : ''}`,
        style: 'width:auto;min-width:150px;margin-bottom:0',
        onclick: () => { session.rpParent = a; tts.speak(a); render(); },
      }, [
        // 🔊 听发音：点喇叭只朗读不选中
        h('span', {
          class: 'rp-speak', text: '🔊', title: '听这句怎么说',
          style: 'margin-right:6px;cursor:pointer',
          onclick: (e) => { e.stopPropagation(); tts.speak(a); },
        }),
        h('span', { style: 'display:flex;flex-direction:column;align-items:center;line-height:1.35' }, [
          document.createTextNode(a),
          zh ? h('span', { class: 'rp-zh', text: zh, style: 'font-size:0.72em;font-weight:600;color:var(--muted,#888)' }) : null,
        ]),
      ]));
    });
    wrap.appendChild(parentRow);

    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
      h('button', { class: 'btn ghost', text: '🔊 听孩子台词', onclick: () => tts.speak(kidLine) }),
      h('button', {
        class: 'btn leaf', text: '✅ 演完了',
        onclick: () => {
          session.rpDone = true;
          ctx.addStars(2); starFly(2);
          toast('演得真好！');
          render();
        },
      }),
    ]));

    // 2. Let's Write（三步脚手架：① 听情境选句子 → ② 三句连读输出 → ③ 选做打字挑战）
    //    零基础孩子"凭空写三句"必然卡死；降级为"选句运用"（考同句型不同情境的灵活运用），
    //    选完连读成文——会读出来就是他的作文。挑战层留给愿意打字的孩子。
    const wr = unit.writing;
    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:24px', text: "② Let's Write" }));
    wrap.appendChild(h('p', { class: 'hint', text: wr.prompt }));
    wrap.appendChild(h('p', { class: 'hint', style: 'font-weight:700', text: '👇 第 1 步：看情境，点 🔊 听一听，选出最合适的那句话' }));
    session.wrPick = session.wrPick || {};
    const wrItems = wr.items || [];
    wrItems.forEach((it, i) => {
      const picked = session.wrPick[i];
      const ok = picked === it.a;
      // 对话结构：情境 → 孩子台词（英文+中文+🔊）→ 👉店员回答（用户点选）
      const box = h('div', { 'data-ctxzh': it.ctxZh, style: 'margin-bottom:12px' }, [
        // 情境句是英语，必须有播放（铁律：只要是英语就要有 🔊）
        h('div', { class: 'story-text', style: 'font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
          h('span', { text: it.ctx }),
          h('button', {
            class: 'wr-ctx-speak', title: '听情境', text: '🔊',
            style: 'border:none;background:none;cursor:pointer;font-size:inherit',
            onclick: (e) => { e.stopPropagation(); tts.speak(it.ctx); },
          }),
        ]),
        it.ctxZh ? (ok
          ? h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: `💬 ${it.ctxZh}` })
          : h('p', { class: 'hint', style: 'color:var(--muted,#aaa)', text: '💬（选对后看中文）' })) : null,
        it.ask ? h('div', { class: 'story-text', style: 'margin-top:6px;font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
          h('strong', { text: `🧒 ${it.askWho}：` }),
          h('span', { text: it.ask }),
          h('button', {
            class: 'wr-ask-speak', title: '听这句话', text: '🔊',
            style: 'border:none;background:none;cursor:pointer;font-size:inherit',
            onclick: (e) => { e.stopPropagation(); tts.speak(it.ask); },
          }),
        ]) : null,
        it.askZh ? (ok
          ? h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: `💬 ${it.askZh}` })
          : h('p', { class: 'hint', style: 'color:var(--muted,#aaa)', text: '💬（选对后看中文）' })) : null,
        h('p', { class: 'hint', style: 'font-weight:700;margin-top:6px', text: '👉 店员回答（点选最合适的）:' }),
      ]);
      const row = h('div', { class: 'btn-row', style: 'margin-top:8px' });
      (it.opts || []).forEach((ans) => {
        row.appendChild(h('button', {
          // 选对后只标绿锁定；选错可重试且不留红（成长型思维：不留失败痕迹）
          class: `option ${ok && ans === it.a ? 'is-correct' : ''}`,
          style: 'width:auto;min-width:150px;margin-bottom:0',
          onclick: () => {
            if (session.wrPick[i] === it.a) return; // 选对的题锁定
            if (ans === it.a) {
              session.wrPick[i] = ans;
              session.wrStarred = session.wrStarred || {};
              if (!session.wrStarred[i]) { session.wrStarred[i] = true; ctx.addStars(1); starFly(1); }
              toast('选对啦！');
            } else {
              ctx.addWrong({ unit: unit.id, type: 'writing_pick', q: it.ctxZh, a: it.a, chosen: ans });
              toast('再想想看～');
            }
            render();
          },
        }, [
          h('span', {
            class: 'wr-speak', text: '🔊', title: '听这句话',
            style: 'margin-right:6px;cursor:pointer',
            onclick: (e) => { e.stopPropagation(); tts.speak(ans); },
          }),
          h('span', { style: 'display:flex;flex-direction:column;align-items:center;line-height:1.35' }, [
            document.createTextNode(ans),
            ok && ans === it.a && wr.zhMap && wr.zhMap[ans] ? h('span', { class: 'wr-zh', text: wr.zhMap[ans], style: 'font-size:0.72em;font-weight:600;color:var(--muted,#888)' }) : null,
          ]),
        ]));
      });
      box.appendChild(row);
      wrap.appendChild(box);
    });

    const wrAllOk = wrItems.length > 0 && wrItems.every((it, i) => session.wrPick[i] === it.a);
    if (wrAllOk) {
      // 完整对话：🧒孩子问句 + 👩店员回答 成对显示（家长反馈：只有答不是完整对话）
      const allLines = wrItems.flatMap((it) => [it.ask, it.a]).filter(Boolean);
      const doneBox = h('div', { class: 'wr-done', style: 'margin-top:12px' }, [
        // 是"三段对话"不是"作文"——对话逻辑：问→答→再问答，连起来演一演（家长的严谨反馈）
        h('p', { class: 'hint', style: 'font-weight:800', text: '🎉 第 2 步：三段对话连起来，演一演吧：' }),
      ]);
      wrItems.forEach((it) => {
        doneBox.appendChild(h('div', { class: 'story-text', style: 'margin-bottom:6px;cursor:pointer', title: '点一句读一句', onclick: () => tts.speak(it.ask) }, [
          h('strong', { text: `🧒 ${it.askWho}：` }),
          h('span', { text: it.ask }),
        ]));
        doneBox.appendChild(h('div', { class: 'story-text', style: 'margin-bottom:6px;margin-left:18px;cursor:pointer', title: '点一句读一句', onclick: () => tts.speak(it.a) }, [
          h('strong', { text: '👩 店员：' }),
          h('span', { text: it.a }),
        ]));
      });
      doneBox.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
        h('button', { class: 'btn ghost', text: '🔊 整段连读', onclick: () => tts.speakSequence(allLines) }),
        h('button', {
          class: 'btn leaf', text: '✅ 这三句我会了',
          onclick: () => {
            session.writeDone = true;
            ctx.addStars(2); starFly(2);
            toast('说得真好！');
            render();
          },
        }),
      ]));
      wrap.appendChild(doneBox);
    } else {
      wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: '🔒 三段对话都选对了，就能连起来演一遍啦！' }));
    }

    // 挑战层（选做）：自由创作——孩子学会了对话，自己编一段对话或写一段介绍
    // 句型支架示例全部用已生成音频的句子（英语必有播放铁律），点 🔊 听示范
    wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:14px;font-weight:700', text: '✏️ 挑战（选做）：学着自己写——编一段对话，或介绍你的宠物' }));
    const chalBox = h('div', { style: 'margin-top:6px' });
    const chalExamples = [
      { label: '对话示范：', lines: ['May I have a cat?', 'Yes, you can.'] },
      { label: '介绍示范：', lines: ['I want a dog.', 'It has short legs.', 'I love my pet!'] },
    ];
    chalExamples.forEach((ex) => {
      chalBox.appendChild(h('div', { class: 'story-text', style: 'margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
        h('strong', { text: ex.label }),
        h('span', { text: ex.lines.join(' ') }),
        h('button', {
          class: 'wr-challenge-speak', title: '听示范', text: '🔊',
          style: 'border:none;background:none;cursor:pointer;font-size:inherit',
          onclick: (e) => { e.stopPropagation(); tts.speakSequence(ex.lines); },
        }),
      ]));
    });
    wrap.appendChild(chalBox);

    // 范文对话：课文范围内的完整示范对话（标准对话格式：说话人+英文+中文，每句 🔊，整段连读）
    const sd = wr.sampleDialogue;
    if (sd && (sd.lines || []).length) {
      wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:12px;font-weight:700', text: `📖 范文对话（点一句听一句）｜${sd.scene}` }));
      const sdLines = sd.lines;
      sdLines.forEach((l) => {
        wrap.appendChild(h('div', { class: 'story-text', style: 'margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
          h('strong', { text: `${l.who}：` }),
          h('span', {
            text: l.t, style: 'cursor:pointer', title: '点一句听一句',
            onclick: () => tts.speak(l.t),
          }),
          session.sdListened ? h('span', { text: `（${l.zh}）`, style: 'font-size:0.78em;font-weight:600;color:var(--muted,#888)' }) : h('span', { text: '（听完后看中文）', style: 'font-size:0.78em;font-weight:600;color:var(--muted,#aaa)' }),
          h('button', {
            class: 'sd-speak', title: '听这句', text: '🔊',
            style: 'border:none;background:none;cursor:pointer;font-size:inherit',
            onclick: (e) => { e.stopPropagation(); tts.speak(l.t); },
          }),
        ]));
      });
      wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:6px' }, [
        h('button', {
          class: 'btn ghost', text: '🔊 范文整段连读',
          onclick: () => { session.sdListened = true; tts.speakSequence(sdLines.map((l) => l.t)); render(); },
        }),
      ]));
    }

    const ta = h('textarea', {
      class: 'text-input',
      placeholder: '选做：把你自己编的对话或介绍写在这里～',
      oninput: (e) => { session.writeText = e.target.value; },
    });
    if (session.writeText) ta.value = session.writeText;
    wrap.appendChild(ta);
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:10px' }, [
      h('button', {
        class: 'btn ghost', text: '🎤 说出来（录音）',
        onclick: async () => {
          const ok = await recorder.start();
          if (!ok.ok) { toast('没有麦克风，读出来也一样棒！'); return; }
          toast('🎤 请说出你的三句话…');
          await new Promise((r) => setTimeout(r, 3500));
          await recorder.stop();
          toast('说得真清楚！');
        },
      }),
    ]));

    // 4. 思维导图（四问互动引导 + 自动拼装介绍词）
    //    课本 H 板块"Let's Learn to Learn"：用 4 个问题组织一段宠物介绍。
    //    孩子不会凭空说 → 把大任务拆成 4 个"点选答案"微任务（无对错，选什么就是自己的答案），
    //    4 答自动拼装成介绍词 → 逐句可听 + 整段连读 → 跟读完成。Q3 特征句随 Q2 动物联动。
    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:24px', text: '③ 宠物思维导图' }));
    wrap.appendChild(h('p', { class: 'hint', style: 'font-weight:700', text: '回答 4 个小问题，就能拼出你自己的宠物介绍！' }));
    const mm = unit.mindmap;
    session.mmPick = session.mmPick || {};
    const mmSteps = mm.steps || [];
    const mmOptBtn = (o, i) => h('button', {
      // 开放问题：无对错，点选即填入，可换答案；选中项标绿
      class: `option ${session.mmPick[i] && session.mmPick[i].t === o.t ? 'is-correct' : ''}`,
      style: 'width:auto;min-width:150px;margin-bottom:0',
      onclick: () => {
        session.mmPick[i] = o;
        if (i === 1) {
          // 第 2 问换动物 → 第 3 问特征句随之变化，已选的第 3 问答案必须清空（对齐句型页换动物清空逻辑）
          const m = o.t.match(/^I want a (cat|dog|rabbit|goldfish|parrot)\.$/);
          if (m && session.mmAnimal !== m[1]) {
            session.mmAnimal = m[1];
            delete session.mmPick[2];
          }
        }
        render();
      },
    }, [
      h('span', {
        class: 'mm-speak', text: '🔊', title: '听这句话',
        style: 'margin-right:6px;cursor:pointer',
        onclick: (e) => { e.stopPropagation(); tts.speak(o.t); },
      }),
      h('span', { style: 'display:flex;flex-direction:column;align-items:center;line-height:1.35' }, [
        document.createTextNode(o.t),
        !!session.mmPick[i] && o.zh ? h('span', { class: 'mm-zh', text: o.zh, style: 'font-size:0.72em;font-weight:600;color:var(--muted,#888)' }) : null,
      ]),
    ]);
    mmSteps.forEach((st, i) => {
      const box = h('div', { style: 'margin-bottom:14px' }, [
        h('div', { class: 'story-text', style: 'font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
          h('span', { class: 'stage-no', text: String(i + 1) }),
          h('span', { text: st.q }),
          h('button', {
            class: 'mm-q-speak', title: '听问题', text: '🔊',
            style: 'border:none;background:none;cursor:pointer;font-size:inherit',
            onclick: (e) => { e.stopPropagation(); tts.speak(st.q); },
          }),
        ]),
        st.qZh ? (!!session.mmPick[i]
          ? h('p', { class: 'hint', style: 'color:var(--muted,#666)', text: `💬 ${st.qZh}` })
          : h('p', { class: 'hint', style: 'color:var(--muted,#aaa)', text: '💬（选好后看中文）' })) : null,
      ]);
      const row = h('div', { class: 'btn-row', style: 'margin-top:8px' });
      if (i === 2) {
        // 特征句随第 2 问选的动物联动；换动物后第 3 问已选答案自动清空
        const feat = (st.featureByAnimal || {})[session.mmAnimal || 'cat'] || st.extra;
        [feat, st.extra].filter(Boolean).forEach((o) => row.appendChild(mmOptBtn(o, i)));
      } else {
        (st.opts || []).forEach((o) => row.appendChild(mmOptBtn(o, i)));
      }
      box.appendChild(row);
      wrap.appendChild(box);
    });

    const mmAllOk = mmSteps.length > 0 && mmSteps.every((st, i) => !!session.mmPick[i]);
    if (mmAllOk) {
      const lines = mmSteps.map((st, i) => session.mmPick[i].t).concat(mm.ending ? [mm.ending.t] : []);
      const mmDoneBox = h('div', { style: 'margin-top:12px' }, [
        h('p', { class: 'hint', style: 'font-weight:800', text: '🎉 第 2 步：你的宠物介绍词拼好啦！读一读吧：' }),
      ]);
      lines.forEach((ln) => {
        mmDoneBox.appendChild(h('p', {
          class: 'story-text', style: 'margin-bottom:6px;cursor:pointer', title: '点一句读一句',
          text: ln,
          onclick: () => tts.speak(ln),
        }));
      });
      mmDoneBox.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
        h('button', { class: 'btn ghost', text: '🔊 整段连读', onclick: () => tts.speakSequence(lines) }),
        h('button', {
          class: 'btn leaf', text: '✅ 我的宠物介绍好了',
          onclick: () => { session.mmDone = true; ctx.addStars(2); starFly(2); toast('太棒了！'); render(); },
        }),
      ]));
      wrap.appendChild(mmDoneBox);
    } else {
      wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: '🔒 四个问题都选好了，就能拼出你的宠物介绍！' }));
    }
    // 课本示范是英语：🔊 语音版 + 英文文字版（家长定版：语音下面加文字版，点文字可再听）
    wrap.appendChild(h('div', { class: 'hint', style: 'margin-top:10px;display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap' }, [
      h('span', { text: '📖 课本示范：' }),
      h('button', {
        class: 'mm-sample-speak', title: '听课本示范', text: '🔊 听示范',
        style: 'border:none;background:none;cursor:pointer;font-size:inherit;color:var(--brand,#2a7)',
        onclick: () => tts.speak(mm.sample),
      }),
    ]));
    wrap.appendChild(h('p', {
      class: 'story-text', style: 'margin-top:6px;cursor:pointer', title: '点一下再听一遍',
      text: mm.sample,
      onclick: () => tts.speak(mm.sample),
    }));

    // 底部：明示还剩哪几项没做（家长建议：三项里没做的要在底部提示）
    const missing = [];
    if (!session.rpDone) missing.push('① 宠物店角色扮演');
    if (!session.writeDone) missing.push("② Let's Write 对话");
    if (!session.mmDone) missing.push('③ 宠物思维导图');
    const allDone = missing.length === 0;
    wrap.appendChild(h('p', {
      class: 'hint', style: 'margin-top:16px;font-weight:700',
      text: allDone ? '🎉 三项任务都完成啦，点下面收下你的成果！' : `📝 还没完成：${missing.join('、')}`,
    }));
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:20px' }, [
      h('button', {
        class: 'btn', text: allDone ? '🎉 完成输出阶段' : '🔒 完成三项后解锁',
        onclick: () => {
          if (!allDone) { toast(`还差：${missing.join('、')}`); return; }
          ctx.completeStage(unit.id, 2);
          toast('🎉 真实输出完成！', 3000);
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
