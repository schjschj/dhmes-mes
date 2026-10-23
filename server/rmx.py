# -*- coding: utf-8 -*-
"""[개선제안] 원재료 소요량(수율) · 안전재고 · 발주 알림.

- 재고: 창고 프로그램(rawmat 캐시)의 자재번호별 중량. 창고 자료가 없으면 코일 LOT(rawmat_lots, 입고 상태) 남은 중량.
- 필요량: 최근 납기 파일(생산계획)의 +20일 · 월말 · 익월말 필요 수량 × 제품 1 EA 당 원재료(생산중량, 없으면 제품+스크랩 중량, g).
- 판정: (재고 + 입고 예정) − 월말 필요량 < 안전재고 → 발주 필요, 익월말 기준으로만 모자라면 → 주의.
- 수율: 기간 생산실적 × 제품중량 / 이론 투입량(생산중량) — 자재번호 · 제품별, LOSS(중량) 포함한 실투입 추정.
"""
import db
import prodcalc
from common import get_json, set_json


def _w(p):
    """제품 1 EA 당 원재료 (g)."""
    return prodcalc._num(p.get("prod_weight")) or (prodcalc._num(p.get("weight")) + prodcalc._num(p.get("scrap_weight")))


def safety_cfg():
    return get_json("rm_safety", {})


def save_safety(b, user):
    cfg = safety_cfg()
    for x in b.get("rows") or []:
        mat = str(x.get("mat") or "").strip()
        if not mat:
            continue
        try:
            sk = float(str(x.get("safety") or 0).replace(",", "") or 0)
            ld = int(float(str(x.get("lead") or 0) or 0))
        except ValueError:
            raise ValueError("숫자를 확인하세요: %s" % mat)
        if sk <= 0 and ld <= 0:
            cfg.pop(mat, None)
        else:
            cfg[mat] = {"safety": sk, "lead": ld, "by": user, "at": db.now()}
    set_json("rm_safety", cfg)
    return {"n": len(cfg)}


def _stock():
    """자재번호 → {kg, rolls, src}"""
    import rawmat
    out = {}
    st = rawmat.stock_by_part()
    if st:
        for mat, rolls in st.items():
            if mat:
                out[mat] = {"kg": sum(x.get("weight") or 0 for x in rolls), "rolls": len(rolls), "src": "창고"}
    for r in db.rows("""SELECT mat_code, COALESCE(SUM(COALESCE(remain_weight, in_weight)),0) kg, COUNT(*) n FROM rawmat_lots
                        WHERE status='입고' AND mat_code<>'' GROUP BY mat_code"""):
        if r["mat_code"] not in out:
            out[r["mat_code"]] = {"kg": r["kg"], "rolls": r["n"], "src": "코일 LOT"}
    return out


def need():
    """자재번호별 필요량 · 재고 · 안전재고 · 판정."""
    import plan
    products = {p["code"].upper(): p for p in db.rows("SELECT * FROM products")}
    up = db.one("SELECT file_date FROM plan_uploads ORDER BY file_date DESC, id DESC LIMIT 1")
    agg, nomat, noweight = {}, [], []
    plan_err = None
    if up:
        try:
            rows = plan.compute(learned=False).get("rows") or []
        except Exception as e:          # 계획 계산이 실패해도 재고 · 안전재고는 보여 줌
            rows, plan_err = [], str(e)
        for r in rows:
            if not (r.get("R") or r.get("plan")):
                continue
            p = products.get(r["code"].upper()) or {}
            if not p.get("mat_code"):
                nomat.append(r["code"])
                continue
            w = _w(p)
            if not w:
                noweight.append(r["code"])
                continue
            a = agg.setdefault(p["mat_code"], {"mat": p["mat_code"], "desc": p.get("mat_desc") or "", "codes": [],
                                               "need_T": 0.0, "need_S": 0.0, "need_R": 0.0})
            a["codes"].append(r["code"])
            for k in ("T", "S", "R"):
                a["need_" + k] += (r.get(k) or 0) * w / 1000.0
    stock = _stock()
    cfg = safety_cfg()
    inc = db.rows("SELECT part_no, kg, date FROM plan_incoming WHERE done=0")
    mats = set(agg) | set(cfg) | set(stock)
    descs = {p["mat_code"]: p.get("mat_desc") or "" for p in products.values() if p.get("mat_code")}
    out = []
    for mat in sorted(mats):
        a = agg.get(mat) or {"mat": mat, "desc": descs.get(mat, ""), "codes": [], "need_T": 0.0, "need_S": 0.0, "need_R": 0.0}
        s = stock.get(mat) or {"kg": 0, "rolls": 0, "src": ""}
        c = cfg.get(mat) or {}
        incoming = sum(i["kg"] or 0 for i in inc if i["part_no"] == mat)
        have = (s["kg"] or 0) + incoming
        safety = c.get("safety") or 0
        left_S, left_R = have - a["need_S"], have - a["need_R"]
        if left_S < safety:
            st = "발주 필요"
        elif left_R < safety or (s["kg"] or 0) < safety:
            st = "주의"
        else:
            st = "정상"
        order = max(0.0, safety + a["need_R"] - have)
        lead = c.get("lead") or 0
        out.append({"mat": mat, "desc": a["desc"] or descs.get(mat, ""), "codes": a["codes"][:20], "n_codes": len(a["codes"]),
                    "stock": round(s["kg"] or 0, 1), "rolls": s["rolls"], "src": s["src"], "incoming": round(incoming, 1),
                    "need_T": round(a["need_T"], 1), "need_S": round(a["need_S"], 1), "need_R": round(a["need_R"], 1),
                    "safety": safety, "lead": lead, "left_S": round(left_S, 1), "left_R": round(left_R, 1),
                    "order": round(order, 1), "state": st})
    rank = {"발주 필요": 0, "주의": 1, "정상": 2}
    out.sort(key=lambda x: (rank[x["state"]], -x["order"], x["mat"]))
    return {"rows": out, "file_date": up["file_date"] if up else None, "nomat": sorted(set(nomat)), "noweight": sorted(set(noweight)),
            "plan_error": plan_err, "has_stock": bool(stock),
            "count": {k: sum(1 for x in out if x["state"] == k) for k in rank}}


