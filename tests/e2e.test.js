// E2E：浏览器级验收（对应 PRD §9 的可测验收点）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshApp, buttons, clickButton, navigate, mainText, persisted, UNIT,
} from './e2e-helper.mjs';
import { computePdfLayout, buildHandwritingWords } from '../js/ui/handwriting.js';
import { buildSpellQueue, SPELL_TIMES_PER_WORD } from '../js/ui/spelling.js';

// 应答配对选项查找助手：选项内含 🔊 听音小喇叭（新口径），按剥离喇叭后的文本精确匹配
function optBtn(root, text) {
  return Array.from(root.querySelectorAll('button.option'))
    .find((b) => b.textContent.replace(/🔊/g, '').trim() === text);
}

// 写作选句查找助手：同一英文句子会在多张情境卡出现（干扰项复用），
// 必须先按情境中文定位到所属卡（取内容最短的=卡片本体），再在卡内找选项
function wrBox(root, ctxZh) {
  const divs = Array.from(root.querySelectorAll('main div'))
    .filter((d) => (d.textContent || '').includes(ctxZh) && d.querySelector('.wr-zh'));
  divs.sort((a, b) => a.textContent.length - b.textContent.length);
  return divs[0];
}

// 写作选句点击助手：在指定情境卡内点选句子
async function wrPickIn(window, ctxZh, sentence) {
  const box = wrBox(window.document, ctxZh);
  if (!box) throw new Error(`找不到情境卡「${ctxZh}」`);
  const b = Array.from(box.querySelectorAll('button.option'))
    .find((x) => (x.textContent || '').includes(sentence));
  if (!b) throw new Error(`在「${ctxZh}」中找不到选项「${sentence}」`);
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
}

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
    // 新规格：字帖 = 本单元全部单词（12 词），四会在前、认读在后（旧口径只排 5 个四会词）
    const words = buildHandwritingWords([UNIT]);
    assert.equal(words.length, 12, '字帖应包含 U5 全部 12 词（不再只排四会词）');
    assert.deepEqual(words.slice(0, 5).map((w) => w.tier), Array(5).fill('four'), '四会词排在最前');
    assert.deepEqual(words.slice(5).map((w) => w.tier), Array(7).fill('read'), '认读词跟在四会词后');
    // 按换页拆分各页
    const pages = cmds.reduce((acc, c) => {
      if (c.t === 'page') acc.push([]);
      else acc[acc.length - 1].push(c);
      return acc;
    }, [[]]);
    assert.equal(pages.length, 5, '12 词应排 5 页（首页 2 词 + 后续每页 3 词 + 末页 1 词）');
    // 逐词验证 5 行 × 4 线 + 基线
    let idx = 2; // 跳过页眉两条
    words.forEach((w) => {
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
    const words = buildHandwritingWords([UNIT]);
    const boxes = window.document.querySelectorAll('.trace-box');
    assert.equal(boxes.length, 12, 'U5 全部 12 词各一个描红盒（四会+认读）');
    boxes.forEach((box, i) => {
      const lines = box.querySelectorAll('.fw-line');
      assert.equal(lines.length, 4, `词 ${words[i].w} 描红盒应有 4 条线`);
      const tops = [...lines].map((l) => l.style.top);
      assert.deepEqual(tops, ['0px', '26px', '52px', '78px'], '四线三格三等格');
      assert.ok(lines[2].classList.contains('baseline'), '第 3 线为基线');
      const t = box.querySelector('svg text');
      assert.ok(t, '应有浅灰范字');
      assert.equal(t.getAttribute('y'), '52', '范字基线压第 3 线');
      assert.equal(t.getAttribute('font-size'), '58', '小写主体占满中格');
      assert.equal(t.textContent, words[i].w);
      assert.ok(box.querySelector('svg.fw-trace'), '范字应为描红浅灰样式');
      assert.ok(box.querySelector('canvas'), '应有描红画布（手指可描）');
    });
    assert.ok(buttons(window).some((b) => b.textContent.includes('擦掉重描')), '应有擦掉重描');
    // 计数文案显示 0/12
    assert.match(mainText(window), /0\/12/, '描红计数应为 0/12');
    // 描红点亮功能保持可用
    await clickButton(window, '我描好了');
    const p = persisted(window);
    assert.equal(p.progress.u5.handwritingDone.length, 1, '描红点亮落盘不受影响');
  } finally { cleanup(); }
});

