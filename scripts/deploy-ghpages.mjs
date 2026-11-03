#!/usr/bin/env node
// 把仓库 docs/ 构建产物发布到 gh-pages 分支根目录，供 GitHub Pages 以「根路径」托管
// （与 yuwenleam-app 的发布形态一致：Pages source = 分支 + path "/"）。
//
// 零上传：gh-pages 的 tree 直接复用 main 提交里 docs/ 子树的 sha（同一仓库内 blob 全局共享），
// 所以 41MB 的 onnx 模型不会重传。
//
// 用法：GH_TOKEN=xxx node scripts/deploy-ghpages.mjs
// 前置：docs/ 已由 scripts/build-dist.py 生成并提交到 main（本地提交或已推送均需在远端可见）。
import { execSync } from 'node:child_process';

const TOKEN = process.env.GH_TOKEN;
const REPO = process.env.REPO || 'pinweilai99-sys/englishlean';
const SRC_PATH = process.env.SRC_PATH || 'docs';   // main 里产物目录
const TARGET_BRANCH = process.env.TARGET_BRANCH || 'gh-pages';
const API = 'https://api.github.com';

if (!TOKEN) {
  console.error('缺少 GH_TOKEN 环境变量');
  process.exit(1);
}

async function gh(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok && res.status !== 404) {
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return { status: res.status, body };
}

async function main() {
  // 1) main 最新提交（取远端，确保刚推的 docs 已可见）
  const { body: ref } = await gh(`/repos/${REPO}/git/ref/heads/main`);
  const mainSha = ref.object.sha;
  console.log('main HEAD =', mainSha.slice(0, 7));

  // 2) main 的根 tree → 找 docs 子树 sha
  const { body: mainCommit } = await gh(`/repos/${REPO}/git/commits/${mainSha}`);
  const { body: rootTree } = await gh(`/repos/${REPO}/git/trees/${mainCommit.tree.sha}`);
  const docsEntry = rootTree.tree.find((t) => t.path === SRC_PATH && t.type === 'tree');
  if (!docsEntry) throw new Error(`main 根目录没有 ${SRC_PATH}/ 子树（先构建并提交 docs）`);
  console.log(`${SRC_PATH} tree =`, docsEntry.sha.slice(0, 7));

  // 3) 现有 gh-pages 头（作为 parent，保持提交链；首次为空则孤儿提交）
  const { status: st, body: existing } = await gh(`/repos/${REPO}/git/ref/heads/${TARGET_BRANCH}`);
  const parents = st === 200 && existing?.object?.sha ? [existing.object.sha] : [];
  if (parents.length) console.log('gh-pages 上一提交 =', parents[0].slice(0, 7));

  // 4) 建提交（tree 就是 docs 子树，根路径发布）
  const message = process.env.COMMIT_MSG
    || `deploy: 根路径发布（源 main:${SRC_PATH} @ ${mainSha.slice(0, 7)}）`;
  const { body: commit } = await gh(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: docsEntry.sha, parents }),
  });
  console.log('新提交 =', commit.sha.slice(0, 7));

  // 5) 更新/创建 ref
  if (parents.length) {
    await gh(`/repos/${REPO}/git/refs/heads/${TARGET_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await gh(`/repos/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${TARGET_BRANCH}`, sha: commit.sha }),
    });
  }
  console.log(`✅ ${TARGET_BRANCH} → ${commit.sha.slice(0, 7)}（根路径，含 ${SRC_PATH}/ 全部文件）`);

  // 6) 本地 git 记录远端指针（便于 git log 对照）
  try {
    execSync(`git update-ref refs/remotes/origin/${TARGET_BRANCH} ${commit.sha}`, { stdio: 'ignore' });
  } catch { /* 非 git 环境忽略 */ }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
