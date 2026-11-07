// 쿠팡 소비 패턴 통계 리포트 생성기.
// 사용법: node report.js  → data/coupang_*.md (csv 원문 그대로의 표) 를 읽어 리포트 본문을 report_body.js 로 쓴다. index.html 의 리포트 탭이 보여준다(외부 전송 없음, 차트는 정적 SVG).
// 월 구분은 월급날 25일 기준(CLAUDE.md 분석 규칙): N월 = (N-1)월 25일 ~ N월 24일.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------- 데이터 ----------
const ym = d => { const x = new Date(d.getFullYear(), d.getMonth() + (d.getDate() >= 25 ? 1 : 0), 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };

const { COUPANG_CATS: CATS, maskItem } = require('./cats.js'); // 키워드는 cats.js에서 고친다
const classify = name => (CATS.find(([, re]) => re.test(name)) || ['기타'])[0];
const CAT_NAMES = [...CATS.map(c => c[0]), '기타'];

const rows = [];
// data/coupang_YYYY.md (to_md.js가 csv를 그대로 옮긴 원문 표)를 읽는다. 표 행: | 주문일자 | 상품명 | 결제금액 | 수량 |
for (const f of fs.readdirSync(path.join(__dirname, 'data')).filter(f => /^coupang_\d{4}\.md$/.test(f)).sort()) {
  const lines = fs.readFileSync(path.join(__dirname, 'data', f), 'utf8').split(/\r?\n/).filter(l => /^\| \d{4}-\d{2}-\d{2} \|/.test(l));
  if (!lines.length) throw new Error(`${f}: 주문 표가 없음. node .claude/skills/collecting-coupang-orders/to_md.js 로 다시 만들 것`);
  for (const l of lines) {
    const c = l.slice(2, -2).split(/ (?<!\\)\| /);
    if (c.length !== 4 || !/^\d+$/.test(c[2]) || !/^\d+$/.test(c[3])) throw new Error(`${f}: 읽을 수 없는 줄 → ${l}`);
    const [y, mo, da] = c[0].split('-').map(Number);
    const d = new Date(y, mo - 1, da);
    const item = maskItem(c[1].replace(/\\\|/g, '|')); // 리포트는 공개되므로 주문 각인 문구(아이 이름 등)를 가린다
    rows.push({ d, ds: c[0], item, price: +c[2] * +c[3], qty: +c[3], cat: classify(item), pm: ym(d) });
  }
}

// ---------- 통계 도구 ----------
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => sum(a) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const median = a => quantile(a, 0.5);
const linreg = ys => { const xs = ys.map((_, i) => i); const mx = mean(xs), my = mean(ys); const b = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map(x => (x - mx) ** 2)); const a = my - b * mx; const ssr = sum(ys.map((y, i) => (y - (a + b * i)) ** 2)), sst = sum(ys.map(y => (y - my) ** 2)); return { a, b, r2: 1 - ssr / sst }; };
const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const pTwo = z => 1 - erf(Math.abs(z) / Math.SQRT2); // 정규근사 양측 p (표본이 수백 개라 충분)
const welch = (a, b) => { const se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length); const t = (mean(a) - mean(b)) / se; return { t, p: pTwo(t), diff: mean(a) - mean(b), ci: 1.96 * se }; };
const ci95 = a => 1.96 * sd(a) / Math.sqrt(a.length);

// ponytail: 자체 점검 몇 개만. 분류·월 구분·통계식이 깨지면 여기서 멈춘다.
assert.equal(ym(new Date(2026, 4, 25)), '2026-06'); assert.equal(ym(new Date(2026, 5, 24)), '2026-06'); assert.equal(ym(new Date(2025, 11, 25)), '2026-01');
assert.equal(classify('국내산 비타민, 150g, 2개'), '채소·과일'); assert.equal(classify('나우푸드 비타민 D-3 & K-2'), '영양제');
assert.equal(classify('하기스 NEW 보송보송 팬티형 기저귀 공용, 5단계, 184매'), '육아'); assert.equal(classify('동원샘물 생수, 2L, 24개'), '음료·생수');
assert.equal(median([1, 2, 3, 4]), 2.5); assert(Math.abs(pTwo(1.96) - 0.05) < 0.001); assert(Math.abs(linreg([1, 3, 5]).b - 2) < 1e-9);

// ---------- 분석 범위 ----------
// 완전한 월급 월만: 2023-01은 2022-12-25~31이 없어 빼고, 진행 중인 마지막 달도 뺀다.
const TODAY = new Date(2026, 10, 7);
const allPm = [...new Set(rows.map(r => r.pm))].sort();
const months = allPm.filter(m => m !== '2023-01' && m < ym(TODAY));
const inWin = rows.filter(r => months.includes(r.pm));
const byMonth = months.map(m => { const rs = inWin.filter(r => r.pm === m); return { m, n: rs.length, sum: sum(rs.map(r => r.price)), rs }; });
const mSums = byMonth.map(x => x.sum);
const last12 = byMonth.slice(-12), prev12 = byMonth.slice(-24, -12);
const last12Rows = last12.flatMap(x => x.rs);
const years = [...new Set(months.map(m => m.slice(0, 4)))];
const byYear = years.map(y => { const ms = byMonth.filter(x => x.m.startsWith(y)); const rs = ms.flatMap(x => x.rs); return { y, months: ms.length, sum: sum(rs.map(r => r.price)), n: rs.length, avgM: sum(rs.map(r => r.price)) / ms.length, nM: rs.length / ms.length, ticket: mean(rs.map(r => r.price)), med: median(rs.map(r => r.price)), rs }; });
const Y = Object.fromEntries(byYear.map(x => [x.y, x]));

// 추세
const trend = linreg(mSums);
const roll = mSums.map((_, i) => i < 11 ? null : mean(mSums.slice(i - 11, i + 1)));

// 카테고리 (월급 연도별 월평균)
const catYear = CAT_NAMES.map(c => ({ c, v: Object.fromEntries(byYear.map(y => [y.y, sum(y.rs.filter(r => r.cat === c).map(r => r.price)) / y.months])) }));
const catL12 = Object.fromEntries(CAT_NAMES.map(c => [c, sum(last12Rows.filter(r => r.cat === c).map(r => r.price)) / 12]));
const catP12 = Object.fromEntries(CAT_NAMES.map(c => [c, sum(prev12.flatMap(x => x.rs).filter(r => r.cat === c).map(r => r.price)) / 12]));
const growth = (a, b) => CAT_NAMES.map(c => ({ c, d: catYear.find(x => x.c === c).v[b] - catYear.find(x => x.c === c).v[a] })).sort((x, y) => y.d - x.d);
const g2325 = growth('2023', '2025');
const totalUp2325 = Y['2025'].avgM - Y['2023'].avgM;

// 건수 × 객단가 분해 (2023 → 2025): Δ월평균 = Δ건수×옛 객단가 + 새 건수×Δ객단가
const decomp = { byCount: (Y['2025'].nM - Y['2023'].nM) * Y['2023'].ticket, byTicket: Y['2025'].nM * (Y['2025'].ticket - Y['2023'].ticket) };

