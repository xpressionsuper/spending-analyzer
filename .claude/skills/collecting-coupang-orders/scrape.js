// 쿠팡 주문목록 페이지(mc.coupang.com/ssr/desktop/order/list?requestYear=YYYY)에서
// evaluate_script로 실행한다. '다음' 버튼을 끝까지 누르며 주문을 모아 CSV 문자열을 돌려준다.
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 화면 텍스트 구조: "2026. 11. 4 주문" → 상품명 → "7,660 원" → "1개"
  const parse = () => {
    const L = document.body.innerText.split('\n').map(s => s.trim());
    const out = []; let date = null;
    for (let i = 0; i < L.length; i++) {
      const d = L[i].match(/^(\d{4})\. (\d{1,2})\. (\d{1,2}) 주문$/);
      if (d) { date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`; continue; }
      const p = L[i].match(/^([\d,]+) 원$/);
      if (p && date && /^\d+개$/.test(L[i + 1] || '')) out.push({ date, item: L[i - 1], price: +p[1].replace(/,/g, ''), qty: +L[i + 1].replace('개', '') });
    }
    return out;
  };
  const all = []; const seen = new Set(); let pages = 0;
  for (; pages < 200; pages++) {
    const rows = parse();
    const sig = JSON.stringify(rows[0]) + rows.length;
    if (seen.has(sig)) break; seen.add(sig);
    all.push(...rows);
    const next = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '다음');
    if (!next || next.disabled) break;
    next.click();
    for (let w = 0; w < 30; w++) { await sleep(300); const r = parse(); if (r.length && JSON.stringify(r[0]) + r.length !== sig) break; }
  }
  const csv = '주문일자,상품명,결제금액,수량\n' + all.map(o => [o.date, '"' + o.item.replace(/"/g, '""') + '"', o.price, o.qty].join(',')).join('\n');
  return { pages: pages + 1, count: all.length, first: all[0]?.date, last: all.at(-1)?.date, csv };
}
