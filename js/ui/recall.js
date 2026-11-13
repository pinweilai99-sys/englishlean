// 回忆卡中心（模块⑥）：May I 秒答 / 听答反推 / 看图说词 / 复述 / ou 归类
import { h, toast, starFly, stage3Nav } from './dom.js?v=1794539497';
import * as tts from '../services/tts.js?v=1794539497';

// 看图卡插画（内联 SVG，代码绘制：零成本、离线可用、随主题缩放）
const PIC_SVGS = {
  rabbit: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a rabbit">
    <rect width="200" height="140" rx="14" fill="#eaf6ff"/>
    <ellipse cx="86" cy="40" rx="10" ry="26" fill="#ffffff" stroke="#8fa3b8" stroke-width="3"/>
    <ellipse cx="114" cy="40" rx="10" ry="26" fill="#ffffff" stroke="#8fa3b8" stroke-width="3"/>
    <ellipse cx="86" cy="43" rx="4" ry="15" fill="#ffc9d6"/>
    <ellipse cx="114" cy="43" rx="4" ry="15" fill="#ffc9d6"/>
    <circle cx="100" cy="74" r="26" fill="#ffffff" stroke="#8fa3b8" stroke-width="3"/>
    <circle cx="92" cy="70" r="3.2" fill="#3a4653"/>
    <circle cx="108" cy="70" r="3.2" fill="#3a4653"/>
    <path d="M97 78 h6 l-3 4 z" fill="#f28ba8"/>
    <path d="M100 82 q-4 4 -8 1 M100 82 q4 4 8 1" stroke="#8fa3b8" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="116" rx="24" ry="17" fill="#ffffff" stroke="#8fa3b8" stroke-width="3"/>
    <circle cx="77" cy="116" r="7" fill="#ffffff" stroke="#8fa3b8" stroke-width="3"/>
  </svg>`,
  goldfish: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a goldfish">
    <rect width="200" height="140" rx="14" fill="#e8f9ff"/>
    <circle cx="150" cy="38" r="6" fill="none" stroke="#7fd4f2" stroke-width="2"/>
    <circle cx="160" cy="24" r="4" fill="none" stroke="#7fd4f2" stroke-width="2"/>
    <path d="M62 72 L32 50 L38 72 L32 94 Z" fill="#ff9f43" stroke="#e07b1f" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="102" cy="72" rx="42" ry="28" fill="#ffb84d" stroke="#e07b1f" stroke-width="3"/>
    <path d="M96 46 q10 -12 24 -8 l-8 14 z" fill="#ff9f43" stroke="#e07b1f" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="126" cy="64" r="4" fill="#3a4653"/>
    <path d="M142 76 q7 2 0 7" stroke="#e07b1f" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M88 62 q8 10 0 20 M104 60 q8 12 0 24" stroke="#e07b1f" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`,
  parrot: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a parrot">
    <rect width="200" height="140" rx="14" fill="#fff4e0"/>
    <path d="M18 120 q82 -12 164 -2" stroke="#8d6e63" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M80 96 L54 130 L88 112 Z" fill="#43a047" stroke="#2e7d32" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="106" cy="78" rx="30" ry="36" fill="#e8503a" stroke="#c73a26" stroke-width="3"/>
    <path d="M96 72 q24 4 18 36 q-22 -8 -18 -36" fill="#43a047" stroke="#2e7d32" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="114" cy="42" r="18" fill="#e8503a" stroke="#c73a26" stroke-width="3"/>
    <path d="M128 38 q15 3 9 15 q-11 2 -13 -7 z" fill="#fdd835" stroke="#f9a825" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="118" cy="38" r="3.5" fill="#3a4653"/>
    <path d="M106 26 l-5 -9 M113 24 l0 -11 M120 26 l5 -9" stroke="#c73a26" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  // U6 衣物主题（2026-11-13）：看图说单词卡用得到，纯内联 SVG、离线可用
  sweater: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a sweater">
    <rect width="200" height="140" rx="14" fill="#eef4ff"/>
    <path d="M72 40 L50 50 L36 92 L56 100 L72 68 Z" fill="#5b8def" stroke="#3367cc" stroke-width="3" stroke-linejoin="round"/>
    <path d="M128 40 L150 50 L164 92 L144 100 L128 68 Z" fill="#5b8def" stroke="#3367cc" stroke-width="3" stroke-linejoin="round"/>
    <rect x="72" y="38" width="56" height="78" rx="9" fill="#5b8def" stroke="#3367cc" stroke-width="3"/>
    <path d="M86 38 q14 16 28 0" fill="none" stroke="#3367cc" stroke-width="3"/>
    <path d="M74 106 h52" stroke="#3367cc" stroke-width="3"/>
    <path d="M88 62 h24 M88 74 h24 M88 86 h24" stroke="#a9c6ff" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  scarf: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a scarf">
    <rect width="200" height="140" rx="14" fill="#fff3ea"/>
    <path d="M34 44 q66 44 124 -4 l2 22 q-62 46 -128 4 Z" fill="#f2924a" stroke="#c96a1e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M124 60 l20 54 -22 -4 -12 -48 Z" fill="#f2924a" stroke="#c96a1e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M124 112 l2 12 M132 111 l3 12 M140 108 l4 12" stroke="#c96a1e" stroke-width="3" stroke-linecap="round"/>
    <path d="M44 48 q60 38 108 2" fill="none" stroke="#ffc48a" stroke-width="2"/>
  </svg>`,
  raincoat: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" width="220" height="154" role="img" aria-label="a raincoat">
    <rect width="200" height="140" rx="14" fill="#eaf7f4"/>
    <path d="M82 40 q18 -22 36 0" fill="#4bbfa5" stroke="#218e78" stroke-width="3" stroke-linejoin="round"/>
    <path d="M76 44 L54 54 L44 108 L72 108 L72 44 Z" fill="#4bbfa5" stroke="#218e78" stroke-width="3" stroke-linejoin="round"/>
    <path d="M124 44 L146 54 L156 108 L128 108 L128 44 Z" fill="#4bbfa5" stroke="#218e78" stroke-width="3" stroke-linejoin="round"/>
    <path d="M76 40 h48 v76 h-48 Z" fill="#4bbfa5" stroke="#218e78" stroke-width="3"/>
    <path d="M100 40 v76" stroke="#218e78" stroke-width="2"/>
    <circle cx="92" cy="62" r="3" fill="#f7e07a"/>
    <circle cx="92" cy="82" r="3" fill="#f7e07a"/>
    <circle cx="92" cy="102" r="3" fill="#f7e07a"/>
  </svg>`,
};