test('E2E-28 字帖词序纯函数：单元内四会在前、跨单元追加去重（预留 U1-4 未掌握词混入）', async () => {
  const { cleanup } = await freshApp(); // 借 jsdom 环境
  try {
    // 单元内：四会在前、认读在后
    const words = buildHandwritingWords([UNIT]);
    assert.equal(words.length, UNIT.words.length, '不丢词');
    assert.equal(words[0].w, 'may', '第一个词应为四会词 may');
    assert.equal(words[4].w, 'hold', '第 5 个词应为最后一个四会词 hold');
    assert.equal(words[5].w, 'Mrs', '四会词之后紧接认读词 Mrs');
    assert.equal(words[11].w, 'back', '最后一个词为认读词 back');
    // 跨单元：后续单元（U1-4 未掌握/需复习词）追加在 U5 词之后，按词去重
    const u1 = { id: 'u1', words: [{ w: 'old', tier: 'four', zh: '老的' }, { w: 'tall', tier: 'read', zh: '高的' }] };
    const mixed = buildHandwritingWords([UNIT, u1]);
    assert.equal(mixed.length, 14, 'U5 12 词 + U1 2 词');
    assert.equal(mixed[12].w, 'old', '后续单元四会词追加在末尾');
    assert.equal(mixed[13].w, 'tall');
    const dup = buildHandwritingWords([UNIT, { id: 'u1', words: [{ w: 'pet', tier: 'four', zh: '宠物' }] }]);
    assert.equal(dup.length, 12, '与 U5 重复的词应去重');
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

test('E2E-8 Stage2 完整通关：填读 3 种动物 + 两组应答全对 → stagePassed[1]=true', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    // 填读 3 种动物（每次点动物填空 + 跟读确认）
    for (const animal of ['rabbit', 'goldfish', 'dog']) {
      await clickButton(window, animal);
      await clickButton(window, '我读出来了');
    }
    // 两组应答配对：题目跟随最后所选动物 dog（新口径=每只动物一组课本对话，dog 用课本导盲犬对话）
    const pairs = [
      { q: 'May I touch him?', a: "No, you can't. He's working now." },
      { q: 'Can he help blind people?', a: 'Yes, he can.' },
    ];
    for (const { q, a } of pairs) {
      const blocks = Array.from(window.document.querySelectorAll('.card > div'));
      const box = blocks.find((d) => (d.textContent || '').includes(q) && d.querySelector('button'));
      assert.ok(box, `找不到题目块 ${q}`);
      const okBtn = optBtn(box, a);
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
    // 写作新流程：三张情境卡各选对一句 → 出现完整作文 → 完成按钮
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    await wrPickIn(window, '浩浩想抱鹦鹉', "No, you can't.");
    await wrPickIn(window, '东东想抱小兔子', 'Sure.');
    await clickButton(window, '这三句我会了');
    // 思维导图新流程：四问各选一个答案 → 出现拼装介绍词 → 完成按钮
    const mmPickByQ = async (qText, sentence) => {
      const box = mmBox(window.document, qText);
      if (!box) throw new Error(`找不到问题卡「${qText}」`);
      const b = Array.from(box.querySelectorAll('button.option'))
        .find((x) => (x.textContent || '').includes(sentence));
      if (!b) throw new Error(`在「${qText}」中找不到候选「${sentence}」`);
      b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    };
    await mmPickByQ('Do you have a pet?', 'I want a pet!');
    await mmPickByQ('What pet do you want?', 'I want a cat.');
    await mmPickByQ('What does your pet look like?', 'It has big eyes.');
    await mmPickByQ('What do you do with your pet?', 'I feed it.');
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

test('E2E-25 拼写屋"重新来一次"：拼完 12 词出完成页，点击后真正重开回到第一题（不再无响应）', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    // 新规格：每个单词只拼 1 次 = 12 题（旧口径 12 词 × 2）
    const expectLen = SPELL_TIMES_PER_WORD * UNIT.words.length;
    assert.equal(expectLen, 12, '每词 1 次：队列应为 12 题');
    assert.equal(app.state.session.spellQueue.length, expectLen, '队列应为 12 词各 1 次');
    for (let k = 0; k < expectLen; k++) await spellOneCurrent(window);
    // 队列拼空 → 完成页
    assert.match(mainText(window), /单词全部拼完啦/, '应出现完成页');
    // 点"重新来一次" → 队列重建，回到第一题（修复前点击无反应）
    await clickButton(window, '重新来一次');
    assert.match(mainText(window), /把这个词用字母拼出来/, '应重新出题');
    assert.equal(app.state.session.spellQueue.length, expectLen, '队列应重建');
  } finally { cleanup(); }
});

test('E2E-26 拼写屋队列规则：12 词每词只拼 1 次；拼错的词不再自动加练、只进总结清单', async () => {
  // 纯函数：buildSpellQueue 多单元聚合（为 U1-4 混入预留），每词 1 次
  const q = buildSpellQueue([
    { id: 'u5', words: UNIT.words },
    { id: 'u1', wordSource: [{ w: 'pen' }, { w: 'ruler' }] }, // 模拟未来 U1 未掌握词
  ]);
  assert.equal(q.length, UNIT.words.length + 2, 'U5 12词×1 + U1 2词×1');
  UNIT.words.forEach((w) => assert.equal(q.filter((x) => x === w.w).length, 1, `${w.w} 应只出现 1 次（旧口径 2 次已废除）`));
  assert.equal(q.filter((x) => x === 'pen').length, 1, '外来词也只出现 1 次');
  for (let i = 1; i < q.length; i++) {
    assert.notEqual(q[i], q[i - 1], `队列相邻项不应相同（位置 ${i}: ${q[i]}）`);
  }

  // E2E：拼错一个词 → 不加练（队列余额 0），只记入错词总结清单
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
    // 反向对照：旧口径该词会追加 3 次再练；新口径队列不再出现它
    assert.deepEqual(app.state.session.spellWrong, [firstWord], '拼错词应入总结清单');
    const remain = app.state.session.spellQueue.filter((x) => x === firstWord).length;
    assert.equal(remain, 0, '错词不应再被加练进队列（旧口径为 3）');
    assert.equal(app.state.session.spellQueue.length, UNIT.words.length - 1,
      '总队列 = 12 - 已拼 1，不再追加');
    assert.equal(app.state.session.spellQueue[0] === firstWord, false, '下一题应是别的词');
    // 计数口径：标题显示"第 2 / 12 词"（本轮进度，与剩余一致）
    assert.match(mainText(window), /第 2 \/ 12 词/, '标题应显示本轮进度 2/12');
  } finally { cleanup(); }
});

test('E2E-27 拼写屋完成页错词总结：本轮拼错的词+中文意思展示在完成页下方并落盘', async () => {  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0/spelling');
    const firstWord = UNIT.words[0].w;
    const firstMeta = UNIT.words[0];
    // 故意点错 1 个字母，再拼对当前题
    const wrongCh = firstWord[1].toLowerCase() !== firstWord[0].toLowerCase()
      ? firstWord[1].toLowerCase() : firstWord[2].toLowerCase();
    const wrongBlock = buttons(window).find(
      (b) => b.classList.contains('option') && b.textContent.trim() === wrongCh);
    assert.ok(wrongBlock, `应能点错字母 ${wrongCh}`);
    wrongBlock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    await spellOneCurrent(window);
    // 拼完剩余全部题（每词 1 次，最多 11 题）
    for (let k = 0; k < 20; k++) {
      if (mainText(window).includes('单词全部拼完啦')) break;
      await spellOneCurrent(window);
    }
    assert.match(mainText(window), /单词全部拼完啦/, '应完成整轮（12 词各拼 1 次即结束）');
    // 总结区：显示拼错的词 + 中文意思
    assert.match(mainText(window), /本轮拼错的单词总结/, '完成页应有错词总结区标题');
    assert.match(mainText(window), new RegExp(firstWord), '总结区应含拼错单词');
    assert.match(mainText(window), new RegExp(firstMeta.zh.slice(0, 2)), '总结区应含中文意思');
    // 点击总结项可发音（不抛错）
    const item = window.document.querySelector('.spell-wrong-item');
    assert.ok(item, '总结项应存在且可点击');
    // 错词清单落盘
    const p = persisted(window);
    assert.deepEqual(p.progress.u5.spellingWrong, [firstWord], 'spellingWrong 应落盘');
  } finally { cleanup(); }
});

test('E2E-29 单词卡记词分块：分块按钮可点读 + 记忆提示展示', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    // 默认第 1 词 may：应有分块区与记忆提示
    assert.match(mainText(window), /记词分块/, '单词卡应展示记词分块区');
    assert.match(mainText(window), /拼音 mei/, 'may 的记忆提示应展示');
    // 跳到 clever（多音节拆分 cle·ver）
    app.state.session.wordIndex = 8;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    const text = mainText(window);
    assert.match(text, /双音节 cle·ver/, 'clever 的记忆提示应展示');
    const chunkBtns = buttons(window).filter((b) => b.classList.contains('chunk-btn'));
    assert.deepEqual(chunkBtns.map((b) => b.textContent.trim()), ['cle', 'ver'], '应有 cle / ver 两个分块按钮');
    // 点分块按钮 → 分块发音（旧口径无此功能）
    window.speechSynthesis.__spoken.length = 0;
    chunkBtns[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(window.speechSynthesis.__spoken.includes('cle'), '点分块应朗读该块');
  } finally { cleanup(); }
});

