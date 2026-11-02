import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('UI 模块文件齐全', () => {
  ['js/ui/dom.js', 'js/ui/home.js', 'js/ui/unit.js', 'js/ui/wordcard.js',
    'js/ui/listen.js', 'js/ui/phonics.js', 'js/ui/sentence.js',
    'js/ui/output.js', 'js/ui/story.js', 'js/ui/recall.js', 'js/ui/parent.js',
    'js/services/tts.js', 'js/services/recorder.js', 'js/services/speech-match.js',
  ].forEach((f) => assert.ok(existsSync(join(root, f)), `缺少 ${f}`));
});

test('核心模块不引用 DOM（保证可被 node --test 引入）', () => {
  ['js/core/storage.js', 'js/core/progress.js', 'js/core/scoring.js',
    'js/core/scheduler.js', 'js/core/validate.js'].forEach((f) => {
    const src = read(f);
    assert.ok(!/\bdocument\./.test(src), `${f} 不应直接访问 document`);
    assert.ok(!/\bwindow\./.test(src), `${f} 不应直接访问 window`);
  });
});

test('app.js 挂载了路由与核心能力', () => {
  const src = read('js/app.js');
  assert.match(src, /hashchange/);
  assert.match(src, /completeStage/);
  assert.match(src, /addWrong/);
  assert.match(src, /buildReviewPlan/);
  assert.match(src, /localStorage/);
  // 错误处理：数据校验失败要有兜底提示
  assert.match(src, /validateUnit/);
  assert.match(src, /内容数据有问题/);
});

test('单词卡实现三步学习流且步骤不可跳', () => {
  const src = read('js/ui/wordcard.js');
  assert.match(src, /① 听音/);
  assert.match(src, /② 认形/);
  assert.match(src, /③ 跟读/);
  // 只有完成当前步才允许进入下一步
  assert.match(src, /session\.step = 1/);
  assert.match(src, /session\.step = 2/);
  // 跟读达标才点亮
  assert.match(src, /doneSet\.add/);
});

test('发音评分不作为解锁门槛（教育红线）', () => {
  const src = read('js/ui/wordcard.js');
  // 非 good 结果不点亮词（good 才走统一出口 completeWordStep→finishWord；else 分支只有反馈+重绘）
  assert.match(src, /if \(result\.level === 'good'\) \{\s*finishWord/);
  assert.match(src, /else \{\s*toast\(scoreFeedback/);
  // 提供手动点亮降级路径
  assert.match(src, /手动点亮/);
});

test('解锁判定在 UI 层生效：未解锁阶段显示锁定提示', () => {
  const src = read('js/app.js');
  assert.match(src, /canEnterStage/);
  assert.match(src, /这一关还没解锁/);
});

test('错误作答自动写入错题本', () => {
  const listen = read('js/ui/listen.js');
  assert.match(listen, /addWrong/);
  const quiz = read('js/ui/story.js');
  assert.match(quiz, /addWrong/);
});

test('本地数据有导出/恢复/重置三件套', () => {
  const parent = read('js/ui/parent.js');
  assert.match(parent, /exportState/);
  assert.match(parent, /importState/);
  assert.match(parent, /resetState/);
  assert.match(parent, /确认恢复|确认清空/);
});

test('复习计划按第 1/3/7 天生成并可到期推送', () => {
  const app = read('js/app.js');
  assert.match(app, /buildReviewPlan/);
  assert.match(app, /dueReviews/);
  const float = read('js/app.js');
  assert.match(float, /🔔 复习/);
});
