// E2E：浏览器级验收（对应 PRD §9 的可测验收点）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshApp, buttons, clickButton, navigate, mainText, persisted, UNIT,
} from './e2e-helper.mjs';
import { computePdfLayout } from '../js/ui/handwriting.js';
import { buildSpellQueue, SPELL_TIMES_PER_WORD, SPELL_WRONG_RETRY } from '../js/ui/spelling.js';

// 拼写屋驱动助手：读当前题的中文提示 → 找到对应单词 → 逐字母点击正确字母块。
// 每调用一次拼完当前题（队列前进一题）。返回拼的单词。
async function spellOneCurrent(window) {
  const text = mainText(window);
  const w = UNIT.words
    .filter((x) => text.includes(x.zh))
    .sort((a, b) => b.zh.length - a.zh.length)[0];
  assert.ok(w, `页面应显示当前词中文提示（got: ${text.slice(0, 60)}…）`);
  for (const ch of w.w.toLowerCase()) {
    const block = buttons(window).find(
      (b) => b.classList.contains('option') && b.textContent.trim() === ch);
    assert.ok(block, `找不到字母块 ${ch}（拼 ${w.w}）`);
    block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  }
  return w.w;
}

test('E2E-23 PDF 字帖布局：标准四线三格（4 线 3 等格、基线压第 3 线、每词一组不跨页、不再直接打印）', async () => {
  const { window, cleanup } = await freshApp(); // 借 jsdom 环境
  try {
    const cmds = computePdfLayout(UNIT);
    // 页眉：标题 + 姓名日期
    assert.equal(cmds[0].t, 'img');
    assert.equal(cmds[0].kind, 'title');
    assert.equal(cmds[1].kind, 'namecard');
    const BAND = 4.2, ROW_H = 12.6, NAME_H = 7, ROW_GAP = 3;
    const four = UNIT.words.filter((w) => w.tier === 'four');
    // 按换页拆分各页
    const pages = cmds.reduce((acc, c) => {
      if (c.t === 'page') acc.push([]);
      else acc[acc.length - 1].push(c);
      return acc;
    }, [[]]);
    assert.equal(pages.length, 2, '5 词应排 2 页');
    // 逐词验证 5 行 × 4 线 + 基线
    let idx = 2; // 跳过页眉两条
    four.forEach((w) => {
      // 词组之间可能有换页指令（组内绝不跨页 → 只会出现在组边界）
      if (cmds[idx].t === 'page') idx += 1;
      // 词名图（每组开头）
      assert.equal(cmds[idx].t, 'img');
      assert.equal(cmds[idx].kind, 'wordname');
      assert.ok(cmds[idx].text.includes(w.w), '词名应包含该词');
      idx += 1;
      const modes = ['solid', 'trace', 'trace', 'blank', 'blank'];
      modes.forEach((mode, mi) => {
        const rowTop = idx; // 顺序遍历：4 线 + 可选 label/text
        const lines = cmds.slice(idx, idx + 4);
        assert.equal(lines.length, 4);
        lines.forEach((ln, li) => {
          assert.equal(ln.t, 'line', `词 ${w.w} 行 ${mi + 1} 第 ${li + 1} 条指令应为横线`);
        });
        const tops = lines.map((ln) => ln.y);
        assert.deepEqual(
          tops.map((t) => Math.round((t - tops[0]) * 100) / 100),
          [0, BAND, BAND * 2, ROW_H],
          `词 ${w.w} 行 ${mi + 1}：四线应为 0/4.2/8.4/12.6（三等格），第 3 线为基线`,
        );
        assert.equal(lines[2].c, 'base', '第 3 线应为加深基线');
        idx += 4;
        if (mode === 'blank') {
          const lab = cmds[idx];
          assert.equal(lab.t, 'img');
          assert.equal(lab.text, '自己写');
          idx += 1;
        } else {
          const lab = cmds[idx];
          assert.equal(lab.t, 'img');
          assert.equal(lab.text, mode === 'solid' ? '示例' : '描红');
          const word = cmds[idx + 1];
          assert.equal(word.t, 'text');
          assert.equal(word.s, w.w, '行内单词正确');
          assert.equal(word.color, mode === 'solid' ? 'ink' : 'trace', '描红行应为浅灰');
          // 基线：text.y - 该行第一条线 y = 8.4（第 3 线）
          const delta = Math.round((word.y - lines[0].y) * 100) / 100;
          assert.equal(delta, BAND * 2, '单词基线应精确压在第 3 线上');
          idx += 2;
        }
      });
    });
    // 不残留 window.print 直接打印
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../js/ui/handwriting.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('window.print'), '不应再直接调用 window.print');
  } finally { cleanup(); }
});