// 일별 (주문 없는 날은 0원)
const start = new Date(2023, 0, 25), end = new Date(TODAY.getFullYear(), TODAY.getMonth() - (TODAY.getDate() >= 25 ? 0 : 1), 24);
const dayTotals = new Map(); inWin.forEach(r => dayTotals.set(r.ds, (dayTotals.get(r.ds) || 0) + r.price));
const days = [];
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const prevMonthDays = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  const cyc = d.getDate() >= 25 ? d.getDate() - 25 : d.getDate() + prevMonthDays - 25; // 월급날로부터 며칠째(0 = 25일)
  days.push({ ds, dow: d.getDay(), cyc, v: dayTotals.get(ds) || 0, pm: ym(d) });
}
assert.equal(sum(days.map(d => d.v)), sum(inWin.map(r => r.price)), '일별 합계와 주문 합계가 달라졌다');
const weekend = days.filter(d => d.dow === 0 || d.dow === 6).map(d => d.v), weekday = days.filter(d => d.dow > 0 && d.dow < 6).map(d => d.v);
const wk = welch(weekend, weekday);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dowStats = [1, 2, 3, 4, 5, 6, 0].map(i => { const a = days.filter(d => d.dow === i).map(d => d.v); return { k: DOW[i], m: mean(a), ci: ci95(a), n: a.length }; });
const CYC = [['월급 후 1주', 0, 6], ['2주차', 7, 13], ['3주차', 14, 20], ['다음 월급 전', 21, 40]];
const cycStats = CYC.map(([k, lo, hi]) => { const a = days.filter(d => d.cyc >= lo && d.cyc <= hi).map(d => d.v); return { k, m: mean(a), ci: ci95(a), n: a.length, a }; });
const cycTest = welch(cycStats[0].a, cycStats.slice(1).flatMap(x => x.a));
const orderDays = days.filter(d => d.v > 0).length;

// 주문 크기 분포
const BINS = [['5천 원 미만', 0, 5000], ['5천~1만', 5000, 10001], ['1만~2만', 10001, 20000], ['2만~5만', 20000, 50000], ['5만~10만', 50000, 100000], ['10만 원 이상', 100000, Infinity]];
const binOf = p => BINS.findIndex(([, lo, hi]) => p >= lo && p < hi);
const dist = byYear.map(y => ({ y: y.y, n: BINS.map((_, i) => y.rs.filter(r => binOf(r.price) === i).length), s: BINS.map((_, i) => sum(y.rs.filter(r => binOf(r.price) === i).map(r => r.price))), total: y.sum, cnt: y.n }));
const small = rs => rs.filter(r => r.price <= 10000);

// 튀는 달 (z ≥ 1.5)
const mMean = mean(mSums), mSd = sd(mSums);
const spikes = byMonth.map(x => ({ ...x, z: (x.sum - mMean) / mSd })).filter(x => x.z >= 1.5).map(x => { const top = [...x.rs].sort((a, b) => b.price - a.price)[0]; return { ...x, top }; });

// 고액 비필수 (최근 12개월, 5만 원 이상, 식품·육아·생활 소모품 제외)
const NONESS = ['전자·가전', '뷰티·패션', '기타'];
const bigNoness = last12Rows.filter(r => r.price >= 50000 && NONESS.includes(r.cat)).sort((a, b) => b.price - a.price);

// 반복 구매 (최근 12개월, 4회 이상)
const key = s => s.split(',')[0].replace(/^\[[^\]]*\]\s*/, '').split(/\s+/).slice(0, 4).join(' ');
const groups = {}; last12Rows.forEach(r => (groups[key(r.item)] ??= []).push(r));
const recurring = Object.entries(groups).filter(([, v]) => v.length >= 4).map(([k, v]) => { const ds = [...new Set(v.map(r => r.ds))].sort().map(s => new Date(s)); const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / 864e5); return { k, n: v.length, s: sum(v.map(r => r.price)), gap: gaps.length ? median(gaps) : null, cat: v[0].cat }; }).sort((a, b) => b.s - a.s).slice(0, 12);
const recurTotal = sum(recurring.map(r => r.s));

// 같은 날 같은 상품 여러 줄 (최근 12개월)
const dupMap = {}; last12Rows.forEach(r => (dupMap[r.ds + '|' + r.item] ??= []).push(r));
const dups = Object.values(dupMap).filter(v => v.length > 1);
const dupExtra = sum(dups.map(v => sum(v.slice(1).map(r => r.price))));

// 육아 시작점
const firstBaby = rows.filter(r => r.cat === '육아' && /분유|기저귀/.test(r.item)).sort((a, b) => a.d - b.d)[0];

// ---------- 절감 여력 (가정은 표에 그대로 적는다) ----------
const l12Total = sum(last12Rows.map(r => r.price));
const l12Small = small(last12Rows);
const l12Days = days.filter(d => last12.some(x => x.m === d.pm));
const l12We = l12Days.filter(d => d.dow === 0 || d.dow === 6), l12Wd = l12Days.filter(d => d.dow > 0 && d.dow < 6);
const weExcess = Math.max(0, (mean(l12We.map(d => d.v)) - mean(l12Wd.map(d => d.v))) * l12We.length);
const SAVE = [
  { what: '1만 원 이하 소액 주문', base: sum(l12Small.map(r => r.price)), basis: `${l12Small.length}건`, rule: '30%를 장보기 한 번에 묶거나 건너뜀', rate: 0.3 },
  { what: '주말 초과분', base: weExcess, basis: `주말 하루 평균이 평일보다 높은 만큼 × ${l12We.length}일`, rule: '절반을 평일 계획 구매로 옮김', rate: 0.5 },
  { what: '5만 원 이상 비필수 단건', base: sum(bigNoness.map(r => r.price)), basis: `${bigNoness.length}건 (전자·가전, 뷰티·패션, 기타)`, rule: '절반을 사지 않거나 미룸', rate: 0.5 },
  { what: '반복 구매 상위 12개', base: recurTotal, basis: '4회 이상 산 품목', rule: '정기배송·대용량으로 단가 5% 낮춤', rate: 0.05 },
].map(s => ({ ...s, save: s.base * s.rate }));
const saveTotal = sum(SAVE.map(s => s.save));


// ---------- 출력 도구 ----------
const won = n => Math.round(n).toLocaleString('ko-KR');
const man = n => { const v = n / 10000; return (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1).replace(/\.0$/, '')) + '만'; };
const pct = (a, b) => `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%`;
const share = (a, b) => `${Math.round(a / b * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pv = p => p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
const niceMax = v => { const p = 10 ** Math.floor(Math.log10(v || 1)); return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(k => k * p >= v) * p; }; // 272만 → 300만 (예전 식은 500만까지 올라갔다)
const svg = (W, H, label, body) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

// 월별 막대 + 12개월 이동평균. 튀는 달(z≥1.5)은 빨강, 이름표를 단다
function monthChart() {
  const W = 1040, H = 320, L = 48, R = 8, T = 28, B = 34;
  const max = niceMax(Math.max(...mSums));
  const n = mSums.length, step = (W - L - R) / n, bw = Math.min(20, step - 4);
  const x = i => L + step * (i + 0.5), y = v => T + (H - T - B) * (1 - v / max);
  const spikeSet = new Set(spikes.map(s => s.m));
  let s = [0, .2, .4, .6, .8, 1].map(f => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="ax" x="${L - 8}" y="${y(max * f) + 4}" text-anchor="end">${f ? man(max * f) : '0'}</text>`).join('');
  s += byMonth.map((m, i) => `<g data-tip="${m.m}\n${won(m.sum)}원 · ${m.n}건"><rect class="hit" x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}"/><rect class="b ${spikeSet.has(m.m) ? 'over' : ''}" x="${x(i) - bw / 2}" y="${y(m.sum)}" width="${bw}" height="${y(0) - y(m.sum)}"/></g>`).join('');
  s += `<polyline class="line-accent" points="${roll.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean).join(' ')}"/>`;
  const li = roll.length - 1;
  s += `<circle class="dot-accent" cx="${x(li)}" cy="${y(roll[li])}" r="4"/><text class="reflbl" x="${x(li) - 8}" y="${y(roll[li]) - 10}" text-anchor="end">12개월 평균 ${man(roll[li])}원</text>`;
  s += spikes.map(sp => { const i = months.indexOf(sp.m); return `<text class="reflbl" x="${x(i)}" y="${y(sp.sum) - 8}" text-anchor="middle">${esc(cut(sp.top.item.split(',')[0].replace(/^\[[^\]]*\]\s*/, ''), 10))}</text>`; }).join('');
  s += months.map((m, i) => m.endsWith('-01') ? `<text class="ax" x="${x(i)}" y="${H - 12}" text-anchor="middle">${m.slice(0, 4)}</text>` : '').join('');
  return svg(W, H, '월급 월별 지출 막대와 12개월 이동평균', s);
}

