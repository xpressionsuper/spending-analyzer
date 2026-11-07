# 카카오뱅크 거래내역 xlsx(암호 푼 것)를 요약 없이 그대로 md 표로 옮긴다.
# 사용법: python -P bank_to_md.py data/카카오뱅크_거래내역_..._해제.xlsx
# 출력: data/kakaobank_<조회시작>_<조회끝>.md  (표 머리 위의 안내문도 그대로 옮긴다. 셀 안의 | 는 \| 로)
import re
import sys
import warnings
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore", message="Cannot parse header or footer")


def cell(v):
    return "" if v is None else str(v).replace("\r", " ").replace("\n", " ").replace("|", "\\|").strip()


def main(src):
    ws = openpyxl.load_workbook(src, read_only=True, data_only=True).worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    h = next(i for i, r in enumerate(rows) if any(str(c).strip() == "거래일시" for c in r if c is not None))
    # 표 머리가 있는 열만 쓴다 (엑셀 A열처럼 비어 있는 열은 뺀다)
    cols = [i for i, c in enumerate(rows[h]) if c is not None and str(c).strip()]
    head = [cell(rows[h][i]) for i in cols]
    body = [[cell(r[i] if i < len(r) else None) for i in cols] for r in rows[h + 1:] if any(c is not None and str(c).strip() for c in r)]
    meta = [" ".join(cell(c) for c in r if c is not None and str(c).strip()) for r in rows[:h]]
    meta = [m for m in meta if m]

    period = next((m for m in meta if "조회기간" in m), "")
    d = re.findall(r"(\d{4})\.(\d{2})\.(\d{2})", period)
    name = f"kakaobank_{''.join(d[0])}_{''.join(d[1])}.md" if len(d) >= 2 else "kakaobank.md"
    dst = Path(src).parent / name

    amt = head.index("거래금액")
    num = lambda s: int(s.replace(",", "")) if re.fullmatch(r"-?[\d,]+", s or "") else 0
    out_sum = sum(num(r[amt]) for r in body if num(r[amt]) < 0)
    in_sum = sum(num(r[amt]) for r in body if num(r[amt]) > 0)

    lines = [
        f"# 카카오뱅크 거래내역 (원문)",
        "",
        f"- 원본: {Path(src).name} 의 내용을 요약 없이 그대로 옮김.",
        f"- {len(body)}건. 출금 합계 {out_sum:,}원, 입금 합계 {in_sum:,}원 (확인용, 원문에는 없는 줄).",
        "",
        "## 원본 머리말",
        "",
        *[f"- {m}" for m in meta],
        "",
        "## 거래",
        "",
        "| " + " | ".join(head) + " |",
        "|" + "|".join("---:" if k in ("거래금액", "거래 후 잔액") else "---" for k in head) + "|",
        *["| " + " | ".join(r) + " |" for r in body],
        "",
    ]
    dst.write_text("\n".join(lines), encoding="utf-8")
    print(f"{dst}: {len(body)}건, 출금 {out_sum:,}, 입금 {in_sum:,}")


if __name__ == "__main__":
    main(sys.argv[1])
