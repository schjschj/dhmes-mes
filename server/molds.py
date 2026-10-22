# -*- coding: utf-8 -*-
"""금형 타수 · 정비 알람.

누적 타수 = 기초 타수 + 생산실적 타수(기초 기준일 이후) + 보정
종류(오버홀·세척·부품교환)마다: 마지막 정비 때 누적 타수 이후로 몇 타 쳤는지(after),
잔여 = 주기 − after, 잔여율 = 잔여 / 주기.
알람: 잔여 < 0 → 초과, 잔여율 ≤ 2차 기준 → 2차, ≤ 1차 기준 → 1차 (설정 · 백업에서 기준 변경)
"""
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


def _prod_shots():
    """금형별 생산실적 타수 (기초 기준일 이후 실적만)."""
    molds = {m["mold_no"]: m for m in db.rows("SELECT mold_no, base_date FROM molds")}
    out = {}
    for r in prodcalc.rows():
        mn = r.get("mold_no")
        if not mn:
            continue
        bd = (molds.get(mn) or {}).get("base_date")
        if bd and (r.get("date") or "") <= bd:
            continue
        out[mn] = out.get(mn, 0) + (r.get("shots") or 0)
    return out


def status(include_all=False):
    a1, a2 = thresholds()
    prod = _prod_shots()
    maint = db.rows("SELECT * FROM mold_maint ORDER BY date, id")
    last = {}
    for m in maint:
        d = last.setdefault(m["mold_no"], {})
        for kind in ("oh", "clean", "partchg"):
            if m.get(kind):
                d[kind] = (m.get("shots") or 0, m.get("date"))
    out = []
    for m in db.rows("SELECT * FROM molds ORDER BY mold_no"):
        if not include_all and (m.get("status") == "폐기"):
            continue
        prod_shots = round(prod.get(m["mold_no"], 0))
        shots = (m.get("base_shots") or 0) + prod_shots + (m.get("adj_shots") or 0)
        row = dict(m)
        row.update({"prod_shots": prod_shots, "shots": shots, "added_shots": prod_shots,
                    "variants": [], "variant_of": None})
        worst = ""
        managed = bool(m.get("managed")) if m.get("managed") is not None else True
        for kind, cyc_key, base_key, mkey in KINDS:
            cycle = m.get(cyc_key) or 0
            lm = last.get(m["mold_no"], {}).get(mkey)
            base_shots = lm[0] if lm else (m.get(base_key) or 0)
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
    m = rows.get(no)
    if not m:
        m = next((r for k, r in rows.items() if k.upper() == (no or "").upper()), None)
    if not m:
        return None
    base = m["mold_no"]
    types = {t["code"]: t["name"] for t in db.rows("SELECT code, name FROM repair_types")}
    repairs = db.rows("SELECT * FROM mold_repair WHERE mold_no=? ORDER BY date DESC, id DESC LIMIT 300", (base,))
    for r in repairs:
        r["type_names"] = ", ".join(types.get(t, t) for t in (r.get("types") or "").split(",") if t)
    return {
        "asked": no, "mold": m, "group": [base], "variants": [],
        "maint": db.rows("SELECT * FROM mold_maint WHERE mold_no=? ORDER BY date DESC, id DESC", (base,)),
        "repairs": repairs,
        "products": db.rows("SELECT code, name, mold_no FROM products WHERE mold_no=? ORDER BY code", (base,)),
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
