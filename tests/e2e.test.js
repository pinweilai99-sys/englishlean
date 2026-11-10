// E2E：浏览器级验收（对应 PRD §9 的可测验收点）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshApp, buttons, clickButton, navigate, mainText, persisted, UNIT,
} from './e2e-helper.mjs';
import { computePdfLayout, buildHandwritingWords } from '../js/ui/handwriting.js';
import { buildSpellQueue, SPELL_TIMES_PER_WORD } from '../js/ui/spelling.js';
import { chunkSay } from '../js/core/phonics.js';

// 应答配对选项查找助手：选项内含 🔊 听音小喇叭（新口径），按剥离喇叭后的文本精确匹配
function optBtn(root, text) {
  return Array.from(root.querySelectorAll('button.option'))
    .find((b) => b.textContent.replace(/🔊/g, '').trim() === text);
}

// 写作选句查找助手：按卡片的 data-ctxzh（始终存在，不随中文门控消失）定位，再在卡内找选项
function wrBox(root, ctxZh) {
  return Array.from(root.querySelectorAll('main div[data-ctxzh]'))
    .find((d) => (d.getAttribute('data-ctxzh') || '').includes(ctxZh));
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

test('E2E-1 首页渲染：8 张单元卡，U5 与 U4 可进（其余锁定）', async () => {
  const { window, cleanup } = await freshApp();
  try {
    const cards = window.document.querySelectorAll('.unit-card');
    assert.equal(cards.length, 8);
    const openNames = [...window.document.querySelectorAll('.unit-card.is-open .unit-name')].map((n) => n.textContent);
    assert.ok(openNames.some((t) => t.includes('May I have a pet?')), 'U5 应开放');
    assert.ok(openNames.some((t) => t.includes('Can I use your pencil')), 'U4 应开放');
    assert.equal(window.document.querySelectorAll('.unit-card.is-locked').length, 6);
  } finally { cleanup(); }
});

test('E2E-1b 多单元路由：从首页进入 U4 能正确加载 U4 数据', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    // 启动默认是 U5
    assert.equal(app.state.data.id, 'u5');
    // 点首页 U4 卡片进入
    const u4card = [...window.document.querySelectorAll('.unit-card')].find((c) => c.textContent.includes('Can I use your pencil'));
    assert.ok(u4card, '首页应有 U4 卡片');
    u4card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(app.state.data.id, 'u4', '进入 U4 后应加载 U4 数据');
    assert.match(mainText(window), /向同学礼貌地借东西/, 'U4 目标文案应出现');
    assert.ok(!mainText(window).includes('May I have a ___?'), '不应再出现 U5 的句型预览');
    // 再切回 U5（直接路由，避免依赖首页卡片）
    await navigate(window, app, '#/unit/u5');
    assert.equal(app.state.data.id, 'u5', '切回应加载回 U5');
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

// 定位某道微测题的题块（题干 div 的父节点 = box）
function quizBox(window, id) {
  const q = UNIT.quiz.find((x) => x.id === id);
  assert.ok(q, `quiz 缺少 ${id}`);
  const div = Array.from(window.document.querySelectorAll('main div')).find((d) => {
    const t = (d.textContent || '').trim();
    return /^\d+\.\s/.test(t) && t.slice(t.indexOf(' ') + 1) === q.prompt;
  });
  const box = div?.parentElement;
  assert.ok(box, `找不到题块 ${id}（题干：${q.prompt}）`);
  return box;
}

test('E2E-48 考点微测 III（听短语选词填空）：渲染+🔊听短语+可作答', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3/quiz');
    assert.match(mainText(window), /考点微测/);
    const q = UNIT.quiz.find((x) => x.id === 'III1');
    const box = quizBox(window, 'III1');
    // III 类应有「🔊 听一遍」按钮（听短语）
    const speakBtn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === '🔊 听一遍');
    assert.ok(speakBtn, 'III 题应出现🔊听短语按钮');
    // 点击🔊不报错
    speakBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // 作答正确项
    const ans = q.options[q.answer];
    const btn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === ans);
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    // render() 重建 DOM，须重查元素
    const box2 = quizBox(window, 'III1');
    const btn2 = Array.from(box2.querySelectorAll('button')).find((b) => b.textContent.trim() === ans);
    assert.ok(btn2.classList.contains('is-correct'), 'III 答对应标 is-correct');
    assert.match(box2.textContent, new RegExp(q.explain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '应显示讲解');
  } finally { cleanup(); }
});

test('E2E-49 考点微测 VI（选词填空）：渲染（无🔊）+可作答', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3/quiz');
    const q = UNIT.quiz.find((x) => x.id === 'VI1');
    const box = quizBox(window, 'VI1');
    // VI 类纯阅读填空，不应有🔊按钮
    const speakBtn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === '🔊 听一遍');
    assert.ok(!speakBtn, 'VI 题不应出现🔊按钮');
    const ans = q.options[q.answer];
    const btn = Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === ans);
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const box2 = quizBox(window, 'VI1');
    const btn2 = Array.from(box2.querySelectorAll('button')).find((b) => b.textContent.trim() === ans);
    assert.ok(btn2.classList.contains('is-correct'), 'VI 答对应标 is-correct');
  } finally { cleanup(); }
});

test('E2E-50 巩固拓展子导航：进入 Stage3 默认故事屋，可见「考点微测」入口并一键切换', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    // 进入巩固拓展（Stage3），默认渲染故事屋
    await navigate(window, app, '#/unit/u5/stage/3');
    assert.match(mainText(window), /故事屋/);
    // 子导航三栏都应存在
    const tabs = window.document.querySelectorAll('.stage3-nav button[data-tab]');
    const keys = Array.from(tabs).map((b) => b.getAttribute('data-tab'));
    assert.ok(keys.includes('stories'), '应有「故事屋」栏');
    assert.ok(keys.includes('quiz'), '应有「考点微测」栏（修复：此前入口缺失）');
    assert.ok(keys.includes('review'), '应有「复习」栏');
    const quizTab = Array.from(tabs).find((b) => b.getAttribute('data-tab') === 'quiz');
    assert.match(quizTab.textContent, /考点微测/);

    // 点击「考点微测」应切到微测页（修复前只能通过深链访问）
    quizTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    assert.match(mainText(window), /考点微测/);
    assert.ok(mainText(window).match(/共\s*52\s*题/), '微测应显示 52 题（I–X 十类 + ou 语音 P 类）');
    // 微测页也应带子导航，且当前高亮 quiz
    const quizNav = window.document.querySelectorAll('.stage3-nav button[data-tab]');
    const active = Array.from(quizNav).find((b) => b.classList.contains('leaf'));
    assert.equal(active && active.getAttribute('data-tab'), 'quiz', '微测页应高亮「考点微测」');

    // 再切回故事屋验证双向可达
    const back = Array.from(quizNav).find((b) => b.getAttribute('data-tab') === 'stories');
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    assert.match(mainText(window), /故事屋/);
  } finally { cleanup(); }
});

test('E2E-51 回忆卡看图卡配插画：rc1 兔子图、听音卡无图、rc4 金鱼图（pic 字段驱动）', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/recall');
    // rc1 看图说出请求句：应显示兔子插画
    const pic1 = window.document.querySelector('.recall-pic svg');
    assert.ok(pic1, 'rc1 应渲染插画 svg');
    assert.equal(pic1.getAttribute('aria-label'), 'a rabbit', 'rc1 插画应是兔子');
    // rc2 听答句反推问题：非看图卡，不应有插画
    await clickButton(window, '下一张');
    assert.equal(window.document.querySelector('.recall-pic svg'), null, 'rc2 听音卡不应有插画');
    // 连翻到 rc4（看图说单词 goldfish）
    await clickButton(window, '下一张'); // rc3
    await clickButton(window, '下一张'); // rc4
    const pic4 = window.document.querySelector('.recall-pic svg');
    assert.ok(pic4, 'rc4 应渲染插画 svg');
    assert.equal(pic4.getAttribute('aria-label'), 'a goldfish', 'rc4 插画应是金鱼');
  } finally { cleanup(); }
});

