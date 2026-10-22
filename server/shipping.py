# -*- coding: utf-8 -*-
"""출하관리 — 생산실적이 제품의 출고처별 '출하대기 재고'로 쌓이고, 출고 · 보류 · 조정으로 줄어든다.
수량은 모두 R/L(릴)로 저장. BOX·EA 는 제품 기준정보(박스단위·릴수량)로 화면에서 계산.

출고 가능(avail) = 생산(재고 시작일 이후) + 조정 − 일반 출고 − 보류 건 수량 + 보류에서 재고로 푼 수량
보류 중(held)    = 보류 수량 − (보류에서 출고 · 불량 · 재고로 푼 수량)
"""
import datetime

import db
import attendance

DESTS = ["물류출고", "케이씨텍출고", "공영도금출고", "남동공장출고"]
REASONS = ["불량선별 대기", "발주 부족"]
EPS = 1e-6


def start():
    return db.get_setting("ship_start") or ""


def _products():
    return {p["code"].lower(): p for p in db.rows("SELECT code, name, ship_to, box_reels, reel_qty FROM products")}


def _hold_rows(include_closed=True):
    acts = {}
    for t in db.rows("SELECT * FROM ship_tx WHERE hold_id IS NOT NULL ORDER BY ship_date, id"):
        acts.setdefault(t["hold_id"], []).append(t)
    out = []
    today = datetime.date.today()
    for h in db.rows("SELECT * FROM ship_holds ORDER BY hold_date, id"):
        a = acts.get(h["id"], [])
        remain = (h["reels"] or 0) - sum(t["reels"] or 0 for t in a)
        closed = remain <= EPS
        if closed and not include_closed:
            continue
        try:
            days = (today - datetime.date.fromisoformat(h["hold_date"])).days
        except (TypeError, ValueError):
            days = 0
        r = dict(h)
        r.update({"remain": max(0.0, remain), "closed": closed, "days": days,
                  "acts": [{"kind": t["kind"], "reels": t["reels"], "ship_date": t["ship_date"], "quick": t["quick"]} for t in a]})
        out.append(r)
    return out


def stock():
    st = start()
    prods = _products()
    agg = {}

    def row(code):
        k = code.lower()
        if k not in agg:
            p = prods.get(k) or {}
            agg[k] = {"code": p.get("code") or code, "name": p.get("name") or "", "dest": p.get("ship_to") or DESTS[0],
                      "box_reels": p.get("box_reels") or 0, "reel_qty": p.get("reel_qty") or 0,
                      "registered": bool(p), "produced": 0.0, "avail": 0.0, "held": 0.0, "dates": []}
        return agg[k]

    if st:
        for r in db.rows("""SELECT code, date, SUM(COALESCE(day_reels,0)+COALESCE(night_reels,0)) reels FROM production
                            WHERE date >= ? GROUP BY code, date ORDER BY date""", (st,)):
            if not r["code"] or not r["reels"]:
                continue
            x = row(r["code"])
            x["produced"] += r["reels"]
            x["avail"] += r["reels"]
            x["dates"].append([r["date"], r["reels"]])
        for t in db.rows("SELECT * FROM ship_tx"):
            x = row(t["code"])
            if t["kind"] == "adjust":
                x["avail"] += t["reels"] or 0
            elif t["kind"] == "out" and not t["hold_id"]:
                x["avail"] -= t["reels"] or 0
            elif t["kind"] == "release":
                x["avail"] += t["reels"] or 0
        for h in _hold_rows():
            x = row(h["code"])
            x["avail"] -= h["reels"] or 0
            x["held"] += h["remain"]
    rows = []
    for x in agg.values():
        x["total"] = x["avail"] + x["held"]
        x["dates"] = x["dates"][-12:]
        if abs(x["avail"]) > EPS or x["held"] > EPS:
            rows.append(x)
    rows.sort(key=lambda r: r["code"])
    return {"start": st, "rows": rows, "dests": DESTS, "reasons": REASONS, "holidays": attendance.holidays_map()}


def _row_of(code):
    for r in stock()["rows"]:
        if r["code"].lower() == code.lower():
            return r
    return None


def set_start(date, user, ip):
    datetime.date.fromisoformat(date)
    db.set_setting("ship_start", date)
    db.log(user, ip, "ship", "start", "", "출하 재고 시작일 %s" % date)


