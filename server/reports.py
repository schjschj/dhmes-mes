# -*- coding: utf-8 -*-
"""생산 보고서. 프론트(report.js)는 {title, subtitle, sections[]} 를 그대로 그린다.
section: {title, note, type:'table'|'bars', cols:[{l,t,w}], rows:[[]], total:[], freeze,
          labels:[], series:[{name, values}]}
t: text / int / num / num1 / pct / pct2 / auto
"""
import calendar
import datetime

import db
import prodcalc
from prodcalc import DT_KEYS, DT_LABELS

WD = "월화수목금토일"


def C(l, t="int", w=None):
    d = {"l": l, "t": t}
    if w:
        d["w"] = w
    return d


def _ym_range(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return "%04d-%02d-01" % (y, m), "%04d-%02d-%02d" % (y, m, calendar.monthrange(y, m)[1])


def _target(key, default=None):
    v = db.get_setting(key)
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


def _defect_qty(d1, d2):
    return db.one("SELECT COALESCE(SUM(qty),0) q FROM defects WHERE date BETWEEN ? AND ?", (d1, d2))["q"]


def _oee_cols():
    return [C("생산량(EA)"), C("작업(분)"), C("부동(분)"), C("실적(분)"),
            C("시간가동률", "pct"), C("성능", "pct"), C("품질", "pct2"), C("OEE", "pct")]


def _oee_vals(o):
    return [o["qty"], o["work"], o["down"], o["run"], o["time_rate"], o["perf"], o["quality"], o["oee"]]


def _downtime_pareto(rows):
    tot = {k: 0 for k in DT_KEYS}
    for r in rows:
        for k in DT_KEYS:
            tot[k] += prodcalc._num(r.get(k))
    items = sorted(((DT_LABELS[k], v) for k, v in tot.items() if v > 0), key=lambda x: -x[1])
    s = sum(v for _, v in items) or 1
    acc, trows = 0, []
    for name, v in items:
        acc += v
        trows.append([name, round(v), v / s, acc / s])
    return items, trows


# ──────────────────────────────────────────────── 보고서별
def daily(q):
    d = q.get("date") or datetime.date.today().isoformat()
    rows = prodcalc.rows(d, d)
    dt = datetime.date.fromisoformat(d)
    t1 = [[r["equip_no"], r["code"], r["name"] or "", r["kind"] or "", r["reels"]] + _oee_vals(prodcalc.oee([r])) for r in rows]
    tot = prodcalc.oee(rows)
    sections = [{
        "title": "① 설비별 생산실적", "freeze": 3,
        "cols": [C("설비", "text", 40), C("제번", "text", 90), C("품명", "text", 160), C("구분", "text"), C("R/L", "num1")] + _oee_cols(),
        "rows": t1, "total": ["합계", "", "%d건" % len(rows), "", tot["reels"]] + _oee_vals(tot)}]
    dtr = [[r["equip_no"], r["code"]] + [prodcalc._num(r.get(k)) or None for k in DT_KEYS] + [r.get("dt_note") or ""]
           for r in rows if r["downtime"]]
    sections.append({"title": "② 비가동 내역", "cols": [C("설비", "text"), C("제번", "text")] +
                     [C(DT_LABELS[k]) for k in DT_KEYS] + [C("비고", "text", 200)], "rows": dtr})
    dfs = db.rows("""SELECT d.equip_no, d.code, p.name, d.defect_code, d.reason, d.qty, d.worker FROM defects d
                     LEFT JOIN products p ON p.code=d.code WHERE d.date=? ORDER BY d.equip_no""", (d,))
    sections.append({"title": "③ 공정불량", "cols": [C("설비", "text"), C("제번", "text"), C("품명", "text"),
                     C("불량코드", "text"), C("사유", "text"), C("수량(EA)"), C("작업자", "text")],
                     "rows": [[x["equip_no"], x["code"], x["name"], x["defect_code"], x["reason"], x["qty"], x["worker"]] for x in dfs]})
    return {"title": "일일 생산현황 %s (%s)" % (d, WD[dt.weekday()]), "subtitle": "OEE = 시간가동률 × 성능 × 품질", "sections": sections}


def monthly(q):
    ym = q.get("ym") or datetime.date.today().strftime("%Y-%m")
    d1, d2 = _ym_range(ym)
    rows = prodcalc.rows(d1, d2)
    by = {}
    for r in rows:
        by.setdefault(r["date"], []).append(r)
    days = sorted(by)
    t = [[dd + " (" + WD[datetime.date.fromisoformat(dd).weekday()] + ")"] + _oee_vals(prodcalc.oee(by[dd])) for dd in days]
    tot = prodcalc.oee(rows)
    byc = {}
    for r in rows:
        x = byc.setdefault(r["code"], [r["code"], r["name"] or "", 0, 0])
        x[2] += r["reels"]
        x[3] += r["qty"]
    return {"title": "월간 생산현황 %s" % ym, "subtitle": "생산일 %d일" % len(days), "sections": [
        {"title": "① 일별 생산량", "type": "bars", "labels": [x[8:] for x in days],
         "series": [{"name": "생산량(EA)", "values": [prodcalc.oee(by[x])["qty"] for x in days]}]},
        {"title": "② 일별 실적", "freeze": 1, "cols": [C("날짜", "text", 110)] + _oee_cols(), "rows": t,
         "total": ["합계"] + _oee_vals(tot)},
        {"title": "③ 제번별 생산", "cols": [C("제번", "text", 90), C("품명", "text", 200), C("R/L", "num1"), C("생산량(EA)")],
         "rows": sorted(byc.values(), key=lambda x: -x[3])},
    ]}


def equip(q):
    d1 = q.get("d1") or datetime.date.today().replace(day=1).isoformat()
    d2 = q.get("d2") or datetime.date.today().isoformat()
    rows = prodcalc.rows(d1, d2)
    eqs = {e["no"]: e for e in db.rows("SELECT * FROM equipment")}
    by = {}
    for r in rows:
        by.setdefault(str(r["equip_no"]), []).append(r)
    keys = sorted(by, key=lambda x: (len(x), x))
    t = [[k, (eqs.get(k) or {}).get("maker") or "", (eqs.get(k) or {}).get("ton"), len({r["date"] for r in by[k]})] +
         _oee_vals(prodcalc.oee(by[k])) for k in keys]
    tot = prodcalc.oee(rows)
    return {"title": "설비 가동률 · OEE", "subtitle": "%s ~ %s" % (d1, d2), "sections": [
        {"title": "① 설비별 OEE", "type": "bars", "labels": [k + "호기" for k in keys],
         "series": [{"name": "OEE(%)", "values": [round((prodcalc.oee(by[k])["oee"] or 0) * 100, 1) for k in keys]}]},
        {"title": "② 설비별 가동 현황", "freeze": 1,
         "cols": [C("설비", "text", 40), C("메이커", "text"), C("톤", "num"), C("가동일")] + _oee_cols(),
         "rows": t, "total": ["합계", "", "", len({r["date"] for r in rows})] + _oee_vals(tot)},
    ]}


def worker(q):
    d1 = q.get("d1") or datetime.date.today().replace(day=1).isoformat()
    d2 = q.get("d2") or datetime.date.today().isoformat()
    agg = {}
    for r in prodcalc.rows(d1, d2):
        for who, qk, mk, side in ((r.get("day_worker"), "day_qty", "day_min", "d"),
                                  (r.get("night_worker"), "night_qty", "night_min", "n")):
            if not who:
                continue
            a = agg.setdefault(who, {"d": set(), "n": set(), "qty": 0, "min": 0, "lines": 0})
            a[side].add(r["date"])
            a["qty"] += r[qk]
            a["min"] += r[mk]
            a["lines"] += 1
    t = sorted(([k, len(a["d"]), len(a["n"]), a["lines"], a["qty"], a["min"]] for k, a in agg.items()), key=lambda x: -x[4])
    return {"title": "작업자별 집계", "subtitle": "%s ~ %s" % (d1, d2), "sections": [
        {"title": "작업자별 생산", "cols": [C("작업자", "text", 80), C("주간 일수"), C("야간 일수"), C("실적 건수"),
                                       C("생산량(EA)"), C("작업(분)")], "rows": t,
         "total": ["합계", sum(x[1] for x in t), sum(x[2] for x in t), sum(x[3] for x in t), sum(x[4] for x in t), sum(x[5] for x in t)]}]}


def month(q):
    """월간 보고 — [개선] 목표 대비 실적 · 비가동 파레토."""
    ym = q.get("ym") or datetime.date.today().strftime("%Y-%m")
    d1, d2 = _ym_range(ym)
    rows = prodcalc.rows(d1, d2)
    tot = prodcalc.oee(rows)
    dq = _defect_qty(d1, d2)
    rate = dq / tot["qty"] if tot["qty"] else None
    tq, td, to = _target("target_month_qty"), _target("target_defect_rate"), _target("target_oee")
    kpi = [["생산량(EA)", tq, tot["qty"], (tot["qty"] / tq) if tq else None],
           ["OEE", to, tot["oee"], (tot["oee"] / to) if (to and tot["oee"] is not None) else None],
           ["공정불량률", td, rate, None],
           ["공정불량(EA)", None, dq, None],
           ["비가동(분)", None, tot["down"], None]]
    items, pareto = _downtime_pareto(rows)
    byc = {}
    for r in rows:
        x = byc.setdefault(r["code"], [r["code"], r["name"] or "", 0, 0])
        x[2] += r["qty"]
    for x in db.rows("SELECT code, COALESCE(SUM(qty),0) q FROM defects WHERE date BETWEEN ? AND ? GROUP BY code", (d1, d2)):
        if x["code"] in byc:
            byc[x["code"]][3] = x["q"]
    top = sorted(byc.values(), key=lambda x: -x[2])[:30]
    return {"title": "월간 보고 %s" % ym, "subtitle": "목표값은 설정 · 백업 화면에서 정합니다", "sections": [
        {"title": "① 목표 대비 실적", "cols": [C("항목", "text", 110), C("목표", "auto"), C("실적", "auto"), C("달성률", "pct")],
         "rowtypes": ["int", "pct", "pct2", "int", "int"], "rows": kpi},
        {"title": "② 비가동 사유 (파레토)", "type": "bars", "labels": [x[0] for x in items],
         "series": [{"name": "비가동(분)", "values": [round(x[1]) for x in items]}]},
        {"title": "③ 비가동 사유 누적", "cols": [C("사유", "text", 90), C("분"), C("비율", "pct"), C("누적", "pct")], "rows": pareto},
        {"title": "④ 제번별 생산 · 불량 (상위 30)", "cols": [C("제번", "text", 90), C("품명", "text", 200), C("생산량(EA)"), C("공정불량(EA)")],
         "rows": top},
    ]}


def year(q):
    ym = q.get("ym") or datetime.date.today().strftime("%Y-%m")
    y, m = int(ym[:4]), int(ym[5:7])
    t, labels, qtys = [], [], []
    all_rows = []
    for mm in range(1, m + 1):
        d1, d2 = _ym_range("%04d-%02d" % (y, mm))
        rows = prodcalc.rows(d1, d2)
        all_rows += rows
        o = prodcalc.oee(rows)
        dq = _defect_qty(d1, d2)
        t.append(["%d월" % mm, o["qty"], o["oee"], dq, (dq / o["qty"]) if o["qty"] else None, o["down"]])
        labels.append("%d월" % mm)
        qtys.append(o["qty"])
    o = prodcalc.oee(all_rows)
    dq = sum(x[3] for x in t)
    return {"title": "연간 누계 보고 %d년 (1~%d월)" % (y, m), "sections": [
        {"title": "① 월별 생산량", "type": "bars", "labels": labels, "series": [{"name": "생산량(EA)", "values": qtys}]},
        {"title": "② 월별 누계", "cols": [C("월", "text"), C("생산량(EA)"), C("OEE", "pct"), C("공정불량(EA)"),
                                       C("불량률", "pct2"), C("비가동(분)")], "rows": t,
         "total": ["누계", o["qty"], o["oee"], dq, (dq / o["qty"]) if o["qty"] else None, o["down"]]},
    ]}


def defect(q):
    """불량 집계 — [개선] 월별 불량률 추이 막대."""
    y = int(q.get("year") or datetime.date.today().year)
    codes = [r["code"] for r in db.rows("SELECT DISTINCT COALESCE(defect_code,'(미분류)') code FROM defects WHERE substr(date,1,4)=? ORDER BY 1", (str(y),))]
    grid, rates, labels = [], [], []
    for mm in range(1, 13):
        d1, d2 = _ym_range("%04d-%02d" % (y, mm))
        by = {r["c"]: r["q"] for r in db.rows("""SELECT COALESCE(defect_code,'(미분류)') c, COALESCE(SUM(qty),0) q FROM defects
                                                 WHERE date BETWEEN ? AND ? GROUP BY c""", (d1, d2))}
        tot = sum(by.values())
        made = sum(r["qty"] for r in prodcalc.rows(d1, d2))
        grid.append(["%d월" % mm] + [by.get(c, 0) or None for c in codes] + [tot, made, (tot / made) if made else None])
        labels.append("%d월" % mm)
        rates.append(round(tot / made * 100, 3) if made else 0)
    total = ["합계"] + [sum((g[i + 1] or 0) for g in grid) for i in range(len(codes))]
    tq = sum(g[-3] for g in grid)
    tm = sum(g[-2] for g in grid)
    total += [tq, tm, (tq / tm) if tm else None]
    top = db.rows("""SELECT d.code, MAX(p.name) name, COALESCE(SUM(d.qty),0) q, COUNT(*) n FROM defects d
                     LEFT JOIN products p ON p.code=d.code WHERE substr(d.date,1,4)=? GROUP BY d.code ORDER BY q DESC LIMIT 30""", (str(y),))
    loss = db.rows("""SELECT d.code, MAX(p.name) name, COALESCE(SUM(d.qty),0) q, MAX(p.price) price FROM defects d
                      LEFT JOIN products p ON p.code=d.code WHERE substr(d.date,1,4)=? GROUP BY d.code""", (str(y),))
    loss_rows = sorted(([r["code"], r["name"], r["q"], r["price"], (r["q"] or 0) * (r["price"] or 0)] for r in loss), key=lambda x: -x[4])
    return {"title": "불량 집계 %d년" % y, "sections": [
        {"title": "① 월별 공정불량률 (%)", "type": "bars", "labels": labels, "series": [{"name": "불량률(%)", "values": rates}]},
        {"title": "② 월별 · 불량코드별 (EA)", "freeze": 1,
         "cols": [C("월", "text")] + [C(c) for c in codes] + [C("불량 합계"), C("생산량"), C("불량률", "pct2")],
         "rows": grid, "total": total},
        {"title": "③ 제번별 불량 (상위 30)", "cols": [C("제번", "text", 90), C("품명", "text", 200), C("불량(EA)"), C("건수")],
         "rows": [[r["code"], r["name"], r["q"], r["n"]] for r in top]},
        {"title": "④ 불량 손실 금액 (F-cost)", "note": "불량 수량 × 제품 단가 (기준정보 > 제품의 단가)",
         "cols": [C("제번", "text", 90), C("품명", "text", 200), C("불량(EA)"), C("단가", "num"), C("손실 금액")],
         "rows": loss_rows, "total": ["합계", "", sum(x[2] or 0 for x in loss_rows), "", sum(x[4] for x in loss_rows)]},
    ]}


def qmonth(q):
    """[개선] 품질 월간 리포트 — 불량률 · F-cost · 고객불만 · 수입검사 · 초중종물 · 계측기."""
    import quality
    ym = q.get("ym") or datetime.date.today().strftime("%Y-%m")
    d1, d2 = _ym_range(ym)
    made = sum(r["qty"] for r in prodcalc.rows(d1, d2))
    dq = _defect_qty(d1, d2)
    fcost = db.one("""SELECT COALESCE(SUM(d.qty * COALESCE(p.price,0)),0) c FROM defects d LEFT JOIN products p ON p.code=d.code
                      WHERE d.date BETWEEN ? AND ?""", (d1, d2))["c"]
    cl = db.rows("SELECT * FROM q_claims WHERE date BETWEEN ? AND ? ORDER BY date", (d1, d2))
    ccost = sum(r["cost"] or 0 for r in cl)
    inc = db.rows("SELECT * FROM q_incoming WHERE date BETWEEN ? AND ? ORDER BY date", (d1, d2))
    inc_bad = [r for r in inc if r["result"] == "불합격"]
    ip = db.rows("SELECT * FROM q_inproc WHERE date BETWEEN ? AND ?", (d1, d2))
    gs = [quality._gauge_due(r) for r in db.rows("SELECT * FROM q_gauges WHERE COALESCE(status,'')<>'폐기'")]
    td = _target("target_defect_rate")
    rate = dq / made if made else None
    kpi = [["생산량(EA)", None, made], ["공정불량(EA)", None, dq], ["공정불량률", td, rate],
           ["불량 손실 금액 (F-cost, 원)", None, fcost], ["고객불만 (건)", None, len(cl)], ["고객불만 비용 (원)", None, ccost],
           ["고객불만 미결 (건, 전체)", None, db.one("SELECT COUNT(*) n FROM q_claims WHERE COALESCE(status,'')<>'완료'")["n"]],
           ["수입검사 (건)", None, len(inc)], ["수입검사 불합격률", None, (len(inc_bad) / len(inc)) if inc else None],
           ["초중종물 검사 (건)", None, len(ip)], ["초중종물 불합격 (건)", None, sum(1 for r in ip if r["result"] == "불합격")],
           ["계측기 교정 지남 / 임박", None, "%d / %d" % (sum(1 for g in gs if g["due_state"] == "지남"), sum(1 for g in gs if g["due_state"] == "임박"))]]
    by = db.rows("""SELECT COALESCE(defect_code,'(미분류)') c, COALESCE(SUM(qty),0) q FROM defects WHERE date BETWEEN ? AND ?
                    GROUP BY c ORDER BY q DESC""", (d1, d2))
    return {"title": "품질 월간 리포트 %s" % ym, "subtitle": "목표 불량률은 설정 · 백업 화면에서 정합니다", "sections": [
        {"title": "① 품질 지표", "cols": [C("항목", "text", 190), C("목표", "auto"), C("실적", "auto")],
         "rowtypes": ["int", "int", "pct2", "int", "int", "int", "int", "int", "pct", "int", "int", "text"], "rows": kpi},
        {"title": "② 불량코드별 (파레토)", "type": "bars", "labels": [r["c"] for r in by], "series": [{"name": "불량(EA)", "values": [r["q"] for r in by]}]},
        {"title": "③ 고객불만", "cols": [C("번호", "text", 95), C("접수일", "text", 80), C("고객", "text", 90), C("제번", "text", 90),
                                       C("유형", "text"), C("수량"), C("비용"), C("8D", "text"), C("상태", "text")],
         "rows": [[r["claim_no"], r["date"], r["customer"], r["code"], r["type"], r["qty"], r["cost"],
                   "%d/8" % sum(1 for k in ("d1_team", "d2_problem", "d3_contain", "d4_cause", "d5_action", "d6_verify", "d7_prevent", "d8_close") if r.get(k)),
                   r["status"]] for r in cl]},
        {"title": "④ 수입검사 불합격", "cols": [C("입고일", "text", 80), C("코일 LOT", "text", 110), C("자재번호", "text"), C("공급사", "text"),
                                          C("외관", "text"), C("포장", "text"), C("비고", "text", 200)],
         "rows": [[r["date"], r["lot_no"], r["mat_code"], r["maker"], r["appearance"], r["packing"], r["note"]] for r in inc_bad]},
        {"title": "⑤ 계측기 교정 지남 · 임박", "cols": [C("관리번호", "text"), C("명칭", "text", 150), C("다음 검교정", "text"), C("다음 자체점검", "text"), C("상태", "text")],
         "rows": [[g["gauge_no"], g["name"], g["next_cal"], g["next_check"], g["due_state"]] for g in gs if g["due_state"] in ("지남", "임박")]},
    ]}


REPORTS = {"daily": daily, "monthly": monthly, "equip": equip, "worker": worker, "month": month, "year": year, "defect": defect,
           "qmonth": qmonth}
