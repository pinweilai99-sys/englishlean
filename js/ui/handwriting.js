// 字帖屋（1.5）：四会词书写——屏上描红 + 可打印四线三格字帖
// 描红：浅灰大字，孩子用手指/鼠标在屏上描，描完点亮 handwritingDone（发星，不卡通关）。
// 打印：四线三格，每词一行 = 示例 + 描红×2 + 空白×2，家长打印后孩子在纸上写。
import { h, toast, starFly } from './dom.js';

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
// 标准英语本格式：4 条横线构成等高 3 格（上格/中格/下格）。
// 单词基线精确压在第 3 线上：小写字母主体占满中格，b/d/f/h/k/l/t 升入上格，
// g/j/p/q/y 降入下格。每词一组（示例+描红×2+空白×2），组内不跨页断开。
const BAND = 26;            // 每格高度(px)
const ROW_H = BAND * 3;     // 行高 = 三格
const BASELINE_Y = BAND * 2; // 基线 = 第 3 条线（自顶部数第 2 格底部）
// Times New Roman: x-height ≈ 0.448em。让小写主体恰好占满中格：
const WORD_FONT = Math.round(BAND / 0.448); // ≈ 58px

function openPrint(ctx, unit) {
  const { style, sheet } = buildPrintSheet(unit);
  document.body.appendChild(style);
  document.body.appendChild(sheet);
  toast('正在打开打印…', 1500);
  setTimeout(() => {
    window.print();
    // 打印后清理（延时，避免打印内容被提前移除）
    setTimeout(() => { style.remove(); sheet.remove(); }, 500);
  }, 300);
}

// 构建字帖（独立导出便于测试格式）：标题 + 每词一组（示例+描红×2+空白×2）
export function buildPrintSheet(unit) {
  const fourWords = unit.words.filter((w) => w.tier === 'four');
  const groups = fourWords.map((w) => h('div', { class: 'fw-group' }, [
    h('p', { class: 'fw-wordname', text: `${w.img} ${w.w}　${w.zh}` }),
    // 每词：示例 1 遍 + 描红 2 遍 + 空白 2 遍
    fourLineRow(w.w, 'solid'),
    fourLineRow(w.w, 'trace'),
    fourLineRow(w.w, 'trace'),
    fourLineRow('', 'blank'),
    fourLineRow('', 'blank'),
  ]));

  const sheet = h('div', { id: 'print-sheet' }, [
    h('h2', { style: 'text-align:center', text: 'Unit 5 四会词字帖（四线三格）' }),
    h('p', { style: 'text-align:center;font-size:12px;color:#666', text: '姓名：________　日期：________' }),
    ...groups,
  ]);

  const style = h('style', { html: `
    #print-sheet { font-family: "Times New Roman", serif; }
    .fw-group { break-inside: avoid; page-break-inside: avoid; margin-bottom: 10px; }
    .fw-wordname { font-size: 14px; color: #333; margin: 4px 0 2px; font-family: -apple-system, "PingFang SC", sans-serif; }
    .fw-row { position: relative; height: ${ROW_H}px; margin: 8px 0 8px 56px; }
    .fw-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid #9db3c8; }
    .fw-line.baseline { border-top: 1.5px solid #5a7186; }
    .fw-word { position: absolute; left: 0; top: 0; overflow: visible; }
    .fw-solid { fill: #2b2b2b; }
    .fw-trace { fill: rgba(0,0,0,.16); }
    .fw-label { position: absolute; left: -52px; top: 50%; transform: translateY(-50%); font-size: 13px; color: #999; width: 44px; text-align: right; font-family: -apple-system, "PingFang SC", sans-serif; }
    @media print {
      body * { visibility: hidden; }
      #print-sheet, #print-sheet * { visibility: visible; }
      #print-sheet { position: absolute; left: 0; top: 0; width: 100%; }
    }
  ` });

  return { style, sheet };
}

// 一行四线三格：全宽 4 条线 + 词（SVG 精确控制基线位置）
function fourLineRow(word, mode) {
  const label = mode === 'solid' ? '示例' : (mode === 'trace' ? '描红' : '自己写');
  const row = h('div', { class: 'fw-row' }, [
    h('span', { class: 'fw-label', text: label }),
    h('div', { class: 'fw-line', style: 'top:0' }),
    h('div', { class: 'fw-line', style: `top:${BAND}px` }),
    h('div', { class: 'fw-line baseline', style: `top:${BASELINE_Y}px` }),
    h('div', { class: 'fw-line', style: `top:${ROW_H}px` }),
  ]);
  if (word) {
    // SVG 让基线精确压在第 3 条线上；宽度假定足够，overflow 可见
    const svgW = word.length * (WORD_FONT * 0.55) + 40;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', `fw-word fw-${mode}`);
    svg.setAttribute('width', String(svgW));
    svg.setAttribute('height', String(ROW_H));
    svg.style.overflow = 'visible';
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '4');
    t.setAttribute('y', String(BASELINE_Y)); // 基线 = 第 3 条线
    t.setAttribute('font-size', String(WORD_FONT));
    t.setAttribute('font-family', '"Times New Roman", serif');
    t.setAttribute('letter-spacing', '6');
    t.textContent = word;
    svg.appendChild(t);
    row.appendChild(svg);
  }
  return row;
}