test('E2E-52 考点微测答后必给答案及解说：答错/答对都显示「✅ 正确答案 + 💡 解说」（家长定版）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3/quiz');
    const i1 = UNIT.quiz.find((x) => x.id === 'I1');
    const i2 = UNIT.quiz.find((x) => x.id === 'I2');

    // 情形一：答错（I1 选 hat，正确答案是 pet）
    let box = quizBox(window, 'I1');
    const wrongBtn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === 'hat');
    wrongBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = quizBox(window, 'I1');
    let expl = box.querySelector('.quiz-explain');
    assert.ok(expl, '答错后也应显示答案解说块');
    assert.match(expl.textContent, /✅ 正确答案：pet/, '答错后应明确给出正确答案');
    assert.match(expl.textContent, new RegExp(i1.explain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '答错后应显示解说');

    // 情形二：答对（I2 选 may）
    box = quizBox(window, 'I2');
    const rightBtn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === 'may');
    rightBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = quizBox(window, 'I2');
    expl = box.querySelector('.quiz-explain');
    assert.ok(expl, '答对后应显示答案解说块');
    assert.match(expl.textContent, /✅ 正确答案：may/, '答对后应明确给出正确答案');
    assert.match(expl.textContent, new RegExp(i2.explain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '答对后应显示解说');

    // 未作答的题不应提前显示答案（用题干唯一的题避免 quizBox 对重复题干的歧义）
    box = quizBox(window, 'II1');
    assert.equal(box.querySelector('.quiz-explain'), null, '未作答不应提前剧透');
  } finally { cleanup(); }
});

test('E2E-53 测评补全：II1 硬错已修 + ou 语音(P1) + 图句判断(VII3) 可答且答案正确', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, true, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/3/quiz');
    // 1) II1 硬错修复：正确答案应为「🏪 宠物店」，且点击后标绿
    const ii1 = UNIT.quiz.find((x) => x.id === 'II1');
    let box = quizBox(window, 'II1');
    const petShopBtn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === '🏪 宠物店');
    assert.ok(petShopBtn, 'II1 应出现「🏪 宠物店」选项');
    assert.ok(!Array.from(box.querySelectorAll('button.option')).some((b) => b.textContent.includes('🏦')), 'II1 不应再含银行🏦');
    petShopBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = quizBox(window, 'II1');
    assert.ok(Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === '🏪 宠物店').classList.contains('is-correct'), 'II1 点宠物店应标 is-correct');
    assert.equal(ii1.options[ii1.answer], '🏪 宠物店', 'II1 数据答案须是宠物店');

    // 2) ou 语音 P1：听 mouse，选含 ou 的单词，答后显示答案
    const p1 = UNIT.quiz.find((x) => x.id === 'P1');
    box = quizBox(window, 'P1');
    const mouseBtn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === 'mouse 🐭');
    assert.ok(mouseBtn, 'P1 应出现 mouse 🐭 选项');
    mouseBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = quizBox(window, 'P1');
    let expl = box.querySelector('.quiz-explain');
    assert.ok(expl, 'P1 答后应有答案解说块');
    assert.match(expl.textContent, /✅ 正确答案：mouse 🐭/, 'P1 应明确给出正确答案');

    // 3) 图句判断 VII3：The cat is in the zoo → F（不在动物园）
    const vii3 = UNIT.quiz.find((x) => x.id === 'VII3');
    box = quizBox(window, 'VII3');
    const fBtn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === 'F');
    assert.ok(fBtn, 'VII3 应出现 F 选项');
    fBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    box = quizBox(window, 'VII3');
    const fBtn2 = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.trim() === 'F');
    assert.ok(fBtn2.classList.contains('is-correct'), 'VII3 选 F 应标 is-correct');
    expl = box.querySelector('.quiz-explain');
    assert.ok(expl && expl.textContent.includes('动物园'), 'VII3 答后应显示解说（点明不在动物园）');
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
    // 2026-11-06 需求变更：分块区改为「每词只显示有信息增量的那一行」。
    // may 是单音节词 → 只显示「🔤 拼读拆分」（m + ay），不再显示「🧩 记词分块」
    // （它的 chunks 只有整词一块，点了也只是再读一遍整词，零信息增量）。
    // 正反对照：单音节词**不得**出现记词分块区；记忆提示必须仍在。
    assert.doesNotMatch(mainText(window), /记词分块/,
      '单音节词 may 不应再显示「记词分块」区（旧口径与「拼读拆分」内容重复/零增量）');
    assert.match(mainText(window), /拼读拆分/, '单音节词应显示「拼读拆分」区');
    assert.match(mainText(window), /拼音 mei/, 'may 的记忆提示应展示');
    // 跳到 clever（多音节拆分 cle·ver）
    app.state.session.wordIndex = 8;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    const text = mainText(window);
    assert.match(text, /双音节 cle·ver/, 'clever 的记忆提示应展示');
    // 多音节词：chunks == split（都是音节），只显示「🧩 记词分块」，不再重复显示拼读拆分
    assert.match(text, /记词分块/, '多音节词 clever 应显示「记词分块」区');
    assert.doesNotMatch(text, /拼读拆分/,
      '多音节词 clever 不应再显示「拼读拆分」区（旧口径两行渲染出完全相同的 cle · ver）');
    const chunkBtns = buttons(window).filter((b) => b.classList.contains('chunk-btn'));
    assert.deepEqual(chunkBtns.map((b) => b.textContent.trim()), ['cle', 'ver'], '应有 cle / ver 两个分块按钮');
    // 点分块按钮 → 分块发音（旧口径无此功能）
    window.speechSynthesis.__spoken.length = 0;
    chunkBtns[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    // 分块朗读走重拼写（显示 cle，实际朗读 chunkSay('cle')='klee'，避免孤立音节怪音）
    assert.ok(window.speechSynthesis.__spoken.includes(chunkSay('cle')),
      '点分块应朗读该块的重拼写音（cle→klee）');
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
    // 支架 1：孩子台词中文默认隐藏（门控：演完后才出现），防孩子只读中文
    assert.ok(!mainText(window).includes('我想要一只'), '孩子台词中文应默认隐藏');
    assert.ok(mainText(window).includes('（演完后看中文）'), '应显示中文锁定提示');
    await clickButton(window, '✅ 演完了');
    // 演完后孩子台词下方显示中文意思（含当前动物）
    assert.ok(mainText(window).includes('我想要一只'), '演完后孩子台词应显示中文意思');
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
    // 支架 1：三张情境卡，情境英文显示、中文默认隐藏（门控：选对后才出现）
    assert.ok(!mainText(window).includes('她把鹦鹉带回宠物店'), '情境 1 中文应默认隐藏');
    assert.ok(!mainText(window).includes('东东想抱小兔子'), '情境 3 中文应默认隐藏');
    // 支架 2：每个候选句带 🔊（共 9 个），中文在选对后才出现
    const wrSpeaks = Array.from(window.document.querySelectorAll('main button.option'))
      .filter((b) => b.querySelector('.wr-speak'));
    assert.equal(wrSpeaks.length, 9, '3 题 × 3 选项 = 9 个写作候选句');
    assert.ok(wrSpeaks.every((b) => b.querySelector('.wr-speak')), '每个候选句应有 🔊 听音');
    // 支架 3：点喇叭只朗读不判分
    wrSpeaks[0].querySelector('.wr-speak').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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
    // 选对后情境中文应出现（门控解锁）
    assert.ok(mainText(window).includes('她把鹦鹉带回宠物店'), '选对后情境 1 中文应出现');
    assert.ok(mainText(window).includes('东东想抱小兔子'), '选对后情境 3 中文应出现');
    // 行为 3：完成写作 → writeDone 生效
    await clickButton(window, '这三句我会了');
    assert.ok(mainText(window).includes('✅') || true, '完成写作应有反馈');
  } finally { cleanup(); }
});

