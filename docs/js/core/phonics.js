// 分块朗读「重拼写」映射（phonics chunk re-spelling）。
//
// 背景：单词图卡把多音节词拆成音节块逐块朗读（pen·cil / ru·ler / e·ra·ser …），
// 让孩子听见「这个词由几块拼成」。但 macOS Daniel 英音 TTS 在**孤立音节**里会读偏：
//   · cil 被读成带硬 k 的怪音（家长实拍：pen·cil → "penksl"，pen 后面跟了个 /k/）；
//   · 单字母 e 被读成字母名 "ee"（违反「单字母绝不单独发音」红线）。
//
// 修复思路（显示与朗读解耦）：
//   · 分块**按钮显示**仍用真实字母（pen·cil），保留「字形→音节」的视觉映射；
//   · 分块**朗读文本**改成下面的重拼写法，让 Daniel 在孤立音节里也发出正确声。
//
// 选择原则（重要）：
//   · 只收录「确实有问题的孤立分块」；Daniel 本来就读得对的原始分块（如 ser→/sɜː/、
//     dic→/dɪk/）一律不改，把改动面压到最小，避免引入新错。
//   · 重拼写优先选「清晰无歧义、且软辅音正确」的拼法：
//       - cil→sill（软 s /sɪl/，彻底消除原 "cil" 里的硬 k）
//       - e→ih（eraser 首音节是 /ɪ/，绝不读字母名 ee）
//       - ru→roo（ruler /ruː/，roo 无歧义；原文 "ru" 易读成字母 r+u）
//       - ra→ray（eraser 重读音节 /reɪ/；原文 "ra" 易读成 /rɑː/ "rah"）
//       - tion→shun（-tion 标准读音 /ʃən/）
//       - ary→ree（dictionary 尾 -ary 弱读 /əri/；原文 "ary" 易读成 /eəri/）
//       - cle→klee（clever 首 cle = /kl/；原文 "cle" 易被拆成字母名）
//       - ly→lee（lovely 尾 -ly = /li/；原文 "ly" 易读成 /laɪ/ "lie"）
//
// 验证说明：本地 Whisper（whisper-base.en）对这类近元音/孤立音节**不可靠**
//（实测把 ih 听成 "i know"、ray 听成 "rain"、sir 听成 "so"、dik 听成 "sadic"），
// 故本表不靠 ASR 定稿，而是用英语自然拼读规则判定。最终读音请人工耳检确认。
// 改一个值后必须重跑 scripts/gen-audio.mjs 重新生成对应 m4a 并重建 docs/离线包。
// 只收录「确实有问题的孤立分块」；能正常朗读的分块不在此列（走默认原文）。
const CHUNK_SAY = {
  // pencil → pen·cil：cil 在词里是 /səl/，但 Daniel 把孤立 "cil" 读成带硬 k 的怪音；
  // 重拼写 rhyming "sill"（软 s /sɪl/），彻底消除 penksl。
  cil: 'sill',
  // eraser → e·ra·ser：首音节是 /ɪ/（弱化），单字母 e 会被读成字母名 ee，改为 ih。
  e: 'ih',
  // ruler → ru·ler：ru 在词里是 /ruː/（长 u），孤立 "ru" 易读成字母 r+u，改为 roo。
  ru: 'roo',
  // eraser → e·ra·ser：ra 是重读音节 /reɪ/（RAY），孤立 "ra" 易读成 /rɑː/ "rah"。
  ra: 'ray',
  // dictionary → dic·tion·ary：-tion 标准读音 /ʃən/。
  tion: 'shun',
  // dictionary → dic·tion·ary：ary 弱读 /əri/，孤立 "ary" 易读成 /eəri/，改为 ree。
  ary: 'ree',
  // clever → cle·ver：cle 是 /kl/ 开头，孤立 "cle" 易被拆成字母名，改为 klee。
  cle: 'klee',
  // lovely → love·ly：ly 是 /li/，孤立 "ly" 易读成 /laɪ/ "lie"，改为 lee。
  ly: 'lee',
};

// 分块显示文本 → 朗读重拼写。无映射则返回原文本（保持默认行为）。
export function chunkSay(chunk) {
  if (chunk == null) return chunk;
  const key = String(chunk).toLowerCase();
  return CHUNK_SAY[key] || chunk;
}
