// 构建离线单文件 HTML：把 CSS/JS/单元数据/音频全部内嵌，
// 用垫片把 fetch(清单/单元数据) 与 Audio(m4a) 重定向到内嵌内容，
// 应用核心代码无需任何改动即可在 file:// 或任意静态服务器下离线运行。
//
// 用法：node scripts/build-offline.mjs
// 产出：englishlean-offline.html（项目根目录，自包含，可直接发给手机打开）

import { build } from '/Users/ab/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

  // 4) 单元数据 U4 + U5
  const units = {
    u4: JSON.parse(read(join(DOCS, 'data/units/u4.json'))),
    u5: JSON.parse(read(join(DOCS, 'data/units/u5.json'))),
  };

  // 5) 音频：全部 m4a -> base64 data URI，按 slug(文件名去扩展名) 建索引
  const audioDir = join(DOCS, 'assets/audio');
  const audio = {};
  for (const f of readdirSync(audioDir)) {
    if (!f.endsWith('.m4a')) continue;
    const slug = f.replace(/\.m4a$/, '');
    const b64 = readFileSync(join(audioDir, f)).toString('base64');
    audio[slug] = `data:audio/mp4;base64,${b64}`;
  }

  // 6) manifest（清单只列 slugs，离线仍用于 hasAudio 判定）
  const manifest = JSON.parse(read(join(audioDir, 'manifest.json')));

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
<title>英语乐园 · 离线版（Unit 4 & 5）</title>
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
}

main().catch((e) => { console.error(e); process.exit(1); });
