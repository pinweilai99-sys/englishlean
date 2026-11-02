// 语音识别匹配：优先 SpeechRecognition 转写；不可用时降级为启发式评估
// 重要：降级路径只给"鼓励型"反馈，绝不因识别失败而阻断学习。
// 能力检测在调用时进行，确保环境变化（含测试注入）即时生效。

const state = {
  recognition: null,
};

export function isRecognitionSupported() {
  return typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 识别一次，返回 { ok, transcript }（transcript 可能为空字符串）
export function recognizeOnce(lang = 'en-US', timeoutMs = 6000) {
  if (!isRecognitionSupported()) {
    return Promise.resolve({ ok: false, transcript: '', reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      resolve({ ok: false, transcript: '', reason: 'error' });
      return;
    }
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    let settled = false;
    const done = (ok, transcript, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rec.abort(); } catch (e) { /* 忽略 */ }
      state.recognition = null;
      resolve({ ok, transcript, reason });
    };
    const timer = setTimeout(() => done(false, '', 'timeout'), timeoutMs);
    rec.onresult = (e) => {
      const alts = [];
      for (let i = 0; i < e.results[0].length; i++) alts.push(e.results[0][i].transcript);
      done(true, alts.join(' '));
    };
    rec.onerror = (e) => done(false, '', e.error || 'error');
    rec.onend = () => done(false, '', 'ended');
    state.recognition = rec;
    try { rec.start(); } catch (e) { done(false, '', 'error'); }
  });
}

export function stopRecognition() {
  if (state.recognition) {
    try { state.recognition.abort(); } catch (e) { /* 忽略 */ }
    state.recognition = null;
  }
}

// 降级评估：仅依据目标文本长度给粗略时长参考（0~1 信号不做对错判定）
// 用于无识别能力的环境，只驱动鼓励文案。
export function heuristicEvaluate(blob, targetText) {
  if (!blob) return { ok: false, transcript: '', reason: 'no-audio' };
  const expected = Math.max(400, (String(targetText || '').length * 220));
  return { ok: true, transcript: '', heuristic: true, expected, reason: 'heuristic' };
}
