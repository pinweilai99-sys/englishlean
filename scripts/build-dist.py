#!/usr/bin/env python3
# 构建部署产物 docs/（带缓存版本号）
# 每次发布前运行：python3 scripts/build-dist.py
# 作用：
#   1. 复制运行时文件到 docs/
#   2. 给 index.html 与所有内部模块引用注入 ?v=时间戳 —— URL 一变浏览器必定拉新，
#      彻底解决"网页更新后刷新还是旧版"的缓存问题
#   3. vendor（transformers.min.js / ort wasm）不加版本参数，让其长期缓存
import re, shutil, time, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'docs')
VER = str(int(time.time()))

# 1) 清空并复制运行时文件
if os.path.exists(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)
for item in ['index.html', 'styles', 'js', 'data', 'models']:
    src = os.path.join(ROOT, item)
    dst = os.path.join(DIST, item)
    if os.path.isdir(src):
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)

# 1.5) 写 .nojekyll：本项目是纯静态站（含二进制 .onnx 模型 + 大量 JS 模块），
#      不使用 Jekyll。缺此文件时 GitHub Pages 默认跑 Jekyll，可能漏发/改动资源。
#      加空 .nojekyll 让 Pages 原样托管 docs/ 全部文件。
open(os.path.join(DIST, '.nojekyll'), 'w').close()

# 2) index.html：css/js 引用加版本（vendor 除外）
idx_path = os.path.join(DIST, 'index.html')
idx = open(idx_path, encoding='utf-8').read()
idx = re.sub(r'(href="styles/[^"]+\.css)"', rf'\1?v={VER}"', idx)
idx = re.sub(r'(src="js/app\.js)"', rf'\1?v={VER}"', idx)
open(idx_path, 'w', encoding='utf-8').write(idx)

# 3) js 模块：相对 import 加版本（vendor 目录跳过）
count = 0
for dirpath, _, files in os.walk(os.path.join(DIST, 'js')):
    if 'vendor' in dirpath:
        continue
    for fn in files:
        if not fn.endswith('.js'):
            continue
        p = os.path.join(dirpath, fn)
        src = open(p, encoding='utf-8').read()
        # import ... from './x.js' 或 import('./x.js') —— 相对路径且未带 query
        new = re.sub(r"(from\s+|import\()(\s*)('(\.\.?/[^']+)\.js')",
                     rf"\1\2'\4.js?v={VER}'", src)
        if new != src:
            count += len(re.findall(rf"\.js\?v={VER}'", new))
            open(p, 'w', encoding='utf-8').write(new)

print(f"✅ dist 构建完成  版本 v={VER}  注入引用 {count} 处")
print(f"   产物: {DIST}")
