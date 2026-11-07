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
    rows.push({ d, ds: c[0], item, price: +c[2], qty: +c[3], cat: classify(item), pm: ym(d) });
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

// 예산 제안: 최근 12개월 중앙값
const budget = Math.round(median(last12.map(x => x.sum)) / 10000) * 10000;
const overBudget = last12.filter(x => x.sum > budget);

// ---------- 출력 도구 ----------
const won = n => Math.round(n).toLocaleString('ko-KR');
const man = n => { const v = n / 10000; return (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1).replace(/\.0$/, '')) + '만'; };
const pct = (a, b) => `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%`;
const share = (a, b) => `${Math.round(a / b * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pv = p => p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
const niceMax = v => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil(v / p / 2.5) * 2.5 * p; };
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
function budgetChart() {
  const W = 1040, H = 240, L = 48, R = 8, T = 24, B = 30, n = last12.length, step = (W - L - R) / n, bw = Math.min(40, step - 14);
  const max = niceMax(Math.max(...last12.map(x => x.sum))), x = i => L + step * (i + 0.5), y = v => T + (H - T - B) * (1 - v / max);
  let s = [0, .5, 1].map(f => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="ax" x="${L - 8}" y="${y(max * f) + 4}" text-anchor="end">${f ? man(max * f) : '0'}</text>`).join('');
  s += last12.map((m, i) => `<g data-tip="${m.m}\n${won(m.sum)}원${m.sum > budget ? `\n예산보다 ${won(m.sum - budget)}원 많음` : ''}"><rect class="hit" x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}"/><rect class="b ${m.sum > budget ? 'over' : ''}" x="${x(i) - bw / 2}" y="${y(m.sum)}" width="${bw}" height="${y(0) - y(m.sum)}"/><text class="ax" x="${x(i)}" y="${H - 10}" text-anchor="middle">${+m.m.slice(5)}월</text></g>`).join('');
  s += `<line class="ref-warn" x1="${L}" x2="${W - R}" y1="${y(budget)}" y2="${y(budget)}"/><text class="reflbl" x="${L + 6}" y="${y(budget) - 7}">제안 예산 ${man(budget)}원</text>`;
  return svg(W, H, '최근 12개월 지출과 제안 예산', s);
}

const legend = (labels, rev = false) => `<div class="legend">${labels.map((k, j) => `<span><i class="s${rev ? labels.length - 1 - j : j}"></i>${esc(k)}</span>`).join('')}</div>`;

// ---------- 본문 ----------
const babyUp = g2325.find(x => x.c === '육아').d;
const l12Avg = l12Total / 12;
const yrLabel = y => y.y + (y.months < 12 ? `*` : '');
const binLabels = BINS.map(b => b[0]);