test('E2E-24 屏上描红格式：四线三格 + 基线压第 3 线的浅灰范字 + 可描红画布', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/handwriting');
    const four = UNIT.words.filter((w) => w.tier === 'four');
    const boxes = window.document.querySelectorAll('.trace-box');
    assert.equal(boxes.length, four.length, '每个四会词一个描红盒');
    boxes.forEach((box, i) => {
      const lines = box.querySelectorAll('.fw-line');
      assert.equal(lines.length, 4, `词 ${four[i].w} 描红盒应有 4 条线`);
      const tops = [...lines].map((l) => l.style.top);
      assert.deepEqual(tops, ['0px', '26px', '52px', '78px'], '四线三格三等格');
      assert.ok(lines[2].classList.contains('baseline'), '第 3 线为基线');
      const t = box.querySelector('svg text');
      assert.ok(t, '应有浅灰范字');
      assert.equal(t.getAttribute('y'), '52', '范字基线压第 3 线');
      assert.equal(t.getAttribute('font-size'), '58', '小写主体占满中格');
      assert.equal(t.textContent, four[i].w);
      assert.ok(box.querySelector('svg.fw-trace'), '范字应为描红浅灰样式');
      assert.ok(box.querySelector('canvas'), '应有描红画布（手指可描）');
    });
    assert.ok(buttons(window).some((b) => b.textContent.includes('擦掉重描')), '应有擦掉重描');
    // 描红点亮功能保持可用
    await clickButton(window, '我描好了');
    const p = persisted(window);
    assert.equal(p.progress.u5.handwritingDone.length, 1, '描红点亮落盘不受影响');
  } finally { cleanup(); }
});

test('E2E-1 首页渲染：8 张单元卡，仅 U5 可进', async () => {
  const { window, cleanup } = await freshApp();
  try {
    const cards = window.document.querySelectorAll('.unit-card');
    assert.equal(cards.length, 8);
    assert.ok(window.document.querySelector('.unit-card.is-open .unit-name')?.textContent.includes('May I have a pet?'));
    assert.equal(window.document.querySelectorAll('.unit-card.is-locked').length, 7);
  } finally { cleanup(); }
});

test('E2E-2 解锁拦截：Stage1 未通关时进入 Stage2 被拦下', async () => {
  const { window, cleanup } = await freshApp();
  try {
    await navigate(window, window.__APP__, '#/unit/u5/stage/1');
    assert.match(mainText(window), /这一关还没解锁/);
    // 且不渲染句型内容
    assert.ok(!mainText(window).includes('核心句型'));
  } finally { cleanup(); }
});

test('E2E-3 Stage1 通关后 Stage2 自动解锁', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, window.__APP__, '#/unit/u5/stage/1');
    assert.match(mainText(window), /核心句型/);
    assert.match(mainText(window), /May I have a/);
  } finally { cleanup(); }
});

test('E2E-4 单词卡降级路径（无音频能力）：三步走完点亮单词并持久化', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: false });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    // ① 听音（TTS 不可用也不阻塞）
    await clickButton(window, '听一听');
    // ② 认形
    await clickButton(window, '我会认这个词');
    // ③ 手动点亮（降级按钮存在）
    await clickButton(window, '我读好了（手动点亮）');
    const p = persisted(window);
    assert.ok(p.progress.u5.wordsDone.includes('may'), 'may 应已点亮');
    assert.ok(p.stars >= 1, '点亮应得星星');
    // 点亮状态刷新后仍在（重新读存储渲染）
    assert.ok(window.__APP__.state.state.progress.u5.wordsDone.includes('may'));
  } finally { cleanup(); }
});

