// 사용법: node to_csv.js <evaluate_script가 저장한 파일> <출력 csv>
// scrape.js 결과({pages,count,first,last,csv})를 UTF-8 BOM csv로 저장하고 요약을 출력한다.
const fs = require('fs');
const [, , src, dst] = process.argv;
if (!src || !dst) { console.error('usage: node to_csv.js <raw> <out.csv>'); process.exit(1); }
let s = fs.readFileSync(src, 'utf8');
const m = s.match(/```json\s*([\s\S]*?)```/); // 도구가 마크다운 코드블록으로 감싸 저장하는 경우
if (m) s = m[1];
const o = JSON.parse(s.trim());
if (!o.csv || !o.count) { console.error('주문을 하나도 못 읽음. 로그인 상태나 화면 구조를 확인할 것', o); process.exit(1); }
fs.writeFileSync(dst, '﻿' + o.csv);
const total = o.csv.trim().split('\n').slice(1).reduce((a, l) => a + +l.split(',').at(-2), 0);
console.log(`pages ${o.pages}, ${o.count}건, ${o.last} ~ ${o.first}, 합계 ${total.toLocaleString()}원 → ${dst}`);