def yields(d1, d2):
    """기간 수율: 제품중량 합 / 이론 투입 (생산중량), LOSS(중량, kg) 포함 실투입 추정."""
    products = {p["code"].upper(): p for p in db.rows("SELECT * FROM products")}
    by_code, by_mat = {}, {}
    nodata = set()
    for r in prodcalc.rows(d1, d2):
        p = products.get((r["code"] or "").upper()) or {}
        w, sw = prodcalc._num(p.get("weight")), prodcalc._num(p.get("scrap_weight"))
        tw = _w(p)
        q = r["qty"] or 0
        loss = sum(prodcalc._num(r.get(k)) for k in ("loss_mold_chg", "loss_mold_fix", "loss_coil", "loss_adjust", "loss_vision", "loss_init"))
        if not tw or not w:
            nodata.add(r["code"])
        x = by_code.setdefault(r["code"], {"code": r["code"], "name": p.get("name") or "", "mat": p.get("mat_code") or "",
                                           "qty": 0, "prod_kg": 0.0, "scrap_kg": 0.0, "input_kg": 0.0, "loss_kg": 0.0,
                                           "unit_w": w, "unit_tw": tw})
        x["qty"] += q
        x["prod_kg"] += q * w / 1000.0
        x["scrap_kg"] += q * sw / 1000.0
        x["input_kg"] += q * tw / 1000.0
        x["loss_kg"] += loss
    for x in by_code.values():
        x["yield"] = x["prod_kg"] / x["input_kg"] if x["input_kg"] else None
        x["real_yield"] = x["prod_kg"] / (x["input_kg"] + x["loss_kg"]) if (x["input_kg"] + x["loss_kg"]) else None
        m = by_mat.setdefault(x["mat"] or "(자재번호 없음)", {"mat": x["mat"] or "(자재번호 없음)", "qty": 0, "prod_kg": 0.0,
                                                             "input_kg": 0.0, "loss_kg": 0.0, "scrap_kg": 0.0, "codes": 0})
        m["codes"] += 1
        for k in ("qty", "prod_kg", "input_kg", "loss_kg", "scrap_kg"):
            m[k] += x[k]
    for m in by_mat.values():
        m["yield"] = m["prod_kg"] / m["input_kg"] if m["input_kg"] else None
        m["real_yield"] = m["prod_kg"] / (m["input_kg"] + m["loss_kg"]) if (m["input_kg"] + m["loss_kg"]) else None
    # 코일 LOT 실사용 (입고 중량 − 남은 중량) ↔ 그 LOT 으로 만든 제품 이론 투입
    lots = []
    for l in db.rows("SELECT * FROM rawmat_lots WHERE in_weight IS NOT NULL"):
        used = (l["in_weight"] or 0) - (l["remain_weight"] if l["remain_weight"] is not None else (l["in_weight"] or 0))
        prods = db.rows("SELECT code, date, day_reels, night_reels FROM production WHERE coil_lot=? AND date BETWEEN ? AND ?", (l["lot_no"], d1, d2))
        if not prods:
            continue
        theo = 0.0
        for r in prods:
            p = products.get((r["code"] or "").upper()) or {}
            q = (prodcalc._num(r["day_reels"]) + prodcalc._num(r["night_reels"])) * prodcalc._num(p.get("reel_qty"))
            theo += q * _w(p) / 1000.0
        lots.append({"lot_no": l["lot_no"], "mat": l["mat_code"], "in_kg": l["in_weight"], "used_kg": used, "theory_kg": round(theo, 1),
                     "diff": round(used - theo, 1) if used else None})
    tot = {k: sum(m[k] for m in by_mat.values()) for k in ("qty", "prod_kg", "input_kg", "loss_kg", "scrap_kg")}
    tot["yield"] = tot["prod_kg"] / tot["input_kg"] if tot["input_kg"] else None
    tot["real_yield"] = tot["prod_kg"] / (tot["input_kg"] + tot["loss_kg"]) if (tot["input_kg"] + tot["loss_kg"]) else None
    return {"codes": sorted(by_code.values(), key=lambda x: -x["input_kg"]), "mats": sorted(by_mat.values(), key=lambda x: -x["input_kg"]),
            "lots": lots, "total": tot, "nodata": sorted(c for c in nodata if c)}


_cache = {"t": 0, "v": None}


def alert_count():
    """대시보드용: 발주 필요 · 주의 자재 수 (계획 계산이 무거워서 5분 보관)."""
    import time
    if _cache["v"] is not None and time.time() - _cache["t"] < 300:
        return _cache["v"]
    try:
        n = need()
    except Exception:
        return None
    v = {"order": n["count"]["발주 필요"], "warn": n["count"]["주의"], "file_date": n["file_date"],
         "top": [{"mat": x["mat"], "desc": x["desc"], "order": x["order"]} for x in n["rows"] if x["state"] == "발주 필요"][:5]}
    _cache.update(t=time.time(), v=v)
    return v