// 리포트 본문. index.html 의 '쿠팡 4년 리포트' 탭에 들어간다 (report_body.js)
const body = `<header class="top">
<p class="note">${months[0]} ~ ${months.at(-1)} 월급 월 ${months.length}개월, 주문 ${inWin.length.toLocaleString()}건. 월급날 25일 기준. ${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')} 작성.</p>
<h1>쿠팡 지출이 2023년보다 ${pct(l12Avg, Y['2023'].avgM).replace('+', '')} 늘었다</h1>
<p class="verdict">최근 12개월 월평균은 <b>${man(l12Avg)}원</b>. 2023→2025년 늘어난 돈의 ${share(babyUp, totalUp2325)}가 육아이고, 그다음은 식비다. 계산상 줄일 여력은 연 <b>${man(saveTotal)}원</b>.</p>
<div class="kpis figs">
<div class="kpi accent"><div class="k">최근 12개월 월평균</div><div class="v">${man(l12Avg).replace("만", "")}<small>만원</small></div></div>
<div class="kpi"><div class="k">2023년 월평균 대비</div><div class="v">${pct(l12Avg, Y['2023'].avgM)}</div></div>
<div class="kpi"><div class="k">1만 원 이하 주문 비율</div><div class="v">${share(l12Small.length, last12Rows.length)}</div></div>
<div class="kpi"><div class="k">연 절감 여력 (가정 포함)</div><div class="v">${man(saveTotal).replace("만", "")}<small>만원</small></div></div>
</div>
</header>

<section id="trend">
<h2>월별 추이</h2>
<p class="lede">막대가 월급 월(전월 25일~당월 24일) 지출, 파란 선이 12개월 이동평균이다. 빨간 막대는 평균보다 크게 튄 달이고 위에 그달 가장 큰 주문을 적었다.</p>
<figure>${monthChart()}<figcaption>월 평균 ${won(mMean)}원, 표준편차 ${won(mSd)}원. 선형 추세 한 달 ${trend.b >= 0 ? '+' : ''}${won(trend.b)}원(R² ${trend.r2.toFixed(2)}): 달마다 흔들림이 추세보다 크다. 2023-01과 진행 중인 ${ym(TODAY)}은 뺐다.</figcaption></figure>
<div class="three">
<div><h3>월평균 지출</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.avgM, tip: `${y.y} 월평균 ${won(y.avgM)}원` })), v => man(v))}</figure></div>
<div><h3>한 달 주문 건수</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.nM, tip: `${y.y} 한 달 ${y.nM.toFixed(1)}건` })), v => v.toFixed(0) + '건')}</figure></div>
<div><h3>건당 평균 금액</h3><figure>${miniBars(byYear.map(y => ({ k: yrLabel(y), v: y.ticket, tip: `${y.y} 건당 평균 ${won(y.ticket)}원, 중앙값 ${won(y.med)}원` })), v => man(v))}</figure></div>
</div>
<p class="note">* 표시는 열두 달이 다 차지 않은 해(2023년 11개월, 2026년 ${Y['2026'] ? Y['2026'].months : 0}개월). 건수는 늘고 건당 금액은 그대로라는 게 한눈에 보인다.</p>
</section>

<section id="where">
<h2>어디서 늘었나</h2>
<p class="lede">2023년 → 2025년 월평균 +${man(totalUp2325)}원. 주문 건수가 늘어서 ${man(decomp.byCount)}원, 건당 금액 변화로 ${decomp.byTicket >= 0 ? '+' : ''}${man(decomp.byTicket)}원이다. 비싼 걸 사서가 아니라 자주 사서 늘었다.</p>
<figure>${divBars(g2325.filter(x => Math.abs(x.d) >= 3000).map(x => ({ k: x.c, v: x.d })), v => `${v >= 0 ? '+' : ''}${man(v)}원`)}<figcaption>카테고리별 월평균 변화, 2023 → 2025. 파랑은 증가, 회색은 감소.</figcaption></figure>
<h3>카테고리별 월평균, 연도별</h3>
<figure>${catYearChart()}${legend(byYear.map(y => y.y), true)}<figcaption>색은 연도별(아래 범례). 오른쪽 숫자는 ${byYear.at(-1).y}년 월평균. 육아용품 첫 구매 ${firstBaby ? firstBaby.ds : '-'}. 분류는 cats.js 키워드 기준이며 '기타'가 최근 12개월의 ${share(catL12['기타'], l12Avg)}.</figcaption></figure>
</section>

<section id="when">
<h2>언제 쓰나</h2>
<div class="two">
<div>
<h3>월급 주기</h3>
<p class="lede">월급 후 1주 하루 평균 ${won(cycStats[0].m)}원, 나머지 ${won(cycStats[0].m - cycTest.diff)}원 (${pv(cycTest.p)}). ${cycTest.p < 0.05 ? '월급 직후에 더 쓴다.' : '월급 직후라고 더 쓰지는 않는다.'}</p>
<figure>${ciBars(cycStats, it => it === cycStats[0])}</figure>
</div>
<div>
<h3>요일</h3>
<p class="lede">주말 하루 평균 ${won(mean(weekend))}원, 평일 ${won(mean(weekday))}원 (${pv(wk.p)}). ${wk.p < 0.05 ? '주말에 더 쓰는 건 우연이 아니다.' : '주말 차이는 우연일 수 있다.'}</p>
<figure>${ciBars(dowStats, it => it.k === '토' || it.k === '일')}</figure>
</div>
</div>
<p class="note">주문 없는 날은 0원으로 넣은 하루 평균. 막대 끝 가로선은 95% 신뢰구간, 검정은 Welch t-검정. 전체 ${days.length}일 중 주문한 날 ${orderDays}일(${share(orderDays, days.length)}).</p>
</section>

<section id="size">
<h2>주문 크기</h2>
<p class="lede">최근 12개월 1만 원 이하 주문은 ${l12Small.length}건. 건수로는 ${share(l12Small.length, last12Rows.length)}인데 금액으로는 ${share(sum(l12Small.map(r => r.price)), l12Total)}뿐이다. 작은 주문이 잦을수록 장바구니를 여는 횟수가 늘어난다.</p>
<div class="two">
<div><h3>건수 구성</h3><figure>${stack100(dist.map(d => ({ k: d.y, parts: d.n })), binLabels)}</figure></div>
<div><h3>금액 구성</h3><figure>${stack100(dist.map(d => ({ k: d.y, parts: d.s })), binLabels)}</figure></div>
</div>
${legend(binLabels)}
</section>

<section id="repeat">
<h2>반복 구매</h2>
<p class="lede">최근 12개월 4회 이상 산 품목 상위 12개가 ${man(recurTotal)}원, 전체의 ${share(recurTotal, l12Total)}. 아래 회색 글자는 구매 간격. 간격이 일정하면 정기배송·대용량 후보다.</p>
<figure>${hbars(recurring.map(r => ({ k: r.k, v: r.s, n: r.n, gap: r.gap, cat: r.cat, tip: `${r.k}\n${r.cat} · ${r.n}회 · ${won(r.s)}원\n구매 간격 중앙값 ${r.gap == null ? '-' : Math.round(r.gap) + '일'}` })), { labelW: 330, hiN: 3, sub: it => `${it.cat} · ${it.gap == null ? '' : Math.round(it.gap) + '일마다'}`, fmt: (v, it) => `${man(v)}원 · ${it.n}회` })}</figure>
</section>

<section id="save">
<h2>줄일 여력</h2>
<p class="lede">최근 12개월(${last12[0].m} ~ ${last12.at(-1).m}, ${man(l12Total)}원) 기준. 막대는 각 가정대로 했을 때 1년에 아끼는 돈이다.</p>
<figure>${hbars(SAVE.map(s => ({ k: s.what, v: s.save, rule: s.rule, tip: `${s.what}\n근거: ${s.basis}, ${won(s.base)}원\n가정: ${s.rule}\n연 ${won(s.save)}원` })), { labelW: 330, hiN: SAVE.length, sub: it => it.rule })}</figure>
<div class="total"><span>연 절감 여력 합계</span><strong>${man(saveTotal)}원</strong></div>
<p class="note">항목끼리 일부 겹치므로(주말의 소액 주문은 두 항목에 다 들어간다) 합계는 상한에 가깝다. 따로, 같은 날 같은 상품이 두 줄 이상인 경우가 ${dups.length}건(추가분 ${won(dupExtra)}원) 있다. 실제 중복 주문인지 확인이 필요해 합계에서 뺐다.</p>
${bigNoness.length ? `<h3>5만 원 이상 비필수 단건</h3><figure>${hbars(bigNoness.slice(0, 8).map(r => ({ k: r.item.split(',')[0], v: r.price, tip: `${r.ds} ${r.item}\n${won(r.price)}원`, ds: r.ds, cat: r.cat })), { labelW: 330, sub: it => `${it.ds} · ${it.cat}` })}</figure>` : ''}
</section>

<section id="fix">
<h2>보완할 점</h2>
<figure>${budgetChart()}<figcaption>최근 12개월과 제안 예산(최근 12개월 중앙값). 빨강은 예산을 넘은 달, ${overBudget.length}번.</figcaption></figure>
<ol class="points">
<li><b>월 ${man(budget)}원을 예산선으로 쓴다.</b> 분석기(index.html)의 월 예산 칸에 넣으면 넘은 달이 바로 표시된다.</li>
<li><b>주말을 관리한다.</b> ${wk.p < 0.05 ? '주말 지출은 통계적으로 확실히 높다. 주말 장보기 목록을 금요일에 정하면 즉흥 구매가 준다.' : '주말 차이는 뚜렷하지 않다.'} ${cycTest.p < 0.05 ? '월급 직후 지출도 높다.' : '월급 주기 효과는 약하다.'}</li>
<li><b>육아·식비는 줄이기보다 단가를 낮춘다.</b> 기저귀·우유·이유식 같은 필수 반복 품목은 정기배송 할인, 대용량, 행사 때 몰아 사기.</li>
<li><b>실제 결제액을 맞춘다.</b> 이 리포트는 할인 전 금액이고 취소·반품이 빠지지 않았다. '취소/반품/교환/환불내역'을 수집해 빼야 진짜 지출이 나온다.</li>
<li><b>은행 내역과 합친다.</b> 쿠팡은 전체 지출의 일부다. 카카오뱅크 내역을 합쳐야 전체 과소비 지점이 보인다.</li>
<li><b>분류를 다듬는다.</b> '기타'가 최근 12개월의 ${share(catL12['기타'], l12Avg)}. cats.js에 키워드를 더하면 카테고리 분석이 정확해진다.</li>
</ol>
</section>
<div class="report-notes">
<p>자료: data/coupang_2023~2026.md (csv를 요약 없이 옮긴 원문 표, 쿠팡 주문목록에 표시된 상품 금액). 데이터는 이 PC 밖으로 보내지 않는다. 다시 만들기: node report.js</p>
<p>방법: 월급 월 = 전월 25일~당월 24일. 하루 평균에는 주문 없는 날을 0원으로 넣었다. 신뢰구간은 평균 ± 1.96 × 표준오차. 절감액은 그래프에 적은 가정으로 계산했다. 그래프에 마우스를 올리면 자세한 값이 보인다.</p>
</div>
`;

fs.writeFileSync(path.join(__dirname, 'report_body.js'), `// report.js 가 만든 파일. 직접 고치지 말 것. index.html 이 불러온다.\nwindow.REPORT_HTML = ${JSON.stringify(body)};\n`);
console.log(`report_body.js: ${months.length}개월, ${inWin.length}건, 최근12개월 월평균 ${won(l12Avg)}, 절감 ${won(saveTotal)}, 기타 ${share(catL12['기타'], l12Avg)}`);