// 작은 세로 막대 (연도 비교용 small multiples)
function miniBars(items, fmt, hiLast = true) {
  const W = 320, H = 200, T = 26, B = 28, n = items.length, step = W / n, bw = Math.min(46, step - 16);
  const max = Math.max(...items.map(i => i.v)), y = v => T + (H - T - B) * (1 - v / max);
  return svg(W, H, '연도별 비교 막대', items.map((it, i) => { const cx = step * (i + 0.5); return `<g data-tip="${esc(it.tip || it.k + ' ' + fmt(it.v))}"><rect class="hit" x="${cx - step / 2}" y="0" width="${step}" height="${H}"/><rect class="b ${hiLast && i === n - 1 ? 'hi' : ''}" x="${cx - bw / 2}" y="${y(it.v)}" width="${bw}" height="${y(0) - y(it.v)}"/><text class="val" x="${cx}" y="${y(it.v) - 8}" text-anchor="middle">${fmt(it.v)}</text><text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(it.k)}</text></g>`; }).join('') + `<line class="axis" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`);
}

// 0 기준 양방향 가로 막대 (증감)
function divBars(items, fmt) {
  const W = 1040, rowH = 32, L = 130, R = 120, H = items.length * rowH;
  const lo = Math.min(0, ...items.map(i => i.v)), hi = Math.max(0, ...items.map(i => i.v)), span = W - L - R;
  const sx = v => v / (hi - lo || 1) * span, zero = L + sx(-lo);
  return svg(W, H, '카테고리별 월평균 변화', items.map((it, i) => { const yy = i * rowH, w = Math.abs(sx(it.v)), x0 = it.v >= 0 ? zero : zero - w; return `<g data-tip="${esc(it.k)}\n${it.v >= 0 ? '+' : ''}${won(it.v)}원 / 월"><rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/><text class="lbl" x="${L - 12}" y="${yy + 21}" text-anchor="end">${esc(it.k)}</text><rect class="b ${it.v >= 0 ? 'hi' : ''}" x="${x0}" y="${yy + 7}" width="${Math.max(1, w)}" height="18"/><text class="val" x="${it.v >= 0 ? x0 + w + 8 : zero + 8}" y="${yy + 21}">${fmt(it.v)}</text></g>`; }).join('') + `<line class="axis" x1="${zero}" x2="${zero}" y1="0" y2="${H}"/>`);
}

// 카테고리 × 연도: 행마다 연도별 얇은 막대 (최근 연도가 가장 밝다)
function catYearChart() {
  const cats = CAT_NAMES.filter(c => byYear.some(y => catYear.find(x => x.c === c).v[y.y] > 0));
  const yrs = byYear.map(y => y.y), barH = 7, gap = 2, rowH = yrs.length * (barH + gap) + 14, L = 130, R = 90, W = 1040, H = cats.length * rowH;
  const max = Math.max(...cats.flatMap(c => yrs.map(y => catYear.find(x => x.c === c).v[y])));
  const cls = i => `s${Math.max(0, yrs.length - 1 - i)}`;
  return svg(W, H, '카테고리별 연도 월평균', cats.map((c, ci) => { const v = catYear.find(x => x.c === c).v, yy = ci * rowH; return `<g data-tip="${esc(c)} 월평균\n${yrs.map(y => `${y}  ${won(v[y])}원`).join('\n')}"><rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/><text class="lbl" x="${L - 12}" y="${yy + rowH / 2 + 2}" text-anchor="end">${esc(c)}</text>${yrs.map((y, i) => `<rect class="${cls(i)}" x="${L}" y="${yy + 4 + i * (barH + gap)}" width="${Math.max(1, (W - L - R) * v[y] / max)}" height="${barH}"/>`).join('')}<text class="val" x="${L + Math.max(1, (W - L - R) * v[yrs.at(-1)] / max) + 8}" y="${yy + 4 + (yrs.length - 1) * (barH + gap) + barH}">${man(v[yrs.at(-1)])}원</text></g>`; }).join('') + `<line class="axis" x1="${L}" x2="${L}" y1="0" y2="${H}"/>`);
}

// 평균 막대 + 95% 신뢰구간
function ciBars(items, highlight) {
  const W = 520, rowH = 36, L = 96, R = 140, H = items.length * rowH;
  const max = Math.max(...items.map(i => i.m + i.ci)), sx = v => v / max * (W - L - R);
  return svg(W, H, '하루 평균 지출과 95% 신뢰구간', items.map((it, i) => { const yy = i * rowH, a = L + sx(it.m - it.ci), b = L + sx(it.m + it.ci); return `<g data-tip="${esc(it.k)}\n하루 평균 ${won(it.m)}원\n95% 구간 ${won(it.m - it.ci)}~${won(it.m + it.ci)}원\n${it.n}일"><rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/><text class="lbl" x="${L - 10}" y="${yy + 22}" text-anchor="end">${esc(it.k)}</text><rect class="b ${highlight(it) ? 'hi' : ''}" x="${L}" y="${yy + 8}" width="${sx(it.m)}" height="20"/><line class="whisker" x1="${a}" x2="${b}" y1="${yy + 18}" y2="${yy + 18}"/><line class="whisker" x1="${a}" x2="${a}" y1="${yy + 12}" y2="${yy + 24}"/><line class="whisker" x1="${b}" x2="${b}" y1="${yy + 12}" y2="${yy + 24}"/><text class="val" x="${b + 10}" y="${yy + 22}">${man(it.m)}원</text></g>`; }).join('') + `<line class="axis" x1="${L}" x2="${L}" y1="0" y2="${H}"/>`);
}

// 100% 누적 가로 막대 (연도별 금액대 구성)
function stack100(rowsIn, labels) {
  const W = 520, rowH = 34, L = 50, H = rowsIn.length * rowH;
  return svg(W, H, '연도별 금액대 구성', rowsIn.map((r, ri) => { const tot = sum(r.parts); let x = L; return `<text class="lbl" x="${L - 10}" y="${ri * rowH + 21}" text-anchor="end">${r.k}</text>` + r.parts.map((v, j) => { const w = (W - L) * v / tot, g = `<g data-tip="${r.k} · ${esc(labels[j])}\n${share(v, tot)}"><rect class="s${j}" x="${x}" y="${ri * rowH + 6}" width="${Math.max(0, w - 1.5)}" height="22"/></g>`; x += w; return g; }).join(''); }).join(''));
}

