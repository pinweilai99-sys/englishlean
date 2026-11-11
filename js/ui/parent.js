// 家长中心：语法参考卡 / 学习报告 / 错题本 / 导出恢复重置
import { h, clear, toast, confirmDialog, modal } from './dom.js';
import { exportState, importState, resetState } from '../core/storage.js';

export function renderParent(ctx, unit) {
  const state = ctx.state;
  const wrap = h('div', { class: 'card' });

  // 语法参考卡
  wrap.appendChild(h('div', { class: 'card-title', text: '📖 语法参考卡（给家长）' }));
  const g = h('div', { class: 'stage-list' });
  unit.grammar.parentCard.forEach((line) => {
    g.appendChild(h('div', { class: 'stage-item is-open' }, [
      h('span', { class: 'stage-no', text: '·' }),
      h('span', { class: 'stage-meta' }, [h('strong', { style: 'font-weight:600', text: line })]),
    ]));
  });
  wrap.appendChild(g);

  // 学习报告
  const p = state.progress?.[unit.id];
  const wordsDone = p?.wordsDone?.length || 0;
  const wordTotal = unit.words.length;
  const quizBest = p?.quizBest;
  wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '📊 学习报告' }));
  const fourTotal = unit.words.filter((w) => w.tier === 'four').length;
  const spellingDone = p?.spellingDone?.length || 0;
  const handwritingDone = p?.handwritingDone?.length || 0;
  const reviewTotal = Object.values(p?.reviewCount || {}).reduce((a, b) => a + b, 0);
  const stats = h('div', { class: 'stat-row' }, [
    h('span', { class: 'stat', text: `🔤 单词 ${wordsDone}/${wordTotal}` }),
    h('span', { class: 'stat', text: `🔤 拼写 ${spellingDone}/${fourTotal}` }),
    h('span', { class: 'stat', text: `✍️ 描红 ${handwritingDone}/${wordTotal}` }),
    h('span', { class: 'stat', text: `🔁 累计学习 ${reviewTotal} 遍` }),
    h('span', { class: 'stat', text: `📚 学习轮次 第 ${p?.learnRound || 1} 轮` }),
    h('span', { class: 'stat', text: `⭐ 总星星 ${state.stars || 0}` }),
    h('span', { class: 'stat', text: `🔥 连续 ${state.streak || 0} 天` }),
    h('span', { class: 'stat', text: `📝 微测 ${quizBest === null || quizBest === undefined ? '未测' : Math.round(quizBest * 100) + '%'}` }),
    h('span', { class: 'stat', text: `❌ 错题 ${(state.wrongBank || []).length}` }),
  ]);
  wrap.appendChild(stats);

  // 错题本
  wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '❌ 错题本' }));
  const wb = (state.wrongBank || []).filter((w) => w.unit === unit.id);
  if (!wb.length) {
    wrap.appendChild(h('p', { class: 'hint', text: '还没有错题，真棒！' }));
  } else {
    wb.forEach((w, i) => {
      wrap.appendChild(h('div', { class: 'stage-item is-open' }, [
        h('span', { class: 'stage-no', text: String(i + 1) }),
        h('span', { class: 'stage-meta' }, [
          h('strong', { style: 'font-weight:600', text: w.q }),
          h('small', { text: `正确答案：${w.a}　你的答案：${w.chosen}` }),
        ]),
      ]));
    });
  }

  // 本地识别模型状态
  import('../services/local-asr.js').then(() => {}).catch(() => {});
  wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '🎙️ 发音识别（本地模型）' }));
  const laWrap = h('div', {});
  wrap.appendChild(laWrap);
  import('../services/local-asr.js').then((localAsr) => {
    const st = localAsr.getStatus();
    const desc = st.status === 'ready' ? '✅ 已就绪——跟读自动打分（离线可用）'
      : st.status === 'loading' ? `⏳ 后台下载中 ${st.progress}%（下载完成后自动启用，不影响学习）`
      : st.status === 'failed' ? `❌ 下载失败：${st.error || '网络问题'}（可重试）`
      : '💤 未启动（打开网页片刻后会自动在后台下载，约 40MB，仅下载一次）';
    clear(laWrap);
    laWrap.appendChild(h('p', { class: 'hint', text: desc }));
    laWrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      h('button', {
        class: 'btn ghost', text: st.status === 'failed' ? '🔄 重试下载' : '⏬ 立即开始后台下载',
        onclick: async () => {
          await localAsr.startBackgroundDownload();
          toast(localAsr.isReady() ? '✅ 本地识别已就绪！' : '⏳ 正在后台下载，可离开页面');
          ctx.render();
        },
      }),
    ]));
  }).catch(() => {});

  // 发音自检（2026-11-11 家长反馈：安卓平板弹「找不到 Google 引擎」且无声）
  // 家长最需要知道的是「这台设备能不能出声、为什么不能、怎么办」，所以做成可点自检。
  wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '🔊 发音自检' }));
  wrap.appendChild(h('p', { class: 'hint', text: '点一下试听，确认这台设备能不能发出英语声音。' }));
  const audioBox = h('div', {});
  wrap.appendChild(audioBox);
  const paintAudio = (desc) => {
    clear(audioBox);
    audioBox.appendChild(h('p', { class: 'hint', text: desc }));
  };
  paintAudio('（还没检测过，点下面的按钮试试）');
  wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
    h('button', {
      class: 'btn ghost', text: '🔊 试听一句',
      onclick: async () => {
        const { hasUsableVoice } = await import('../services/tts.js');
        const { hasAudio, retryManifest } = await import('../services/audio.js');
        paintAudio('⏳ 正在检测…');
        let audio = hasAudio('pet');
        if (!audio) {
          // 清单没加载上（弱网/被限速）→ 重拉一次再判定
          await retryManifest(3000);
          audio = hasAudio('pet');
        }
        const voice = hasUsableVoice();
        if (audio) {
          paintAudio('✅ 预生成发音可用（不依赖系统语音引擎，任何设备都能出声）。');
        } else if (voice) {
          paintAudio('⚠️ 预生成发音暂未加载，但系统有英语语音引擎，可以朗读。');
        } else {
          paintAudio('❌ 这台设备既没有预生成发音、也没有英语语音引擎。\n解决办法：① 换用 Chrome/Edge 浏览器；② 用「离线版」网页文件（englishlean-offline.html，双击即可打开，完全不依赖网络）。');
        }
      },
    }),
  ]));

  // 数据管理
  wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '💾 数据备份与恢复' }));
  wrap.appendChild(h('p', { class: 'hint', text: '进度保存在本机浏览器。换设备或清理缓存前，请先导出备份。' }));
  wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:10px' }, [
    h('button', {
      class: 'btn', text: '⬇️ 导出进度',
      onclick: () => {
        const text = exportState(state);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        a.href = url;
        a.download = `englishlean_backup_${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('备份已导出～');
      },
    }),
    h('button', {
      class: 'btn ghost', text: '⬆️ 恢复进度',
      onclick: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          const res = importState(localStorage, text);
          if (!res.ok) { toast(`❌ ${res.error}`); return; }
          confirmDialog('确认恢复？', '恢复后会覆盖当前本机进度，确定吗？', () => {
            ctx.replaceState(res.state);
            toast('进度已恢复！');
            ctx.render();
          }, '确定恢复');
        };
        input.click();
      },
    }),
    h('button', {
      class: 'btn ghost', text: '🗑️ 清空本机进度',
      onclick: () => {
        confirmDialog('清空进度？', '会清除本机所有学习记录（不影响内容数据），此操作不可撤销。', () => {
          const s = resetState(localStorage);
          ctx.replaceState(s);
          toast('已清空');
          ctx.render();
        }, '确定清空');
      },
    }),
  ]));

  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回单元', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