export function renderRecall(ctx, unit) {
  const cards = unit.reviewCards;
  const session = ctx.session;
  if (typeof session.recallIndex !== 'number') session.recallIndex = 0;
  if (!session.recallResults) session.recallResults = {};

  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    const i = session.recallIndex % cards.length;
    const c = cards[i];
    const res = session.recallResults[c.id];

    wrap.appendChild(h('div', { class: 'card-title', text: '🃏 回忆卡中心' }));
    wrap.appendChild(h('p', { class: 'card-sub', text: `第 ${i + 1} / ${cards.length} 张　合书也能答，才是真会了` }));

    // 看图卡：先看图再说（插画由 pic 字段驱动，未配置的不渲染）
    if (c.pic && PIC_SVGS[c.pic]) {
      wrap.appendChild(h('div', { class: 'recall-pic', style: 'display:flex;justify-content:center;margin:12px 0', html: PIC_SVGS[c.pic] }));
    }

    wrap.appendChild(h('div', { class: 'story-text', style: 'text-align:center;font-size:var(--fs-lg);font-weight:800;margin:16px 0' }, [c.prompt]));

    const actions = h('div', { class: 'btn-row', style: 'justify-content:center' });
    if (c.speak) {
      actions.appendChild(h('button', { class: 'btn ghost', text: '🔊 听一听', onclick: () => tts.speak(c.speak) }));
    }
    if (c.type === 'listen_reverse') {
      actions.appendChild(h('button', { class: 'btn', text: '🔊 播放答句', onclick: () => tts.speak(c.speak) }));
    }
    actions.appendChild(h('button', {
      class: 'btn leaf', text: '✅ 我答对了',
      onclick: () => {
        session.recallResults[c.id] = true;
        ctx.addStars(1); starFly(1);
        toast('太棒了，记忆很牢！');
        session.recallIndex = (i + 1) % cards.length;
        render();
      },
    }));
    actions.appendChild(h('button', {
      class: 'btn ghost', text: '🤔 再看看',
      onclick: () => {
        session.recallResults[c.id] = false;
        ctx.addWrong({ unit: unit.id, type: c.type, q: c.prompt, a: c.answer, chosen: '（没答出）' });
        toast('没关系，已放进错题本，过几天再来～');
        session.recallIndex = (i + 1) % cards.length;
        render();
      },
    }));
    wrap.appendChild(actions);

    if (res !== undefined) {
      wrap.appendChild(h('p', { class: 'hint', style: 'text-align:center;margin-top:12px', text: `参考答案：${c.answer}` }));
    }

    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:18px;justify-content:center' }, [
      h('button', { class: 'btn ghost', text: '⬅️ 上一张', onclick: () => { session.recallIndex = (i - 1 + cards.length) % cards.length; render(); } }),
      h('button', { class: 'btn ghost', text: '➡️ 下一张', onclick: () => { session.recallIndex = (i + 1) % cards.length; render(); } }),
    ]));
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    stage3Nav(ctx, unit, 'review'),
    wrap,
  ]);
}