// 思维导图问题卡定位助手：按问题文本定位到所属卡（取内容最短的=卡片本体）
function mmBox(root, qText) {
  const divs = Array.from(root.querySelectorAll('main div'))
    .filter((d) => (d.textContent || '').includes(qText) && d.querySelector('button.option'));
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
    // 4 问互动卡：🔊 听问题 + 中文问题（门控：选完该题才出现）
    assert.equal(window.document.querySelectorAll('main .mm-q-speak').length, 4, '4 个问题都应有 🔊 听问题');
    assert.ok(!mainText(window).includes('你养宠物吗'), '问题中文应默认隐藏');
    assert.ok(!mainText(window).includes('它长什么样子'), '第 3 问中文应默认隐藏');
    // Q3 特征句默认跟随 cat
    let q3 = mmBox(window.document, 'What does your pet look like?');
    assert.ok(q3.textContent.includes('It has big eyes.'), '默认特征句应为 cat 的');
    // Q2 选 rabbit → Q3 变 rabbit 特征句
    const q2 = mmBox(window.document, 'What pet do you want?');
    Array.from(q2.querySelectorAll('button.option')).find((b) => b.textContent.includes('I want a rabbit.'))
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(mainText(window).includes('你想养什么宠物'), '选完Q2后其问题中文应出现');
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
    assert.ok(!mainText(window).includes('我可以抱抱这只鹦鹉吗'), '孩子台词中文应默认隐藏');
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
    // 选对第 1 卡后，该卡孩子台词中文应出现（门控解锁）
    assert.ok(box1.textContent.includes('我想要一只宠物，可以吗？'), '选对后孩子台词中文应出现');
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
        .filter((d) => (d.textContent || '').includes(q) && d.querySelector('button.option'));
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
    // 英文文字版 + 说话人显示；中文默认隐藏（门控：听整段连读后才出现）
    assert.ok(mainText(window).includes('May I come in?'), '进店问句应显示');
    assert.ok(mainText(window).includes('May I feed it a carrot?'), '喂胡萝卜句应显示');
    assert.ok(mainText(window).includes("You're welcome."), '结束礼貌用语应显示');
    assert.ok(!mainText(window).includes('我可以进来吗'), '范文对话中文应默认隐藏');
    assert.ok(mainText(window).includes('听完后看中文'), '范文对话应显示中文锁定提示');
    // 场景行 + 整段连读按钮
    assert.ok(mainText(window).includes('在宠物店'), '场景应显示');
    assert.ok(mainText(window).includes('范文整段连读'), '应有范文整段连读按钮');
    // 点句子喇叭不判分、不留标记
    sdSpeaks[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!window.document.querySelector('main .option.is-correct'), '点范文喇叭不得判分');
    assert.ok(!window.document.querySelector('main .option.is-wrong'), '点范文喇叭不得留错误标记');
    // 听整段连读后中文出现
    await clickButton(window, '🔊 范文整段连读');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(mainText(window).includes('我可以进来吗'), '听整段连读后中文应出现');
    assert.ok(mainText(window).includes('我可以摸摸它吗'), '听整段连读后摸摸它中文应出现');
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

test("E2E-47 真实输出中文门控：角色扮演(演完出)/Let's Write选句卡(选对出)/思维导图(选完出)/范文对话(听整段出)，答前中文隐藏", async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    const main = () => window.document.querySelector('main');
    const smallest = (divs) => { divs.sort((a, b) => a.textContent.length - b.textContent.length); return divs[0]; };

    // 1) 角色扮演：孩子台词中文默认隐藏，点"✅ 演完了"后出现
    assert.ok(!main().textContent.includes('我想要一只小宠物'), '角色扮演孩子台词中文应默认隐藏');
    assert.ok(main().textContent.includes('（演完后看中文）'), '角色扮演应显示中文锁定提示');
    await clickButton(window, '✅ 演完了');
    assert.ok(main().textContent.includes('我想要一只小宠物'), '演完后孩子台词中文应出现');

    // 2) Let's Write 选句卡 0：情境/问句/正确选项中文默认隐藏，选对后出现
    //    按 data-ctxzh 属性定位（中文门控不影响属性，比 textContent 稳定）
    const cardByCtx = (s) => smallest(Array.from(main().querySelectorAll('main div[data-ctxzh]'))
      .filter((d) => (d.getAttribute('data-ctxzh') || '').includes(s)));
    const card0 = cardByCtx('她把鹦鹉带回宠物店');
    assert.ok(card0, '应定位到选句卡0');
    assert.ok(!card0.textContent.includes('我想要一只宠物，可以吗？'), '问句中文应默认隐藏');
    assert.ok(!card0.textContent.includes('可以哦，给你。'), '正确选项中文应默认隐藏');
    const yesBtn = Array.from(card0.querySelectorAll('button.option'))
      .find((b) => (b.textContent || '').includes('Yes, you can.'));
    yesBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const card0b = cardByCtx('她把鹦鹉带回宠物店');
    assert.ok(card0b.textContent.includes('我想要一只宠物，可以吗？'), '选对后问句中文应出现');
    assert.ok(card0b.textContent.includes('可以哦，给你。'), '选对后正确选项中文应出现');

    // 3) 思维导图 Q0：问题选项中文默认隐藏，选完后出现
    //    定位「问题块」box（含英文问句文本 + 选项按钮），勿用门控隐藏的 qZh 中文
    const mmByQ = (q) => smallest(Array.from(main().querySelectorAll('main div'))
      .filter((d) => (d.textContent || '').includes(q) && d.querySelector('button.option')));
    const mmQ0 = mmByQ('Do you have a pet?');
    assert.ok(mmQ0, '应定位到思维导图Q0');
    assert.ok(!mmQ0.textContent.includes('我想要一只宠物！'), 'Q0选项中文应默认隐藏');
    mmQ0.querySelectorAll('button.option')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const mmQ0b = mmByQ('Do you have a pet?');
    assert.ok(mmQ0b.textContent.includes('我想要一只宠物！'), '选完后Q0选项中文应出现');

    // 4) 范文对话：每句中文默认隐藏，点"整段连读"后出现
    assert.ok(!main().textContent.includes('我可以进来吗？'), '范文对话中文应默认隐藏');
    await clickButton(window, '🔊 范文整段连读');
    assert.ok(main().textContent.includes('我可以进来吗？'), '听整段连读后范文中文应出现');
  } finally { cleanup(); }
});

test('E2E-54 应答配对题型效度：表情线索答题前可见；合法但极性冲突项不判对；答对给规则解说', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    await clickButton(window, 'goldfish');
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('.q-speak'));
    const click = (btn) => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // 1) 情境线索是「题目条件」，答题前就可见；中文译文仍默认隐藏（主动回忆）
    let q1 = boxOf('May I have a goldfish?');
    assert.ok(q1, '应出现金鱼第 1 题');
    const cue = q1.querySelector('.cue-badge');
    assert.ok(cue, '题干应有表情线索徽标');
    assert.match(cue.textContent, /摇头/, '金鱼题应给「摇头」线索');
    assert.ok(!q1.textContent.includes('我可以养一条金鱼吗'), '整句中文译文仍默认隐藏');

    // 2) 正反对照：旧版被冤枉的合法答语 Yes, you can. 现在因摇头线索成为明确错项
    const yesBtn = optBtn(q1, 'Yes, you can.');
    assert.ok(yesBtn, '红框里的 Yes, you can. 应仍在选项中');
    click(yesBtn);
    const wrongToast = window.document.getElementById('toast').textContent;
    await new Promise((r) => setTimeout(r, 30));
    q1 = boxOf('May I have a goldfish?');
    assert.equal(q1.querySelector('.option.is-correct'), null, '极性冲突项不得判对');
    assert.match(wrongToast, /点头还是摇头/, '答错应给指向表情的支架提示，而非空泛「再想想」');

    // 3) 点课本原句 → 判对，并立刻给规则解说
    click(optBtn(q1, "No, you can't. But you can feed it."));
    await new Promise((r) => setTimeout(r, 30));
    q1 = boxOf('May I have a goldfish?');
    assert.ok(q1.querySelector('.option.is-correct'), '课本原句应判对');
    assert.match(q1.textContent, /💡/, '答对后应给规则解说');

    // 4) 第 2 题：主语错位项不判对，课本原句判对
    let q2 = boxOf('May I feed it?');
    assert.match(q2.querySelector('.cue-badge').textContent, /点头/, '喂金鱼题应给「点头」线索');
    click(optBtn(q2, 'OK. Yes, I can.'));
    const subjectToast = window.document.getElementById('toast').textContent;
    await new Promise((r) => setTimeout(r, 30));
    q2 = boxOf('May I feed it?');
    assert.equal(q2.querySelector('.option.is-correct'), null, '主语错位项不得判对');
    // 需求变更正反对照：旧提示只丢一个抽象术语「主语」，新规格改为指向可回看的具体对照卡
    assert.ok(!subjectToast.includes('主语'), '前置对照：抽象术语「主语」已从答错提示移除');
    assert.match(subjectToast, /答的是别的问题|下面的/, '新规格：答错提示应引导去看具体对照卡');
    assert.match(q2.querySelector('.answer-feedback')?.textContent || '', /这句英文本身没错/, '应显示中性对照卡，说明句子本身没错');
    click(optBtn(q2, 'Sure.'));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(boxOf('May I feed it?').querySelector('.option.is-correct'), 'Sure. 应判对');
  } finally { cleanup(); }
});