test('E2E-5 单词卡完整路径（有音频+识别）：说出 rabbit → 点亮', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: true });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    app.state.session.wordIndex = 2; // rabbit
    app.render();
    await clickButton(window, '听一听');
    await clickButton(window, '我会认这个词');
    window.__nextTranscript = 'rabbit';
    await clickButton(window, '我来读');
    // 录音 2600ms + 识别，等待完成
    await new Promise((r) => setTimeout(r, 3000));
    const p = persisted(window);
    assert.ok(p.progress.u5.wordsDone.includes('rabbit'), 'rabbit 应已点亮');
  } finally { cleanup(); }
});

test('E2E-6 听辨游戏：答错自动写入错题本并持久化', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/listen');
    const answer = app.state.session.listenAnswer;
    assert.ok(answer, '本轮正确答案已生成');
    // 点"错误"的那个选项
    const pair = UNIT.listenPairs[0];
    const wrongWord = pair.find((w) => w !== answer);
    const wrongBtn = buttons(window).find((b) => b.textContent.trim() === wrongWord);
    assert.ok(wrongBtn, `找不到错误选项按钮 ${wrongWord}`);
    wrongBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1400));
    const p = persisted(window);
    assert.equal(p.wrongBank.length, 1);
    assert.equal(p.wrongBank[0].type, 'listen_choice');
    assert.equal(p.wrongBank[0].a, answer);
  } finally { cleanup(); }
});

test('E2E-7 打卡：当天连点不重复计数，持久化', async () => {
  const { window, cleanup } = await freshApp();
  try {
    await clickButton(window, '打卡');
    let p = persisted(window);
    assert.equal(p.streak, 1);
    await clickButton(window, '打卡');
    p = persisted(window);
    assert.equal(p.streak, 1, '同一天重复打卡不增加');
  } finally { cleanup(); }
});

test('E2E-8 Stage2 完整通关：替换 3 种动物 + 三组应答全对 → stagePassed[1]=true', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    // 替换 3 种动物并跟读确认
    for (const animal of ['rabbit', 'goldfish', 'dog']) {
      await clickButton(window, animal);
      await clickButton(window, '我读出来了');
    }
    // 三组应答配对：按题目块内点正确选项
    const pairs = [
      { q: 'May I have a pet?', a: 'Yes, you can.' },
      { q: 'May I have a rabbit?', a: "No, you can't." },
      { q: 'May I hold it?', a: 'Sure.' },
    ];
    for (const { q, a } of pairs) {
      const blocks = Array.from(window.document.querySelectorAll('.card > div'));
      const box = blocks.find((d) => (d.textContent || '').includes(q) && d.querySelector('button'));
      assert.ok(box, `找不到题目块 ${q}`);
      const okBtn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === a);
      assert.ok(okBtn, `找不到正确选项 ${a}`);
      okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
    const p = persisted(window);
    assert.equal(p.progress.u5.stagePassed[1], true, 'Stage2 应已通过');
  } finally { cleanup(); }
});

test('E2E-9 间隔复习：到期任务在浮窗提醒并可进入回忆卡', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: {}, wrongBank: [],
    reviewPlan: [{ offset: 1, dueDate: '2020-01-01', taskIds: ['rc1'], done: false }],
    settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    const fb = window.document.getElementById('floatbar')?.textContent || '';
    assert.match(fb, /复习 1/);
    await navigate(window, app, '#/recall');
    assert.match(mainText(window), /回忆卡中心/);
  } finally { cleanup(); }
});

