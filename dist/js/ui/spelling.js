// 拼写屋（1.4）：四会词字母拼写考察
// 规则：四会词必须"会读会写"，逐词用字母块拼出；支持提示与重试；
//       认读词不要求拼写（零基础不卡死）；拼过落盘 spellingDone 并参与 Stage1 通关判定。
import { h, toast, starFly, confetti } from './dom.js?v=1793627245';
import * as tts from '../services/tts.js?v=1793627245';

export function renderSpelling(ctx, unit) {
  const fourWords = unit.words.filter((w) => w.tier === 'four');
  const session = ctx.session;
  if (typeof session.spellIndex !== 'number') session.spellIndex = 0;

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

  function render() {
    wrap.innerHTML = '';
    // 全部拼完：显示通关态
    if (fourWords.every((w) => spellingDone.has(w.w))) {
      wrap.appendChild(h('div', { class: 'card-title', text: '🔤 拼写屋' }));
      wrap.appendChild(h('div', { class: 'emoji-xl', style: 'text-align:center', text: '🏆' }));
      wrap.appendChild(h('p', { style: 'text-align:center;font-weight:800;font-size:var(--fs-lg)', text: '四会词全部会拼啦！' }));
      wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: '下次可以再来重拼，越拼越熟～' }));
      wrap.appendChild(h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:12px' }, [
        h('button', {
          class: 'btn ghost', text: '🔁 重新拼一遍',
          onclick: () => { session.spellIndex = 0; session.spellProgress = null; render(); },
        }),
      ]));
      return;
    }

    // 找到第一个未拼过的词
    const idx = Math.max(0, fourWords.findIndex((w) => !spellingDone.has(w.w)));
    const w = fourWords[idx];
    if (!session.spellProgress || session.spellWord !== w.w) {
      session.spellWord = w.w;
      session.spellProgress = '';
      session.spellLetters = shuffledLetters(w.w);
      session.spellUsed = [];
      session.spellMiss = 0;
    }

    const typed = session.spellProgress;
    wrap.appendChild(h('div', { class: 'card-title', text: `🔤 拼写屋　${spellingDone.size} / ${fourWords.length}` }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '听一听，把这个词用字母拼出来' }));

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
              // 拼对
              spellingDone.add(w.w);
              ctx.updateUnitProgress(unit.id, (up) => ({
                ...up,
                spellingDone: Array.from(new Set([...(up.spellingDone || []), w.w])),
              }));
              ctx.addStars(2);
              starFly(2);
              tts.speak(w.w);
              session.spellProgress = null;
              render();
              if (fourWords.every((x) => spellingDone.has(x.w))) {
                toast('🎉 拼写通关！', 3000);
                confetti();
                ctx.checkStage1(unit.id);
              } else {
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
          // 跳过不落盘，不卡死；最后仍需拼完才能通关
          session.spellProgress = null;
          session.spellIndex = (idx + 1) % fourWords.length;
          render();
        },
      }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
    h('p', { class: 'hint', text: '小贴士：四会词要"会读也会写"。拼错了没关系，多拼几遍就记住啦。' }),
  ]);
}
