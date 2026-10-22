# -*- coding: utf-8 -*-
"""대시보드 집계. 프론트 shape:
{shortage[], mold_alarms[], counts{}, recent[], alarm1, alarm2, prod{...}}
"""
import datetime
import db

# 타수 알람 임계 (사용률 = 교환 후 누적타수 / 주기). 설정에서 조정 가능.
LV_OVER, LV_2ND, LV_1ST = 1.0, 0.9, 0.75


def _level(used_ratio):
    if used_ratio is None:
        return ""
    if used_ratio >= LV_OVER:
        return "초과"
    if used_ratio >= LV_2ND:
        return "2차"
    if used_ratio >= LV_1ST:
        return "1차"
    return "정상"


def _prod_shots_by_mold():
    """생산실적 → 금형별 누적 생산 타수.
    타수 = 생산 EA / cavity, 생산 EA = (주간R/L + 야간R/L) * 제품.릴수량."""
    sql = """
        SELECT pr.mold_no AS mold_no,
               COALESCE(SUM((COALESCE(p.day_reels,0)+COALESCE(p.night_reels,0))
                            * COALESCE(pr.reel_qty,0)), 0) AS ea,
               MAX(COALESCE(m.cavity,1)) AS cavity
        FROM production p
        JOIN products pr ON pr.code = p.code
        LEFT JOIN molds m ON m.mold_no = pr.mold_no
        WHERE pr.mold_no IS NOT NULL AND pr.mold_no <> ''
        GROUP BY pr.mold_no
    """
    out = {}
    for r in db.rows(sql):
        cav = r["cavity"] or 1
        out[r["mold_no"]] = (r["ea"] or 0) / (cav if cav else 1)
    return out


def _mold_alarms():
    molds = db.rows("SELECT * FROM molds")
    prod = _prod_shots_by_mold()
    maint = db.rows("SELECT * FROM mold_maint ORDER BY date, id")
    # 금형별 최근 정비(종류별) 시점의 누적타수
    last = {}  # mold_no -> {'oh':shots,'clean':shots,'partchg':shots}
    for m in maint:
        d = last.setdefault(m["mold_no"], {})
        for kind in ("oh", "clean", "partchg"):
            if m.get(kind):
                d[kind] = m.get("shots") or 0
    out = []
    for m in molds:
        base = (m.get("base_shots") or 0) + (m.get("adj_shots") or 0)
        prod_shots = prod.get(m["mold_no"], 0)
        shots = base + prod_shots
        row = dict(m)
        row["prod_shots"] = round(prod_shots)
        row["shots"] = round(shots)
        worst = ""
        order = {"초과": 0, "2차": 1, "1차": 2, "정상": 3, "": 4}
        for kind, cyc_key, base_key in (("oh", "oh_cycle", "oh_base"),
                                        ("clean", "clean_cycle", "clean_base"),
                                        ("partchg", "part_cycle", "part_base")):
            cycle = m.get(cyc_key) or 0
            last_shots = last.get(m["mold_no"], {}).get(
                "partchg" if kind == "partchg" else kind)
            if last_shots is None:
                last_shots = m.get(base_key) or 0
            after = shots - last_shots
            row[kind + "_last"] = round(last_shots)
            row[kind + "_after"] = round(after)
            if cycle > 0:
                remain = cycle - after
                used = after / cycle
                row[kind + "_remain"] = round(remain)
                row[kind + "_ratio"] = max(0.0, remain / cycle)
                lv = _level(used) if (m.get("managed") and m.get("status") != "폐기") else ""
            else:
                row[kind + "_remain"] = None
                row[kind + "_ratio"] = None
                lv = ""
            row[kind + "_level"] = lv
            if order.get(lv, 4) < order.get(worst, 4):
                worst = lv
        row["level"] = worst
        out.append(row)
    out.sort(key=lambda r: ({"초과": 0, "2차": 1, "1차": 2, "정상": 3, "": 4}.get(r["level"], 4)))
    return out


def _shortage():
    parts = db.rows("""SELECT * FROM parts
                       WHERE safety_qty IS NOT NULL AND safety_qty > 0
                         AND COALESCE(qty,0) < safety_qty""")
    for p in parts:
        short = (p.get("safety_qty") or 0) - (p.get("qty") or 0)
        p["short"] = short
        p["amount"] = short * (p.get("price") or 0)
        p["state"] = "품절" if (p.get("qty") or 0) <= 0 else "미달"
        p["mold_label"] = p.get("mold_no") or ""
    return parts


def _prod_summary():
    today = datetime.date.today()
    ym = today.strftime("%Y-%m")
    agg = db.one("""
        SELECT COUNT(DISTINCT date) AS days,
               COALESCE(SUM((COALESCE(day_reels,0)+COALESCE(night_reels,0))),0) AS reels
        FROM production WHERE substr(date,1,7)=?""", (ym,))
    last = db.one("""SELECT date,
               COALESCE(SUM(COALESCE(day_reels,0)+COALESCE(night_reels,0)),0) AS reels
               FROM production GROUP BY date ORDER BY date DESC LIMIT 1""")
    return {
        "month_qty": round(agg["reels"] or 0),
        "month_oee": None,
        "month_time": None,
        "month_days": agg["days"] or 0,
        "last_date": last["date"] if last else None,
        "last_qty": round(last["reels"]) if last else 0,
    }


def data():
    alarms = _mold_alarms()
    return {
        "shortage": _shortage(),
        "mold_alarms": alarms,
        "counts": {
            "products": db.one("SELECT COUNT(*) n FROM products")["n"],
            "molds": db.one("SELECT COUNT(*) n FROM molds")["n"],
            "equipment": db.one("SELECT COUNT(*) n FROM equipment")["n"],
            "workers": db.one("SELECT COUNT(*) n FROM workers WHERE active=1")["n"],
            "parts": db.one("SELECT COUNT(*) n FROM parts")["n"],
        },
        "recent": db.rows("SELECT id,ts,user,ip,tbl,action,row_id,summary FROM change_log ORDER BY id DESC LIMIT 12"),
        "alarm1": sum(1 for m in alarms if m["level"] == "1차"),
        "alarm2": sum(1 for m in alarms if m["level"] in ("2차", "초과")),
        "prod": _prod_summary(),
    }
