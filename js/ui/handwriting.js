// 字帖屋（1.5）：四会词书写——屏上描红 + 可打印四线三格字帖
// 描红：标准四线三格 + 浅灰范字，孩子用手指在屏上描（描红画布），描完点亮 handwritingDone（发星，不卡通关）。
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
    wrap.appendChild(h('p', { class: 'card-sub', text: `四会词要会写！在四线三格里用手指照着灰字描，描完点亮（${hwDone.size}/${fourWords.length}）` }));

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
        // 屏上描红：四线三格 + 浅灰范字，手指在灰字上描
        traceBox(w.w),
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
  if (word) row.appendChild(wordSvg(word, mode));
  return row;
}

// 四线三格内的单词 SVG：基线精确压在第 3 条线上（屏上描红与打印共用，格式一致）
function wordSvg(word, mode) {
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
  return svg;
}

// 屏上描红盒：四线三格 + 浅灰范字 + 手指/鼠标描红画布（描的笔迹显示在灰字上）
function traceBox(word) {
  const box = h('div', { class: 'trace-box', style: 'position:relative;width:fit-content;margin:12px auto 0;user-select:none' });
  const grid = h('div', { style: `position:relative;width:${wordSvgW(word)}px;height:${ROW_H}px` }, [
    h('div', { class: 'fw-line', style: 'top:0' }),
    h('div', { class: 'fw-line', style: `top:${BAND}px` }),
    h('div', { class: 'fw-line baseline', style: `top:${BASELINE_Y}px` }),
    h('div', { class: 'fw-line', style: `top:${ROW_H}px` }),
    wordSvg(word, 'trace'),
  ]);
  box.appendChild(grid);

  // 描红画布（2x 分辨率保证清晰）
  const canvas = document.createElement('canvas');
  const W = wordSvgW(word), H = ROW_H;
  canvas.width = W * 2; canvas.height = H * 2;
  canvas.setAttribute('aria-label', `描红 ${word}`);
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none;cursor:pointer;border-radius:6px';
  grid.appendChild(canvas);
  const c = canvas.getContext && canvas.getContext('2d'); // jsdom 等环境可能无 2d 上下文
  let drawing = false;
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  if (c) {
    c.lineWidth = 13; c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = '#2f7d5b';
    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 部分浏览器不支持 */ }
      const { x, y } = pt(e);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.1, y + 0.1); c.stroke();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const { x, y } = pt(e);
      c.lineTo(x, y); c.stroke();
      e.preventDefault();
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);
  }

  // 擦掉重描
  box.appendChild(h('div', { style: 'text-align:center;margin-top:6px' }, [
    h('button', {
      class: 'btn ghost', style: 'font-size:13px;padding:4px 12px', text: '🧽 擦掉重描',
      onclick: () => { if (c) c.clearRect(0, 0, canvas.width, canvas.height); },
    }),
  ]));
  return box;
}

function wordSvgW(word) { return word.length * (WORD_FONT * 0.55) + 40; }
