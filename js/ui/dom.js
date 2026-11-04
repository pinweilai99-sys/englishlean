// 轻量 DOM 工具：h() 创建元素、toast 提示、modal 弹层、星星飞入动效
// 不依赖任何框架。

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

let toastTimer = null;
export function toast(msg, ms = 2000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// 巩固拓展（Stage3）内部模块切换栏：故事屋 / 考点微测 / 复习
// active ∈ {'stories','quiz','review'}，由调用方按当前页指定；data-tab 供测试定位
export function stage3Nav(ctx, unit, active) {
  const tabs = [
    { key: 'stories', label: '📚 故事屋', route: `#/unit/${unit.id}/stage/3` },
    { key: 'quiz', label: '📝 考点微测', route: `#/unit/${unit.id}/stage/3/quiz` },
    { key: 'review', label: '🃏 复习', route: `#/unit/${unit.id}/recall` },
  ];
  return h('div', { class: 'stage3-nav', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' },
    tabs.map((t) => h('button', {
      class: `btn ${active === t.key ? 'leaf' : 'ghost'}`,
      text: t.label,
      'data-tab': t.key,
      onclick: () => ctx.navigate(t.route),
    }))
  );
}

export function starFly(count = 1) {
  const badge = h('div', { class: 'stars-badge', text: '⭐'.repeat(Math.min(count, 3)) });
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1200);
}

const CONFETTI_COLORS = ['#ffb703', '#52b788', '#4cc9f0', '#ff8fa3', '#ffd166'];
export function confetti(n = 26) {
  const wrap = h('div', { class: 'confetti' });
  for (let i = 0; i < n; i++) {
    const p = h('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${-10 - Math.random() * 20}%`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3200);
}

export function modal(title, contentNode, actions = []) {
  const mask = h('div', { class: 'modal-mask' });
  const box = h('div', { class: 'modal' }, [h('h3', { text: title }), contentNode]);
  const row = h('div', { class: 'btn-row', style: 'margin-top:18px' });
  actions.forEach((a) => {
    row.appendChild(h('button', {
      class: `btn ${a.kind || ''}`,
      text: a.label,
      onclick: () => { if (a.onClick) a.onClick(); if (a.keepOpen !== true) mask.remove(); },
    }));
  });
  box.appendChild(row);
  mask.appendChild(box);
  mask.addEventListener('click', (e) => { if (e.target === mask && actions.every((a) => a.keepOpen)) mask.remove(); });
  document.body.appendChild(mask);
  return { mask, box };
}

export function confirmDialog(title, message, onYes, yesLabel = '确定') {
  const body = h('p', { class: 'hint', text: message });
  const m = modal(title, body, [
    { label: '取消', kind: 'ghost' },
    { label: yesLabel, kind: 'leaf', onClick: onYes },
  ]);
  return m;
}
