// 首页：单元地图
import { h, toast } from './dom.js?v=1793711771';

export const UNITS = [
  { id: 'u1', no: 1, name: 'What does he look like?', zh: '外貌', emoji: '👦', open: false },
  { id: 'u2', no: 2, name: 'What would you like?', zh: '点餐', emoji: '🍔', open: false },
  { id: 'u3', no: 3, name: 'I can use the computer.', zh: '电脑', emoji: '💻', open: false },
  { id: 'u4', no: 4, name: 'Can I borrow your…?', zh: '借东西', emoji: '✏️', open: false },
  { id: 'u5', no: 5, name: 'May I have a pet?', zh: '养宠物', emoji: '🐰', open: true },
  { id: 'u6', no: 6, name: 'Which one do you want?', zh: '选衣物', emoji: '🧥', open: false },
  { id: 'u7', no: 7, name: 'What chores do you do?', zh: '家务', emoji: '🧹', open: false },
  { id: 'u8', no: 8, name: "What's your hobby?", zh: '爱好', emoji: '🎻', open: false },
];

export function renderHome(ctx) {
  const { state } = ctx;
  const totalStars = state.stars || 0;
  const streak = state.streak || 0;

  const hero = h('div', { class: 'hero' }, [
    h('div', { class: 'hero-text' }, [
      h('h1', { text: '今天想学哪个单元呀？' }),
      h('p', { text: '跟着快乐小狗，一步一步把英语学扎实！' }),
      h('div', { class: 'stat-row' }, [
        h('span', { class: 'stat', text: `⭐ ${totalStars} 颗星` }),
        h('span', { class: 'stat', text: `🔥 连续 ${streak} 天` }),
        h('span', { class: 'stat', text: `📗 ${UNITS.filter((u) => u.open).length} / 8 个单元开放` }),
      ]),
    ]),
    h('div', { class: 'hero-pet', text: '🐶' }),
  ]);

  const grid = h('div', { class: 'unit-grid' });
  UNITS.forEach((u) => {
    const unitProgress = state.progress?.[u.id];
    const done = unitProgress?.stagePassed?.every(Boolean);
    const card = h('button', {
      class: `unit-card ${u.open ? 'is-open' : 'is-locked'} ${done ? 'is-done' : ''}`,
      onclick: () => {
        if (!u.open) { toast('这个单元还在准备中，敬请期待～'); return; }
        ctx.navigate(`#/unit/${u.id}`);
      },
    }, [
      h('div', { class: 'unit-emoji', text: u.emoji }),
      h('div', { class: 'unit-no', text: `UNIT ${u.no}` }),
      h('div', { class: 'unit-name', text: u.name }),
      h('div', { class: 'card-sub', text: u.zh }),
      h('div', { class: 'unit-state', text: !u.open ? '🔒 敬请期待' : (done ? '🏆 已通关' : '▶️ 开始学习') }),
    ]);
    grid.appendChild(card);
  });

  return h('div', {}, [hero, h('div', { class: 'card-title', text: '单元地图' }), grid]);
}