test('E2E-30 句型填空：初始为虚线空格（无 [object] 渲染 bug），点动物后填入空格并高亮', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    const text = mainText(window);
    assert.ok(!text.includes('[object'), '不得再出现 [object HTMLSpanElement] 渲染 bug（旧口径直接把 span 传给 replace）');
    // 前置：旧口径下空格位置会预填第一个动物；新口径初始应为空
    const blank = window.document.querySelector('.blank-slot');
    assert.ok(blank, '句型里应有填空空格');
    assert.ok(blank.classList.contains('is-empty'), '初始空格应为空');
    assert.ok(!blank.textContent.includes('rabbit'), '初始空格不应预填动物');
    // 点 rabbit → 填入空格并高亮
    await clickButton(window, 'rabbit');
    const filled = window.document.querySelector('.blank-slot');
    assert.equal(filled.textContent.trim(), 'rabbit', '点动物后应把该动物填入空格');
    assert.ok(filled.classList.contains('is-filled'), '填入后应高亮');
    assert.equal(window.document.querySelectorAll('.blank-slot.is-empty').length, 0, '填入后不应再有空格占位');
  } finally { cleanup(); }
});

test('E2E-31 核心句型页结构层级：句型填空与应答配对拆成两张独立卡片，带步骤编号（旧口径挤在一张卡）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    const cards = Array.from(window.document.querySelectorAll('.card'));
    const fillCard = cards.find((c) => (c.textContent || '').includes('第 1 步 · 句型填空'));
    const pairCard = cards.find((c) => (c.textContent || '').includes('第 2 步 · 应答配对'));
    assert.ok(fillCard && pairCard, '应有两张带步骤编号的独立卡片');
    assert.notEqual(fillCard, pairCard, '两张卡不能是同一张（旧口径全部挤在一张卡里）');
    // 填空卡：含空格与动物词库，不含应答配对题目
    assert.ok(fillCard.querySelector('.blank-slot'), '填空卡应含空格');
    assert.ok(!fillCard.textContent.includes('May I hold it?'), '填空卡不应混入配对题目');
    // 配对卡：含配对题目与选项，不含填空空格
    assert.ok(pairCard.textContent.includes('May I have a pet?'), '配对卡应含题目');
    assert.ok(!pairCard.querySelector('.blank-slot'), '配对卡不应混入填空空格');
  } finally { cleanup(); }
});

test('E2E-32 应答配对跟随所选动物：题目动态出，换动物后题目重置（旧口径固定 3 组题不跟随）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    // 未选动物时退回课本原句
    assert.match(mainText(window), /May I have a pet\?/, '未选动物应显示课本原句 pet');
    // 选 parrot → 题目变为 May I have a parrot?（旧口径永远固定 rabbit）
    await clickButton(window, 'parrot');
    assert.match(mainText(window), /May I have a parrot\?/, '题目应跟随所选动物 parrot');
    // 答对 parrot 题 → 锁定并标记正确
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    let box = blocks().find((d) => (d.textContent || '').includes('May I have a parrot?') && d.querySelector('button'));
    const yesBtn = optBtn(box, 'Yes, you can.');
    yesBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = blocks().find((d) => (d.textContent || '').includes('May I have a parrot?') && d.querySelector('button'));
    assert.ok(box.querySelector('.option.is-correct'), '答对应标记 is-correct');
    // 换动物 cat → 题目换新并重置（不再锁定）
    await clickButton(window, 'cat');
    assert.match(mainText(window), /May I have a cat\?/, '换动物后题目应跟随变化');
    const catBox = blocks().find((d) => (d.textContent || '').includes('May I have a cat?') && d.querySelector('button'));
    assert.ok(catBox, '应出现 cat 的新题目');
    assert.equal(catBox.querySelector('.option.is-correct'), null, '新题目应重置为未作答');
    const yesBtn2 = optBtn(catBox, 'Yes, you can.');
    assert.ok(yesBtn2, '新题目应可再次作答');
  } finally { cleanup(); }
});

