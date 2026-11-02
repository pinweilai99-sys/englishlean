// 单词图卡：三步学习流（听音 → 认形 → 跟读），跟读达标才点亮
// 已点亮的词可"🔁 再学一遍"进入复习模式（不重置点亮，记录每词复习遍数）。
import { h, toast, starFly } from './dom.js';
import * as tts from '../services/tts.js';
import * as recorder from '../services/recorder.js';
import * as speech from '../services/speech-match.js';
import { scorePronunciation, scoreFeedback } from '../core/scoring.js';

export function renderWordCard(ctx, unit) {
  const p = ctx.getUnitProgress(unit.id);
  const words = unit.words;
  const doneSet = new Set(p?.wordsDone || []);
  const session = ctx.session;
  if (typeof session.wordIndex !== 'number') session.wordIndex = 0;
  if (typeof session.step !== 'number') session.step = 0;

  const wrap = h('div', { class: 'card wordcard' });

  // 复习模式：reviewing === 当前词时，重走三步但不改变点亮状态
  function isReviewing(w) {
    return session.reviewing === w.w;
  }

  function renderCard() {
    wrap.innerHTML = '';
    const i = session.wordIndex;
    const w = words[i];
    if (!w) return;
    const done = doneSet.has(w.w);
    const reviewing = isReviewing(w);
    const step = (!done || reviewing) ? session.step : 3;
    const reviewCount = (p?.reviewCount || {})[w.w] || 0;

    wrap.appendChild(h('div', { class: 'card-sub', text: `单词 ${i + 1} / ${words.length}　${done ? `✅ 已学会${reviewing ? '　🔁 复习中…' : `（已复习 ${reviewCount} 遍）`}` : ''}` }));
    wrap.appendChild(h('div', { class: 'word-pic', text: w.img }));
    wrap.appendChild(h('div', { class: 'word-text', text: w.w }));
    wrap.appendChild(h('div', { class: 'word-ipa', text: w.ipa }));
    wrap.appendChild(h('div', { class: 'word-zh', text: w.zh }));
    wrap.appendChild(h('div', {}, [h('span', { class: `tier-tag ${w.tier}`, text: w.tier === 'four' ? '四会词（会读会写）' : '认读词（会读会认）' })]));

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
      actions.appendChild(h('button', {
        class: 'btn ghost', text: '🔊 听标准音',
        onclick: () => tts.speak(w.tts || w.w),
      }));
      actions.appendChild(h('button', {
        class: 'btn sky', text: '🎤 我来读',
        onclick: () => doRecord(w),
      }));
      // 兜底按钮永远显示：识别不可用/失败时，学习绝不被技术卡死
      // 识别失败过一次后，按钮自动闪绿光引导孩子去点
      actions.appendChild(h('button', {
        class: `btn ghost ${session.recognizeFailed ? 'is-guiding' : ''}`,
        text: '✅ 我读好了（手动点亮）',
        onclick: () => completeWordStep(w, { score: 60, level: 'ok', matched: true, reason: 'manual' }),
      }));
    } else {
      // 完成态
      actions.appendChild(h('button', {
        class: 'btn leaf', text: '➡️ 下一个单词',
        onclick: () => {
          session.wordIndex = (i + 1) % words.length;
          session.step = 0;
          renderCard();
        },
      }));
      // 复习入口：随时可以再学一遍（多次学习，不重置点亮）
      actions.appendChild(h('button', {
        class: 'btn ghost', text: '🔁 再学一遍',
        onclick: () => {
          session.reviewing = w.w;
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
        title: ww.w,
      }));
    });
    wrap.appendChild(dotRow);
  }

  async function doRecord(w) {
    const started = await recorder.start();
    if (!started.ok) {
      toast('没有麦克风也没关系～点"我读好了"继续');
      return;
    }
    toast('🎤 正在录音，请大声读出来！');
    await new Promise((r) => setTimeout(r, 2600));
    await recorder.stop();
    const rec = await speech.recognizeOnce('en-US', 4000);
    if (!rec.ok || !rec.transcript) {
      // 孩子可能已手动点亮（竞态）：已点亮就不再报"没听清"，避免自相矛盾的提示
      if (doneSet.has(w.w) && !isReviewing(w)) return;
      session.recognizeFailed = true;
      toast('没听清哦～点绿色按钮"我读好了"继续', 3600);
      renderCard();
      return;
    }
    // 迟到的识别结果：孩子已点亮且不在复习态就不再重复加星/提示
    if (doneSet.has(w.w) && !isReviewing(w)) return;
    const result = scorePronunciation(w.tts || w.w, rec.transcript);
    if (result.level === 'good') {
      completeWordStep(w, result);
    } else {
      toast(scoreFeedback(result), 2600);
      session.step = 2;
      renderCard();
    }
  }

  // 第三步完成的统一出口：新词 → 点亮；复习 → 计数
  function completeWordStep(w, result) {
    if (isReviewing(w)) {
      finishReview(w);
    } else {
      finishWord(w, result);
    }
  }

  function finishWord(w, result) {
    if (doneSet.has(w.w)) return; // 防重复点亮/重复加星
    doneSet.add(w.w);
    session.recognizeFailed = false;
    const next = ctx.updateUnitProgress(unit.id, (up) => ({
      ...up,
      wordsDone: Array.from(doneSet),
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

  function finishReview(w) {
    session.reviewing = null;
    session.step = 0;
    ctx.updateUnitProgress(unit.id, (up) => ({
      ...up,
      reviewCount: { ...(up.reviewCount || {}), [w.w]: ((up.reviewCount || {})[w.w] || 0) + 1 },
    }));
    session.wordIndex = (session.wordIndex + 1) % words.length;
    renderCard();
    toast('🔁 复习完成！温故而知新～', 2200);
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
