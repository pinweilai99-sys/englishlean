// 单词图卡：三步学习流（听音 → 认形 → 跟读），跟读达标才点亮
// 已点亮的词可"🔁 再学一遍"：清空本词星标、从头重学，学完重新点亮；
// 每词学习遍数（learnCount，存于 reviewCount）落盘并展示。
import { h, toast, starFly } from './dom.js?v=1794384134';
import * as tts from '../services/tts.js?v=1794384134';
import * as recorder from '../services/recorder.js?v=1794384134';
import * as speech from '../services/speech-match.js?v=1794384134';
import { scorePronunciation, scoreFeedback } from '../core/scoring.js?v=1794384134';
import { chunkSay } from '../core/phonics.js?v=1794384134';
import * as localAsr from '../services/local-asr.js?v=1794384134';

// ── 分块区形态判定（渲染与拼读示范共用，避免两处逻辑漂移）─────────────
// 2026-11-06 家长截图质疑"记词分块这行是不是可以去掉"。查数据发现 12 词分两类：
//   · 多音节词（rabbit/lovely/goldfish/clever/parrot）：chunks == split（都是音节），
//     两行渲染出**一模一样的 cle · ver** → 纯视觉冗余；
//   · 单音节词（may/pet/feed/hold/shop/back）：chunks 只有整词一块，split 才是字母结构；
//   · Mrs：两者都是整词。
// 所以不是"删掉一行"，而是**每词各留其所长**：
//   多音节 → 留「🧩 记词分块」（是按钮，点一下读这一块，有交互价值）
//   单音节 → 留「🔤 拼读拆分」（m + ay，才是真正的拼读结构）
//   Mrs    → 两行都不留，只剩 💡 记忆提示
// 返回 pieces：拼读示范要高亮的块（多音节=音节块，单音节=字母块），空数组=无可高亮。
export function blockRows(w) {
  const chunks = Array.isArray(w.chunks) && w.chunks.length ? w.chunks : [];
  const split = Array.isArray(w.split) && w.split.length ? w.split : [];
  const multiSyllable = chunks.length > 1;
  const showChunkRow = multiSyllable;
  const showSplitRow = !multiSyllable && split.length > 1;
  return {
    chunks,
    split,
    showChunkRow,
    showSplitRow,
    // 高亮目标：多音节点亮音节按钮，单音节点亮字母拆分块
    pieces: showChunkRow ? chunks : (showSplitRow ? split : []),
    pieceSelector: showChunkRow ? '.chunk-btn' : '.split-piece',
  };
}