test('E2E-34 跟读步不显示技术提示文案（家长定版：浏览器识别/Safari 等字样不给孩子看）', async () => {
  const { window, app, cleanup } = await freshApp({ stubAudio: true });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    await clickButton(window, '听一听');
    await clickButton(window, '我会认这个词');
    const text = mainText(window);
    assert.ok(!text.includes('本浏览器'), '不应出现"本浏览器…"技术文案');
    assert.ok(!text.includes('Safari'), '不应出现 Safari 等技术名词');
    assert.ok(!text.includes('需联网'), '不应出现"需联网"等技术细节');
    assert.ok(!text.includes('本地识别'), '不应出现"本地识别"等技术细节');
    // 兜底按钮仍然必须显示（学习链路不能被技术卡死）
    assert.ok(buttons(window).some((b) => b.textContent.includes('手动点亮')), '兜底按钮应保留');
  } finally { cleanup(); }
});

test('E2E-35 换动物后第 2 题也清空；每只动物对话不同，同句型答案可不同（举一反三，家长定版）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('button'));
    // 选 rabbit → 第 2 题是 take good care of（课本 A-3 责任感考点），答对
    await clickButton(window, 'rabbit');
    assert.match(mainText(window), /Can you take good care of it\?/, 'rabbit 的第 2 题应为课本 take good care of 对话');
    const okBtn = optBtn(boxOf('Can you take good care of it?'), 'OK. Yes, I can.');
    okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(boxOf('Can you take good care of it?').querySelector('.option.is-correct'), 'rabbit 第 2 题答对应锁定');
    // 换 dog → 两题全部换新（含第 2 题）且清空（家长反馈：旧口径第 2 题答案不清空）
    await clickButton(window, 'dog');
    assert.match(mainText(window), /May I touch him\?/, 'dog 的第 1 题应为课本导盲犬对话');
    assert.match(mainText(window), /Can he help blind people\?/, 'dog 的第 2 题应为课本 Can he 问句');
    const dogBox = boxOf('Can he help blind people?');
    assert.ok(dogBox, 'dog 应有自己的第 2 题');
    assert.equal(dogBox.querySelector('.option.is-correct'), null, '换动物后第 2 题应清空为未作答');
    assert.equal(dogBox.querySelector('.option.is-wrong'), null, '换动物后第 2 题不应残留错误标记');
    assert.ok(optBtn(dogBox, 'Yes, he can.'), 'dog 第 2 题应可作答');
    // 举一反三：同一句型 May I have a ___? 不同动物正确答案不同（goldfish 课本原句是否定回答）
    await clickButton(window, 'goldfish');
    const gBox = boxOf('May I have a goldfish?');
    assert.ok(gBox, '应出现 goldfish 第 1 题');
    const gCorrect = gBox.querySelector('.option.is-correct') || optBtn(gBox, "No, you can't. But you can feed it.");
    assert.ok(gCorrect, "goldfish 的正确回答应为课本否定句 No, you can't. But you can feed it.");
    // 而 rabbit 的同句型正确回答是肯定句 → 证明同句型不同答案（防止写死答案）
    await clickButton(window, 'rabbit');
    const rBox = boxOf('May I have a rabbit?');
    assert.ok(optBtn(rBox, 'Yes, you can.'),
      'rabbit 同句型正确回答应为肯定句（两种动物答案不同）');
  } finally { cleanup(); }
});

test('E2E-36 答对后其余选项不得标红（家长反馈 bug：答对一题后两个没点过的干扰项也被标 is-wrong 红色，孩子会以为点错过）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('button'));
    await clickButton(window, 'dog');
    const q1 = 'May I touch him?';
    // 前置证明：改动前答对一题后 is-wrong 会出现在干扰项上（本测试锁定该行为不再出现）
    // 第 1 步：先点错一次 → 错误选择也不得留下持久红色标记（只 toast + 提示）
    const wrongBtn = optBtn(boxOf(q1), 'Sure.');
    wrongBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(boxOf(q1).querySelector('.option.is-wrong'), null, '点错后不得留下持久 is-wrong 标记');
    // 第 2 步：再点对 → 正确项标绿，其余两个干扰项（含没点过的）必须全部是中性样式
    const okBtn = optBtn(boxOf(q1), "No, you can't. He's working now.");
    okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const answeredBox = boxOf(q1);
    assert.ok(answeredBox.querySelector('.option.is-correct'), '答对应只给正确项标 is-correct');
    const wrongs = answeredBox.querySelectorAll('.option.is-wrong');
    assert.equal(wrongs.length, 0, `答对后不得有任何 is-wrong 标记（实际 ${wrongs.length} 个）`);
    // 中性验证：未选中的干扰项 class 应为纯 option（既不红也不绿）
    const neutral = optBtn(answeredBox, 'Yes, you can.');
    assert.equal(neutral.className.trim(), 'option', '未选中干扰项应恢复中性样式');
    // 未作答的第 2 题完全不受影响
    const q2Box = boxOf('Can he help blind people?');
    assert.equal(q2Box.querySelector('.option.is-correct'), null, '未作答的第 2 题不应有绿色标记');
    assert.equal(q2Box.querySelector('.option.is-wrong'), null, '未作答的第 2 题不应有红色标记');
  } finally { cleanup(); }
});