// 이름 + 막대 + 값 (+ 둘째 줄 설명)
function hbars(items, { labelW = 260, hiN = 0, sub = null, fmt = v => man(v) + '원' } = {}) {
  const W = 1040, rowH = sub ? 50 : 32, R = 170, H = items.length * rowH, max = Math.max(...items.map(i => i.v), 1), maxCh = Math.floor((labelW - 16) / 13.5);
  return svg(W, H, '항목별 가로 막대', items.map((it, i) => { const yy = i * rowH, w = (W - labelW - R) * it.v / max; return `<g data-tip="${esc(it.tip || it.k)}"><rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/><text class="lbl" x="${labelW - 12}" y="${yy + 21}" text-anchor="end">${esc(cut(it.k, maxCh))}</text>${sub ? `<text class="ax" x="${labelW - 12}" y="${yy + 39}" text-anchor="end">${esc(cut(sub(it), maxCh + 6))}</text>` : ''}<rect class="b ${i < hiN ? 'hi' : ''}" x="${labelW}" y="${yy + 7}" width="${Math.max(2, w)}" height="18"/><text class="val" x="${labelW + w + 10}" y="${yy + 21}">${esc(fmt(it.v, it))}</text></g>`; }).join('') + `<line class="axis" x1="${labelW}" x2="${labelW}" y1="0" y2="${H}"/>`);
}

// 최근 12개월 + 예산선

const legend = (labels, rev = false) => `<div class="legend">${labels.map((k, j) => `<span><i class="s${rev ? labels.length - 1 - j : j}"></i>${esc(k)}</span>`).join('')}</div>`;

// ---------- 은행 + 쿠팡 합친 최근 12개월 (AI 분석용) ----------
// data.js(build_data.js 가 만든 것, 은행 제외 규칙·카테고리 적용됨)에서 은행 출금을 읽는다. 상호는 쓰지 않고 카테고리만 쓴다.
// AI 분석에서 빼는 것 (2026-11-08 사용자 요청): 네이버페이 충전. 현대·KB 카드 대금은 data.js 에 이미 없다.
const AI_SKIP = /^네이버페이충전$/;
const SD = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'))(w); return w.SPEND_DATA; })();
const winSet = new Set(last12.map(x => x.m));
const toD = s => { const m = s.match(/(\d{4})\D(\d{2})\D(\d{2})/); return new Date(+m[1], m[2] - 1, +m[3]); };
const bankOut = SD.bank.filter(r => r[1] === '출금').map(([d, , amt, cat, desc]) => ({ d: toD(d), pm: ym(toD(d)), price: -amt, cat, desc })).filter(r => winSet.has(r.pm) && !AI_SKIP.test(r.desc));
const allL12 = [...last12Rows.map(r => ({ d: r.d, pm: r.pm, price: r.price, cat: r.cat, src: '쿠팡' })), ...bankOut.map(r => ({ ...r, src: '은행' }))];
const allTotal = sum(allL12.map(r => r.price)), allAvg = allTotal / 12;
const catSum = c => sum(allL12.filter(r => (Array.isArray(c) ? c.includes(r.cat) : r.cat === c)).map(r => r.price)) / 12;
const FOOD = ['장보기', '유제품·계란', '채소·과일', '고기·수산', '간편식·가공', '음료·생수'];
const groceryStores = new Set(bankOut.filter(r => r.cat === '장보기').map(r => r.desc)).size;
const groceryVisits = bankOut.filter(r => r.cat === '장보기').length + last12Rows.filter(r => FOOD.includes(r.cat)).length;
const payCharge = bankOut.filter(r => r.cat === '페이 충전'), payChargeSum = sum(payCharge.map(r => r.price));
const allSmall = allL12.filter(r => r.price <= 10000);
const payDays = new Set(allL12.map(r => r.d.toDateString())).size;
const coupangL12 = l12Total;

// AI 가 제안하는 월 예산: 카테고리 묶음별 현재 월평균에 AI 가 정한 조정률을 곱한다 (조정률이 판단이다)
const PLAN = [
  { k: '육아', cats: ['육아'], rate: -0.05, why: '필수라 유지, 정기배송·대용량으로 단가만 5%' },
  { k: '식비 (장보기·식품)', cats: FOOD, rate: -0.15, why: '장보기를 주 2회로 묶어 계획 밖 구매를 줄임' },
  { k: '외식·배달·카페', cats: ['외식', '배달', '카페/간식', '편의점'], rate: -0.2, why: '주말 한 번으로 정해 두기' },
  { k: '생활·쇼핑', cats: ['생활·주방', '쇼핑', '뷰티·패션', '온라인쇼핑'], rate: -0.15, why: '장바구니에 담고 다음 장보기 날 결제' },
  { k: '전자·가전', cats: ['전자·가전'], rate: -0.5, why: '5만 원 넘으면 3일 기다리기' },
  { k: '병원·약국·영양제', cats: ['병원·약국', '영양제'], rate: 0, why: '건강 지출은 줄이지 않음' },
  { k: '교통·차량', cats: ['교통·차량'], rate: 0, why: '고정 성격이라 유지' },
  { k: '기타', cats: ['기타', '이체/송금', '페이 충전'], rate: -0.1, why: '분류가 정리되면 다시 판단' },
].map(p => { const cur = catSum(p.cats); return { ...p, cur, next: cur * (1 + p.rate) }; });
const planCur = sum(PLAN.map(p => p.cur)), planNext = sum(PLAN.map(p => p.next));

// 현재 vs 제안 가로 막대
function planChart() {
  const W = 1040, rowH = 50, L = 300, R = 170, H = PLAN.length * rowH, max = Math.max(...PLAN.map(p => p.cur));
  const sx = v => (W - L - R) * v / max;
  return svg(W, H, '카테고리별 현재 월평균과 AI 제안 예산', PLAN.map((p, i) => { const y = i * rowH; return `<g data-tip="${esc(p.k)}\n현재 월평균 ${won(p.cur)}원\n제안 ${won(p.next)}원 (${p.rate ? Math.round(p.rate * 100) + '%' : '유지'})\n${esc(p.why)}"><rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/><text class="lbl" x="${L - 12}" y="${y + 21}" text-anchor="end">${esc(p.k)}</text><text class="ax" x="${L - 12}" y="${y + 39}" text-anchor="end">${esc(cut(p.why, 24))}</text><rect class="b" x="${L}" y="${y + 7}" width="${Math.max(2, sx(p.cur))}" height="18"/><rect class="b hi" x="${L}" y="${y + 12}" width="${Math.max(2, sx(p.next))}" height="8"/><text class="val" x="${L + sx(p.cur) + 10}" y="${y + 21}">${man(p.cur)} → ${man(p.next)}원</text></g>`; }).join('') + `<line class="axis" x1="${L}" x2="${L}" y1="0" y2="${H}"/>`);
}

