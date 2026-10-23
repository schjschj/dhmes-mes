# -*- coding: utf-8 -*-
"""생산실적 계산: 작업시간·주야 분할·부동·이론생산량·OEE.

원본 엑셀 '생산실적통합' 의 계산 규칙을 재구성했다.
- 작업(분) = 시작~종료 (자정 넘김 허용) − 그 안의 휴게
- 실적(분) = 작업 − 부동(dt_* 합)
- 생산량(EA) = (주간R/L + 야간R/L) × 릴수량
- 이론생산량 = 실적(분) × SPM × Cavity × 효율
- 시간가동률 = 실적/작업, 성능 = 생산량/이론, 품질 = (생산량−공정불량)/생산량, OEE = 셋의 곱
"""
import copy

import db
from common import get_json, set_json

KIND_KEY = {"": "normal", None: "normal", "특근": "t1", "특근2": "t2"}
KINDS = [("normal", ""), ("t1", "특근"), ("t2", "특근2")]

DEFAULT_STD = {
    "day_start": "08:30",
    "inspect_per_reel": 0,
    "work_normal": ["08:30", "05:30"],
    "shift_normal": "20:30",
    "breaks_normal": [["점심", "12:00", "13:00"], ["오후 휴식", "15:00", "15:10"],
                      ["저녁", "17:30", "18:00"], ["야간 식사", "00:00", "01:00"],
                      ["새벽 휴식", "03:00", "03:10"]],
    "work_t1": ["08:30", "17:30"],
    "shift_t1": "17:30",
    "breaks_t1": [["점심", "12:00", "13:00"], ["오후 휴식", "15:00", "15:10"],
                  ["-", "00:00", "00:00"], ["-", "00:00", "00:00"], ["-", "00:00", "00:00"]],
    "work_t2": ["08:30", "12:30"],
    "shift_t2": "12:30",
    "breaks_t2": [["-", "00:00", "00:00"], ["-", "00:00", "00:00"], ["-", "00:00", "00:00"],
                  ["-", "00:00", "00:00"], ["-", "00:00", "00:00"]],
}

DT_KEYS = ["dt_setup", "dt_first", "dt_mold", "dt_equip", "dt_etc"]
DT_LABELS = {"dt_setup": "금형셋업", "dt_first": "초품검사", "dt_mold": "금형수리",
             "dt_equip": "설비수리", "dt_etc": "기타"}
LOSS_KEYS = ["loss_mold_chg", "loss_mold_fix", "loss_coil", "loss_adjust", "loss_vision", "loss_init"]


def get_std():
    std = copy.deepcopy(DEFAULT_STD)
    std.update(get_json("prod_std", {}))
    return std


def save_std(b):
    std = get_std()
    for k in DEFAULT_STD:
        if k in b:
            std[k] = b[k]
    try:
        std["inspect_per_reel"] = float(std.get("inspect_per_reel") or 0)
    except (TypeError, ValueError):
        std["inspect_per_reel"] = 0
    set_json("prod_std", std)
    return std


# ──────────────────────────────── 시각 계산 (분 단위, day_start 기준으로 펼침)
def _m(t):
    """'HH:MM' → 분. 잘못된 값은 None."""
    if not t or not isinstance(t, str) or ":" not in t:
        return None
    try:
        h, m = t.strip().split(":")[:2]
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def _span(a, b, base):
    """a~b 구간을 base(주간 시작) 기준 연속 분으로. 자정 넘김 처리."""
    a, b = _m(a), _m(b)
    if a is None or b is None:
        return None
    a = (a - base) % 1440
    b = (b - base) % 1440
    if b <= a:
        b += 1440
    return a, b


def _overlap(x, y):
    return max(0, min(x[1], y[1]) - max(x[0], y[0]))


def _breaks(std, key, base):
    out = []
    for b in std.get("breaks_" + key, []):
        if len(b) >= 3 and _m(b[1]) is not None and _m(b[2]) is not None and _m(b[1]) != _m(b[2]):
            s = _span(b[1], b[2], base)
            if s:
                out.append(s)
    return out