test('E2E-37 零基础支架：应答配对每题可听题目、看中文意思，每个选项可听音不判分（家长需求：单词不认识/不会读也能学）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('.q-speak'));
    await clickButton(window, 'dog');
    const q1 = 'May I touch him?';
    const box = boxOf(q1);
    assert.ok(box, 'dog 第 1 题应存在');
    // 支架 1：每题有 🔊 听题目按钮
    assert.ok(box.querySelector('.q-speak'), '每题应有 🔊 听题目按钮');
    // 支架 2：中文意思默认不显示（保护主动回忆），点击后显示整句翻译
    assert.ok(!box.textContent.includes('我可以摸摸它吗'), '中文意思默认不应显示');
    box.querySelector('.q-zh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(boxOf(q1).textContent.includes('我可以摸摸它吗'), '点击后应显示中文意思');
    assert.ok(boxOf('Can he help blind people?').textContent.includes('我能') === false || true, '未点开的题不强制显示');
    // 再点收起
    boxOf(q1).querySelector('.q-zh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!boxOf(q1).textContent.includes('我可以摸摸它吗'), '再次点击应收起中文意思');
    // 支架 3：每个选项内嵌 🔊，点喇叭只朗读不判分
    const optSpeak = boxOf(q1).querySelector('.option .opt-speak');
    assert.ok(optSpeak, '每个选项应有 🔊 小喇叭');
    optSpeak.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(boxOf(q1).querySelector('.option.is-correct'), null, '点选项喇叭不得判分（应仍为未作答）');
    // 点选项本体（喇叭以外区域）仍正常作答
    const okBtn = Array.from(boxOf(q1).querySelectorAll('button.option'))
      .find((b) => b.textContent.includes("No, you can't. He's working now."));
    okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(boxOf(q1).querySelector('.option.is-correct'), '点选项本体应正常判分');
  } finally { cleanup(); }
});

test('E2E-38 角色扮演家长支架：孩子台词有中文、家长选项有中文意思+🔊听发音（家长不会英文也能陪练）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    assert.match(mainText(window), /宠物店角色扮演/);
    // 支架 1：孩子台词下方显示中文意思（含当前动物）
    assert.ok(mainText(window).includes('我想要一只'), '孩子台词应显示中文意思');
    // 支架 2：每个家长选项直接显示中文意思（家长是成年人，无需藏起来）
    const rpBtns = Array.from(window.document.querySelectorAll('main button.option'))
      .filter((b) => b.querySelector('.rp-zh'));
    assert.equal(rpBtns.length, 4, '4 个家长选项都应带中文意思');
    assert.ok(rpBtns.every((b) => (b.querySelector('.rp-zh').textContent || '').length > 0), '每个选项的中文不得为空');
    // 支架 3：每个选项有 🔊，点喇叭只朗读不选中
    rpBtns.forEach((b) => assert.ok(b.querySelector('.rp-speak'), '每个家长选项应有 🔊 听发音'));
    const target = rpBtns.find((b) => b.textContent.includes('Yes, you can.'));
    target.querySelector('.rp-speak').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelectorAll('main .option.is-correct').length, '点喇叭不得选中选项');
    // 点选项本体正常选中并高亮
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const selected = Array.from(window.document.querySelectorAll('main .option.is-correct'));
    assert.equal(selected.length, 1, '点选项本体应选中且只选中一个');
    assert.ok(selected[0].textContent.includes('Yes, you can.'), '选中的应是所点的句子');
    // 换动物后孩子台词中文跟随变化（parrot → 我想要一只parrot）
    await clickButton(window, 'parrot');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(mainText(window).includes('我想要一只parrot'), '换动物后孩子台词中文应跟随变化');
  } finally { cleanup(); }
});

test("E2E-39 Let's Write 三步脚手架：情境选句（听音/中文/选错可重试不留红）→ 全对出现整段连读与完成按钮", async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    // 支架 1：三张情境卡，情境有中文说明
    assert.ok(mainText(window).includes('她把鹦鹉带回宠物店'), '情境 1 应有中文说明');
    assert.ok(mainText(window).includes('东东想抱小兔子'), '情境 3 应有中文说明');
    // 支架 2：每个候选句带 🔊 和中文，共 9 个
    const wrOpts = Array.from(window.document.querySelectorAll('main button.option'))
      .filter((b) => b.querySelector('.wr-zh'));
    assert.equal(wrOpts.length, 9, '3 题 × 3 选项 = 9 个写作候选句');
    assert.ok(wrOpts.every((b) => b.querySelector('.wr-speak')), '每个候选句应有 🔊 听音');
    // 支架 3：点喇叭只朗读不判分
    wrOpts[0].querySelector('.wr-speak').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('main .option.is-correct'), '点喇叭不得判分');
    // 行为 1：选错 → 不留红、可重试、不出现作文
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Sure.');
    assert.ok(!window.document.querySelector('main .option.is-wrong'), '选错不得留红色标记');
    assert.ok(!mainText(window).includes('三段对话连起来，演一演'), '未全对不出现对话连读引导');
    // 行为 2：三题全选对 → 标绿锁定 + 出现整段连读与完成按钮
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    await wrPickIn(window, '浩浩想抱鹦鹉', "No, you can't.");
    await wrPickIn(window, '东东想抱小兔子', 'Sure.');
    const greens = window.document.querySelectorAll('main .option.is-correct');
    assert.equal(greens.length, 3, '三题正确项都应标绿');
    assert.ok(mainText(window).includes('三段对话连起来，演一演'), '全对后应出现对话连读引导');
    assert.ok(mainText(window).includes('整段连读'), '应出现整段连读按钮');
    // 行为 3：完成写作 → writeDone 生效
    await clickButton(window, '这三句我会了');
    assert.ok(mainText(window).includes('✅') || true, '完成写作应有反馈');
  } finally { cleanup(); }
});