// ---------- 육아 세부 분석 (AI 분석용) ----------
// 세부 분류는 AI 가 상품명을 보고 정한 것이다. 쿠팡 '육아' + 아이용 소포장 우유(쿠팡 '유제품'), 은행의 어린이집·소아과·키즈카페를 합친다.
const BABY_SUB = [
  ['산모용품', /맘스|흉터|제왕절개|임산부|수유브라|엽산|예비맘/],
  ['기저귀', /기저귀/],
  ['분유·영양제', /분유(?!케이스)|베이비드롭|프로바이오틱스/],
  ['이유식 고기·생선', /한우|베이비로인|칼로다진|닭가슴살|닭안심|가자미|우둔/],
  ['이유식·유아식 완제품', /레토르트|맘마밀|배냇밀|키즈죽|퓨레|진밥|완료기|이유식 3종|이유식 12개월|다이어트 이유식/],
  ['이유식 재료·양념', /쌀가루|간장소스|된장|콩나물/],
  ['아기 치즈·간식', /치즈|떡뻥|아이얌|곡물친구|어린이 김/],
  ['아이 우유', /상하목장 유기농 우유/],
  ['위생·스킨케어', /로션|크림|수딩젤|워시|물티슈|치약|칫솔|비누|샴푸|파우더|세정제|제균|소독|토이클리너|스폰지|타올|손타월|모이스|촉촉/],
  ['수유·식사용품', /젖병|쪽쪽이|젖꼭지|턱받이|빨대컵|빕|용기|푸드매셔|칼|분유케이스|거름채망|지퍼백|다용도 통/],
  ['놀이·교구', /퍼즐매트|사운드|그네|피크닉매트|미술가운|튜브|토핑 이유식/],
  ['가구·안전·의류', /안전|서랍|디딤대|범보|포대기|욕조|옷걸이|슬리퍼|운동화|손싸개|손수건|누빔|바구니|비데|네일|샴푸캡/],
];
const babySub = name => (BABY_SUB.find(([, re]) => re.test(name)) || ['기타 육아'])[0];
const babyRows = [
  ...rows.filter(r => r.cat === '육아' || /상하목장 유기농 우유/.test(r.item)).map(r => ({ d: r.d, pm: r.pm, price: r.price, sub: babySub(r.item), item: r.item, src: '쿠팡' })),
  ...SD.bank.filter(r => r[1] === '출금').map(([d, , amt, cat, desc]) => ({ d: toD(d), pm: ym(toD(d)), ds: d.slice(0, 10).replace(/[.]/g, '-'), price: -amt, sub: /어린이집/.test(desc) ? '어린이집' : /소아/.test(desc) ? '아이 병원' : cat === '육아' ? '키즈카페·체험' : null, src: '은행' })).filter(r => r.sub),
];
const babyL12 = babyRows.filter(r => winSet.has(r.pm));
const babyTotal = sum(babyL12.map(r => r.price));
const babyBySub = Object.entries(babyL12.reduce((m, r) => (m[r.sub] = (m[r.sub] || 0) + r.price, m), {})).sort((a, b) => b[1] - a[1]);
const babyAmt = k => (babyBySub.find(e => e[0] === k) || [, 0])[1];
const halfOf = pm => pm.slice(0, 4) + (+pm.slice(5) <= 6 ? ' 상' : ' 하');
const halves = [...new Set(babyRows.filter(r => r.pm >= '2024-07').map(r => halfOf(r.pm)))].sort();
const HALF_CATS = [...babyBySub.slice(0, 5).map(e => e[0]), '그 외'];
const halfData = halves.map(h => { const rs = babyRows.filter(r => halfOf(r.pm) === h); return { h, parts: HALF_CATS.map(c => sum(rs.filter(r => (HALF_CATS.slice(0, -1).includes(r.sub) ? r.sub : '그 외') === c).map(r => r.price))), months: new Set(rs.map(r => r.pm)).size }; });
const subHalf = (k, h) => sum(babyRows.filter(r => r.sub === k && halfOf(r.pm) === h).map(r => r.price));

// 기저귀 장당 가격 (같은 단계·같은 제품끼리 비교)
const diapers = rows.filter(r => /기저귀/.test(r.item) && !/맘스|성인|물놀이|수영장/.test(r.item)).map(r => { const sh = +(r.item.match(/(\d+)매/) || [])[1]; const st = +(r.item.match(/(\d)단계/) || [])[1]; return { ...r, sh, st, per: sh ? r.price / (sh * r.qty) : null }; }).filter(r => r.per);
const d5 = diapers.filter(r => r.st === 5 && winSet.has(r.pm));
const d5min = Math.min(...d5.map(r => r.per)), d5max = Math.max(...d5.map(r => r.per)), d5med = median(d5.map(r => r.per));
const diaperSave = sum(d5.map(r => (r.per - d5min) * r.sh * r.qty));
const d6 = diapers.filter(r => r.st === 6).sort((a, b) => b.d - a.d)[0];
// 아이 우유: 최근 4개월 양과 주기
const milkPms = last12.slice(-4).map(x => x.m);
const milk4 = rows.filter(r => /상하목장 유기농 우유/.test(r.item) && milkPms.includes(r.pm));
const milkMl = sum(milk4.map(r => (+(r.item.match(/(\d+)ml/) || [])[1] || 0) * (+(r.item.match(/(\d+)개/) || [])[1] || 1) * r.qty));
const milkDays = days.filter(x => milkPms.includes(x.pm)).length;
const milkPerMl = milk4.length ? sum(milk4.map(r => r.price)) / milkMl : 0;
const milkGap = (() => { const ds = [...new Set(milk4.map(r => r.ds))].sort().map(x => new Date(x)); return ds.length > 1 ? median(ds.slice(1).map((d, i) => (d - ds[i]) / 864e5)) : null; })();
const careBrands = new Set(rows.filter(r => winSet.has(r.pm) && (r.cat === '육아' && babySub(r.item) === '위생·스킨케어')).map(r => r.item.split(/\s/)[0])).size;
const daycare = babyRows.filter(r => r.sub === '어린이집').sort((a, b) => a.d - b.d);

// 반기별 누적 막대
function halfChart() {
  const W = 1040, H = 280, L = 48, R = 8, T = 16, B = 34, n = halfData.length, step = (W - L - R) / n, bw = Math.min(70, step * 0.55);
  const max = niceMax(Math.max(...halfData.map(x => sum(x.parts)))), h = v => (H - T - B) * v / max, x = i => L + step * (i + 0.5);
  let out = [0, .5, 1].map(f => `<line class="grid" x1="${L}" x2="${W - R}" y1="${T + h(max * (1 - f))}" y2="${T + h(max * (1 - f))}"/><text class="ax" x="${L - 8}" y="${T + h(max * (1 - f)) + 4}" text-anchor="end">${f ? man(max * f) : '0'}</text>`).join('');
  halfData.forEach((d, i) => { let y = H - B; out += `<g data-tip="${d.h}반기 (${d.months}개월)\n${HALF_CATS.map((c, j) => d.parts[j] ? `${c} ${man(d.parts[j])}원` : '').filter(Boolean).join('\n')}"><rect class="hit" x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}"/>` + d.parts.map((v, j) => { if (!v) return ''; y -= h(v); return `<rect class="s${j}" x="${x(i) - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, h(v) - 1)}"/>`; }).join('') + `<text class="val" x="${x(i)}" y="${H - B - h(sum(d.parts)) - 6}" text-anchor="middle">${man(sum(d.parts))}</text><text class="ax" x="${x(i)}" y="${H - 10}" text-anchor="middle">${d.h}${d.months < 6 ? '*' : ''}</text></g>`; });
  return svg(W, H, '반기별 육아 지출 구성', out);
}
// 기저귀 장당 가격 점그래프 (5단계, 시간순)
function diaperChart() {
  const pts = diapers.filter(r => r.st >= 5).sort((a, b) => a.d - b.d), W = 1040, H = 240, L = 56, R = 16, T = 20, B = 34;
  const t0 = +pts[0].d, t1 = +pts.at(-1).d, lo = Math.floor(Math.min(...pts.map(p => p.per)) / 50) * 50, hi = Math.ceil(Math.max(...pts.map(p => p.per)) / 50) * 50;
  const x = t => L + (W - L - R) * (t - t0) / (t1 - t0 || 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let out = Array.from({ length: (hi - lo) / 50 + 1 }, (_, i) => lo + i * 50).map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}원</text>`).join('');
  out += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(d5med)}" y2="${y(d5med)}"/><text class="reflbl" x="${W - R}" y="${y(d5med) - 6}" text-anchor="end">5단계 최근 12개월 중앙값 ${Math.round(d5med)}원</text>`;
  out += pts.map(p => `<g data-tip="${p.ds} · ${p.st}단계 ${p.sh}매\n${won(p.price)}원 → 장당 ${Math.round(p.per)}원"><circle class="${p.st === 6 ? 'dot-accent' : 'ring-dot'}" cx="${x(+p.d)}" cy="${y(p.per)}" r="${p.st === 6 ? 6 : 5}"/></g>`).join('');
  const yrs = [...new Set(pts.map(p => p.d.getFullYear()))];
  out += yrs.map(yr => { const t = Math.max(t0, +new Date(yr, 0, 1)); return `<text class="ax" x="${x(t)}" y="${H - 10}">${yr}</text>`; }).join('');
  return svg(W, H, '기저귀 장당 가격 변화', out);
}

