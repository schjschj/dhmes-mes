# -*- coding: utf-8 -*-
"""금형 타수 · 정비 알람.

누적 타수 = 기초 타수 + 생산실적 타수(기초 기준일 이후) + 보정
종류(오버홀·세척·부품교환)마다: 마지막 정비 때 누적 타수 이후로 몇 타 쳤는지(after),
잔여 = 주기 − after, 잔여율 = 잔여 / 주기.
알람: 잔여 < 0 → 초과, 잔여율 ≤ 2차 기준 → 2차, ≤ 1차 기준 → 1차 (설정 · 백업에서 기준 변경)
"""
import re

import db
import prodcalc

KINDS = (("oh", "oh_cycle", "oh_base", "oh"), ("clean", "clean_cycle", "clean_base", "clean"),
         ("partchg", "part_cycle", "part_base", "partchg"))
ORDER = {"초과": 0, "2차": 1, "1차": 2, "정상": 3, "": 4}


def thresholds():
    try:
        a1 = float(db.get_setting("mold_alarm1") or 0.2)
        a2 = float(db.get_setting("mold_alarm2") or 0.1)
    except ValueError:
        a1, a2 = 0.2, 0.1
    return a1, a2


VARIANT_RE = re.compile(r"^(.+)-(\d+)$")


def base_of_map(nos):
    """모디파이(변형) 금형 → 기본 금형. '10159C-11' 은 '10159C' 가 있으면 그 변형 (원본과 같은 규칙)."""
    s = set(nos)
    out = {}
    for n in nos:
        m = VARIANT_RE.match(n or "")
        out[n] = m.group(1) if m and m.group(1) in s else n
    return out


def _prod_shots(base_of, base_dates):
    """기본 금형별 생산실적 타수 (변형 금형 실적 포함, 기초 기준일 이후 실적만).
    {base: [(date, shots), ...]} — 정비일까지의 타수를 구하려고 날짜별로 남김."""
    out = {}
    for r in prodcalc.rows():
        mn = r.get("mold_no")
        if not mn:
            continue
        b = base_of.get(mn, mn)
        bd = base_dates.get(b)
        if bd and (r.get("date") or "") <= bd:
            continue
        out.setdefault(b, []).append((r.get("date") or "", r.get("shots") or 0))
    return out


def status(include_all=False):
    a1, a2 = thresholds()
    all_molds = db.rows("SELECT * FROM molds ORDER BY mold_no")
    base_of = base_of_map([m["mold_no"] for m in all_molds])
    variants = {}
    for n, b in base_of.items():
        if n != b:
            variants.setdefault(b, []).append(n)
    prod = _prod_shots(base_of, {m["mold_no"]: m.get("base_date") for m in all_molds})
    maint = db.rows("SELECT * FROM mold_maint ORDER BY date, id")
    last = {}
    for m in maint:
        d = last.setdefault(base_of.get(m["mold_no"], m["mold_no"]), {})
        for kind in ("oh", "clean", "partchg"):
            if m.get(kind):
                d[kind] = (m.get("shots") or 0, m.get("date"))
    out = []
    for m in all_molds:
        if base_of[m["mold_no"]] != m["mold_no"]:
            continue                                    # 변형 금형은 기본 금형 줄에 묶음
        managed = bool(m.get("managed")) if m.get("managed") is not None else True
        if not include_all and (m.get("status") == "폐기" or not managed):
            continue
        plist = prod.get(m["mold_no"], [])
        prod_shots = round(sum(s for _, s in plist))
        shots = (m.get("base_shots") or 0) + prod_shots + (m.get("adj_shots") or 0)
        row = dict(m)
        row.update({"prod_shots": prod_shots, "shots": shots,
                    "variants": sorted(variants.get(m["mold_no"], []), key=lambda v: v), "variant_of": None})
        worst = ""
        for kind, cyc_key, base_key, mkey in KINDS:
            cycle = m.get(cyc_key) or 0
            lm = last.get(m["mold_no"], {}).get(mkey)
            # 원본과 같게: 정비가 기초 기준일 당일 · 이후면 그 날까지의 누적 타수(정비 기록에 타수를 적었으면 그 값),
            # 기준일 이전(또는 정비 기록 없음)이면 금형 정보의 '…기초타수'
            if lm and (not m.get("base_date") or (lm[1] or "") >= m["base_date"]):
                base_shots = lm[0] or ((m.get("base_shots") or 0) + (m.get("adj_shots") or 0) +
                                       round(sum(s for d, s in plist if d <= (lm[1] or ""))))
            else:
                base_shots = m.get(base_key) or 0
            row[kind + "_last"] = lm[1] if lm else None
            after = shots - base_shots
            row[kind + "_after"] = after
            if cycle > 0:
                remain = cycle - after
                ratio = remain / cycle
                row[kind + "_remain"] = remain
                row[kind + "_ratio"] = max(0.0, ratio)
                if not managed or m.get("status") == "폐기":
                    lv = ""
                elif remain < 0:
                    lv = "초과"
                elif ratio <= a2:
                    lv = "2차"
                elif ratio <= a1:
                    lv = "1차"
                else:
                    lv = "정상"
            else:
                row[kind + "_remain"] = None
                row[kind + "_ratio"] = None
                lv = ""
            row[kind + "_level"] = lv
            if ORDER[lv] < ORDER[worst]:
                worst = lv
        row["level"] = worst
        out.append(row)
    return out