def confirm(b, user, ip):
    if not start():
        raise ValueError("재고 시작일을 먼저 정하세요.")
    items, holds = b.get("items") or [], b.get("holds") or []
    need = {}
    for x in items + holds:
        need[x["code"].lower()] = need.get(x["code"].lower(), 0) + float(x["reels"])
    for k, q in need.items():
        r = _row_of(k)
        if not r or q > r["avail"] + 0.001:
            raise ValueError("%s: 출고 가능 재고(%.2f R/L)보다 많습니다." % (k.upper(), r["avail"] if r else 0))
    now = db.now()
    sd = b.get("ship_date") or now[:10]
    cur = db.run("INSERT INTO ship_batches(dest,ship_date,memo,created,created_by) VALUES(?,?,?,?,?)",
                 (b.get("dest"), sd, b.get("memo") or "", now, user))
    bid = cur.lastrowid
    for x in items:
        db.run("""INSERT INTO ship_tx(kind,code,reels,dest,ship_date,ship_time,memo,quick,batch_id,created,created_by)
                  VALUES('out',?,?,?,?,?,?,0,?,?,?)""",
               (x["code"], float(x["reels"]), x.get("dest") or b.get("dest"), sd, "", "", bid, now, user))
    for h in holds:
        r = _row_of(h["code"])
        db.run("""INSERT INTO ship_holds(code,reels,reason,dest,hold_date,memo,batch_id,created,created_by)
                  VALUES(?,?,?,?,?,?,?,?,?)""",
               (h["code"], float(h["reels"]), h.get("reason") or REASONS[0], (r or {}).get("dest") or b.get("dest"),
                now[:10], "", bid, now, user))
    db.log(user, ip, "ship", "confirm", bid, "%s 출하 확정 %s · 출고 %d품번 · 보류 %d품번" % (sd, b.get("dest"), len(items), len(holds)))


def quick(b, user, ip):
    reels = float(b.get("reels") or 0)
    if reels <= 0:
        raise ValueError("수량을 입력하세요.")
    now = db.now()
    db.run("""INSERT INTO ship_tx(kind,code,reels,dest,ship_date,ship_time,memo,quick,created,created_by)
              VALUES('out',?,?,?,?,?,?,1,?,?)""",
           (b["code"], reels, b.get("dest") or DESTS[0], b.get("ship_date") or now[:10], b.get("ship_time") or "",
            b.get("memo") or "", now, user))
    db.log(user, ip, "ship", "quick", b["code"], "퀵 출고 %s %.2f R/L" % (b["code"], reels))


def adjust(b, user, ip):
    target = float(b.get("reels"))
    r = _row_of(b["code"])
    total = r["total"] if r else 0.0
    diff = round(target - total, 4)
    if abs(diff) > EPS:
        now = db.now()
        db.run("""INSERT INTO ship_tx(kind,code,reels,dest,ship_date,memo,created,created_by)
                  VALUES('adjust',?,?,?,?,?,?,?)""",
               (b["code"], diff, (r or {}).get("dest") or DESTS[0], now[:10], b.get("memo") or "", now, user))
        db.log(user, ip, "ship", "adjust", b["code"], "재고 조정 %s %+.2f R/L" % (b["code"], diff))
    return {"diff": diff}


def holds(include_closed):
    prods = _products()
    rows = []
    for h in _hold_rows(include_closed):
        p = prods.get((h["code"] or "").lower()) or {}
        h.update({"name": p.get("name") or "", "box_reels": p.get("box_reels") or 0, "reel_qty": p.get("reel_qty") or 0})
        rows.append(h)
    return {"rows": rows, "dests": DESTS, "reasons": REASONS}


def add_hold(b, user, ip):
    r = _row_of(b["code"])
    q = float(b.get("reels") or 0)
    if not r or q > r["avail"] + 0.001:
        raise ValueError("출고 가능 재고보다 많이 보류할 수 없습니다.")
    now = db.now()
    db.run("""INSERT INTO ship_holds(code,reels,reason,dest,hold_date,memo,created,created_by) VALUES(?,?,?,?,?,?,?,?)""",
           (r["code"], q, b.get("reason") or REASONS[0], r["dest"], now[:10], b.get("memo") or "", now, user))
    db.log(user, ip, "ship", "hold", r["code"], "보류 %s %.2f R/L (%s)" % (r["code"], q, b.get("reason")))


