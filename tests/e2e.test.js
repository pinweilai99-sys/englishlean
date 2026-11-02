// E2E：浏览器级验收（对应 PRD §9 的可测验收点）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshApp, buttons, clickButton, navigate, mainText, persisted, UNIT,
} from './e2e-helper.mjs';

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
    // 拼写屋：逐词拼出 5 个四会词
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    const fourWords = UNIT.words.filter((w) => w.tier === 'four');
    for (const w of fourWords) {
      // 每个字母块按目标词顺序点击（重复字母点任意一个匹配块）
      for (const ch of w.w.toLowerCase()) {
        const block = buttons(window).find(
          (b) => b.classList.contains('option') && b.textContent.trim() === ch);
        assert.ok(block, `找不到字母块 ${ch}（拼 ${w.w}）`);
        block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    let p = persisted(window);
    assert.deepEqual([...p.progress.u5.spellingDone].sort(), fourWords.map((w) => w.w).sort(),
      '5 个四会词都应落盘');
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
    assert.ok(buttons(window).some((b) => b.textContent.includes('全部重学一遍')), '全部点亮后应出现单元级重学入口');
    // 未全亮时不出现该入口（E2E-4 场景）——由 E2E-4 覆盖
    // 点一下：全部星标清空，进入第 2 轮，回到第 1 个词
    await clickButton(window, '全部重学一遍');
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
    assert.ok(buttons(window).some((b) => b.textContent.includes('打印四线三格字帖')), '应有打印入口');
    await clickButton(window, '我描好了');
    const p = persisted(window);
    assert.equal(p.progress.u5.handwritingDone.length, 1, '描红应落盘');
  } finally { cleanup(); }
});


test('E2E-16 识别不可用时按音量诚实反馈：有声音→"收到你的声音"，静音→"没听到声音"', async () => {
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
    const toastText = window.document.getElementById('toast').textContent;
    assert.match(toastText, /收到你的声音啦/, '有声音时应明确确认收到');
    assert.match(toastText, /秒/, '应告知读了多久');
    assert.equal(persisted(window)?.progress?.u5?.wordsDone?.includes('may') || false, false,
      '识别失败不点亮');
    // 静音场景：提示"没听到声音"
    window.__micLevel = 0;
    await clickButton(window, '我来读');
    await new Promise((r) => setTimeout(r, 3000));
    assert.match(window.document.getElementById('toast').textContent, /没听到声音/, '静音时应提示没听到声音');
    // 兜底点亮仍然可用
    await clickButton(window, '我读好了（手动点亮）');
    assert.ok(persisted(window).progress.u5.wordsDone.includes('may'), '兜底路径点亮');
  } finally { cleanup(); }
});
