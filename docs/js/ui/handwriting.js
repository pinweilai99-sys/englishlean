// 字帖屋（1.5）：四会词书写——屏上描红 + 可打印四线三格字帖
// 描红：浅灰大字，孩子用手指/鼠标在屏上描，描完点亮 handwritingDone（发星，不卡通关）。
// 打印：四线三格，每词一行 = 示例 + 描红×2 + 空白×2，家长打印后孩子在纸上写。
import { h, toast, starFly } from './dom.js?v=1793627992';

export function renderHandwriting(ctx, unit) {
  const fourWords = unit.words.filter((w) => w.tier === 'four');
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const p = ctx.getUnitProgress(unit.id);
    const hwDone = new Set(p?.handwritingDone || []);

    wrap.appendChild(h('div', { class: 'card-title', text: '✍️ 字帖屋' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `四会词要会写！用手指照着灰字描，描完点亮（${hwDone.size}/${fourWords.length}）` }));

    // 屏上描红
    fourWords.forEach((w) => {
      const done = hwDone.has(w.w);
      const row = h('div', { class: 'card soft', style: 'margin-bottom:12px;padding:14px' }, [
        h('div', { style: 'display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap' }, [
          h('div', {}, [
            h('div', { style: 'font-weight:800;font-size:var(--fs-md)', text: `${w.img} ${w.w}` }),
            h('div', { class: 'card-sub', text: `${w.zh}　${w.ipa}` }),
          ]),
          h('button', {
            class: `btn ${done ? 'ghost' : 'leaf'}`,
            text: done ? '✅ 描过了' : '✅ 我描好了',
            onclick: () => {
              if (hwDone.has(w.w)) return;
              ctx.updateUnitProgress(unit.id, (up) => ({
                ...up,
                handwritingDone: Array.from(new Set([...(up.handwritingDone || []), w.w])),
              }));
              ctx.addStars(1);
              starFly(1);
              toast('描得真棒！⭐');
              render();
            },
          }),
        ]),
        // 描红字（浅灰大字，手指可描）
        h('div', {
          class: 'trace-word',
          style: 'font-size:64px;font-weight:900;text-align:center;color:rgba(47,59,52,.14);letter-spacing:10px;user-select:none;margin-top:8px;text-transform:lowercase',
          text: w.w,
        }),
      ]);
      wrap.appendChild(row);
    });

    if (hwDone.size === fourWords.length) {
      wrap.appendChild(h('p', { style: 'text-align:center;font-weight:800;color:var(--ok);font-size:var(--fs-md)', text: '🏆 屏上描红全部完成！记得用下面的字帖在纸上也写一写～' }));
    }

    // 打印字帖
    wrap.appendChild(h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:16px' }, [
      h('button', {
        class: 'btn sky', text: '🖨️ 打印四线三格字帖',
        onclick: () => openPrint(ctx, unit),
      }),
    ]));
    wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: '打印后用铅笔先描红，再在空白格里自己写，写完给家长检查' }));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}

// 四线三格字帖（打印视图）
function openPrint(ctx, unit) {
  const fourWords = unit.words.filter((w) => w.tier === 'four');
  const lines = [];
  fourWords.forEach((w) => {
    // 每词：示例 1 遍 + 描红 2 遍 + 空白 2 遍
    lines.push({ word: w.w, mode: 'solid' });
    lines.push({ word: w.w, mode: 'trace' });
    lines.push({ word: w.w, mode: 'trace' });
    lines.push({ word: '', mode: 'blank' });
    lines.push({ word: '', mode: 'blank' });
  });

  const sheet = h('div', { id: 'print-sheet' }, [
    h('h2', { style: 'text-align:center', text: 'Unit 5 四会词字帖（四线三格）' }),
    h('p', { style: 'text-align:center;font-size:12px;color:#666', text: '姓名：________　日期：________' }),
    ...lines.map((l) => fourLineRow(l)),
  ]);

  const style = h('style', { html: `
    #print-sheet { font-family: "Times New Roman", serif; }
    .fw-row { position: relative; height: 64px; margin: 6px 0;
      border-top: 2px solid #333; border-bottom: 2px solid #333;
      background: linear-gradient(to bottom, transparent 50%, #ccc 50%, #ccc calc(50% + 1px), transparent calc(50% + 1px)); }
    .fw-word { position: absolute; left: 40px; top: 2px; font-size: 44px; line-height: 60px; letter-spacing: 8px; }
    .fw-solid { color: #222; }
    .fw-trace { color: rgba(0,0,0,.18); }
    .fw-label { position: absolute; left: 0; top: 18px; font-size: 14px; color: #999; width: 36px; text-align: right; }
    @media print {
      body * { visibility: hidden; }
      #print-sheet, #print-sheet * { visibility: visible; }
      #print-sheet { position: absolute; left: 0; top: 0; width: 100%; }
    }
  ` });

  document.body.appendChild(style);
  document.body.appendChild(sheet);
  toast('正在打开打印…', 1500);
  setTimeout(() => {
    window.print();
    // 打印后清理（延时，避免打印内容被提前移除）
    setTimeout(() => { style.remove(); sheet.remove(); }, 500);
  }, 300);
}

function fourLineRow({ word, mode }) {
  const cls = mode === 'solid' ? 'fw-solid' : 'fw-trace';
  const label = mode === 'solid' ? '示例' : (mode === 'trace' ? '描红' : '自己写');
  return h('div', { class: 'fw-row' }, [
    h('span', { class: 'fw-label', text: label }),
    h('span', { class: `fw-word ${cls}`, text: word }),
  ]);
}
