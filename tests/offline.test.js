// 离线单文件交付测试（2026-11-13 家长：打开 U6 提示「加载失败」）
//
// 根因：scripts/build-offline.mjs 把内嵌单元写死成 u4/u5，新增 U6 后离线包里没有 u6 数据；
// file:// 下浏览器默认不允许 fetch 本地文件 → 垫片未命中 → 退真实 fetch → Failed to fetch
// → app.js 显示「😢 加载失败」。上一轮只校验「HTML 里出现 U6 字样」（来自打包 JS/音频 base64）
// 属假绿，本测试直接验证 __EMBED__.units 的内容与垫片运行时行为。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'englishlean-offline.html'), 'utf8');
const unitsDir = join(root, 'docs/data/units');

// 抽出离线垫片脚本（__EMBED__ 赋值 + IIFE）：
// <script> 与 window.__EMBED__ 之间有换行，不能用 "<script>(window..." 硬匹配（踩过一次，
// 报错「找不到垫片 script 块」是测试自身的假红，必须先修掉才能如实复现 bug）。
function shimScript() {
  const start = html.indexOf('window.__EMBED__ = ');
  assert.ok(start > 0, '离线包里找不到 __EMBED__ 赋值');
  const end = html.indexOf('</script>', start);
  assert.ok(end > start, '垫片 script 块没有闭合');
  const code = html.slice(start, end);
  assert.ok(code.includes('window.fetch = function'), '抽出的不是垫片代码');
  return code;
}

function embedded() {
  const m = shimScript().match(/window\.__EMBED__ = (\{[\s\S]*?\});\n\(function/);
  assert.ok(m, '垫片里找不到 __EMBED__ 定义');
  return JSON.parse(m[1]);
}

describe('离线单文件必须内嵌全部单元（2026-11-13 修复）', () => {
  test('OFF-1 内嵌单元集合 = docs/data/units 下全部 json（禁止写死 u4/u5）', () => {
    const ids = readdirSync(unitsDir).filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')).sort();
    const units = embedded().units;
    assert.deepEqual(Object.keys(units).sort(), ids,
      `离线包内嵌单元与 docs 不一致：内嵌 ${Object.keys(units).join(',')} / 应有 ${ids.join(',')}`);
    assert.ok(units.u6, '离线包必须内嵌 u6（否则安卓平板点 U6 会「加载失败」）');
  });

  test('OFF-2 每个内嵌单元与 docs 源数据完全一致（不是空壳/旧版）', () => {
    const units = embedded().units;
    for (const [id, data] of Object.entries(units)) {
      const src = JSON.parse(readFileSync(join(unitsDir, `${id}.json`), 'utf8'));
      assert.deepEqual(data, src, `离线包里的 ${id} 与 docs/data/units/${id}.json 不一致`);
    }
  });

  test('OFF-3 垫片运行时：fetch(data/units/u6.json) 命中内嵌，绝不走真实网络', async () => {
    let realFetchCalls = 0;
    const ctx = {
      window: {
        fetch: () => { realFetchCalls += 1; return Promise.reject(new Error('no network (file://)')); },
        Audio: function Audio() {},
      },
      Response: class {
        constructor(body, init) { this._body = body; this._init = init; }
        json() { return Promise.resolve(JSON.parse(this._body)); }
      },
      Promise,
    };
    vm.runInNewContext(shimScript(), ctx);
    let err = null;
    let d = null;
    try {
      const res = await ctx.window.fetch('data/units/u6.json', { cache: 'no-store' });
      d = await res.json();
    } catch (e) { err = e; }
    assert.equal(err, null,
      '垫片必须命中 u6 并返回内嵌数据；走真实 fetch 在 file:// 下必然 Failed to fetch → 「加载失败」');
    assert.equal(d?.id, 'u6', '垫片必须返回 U6 数据');
    assert.equal(d?.title, 'Which one do you want?');
    assert.equal(d?.words.length, 12);
    assert.equal(d?.quiz.length, 57);
    assert.equal(realFetchCalls, 0,
      '垫片未命中 u6 → 走了真实 fetch，file:// 下必然报「加载失败」');
  });

  test('OFF-4 离线包标题不得写死旧单元列表（避免以后再漏）', () => {
    const title = html.match(/<title>(.*?)<\/title>/)?.[1] || '';
    assert.ok(!/Unit 4 & 5/.test(title), `标题仍写死「Unit 4 & 5」：${title}`);
    assert.ok(title.includes('6'), `标题应包含已内嵌的单元号 6：${title}`);
  });

  test('OFF-5 内嵌音频必须覆盖 manifest 全部 slug（新增单元不能漏发音）', () => {
    const emb = embedded();
    const missing = emb.manifest.slugs.filter((s) => !emb.audio[s]);
    assert.deepEqual(missing, [], `离线包缺音频：${missing.slice(0, 5).join(', ')}`);
  });
});
