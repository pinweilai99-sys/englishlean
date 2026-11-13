// 构建离线单文件 HTML：把 CSS/JS/单元数据/音频全部内嵌，
// 用垫片把 fetch(清单/单元数据) 与 Audio(m4a) 重定向到内嵌内容，
// 应用核心代码无需任何改动即可在 file:// 或任意静态服务器下离线运行。
//
// 用法：node scripts/build-offline.mjs
// 产出：englishlean-offline.html（项目根目录，自包含，可直接发给手机打开）

import { build } from '/Users/ab/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS = join(ROOT, 'docs');

function read(p) { return readFileSync(p, 'utf-8'); }

async function main() {
  // 1) 打包 app.js -> IIFE（含 handwriting/ASR/transformers 等全部依赖）
  const result = await build({
    entryPoints: [join(ROOT, 'js/app.js')],
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'warning',
    loader: { '.js': 'js' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const appJs = result.outputFiles[0].text;

  // 2) CSS（用已构建的 docs/styles）
  const tokensCss = read(join(DOCS, 'styles/tokens.css'));
  const appCss = read(join(DOCS, 'styles/app.css'));

  // 3) jspdf（handwriting 依赖的全局 UMD）
  const jspdf = read(join(ROOT, 'js/vendor/jspdf.umd.min.js'));

  // 4) 单元数据：自动纳入 docs/data/units/ 下全部单元。
  // ⚠️ 2026-11-13 修复：旧版写死 u4/u5，新增 U6 后离线包里没有 u6 →
  // file:// 下 fetch('data/units/u6.json') 未命中垫片 → 退真实 fetch → Failed to fetch
  // → app.js 显示「😢 加载失败」。禁止再写死单元列表；新增单元自动进离线包。
  const unitsDir = join(DOCS, 'data/units');
  const unitIds = readdirSync(unitsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  const units = {};
  for (const id of unitIds) units[id] = JSON.parse(read(join(unitsDir, `${id}.json`)));
  const unitLabel = 'Unit ' + unitIds.map((id) => id.replace(/^u/, '')).join(' / ');

  // 5) 音频：仅清单中的 slug -> base64 data URI（避免孤儿分块音频膨胀离线包）
  const audioDir = join(DOCS, 'assets/audio');
  const manifest = JSON.parse(read(join(audioDir, 'manifest.json')));
  const audio = {};
  for (const slug of manifest.slugs) {
    const f = `${slug}.m4a`;
    const p = join(audioDir, f);
    if (!existsSync(p)) continue;
    const b64 = readFileSync(p).toString('base64');
    audio[slug] = `data:audio/mp4;base64,${b64}`;
  }

  // 6) manifest（清单只列 slugs，离线仍用于 hasAudio 判定）

  // 7) 离线垫片：重定向 fetch + Audio 到内嵌内容
  const shim = `
window.__EMBED__ = ${JSON.stringify({ units, audio, manifest })};
(function(){
  var E = window.__EMBED__;
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(u, o){
    var s = String(u);
    var m = s.match(/data\\/units\\/([\\w-]+)\\.json/);
    if (m && E.units[m[1]]) {
      return Promise.resolve(new Response(JSON.stringify(E.units[m[1]]), {headers:{'content-type':'application/json'}}));
    }
    if (/manifest\\.json/.test(s) && E.manifest) {
      return Promise.resolve(new Response(JSON.stringify(E.manifest), {headers:{'content-type':'application/json'}}));
    }
    return _fetch ? _fetch(u, o) : Promise.reject(new Error('no fetch'));
  };
  var _Audio = window.Audio;
  window.Audio = function(src){
    var real = src;
    if (typeof src === 'string') {
      var am = src.match(/assets\\/audio\\/([\\w-]+)\\.m4a/);
      if (am && E.audio[am[1]]) real = E.audio[am[1]];
    }
    return new _Audio(real);
  };
})();
`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>英语乐园 · 离线版（${unitLabel}）</title>
<style>${tokensCss}
${appCss}</style>
</head>
<body>
  <div id="app" class="app-shell">
    <header class="topbar" id="topbar"></header>
    <main class="app-main" id="main"></main>
    <nav class="floatbar" id="floatbar"></nav>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>${jspdf}</script>
  <script>${shim}</script>
  <script>${appJs}</script>
</body>
</html>`;

  const outPath = join(ROOT, 'englishlean-offline.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log('written', outPath);
  console.log('size MB =', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2));
  console.log('audio slugs embedded =', Object.keys(audio).length);
  console.log('unit ids embedded =', unitIds.join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
