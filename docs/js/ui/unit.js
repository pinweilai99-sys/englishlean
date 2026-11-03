// 单元页：目标卡 + 4 阶段关卡
import { h, toast } from './dom.js?v=1793700777';
import { canEnterStage } from '../core/progress.js?v=1793700777';

const STAGES = [
  { idx: 0, name: '单词奠基', desc: '先会读单词，才读得懂句子', emoji: '🔤' },
  { idx: 1, name: '核心句型', desc: 'May I have a ___? / Yes, you can.', emoji: '💬' },
  { idx: 2, name: '真实输出', desc: '角色扮演、写作、思维导图', emoji: '🎭' },
  { idx: 3, name: '巩固拓展', desc: '故事、微测、复习', emoji: '🏆' },
];

export function renderUnit(ctx, unit) {
  const p = ctx.getUnitProgress(unit.id);
  const stagePassed = p?.stagePassed || [false, false, false, false];
  const unlocked = stagePassed.filter(Boolean).length;

  const goal = h('div', { class: 'card soft' }, [
    h('div', { class: 'card-title', text: '🎯 本单元目标' }),
    h('p', { style: 'font-size:var(--fs-md);font-weight:700', text: unit.objective.child }),
    h('p', { class: 'hint', text: `家长版：${unit.objective.parent}` }),
  ]);

  const list = h('div', { class: 'stage-list' });
  STAGES.forEach((s) => {
    const passed = stagePassed[s.idx] === true;
    const open = canEnterStage(stagePassed, s.idx);
    const cls = passed ? 'is-passed' : (open ? 'is-open' : 'is-locked');
    const btn = h('button', {
      class: `stage-item ${cls}`,
      onclick: () => {
        if (!open) {
          toast(`先完成「${STAGES[s.idx - 1]?.name || '前面的阶段'}」才能来这里哦`);
          return;
        }
        ctx.navigate(`#/unit/${unit.id}/stage/${s.idx}`);
      },
    }, [
      h('span', { class: 'stage-no', text: passed ? '✓' : String(s.idx + 1) }),
      h('span', { class: 'stage-meta' }, [
        h('strong', { text: `${s.emoji} ${s.name}` }),
        h('small', { text: s.desc }),
      ]),
      h('span', { class: 'unit-state', text: passed ? '🏅 已完成' : (open ? '▶️ 进入' : '🔒 未解锁') }),
    ]);
    list.appendChild(btn);
  });

  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回单元地图', onclick: () => ctx.navigate('#/') }),
    goal,
    h('div', { class: 'card-title', text: `学习路径（已通过 ${unlocked} / 4 个阶段）` }),
    list,
  ]);
}