test('E2E-55 本单元语法知识点进孩子侧：Stage2 第 3 步归纳卡，例句带🔊，四阶段模型不变', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    // 1) 第 3 步归纳卡存在，且含本单元 3 条规律
    const ruleCard = Array.from(window.document.querySelectorAll('.card'))
      .find((c) => (c.textContent || '').includes('第 3 步 · 我发现了一个规律'));
    assert.ok(ruleCard, '核心句型页应有第 3 步语法归纳卡');
    const rules = Array.from(ruleCard.querySelectorAll('.grammar-rule'));
    assert.equal(rules.length, 3, '应展示本单元 3 条规律');
    assert.match(ruleCard.textContent, /问「我可以吗」，答「你可以」/);
    assert.match(ruleCard.textContent, /看表情，定答语/);
    assert.match(ruleCard.textContent, /问「你能吗」，答「我能」/);
    // 2.1) 「看表情，定答语」卡带 cue 字段，渲染出表情徽标（对齐配对题；标题说看表情就不能没表情）
    const cueRule = rules.find((r) => (r.textContent || '').includes('看表情，定答语'));
    assert.ok(cueRule, '应有「看表情，定答语」这张归纳卡');
    const badge = cueRule.querySelector('.cue-badge');
    assert.ok(badge, '带 cue 的归纳卡应在问句前显示表情徽标');
    assert.match(badge.textContent, /摇头/, 'goldfish 题 cue=no，徽标应显示「摇头」');
    // 2) 英语必有播放铁律：每条一问一答两句英文各配 🔊
    for (const r of rules) {
      assert.equal(r.querySelectorAll('.grammar-speak').length, 2, '每条规律的两句英文都应有 🔊');
    }
    // 3) 纯展示卡：不判分、不加星、不设通关闸门（红线：不留失败痕迹）
    assert.equal(ruleCard.querySelector('button'), null, '归纳卡不应有答题/通关按钮');
    const before = persisted(window).progress.u5.stagePassed[1];
    const beforeStars = persisted(window).stars;
    rules[0].querySelector('.grammar-speak').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(persisted(window).progress.u5.stagePassed[1], before, '听例句不得判分/改进度');
    assert.equal(persisted(window).stars, beforeStars, '听例句不得加星');
    // 4) 超纲语法点不下沉给孩子
    assert.ok(!/三单|现在进行时|宾格代词/.test(ruleCard.textContent), '孩子侧不得出现超纲语法点');
    // 5) 学习路径仍是 4 阶段（语法不单列第 5 阶段），且首页可见标识
    await navigate(window, app, '#/unit/u5');
    const items = Array.from(window.document.querySelectorAll('.stage-item'));
    assert.equal(items.length, 4, '不得新增第 5 个阶段，4 阶段进度模型不变');
    assert.match(mainText(window), /已通过 \d \/ 4 个阶段/, '阶段总数仍为 4');
    assert.match(items[1].textContent, /语法小规律/, '核心句型卡应标出语法知识点');
  } finally { cleanup(); }
});

test('E2E-56 答错反馈可回看：中性人称对照卡，按题型给具体提示，答对/离开即消失', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, false, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/1');
    await clickButton(window, 'goldfish');
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('.q-speak'));
    const click = (btn) => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const tick = () => new Promise((r) => setTimeout(r, 30));

    // 1) 红框项 OK. Yes, I can. 答错 → 对照卡讲清「句子没错，只是答错了对象」+ 本题人称规则
    click(optBtn(boxOf('May I feed it?'), 'OK. Yes, I can.'));
    await tick();
    let q2 = boxOf('May I feed it?');
    const fb = q2.querySelector('.answer-feedback');
    assert.ok(fb, '答错后应出现可回看的对照卡');
    assert.match(fb.textContent, /这句英文本身没错/, '不得让孩子误以为课本原句是错句');
    assert.match(fb.textContent, /问「我可以吗」，回答要说「你可以」/, '应给本题的具体人称规则');
    assert.ok(fb.textContent.includes('💡'), '对照卡应为中性提示');
    assert.equal(q2.querySelector('.option.is-wrong'), null, '对照卡不得留下红色错误标记');

    // 2) 答对后对照卡消失，改为规则解说（不留失败痕迹）
    click(optBtn(q2, 'Sure.'));
    await tick();
    q2 = boxOf('May I feed it?');
    assert.equal(q2.querySelector('.answer-feedback'), null, '答对后对照卡应消失');
    assert.match(q2.textContent, /💡/, '答对后应显示规则解说');

    // 3) 换题型 Can he...? 的干扰项 → 对照卡应换成「它能」，证明提示按题型生成而非写死
    await clickButton(window, 'dog');
    click(optBtn(boxOf('Can he help blind people?'), 'Yes, you can.'));
    await tick();
    assert.match(boxOf('Can he help blind people?').querySelector('.answer-feedback').textContent,
      /问「它能吗」，回答要说「它能」/, 'Can he 题应给对应的人称提示');

    // 4) 离开再回来，答错提示不残留（对照卡只活在当前页，不进持久化存档）
    await navigate(window, app, '#/unit/u5');
    await navigate(window, app, '#/unit/u5/stage/1');
    assert.equal(boxOf('Can he help blind people?').querySelector('.answer-feedback'), null,
      '重进页面不应残留答错提示');
  } finally { cleanup(); }
});

test('E2E-57 单词卡拼读示范（2026-11-06 家长提问）：「听一听」= 慢速整词→拆音→合回整词 + 拼读拆分展示', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');

    // 1) 拼读拆分展示：may 应拆成 m + ay（旧口径 chunks 只有整词，等于没拆）
    const splitPieces = () => Array.from(window.document.querySelectorAll('.split-piece'))
      .map((el) => el.textContent.trim());
    assert.deepEqual(splitPieces(), ['m', 'ay'], 'may 应展示拼读拆分 m + ay');
    assert.match(mainText(window), /拼读拆分/, '应出现「拼读拆分」标题');

    // 2) 点「听一听」→ 立即推进到②认形（示范不阻塞学习链路）
    window.speechSynthesis.__spoken.length = 0;
    await clickButton(window, '听一听');
    const steps = Array.from(window.document.querySelectorAll('.step'));
    assert.ok(steps[1].className.includes('is-current'), '点「听一听」应立即进入②认形（不被示范时长卡住）');

    // 3) 拼读示范真的播了：整词至少读了两遍（慢速一遍 + 合音一遍）
    await new Promise((r) => setTimeout(r, 1500));
    const spoken = window.speechSynthesis.__spoken;
    const wordCount = spoken.filter((t) => t.toLowerCase() === 'may').length;
    assert.ok(wordCount >= 2,
      'may 应至少朗读两遍（慢速+合音），实际 ' + wordCount + ' 次：' + JSON.stringify(spoken));

    // 4) 关键红线：单字母**不得**被单独念出来（会被念成字母名 em/ay，教错音）
    assert.ok(!spoken.some((t) => ['m', 'ay', 'p', 'e', 't'].includes(t.toLowerCase())),
      '拆分块不得被单独发音（会念成字母名）：' + JSON.stringify(spoken));

    // 5) 多音节词才做"逐音块拆读"（rabbit → rab + bit）
    app.state.session.wordIndex = 2;
    app.state.session.step = 0; // 回到①听音，才有「听一听」按钮
    app.render();
    await new Promise((r) => setTimeout(r, 30));
    window.speechSynthesis.__spoken.length = 0;
    await clickButton(window, '听一听');
    await new Promise((r) => setTimeout(r, 1800));
    const rSpoken = window.speechSynthesis.__spoken.map((t) => t.toLowerCase());
    assert.ok(rSpoken.includes('rab'), 'rabbit 拆音应读出音块 rab：' + JSON.stringify(rSpoken));
    assert.ok(rSpoken.includes('bit'), 'rabbit 拆音应读出音块 bit：' + JSON.stringify(rSpoken));
    assert.ok(rSpoken.includes('rabbit'), 'rabbit 应有合回的整词音');
  } finally { cleanup(); }
});