export function renderWordCard(ctx, unit) {
  const p = ctx.getUnitProgress(unit.id);
  const words = unit.words;
  const doneSet = new Set(p?.wordsDone || []);
  const session = ctx.session;
  if (typeof session.wordIndex !== 'number') session.wordIndex = 0;
  if (typeof session.step !== 'number') session.step = 0;

  const wrap = h('div', { class: 'card wordcard' });
  // 渲染代号：每次 renderCard() 重建 DOM 时 +1。
  // 拼读示范的高亮元素挂在 DOM 上，重建后旧元素已被移除 ——
  // 若旧示范还活着，它会清掉/点亮**新**卡片的块，与新示范互相打架
  // （2026-11-06 实测：切词后新词的高亮被旧示范清空）。
  let renderGen = 0;

  function learnTimes(w) {
    // 每次渲染实时读取最新进度（入口捕获的 p 在落盘后会过期）
    const fresh = ctx.getUnitProgress(unit.id);
    return (fresh?.reviewCount || {})[w.w] || 0;
  }

  function renderCard() {
    renderGen += 1;
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

    // ── 分块区：按词的形态自适应，**每词只显示有信息增量的那一行** ──
    // 判定规则见模块级 blockRows()（渲染与拼读示范共用同一套逻辑）。
    const { chunks, split, showChunkRow, showSplitRow } = blockRows(w);

    const chunkBtns = h('div', { class: 'chunk-row' });
    chunks.forEach((c, ci) => {
      if (ci > 0) chunkBtns.appendChild(h('span', { class: 'chunk-dot', text: '·' }));
      chunkBtns.appendChild(h('button', {
        class: 'chunk-btn',
        text: c,
        'aria-label': `读 ${c}`,
        onclick: () => tts.speak(chunkSay(c.toLowerCase())),
      }));
    });

    // 🔤 拼读拆分：把单词按"怎么拼出来的"拆开（may → m + ay）。
    // 拆分块**只做展示 + 高亮**，不单独发音——单个字母交给 TTS 会被念成字母名
    //（em / ay），会把孩子教成"念字母名"而不是"读音"，反而错。
    const splitRow = h('div', { class: 'split-row' });
    if (showSplitRow) {
      split.forEach((p, pi) => {
        if (pi > 0) splitRow.appendChild(h('span', { class: 'split-dot', text: '+' }));
        splitRow.appendChild(h('span', { class: 'split-piece', text: p }));
      });
    }

    wrap.appendChild(h('div', { class: 'memo-box' }, [
      showChunkRow
        ? h('p', { class: 'memo-title', text: '🧩 记词分块（点一块读一块）' })
        : null,
      showChunkRow ? chunkBtns : null,
      showSplitRow
        ? h('div', { class: 'split-wrap' }, [
          h('p', { class: 'split-title', text: '🔤 拼读拆分（这个词是这样拼出来的）' }),
          splitRow,
        ])
        : null,
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
        onclick: () => {
          // 步骤立即推进（学习不被示范时长卡住），拼读示范在后台播
          session.step = 1;
          renderCard();
          session.blendSeq = (session.blendSeq || 0) + 1;
          void playBlend(w);
        },
      }));
    } else if (step === 1) {
      actions.appendChild(h('button', {
        class: 'btn ghost', text: '🔊 再听一次',
        onclick: () => tts.speak(w.tts || w.w),
      }));
      actions.appendChild(h('button', {
        class: 'btn leaf', text: '我会认这个词 →',
        onclick: () => {
          // 进入跟读＝要录孩子的音了：必须停掉后台拼读示范，
          // 否则示范的声音会进麦克风，污染发音评分。
          session.blendSeq = (session.blendSeq || 0) + 1;
          tts.cancel();
          session.step = 2;
          renderCard();
        },
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
          // 换词＝旧词的示范立刻作废（代号+1），避免串到下一个词上
          session.blendSeq = (session.blendSeq || 0) + 1;
          tts.cancel();
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

  // ── 拼读示范（拆音 → 合音）────────────────────────────────────────
  // 2026-11-06 家长提问："听一听的时候，能不能把拼读拆分也加进去？"
  // 原行为：「听一听」只孤立播一遍整词，孩子听到 /meɪ/ 却不知道它由什么拼成；
  //         拼读拆分区只能单独点，与"听"这一步割裂。
  // 定版做法（自然拼读教学标准三步）：
  //   ① 慢速读整词 —— 放慢后词内边界更清楚，孩子听出"里面由几块拼成"
  //   ② 逐块拆读   —— 只拆**音节级**音块（chunks），单字母不念（会被念成字母名，教错音）
  //   ③ 合回整词   —— 再听一遍正常语速的整词，孩子确认"拼起来就是这个词"
  // 播放过程中同步高亮：拼读拆分块（split）+ 音节块（chunks），孩子看着"哪块在响"。
  //
  // 三个关键工程约定：
  //  1) **不阻塞步骤推进**：示范是"加料"不是"门禁"。点「听一听」立即进入②认形，
  //     示范在后台播；即使全程无声（手机无 TTS 引擎），也只是没有声音，绝不卡住学习。
  //  2) **可被打断**：用 session.blendSeq 做代号，孩子切词/进入跟读/离开页面后，
  //     正在播的示范立刻收声，不会在孩子录音时把麦里的声音污染（影响发音评分）。
  //  3) **不留静音空等**（2026-11-06 家长反馈"有时候要等好久"）：
  //     旧实现单音节词（may → m + ay）在拆读阶段是 620ms × 块数 的**纯静音等待**，
  //     pet/feed 三个块 = 1.9 秒一声不吭 → 听起来就是"卡住了/读不出来"。
  //     现在单音节词改为：慢速整词播放**期间**按播放进度同步推进高亮，
  //     声音始终在响、高亮跟着走，全程没有任何无声空档。
  async function playBlend(w) {
    const seq = session.blendSeq || 0;
    const gen = renderGen; // 本次示范绑定的渲染代号
    const word = w.tts || w.w;
    // 与渲染共用同一套判定（blockRows）：
    // 多音节词的高亮目标是「音节按钮 .chunk-btn」，单音节词是「字母拆分块 .split-piece」。
    const { chunks, split, pieces, pieceSelector } = blockRows(w);
    // 每次高亮都重新取元素：卡片可能已重渲染（步骤推进会重建 DOM）
    const els = (sel) => Array.from(wrap.querySelectorAll(sel));
    const clearHi = () => {
      els('.split-piece').forEach((el) => el.classList.remove('is-speaking'));
      els('.chunk-btn').forEach((el) => el.classList.remove('is-speaking'));
    };
    // 高亮第 i 块（目标随词形自适应）
    // 代号保护：卡片已重渲染时旧示范不得再动新卡片的高亮
    const hiPiece = (i) => {
      if (renderGen !== gen) return;
      clearHi();
      const el = els(pieceSelector)[i];
      if (el) el.classList.add('is-speaking');
    };
    // 已被新动作取代（换词/进跟读/离开页面/重新渲染）→ 立刻收声
    // gen 检查不可省：renderCard() 重建 DOM 后旧元素已移除，
    // 旧示范若继续运行会清掉新卡片的高亮（切词后高亮消失的根因）。
    const alive = () => (session.blendSeq || 0) === seq
      && renderGen === gen
      && wrap.isConnected !== false;
    // 慢速整词播放期间，按进度比例同步点亮对应块（声音不断，无静音空档）
    //
    // 兜底节拍器（2026-11-06）：降级到 speechSynthesis 时没有真实进度回调
    // （手机无英语 TTS 引擎的设备走的就是这条路），高亮会停在第一块不动。
    // 关键：**节拍器与播放结束解耦** —— 播放提前结束（降级路径的 TTS 立即返回）
    // 也不能让它停，否则高亮只亮第一块。节拍器按块数均分走完，或被真实进度接管。
    const slowWithSyncHi = () => {
      let progressed = false;
      const per = 420; // 每块约 420ms（慢速语速下 2 块 ≈ 840ms，与真实音频接近）
      let idx = 0;
      const beat = setInterval(() => {
        if (!alive()) { clearInterval(beat); return; }
        if (progressed) return; // 真实进度已接管，停掉兜底
        idx += 1;
        if (idx >= pieces.length) { clearInterval(beat); return; }
        hiPiece(idx);
      }, per);
      const stop = () => clearInterval(beat);
      return tts.speakSlow(word, {
        rate: 0.62,
        onProgress: (cur, dur) => {
          if (!alive() || !dur || !pieces.length) return;
          progressed = true;
          stop();
          const ratio = Math.min(0.999, Math.max(0, cur / dur));
          hiPiece(Math.min(pieces.length - 1, Math.floor(ratio * pieces.length)));
        },
      }).finally(() => {
        // 不在这里停节拍器：降级路径播放会立即结束，但高亮仍需走完
        if (progressed) stop();
      });
    };

    try {
      // ① 慢速读整词（高亮分块结构，孩子先听见整体）
      hiPiece(0);
      if (pieces.length > 1) await slowWithSyncHi();
      else await tts.speakSlow(word);
      if (!alive()) return;

      // ② 逐块拆读：只有音节级音块才念（单字母念出来是字母名，会教错音）
      if (chunks.length > 1) {
        for (let i = 0; i < chunks.length; i++) {
          if (!alive()) return;
          hiPiece(i);
          // eslint-disable-next-line no-await-in-loop
          await tts.speak(chunkSay(chunks[i].toLowerCase()));
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 220));
        }
      } else if (split.length > 1) {
        // 单音节词（may → m + ay）：**不单独念字母**（避免念成 em/ay 教错音），
        // 改为慢速整词再走一遍，拆分高亮随声音同步推进。
        await slowWithSyncHi();
      }

      // ③ 合回整词：正常语速的完整音，孩子确认"拼起来就是这个词"
      if (!alive()) return;
      clearHi();
      // eslint-disable-next-line no-await-in-loop
      await tts.speak(word);
    } finally {
      // 只清理自己这一代的高亮：若卡片已重渲染（renderGen 变了），
      // 此时的 clearHi() 会误清掉**新**卡片的高亮。
      if (renderGen === gen) clearHi();
    }
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
    h('button', {
      class: 'back-btn', text: '← 返回学习路径',
      onclick: () => {
        // 离开单词卡：停掉后台拼读示范，别让声音跟着跑到别的页面
        session.blendSeq = (session.blendSeq || 0) + 1;
        tts.cancel();
        ctx.navigate(`#/unit/${unit.id}`);
      },
    }),
    wrap,
    h('div', { class: 'btn-row nav-row' }, [
      h('button', { class: 'btn ghost', text: '👂 去听辨游戏', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/listen`) }),
      h('button', { class: 'btn ghost', text: '🔤 去拼写屋', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/spelling`) }),
      h('button', { class: 'btn ghost', text: '✍️ 去字帖屋', onclick: () => ctx.navigate(`#/unit/${unit.id}/stage/0/handwriting`) }),
    ]),
  ]);
}
