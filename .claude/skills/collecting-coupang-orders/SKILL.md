---
name: collecting-coupang-orders
description: Use when the user wants Coupang (쿠팡) order/purchase history (주문내역, 구매내역) for a year or recent period, or needs to refresh or extend data/coupang_*.csv. Coupang has no export button, so the data must be read from the logged-in order list page.
---

# 쿠팡 주문내역 수집

쿠팡 주문목록 화면을 브라우저로 읽어 `data/coupang_<연도>.csv`(주문일자, 상품명, 결제금액, 수량)를 만든다.

## 원칙

- 로그인은 사용자가 직접 한다. 비밀번호·인증번호를 묻거나 입력하지 않는다.
- 날짜, 상품명, 금액, 수량만 저장한다. 주소·연락처·주문번호는 저장하지 않는다.
- 실패가 2~3번 반복되면 멈추고 사용자에게 상황을 설명한다.

## 순서

1. **브라우저 준비.** 이 PC에는 Chrome이 없고 Claude in Chrome도 연결돼 있지 않다. `mcp__aside__*` 도구를 쓴다. `mcp__aside__list_pages`가 `ECONNREFUSED 127.0.0.1:9222`로 실패하면 Edge를 별도 프로필로 띄운다:
   ```powershell
   Start-Process "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" -ArgumentList '--remote-debugging-port=9222',"--user-data-dir=$env:LOCALAPPDATA\claude-coupang-profile",'https://login.coupang.com/login/login.pang'
   ```
2. **로그인 확인.** `navigate_page`로 `https://mc.coupang.com/ssr/desktop/order/list?requestYear=<연도>`를 연다. 최근 6개월만 원하면 `requestYear` 없이 연다. `evaluate_script`로 `document.body.innerText`에 "로그아웃"이 있는지 본다. 없으면 사용자에게 그 창에서 로그인해 달라고 하고 기다린다.
3. **수집.** 이 폴더의 `scrape.js` 내용을 `evaluate_script`의 `function`으로 넘기고, `waitForStableDom: false`, `filePath: <스크래치패드>/coupang_raw.json`으로 실행한다. 결과가 커서 반드시 파일로 받는다.
4. **변환.** `node .claude/skills/collecting-coupang-orders/to_csv.js <raw> data/coupang_<연도>.csv`를 실행한 뒤 raw 파일을 지운다.
5. **md 원문 만들기.** `node .claude/skills/collecting-coupang-orders/to_md.js data/coupang_<연도>.csv`로 같은 이름의 `.md`를 만든다. 요약이 아니라 csv의 모든 행을 그대로 옮긴 표다. 분석(`report.js`)은 이 md를 읽는다.
6. **분석 데이터 갱신.** `node build_data.js`(분석기 index.html용 data.js)와 `node report.js`(index.html의 리포트 탭용 report_body.js)를 실행한다.
7. **보고.** 건수, 기간, 합계를 알린다.

## 자주 생기는 문제

| 증상 | 원인·대처 |
|---|---|
| 0건 | 로그인이 풀렸거나 화면 구조가 바뀜. `innerText` 일부를 보고 `scrape.js`의 정규식(`YYYY. M. D 주문`, `N 원`, `N개`)을 고친다 |
| 페이지가 1개만 잡힘 | '다음' 버튼 텍스트나 동작이 바뀜. 버튼을 찾는 부분을 확인한다 |
| 같은 날 같은 상품이 두 줄 | 실제로 두 번 산 것일 수 있다. 지우지 말고 보고서에 '확인 필요'로 적는다 |
| 합계가 실제 결제액보다 큼 | 표시 금액은 할인 전이고 취소·반품도 섞여 있다. 보고서에 이 한계를 적는다 |

## 끝나면

사용자가 원하면 Edge 창을 닫는다. 프로필 폴더(`%LOCALAPPDATA%\claude-coupang-profile`)에는 로그인 정보가 남아 있다는 것을 알린다.
