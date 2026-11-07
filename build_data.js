// data/coupang_*.md 와 data/kakaobank_*.md (원문 표)를 묶어 index.html 이 불러오는 데이터 파일을 만든다.
//   data.js        : 이 PC 에서 보는 용 (상호·이름 그대로). GitHub 에 올리지 않는다.
//   data.public.js : GitHub Pages 공개용. 지역·개인을 알 수 있는 상호와 이름을 ** 로 가린다 (cats.js 의 maskPlace, maskItem).
// 은행 제외 규칙(CLAUDE.md 분석 규칙 2)과 은행 카테고리는 여기서 적용한다. 제외할 이름은 exclude.local.json (올리지 않음).
// 사용법: node build_data.js   (md 가 바뀔 때마다 다시 실행)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { categorize, maskItem, maskPlace } = require('./cats.js');

const dir = path.join(__dirname, 'data');
const tableRows = text => text.split(/\r?\n/).filter(l => /^\| \d{4}[.-]\d{2}[.-]\d{2}/.test(l)).map(l => l.slice(2, -2).split(/ (?<!\\)\| /).map(c => c.replace(/\\\|/g, '|')));
const num = s => Number(String(s).replace(/,/g, ''));
const norm = s => s.normalize('NFKC').trim(); // 원문에 전각 'ＫＢ카드출금'이 섞여 있다

const exPath = path.join(__dirname, 'exclude.local.json');
if (!fs.existsSync(exPath)) throw new Error('exclude.local.json 이 없습니다. CLAUDE.md 분석 규칙 2의 이름으로 만들어 주세요.');
const EX = JSON.parse(fs.readFileSync(exPath, 'utf8'));
const excluded = (kind, desc) => EX.any.includes(norm(desc)) || (kind === '출금' && EX.out.includes(norm(desc)));

// 쿠팡: | 주문일자 | 상품명 | 결제금액 | 수량 |  → [일자, 상품명, 금액]
const coupang = [];
for (const f of fs.readdirSync(dir).filter(f => /^coupang_\d{4}\.md$/.test(f)).sort()) {
  for (const c of tableRows(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    assert(c.length === 4 && Number.isFinite(num(c[2])), `${f}: 읽을 수 없는 줄 ${c}`);
    coupang.push([c[0], c[1], num(c[2])]);
  }
}

// 카카오뱅크: | 거래일시 | 구분 | 거래금액 | 거래 후 잔액 | 거래구분 | 내용 | 메모 |  → [일시, 구분, 금액, 카테고리, 내용, 거래구분]
let bankTotal = 0;
const bank = [];
for (const f of fs.readdirSync(dir).filter(f => /^kakaobank_.*\.md$/.test(f)).sort()) {
  for (const c of tableRows(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    assert(c.length === 7 && Number.isFinite(num(c[2])), `${f}: 읽을 수 없는 줄 ${c}`);
    bankTotal++;
    if (excluded(c[1], c[5])) continue;
    bank.push([c[0], c[1], num(c[2]), categorize(c[5]), c[5], c[4]]);
  }
}

// 공개용 가리기. 규칙에 안 맞는 동네 가게는 카테고리별로 금액이 큰 순서대로 '외식 가게 1', '외식 가게 2' …
const masked = new Map();
const leftovers = {};
for (const [, , amt, cat, desc, kind] of bank) {
  if (masked.has(desc)) continue;
  const m = maskPlace(desc, kind);
  if (m) masked.set(desc, m); else ((leftovers[cat] ??= {})[desc] = (leftovers[cat][desc] || 0) + Math.abs(amt));
}
for (const [cat, m] of Object.entries(leftovers)) Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([desc], i) => masked.set(desc, `${cat} 가게 ${i + 1}`));

const strip = rows => rows.map(([d, kind, amt, cat, desc]) => [d, kind, amt, cat, desc]);
const built = new Date().toLocaleDateString('sv'); // 이 PC 시간대 기준 YYYY-MM-DD
const write = (file, obj, note) => fs.writeFileSync(path.join(__dirname, file), `// build_data.js 가 data/*.md 에서 만든 파일. 직접 고치지 말 것. ${note} (${built})\nwindow.SPEND_DATA = ${JSON.stringify(obj)};\n`);

write('data.js', { built, bankTotal, coupang, bank: strip(bank) }, '이 PC 전용, GitHub 에 올리지 않는다.');
const pub = { built, bankTotal, coupang: coupang.map(([d, item, p]) => [d, maskItem(item), p]), bank: strip(bank).map(([d, kind, amt, cat, desc]) => [d, kind, amt, cat, masked.get(desc)]) };
write('data.public.js', pub, '공개용: 상호·이름을 가렸다.');

// 공개 파일에 원래 상호·이름이 남지 않았는지 확인 (체인 브랜드명처럼 원래 그대로 두는 것은 예외)
const pubText = fs.readFileSync(path.join(__dirname, 'data.public.js'), 'utf8');
const leaked = [...new Set(bank.map(r => r[4]))].filter(d => masked.get(d) !== d && pubText.includes(`"${d}"`));
assert(!leaked.length, '공개 파일에 가리지 않은 상호가 남음: ' + leaked.join(', '));
for (const name of EX.any) assert(!pubText.includes(name) || /^쿠팡/.test(name), `공개 파일에 제외 이름이 남음: ${name}`);
assert(!/추가 입력 정보: (?!\*\*)/.test(pubText), '공개 파일에 주문 각인 문구가 남음');

console.log(`data.js: 쿠팡 ${coupang.length}건, 은행 ${bank.length}건 (전체 ${bankTotal}건 중 ${bankTotal - bank.length}건 제외)`);
console.log(`data.public.js: 상호 ${masked.size}개를 가림`);