def act_hold(hid, b, user, ip):
    h = next((x for x in _hold_rows() if x["id"] == hid), None)
    if not h:
        raise ValueError("보류를 찾을 수 없습니다.")
    good, bad = float(b.get("good") or 0), float(b.get("bad") or 0)
    if good + bad > h["remain"] + 0.001:
        raise ValueError("남은 수량보다 많습니다.")
    now = db.now()
    if good > EPS:
        out = b.get("good_to") == "out"
        db.run("""INSERT INTO ship_tx(kind,code,reels,dest,ship_date,memo,quick,hold_id,created,created_by)
                  VALUES(?,?,?,?,?,?,?,?,?,?)""",
               ("out" if out else "release", h["code"], good, b.get("dest") or h["dest"],
                (b.get("ship_date") or now[:10]) if out else now[:10], b.get("memo") or "",
                1 if (out and b.get("quick")) else 0, hid, now, user))
    if bad > EPS:
        db.run("""INSERT INTO ship_tx(kind,code,reels,dest,ship_date,memo,hold_id,created,created_by)
                  VALUES('defect',?,?,?,?,?,?,?,?)""", (h["code"], bad, h["dest"], now[:10], b.get("memo") or "", hid, now, user))
    db.log(user, ip, "ship", "hold_act", hid, "보류 처리 %s 양품 %.2f · 불량 %.2f" % (h["code"], good, bad))


def del_hold(hid, user, ip):
    if db.one("SELECT id FROM ship_tx WHERE hold_id=? LIMIT 1", (hid,)):
        raise ValueError("처리한 기록이 있는 보류는 지울 수 없습니다.")
    db.run("DELETE FROM ship_holds WHERE id=?", (hid,))
    db.log(user, ip, "ship", "hold_del", hid, "보류 삭제")


def tx_list(d1, d2, kinds):
    ks = [k for k in (kinds or "out").split(",") if k]
    prods = _products()
    holds_by = {h["id"]: h for h in db.rows("SELECT id, reason FROM ship_holds")}
    batches = {b["id"]: b for b in db.rows("SELECT id, memo FROM ship_batches")}
    sql = "SELECT * FROM ship_tx WHERE kind IN (%s)" % ",".join("?" * len(ks))
    args = list(ks)
    if d1:
        sql += " AND ship_date >= ?"
        args.append(d1)
    if d2:
        sql += " AND ship_date <= ?"
        args.append(d2)
    sql += " ORDER BY ship_date DESC, id DESC"
    rows = []
    for t in db.rows(sql, args):
        p = prods.get((t["code"] or "").lower()) or {}
        reels = t["reels"] or 0
        t.update({"name": p.get("name") or "",
                  "box": reels / p["box_reels"] if p.get("box_reels") else None,
                  "ea": round(reels * p["reel_qty"]) if p.get("reel_qty") else None,
                  "hold_reason": (holds_by.get(t["hold_id"]) or {}).get("reason"),
                  "batch_memo": (batches.get(t["batch_id"]) or {}).get("memo")})
        rows.append(t)
    return {"rows": rows, "dests": DESTS}


def tx_date(tid, ship_date, whole, user, ip):
    t = db.one("SELECT * FROM ship_tx WHERE id=?", (tid,))
    if not t:
        raise ValueError("기록을 찾을 수 없습니다.")
    if whole and t["batch_id"]:
        db.run("UPDATE ship_tx SET ship_date=? WHERE batch_id=? AND kind='out'", (ship_date, t["batch_id"]))
        db.run("UPDATE ship_batches SET ship_date=? WHERE id=?", (ship_date, t["batch_id"]))
    else:
        db.run("UPDATE ship_tx SET ship_date=? WHERE id=?", (ship_date, tid))
    db.log(user, ip, "ship", "date", tid, "출고일 수정 → %s" % ship_date)


def tx_delete(tid, whole, user, ip):
    t = db.one("SELECT * FROM ship_tx WHERE id=?", (tid,))
    if not t:
        return
    if whole and t["batch_id"]:
        bid = t["batch_id"]
        for h in db.rows("SELECT id FROM ship_holds WHERE batch_id=?", (bid,)):
            if db.one("SELECT id FROM ship_tx WHERE hold_id=? LIMIT 1", (h["id"],)):
                raise ValueError("같이 건 보류를 이미 처리해서 전체 취소할 수 없습니다. '이 줄만 취소'를 쓰세요.")
        db.run("DELETE FROM ship_tx WHERE batch_id=?", (bid,))
        db.run("DELETE FROM ship_holds WHERE batch_id=?", (bid,))
        db.run("DELETE FROM ship_batches WHERE id=?", (bid,))
        db.log(user, ip, "ship", "cancel", bid, "출하 확정 전체 취소 (%s)" % t["ship_date"])
    else:
        db.run("DELETE FROM ship_tx WHERE id=?", (tid,))
        db.log(user, ip, "ship", "cancel", tid, "출고 취소 %s %.2f R/L" % (t["code"], t["reels"] or 0))