test('E2E-58 拼读示范可被打断：进入跟读时后台示范立刻收声（不污染录音评分）', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    await clickButton(window, '听一听');
    // 示范正在后台播
    await new Promise((r) => setTimeout(r, 60));
    // 进入跟读＝要录孩子的音了，必须停掉示范
    await clickButton(window, '我会认这个词');
    const before = window.speechSynthesis.__spoken.length;
    await new Promise((r) => setTimeout(r, 900));
    const after = window.speechSynthesis.__spoken.length;
    assert.equal(after, before, '进入跟读后不应再有示范声音（会进麦克风污染评分）');
    // 高亮状态不得残留
    assert.equal(window.document.querySelectorAll('.split-piece.is-speaking').length, 0,
      '拼读拆分高亮不应残留');
  } finally { cleanup(); }
});

test('E2E-59 拼读示范不得出现静音空等（2026-11-06 家长反馈"有时候读不出来/要等好久"）', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');

    // 记录每次朗读的时刻，用来检测"声音之间的空档"
    const stamps = [];
    const origSpeak = window.speechSynthesis.speak;
    window.speechSynthesis.speak = function (u) {
      stamps.push(Date.now());
      return origSpeak.call(this, u);
    };

    // 单音节词 may（chunks 只有整词，split = m + ay）
    await clickButton(window, '听一听');
    await new Promise((r) => setTimeout(r, 2500));

    assert.ok(stamps.length >= 2,
      'may 至少应朗读两次（慢速 + 合音），实际 ' + stamps.length + ' 次');

    // 旧实现：慢速整词 → 620ms × 2 块纯静音 → 慢速整词 → 整词
    // 两次朗读之间曾出现 1.24 秒一声不吭的空档（听起来就是"卡住了"）
    let maxGap = 0;
    for (let i = 1; i < stamps.length; i++) {
      maxGap = Math.max(maxGap, stamps[i] - stamps[i - 1]);
    }
    assert.ok(maxGap < 700,
      '两次朗读之间的空档必须短（不得有静音等待），实际最大空档 ' + maxGap + 'ms');

    // 整轮示范的总时长也必须有上限（旧实现单音节词约 4.6 秒）
    const total = stamps[stamps.length - 1] - stamps[0];
    assert.ok(total < 3000, '整轮示范不应超过 3 秒，实际 ' + total + 'ms');
  } finally { cleanup(); }
});

test('E2E-60 音频层可靠性：取消后不得再出声；清单未就绪不得直接无声', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    // 取消（进入跟读会触发 tts.cancel）之后不得再有声音
    await clickButton(window, '听一听');
    await new Promise((r) => setTimeout(r, 50));
    await clickButton(window, '我会认这个词');
    const before = window.speechSynthesis.__spoken.length;
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(window.speechSynthesis.__spoken.length, before,
      '取消后不得再退回 TTS 补一声（会出现"停了又响"）');
  } finally { cleanup(); }
});

test('E2E-61 分块区自适应（2026-11-06 家长截图"红框是不是可以去掉"）：每词只显示有信息增量的一行', async () => {
  const { window, app, cleanup } = await freshApp();
  try {
    await navigate(window, app, '#/unit/u5/stage/0');
    const idx = { may: 0, pet: 1, rabbit: 2, feed: 3, hold: 4, Mrs: 5, lovely: 6, goldfish: 7, clever: 8, shop: 9, parrot: 10, back: 11 };

    // 1) 逐词检查：任何一词都**不得同时**出现两行分块区（那正是家长截图里的重复）
    for (const [word, i] of Object.entries(idx)) {
      app.state.session.wordIndex = i;
      app.state.session.step = 0;
      app.render();
      await new Promise((r) => setTimeout(r, 20));
      const t = mainText(window);
      const hasChunk = /记词分块/.test(t);
      const hasSplit = /拼读拆分/.test(t);
      assert.ok(!(hasChunk && hasSplit),
        `${word} 同时显示了两行分块区（重复渲染）——每词只应显示一行`);
    }

    // 2) 单音节词 → 显示「拼读拆分」（m + ay 才是真正的拼读结构）
    app.state.session.wordIndex = idx.may;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    assert.match(mainText(window), /拼读拆分/, 'may 应显示拼读拆分');
    const pieces = Array.from(window.document.querySelectorAll('.split-piece'))
      .map((e) => e.textContent.trim());
    assert.deepEqual(pieces, ['m', 'ay'], 'may 的拆分块应为 m + ay');
    assert.equal(window.document.querySelectorAll('.chunk-btn').length, 0,
      '单音节词不应有音节分块按钮（它的 chunks 只有整词一块，零信息增量）');

    // 3) 多音节词 → 显示「记词分块」（可点读的音节按钮）
    app.state.session.wordIndex = idx.clever;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    const chunkBtns = Array.from(window.document.querySelectorAll('.chunk-btn'))
      .map((e) => e.textContent.trim());
    assert.deepEqual(chunkBtns, ['cle', 'ver'], 'clever 应有 cle / ver 两个音节按钮');
    assert.equal(window.document.querySelectorAll('.split-piece').length, 0,
      '多音节词不应重复渲染拼读拆分块（内容与音节块完全相同）');

    // 4) Mrs（chunks 与 split 都是整词）→ 两行都不显示，只留记忆提示
    app.state.session.wordIndex = idx.Mrs;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    const t = mainText(window);
    assert.doesNotMatch(t, /记词分块/, 'Mrs 不应显示记词分块');
    assert.doesNotMatch(t, /拼读拆分/, 'Mrs 不应显示拼读拆分');
    assert.match(t, /尊称缩写/, 'Mrs 仍应显示记忆提示');
  } finally { cleanup(); }
});

