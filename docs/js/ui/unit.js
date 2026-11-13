// 单元页：目标卡 + 4 阶段关卡
import { h, toast } from './dom.js?v=1794551965';
import { canEnterStage, stage1Checklist } from '../core/progress.js?v=1794551965';

const STAGES = [
  { idx: 0, name: '单词奠基', desc: '先会读单词，才读得懂句子', emoji: '🔤' },
  { idx: 1, name: '核心句型', desc: '核心句型练习 · 🔍 语法小规律', emoji: '💬' },
  { idx: 2, name: '真实输出', desc: '角色扮演、写作、思维导图', emoji: '🎭' },
  { idx: 3, name: '巩固拓展', desc: '故事、微测、复习', emoji: '🏆' },
];

// Stage1（单词奠基）通关进度卡：三个通关条件逐项亮状态，没做完的给"去做"按钮引导。
// 只在 Stage1 尚未通过时显示；通关后自然消失（toast + 解锁提示已足够）。
// 注意：stage-item 本身是 <button>，清单必须作为兄弟节点渲染，不能嵌进按钮里。
function stage1ProgressCard(ctx, unit, p) {
  const rows = stage1Checklist(unit, p);
  const routes = {
    words: `#/unit/${unit.id}/stage/0`,
    listen: `#/unit/${unit.id}/stage/0/listen`,
    spelling: `#/unit/${unit.id}/stage/0/spelling`,
  };
  const goText = { words: '去点亮', listen: '去听写', spelling: '去拼写' };
  const card = h('div', { class: 'card soft stage1-checklist' });
  card.appendChild(h('div', { class: 'card-title', text: '🔤 单词奠基 · 通关进度' }));
  card.appendChild(h('p', { class: 'hint', text: '三件事都做好，核心句型就解锁啦～' }));
  rows.forEach((r) => {
    card.appendChild(h('div', { class: 'check-row', style: 'display:flex;align-items:center;gap:8px;margin:8px 0' }, [
      h('span', { style: 'flex:0 0 auto;font-size:18px', text: r.done ? '✅' : '⬜' }),
      h('span', { style: 'flex:1 1 auto;min-width:0' }, [
        h('div', { style: 'font-weight:700;font-size:var(--fs-md)', text: r.text }),
        h('small', { class: 'hint', text: r.hint }),
      ]),
      r.done ? null : h('button', {
        class: 'btn ghost', style: 'flex:0 0 auto',
        text: goText[r.key] || '去做',
        onclick: () => ctx.navigate(routes[r.key]),
      }),
    ]));
  });
  return card;
}

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
          // 点锁着的核心句型时，直接报出具体还差哪几件事（孩子最需要的引导）
          if (s.idx === 1 && stagePassed[0] === false) {
            const missing = stage1Checklist(unit, p || {}).filter((r) => !r.done);
            const detail = missing.map((r) => r.text).join('；');
            toast(missing.length ? `先完成「单词奠基」还差 ${missing.length} 件事：${detail}` : '先完成「单词奠基」才能来这里哦', 4500);
          } else {
            toast(`先完成「${STAGES[s.idx - 1]?.name || '前面的阶段'}」才能来这里哦`);
          }
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

  // 通关进度卡放在最上方（目标卡之后、阶段列表之前）——
  // 之前放在列表底部，孩子看到"未解锁"就不往下滚了，根本看不到引导。
  const checklistCard = stagePassed[0] === true ? null : stage1ProgressCard(ctx, unit, p || {});

  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回单元地图', onclick: () => ctx.navigate('#/') }),
    goal,
    checklistCard,
    h('div', { class: 'card-title', text: `学习路径（已通过 ${unlocked} / 4 个阶段）` }),
    list,
  ]);
}