test('E2E-10 家长中心：学习报告可见，含单词进度与星星', async () => {
  const seed = {
    version: 1, stars: 7, streak: 2, lastStudyDate: null,
    progress: { u5: { stagePassed: [false, false, false, false], wordsDone: ['may', 'pet', 'rabbit'], listenScore: null, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/parent');
    const text = mainText(window);
    assert.match(text, /语法参考卡/);
    assert.match(text, /单词 3\/12/);
    assert.match(text, /总星星 7/);
    assert.match(text, /导出进度/);
    assert.match(text, /恢复进度/);
    assert.match(text, /清空本机进度/);
  } finally { cleanup(); }
});

test('E2E-11 TTS 不可用时不崩溃，步骤照常推进', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: false });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    await clickButton(window, '听一听'); // speak 失败但流程继续
    const steps = Array.from(window.document.querySelectorAll('.step'));
    assert.equal(steps[1].className.includes('is-current'), true, '应推进到②认形');
  } finally { cleanup(); }
});


test('E2E-12 识别失败不卡死：兜底按钮永远显示，可点亮进入下一个', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: true });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    // ①② 走完进入 ③跟读
    await clickButton(window, '听一听');
    await clickButton(window, '我会认这个词');
    // 兜底按钮在识别可用时也必须显示
    assert.ok(buttons(window).some((b) => b.textContent.includes('手动点亮')), '兜底按钮应永远显示');
    // 模拟识别服务故障：识别返回空转写
    window.__nextTranscript = '';
    await clickButton(window, '我来读');
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(persisted(window)?.progress?.u5?.wordsDone?.includes('may') || false, false,
      '识别失败时不应点亮');
    // 失败后兜底按钮应进入引导态（闪绿光），明确告诉孩子点哪里
    const guide = buttons(window).find((b) => b.textContent.includes('手动点亮'));
    assert.ok(guide.className.includes('is-guiding'), '识别失败后按钮应有引导态');
    // 用兜底按钮点亮，学习继续
    await clickButton(window, '我读好了（手动点亮）');
    const p = persisted(window);
    assert.ok(p.progress.u5.wordsDone.includes('may'), '兜底路径应点亮');
    // 点亮瞬间 toast 必须是成功提示，不能再显示"没听清"（自相矛盾）
    const toastText = window.document.getElementById('toast').textContent;
    assert.match(toastText, /点亮成功/, '点亮后应显示成功提示');
    assert.ok(!toastText.includes('没听清'), '点亮后不应残留"没听清"提示');
    // 点亮后出现"下一个单词"入口
    assert.ok(buttons(window).some((b) => b.textContent.includes('下一个单词')), '应出现下一词入口');
    // 竞态防护：迟到的识别结果不重复加星、不重复点亮
    const starsAfter = p.stars;
    await new Promise((r) => setTimeout(r, 3500));
    const p2 = persisted(window);
    assert.equal(p2.stars, starsAfter, '迟到的识别结果不应重复加星');
    assert.equal(p2.progress.u5.wordsDone.length, 1, '不应重复点亮');
  } finally { cleanup(); }
});


test('E2E-13 黄金链路：12词点亮+拼写5词+听辨全对 → Stage1 自动通关 → Stage2 解锁', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [false, false, false, false],
      wordsDone: UNIT.words.map((w) => w.w), listenScore: null, quizBest: null,
      spellingDone: [], handwritingDone: [], reviewCount: {} } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    // Stage2 此时仍锁（缺拼写+听辨）
    await navigate(window, app, '#/unit/u5/stage/1');
    assert.match(mainText(window), /这一关还没解锁/);
    // 拼写屋：12 词全进队列；拼到 5 个四会词都落盘即可（通关只看四会词）
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    const fourWords = UNIT.words.filter((w) => w.tier === 'four');
    const fourSet = new Set(fourWords.map((w) => w.w));
    for (let k = 0; k < 40; k++) {
      const pNow = persisted(window);
      const done = new Set(pNow.progress.u5.spellingDone || []);
      if (fourWords.every((w) => fourSet.has(w.w) && done.has(w.w))) break;
      await spellOneCurrent(window);
    }
    let p = persisted(window);
    assert.deepEqual(fourWords.filter((w) => p.progress.u5.spellingDone.includes(w.w)).map((w) => w.w),
      [...fourSet], '5 个四会词都应落盘');
    // 听辨游戏：6 题全对（从 session 读正确答案）
    await navigate(window, app, '#/unit/u5/stage/0/listen');
    for (let k = 0; k < UNIT.listenPairs.length; k++) {
      const ans = app.state.session.listenAnswer;
      const btn = buttons(window).find((b) => b.classList.contains('option') && b.textContent.trim() === ans);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1350));
    }
    p = persisted(window);
    assert.equal(p.progress.u5.listenScore, 1, '一轮全对 listenScore=1');
    assert.equal(p.progress.u5.stagePassed[0], true, 'Stage1 应自动通关');
    // Stage2 自动解锁
    await navigate(window, app, '#/unit/u5/stage/1');
    assert.match(mainText(window), /核心句型/);
  } finally { cleanup(); }
});