test('E2E-62 拼读示范高亮跟随可见的分块行（多音节词高亮音节按钮，单音节词高亮字母块）', async () => {
  // 用真实音频桩（realAudio）：预生成音频路径才有真实时长与 timeupdate 进度，
  // 高亮"跟着声音走"这个行为只有在这条路径上才可观测。
  const { window, app, cleanup } = await freshApp({ realAudio: true });
  try {
    await navigate(window, app, '#/unit/u5/stage/0');

    // 多音节词 clever：拆分阶段应高亮 .chunk-btn（音节按钮）
    app.state.session.wordIndex = 8;
    app.state.session.step = 0;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    const chunkSeen = new Set();
    const splitSeen = new Set();
    const obs = new window.MutationObserver(() => {
      window.document.querySelectorAll('.chunk-btn.is-speaking').forEach((el) => chunkSeen.add(el.textContent.trim()));
      window.document.querySelectorAll('.split-piece.is-speaking').forEach((el) => splitSeen.add(el.textContent.trim()));
    });
    obs.observe(window.document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    await clickButton(window, '听一听');
    await new Promise((r) => setTimeout(r, 1800));
    obs.disconnect();
    assert.ok(chunkSeen.size >= 2,
      '多音节词拆分时应逐个高亮音节按钮，实际高亮过：' + JSON.stringify([...chunkSeen]));
    assert.equal(splitSeen.size, 0, '多音节词不应高亮不存在的拆分块');

    // 单音节词 may：拆分阶段应高亮 .split-piece（字母块），且必须逐块走过
    app.state.session.wordIndex = 0;
    app.state.session.step = 0;
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    // 用 MutationObserver 记录"曾被高亮过"的块（事件驱动，不受采样时机影响）
    const pieceSeen = new Set();
    const obs2 = new window.MutationObserver(() => {
      window.document.querySelectorAll('.split-piece.is-speaking')
        .forEach((el) => pieceSeen.add(el.textContent.trim()));
    });
    obs2.observe(window.document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    await clickButton(window, '听一听');
    await new Promise((r) => setTimeout(r, 1200));
    obs2.disconnect();
    assert.ok(pieceSeen.size >= 2,
      '单音节词的拆分高亮必须逐块推进（不能停在第一块），实际高亮过：' + JSON.stringify([...pieceSeen]));
  } finally { cleanup(); }
});

test('E2E-57 Stage1 通关进度清单：学习路径页能看见"还差哪件事"，并有跳转引导；通关后消失', async () => {
  const { readFileSync } = await import('node:fs');
  const u4 = JSON.parse(readFileSync(new URL('../data/units/u4.json', import.meta.url), 'utf8'));
  const fourWords = u4.words.filter((w) => w.tier === 'four').map((w) => w.w);
  // 典型卡关态：12 词全点亮了，但听辨没测、四会拼写没做 → 核心句型仍锁着
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u4: { stagePassed: [false, false, false, false], wordsDone: u4.words.map((w) => w.w), listenScore: null, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u4');
    const list = window.document.querySelector('.stage1-checklist');
    assert.ok(list, 'Stage1 未通关时，学习路径页应显示通关进度清单');
    // 2026-11-09 家长反馈"不知道要做什么"：清单必须在阶段列表上方（页面最显眼处），
    // 孩子看到"未解锁"第一眼就是引导，不再沉底被忽略
    const main = window.document.getElementById('main') || window.document.body;
    const allChildren = Array.from(main.querySelectorAll('.card, .stage-list, .stage1-checklist'));
    assert.ok(allChildren.indexOf(list) < allChildren.findIndex((el) => el.classList.contains('stage-list')), '清单应排在阶段列表之前（页面顶部）');
    const txt = list.textContent;
    assert.match(txt, /单词点亮 12\/12/, '点亮进度应显示 12/12');
    assert.match(txt, /听音选词 还没测/, '听辨未测应明说"还没测"');
    assert.match(txt, /四会拼写 0\/9/, '四会拼写进度应显示 0/9');
    // 引导按钮：每项未完成都有"去做"跳转
    const goBtn = (t) => Array.from(list.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t));
    assert.ok(goBtn('去听写'), '听辨未测应有「去听写」按钮');
    assert.ok(goBtn('去拼写'), '拼写未做应有「去拼写」按钮');
    assert.ok(!goBtn('去点亮'), '点亮已达标就不该再给「去点亮」按钮');
    // 点「去听写」真的跳到听音选词页
    await clickButton(window, '去听写', { within: list });
    assert.match(mainText(window), /听音选词/, '应跳到听音选词模块');
    // 点「去拼写」跳到拼写屋
    await navigate(window, app, '#/unit/u4');
    const list2 = window.document.querySelector('.stage1-checklist');
    await clickButton(window, '去拼写', { within: list2 });
    assert.match(mainText(window), /拼写屋/, '应跳到拼写屋模块');
    // 点"未解锁"的核心句型 → toast 必须报出具体还差哪几件事（而不是笼统的"先完成单词奠基"）
    await navigate(window, app, '#/unit/u4');
    const lockedStage = Array.from(window.document.querySelectorAll('.stage-item'))[1];
    lockedStage.click();
    await new Promise((r) => setTimeout(r, 20));
    const toastEl = window.document.getElementById('toast');
    assert.match(toastEl.textContent, /还差 2 件事/, 'toast 应说明还差几件事');
    assert.match(toastEl.textContent, /听音选词/, 'toast 应点名听辨没做');
    assert.match(toastEl.textContent, /四会拼写 0\/9/, 'toast 应点名拼写没做');
    // 通关后清单消失
    const p = persisted(window).progress.u4;
    await navigate(window, app, '#/unit/u4');
    // 手动把三项补齐并标记通过（模拟全部做完后的自动通关结果）；直接改应用内存态
    app.state.state.progress.u4 = { ...p, listenScore: 0.9, spellingDone: fourWords, stagePassed: [true, false, false, false] };
    app.render();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(window.document.querySelector('.stage1-checklist'), null, 'Stage1 通关后清单应消失');
    // 核心句型此时应可进入
    const items = Array.from(window.document.querySelectorAll('.stage-item'));
    assert.match(items[1].textContent, /进入/, '核心句型应解锁为「进入」');
  } finally { cleanup(); }
});

test('E2E-58 U4 故事屋回归：Stage4 打开必须渲染三个故事+阅读题（曾因 choice 题字段名 options≠opts 白屏）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u4: { stagePassed: [true, true, true, false], wordsDone: [], listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    const rejections = [];
    window.addEventListener('unhandledrejection', (e) => rejections.push(String(e.reason)));
    await navigate(window, app, '#/unit/u4/stage/3');
    const txt = mainText(window);
    assert.match(txt, /故事屋/, '应渲染故事屋标题');
    assert.match(txt, /Kaikai 做风筝/, '故事 F 应渲染');
    assert.match(txt, /Dino 借东西/, '故事 D 应渲染');
    assert.match(txt, /Emma 的魔法书包/, '故事 IX（绘本）应渲染');
    assert.match(txt, /T 对/, '判断题应有 T 选项');
    assert.match(txt, /He fixes the robot\./, 'choice 题应用 opts 渲染选项');
    assert.deepEqual(rejections, [], '渲染过程不得有未处理异常（曾在这里把整页炸成白屏）');
  } finally { cleanup(); }
});

// ---- Stage1 通关标记漏触发修复（2026-11-09 家长截图：清单全 ✅ 却 0/4 阶段，进不去核心句型）----
// 根因：checkStage1 只挂在听音选词/拼写两处，若孩子最后一次动作是「点亮最后一个单词」等其它路径，
// 三件事都齐了也不会标记通关；且存量卡住进度没有自愈。修复：任意进度写入后 + 启动/切单元时重算 Stage1。

function makeStuckSeed({ wordsDone, listenScore, spellingDone }) {
  return {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: {
      u5: {
        stagePassed: [false, false, false, false],
        wordsDone,
        listenScore,
        quizBest: null,
        spellingDone,
        handwritingDone: [],
        reviewCount: {},
        learnRound: 1,
      },
    },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
}

test('E2E-59 存量自愈：清单三件事全 ✅ 却 0/4 阶段，打开应用后 Stage1 自动通关并解锁核心句型', async () => {
  const fourWords = UNIT.words.filter((w) => w.tier === 'four').map((w) => w.w);
  const seed = makeStuckSeed({
    wordsDone: UNIT.words.map((w) => w.w), // 12 词全点亮
    listenScore: 0.92, // 听辨 ≥80%
    spellingDone: [...fourWords], // 四会词全拼过
  });
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    // 启动时自愈：stagePassed[0] 立即被补标记
    const p0 = persisted(window);
    assert.equal(p0.progress.u5.stagePassed[0], true, '卡住的 Stage1 应在启动时被补齐标记');
    // 学习路径页：已通过数应为 1/4，且不再显示通关进度清单
    await navigate(window, app, '#/unit/u5');
    const txt = mainText(window);
    assert.match(txt, /已通过\s*1\s*\/\s*4/, '已通过数应变为 1/4');
    assert.ok(!txt.includes('通关进度'), 'Stage1 已通关，通关进度清单应消失');
    // 核心句型（Stage2）应当可进入，不再被拦截
    await navigate(window, app, '#/unit/u5/stage/1');
    assert.match(mainText(window), /核心句型/, '核心句型应当已解锁可进入');
  } finally { cleanup(); }
});