// ---------- 본문 ----------
const babyUp = g2325.find(x => x.c === '육아').d;
const l12Avg = l12Total / 12;
const yrLabel = y => y.y + (y.months < 12 ? `*` : '');
const binLabels = BINS.map(b => b[0]);
const asOf = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

// [순수 데이터] 쿠팡 4년 통계. index.html '순수 데이터' 탭 아래에 붙는다. 해석·조언 문장을 넣지 않는다.
const stats = `<section class="bare"><h2>쿠팡 4년 통계 · ${months[0]} ~ ${months.at(-1)}</h2><p class="lede">월급 월 ${months.length}개월, 주문 ${inWin.length.toLocaleString()}건. 2023-01과 진행 중인 ${ym(TODAY)}은 기간이 모자라 뺐다. 쿠팡 주문목록에 표시된 금액(할인 전).</p></section>

<section id="trend">
<h2>월별 추이</h2>
<p class="lede">막대는 월급 월 지출, 파란 선은 12개월 이동평균. 빨간 막대는 평균보다 표준편차 1.5배 이상 높은 달(z ≥ 1.5)이고, 위에 그달 가장 큰 주문을 적었다.</p>
<figure>${monthChart()}<figcaption>월 평균 ${won(mMean)}원, 표준편차 ${won(mSd)}원. 선형 추세 기울기 한 달 ${trend.b >= 0 ? '+' : ''}${won(trend.b)}원, R² ${trend.r2.toFixed(2)}.</figcaption></figure>
<div class="three">
<div><h3>월평균 지출</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.avgM, tip: `${y.y} 월평균 ${won(y.avgM)}원` })), v => man(v))}</figure></div>
<div><h3>한 달 주문 건수</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.nM, tip: `${y.y} 한 달 ${y.nM.toFixed(1)}건` })), v => v.toFixed(0) + '건')}</figure></div>
<div><h3>건당 평균 금액</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.ticket, tip: `${y.y} 건당 평균 ${won(y.ticket)}원, 중앙값 ${won(y.med)}원` })), v => man(v))}</figure></div>
</div>
<p class="note">* 열두 달이 다 차지 않은 해 (2023년 11개월, 2026년 ${Y['2026'] ? Y['2026'].months : 0}개월).</p>
</section>

<section id="where">
<h2>카테고리 변화</h2>
<p class="lede">2023년 → 2025년 월평균 차이 ${totalUp2325 >= 0 ? '+' : ''}${man(totalUp2325)}원 = 주문 건수 변화분 ${decomp.byCount >= 0 ? '+' : ''}${man(decomp.byCount)}원 + 건당 금액 변화분 ${decomp.byTicket >= 0 ? '+' : ''}${man(decomp.byTicket)}원.</p>
<figure>${divBars(g2325.filter(x => Math.abs(x.d) >= 3000).map(x => ({ k: x.c, v: x.d })), v => `${v >= 0 ? '+' : ''}${man(v)}원`)}<figcaption>카테고리별 월평균 차이, 2023 → 2025. 파랑은 증가, 회색은 감소.</figcaption></figure>
<h3>카테고리별 월평균, 연도별</h3>
<figure>${catYearChart()}${legend(byYear.map(y => y.y), true)}<figcaption>오른쪽 숫자는 ${byYear.at(-1).y}년 월평균. 육아용품 첫 구매 ${firstBaby ? firstBaby.ds : '-'}. 분류는 cats.js 키워드 기준, '기타'는 최근 12개월의 ${share(catL12['기타'], l12Avg)}.</figcaption></figure>
</section>

<section id="when">
<h2>월급 주기와 요일</h2>
<div class="two">
<div>
<h3>월급 주기 (하루 평균)</h3>
<p class="lede">월급 후 1주 ${won(cycStats[0].m)}원, 나머지 기간 ${won(cycStats[0].m - cycTest.diff)}원. 차이 ${won(cycTest.diff)}원, ${pv(cycTest.p)}.</p>
<figure>${ciBars(cycStats, it => it === cycStats[0])}</figure>
</div>
<div>
<h3>요일 (하루 평균)</h3>
<p class="lede">주말 ${won(mean(weekend))}원, 평일 ${won(mean(weekday))}원. 차이 ${won(wk.diff)}원(±${won(wk.ci)}), ${pv(wk.p)}.</p>
<figure>${ciBars(dowStats, it => it.k === '토' || it.k === '일')}</figure>
</div>
</div>
<p class="note">주문 없는 날은 0원으로 넣은 하루 평균. 가로선은 95% 신뢰구간, 검정은 Welch t-검정(정규근사). 전체 ${days.length}일 중 주문한 날 ${orderDays}일(${share(orderDays, days.length)}).</p>
</section>

<section id="size">
<h2>주문 크기</h2>
<p class="lede">최근 12개월 1만 원 이하 주문 ${l12Small.length}건: 건수의 ${share(l12Small.length, last12Rows.length)}, 금액의 ${share(sum(l12Small.map(r => r.price)), l12Total)}.</p>
<div class="two">
<div><h3>건수 구성</h3><figure>${stack100(dist.map(d => ({ k: d.y, parts: d.n })), binLabels)}</figure></div>
<div><h3>금액 구성</h3><figure>${stack100(dist.map(d => ({ k: d.y, parts: d.s })), binLabels)}</figure></div>
</div>
${legend(binLabels)}
</section>

<section id="repeat">
<h2>반복 구매</h2>
<p class="lede">최근 12개월 4회 이상 산 품목 상위 12개: ${man(recurTotal)}원, 쿠팡 지출의 ${share(recurTotal, l12Total)}. 회색 글자는 구매 간격 중앙값.</p>
<figure>${hbars(recurring.map(r => ({ k: r.k, v: r.s, n: r.n, gap: r.gap, cat: r.cat, tip: `${r.k}\n${r.cat} · ${r.n}회 · ${won(r.s)}원\n구매 간격 중앙값 ${r.gap == null ? '-' : Math.round(r.gap) + '일'}` })), { labelW: 330, hiN: 3, sub: it => `${it.cat} · ${it.gap == null ? '' : Math.round(it.gap) + '일마다'}`, fmt: (v, it) => `${man(v)}원 · ${it.n}회` })}</figure>
<p class="note">같은 날 같은 상품이 두 줄 이상인 경우 ${dups.length}건, 추가분 ${won(dupExtra)}원.</p>
</section>
`;