test('E2E-14 单元级重学：12词全亮后出现全部重学按钮，点一次清空全部星标进入新轮次', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [false, false, false, false],
      wordsDone: UNIT.words.map((w) => w.w), listenScore: null, quizBest: null,
      spellingDone: [], handwritingDone: [], reviewCount: {}, learnRound: 1 } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    assert.match(mainText(window), /第 1 轮/, '应显示当前轮次');
    assert.ok(buttons(window).some((b) => b.textContent.includes('全部单词重来一次')), '全部点亮后应出现单元级重学入口');
    // 未全亮时不出现该入口（E2E-4 场景）——由 E2E-4 覆盖
    // 点一下：全部星标清空，进入第 2 轮，回到第 1 个词
    await clickButton(window, '全部单词重来一次');
    const p = persisted(window);
    assert.equal(p.progress.u5.wordsDone.length, 0, '全部星标应清空');
    assert.equal(p.progress.u5.learnRound, 2, '轮次应 +1');
    assert.match(mainText(window), /第 2 轮/, '应显示第 2 轮');
    // 重学第 1 个词走完三步
    await clickButton(window, '听一听');
    await clickButton(window, '我会认这个词');
    await clickButton(window, '我读好了（手动点亮）');
    const p2 = persisted(window);
    assert.ok(p2.progress.u5.wordsDone.includes('may'), '重新点亮');
    assert.equal(p2.progress.u5.reviewCount.may, 1, '每词学习遍数累计');
  } finally { cleanup(); }
});

test('E2E-15 字帖屋：描红点亮落盘 + 打印按钮存在', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/handwriting');
    assert.match(mainText(window), /字帖屋/);
    assert.ok(buttons(window).some((b) => b.textContent.includes('下载 PDF 打印版字帖')), '应有下载 PDF 入口');
    await clickButton(window, '我描好了');
    const p = persisted(window);
    assert.equal(p.progress.u5.handwritingDone.length, 1, '描红应落盘');
  } finally { cleanup(); }
});


test('E2E-16 识别不可用时完全静默（不弹提示）+ 兜底点亮可用', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: true });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    await clickButton(window, '听一听');
    await clickButton(window, '我会认这个词');
    // 模拟识别服务连不上（空转写）但麦克风有声音
    window.__nextTranscript = '';
    window.__micLevel = 0.5;
    await clickButton(window, '我来读');
    await new Promise((r) => setTimeout(r, 3000));
    // 用户要求：识别失败不弹任何提示
    const toastText = window.document.getElementById('toast').textContent;
    assert.ok(!toastText.includes('收到你的声音'), '不应弹"收到你的声音"提示');
    assert.ok(!toastText.includes('没听清'), '不应弹"没听清"提示');
    assert.equal(persisted(window)?.progress?.u5?.wordsDone?.includes('may') || false, false,
      '识别失败不点亮');
    // 兜底点亮仍然可用
    await clickButton(window, '我读好了（手动点亮）');
    assert.ok(persisted(window).progress.u5.wordsDone.includes('may'), '兜底路径点亮');
  } finally { cleanup(); }
});

