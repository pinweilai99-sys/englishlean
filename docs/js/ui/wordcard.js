// 单词图卡：三步学习流（听音 → 认形 → 跟读），跟读达标才点亮
// 已点亮的词可"🔁 再学一遍"：清空本词星标、从头重学，学完重新点亮；
// 每词学习遍数（learnCount，存于 reviewCount）落盘并展示。
import { h, toast, starFly } from './dom.js?v=1793713418';
import * as tts from '../services/tts.js?v=1793713418';
import * as recorder from '../services/recorder.js?v=1793713418';
import * as speech from '../services/speech-match.js?v=1793713418';
import { scorePronunciation, scoreFeedback } from '../core/scoring.js?v=1793713418';
import * as localAsr from '../services/local-asr.js?v=1793713418';

export function renderWordCard(ctx, unit) {
  const p = ctx.getUnitProgress(unit.id);
  const words = unit.words;
  const doneSet = new Set(p?.wordsDone || []);
  const session = ctx.session;
  if (typeof session.wordIndex !== 'number') session.wordIndex = 0;
  if (typeof session.step !== 'number') session.step = 0;

  const wrap = h('div', { class: 'card wordcard' });

  function learnTimes(w) {
    // 每次渲染实时读取最新进度（入口捕获的 p 在落盘后会过期）
    const fresh = ctx.getUnitProgress(unit.id);
    return (fresh?.reviewCount || {})[w.w] || 0;
  }

  function renderCard() {
    wrap.innerHTML = '';
    const i = session.wordIndex;
    const w = words[i];
    if (!w) return;
    const done = doneSet.has(w.w);
    const step = done ? 3 : session.step;
    const times = learnTimes(w);

    const round = (() => {
      const fresh = ctx.getUnitProgress(unit.id);
      return (fresh?.learnRound) || 1;
    })();
    wrap.appendChild(h('div', { class: 'card-sub', text: `第 ${round} 轮 · 单词 ${i + 1} / ${words.length}　${done ? `✅ 已学会 · 已学 ${times} 遍` : '🌱 学习中'}` }));
    wrap.appendChild(h('div', { class: 'word-pic', text: w.img }));
    wrap.appendChild(h('div', { class: 'word-text', text: w.w }));
    wrap.appendChild(h('div', { class: 'word-ipa', text: w.ipa }));
    wrap.appendChild(h('div', { class: 'word-zh', text: w.zh }));
    wrap.appendChild(h('div', {}, [h('span', { class: `tier-tag ${w.tier}`, text: w.tier === 'four' ? '四会词（会读会写）' : '认读词（会读会认）' })]));

    // 🧩 记词分块：读音分块（点击可分块发音）+ 一句记忆提示（音节/合成词/字母组合）
    const chunks = Array.isArray(w.chunks) && w.chunks.length ? w.chunks : [w.w];
    const chunkBtns = h('div', { class: 'chunk-row' });
    chunks.forEach((c, ci) => {
      if (ci > 0) chunkBtns.appendChild(h('span', { class: 'chunk-dot', text: '·' }));
      chunkBtns.appendChild(h('button', {
        class: 'chunk-btn',
        text: c,
        'aria-label': `读 ${c}`,
        onclick: () => tts.speak(c.toLowerCase()),
      }));
    });
    wrap.appendChild(h('div', { class: 'memo-box' }, [
      h('p', { class: 'memo-title', text: '🧩 记词分块（点一块读一块）' }),
      chunkBtns,
      h('p', { class: 'memo-hint', text: `💡 ${w.memo || ''}` }),
    ]));

    const steps = h('div', { class: 'steps' });
    ['① 听音', '② 认形', '③ 跟读'].forEach((label, si) => {
      steps.appendChild(h('span', {
        class: `step ${si < step ? 'is-done' : (si === step ? 'is-current' : '')}`,
        text: label,
      }));
    });
    wrap.appendChild(steps);

    const actions = h('div', { class: 'btn-row', style: 'justify-content:center' });

    if (step === 0) {
      actions.appendChild(h('button', {
        class: 'btn', text: '🔊 听一听',
        onclick: async () => {
          await tts.speak(w.tts || w.w);
          session.step = 1;
          renderCard();
        },
      }));
    } else if (step === 1) {
      actions.appendChild(h('button', {
        class: 'btn ghost', text: '🔊 再听一次',
        onclick: () => tts.speak(w.tts || w.w),
      }));
      actions.appendChild(h('button', {
        class: 'btn leaf', text: '我会认这个词 →',
        onclick: () => { session.step = 2; renderCard(); },
      }));
    } else if (step === 2) {
      // 家长定版（2026-11-03）：技术性提示文案（浏览器识别能力/Safari 等）不显示给孩子，
      // 识别能力差异由降级链内部处理，兜底按钮永远可用。
      actions.appendChild(h('button', {
        class: 'btn ghost', text: '🔊 听标准音',
        onclick: () => tts.speak(w.tts || w.w),
      }));
      actions.appendChild(h('button', {
        class: 'btn sky', text: '🎤 我来读',
        onclick: () => doRecord(w),
      }));
      // 兜底按钮永远显示：识别不可用/失败时，学习绝不被技术卡死
      actions.appendChild(h('button', {
        class: `btn ghost ${session.recognizeFailed ? 'is-guiding' : ''}`,
        text: '✅ 我读好了（手动点亮）',
        onclick: () => finishWord(w, { score: 60, level: 'ok', matched: true, reason: 'manual' }),
      }));
    } else {
      // 完成态：可进入下一个，也可清空星标重新学
      actions.appendChild(h('button', {
        class: 'btn leaf', text: '➡️ 下一个单词',
        onclick: () => {
          session.wordIndex = (i + 1) % words.length;
          session.step = 0;
          renderCard();
        },
      }));

    }
    wrap.appendChild(actions);

    const dotRow = h('div', { class: 'word-progress' });
    words.forEach((ww) => {
      dotRow.appendChild(h('span', {
        class: `word-dot ${ww.tier} ${doneSet.has(ww.w) ? 'is-done' : ''}`,
        text: doneSet.has(ww.w) ? '★' : '',
        title: `${ww.w}（已学 ${learnTimes(ww)} 遍）`,
      }));
    });
    wrap.appendChild(dotRow);

    // 单元级重学：12 词全部点亮后才出现，点一次 = 全部词重新再学一轮
    if (doneSet.size === words.length) {
      const fresh = ctx.getUnitProgress(unit.id);
      const nextRound = (fresh?.learnRound || 1) + 1;
      wrap.appendChild(h('div', { style: 'text-align:center;margin-top:16px' }, [
        h('button', {
          class: 'btn leaf', text: `🔁 全部单词重来一次（进入第 ${nextRound} 轮）`,
          onclick: () => restartAll(),
        }),
        h('p', { class: 'hint', style: 'text-align:center', text: '点一下，全部五角星清空，从第 1 个词重新学一轮～' }),
      ]));
    }
  }

  // 全部重学：清空全部星标，从第 1 个词开始新一轮
  function restartAll() {
    doneSet.clear();
    ctx.updateUnitProgress(unit.id, (up) => ({
      ...up,
      wordsDone: [],
      learnRound: (up.learnRound || 1) + 1,
    }));
    session.wordIndex = 0;
    session.step = 0;
    renderCard();
    toast('🔁 新的一轮开始！从第 1 个词重新学～', 2600);
  }

  async function doRecord(w) {
    // 按需加载本地识别模型：用户真的要用麦克风了才开始下载（手机端不自动下 41MB）。
    // 后台进行、不等待——本次跟读照常走降级链（浏览器识别 / 手动点亮）。
    if (localAsr.getStatus().status === 'idle') {
      try { localAsr.startBackgroundDownload(); } catch (e) { /* 静默 */ }
    }
    const started = await recorder.start();
    if (!started.ok) {
      toast('没有麦克风也没关系～点"我读好了"继续');
      return;
    }
    toast('🎤 正在录音，请大声读出来！');
    await new Promise((r) => setTimeout(r, 2600));
    const rec2 = await recorder.stop();

    // 优先级 1：本地 Whisper 已就绪 → 离线转写打分（任何浏览器可用）
    if (rec2?.blob && localAsr.isReady()) {
      const t = await localAsr.transcribe(rec2.blob);
      if (t && t.ok) {
        if (doneSet.has(w.w)) return; // 竞态防护
        const result = scorePronunciation(w.tts || w.w, t.text);
        if (result.level === 'good') {
          finishWord(w, result);
        } else {
          toast(scoreFeedback(result), 2600);
          session.step = 2;
          renderCard();
        }
        return;
      }
      // 本地转写失败 → 落到下面的浏览器识别/诚实反馈链
    }

    // 优先级 2：浏览器自带识别（Safari 本地 / Chrome 云）
    const rec = await speech.recognizeOnce('en-US', 4000);
    if (!rec.ok || !rec.transcript) {
      // 孩子可能已手动点亮（竞态）：已点亮就不再处理
      if (doneSet.has(w.w)) return;
      // 用户要求：识别失败不弹任何提示——绿色按钮闪绿光引导已足够，学习不被打断
      session.recognizeFailed = true;
      renderCard();
      return;
    }
    // 迟到的识别结果：已点亮就不再重复加星/提示
    if (doneSet.has(w.w)) return;
    const result = scorePronunciation(w.tts || w.w, rec.transcript);
    if (result.level === 'good') {
      finishWord(w, result);
    } else {
      toast(scoreFeedback(result), 2600);
      session.step = 2;
      renderCard();
    }
  }

  function finishWord(w, result) {
    if (doneSet.has(w.w)) return; // 防重复点亮/重复加星
    doneSet.add(w.w);
    session.recognizeFailed = false;
    const next = ctx.updateUnitProgress(unit.id, (up) => ({
      ...up,
      wordsDone: Array.from(doneSet),
      // 学习遍数：首次点亮=1 遍，每重学一次 +1
      reviewCount: { ...(up.reviewCount || {}), [w.w]: ((up.reviewCount || {})[w.w] || 0) + 1 },
    }));
    ctx.addStars(result?.score >= 80 ? 2 : 1);
    starFly(result?.score >= 80 ? 2 : 1);
    session.step = 3;
    void next;
    renderCard();
    // 点亮瞬间用明确的成功提示覆盖旧的"没听清"，避免信息自相矛盾
    toast(result?.level === 'good' ? scoreFeedback(result) : '⭐ 点亮成功！继续加油～', 2600);
    if (doneSet.size === words.length) {
      toast('🎉 全部单词都点亮啦！去听辨游戏检验一下', 3200);
    }
  }

  renderCard();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
    h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn ghost', text: '👂 去听辨游戏', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/listen`) }),
      h('button', { class: 'btn ghost', text: '🔤 去拼写屋', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/spelling`) }),
      h('button', { class: 'btn ghost', text: '✍️ 去字帖屋', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/handwriting`) }),
    ]),
  ]);
}
