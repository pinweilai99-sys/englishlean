import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('必要文件均存在', () => {
  ['index.html', 'package.json', '.gitignore',
    'styles/tokens.css', 'styles/app.css',
    'js/app.js', 'js/core/storage.js', 'js/core/progress.js',
    'js/core/scoring.js', 'js/core/scheduler.js', 'js/core/validate.js',
    'data/units/u5.json',
  ].forEach((f) => {
    assert.ok(existsSync(join(root, f)), `缺少文件: ${f}`);
  });
});

test('index.html 挂载了关键节点与模块入口', () => {
  const html = read('index.html');
  assert.match(html, /id="app"/);
  assert.match(html, /id="topbar"/);
  assert.match(html, /id="main"/);
  assert.match(html, /id="floatbar"/);
  assert.match(html, /js\/app\.js/);
  assert.match(html, /styles\/tokens\.css/);
  assert.match(html, /styles\/app\.css/);
});

test('package.json 为 ESM 且定义了 test 脚本', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /node --test/);
});

test('.gitignore 忽略 .workbuddy 与 node_modules', () => {
  const gi = read('.gitignore');
  assert.match(gi, /\.workbuddy\//);
  assert.match(gi, /node_modules\//);
});