def detail(no):
    rows = {r["mold_no"]: r for r in status(include_all=True)}
    base_of = base_of_map([r["mold_no"] for r in db.rows("SELECT mold_no FROM molds")])
    key = next((k for k in base_of if k.upper() == (no or "").upper()), None)
    m = rows.get(base_of.get(key)) if key else None
    if not m:
        return None
    base = m["mold_no"]
    group = [base] + m["variants"]
    ph = ",".join("?" * len(group))
    types = {t["code"]: t["name"] for t in db.rows("SELECT code, name FROM repair_types")}
    repairs = db.rows("SELECT * FROM mold_repair WHERE mold_no IN (%s) ORDER BY date DESC, id DESC LIMIT 300" % ph, group)
    for r in repairs:
        r["type_names"] = ", ".join(types.get(t, t) for t in (r.get("types") or "").split(",") if t)
    return {
        "asked": no, "mold": m, "group": group, "variants": m["variants"],
        "maint": db.rows("SELECT * FROM mold_maint WHERE mold_no IN (%s) ORDER BY date DESC, id DESC" % ph, group),
        "repairs": repairs,
        "products": db.rows("SELECT code, name, mold_no FROM products WHERE mold_no IN (%s) ORDER BY code" % ph, group),
    }


def repair_molds():
    """수리 등록 창: 금형 목록 + 그 금형을 쓰는 제번 + 최근 생산."""
    prods = {}
    for p in db.rows("SELECT code, name, reel_qty, mold_no FROM products WHERE mold_no IS NOT NULL AND mold_no<>''"):
        prods.setdefault(p["mold_no"], []).append({"code": p["code"], "name": p["name"], "reel_qty": p["reel_qty"]})
    last = {}
    for r in db.rows("""SELECT pr.mold_no, p.code, MAX(p.date) d FROM production p JOIN products pr ON pr.code=p.code
                        WHERE pr.mold_no IS NOT NULL GROUP BY pr.mold_no, p.code"""):
        if r["mold_no"] not in last or r["d"] > last[r["mold_no"]][1]:
            last[r["mold_no"]] = [r["code"], r["d"]]
    return [{"mold_no": m["mold_no"], "part_no": m["part_no"], "part_name": m["part_name"],
             "products": prods.get(m["mold_no"], []), "last": last.get(m["mold_no"])}
            for m in db.rows("SELECT mold_no, part_no, part_name FROM molds ORDER BY mold_no")]


def repair_stats(d1, d2):
    types = db.rows("SELECT code, name FROM repair_types ORDER BY code")
    sql = "SELECT mold_no, types FROM mold_repair WHERE 1=1"
    args = []
    if d1:
        sql += " AND date >= ?"
        args.append(d1)
    if d2:
        sql += " AND date <= ?"
        args.append(d2)
    agg = {}
    for r in db.rows(sql, args):
        a = agg.setdefault(r["mold_no"], {"mold_no": r["mold_no"], "total": 0})
        a["total"] += 1
        for t in (r.get("types") or "").split(","):
            if t:
                a[t] = a.get(t, 0) + 1
    rows = sorted(agg.values(), key=lambda x: -x["total"])
    return {"types": [[t["code"], t["name"]] for t in types], "rows": rows}
