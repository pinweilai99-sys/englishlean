// ou 自然拼读小站：听音、跟读、归类
import { h, toast, starFly } from './dom.js?v=1793964518';
import * as tts from '../services/tts.js?v=1793964518';

export function renderPhonics(ctx, unit) {
  const ph = unit.phonics;
  const session = ctx.session;
  const wrap = h('div', { class: 'card' });

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card-title', text: `🔤 字母组合 ${ph.pattern}　${ph.ipa}` }));
    wrap.appendChild(h('p', { class: 'card-sub', text: '听一听、读一读，再把含 ou 的词挑出来' }));

    const bank = h('div', { class: 'word-bank', style: 'margin:14px 0' });
    ph.words.forEach((w) => {
      bank.appendChild(h('button', {
        class: 'word-bank-item', text: w,
        onclick: () => tts.speak(w),
      }));
    });
    wrap.appendChild(bank);

    wrap.appendChild(h('div', { class: 'card-title', text: "🎵 Let's Chant" }));
    wrap.appendChild(h('div', { class: 'story-text', text: ph.chant }));
    wrap.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, [
      h('button', { class: 'btn', text: '🔊 朗读 chant', onclick: () => tts.speak(ph.chant, { rate: 0.75 }) }),
    ]));

    wrap.appendChild(h('div', { class: 'card-title', style: 'margin-top:22px', text: '🎯 挑出含 ou 的词' }));
    const picked = new Set(session.ouPicked || []);
    const all = [...ph.words, 'rabbit', 'cat', 'dog'];
    const opts = h('div', { style: 'margin-top:10px' });
    all.forEach((w) => {
      const isOu = ph.words.includes(w);
      const btn = h('button', {
        class: `option ${picked.has(w) ? (isOu ? 'is-correct' : 'is-wrong') : ''}`,
        text: w,
        onclick: () => {
          if (picked.has(w)) return;
          picked.add(w);
          session.ouPicked = Array.from(picked);
          if (isOu) {
            ctx.addStars(1); starFly(1);
            toast('答对啦！');
          } else {
            ctx.addWrong({ unit: unit.id, type: 'phonics_sort', q: `选出含 ${ph.pattern} 的词`, a: ph.words.join(', '), chosen: w });
            toast('这个词不含 ou 哦～');
          }
          render();
          const correctCount = Array.from(picked).filter((x) => ph.words.includes(x)).length;
          if (correctCount === ph.words.length) {
            toast('🎉 ou 全部找对啦！', 3000);
            ctx.addStars(3); starFly(3);
          }
        },
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);
  }

  render();
  return h('div', {}, [
    h('button', { class: 'back-btn', text: '← 返回学习路径', onclick: () => ctx.navigate(`#/unit/${unit.id}`) }),
    wrap,
  ]);
}