def _net(span, brs):
    return max(0, (span[1] - span[0]) - sum(_overlap(span, b) for b in brs))


def std_summary(std):
    base = _m(std.get("day_start")) or 0
    avail, work = {}, {}
    for key, label in KINDS:
        sp = _span(*std.get("work_" + key, ["", ""]), base) if std.get("work_" + key) else None
        if not sp:
            avail[label] = work[label] = 0
            continue
        work[label] = sp[1] - sp[0]
        avail[label] = _net(sp, _breaks(std, key, base))
    return {"std": std, "avail": avail, "work": work}


def work_split(row, std):
    """(작업분, 주간분, 야간분)."""
    base = _m(std.get("day_start")) or 0
    key = KIND_KEY.get(row.get("kind") or "", "normal")
    sp = _span(row.get("start_time"), row.get("end_time"), base)
    if not sp:
        return 0, 0, 0
    brs = _breaks(std, key, base)
    shift_end = _span(std.get("day_start"), std.get("shift_" + key) or std.get("shift_normal"), base)
    day_rng = (0, shift_end[1]) if shift_end else (0, 720)
    night_rng = (day_rng[1], 2880)
    day = _net((max(sp[0], day_rng[0]), max(min(sp[1], day_rng[1]), max(sp[0], day_rng[0]))), brs)
    night = _net((max(sp[0], night_rng[0]), max(sp[1], night_rng[0])), brs)
    return _net(sp, brs), day, night


def _num(v):
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _eff(v):
    e = _num(v)
    if e <= 0:
        return 1.0
    return e / 100.0 if e > 1.5 else e


def load_refs():
    products = {p["code"]: p for p in db.rows("SELECT * FROM products")}
    molds = {m["mold_no"]: m for m in db.rows("SELECT * FROM molds")}
    return products, molds


def defect_index(d1=None, d2=None):
    """(date, code) → 공정불량 EA. 설비가 적힌 불량은 (date, code, equip) 로도 집계."""
    sql = "SELECT date, code, equip_no, COALESCE(SUM(qty),0) q FROM defects"
    args = []
    if d1 and d2:
        sql += " WHERE date BETWEEN ? AND ?"
        args = [d1, d2]
    sql += " GROUP BY date, code, equip_no"
    by_eq, by_code = {}, {}
    for r in db.rows(sql, args):
        by_code[(r["date"], r["code"])] = by_code.get((r["date"], r["code"]), 0) + r["q"]
        if r["equip_no"]:
            by_eq[(r["date"], r["code"], str(r["equip_no"]))] = r["q"]
    return by_eq, by_code


def product_of(products, code):
    """제번 → 제품. 원본처럼 대소문자 무시 ('740482-3(B)' → '740482-3(b)')."""
    code = code or ""
    p = products.get(code)
    if p is None:
        up = products.get("__upper__")
        if up is None:
            up = products["__upper__"] = {k.upper(): v for k, v in products.items() if k != "__upper__" and k}
        p = up.get(code.upper())
    return p or {}