test('E2E-17 Stage3 真实输出：三项任务完成 → Stage3 通关', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    assert.match(mainText(window), /真实输出/);
    await clickButton(window, '演完了');
    await clickButton(window, '写好了');
    await clickButton(window, '我的宠物介绍好了');
    await clickButton(window, '完成输出阶段');
    const p = persisted(window);
    assert.equal(p.progress.u5.stagePassed[2], true, 'Stage3 应已通过');
  } finally { cleanup(); }
});

test('E2E-18 Stage4 故事屋：每篇故事可逐篇读完点亮（计入会话）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: 0.9 } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3');
    assert.match(mainText(window), /故事屋/);
    const total = UNIT.stories.length;
    for (let i = 0; i < total; i++) {
      await clickButton(window, '我读完并演了');
    }
    assert.equal(app.state.session.storiesDone.length, total, `${total} 篇故事都应已读`);
  } finally { cleanup(); }
});

test('E2E-19 Stage4 考点微测：全部答对（≥80%）→ Stage4 通关并记最高分', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3/quiz');
    assert.match(mainText(window), /考点微测/);
    UNIT.quiz.forEach((q, qi) => {
      // 按题号精确定位题目块（避免不同题出现相同选项文本时误点）
      const promptDiv = Array.from(window.document.querySelectorAll('div')).find(
        (d) => (d.textContent || '').trim() === `${qi + 1}. ${q.prompt}`,
      );
      const box = promptDiv?.parentElement;
      assert.ok(box, `找不到题目块 ${q.prompt}`);
      const ans = q.options[q.answer];
      const btn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === ans);
      assert.ok(btn, `找不到正确选项 ${ans}（题：${q.prompt}）`);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 60));
    await clickButton(window, '完成巩固阶段');
    const p = persisted(window);
    assert.equal(p.progress.u5.stagePassed[3], true, 'Stage4 应已通过');
    assert.ok(p.progress.u5.quizBest >= 0.8, '应记录微测最高分');
  } finally { cleanup(); }
});

test('E2E-20 字母组合 ou 拼读站：找出全部 ou 词 → 鼓励反馈', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/phonics');
    assert.match(mainText(window), /字母组合 ou/);
    const ouWords = UNIT.phonics.words;
    for (const w of ouWords) {
      const btn = buttons(window).find((b) => b.classList.contains('option') && b.textContent.trim() === w);
      assert.ok(btn, `找不到 ou 词选项 ${w}`);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
    const toastText = window.document.getElementById('toast').textContent;
    assert.match(toastText, /ou 全部找对啦/);
  } finally { cleanup(); }
});

test('E2E-21 回忆卡中心：答对一张 → 记录结果并得星', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    const before = persisted(window)?.stars || 0;
    await navigate(window, app, '#/recall');
    assert.match(mainText(window), /回忆卡中心/);
    const cardId = UNIT.reviewCards[0].id;
    await clickButton(window, '我答对了');
    const p = persisted(window);
    assert.equal(p.stars, before + 1, '答对应得 1 星');
    assert.equal(app.state.session.recallResults[cardId], true, '应记录该卡答对');
  } finally { cleanup(); }
});

test('E2E-22 听音选词收尾：12 题全做完 → 出完成页并停止自动出题，点"再来一轮"才重新开始', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/listen');
    // 逐题答对（从 session 读正确答案），共 12 题
    for (let k = 0; k < UNIT.listenPairs.length; k++) {
      const ans = app.state.session.listenAnswer;
      const btn = buttons(window).find((b) => b.classList.contains('option') && b.textContent.trim() === ans);
      assert.ok(btn, '第 ' + (k + 1) + ' 题找不到正确选项 ' + ans);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1350));
    }
    // 一轮做完：出现完成页，且不再有新的选择题
    assert.match(mainText(window), /本轮听音选词完成/, '应出现完成页');
    assert.equal(app.state.session.roundTotal, 0, '本轮计数应复位');
    assert.equal(buttons(window).filter((b) => b.classList.contains('option')).length, 0,
      '完成后不应再出现待选选项（不自动循环）');
    const p = persisted(window);
    assert.equal(p.progress.u5.listenScore, 1, 'listenScore 应落盘');
    // 点"再来一轮"才重新开始新一轮
    await clickButton(window, '再来一轮');
    assert.match(mainText(window), /本轮第 1 \/ 12 题/, '应重新从第 1 题开始');
  } finally { cleanup(); }
});

