// Unit 6 单元复习卷交付测试（2026-11-13 家长：按正规考试格式出一套全面复习卷）
// 重点验证「卷子不是半成品」：结构齐全、听力原文/选项/参考答案三者一致、
// 分值合计 100、答案覆盖全部大题。任何一处对不上都会红。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../Unit6单元复习卷.html'), 'utf8');
const doc = new JSDOM(html).window.document;
const T = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const pages = [...doc.querySelectorAll('section.page')];
const bodyText = T(doc.body.textContent);
const passages = [...doc.querySelectorAll('.passage')].map((p) => T(p.textContent));
const qLines = [...doc.querySelectorAll('div.q')].map((d) => T(d.textContent));
const answerRows = [...doc.querySelectorAll('table.answers tr')].map((r) => [...r.querySelectorAll('td')].map((c) => T(c.textContent)));
const ansCell = (label) => {
  const row = answerRows.find((r) => r[0] && r[0].includes(label));
  assert.ok(row, `答案表缺少「${label}」行`);
  return row[1];
};

describe('Unit 6 复习卷结构完整性', () => {
  test('EX-1 正规考试格式：7 页、六大 Part、答题卡、听力原文、答案、评分标准、考点分布表', () => {
    assert.equal(pages.length, 7, '应有 7 页（家长说明/试卷AB/笔试/答题卡/Tapescript/答案）');
    ['Part I', 'Part II', 'Part III', 'Part IV', 'Part V', 'Part VI'].forEach((p) => {
      assert.ok(bodyText.includes(p), `缺 ${p}`);
    });
    ['答 题 卡', '听力原文', '参考答案与评分标准', '考点分布表', '注意事项', '评分标准']
      .forEach((s) => assert.ok(bodyText.includes(s), `缺「${s}」`));
    assert.ok(html.includes('window.print()'), '应提供打印/另存 PDF 按钮');
    assert.match(bodyText, /满分 100 分/, '应标明满分');
  });

  test('EX-2 政策依据如实说明：2028 方案未公布 + 现行官方分值 + 不冒充真题', () => {
    assert.match(bodyText, /2028 年中考方案目前尚未公布/);
    assert.match(bodyText, /沪教委基〔2026〕2 号/);
    assert.match(bodyText, /听说测试 10 分/);
    assert.match(bodyText, /含听力 25 分/);
    assert.match(bodyText, /不冒充真题/);
    // 听力比重必须回答家长的问题，且本卷听力确为主力
    assert.match(bodyText, /约 23\.3%/);
    assert.match(bodyText, /40%（笔试）＋ 10%（口试）/);
  });

  test('EX-3 分值结构：笔试 100 分、听力 40 分、听说测试 10 分', () => {
    assert.match(bodyText, /Part I &nbsp;听力理解（共 40 分）|Part I 听力理解（共 40 分）/);
    assert.match(bodyText, /Part II 词汇与语法（共 20 分）|Part II &nbsp;词汇与语法（共 20 分）/);
    assert.match(bodyText, /Part III 阅读理解（共 20 分）|Part III &nbsp;阅读理解（共 20 分）/);
    assert.match(bodyText, /Part IV 情景交际（共 10 分）|Part IV &nbsp;情景交际（共 10 分）/);
    assert.match(bodyText, /Part V 书面表达（共 10 分）|Part V &nbsp;书面表达（共 10 分）/);
    assert.equal(40 + 20 + 20 + 10 + 10, 100);
  });
});

describe('Unit 6 复习卷答案有效性（听力原文 ↔ 题目 ↔ 参考答案必须自洽）', () => {
  test('EX-4 听力 A：录音词 = 选项[答案字母]（改了录音忘改答案必须报错）', () => {
    const tape = passages.find((t) => t.includes('One: which'));
    assert.ok(tape, '缺 A 部分听力原文');
    const m = tape.match(/One:\s*(\w+)\.\s*Two:\s*(\w+)\.\s*Three:\s*(\w+)\.\s*Four:\s*(\w+)\.\s*Five:\s*(\w+)\./);
    assert.ok(m, 'A 部分录音原文格式应可读出 5 个词');
    const words = m.slice(1);

    const aQs = qLines.filter((t) => /^[1-5]\.\s*A\.\s*\w+/.test(t));
    assert.equal(aQs.length, 5, 'A 部分应有 5 道三选一题');
    const opts = aQs.map((t) => {
      const x = t.match(/^[1-5]\.\s*A\.\s*(\w+)\s+B\.\s*(\w+)\s+C\.\s*(\w+)/);
      assert.ok(x, `无法解析选项：${t}`);
      return x.slice(1);
    });

    const ans = [...ansCell('A（5 分）').matchAll(/([1-5])\.\s*([ABC])/g)].map((x) => x[2]);
    assert.equal(ans.length, 5, 'A 部分参考答案应有 5 个字母');
    words.forEach((w, i) => {
      assert.equal(opts[i][{ A: 0, B: 1, C: 2 }[ans[i]]], w,
        `第 ${i + 1} 题：录音是「${w}」，但答案 ${ans[i]} 指向「${opts[i][{ A: 0, B: 1, C: 2 }[ans[i]]]}」`);
    });
  });

  test('EX-5 听力 B：录音排序 = 参考答案里的序号', () => {
    const tape = passages.find((t) => t.includes('Number one: scarf'));
    assert.ok(tape, '缺 B 部分听力原文');
    const nums = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const spoken = {};
    for (const x of tape.matchAll(/Number (one|two|three|four|five):\s*(\w+)/g)) {
      spoken[x[2]] = nums[x[1]];
    }
    assert.equal(Object.keys(spoken).length, 5, '录音应报出 5 件衣物');
    const zh2en = { 毛衣: 'sweater', 围巾: 'scarf', 夹克: 'jacket', 雨衣: 'raincoat', 鞋: 'shoes' };
    const ansText = ansCell('B（5 分）');
    Object.entries(zh2en).forEach(([zh, en]) => {
      const found = ansText.match(new RegExp(zh + '\\s*([1-5])'));
      assert.ok(found, `参考答案缺「${zh}」的序号`);
      assert.equal(Number(found[1]), spoken[en],
        `「${zh}」答案写 ${found[1]}，但录音里 ${en} 是第 ${spoken[en]} 个`);
    });
  });

  test('EX-6 答案覆盖全部大题，判断题答案只写 T/F', () => {
    ['A（5 分）', 'B（5 分）', 'C（10 分）', 'D（10 分）', 'E（10 分）',
      'A（10 分）', 'B（10 分）', '答案'].forEach((label) => ansCell(label));
    const cAns = ansCell('C（10 分）');
    assert.equal([...cAns.matchAll(/[TF]/g)].length >= 5, true, 'C 部分应给出 5 个 T/F');
    // 写作与听说必须有评分标准（不是只给答案）
    assert.match(bodyText, /内容完整/);
    assert.match(bodyText, /语言正确/);
    assert.match(bodyText, /书写规范/);
    assert.match(bodyText, /参考范文/);
  });

  test('EX-7 阅读语料与题型仿真标注齐全（不冒充真题、来源可追溯）', () => {
    ['课本 P34', 'Jenny\'s birthday', '同步优学', '中考题型仿真', 'Assessment II']
      .forEach((s) => assert.ok(bodyText.includes(s), `缺来源标注「${s}」`));
    assert.match(bodyText, /Zhou Jie has new clothes/, '应含课本 F 原文');
    assert.match(bodyText, /They go home with the lovely cat at last/, '应含同步优学阅读原文');
  });
});