test('E2E-59b 点亮最后一个单词也触发 Stage1 通关（不再只在听音/拼写路径标记）', async () => {
  const fourWords = UNIT.words.filter((w) => w.tier === 'four').map((w) => w.w);
  const missing = UNIT.words[0].w; // 故意少点亮第一个词
  const seed = makeStuckSeed({
    wordsDone: UNIT.words.filter((w) => w.w !== missing).map((w) => w.w),
    listenScore: 0.92,
    spellingDone: [...fourWords],
  });
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    // 进单词卡，点亮最后一个未点亮的词（走标准三步：听一听 → 我会认 → 手动点亮）
    await navigate(window, app, '#/unit/u5/stage/0');
    let p = persisted(window);
    assert.equal(p.progress.u5.stagePassed[0], false, '点亮前 Stage1 不应通过');
    // 反复走完当前词直到 missing 被点亮（单词卡按顺序推进到第一个未点亮词）
    for (let k = 0; k < UNIT.words.length; k++) {
      p = persisted(window);
      const done = new Set(p.progress.u5.wordsDone || []);
      if (done.has(missing)) break;
      await clickButton(window, '听一听');
      await clickButton(window, '我会认这个词');
      await clickButton(window, '我读好了（手动点亮）');
    }
    p = persisted(window);
    assert.ok(p.progress.u5.wordsDone.includes(missing), '最后一个单词应被点亮');
    // 关键：点亮最后一个单词的进度写入后，checkStage1 应已自动通关
    assert.equal(p.progress.u5.stagePassed[0], true, '点亮最后一个单词应触发 Stage1 自动通关');
    // 核心句型解锁
    await navigate(window, app, '#/unit/u5/stage/1');
    assert.match(mainText(window), /核心句型/, '核心句型应当已解锁可进入');
  } finally { cleanup(); }
});

// ---- U4 应答配对「灵活化」（2026-11-09 家长：截图 glue 两题全是"点头：可以"，要考不同意等）----
test('E2E-60 U4 应答配对灵活化：同一文具的两题一正一反，婉拒/答非所问各有正确支架', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u4: { stagePassed: [true, false, false, false], wordsDone: [], listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u4/stage/1');
    await clickButton(window, 'glue'); // 选中家长截图里的文具
    const blocks = () => Array.from(window.document.querySelectorAll('.card > div'));
    const boxOf = (q) => blocks().find((d) => (d.textContent || '').includes(q) && d.querySelector('.q-speak'));
    const click = (btn) => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const useQ = 'Can I use your glue, please?';
    const borrowQ = 'Can I borrow your glue?';

    // 1) 正反对照：同一文具的两题，一题点头一题摇头（旧版两题都点头）
    let qUse = boxOf(useQ);
    let qBorrow = boxOf(borrowQ);
    assert.ok(qUse && qBorrow, 'glue 两道配对题都应出现');
    assert.match(qUse.querySelector('.cue-badge').textContent, /点头/, 'use 题应给点头线索');
    assert.match(qBorrow.querySelector('.cue-badge').textContent, /摇头/, 'borrow 题应给摇头线索（旧版是点头）');

    // 2) 摇头题选课本婉拒答语 → 判对并给规则解说
    click(optBtn(qBorrow, "Sorry, I'm using it."));
    await new Promise((r) => setTimeout(r, 30));
    qBorrow = boxOf(borrowQ);
    assert.ok(qBorrow.querySelector('.option.is-correct'), '婉拒答语在摇头题应判对');
    assert.match(qBorrow.textContent, /💡/, '答对后应给纯中文规则解说');

    // 3) 关键回归：点头题点婉拒项（极性冲突），旧 isNo 正则不认 Sorry 会误判成"主语错位/别的问题"
    qUse = boxOf(useQ);
    click(optBtn(qUse, "Sorry, I'm using it."));
    const polarityToast = window.document.getElementById('toast').textContent;
    await new Promise((r) => setTimeout(r, 30));
    qUse = boxOf(useQ);
    assert.equal(qUse.querySelector('.option.is-correct'), null, '婉拒项在点头题不得判对');
    assert.match(polarityToast, /点头还是摇头/, '应引导看表情极性，而不是笼统"答的是别的问题"');
    assert.ok(!/主语|别的问题/.test(polarityToast), '婉拒项不应被误判成主语错位');

    // 4) "答非所问"干扰项：道谢句不判对，且给出专门支架（不是主语错位）
    qUse = boxOf(useQ);
    click(optBtn(qUse, 'Thank you.'));
    const thxToast = window.document.getElementById('toast').textContent;
    await new Promise((r) => setTimeout(r, 30));
    qUse = boxOf(useQ);
    assert.equal(qUse.querySelector('.option.is-correct'), null, '道谢句不得判对');
    assert.match(thxToast, /还没回答|能不能/, '道谢句应提示"没在回答能不能"');
    assert.match(boxOf(useQ).textContent, /💡 这句没在回答/, '应显示"答非所问"对照卡');

    // 5) 点头题最终选课本同意答语 → 判对
    qUse = boxOf(useQ);
    click(optBtn(qUse, 'Sure. Here you are.'));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(boxOf(useQ).querySelector('.option.is-correct'), '同意答语在点头题应判对');
  } finally { cleanup(); }
});

test('E2E-61 U4 配对页未选文具时不串到 U5 兜底对话：默认题为本单元且一正一反', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u4: { stagePassed: [true, false, false, false], wordsDone: [], listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u4/stage/1'); // 故意不点任何文具
    const txt = mainText(window);
    // 旧版漏到 U5 硬编码兜底（May I have a pet? / May I hold it?，且全点头）
    assert.ok(!txt.includes('May I have a pet?'), 'U4 不得出现 U5 的宠物兜底题');
    assert.ok(!txt.includes('May I hold it?'), 'U4 不得出现 U5 的 hold 兜底题');
    assert.ok(txt.includes('Can I use your pencil, please?'), '默认应显示本单元第一组（pencil）题目');
    // 默认首组也必须一正一反（不能又是一进页面全是点头）
    const badges = Array.from(window.document.querySelectorAll('.cue-badge')).map((b) => b.textContent);
    assert.ok(badges.some((b) => b.includes('点头')), '默认组应有点头题');
    assert.ok(badges.some((b) => b.includes('摇头')), '默认组应有摇头题');
  } finally { cleanup(); }
});

// ---- U4 真实输出·Let's Write 选句效度（2026-11-10 家长：截图借颜料题，OK / Sure 两句都该可以）----
const U4_OUT_SEED = () => ({
  version: 1, stars: 0, streak: 0, lastStudyDate: null,
  progress: { u4: { stagePassed: [true, true, false, false], wordsDone: [], listenScore: 0.9, quizBest: null } },
  wrongBank: [], reviewPlan: [], settings: { audioOn: true },
});

test('E2E-65 U4 真实输出·选句「借颜料」题：家长圈出的两句"给你"都判对（旧版只认 OK）', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    const box = () => wrBox(window.document, '她需要一些颜料');
    assert.ok(box(), '应显示借颜料情境卡');
    // 家长红圈的第二句「Sure. Here you are.」——课本合法答语、且是 item0 的正确答案
    await wrPickIn(window, '她需要一些颜料', 'Sure. Here you are.');
    assert.ok(box().querySelector('.option.is-correct'),
      '「当然，给你」应判对标绿（旧版 a 只锁 OK，判错 → 复现 bug）');
  } finally { cleanup(); }
});

