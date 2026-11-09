// 拼写屋（1.5）：单词字母拼写考察
// 规则（2026-11-03 家长再定版）：单元全部单词（含认读词）都进拼写队列，每个单词只拼 1 次；
//   拼错的单词不再自动加练，全部拼完后在完成页"拼错单词总结"区集中复习。
//   拼对仍落盘 spellingDone 并参与 Stage1 通关判定（通关仍只看四会词，认读词多练不卡人）。
// 队列生成抽成纯函数 buildSpellQueue：接受多个单元的数据，后续 U1-4 内容就位后，
//   把未掌握/需复习的单词作为附加来源传入即可自动混入（见函数注释）。
import { h, toast, starFly, confetti } from './dom.js?v=1794223260';
import * as tts from '../services/tts.js?v=1794223260';

export const SPELL_TIMES_PER_WORD = 1;   // 每个单词只拼 1 次（2026-11-03 家长定版）

// 构建本轮拼写队列（纯函数，可测）。
// units: [{ id, words }] —— 单元数据数组；wordSource 可选，指定该单元进队列的单词
//   （默认该单元全部单词）。后续 U1-4 有内容后，把"未掌握/需复习"的词通过 wordSource
//   传入即可与本单元单词混合排队，无需改本函数。
// 返回：单词字符串数组，每词 SPELL_TIMES_PER_WORD 遍；各单元依次追加，同一词不相邻。
export function buildSpellQueue(units, { timesPerWord = SPELL_TIMES_PER_WORD } = {}) {
  const queue = [];
  for (const u of units) {
    const ws = (u.wordSource || u.words).map((w) => w.w);
    for (let t = 0; t < timesPerWord; t++) queue.push(...ws);
  }
  // 让相邻两项不同（若相邻重复，与后面最近的异项交换）
  for (let i = 1; i < queue.length; i++) {
    if (queue[i] === queue[i - 1]) {
      const j = queue.findIndex((x, k) => k > i && x !== queue[i]);
      if (j > 0) [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }
  return queue;
}

export function renderSpelling(ctx, unit) {
  const allWords = unit.words;
  const session = ctx.session;

  const p = ctx.getUnitProgress(unit.id);
  const spellingDone = new Set(p?.spellingDone || []);
  const wrap = h('div', { class: 'card' });

  function shuffledLetters(word) {
    const arr = word.toLowerCase().split('');
    // 打乱（保证不与原序相同，单词长度>=2 时）
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 本轮拼写队列（session 级）：完成判定 = 队列拼空，与落盘 spellingDone 解耦。
  // 首次进入（或点"重新来一次"后 spellQueue=null）时重建。
  // TODO(U1-4)：内容就位后在此把未掌握/需复习词作为附加 unit 传入 buildSpellQueue。
  function ensureQueue() {
    if (!Array.isArray(session.spellQueue)) {
      session.spellQueue = buildSpellQueue([{ id: unit.id, words: allWords }]);
      session.spellRoundOk = new Set();   // 本轮已拼对过的词（避免重复得星）
      session.spellWrong = [];            // 本轮拼错的词（完成页总结区用）
    }
  }

  function render() {
    ensureQueue();
    wrap.innerHTML = '';
    // 本轮队列拼空：显示本轮完成态
    if (session.spellQueue.length === 0) {
      wrap.appendChild(h('div', { class: 'card-title', text: '🔤 拼写屋' }));
      wrap.appendChild(h('div', { class: 'emoji-xl', style: 'text-align:center', text: '🏆' }));
      wrap.appendChild(h('p', { style: 'text-align:center;font-weight:800;font-size:var(--fs-lg)', text: '单词全部拼完啦！' }));
      wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: '下次可以再来重拼，越拼越熟～' }));
      // 复习区：本轮拼错的单词 + 中文意思（供孩子复习；无错词则给鼓励语）
      const wrong = session.spellWrong || [];
      if (wrong.length > 0) {
        const box = h('div', { id: 'spell-wrong-review', style: 'margin:14px auto 0;max-width:360px;border-top:2px dashed var(--line,#ddd);padding-top:12px' });
        box.appendChild(h('p', { style: 'font-weight:800;text-align:center;margin-bottom:8px', text: '📝 本轮拼错的单词总结：' }));
        wrong.forEach((wordStr) => {
          const meta = allWords.find((x) => x.w === wordStr);
          if (!meta) return;
          box.appendChild(h('div', {
            class: 'spell-wrong-item',
            style: 'display:flex;align-items:center;justify-content:space-between;background:var(--bg,#f7f7f7);border-radius:12px;padding:8px 14px;margin-bottom:6px;cursor:pointer',
            onclick: () => tts.speak(meta.w),
          }, [
            h('span', { style: 'font-size:var(--fs-lg);font-weight:900;letter-spacing:2px', text: meta.w }),
            h('span', { style: 'color:#666;font-size:var(--fs-sm)', text: `${meta.zh}　🔊` }),
          ]));
        });
        box.appendChild(h('p', { class: 'hint', style: 'text-align:center;margin-top:6px', text: '点一点单词可以再听读音' }));
        wrap.appendChild(box);
      } else {
        wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: '本轮全部拼对，太棒了！' }));
      }
      wrap.appendChild(h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:12px' }, [
        h('button', {
          class: 'btn ghost', text: '🔄 重新来一次',
          onclick: () => {
            // 真正重开：清空队列让其重建（不依赖落盘 spellingDone）
            session.spellQueue = null;
            session.spellProgress = null;
            render();
          },
        }),
      ]));
      return;
    }

    // 队列头的词就是当前题
    const w = allWords.find((x) => x.w === session.spellQueue[0]);
    if (!session.spellProgress || session.spellWord !== w.w) {
      session.spellWord = w.w;
      session.spellProgress = '';
      session.spellLetters = shuffledLetters(w.w);
      session.spellUsed = [];
      session.spellMiss = 0;
    }

    const typed = session.spellProgress;
    // 计数口径统一：本轮已拼对 X / 12，当前是第 X+1 词；剩余 = 队列长度 - 当前词
    const roundOk = session.spellRoundOk.size;
    wrap.appendChild(h('div', { class: 'card-title', text: `🔤 拼写屋　第 ${roundOk + 1} / ${allWords.length} 词` }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `听一听，把这个词用字母拼出来（还剩 ${session.spellQueue.length - 1} 个词）` }));

    wrap.appendChild(h('div', { style: 'text-align:center;font-size:72px', text: w.img }));
    wrap.appendChild(h('div', { style: 'text-align:center;font-size:var(--fs-lg);font-weight:800', text: w.zh }));

    // 已拼出的字母
    const slot = h('div', {
      style: 'text-align:center;font-size:var(--fs-xl);letter-spacing:6px;font-weight:900;min-height:52px;margin:12px 0;color:var(--ok)',
      text: typed || '…',
    });
    wrap.appendChild(slot);

    // 字母块
    const letterRow = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center' });
    session.spellLetters.forEach((ch, li) => {
      if (session.spellUsed.includes(li)) return;
      letterRow.appendChild(h('button', {
        class: 'option',
        style: 'width:52px;min-height:52px;margin-bottom:0;text-transform:uppercase',
        text: ch,
        onclick: () => {
          const need = w.w[typed.length].toLowerCase();
          if (ch === need) {
            session.spellProgress = typed + ch;
            session.spellUsed.push(li);
            tts.speak(ch);
            if (session.spellProgress === w.w.toLowerCase()) {
              // 拼对：出队；落盘只在首次拼对时记一次
              session.spellQueue.shift();
              session.spellProgress = null;
              spellingDone.add(w.w);
              ctx.updateUnitProgress(unit.id, (up) => ({
                ...up,
                spellingDone: Array.from(new Set([...(up.spellingDone || []), w.w])),
              }));
              if (!session.spellRoundOk.has(w.w)) {
                session.spellRoundOk.add(w.w);
                ctx.addStars(2);
                starFly(2);
              }
              tts.speak(w.w);
              // 拼错的词：记入本轮错词清单，完成页集中总结复习（不再自动加练）
              if (session.spellMiss > 0) {
                session.spellWrong.push(w.w);
                toast('拼对啦！这个词刚才错过，最后会列出来一起复习～', 2400);
              }
              render();
              if (session.spellQueue.length === 0) {
                toast('🎉 拼写通关！', 3000);
                confetti();
                // 本轮错词清单落盘（供完成页总结区与家长查看）
                ctx.updateUnitProgress(unit.id, (up) => ({
                  ...up,
                  spellingWrong: [...(session.spellWrong || [])],
                }));
                ctx.checkStage1(unit.id);
              } else if (session.spellMiss === 0) {
                toast('拼对啦！', 1800);
              }
            } else {
              render();
            }
          } else {
            session.spellMiss += 1;
            toast('这个字母不对哦，再听听读音～');
            if (session.spellMiss >= 3) toast(`提示：第一个字母是 "${w.w[0].toUpperCase()}"`, 3000);
          }
        },
      }));
      void li;
    });
    wrap.appendChild(letterRow);

    wrap.appendChild(h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:14px' }, [
      h('button', { class: 'btn ghost', text: '🔊 听发音', onclick: () => tts.speak(w.w) }),
      h('button', {
        class: 'btn ghost', text: '↩️ 重拼',
        onclick: () => { session.spellProgress = ''; session.spellUsed = []; render(); },
      }),
      h('button', {
        class: 'btn ghost', text: '⏭️ 跳过这个（稍后再拼）',
        onclick: () => {
          // 跳过不落盘，不卡死；当前词挪到队尾，队空仍需拼完才能通关
          session.spellQueue.push(session.spellQueue.shift());
          session.spellProgress = null;
          render();
        },
      }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
    h('p', { class: 'hint', text: '小贴士：每个单词只拼 1 次。拼错的单词会在最后列出来一起复习。拼错了没关系，再来一次就记住啦。' }),
  ]);
}