def enrich(row, std, products, molds, defects=None):
    p = product_of(products, row.get("code"))
    reels = _num(row.get("day_reels")) + _num(row.get("night_reels"))
    reel_qty = _num(p.get("reel_qty"))
    spm = _num(p.get("spm"))
    eff = _eff(p.get("efficiency")) if _num(p.get("efficiency")) > 0 else 0.0   # 원본: 효율이 비면 이론 0
    work, day_min, night_min = work_split(row, std)
    down = sum(_num(row.get(k)) for k in DT_KEYS)
    run = max(0, work - down)
    qty = reels * reel_qty
    # 원본과 같게: 분당 이론 생산 = SPM × 효율 × OEE 타당생산수(없으면 1). (Cavity 는 쓰지 않음)
    unit = spm * eff * (_num(p.get("valid_count")) or 1)
    theo = run * unit
    inspect = reels * _num(std.get("inspect_per_reel"))
    # LOSS 칸은 무게 → 제품 1개 무게로 나눠 개수로 (원본과 같음)
    w1 = _num(p.get("weight"))
    loss_pcs = inspect + (sum(_num(row.get(k)) for k in LOSS_KEYS) / w1 if w1 else 0)
    dq = 0
    if defects:
        by_eq, by_code = defects
        dq = by_eq.get((row.get("date"), row.get("code"), str(row.get("equip_no"))))
        if dq is None:
            dq = by_code.get((row.get("date"), row.get("code")), 0)
    out = dict(row)
    out.update({
        "name": p.get("name"),
        "mold_no": p.get("mold_no"),
        "reels": reels,
        "boxes": (reels / _num(p.get("box_reels"))) if _num(p.get("box_reels")) else None,
        "qty": round(qty),
        "day_qty": round(_num(row.get("day_reels")) * reel_qty),
        "night_qty": round(_num(row.get("night_reels")) * reel_qty),
        "work_min": round(work),
        "day_min": round(day_min),
        "night_min": round(night_min),
        "downtime": round(down),
        "run_min": round(run),
        "shots": round(qty + loss_pcs),           # 원본: 타수 = 생산량 + LOSS 개수
        "loss_pcs": round(loss_pcs),
        "total_use": round(loss_pcs),
        "inspect_loss": round(inspect),
        "defect_qty": round(dq or 0),
        "theo": round(theo),
        "unit_rate": unit,
        "missing": 1 if (not p.get("mold_no") or not spm) else 0,
        "valid_count": p.get("valid_count"),
    })
    return out


def rows(d1=None, d2=None, equip=None):
    sql = "SELECT * FROM production WHERE 1=1"
    args = []
    if d1:
        sql += " AND date >= ?"
        args.append(d1)
    if d2:
        sql += " AND date <= ?"
        args.append(d2)
    if equip:
        sql += " AND equip_no = ?"
        args.append(equip)
    sql += " ORDER BY date, equip_no, id"
    std = get_std()
    products, molds = load_refs()
    dfx = defect_index(d1, d2)
    return [enrich(r, std, products, molds, dfx) for r in db.rows(sql, args)]


def oee(rs):
    """행 묶음의 합계 지표."""
    q = sum(r["qty"] for r in rs)
    w = sum(r["work_min"] for r in rs)
    run = sum(r["run_min"] for r in rs)
    th = sum(r["theo"] for r in rs)
    dq = sum(r["defect_qty"] for r in rs)
    t = run / w if w else None
    p = q / th if th else None
    ql = (q - dq) / q if q else None
    o = t * p * ql if None not in (t, p, ql) else None
    return {"qty": q, "work": w, "run": run, "down": sum(r["downtime"] for r in rs), "theo": th,
            "defect": dq, "time_rate": t, "perf": p, "quality": ql, "oee": o,
            "reels": sum(r["reels"] for r in rs)}


def missing():
    products = {p["code"]: p for p in db.rows("SELECT * FROM products")}
    out = []
    agg = {}
    for r in rows():
        if not r["missing"]:
            continue
        a = agg.setdefault(r["code"], {"code": r["code"], "count": 0, "qty": 0, "last": ""})
        a["count"] += 1
        a["qty"] += r["qty"]
        a["last"] = max(a["last"], r["date"] or "")
    for code, a in agg.items():
        p = products.get(code)
        a["product_id"] = p["id"] if p else None
        a["name"] = p.get("name") if p else ""
        a["mold_no"] = p.get("mold_no") if p else ""
        a["spm"] = p.get("spm") if p else None
        if not p:
            a["state"] = "제품 미등록"
        else:
            miss = []
            if not p.get("mold_no"):
                miss.append("금형번호 없음")
            if not _num(p.get("spm")):
                miss.append("SPM 없음")
            a["state"] = " · ".join(miss)
        out.append(a)
    return out