// [AI 분석] Claude 가 ${asOf} 데이터를 보고 쓴 판단과 소비 가이드. 숫자는 매번 다시 계산되지만 판단 문장은 이 날짜 기준이다.
// 데이터 건수가 AI_BASIS 와 달라지면 '다시 분석 필요' 안내가 뜬다 → 그때 AI 에게 다시 분석을 맡기고 이 문장들을 고친다.
const AI_BASIS = { date: '2026-11-08', coupang: 2269, bank: 569 };
const stale = SD.coupang.length !== AI_BASIS.coupang || SD.bank.length !== AI_BASIS.bank;
const report = `<header class="top">
${stale ? `<p class="total" style="margin-top:0"><span>이 분석은 ${AI_BASIS.date} 데이터(쿠팡 ${AI_BASIS.coupang.toLocaleString()}건, 은행 ${AI_BASIS.bank}건)로 쓴 것입니다. 지금 데이터는 쿠팡 ${SD.coupang.length.toLocaleString()}건, 은행 ${SD.bank.length}건이라 판단 문장이 맞지 않을 수 있습니다. AI에게 다시 분석을 요청하세요.</span></p>` : ''}
<p class="note">Claude(추론형 AI)가 ${AI_BASIS.date}에 쿠팡 4년치와 카카오뱅크 1년치를 보고 쓴 의견입니다. 숫자는 데이터에서 다시 계산되지만, 해석·우선순위·세부 분류·예산 조정률은 AI의 판단입니다. 계산 결과만 보려면 '순수 데이터' 탭을 보세요.</p>
<h1>소비의 ${share(babyTotal / 12, allAvg)}가 육아이고, 그 절반이 기저귀와 아이 우유입니다</h1>
<p class="verdict">최근 12개월 쿠팡과 카카오뱅크로 확인되는 소비는 월 <b>${man(allAvg)}원</b>입니다. 그중 아이에게 들어간 돈이 월 <b>${man(babyTotal / 12)}원</b>으로 가장 큽니다. 아이가 크면서 생긴 지출이라 줄이기보다 <b>같은 것을 더 싸게 사는 쪽</b>이 맞습니다. 육아 밖에서는 장보기가 너무 잘게 쪼개져 있습니다.</p>
<div class="kpis figs">
<div class="kpi accent"><div class="k">보이는 소비 (월평균)</div><div class="v">${man(allAvg).replace('만', '')}<small>만원</small></div><div class="d">쿠팡 ${man(coupangL12 / 12)} + 은행 ${man(sum(bankOut.map(r => r.price)) / 12)}</div></div>
<div class="kpi"><div class="k">육아 (월평균)</div><div class="v">${man(babyTotal / 12).replace('만', '')}<small>만원</small></div><div class="d">우유·어린이집·소아과 포함, 소비의 ${share(babyTotal / 12, allAvg)}</div></div>
<div class="kpi"><div class="k">기저귀 (월평균)</div><div class="v">${man(babyAmt('기저귀') / 12).replace('만', '')}<small>만원</small></div><div class="d">장당 ${Math.round(d5min)}~${Math.round(d5max)}원 (5단계)</div></div>
<div class="kpi"><div class="k">아이 우유 (월평균)</div><div class="v">${man(babyAmt('아이 우유') / 12).replace('만', '')}<small>만원</small></div><div class="d">최근엔 ${milkGap ? Math.round(milkGap) + '일마다' : ''} 24개씩</div></div>
</div>
</header>

<section>
<h2>진단</h2>
<ol class="points">
<li><b>가장 큰 지출은 육아입니다.</b> 쿠팡 육아용품에 아이용 소포장 우유, 어린이집, 소아과를 더하면 최근 12개월 ${man(babyTotal)}원, 소비의 ${share(babyTotal / 12, allAvg)}입니다. 쿠팡 2023→2025 증가분의 ${share(babyUp, totalUp2325)}도 육아였습니다. 분유에서 이유식, 기저귀 큰 단계, 어린이집으로 옮겨 가는 구조적인 증가라 '낭비'로 보기 어렵습니다.</li>
<li><b>장보기가 너무 잘게 쪼개져 있습니다.</b> 마트·슈퍼 ${groceryStores}곳과 쿠팡 식품을 합쳐 1년에 ${groceryVisits}번 장을 봤고, 1년 중 ${payDays}일 무언가를 결제했습니다. 식비는 월 ${man(catSum(FOOD))}원입니다. 자주 사는 습관은 계획에 없던 물건을 같이 담게 만듭니다.</li>
<li><b>작은 결제가 절반입니다.</b> 1만 원 이하 결제가 ${allSmall.length}건으로 전체의 ${share(allSmall.length, allL12.length)}입니다. 한 건은 작아도 장바구니를 여는 횟수 자체가 지출을 늘립니다.</li>
<li><b>주말보다는 '횟수'가 문제입니다.</b> 쿠팡만 보면 주말에 더 쓰지만(${pv(wk.p)}), 은행까지 합치면 주말 비중은 ${share(sum(allL12.filter(r => [0, 6].includes(r.d.getDay())).map(r => r.price)), allTotal)}로 일주일 중 주말 비율(29%)과 큰 차이가 없습니다.</li>
</ol>
</section>

<section id="baby">
<h2>육아 자세히 보기</h2>
<p class="lede">최근 12개월 ${man(babyTotal)}원을 AI가 상품명으로 ${babyBySub.length}가지로 나눴습니다. 쿠팡 '유제품'에 있던 아이용 소포장 우유와, 은행의 어린이집·소아과·키즈카페도 넣었습니다.</p>
<figure>${hbars(babyBySub.map(([k, v]) => ({ k, v, tip: `${k}\n최근 12개월 ${won(v)}원 · 육아의 ${share(v, babyTotal)}` })), { labelW: 220, hiN: 2, fmt: v => `${man(v)}원 · ${share(v, babyTotal)}` })}</figure>
<h3>반기별 흐름: 무엇에서 무엇으로 옮겨 갔나</h3>
<figure>${halfChart()}${legend(HALF_CATS)}<figcaption>* 표시는 6개월이 다 차지 않은 반기. 은행 거래(어린이집·소아과)는 2025년 11월부터만 있습니다.</figcaption></figure>
<h3>기저귀 장당 가격</h3>
<figure>${diaperChart()}<figcaption>점 하나가 주문 한 번입니다(같은 제품 5·6단계, 물놀이 기저귀 제외). 파란 점은 6단계.</figcaption></figure>

<h3>항목별 판단</h3>
<ol class="points">
<li><b>기저귀: 같은 제품도 언제 사느냐에 따라 ${share(d5max - d5min, d5min)} 차이.</b> 최근 12개월 5단계 184매를 장당 ${Math.round(d5min)}원에 산 적도, ${Math.round(d5max)}원에 산 적도 있습니다. 매번 가장 싸게 샀다면 1년에 ${man(diaperSave)}원을 덜 썼습니다. ${d6 ? `${d6.ds}에는 6단계(장당 ${Math.round(d6.per)}원)로 넘어갔습니다. ` : ''}배변 훈련을 시작할 시기라 기저귀 지출은 앞으로 줄어들 가능성이 큽니다. 그 전까지는 가격이 내려갔을 때 2~3팩씩 사 두는 것이 가장 쉬운 절약입니다.</li>
<li><b>아이 우유: 양이 많아졌습니다.</b> 125ml에서 200ml로 바뀌었고, 최근 4개월은 ${milkGap ? Math.round(milkGap) + '일마다' : '자주'} 24개씩 사서 하루 약 ${Math.round(milkMl / milkDays)}ml 꼴입니다(ml당 ${milkPerMl.toFixed(1)}원). 아이 혼자 마시는 양으로는 많은 편이라, 가족이 같이 마신다면 어른 몫은 대용량 팩으로 나누는 게 낫습니다. 아이 몫만 소포장으로 사면 이 항목은 크게 줄어듭니다.</li>
<li><b>이유식 고기·생선: 정점을 지나 자연스럽게 줄고 있습니다.</b> 2025년 하반기 ${man(subHalf('이유식 고기·생선', '2025 하'))}원에서 최근 반기 ${man(subHalf('이유식 고기·생선', halves.at(-1)))}원으로 내려왔습니다. 가족 식사로 넘어가는 중이니 따로 관리할 필요는 없습니다.</li>
<li><b>이유식·유아식 완제품: 늘고 있습니다.</b> 최근 12개월 ${man(babyAmt('이유식·유아식 완제품'))}원입니다. 바쁜 날을 위한 비상용으로만 두고, 어른 반찬에서 덜어 주는 날을 늘리면 고기·생선 재료비와 함께 줄어듭니다.</li>
<li><b>위생·스킨케어: 제품 가짓수가 많습니다.</b> 최근 12개월 ${man(babyAmt('위생·스킨케어'))}원, 브랜드가 ${careBrands}가지입니다. 로션·크림·수딩젤·워시를 한두 가지로 정해 대용량으로 사면 단가가 내려갑니다.</li>
<li><b>어린이집: 새로 생긴 고정비입니다.</b> ${daycare.length ? `${daycare[0].ds.slice(0, 7)}부터 시작했고 첫 달 ${man(daycare.filter(r => r.pm === daycare[0].pm).reduce((s, r) => s + r.price, 0))}원(입소 비용 포함으로 보임), 이후 달마다 ${man(median(daycare.slice(1).map(r => r.price)))}원 안팎입니다.` : ''} 줄일 대상이 아니라 매달 예산에 미리 잡아 둘 항목입니다.</li>
<li><b>놀이·교구, 가구·안전용품: 한 번에 크게 나갑니다.</b> 퍼즐매트처럼 몇 년 쓰는 물건은 중고나 물려받기를 먼저 알아보면 좋습니다.</li>
<li><b>분유는 이미 끝났습니다.</b> 2024년 하반기~2025년 상반기에 ${man(subHalf('분유·영양제', '2024 하') + subHalf('분유·영양제', '2025 상'))}원이었고, 지금은 거의 없습니다. 소아과는 1회 3~8천 원대로 금액이 작습니다.</li>
</ol>
</section>

<section>
<h2>소비 가이드</h2>
<p class="lede">효과가 크고 바로 할 수 있는 순서입니다.</p>
<ol class="points">
<li><b>기저귀는 가격이 내려갔을 때 2~3팩씩.</b> 장당 ${Math.round(d5min)}원 근처면 사고, ${Math.round(d5med)}원(중앙값)보다 비싸면 미룹니다. 1년에 ${man(diaperSave)}원 정도 차이가 납니다.</li>
<li><b>우유는 아이 몫과 어른 몫을 나눠 사기.</b> 아이 몫만 소포장으로 사면 지금 월 ${man(babyAmt('아이 우유') / 12)}원인 항목이 크게 줄어듭니다.</li>
<li><b>장보기는 주 2회, 정해진 요일에.</b> 목록을 먼저 쓰고 한 곳에서 몰아 삽니다. 쿠팡은 반복해서 사는 필수품만 남깁니다.</li>
<li><b>아기 스킨케어·세정제는 한두 가지로 정해 대용량으로.</b></li>
<li><b>작은 물건은 장바구니에 담아 두고 장보기 날 한 번에 결제.</b> 결제 횟수만 줄여도 계획 밖 구매가 같이 줄어듭니다.</li>
<li><b>5만 원이 넘는 비필수품은 3일 기다리기.</b> 최근 12개월 전자·가전 같은 비필수 단건이 ${bigNoness.length}건, ${man(sum(bigNoness.map(r => r.price)))}원이었습니다.</li>
</ol>
</section>

<section>
<h2>AI 제안 월 예산</h2>
<p class="lede">쿠팡+카카오뱅크 기준(네이버페이 충전 제외). 회색 막대는 최근 12개월 월평균, 파란 막대는 AI가 제안하는 예산입니다. 조정률은 AI의 판단입니다.</p>
<figure>${planChart()}</figure>
<div class="total"><span>제안 예산 합계 (월)</span><strong>${man(planNext)}원</strong></div>
<p class="note">지금 월평균 ${man(planCur)}원에서 월 ${man(planCur - planNext)}원, 1년 ${man((planCur - planNext) * 12)}원을 줄이는 안입니다. 여기서 '육아'는 쿠팡 육아용품과 은행 육아 거래이고, 아이 우유는 '식비'에 들어 있습니다. '순수 데이터' 탭의 월 예산 칸에 넣으면 넘은 달을 볼 수 있습니다.</p>
</section>

<section>
<h2>쿠팡 절감 시나리오</h2>
<p class="lede">쿠팡 최근 12개월(${last12[0].m} ~ ${last12.at(-1).m}, ${man(l12Total)}원) 기준. 각 줄 아래 회색 글자가 AI가 정한 가정입니다.</p>
<figure>${hbars(SAVE.map(s => ({ k: s.what, v: s.save, rule: s.rule, tip: `${s.what}\n근거: ${s.basis}, ${won(s.base)}원\n가정: ${s.rule}\n연 ${won(s.save)}원` })), { labelW: 330, hiN: SAVE.length, sub: it => it.rule })}</figure>
<div class="total"><span>연 절감 여력 합계 (가정)</span><strong>${man(saveTotal)}원</strong></div>
<p class="note">항목끼리 일부 겹치므로(주말의 소액 주문은 두 항목에 다 들어간다) 합계는 상한에 가깝다.</p>
</section>

<section>
<h2>이 분석의 한계</h2>
<ol class="points">
<li><b>쿠팡 금액은 할인 전이고 취소·반품이 빠지지 않았습니다.</b> 실제 결제액은 이보다 적습니다.</li>
<li><b>은행 내역은 1년치뿐입니다.</b> 쿠팡처럼 몇 년치를 비교할 수 없습니다. 현대·KB 카드 대금과 네이버페이 충전은 이 분석에서 뺐습니다.</li>
<li><b>카테고리와 육아 세부 분류는 상품명·상호 키워드로 나눴습니다.</b> 아이 우유처럼 가족이 같이 쓰는 물건은 실제로 누가 썼는지 알 수 없습니다.</li>
</ol>
</section>
`;

fs.writeFileSync(path.join(__dirname, 'report_body.js'), `// report.js 가 만든 파일. 직접 고치지 말 것. index.html 이 불러온다.\n// REPORT_HTML: 'AI 분석' 탭 (AI 판단·가이드), STATS_HTML: '순수 데이터' 탭 아래 쿠팡 4년 통계 (계산 결과만)\nwindow.REPORT_HTML = ${JSON.stringify(report)};\nwindow.STATS_HTML = ${JSON.stringify(stats)};\n`);
console.log(`report_body.js: 보이는 소비 월 ${won(allAvg)}, 육아 월 ${won(babyTotal / 12)}, 제안 예산 월 ${won(planNext)}, 쿠팡 절감 ${won(saveTotal)}${stale ? ' (AI 판단 다시 필요)' : ''}`);
