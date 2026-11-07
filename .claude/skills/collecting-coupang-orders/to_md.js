// 사용법: node to_md.js <coupang_YYYY.csv> [더 많은 csv...]
// csv의 모든 주문을 요약 없이 그대로 같은 이름의 .md 표로 쓴다. 상품명 안의 | 는 \| 로 바꾼다.
// report.js는 이 md를 읽는다.
const fs = require('fs');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node to_md.js <coupang_YYYY.csv> ...'); process.exit(1); }
for (const src of files) {
  const lines = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  const rows = lines.map(l => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}),"((?:[^"]|"")*)",(\d+),(\d+)$/);
    if (!m) throw new Error(`${src}: 읽을 수 없는 줄 → ${l}`);
    return [m[1], m[2].replace(/""/g, '"').replace(/\|/g, '\\|'), m[3], m[4]];
  });
  const year = (src.match(/(\d{4})/) || [])[1] || '';
  const total = rows.reduce((s, r) => s + +r[2], 0);
  const md = `# ${year}년 쿠팡 주문 내역 (원문)

- 원본: ${src.split(/[\\/]/).pop()} 를 그대로 옮김. 요약하지 않음.
- ${rows.length}건, ${rows.at(-1)?.[0]} ~ ${rows[0]?.[0]}, 합계 ${total.toLocaleString()}원
- 금액은 주문목록에 표시된 상품 금액. 쿠폰·적립금 할인 전이며 취소·반품 건이 섞여 있을 수 있음.

| 주문일자 | 상품명 | 결제금액 | 수량 |
|---|---|---:|---:|
${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}
`;
  const dst = src.replace(/\.csv$/, '.md');
  fs.writeFileSync(dst, md);
  console.log(`${dst}: ${rows.length}건, 합계 ${total.toLocaleString()}원`);
}