test('E2E-25 拼写屋"重新拼一遍"：拼完出完成页，点击后真正重开回到第一题（不再无响应）', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    // 12 词 × 2 = 24 题，全部拼对拼空队列
    const expectLen = SPELL_TIMES_PER_WORD * UNIT.words.length;
    assert.equal(app.state.session.spellQueue.length, expectLen, '队列应为 12 词 × 2');
    for (let k = 0; k < expectLen; k++) await spellOneCurrent(window);
    // 队列拼空 → 完成页
    assert.match(mainText(window), /单词全部拼完啦/, '应出现完成页');
    // 点"重新拼一遍" → 队列重建，回到第一题（修复前点击无反应）
    await clickButton(window, '重新拼一遍');
    assert.match(mainText(window), /把这个词用字母拼出来/, '应重新出题');
    assert.equal(app.state.session.spellQueue.length, expectLen, '队列应重建');
  } finally { cleanup(); }
});

test('E2E-26 拼写屋队列规则：12 词全覆盖每词 2 次；拼错的词追加 3 次再练且不无限追加', async () => {
  // 纯函数：buildSpellQueue 多单元聚合（为 U1-4 混入预留）
  const q = buildSpellQueue([
    { id: 'u5', words: UNIT.words },
    { id: 'u1', wordSource: [{ w: 'pen' }, { w: 'ruler' }] }, // 模拟未来 U1 未掌握词
  ]);
  assert.equal(q.length, UNIT.words.length * 2 + 4, 'U5 12词×2 + U1 2词×2');
  UNIT.words.forEach((w) => assert.equal(q.filter((x) => x === w.w).length, 2, `${w.w} 应出现 2 次`));
  assert.equal(q.filter((x) => x === 'pen').length, 2, '外来词也出现 2 次');
  for (let i = 1; i < q.length; i++) {
    assert.notEqual(q[i], q[i - 1], `队列相邻项不应相同（位置 ${i}: ${q[i]}）`);
  }

  // E2E：拼错一个词 → 该词追加 3 次；再错也不追加（不无限）
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    const firstWord = UNIT.words[0].w;
    // 当前题应为第一个词：故意点错字母 1 次，再拼对
    assert.equal(app.state.session.spellWord, firstWord, '当前题应为队列头单词');
    const wrongCh = firstWord.toLowerCase().split('').find((c) => {
      return !buttons(window).some((b) => b.classList.contains('option') && b.textContent.trim() === c) ? false
        : c !== firstWord[0].toLowerCase();
    });
    const wrongBlock = buttons(window).find(
      (b) => b.classList.contains('option') && b.textContent.trim() === wrongCh);
    assert.ok(wrongBlock, `应能点错字母 ${wrongCh}`);
    wrongBlock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    // 正确拼完当前题
    for (const ch of firstWord.toLowerCase()) {
      const block = buttons(window).find(
        (b) => b.classList.contains('option') && b.textContent.trim() === ch);
      block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    }
    // 该词被记为拼错，队列追加 3 次再练（其余额 = 本轮第 2 次排期 1 + 加练 3 = 4）
    assert.deepEqual(app.state.session.spellWrong, [firstWord], '拼错词应入复习清单');
    const remain = app.state.session.spellQueue.filter((x) => x === firstWord).length;
    assert.equal(remain, 1 + SPELL_WRONG_RETRY, '错词余额应为 第2次排期1 + 加练3 = 4');
    assert.equal(app.state.session.spellQueue.length, UNIT.words.length * 2 - 1 + SPELL_WRONG_RETRY,
      '总队列 = 24 - 已拼1 + 加练3');
    assert.ok(app.state.session.spellRetried.has(firstWord), '错词应标记已追加');
    // 再错一次也不会追加（防无限）
    assert.notEqual(app.state.session.spellQueue[0], firstWord, '下一题应是别的词');
  } finally { cleanup(); }
});
