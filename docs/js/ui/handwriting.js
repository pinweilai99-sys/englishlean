// 字帖屋（1.5）：单词书写——屏上描红 + 下载 PDF 四线三格字帖
// 描红：标准四线三格 + 浅灰范字，孩子用手指在屏上描（描红画布），描完点亮 handwritingDone（发星，不卡通关）。
// 打印：四线三格，每词一行 = 示例 + 描红×2 + 空白×2，家长打印后孩子在纸上写。
// 词集：本单元全部单词（四会在前、认读在后）；后续 U1-4 有内容后，由调用方把未掌握/需复习词追加进 units。
import { h, toast, starFly } from './dom.js?v=1793670759';

// 字帖词序（纯函数，可测试）：每个单元四会词在前、认读词在后，跨单元按 w 去重。
// 现在只传 [unit]（U5 全部 12 词）；等 U1-4 内容就位，调用方把「未掌握/需复习」的词
// 组装成后续单元传入即可，自动排在 U5 词后面，无需改动本模块。
export function buildHandwritingWords(units) {
  const seen = new Set();
  const out = [];
  units.forEach((u) => {
    const four = u.words.filter((w) => w.tier === 'four');
    const rest = u.words.filter((w) => w.tier !== 'four');
    [...four, ...rest].forEach((w) => {
      if (seen.has(w.w)) return;
      seen.add(w.w);
      out.push(w);
    });
  });
  return out;
}

export function renderHandwriting(ctx, unit) {
  const words = buildHandwritingWords([unit]);
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const p = ctx.getUnitProgress(unit.id);
    const hwDone = new Set(p?.handwritingDone || []);

    wrap.appendChild(h('div', { class: 'card-title', text: '✍️ 字帖屋' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `单词都要会写！在四线三格里用手指照着灰字描，描完点亮（${hwDone.size}/${words.length}）` }));

    // 屏上描红
    words.forEach((w) => {
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

    if (hwDone.size === words.length) {
      wrap.appendChild(h('p', { style: 'text-align:center;font-weight:800;color:var(--ok);font-size:var(--fs-md)', text: '🏆 屏上描红全部完成！记得用下面的字帖在纸上也写一写～' }));
    }

    // PDF 字帖下载
    wrap.appendChild(h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:16px' }, [
      h('button', {
        class: 'btn sky', text: '⬇️ 下载 PDF 打印版字帖',
        onclick: () => downloadHandwritingPdf(unit),
      }),
    ]));
    wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: '下载 A4 PDF 后打印：孩子用铅笔先描红，再在空白格里自己写，写完给家长检查' }));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}

// ==================== PDF 打印版字帖（四线三格） ====================
// 标准英语本格式：4 条横线构成等高 3 格（上格/中格/下格）。
// 单词基线精确压在第 3 线上：小写字母主体占满中格，b/d/f/h/k/l/t 升入上格，
// g/j/p/q/y 降入下格。每词一组（示例+描红×2+空白×2），组内绝不跨页断开。
// 布局为纯函数 computePdfLayout（可测试），渲染薄壳调 jsPDF（本地 vendor，不依赖 CDN）。
const BAND = 26;            // 屏上描红：每格高度(px)
const ROW_H = BAND * 3;     // 屏上描红：行高 = 三格
const BASELINE_Y = BAND * 2; // 屏上描红：基线 = 第 3 条线
const WORD_FONT = Math.round(BAND / 0.448); // 屏上描红字号：Times x-height≈0.448em，小写主体恰好占满中格

// ---- PDF 布局常量（mm，A4）----
const PAGE_W = 210, PAGE_H = 297, ML = 14, MR = 14, MT = 12, MB = 14;
const BAND_M = 4.2, ROW_H_M = BAND_M * 3, ROW_GAP = 3, NAME_H = 7, GROUP_GAP = 6;
const GROUP_H = NAME_H + 5 * ROW_H_M + 4 * ROW_GAP; // 每词一组高度
const HEADER_H = 23; // 首页页眉（标题+姓名日期）
const FONT_PT = (BAND_M / 0.448) * 72 / 25.4; // 小写主体占满中格 ≈ 26.6pt
const GRID_C = [157, 179, 200], BASE_C = [90, 113, 134], INK_C = [43, 43, 43], TRACE_C = [210, 210, 210];