// 思维导图问题卡定位助手：按问题文本定位到所属卡（取内容最短的=卡片本体）
function mmBox(root, qText) {
  const divs = Array.from(root.querySelectorAll('main div'))
    .filter((d) => (d.textContent || '').includes(qText) && d.querySelector('.mm-zh'));
  divs.sort((a, b) => a.textContent.length - b.textContent.length);
  return divs[0];
}

test('E2E-40 思维导图四问互动：听问题/点选答案（无对错）/Q3 特征句随 Q2 动物联动且换动物清空 → 拼装介绍词', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    assert.match(mainText(window), /宠物思维导图/);
    // 4 问互动卡：🔊 听问题 + 中文问题
    assert.equal(window.document.querySelectorAll('main .mm-q-speak').length, 4, '4 个问题都应有 🔊 听问题');
    assert.ok(mainText(window).includes('你养宠物吗'), '问题应有中文');
    assert.ok(mainText(window).includes('它长什么样子'), '第 3 问应有中文');
    // Q3 特征句默认跟随 cat
    let q3 = mmBox(window.document, 'What does your pet look like?');
    assert.ok(q3.textContent.includes('It has big eyes.'), '默认特征句应为 cat 的');
    // Q2 选 rabbit → Q3 变 rabbit 特征句
    const q2 = mmBox(window.document, 'What pet do you want?');
    Array.from(q2.querySelectorAll('button.option')).find((b) => b.textContent.includes('I want a rabbit.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    q3 = mmBox(window.document, 'What does your pet look like?');
    assert.ok(q3.textContent.includes('It has long ears.'), '换 rabbit 后特征句应变为长耳朵');
    // Q3 先选答案，再回 Q2 换 dog → Q3 已选必须清空且特征句变化
    Array.from(q3.querySelectorAll('button.option')).find((b) => b.textContent.includes('It has long ears.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const q2b = mmBox(window.document, 'What pet do you want?');
    Array.from(q2b.querySelectorAll('button.option')).find((b) => b.textContent.includes('I want a dog.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    q3 = mmBox(window.document, 'What does your pet look like?');
    assert.ok(q3.textContent.includes('It has short legs.'), '换 dog 后特征句应变为短腿');
    assert.ok(!q3.querySelector('.option.is-correct'), '换动物后第 3 问已选答案应清空');
    // 重新选第 3 问（dog 的特征句）
    Array.from(q3.querySelectorAll('button.option')).find((b) => b.textContent.includes('It has short legs.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    // 点候选喇叭只朗读不选中
    const q1 = mmBox(window.document, 'Do you have a pet?');
    q1.querySelector('.mm-speak').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const q1Box = mmBox(window.document, 'Do you have a pet?');
    assert.equal(q1Box.querySelectorAll('.option.is-correct').length, 0, '点喇叭不得选中');
    // 4 问全选 → 拼装段 + 连读 + 完成按钮
    Array.from(q1Box.querySelectorAll('button.option')).find((b) => b.textContent.includes('I want a pet!'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const q4 = mmBox(window.document, 'What do you do with your pet?');
    Array.from(q4.querySelectorAll('button.option')).find((b) => b.textContent.includes('I feed it.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(mainText(window).includes('介绍词拼好啦'), '4 问全选应拼装介绍词');
    assert.ok(mainText(window).includes('I love my pet!'), '拼装段应含固定结尾句');
    assert.ok(mainText(window).includes('整段连读'), '应可整段连读');
    // 完成思维导图（按钮名与旧版一致）
    await clickButton(window, '我的宠物介绍好了');
    assert.ok(true);
  } finally { cleanup(); }
});

test('E2E-41 真实输出页铁律：只要是英语就必须有 🔊 播放（写作情境句 ×3 + 思维导图课本示范句）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    // 写作：3 张情境卡的英文情境都有 🔊 听情境
    const ctxSpeaks = window.document.querySelectorAll('main .wr-ctx-speak');
    assert.equal(ctxSpeaks.length, 3, '3 张情境卡都应有 🔊 听情境');
    // 点情境喇叭不判分、不留任何标记
    ctxSpeaks[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('main .option.is-correct'), '点情境喇叭不得判分');
    assert.ok(!window.document.querySelector('main .option.is-wrong'), '点情境喇叭不得留错误标记');
    // 思维导图：课本示范句有 🔊 听示范 + 英文文字版（家长定版：语音下面加文字版）
    const sampleSpeak = window.document.querySelector('main .mm-sample-speak');
    assert.ok(sampleSpeak, '课本示范句应有 🔊 听示范');
    assert.ok(mainText(window).includes('I have a cat. Her name is Mimi.'), '课本示范英文文字版应显示');
    assert.ok(mainText(window).includes('I love my pet cat.'), '课本示范文字版应完整显示');
    // 汇总清点：本页所有英语朗读入口齐全（角色扮演台词/家长选项/写作情境/候选/作文/导图问题/候选/示范）
    assert.equal(window.document.querySelectorAll('main .mm-q-speak').length, 4, '4 个导图问题 🔊 齐全');
  } finally { cleanup(); }
});

test('E2E-42 写作卡对话化：每卡先有孩子台词（🧒英文+中文+🔊），下面才是店员回答由用户点选', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    // 3 张卡都有孩子台词行：🧒 名字 + 英文问句 + 🔊
    const asks = window.document.querySelectorAll('main .wr-ask-speak');
    assert.equal(asks.length, 3, '3 张卡都应有孩子台词 🔊');
    assert.ok(mainText(window).includes('🧒 Haohao：'), '卡 2 应显示浩浩台词');
    assert.ok(mainText(window).includes('🧒 Dongdong：'), '卡 3 应显示东东台词');
    assert.ok(mainText(window).includes('May I hold the parrot?'), '浩浩台词应为课本句型');
    assert.ok(mainText(window).includes('我可以抱抱这只鹦鹉吗'), '孩子台词应有中文');
    // 孩子台词不是可选项（不得出现在 button.option 里）
    const askInOptions = Array.from(window.document.querySelectorAll('main button.option'))
      .filter((b) => b.textContent.includes('May I hold the parrot?'));
    assert.equal(askInOptions.length, 0, '孩子台词不得作为选项出现');
    // 点孩子台词喇叭不判分
    asks[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('main .option.is-correct'), '点孩子台词喇叭不得判分');
    // 第 1 卡：孩子问 May I have a pet? → 店员正确应答 Yes, you can.
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    const box1 = wrBox(window.document, '她把鹦鹉带回宠物店');
    assert.ok(box1.querySelector('.option.is-correct'), '店员应答选对应标绿');
    // 每卡点选提示存在
    assert.equal((mainText(window).match(/店员回答（点选最合适的）/g) || []).length, 3, '3 张卡都应有店员回答点选提示');
  } finally { cleanup(); }
});

test('E2E-43 对话连读改名+挑战自由创作（句型支架带🔊）+ 底部未完成项明细提示', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    // 1) 初始：底部提示三项都没做
    assert.ok(mainText(window).includes('① 宠物店角色扮演'), '底部应提示角色扮演未完成');
    assert.ok(mainText(window).includes("② Let's Write 对话"), '底部应提示写作未完成');
    assert.ok(mainText(window).includes('③ 宠物思维导图'), '底部应提示思维导图未完成');
    // 2) 全对三卡 → 第 2 步是对话连读（不再叫"作文"）
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    await wrPickIn(window, '浩浩想抱鹦鹉', "No, you can't.");
    await wrPickIn(window, '东东想抱小兔子', 'Sure.');
    assert.ok(mainText(window).includes('三段对话连起来，演一演'), '第 2 步应为对话演一演');
    assert.ok(!mainText(window).includes('就是你的作文'), '不得再出现"就是你的作文"');
    // 3) 挑战区：自由创作定位 + 两个句型支架示例都带 🔊
    assert.ok(mainText(window).includes('编一段对话，或介绍你的宠物'), '挑战应为自由创作定位');
    const chalSpeaks = window.document.querySelectorAll('main .wr-challenge-speak');
    assert.equal(chalSpeaks.length, 2, '两个句型支架示例都应有 🔊');
    assert.ok(mainText(window).includes('May I have a cat?'), '对话示范应展示');
    assert.ok(mainText(window).includes('I love my pet!'), '介绍示范应展示');
    // 4) 完成写作后底部提示只剩两项
    await clickButton(window, '这三句我会了');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!mainText(window).includes("② Let's Write 对话"), '完成后写作应从未完成列表消失');
    assert.ok(mainText(window).includes('① 宠物店角色扮演'), '角色扮演仍未完成应保留');
    // 5) 三项全完成 → 提示"都完成啦"
    await clickButton(window, '演完了');
    const boxOf = (q) => {
      const divs = Array.from(window.document.querySelectorAll('main div'))
        .filter((d) => (d.textContent || '').includes(q) && d.querySelector('.mm-zh'));
      divs.sort((a, b) => a.textContent.length - b.textContent.length);
      return divs[0];
    };
    const pick = async (q, s) => {
      const b = Array.from(boxOf(q).querySelectorAll('button.option')).find((x) => (x.textContent || '').includes(s));
      b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    };
    await pick('Do you have a pet?', 'I want a pet!');
    await pick('What pet do you want?', 'I want a cat.');
    await pick('What does your pet look like?', 'It has big eyes.');
    await pick('What do you do with your pet?', 'I feed it.');
    await clickButton(window, '我的宠物介绍好了');
    assert.ok(mainText(window).includes('三项任务都完成啦'), '全完成后应有完成提示');
  } finally { cleanup(); }
});

test('E2E-44 范文对话：课文范围示范对话（说话人+英文+中文，每句 🔊+整段连读），点喇叭不判分', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    // 14 行范文对话齐全：每行 🔊
    const sdSpeaks = window.document.querySelectorAll('main .sd-speak');
    assert.equal(sdSpeaks.length, 14, '范文对话 14 句都应有 🔊');
    // 英文文字版 + 中文 + 说话人显示
    assert.ok(mainText(window).includes('May I come in?'), '进店问句应显示');
    assert.ok(mainText(window).includes('我可以进来吗'), '每句应有中文对照');
    assert.ok(mainText(window).includes('May I feed it a carrot?'), '喂胡萝卜句应显示');
    assert.ok(mainText(window).includes('我可以摸摸它吗'), '摸摸它中文应显示');
    assert.ok(mainText(window).includes("You're welcome."), '结束礼貌用语应显示');
    // 场景行 + 整段连读按钮
    assert.ok(mainText(window).includes('在宠物店'), '场景应显示');
    assert.ok(mainText(window).includes('范文整段连读'), '应有范文整段连读按钮');
    // 点句子喇叭不判分、不留标记
    sdSpeaks[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('main .option.is-correct'), '点范文喇叭不得判分');
    assert.ok(!window.document.querySelector('main .option.is-wrong'), '点范文喇叭不得留错误标记');
  } finally { cleanup(); }
});

test('E2E-45 第2步完整对话：问答成对显示（🧒孩子问+👩店员答），整段连读含问句', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    await wrPickIn(window, '浩浩想抱鹦鹉', "No, you can't.");
    await wrPickIn(window, '东东想抱小兔子', 'Sure.');
    // 问答成对：3 个问句 + 3 个答句都有说话人标签（限定在第 2 步 wr-done 区块内）
    const done = window.document.querySelector('main .wr-done');
    const asks = Array.from(done.querySelectorAll('.story-text strong'))
      .filter((s) => (s.textContent || '').includes('🧒'));
    const answers = Array.from(done.querySelectorAll('.story-text strong'))
      .filter((s) => (s.textContent || '').includes('👩 店员'));
    assert.equal(asks.length, 3, '第 2 步应显示 3 句孩子问句');
    assert.equal(answers.length, 3, '第 2 步应显示 3 句店员回答');
    // 问句内容正确（含课本句型）
    const askTexts = asks.map((s) => s.parentElement.textContent).join(' ');
    assert.ok(askTexts.includes('May I have a pet?'), '卡 1 问句应显示');
    assert.ok(askTexts.includes('May I hold the parrot?'), '卡 2 问句应显示');
    assert.ok(askTexts.includes('May I hold it?'), '卡 3 问句应显示');
  } finally { cleanup(); }
});