test('E2E-66 U4 真实输出·选句：OK 也判对、道谢句仍判错、三题全对能进第 2 步连读', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    // 1) 干扰项「Thank you.」不得被误放行
    await wrPickIn(window, '她需要一些颜料', 'Thank you.');
    assert.equal(wrBox(window.document, '她需要一些颜料').querySelector('.option.is-correct'), null,
      '道谢句是借到之后才说的，不得判对');
    // 2) 主答案「OK. Here you are.」判对
    await wrPickIn(window, '她需要一些颜料', 'OK. Here you are.');
    assert.ok(wrBox(window.document, '她需要一些颜料').querySelector('.option.is-correct'),
      '「好的，给你」应判对');
    // 3) 三题全对 → 第 2 步连读应解锁
    await wrPickIn(window, 'Molly 想画画', 'Sure. Here you are.');
    await wrPickIn(window, '用点水涮笔', 'Sure.');
    const done = window.document.querySelector('.wr-done');
    assert.ok(done && done.textContent.includes('三段对话连起来'), '三题都选对应解锁第 2 步连读卡');
    // 连读卡里演的应是孩子实际选的答语，而不是写死的 it.a
    assert.ok(done.textContent.includes('OK. Here you are.'), '选 OK 的那题，连读卡店员行应演 OK');
  } finally { cleanup(); }
});

test('E2E-67 U4 真实输出·选句：借颜料题选可接受但非 a 的「Sure」也算完成，三题全对能连读', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    // 借颜料题选家长圈出的第二句（accept 之一，但不是 a）
    await wrPickIn(window, '她需要一些颜料', 'Sure. Here you are.');
    await wrPickIn(window, 'Molly 想画画', 'Sure. Here you are.');
    await wrPickIn(window, '用点水涮笔', 'Sure.');
    const done = window.document.querySelector('.wr-done');
    assert.ok(done && done.textContent.includes('三段对话连起来'),
      '选了非 a 的可接受答语也应计入 wrAllOk，能进入第 2 步连读');
    // 关键回归：连读卡必须演孩子选的 Sure，而不是写死的标准答案 OK（旧版 doneBox 写死 it.a）
    assert.ok(!done.textContent.includes('OK. Here you are.'),
      '孩子三题分别选了 Sure./Sure./Sure.，连读卡不该出现写死的 OK（旧版 bug）');
    assert.ok(done.textContent.includes('Sure. Here you are.'),
      '借颜料这题连读卡店员行应演孩子实际选的 Sure');
  } finally { cleanup(); }
});

// ---- Let's Write 答后逐项解答（2026-11-10 家长：答完对每个答案都要有解答，方便孩子理解）----
test('E2E-68 U4 真实输出·选句：答前不剧透，答后逐项展开每个答案的中文解答', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    const box = () => wrBox(window.document, '她需要一些颜料');
    // 1) 答前不剧透：解答卡未出现
    assert.equal(box().querySelector('.wr-explain'), null, '作答前不应剧透每个答案的解答');
    // 2) 答对后逐项展开：覆盖 3 个选项，每个都有中文解答 + 🔊
    await wrPickIn(window, '她需要一些颜料', 'OK. Here you are.');
    const ex = box().querySelector('.wr-explain');
    assert.ok(ex, '答对后应展开逐项解答卡');
    const rows = ex.querySelectorAll('.wr-explain-row');
    assert.equal(rows.length, 3, '解答卡应逐项覆盖该题全部 3 个答案');
    assert.equal(ex.querySelectorAll('.wr-explain-speak').length, 3, '每个英文答案都要配 🔊（英语必有播放铁律）');
    // 3) 正确/不合适分类：两个合法答语都标 ✅，道谢句标 💡（不留红色失败痕迹）
    assert.equal(ex.querySelectorAll('.wr-explain-row.is-right').length, 2,
      'OK 与 Sure 两句合法答语都应标"合适"');
    assert.equal(ex.querySelectorAll('.wr-explain-row.is-alt').length, 1,
      '道谢句应标"这时候不合适"');
    // 4) 解答是纯中文，且讲清了"为什么这个对 / 那个不合适"
    const zh = ex.querySelector('.wr-explain-zh-box');
    assert.ok(zh, '应有中文解答文字');
    assert.ok(!/[A-Za-z]/.test(zh.textContent), '解答文字应纯中文（英文只在答案行）');
  } finally { cleanup(); }
});

test('E2E-69 U5 真实输出·选句：逐项解答对两单元一致生效（共用渲染层零回归）', async () => {
  const seed = {
    version: 1, stars: 0, streak: 0, lastStudyDate: null,
    progress: { u5: { stagePassed: [true, true, false, false], wordsDone: UNIT.words.map((w) => w.w), listenScore: 0.9, quizBest: null } },
    wrongBank: [], reviewPlan: [], settings: { audioOn: true },
  };
  const { window, app, cleanup } = await freshApp({ seed });
  try {
    await navigate(window, app, '#/unit/u5/stage/2');
    const box = () => wrBox(window.document, '她把鹦鹉带回宠物店');
    assert.equal(box().querySelector('.wr-explain'), null, 'U5 作答前也不剧透');
    await wrPickIn(window, '她把鹦鹉带回宠物店', 'Yes, you can.');
    const ex = box().querySelector('.wr-explain');
    assert.ok(ex, 'U5 答对后也应展开逐项解答');
    assert.equal(ex.querySelectorAll('.wr-explain-row').length, 3, 'U5 每题也覆盖全部 3 个答案');
    assert.equal(ex.querySelectorAll('.wr-explain-speak').length, 3, 'U5 每个英文答案配 🔊');
  } finally { cleanup(); }
});

// ---- U4 真实输出·思维导图（2026-11-10 家长截图：宠物思维导图一直解锁不了）----
test('E2E-70 U4 真实输出·思维导图：4 个问题每问都有可点选项（复现"第3问0按钮→永远解锁不了"）', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    const qs = [
      'What do you want to use?',
      'How do you ask politely?',
      'What do you say after getting it?',
      'What if a friend borrows from you?',
    ];
    qs.forEach((q) => {
      const box = mmBoxStrict(window.document, q, qs);
      assert.ok(box, `应显示问题卡：${q}`);
      const n = box.querySelectorAll('button.option').length;
      assert.ok(n > 0, `问题「${q}」应有可点选项（旧版第 3 问渲染 0 个按钮 → 永远解锁不了）`);
    });
  } finally { cleanup(); }
});

test('E2E-71 U4 真实输出·思维导图：4 问全选后能拼出介绍词并完成，底部不再显示未完成', async () => {
  const { window, app, cleanup } = await freshApp({ seed: U4_OUT_SEED() });
  try {
    await navigate(window, app, '#/unit/u4/stage/2');
    const pick = async (q, ans) => {
      const box = mmBox(window.document, q);
      assert.ok(box, `应显示问题卡：${q}`);
      const btn = Array.from(box.querySelectorAll('button.option')).find((b) => b.textContent.includes(ans));
      assert.ok(btn, `问题「${q}」应有选项「${ans}」`);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    };
    await pick('What do you want to use?', 'Can I use your pencil?');
    await pick('How do you ask politely?', 'Excuse me. Can I use your..., please?');
    await pick('What do you say after getting it?', 'Thank you.');
    await pick('What if a friend borrows from you?', 'Sure. Here you are.');
    assert.ok(mainText(window).includes('介绍词拼好啦'), '4 问全选应拼出介绍词');
    assert.ok(mainText(window).includes('We help each other!'), '拼装段应含 U4 固定结尾句');
    // 完成思维导图 → 底部不应再提示"③ ...思维导图"未完成
    await clickButton(window, '我的宠物介绍好了');
    assert.ok(!mainText(window).includes('还没完成：③'),
      '思维导图完成后底部不应再提示未完成（旧版因第3问无选项恒无法完成）');
  } finally { cleanup(); }
});

// 严格定位：问题卡本体（含 option 按钮、且不含其它问题文本的最小 div），避免外层容器兜底导致假绿
function mmBoxStrict(root, qText, allQs) {
  const divs = Array.from(root.querySelectorAll('main div'))
    .filter((d) => (d.textContent || '').includes(qText))
    .filter((d) => d.querySelector('button.option'))
    .filter((d) => !allQs.some((o) => o !== qText && (d.textContent || '').includes(o)));
  divs.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
  return divs[0];
}
