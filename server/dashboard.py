# -*- coding: utf-8 -*-
"""대시보드.
/api/dashboard : 메뉴 옆 숫자용 {shortage, mold_alarms, counts, recent, alarm1, alarm2, prod}
/api/home      : 홈 화면 {today, mold, prod, wo, att, defect} (권한 있는 것만)
"""
import datetime

import db
import molds
import parts
import prodcalc


def _month_range(d):
    first = d.replace(day=1)
    nxt = (first + datetime.timedelta(days=32)).replace(day=1)
    return first, nxt - datetime.timedelta(days=1)


def data():
    alarms = [m for m in molds.status() if m["level"] in ("초과", "2차", "1차")]
    p = prod_month()
    return {
        "shortage": parts.shortage(),
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
        "prod": {"month_qty": p["month_qty"], "month_oee": p["month_oee"], "month_time": p["month_time"],
                 "last_date": p["last_date"], "last_qty": p["days"][-1]["qty"] if p["days"] else 0,
                 "month_days": p["month_days"]},
    }


def prod_month(today=None):
    today = today or datetime.date.today()
    m1, m2 = _month_range(today)
    rows = prodcalc.rows(m1.isoformat(), today.isoformat())
    by_day = {}
    for r in rows:
        by_day.setdefault(r["date"], []).append(r)
    days = []
    for d in sorted(by_day):
        o = prodcalc.oee(by_day[d])
        days.append({"date": d, "qty": o["qty"], "oee": o["oee"]})
    tot = prodcalc.oee(rows)
    # 지난달 (같은 기간 / 전체)
    pm2 = m1 - datetime.timedelta(days=1)
    pm1 = pm2.replace(day=1)
    prev = prodcalc.rows(pm1.isoformat(), pm2.isoformat())
    same_end = min(pm2, pm1 + datetime.timedelta(days=today.day - 1))
    prev_same = sum(r["qty"] for r in prev if r["date"] <= same_end.isoformat())
    # 최근 생산일 설비별
    last = db.one("SELECT MAX(date) d FROM production")["d"]
    equips = []
    if last:
        lrows = prodcalc.rows(last, last)
        by_eq = {}
        for r in lrows:
            by_eq.setdefault(str(r["equip_no"]), []).append(r)
        for eq in sorted(by_eq, key=lambda x: (len(x), x)):
            rs = by_eq[eq]
            o = prodcalc.oee(rs)
            equips.append({"equip": eq, "codes": ", ".join(dict.fromkeys(r["code"] for r in rs)),
                           "names": ", ".join(dict.fromkeys((r["name"] or "") for r in rs)),
                           "qty": o["qty"], "time_rate": o["time_rate"], "perf": o["perf"], "oee": o["oee"],
                           "down": o["down"]})
    return {"month_qty": tot["qty"], "month_oee": tot["oee"], "month_time": tot["time_rate"],
            "month_days": len(days), "days": days, "prev_same_qty": prev_same,
            "prev_month_qty": sum(r["qty"] for r in prev),
            "prev_month_days": len({r["date"] for r in prev}), "last_date": last, "equips": equips}


def defect_month(today=None):
    today = today or datetime.date.today()
    m1, _ = _month_range(today)
    rs = db.rows("""SELECT d.code, MAX(p.name) name, COALESCE(SUM(d.qty),0) qty, COUNT(*) n FROM defects d
                    LEFT JOIN products p ON p.code=d.code WHERE d.date BETWEEN ? AND ?
                    GROUP BY d.code ORDER BY qty DESC""", (m1.isoformat(), today.isoformat()))
    last = db.one("SELECT MAX(date) d FROM defects")["d"]
    return {"qty": sum(r["qty"] for r in rs), "n": sum(r["n"] for r in rs),
            "top": [{"code": r["code"], "name": r["name"] or "", "qty": r["qty"]} for r in rs[:8]], "last": last}


def home(level_of):
    """level_of(group) → 권한 레벨. 권한 없는 묶음은 넣지 않음."""
    today = datetime.date.today()
    out = {"today": today.isoformat()}
    if level_of("금형관리") >= 1:
        st = molds.status()
        out["mold"] = {"bad": sum(1 for m in st if m["level"] in ("초과", "2차")),
                       "warn": sum(1 for m in st if m["level"] == "1차")}
    if level_of("생산관리") >= 1:
        out["prod"] = prod_month(today)
        import workorders
        out["wo"] = workorders.summary(today.isoformat())
    if level_of("근태관리") >= 1:
        import attendance
        out["att"] = attendance.today_summary(today)
    if level_of("품질관리") >= 1:
        out["defect"] = defect_month(today)
    out["extra"] = extra(today, level_of)
    return out


def extra(today, level_of):
    """[개선제안] 대시보드 추가: 납기 임박 · 월별 불량률 추이 · 비가동 상위 사유 · 품질 알림."""
    import json
    x = {}
    if level_of("생산관리") >= 1:
        up = db.one("SELECT file_date, rows FROM plan_uploads ORDER BY file_date DESC, id DESC LIMIT 1")
        if up:
            rows = json.loads(up["rows"])
            x["due"] = {"file_date": up["file_date"], "t": sum(1 for r in rows if r.get("T", 0) > 0),
                        "s": sum(1 for r in rows if r.get("S", 0) > 0)}
        m1, _ = _month_range(today)
        rs = prodcalc.rows(m1.isoformat(), today.isoformat())
        tot = {}
        for r in rs:
            for k in prodcalc.DT_KEYS:
                tot[k] = tot.get(k, 0) + prodcalc._num(r.get(k))
        x["downtime"] = [{"name": prodcalc.DT_LABELS[k], "min": round(v)} for k, v in sorted(tot.items(), key=lambda t: -t[1]) if v > 0][:5]
    if level_of("품질관리") >= 1:
        trend = []
        d = today.replace(day=1)
        for _ in range(6):
            a, b = _month_range(d)
            made = sum(r["qty"] for r in prodcalc.rows(a.isoformat(), b.isoformat()))
            bad = db.one("SELECT COALESCE(SUM(qty),0) q FROM defects WHERE date BETWEEN ? AND ?", (a.isoformat(), b.isoformat()))["q"]
            trend.append({"ym": a.strftime("%Y-%m"), "rate": (bad / made) if made else None, "bad": bad})
            d = (a - datetime.timedelta(days=1)).replace(day=1)
        x["defect_trend"] = list(reversed(trend))
        import quality
        x["quality"] = quality.dashboard_extra()
    return x