// 生成 PDF 绘制指令（纯几何，无副作用，可完整测试格式）
// 指令：{t:'page'} 换页 | {t:'line',x1,x2,y,w,c} 横线 | {t:'text',x,y,s,color} 单词(y=基线) | {t:'img',kind,text,x,y,w,h} 中文图
export function computePdfLayout(unit) {
  const words = buildHandwritingWords([unit]);
  const cmds = [];
  const pageEnd = PAGE_H - MB;
  let y = MT + HEADER_H; // 首页从页眉下开始
  const groupStarts = [];

  words.forEach((w) => {
    if (y + GROUP_H > pageEnd) { cmds.push({ t: 'page' }); groupStarts.push(null); y = MT; }
    groupStarts.push(y);
    // 词名（中文，渲染为图片）
    cmds.push({ t: 'img', kind: 'wordname', text: `${w.img} ${w.w}　${w.zh}`, x: ML, y, w: 74, h: 6 });
    // 每词 5 行：示例 1 + 描红 2 + 空白 2
    const modes = ['solid', 'trace', 'trace', 'blank', 'blank'];
    modes.forEach((mode, mi) => {
      const rowTop = y + NAME_H + mi * (ROW_H_M + ROW_GAP);
      // 4 条线：0 / 1格 / 2格(基线,加深) / 3格
      [0, 1, 2, 3].forEach((li) => {
        cmds.push({
          t: 'line', x1: ML, x2: PAGE_W - MR, y: rowTop + li * BAND_M,
          w: li === 2 ? 0.45 : 0.3, c: li === 2 ? 'base' : 'grid',
        });
      });
      if (mode !== 'blank') {
        cmds.push({ t: 'img', kind: 'label', text: mode === 'solid' ? '示例' : '描红', x: 2, y: rowTop + (ROW_H_M - 4) / 2, w: 11, h: 4 });
        cmds.push({ t: 'text', x: ML + 2, y: rowTop + 2 * BAND_M, s: w.w, color: mode === 'solid' ? 'ink' : 'trace' });
      } else {
        cmds.push({ t: 'img', kind: 'label', text: '自己写', x: 2, y: rowTop + (ROW_H_M - 4) / 2, w: 11, h: 4 });
      }
    });
    y += GROUP_H + GROUP_GAP;
  });

  // 首页页眉插在最前
  cmds.unshift(
    { t: 'img', kind: 'title', text: 'Unit 5 单词字帖（四线三格）', x: (PAGE_W - 120) / 2, y: MT, w: 120, h: 10 },
    { t: 'img', kind: 'namecard', text: '姓名：____________　日期：____________', x: ML, y: MT + 13, w: 92, h: 6 },
  );
  return cmds;
}

// 下载 PDF（jsPDF 本地 vendor；中文通过 canvas 转图嵌入）
export function downloadHandwritingPdf(unit) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF 组件还没加载好，请刷新页面后重试', 2200);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const imgCache = {};
  computePdfLayout(unit).forEach((cmd) => {
    if (cmd.t === 'page') { doc.addPage(); return; }
    if (cmd.t === 'line') {
      doc.setDrawColor(...(cmd.c === 'base' ? BASE_C : GRID_C));
      doc.setLineWidth(cmd.w);
      doc.line(cmd.x1, cmd.y, cmd.x2, cmd.y);
    } else if (cmd.t === 'text') {
      doc.setFont('times', 'normal');
      doc.setFontSize(FONT_PT);
      doc.setTextColor(...(cmd.color === 'trace' ? TRACE_C : INK_C));
      doc.text(cmd.s, cmd.x, cmd.y, { charSpace: 0.6 });
    } else if (cmd.t === 'img') {
      const key = `${cmd.kind}:${cmd.text}`;
      if (!imgCache[key]) imgCache[key] = cjkImageUrl(cmd.text, cmd.kind);
      doc.addImage(imgCache[key], 'PNG', cmd.x, cmd.y, cmd.w, cmd.h);
    }
  });
  doc.save('Unit5-单词字帖-四线三格.pdf');
  toast('PDF 已生成，正在下载…', 1800);
}

// 中文文本 → PNG dataURL（PDF 内置字体不支持中文，用 canvas 转图）
function cjkImageUrl(text, kind) {
  const styles = {
    title: { font: 'bold 46px', w: 1200, h: 110 },
    namecard: { font: '30px', w: 1100, h: 70 },
    wordname: { font: '32px', w: 1000, h: 76 },
    label: { font: '30px', w: 190, h: 70 },
  };
  const st = styles[kind] || styles.wordname;
  const canvas = document.createElement('canvas');
  canvas.width = st.w; canvas.height = st.h;
  const c = canvas.getContext('2d');
  c.fillStyle = kind === 'label' ? '#999' : '#333';
  c.font = `${st.font} -apple-system, "PingFang SC", sans-serif`;
  c.textBaseline = 'middle';
  c.fillText(text, 4, st.h / 2);
  return canvas.toDataURL('image/png');
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
