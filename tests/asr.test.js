// 本地识别模型加载策略测试：手机/弱网不得自动下载 41MB 模型
// 背景（2026-11-03 家长反馈）：手机打开页面后 5 秒即后台下载 41MB onnx，
// 弱网下带宽占满，页面表现像卡死/打不开。修复后仅桌面+好网络自动预热，
// 手机改为点"🎤 我来读"时按需加载。
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoLoad } from '../js/services/local-asr.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

test('ASR-1 手机/平板不自动下载模型（旧行为会下载 41MB → 页面像卡死）', () => {
  assert.equal(shouldAutoLoad({ userAgent: IPHONE }), false, 'iPhone 不应自动下载');
  assert.equal(shouldAutoLoad({ userAgent: ANDROID }), false, '安卓不应自动下载');
  assert.equal(shouldAutoLoad({ userAgent: IPAD }), false, 'iPad 不应自动下载');
});

test('ASR-2 桌面端普通网络允许后台预热（保留离线打分能力）', () => {
  assert.equal(shouldAutoLoad({ userAgent: MAC }), true, 'Mac 桌面应允许预热');
  assert.equal(shouldAutoLoad({ userAgent: WIN }), true, 'Windows 桌面应允许预热');
});

test('ASR-3 省流量模式 / 2G-3G / 无法判定 一律不下载', () => {
  assert.equal(shouldAutoLoad({ userAgent: MAC, connection: { saveData: true, effectiveType: '4g' } }),
    false, '开启省流量不得下载');
  assert.equal(shouldAutoLoad({ userAgent: MAC, connection: { saveData: false, effectiveType: '3g' } }),
    false, '3G 不得下载');
  assert.equal(shouldAutoLoad({ userAgent: MAC, connection: { effectiveType: '2g' } }),
    false, '2G 不得下载');
  assert.equal(shouldAutoLoad(null), false, '无环境（null）不得下载');
  assert.equal(shouldAutoLoad({}), false, '拿不到 UA 不得下载（保守）');
  // 正反对照：4G 桌面 + 未开省流量 → 允许
  assert.equal(shouldAutoLoad({ userAgent: MAC, connection: { saveData: false, effectiveType: '4g' } }),
    true, '4G 桌面应允许预热');
});