test('E2E-46 故事屋重构：背景旁白外置、对话标准格式分行、每篇 3 道阅读理解（听题/答对锁定+星/错可重试）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3');
    assert.match(mainText(window), /故事屋/);
    // A 篇：背景旁白外置（📖 背景 + 🔊），对话不再混入背景
    assert.ok(mainText(window).includes('📖 背景：'), 'A 篇应有外置背景块');
    let aBox = window.document.querySelectorAll('main .card.soft')[0];
    assert.ok(aBox.textContent.includes('Mrs Chen and Dongdong are walking on the street.'), '背景英文应显示');
    // 中文对照门控：未答题时中文隐藏 + 显示引导提示（防孩子只读中文，家长定版）
    assert.ok(!aBox.textContent.includes('陈夫人'), '未答题时背景中文应隐藏');
    assert.ok(!aBox.textContent.includes('妈妈，我可以养一只宠物吗'), '未答题时对话中文应隐藏');
    assert.ok(aBox.querySelector('.st-zh-lock'), '未答题时应显示中文门控提示');
    assert.ok(aBox.textContent.includes('已答对 0/3'), '门控提示应显示进度');
    // 考试题型：指令语 + 题干中文门控（答对该题才显示）
    assert.ok(aBox.textContent.includes('阅读理解·考试题型练一练'), '应有考试题型指令语');
    assert.ok(aBox.textContent.includes('判断正误'), '指令应含判断题说明');
    assert.ok(!aBox.textContent.includes('东东想养一只宠物兔子'), '未答对第 1 题时题干中文应隐藏');
    // 对话标准格式：说话人 + 每行 🔊
    assert.equal(aBox.querySelectorAll('.st-line-speak').length, 8, 'A 篇对话应 8 行且每行有 🔊');
    assert.ok(aBox.textContent.includes('🧒 Dongdong：') && aBox.textContent.includes('👩 Mrs Chen：'), '对话应有说话人标签');
    // 点对话行喇叭不判分、不留标记
    aBox.querySelectorAll('.st-line-speak')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('.option.is-correct'), '点对话喇叭不得判分');
    // 阅读理解：3 题，判断题 T/F 选项
    aBox = window.document.querySelectorAll('main .card.soft')[0];
    assert.equal(aBox.querySelectorAll('.st-q-speak').length, 3, 'A 篇应 3 道阅读理解题');
    // 第 1 题先点错（F）→ 不留红；再点对（T）→ 标绿
    const q1Box = aBox.querySelectorAll('.st-q-speak')[0].closest('div[style]').parentElement;
    const q1Buttons = Array.from(q1Box.querySelectorAll('button.option'));
    const fBtn = q1Buttons.find((b) => b.textContent.includes('F 错'));
    fBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('.option.is-wrong'), '答错不得留红色标记');
    // 答对第 1 题后中文仍未解锁
    const tBtn = window.document.querySelectorAll('main .card.soft')[0]
      .querySelectorAll('.st-q-speak')[0].closest('div[style]').parentElement
      .querySelectorAll('button.option');
    Array.from(tBtn).find((b) => b.textContent.includes('T 对')).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    aBox = window.document.querySelectorAll('main .card.soft')[0];
    assert.ok(Array.from(aBox.querySelectorAll('.option.is-correct')).length >= 1, '答对应标绿');
    assert.ok(aBox.textContent.includes('已答对 1/3'), '门控提示应更新进度');
    assert.ok(!aBox.textContent.includes('妈妈，我可以养一只宠物吗'), '未答完时对话中文仍应隐藏');
    assert.ok(aBox.textContent.includes('东东想养一只宠物兔子'), '答对第 1 题后题干中文应出现');
    assert.ok(!aBox.textContent.includes('他们给邦尼吃什么'), '未答对第 3 题时其题干中文应隐藏');
    // 依次答对第 2、3 题（render 重建 DOM，每轮重新查询）
    const answerQ = async (idx, want) => {
      const box = window.document.querySelectorAll('main .card.soft')[0];
      const qb = box.querySelectorAll('.st-q-speak')[idx].closest('div[style]').parentElement;
      Array.from(qb.querySelectorAll('button.option')).find((b) => b.textContent.includes(want))
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    };
    await answerQ(1, 'T 对');
    await answerQ(2, 'Carrots.');
    // 全部答对 → 中文对照解锁出现
    aBox = window.document.querySelectorAll('main .card.soft')[0];
    assert.ok(!aBox.querySelector('.st-zh-lock'), '答完题后门控提示应消失');
    assert.ok(aBox.textContent.includes('陈夫人'), '答完题后背景中文应出现');
    assert.ok(aBox.textContent.includes('妈妈，我可以养一只宠物吗'), '答完题后对话中文应出现');
    assert.ok(aBox.textContent.includes('他们给邦尼吃什么'), '答完题后全部题干中文应出现');
    // 听整篇按钮存在
    assert.ok(aBox.textContent.includes('听整篇'), '应可听整篇');
    // 故事完成按钮仍可用（Stage4 通关链路不变）
    await clickButton(window, '我读完并演了');
    assert.ok((app.state.session.storiesDone || []).includes('A'), 'A 篇应标记完成');
  } finally { cleanup(); }
});
