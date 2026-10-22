# -*- coding: utf-8 -*-
"""금형부품 재고 · 입고 / 출고 / 재고조정(실사) · 입출고 이력."""
import db


def _state(qty, safety):
    qty = qty or 0
    safety = safety or 0
    if safety > 0 and qty <= 0:
        return "품절"
    if qty < safety:
        return "미달"
    if safety > 0 and qty == safety:
        return "주의"
    return "정상"


def list_parts():
    molds = {m["mold_no"]: m for m in db.rows("SELECT mold_no, part_no, part_name, status FROM molds")}
    last_out = {r["part_id"]: r["d"] for r in db.rows(
        "SELECT part_id, MAX(date) d FROM parts_tx WHERE kind='출고' GROUP BY part_id")}
    out = []
    for p in db.rows("SELECT * FROM parts ORDER BY name"):
        m = molds.get(p.get("mold_no")) or {}
        qty, safety = p.get("qty") or 0, p.get("safety_qty") or 0
        p.update({
            "state": _state(qty, safety),
            "short": max(0, safety - qty),
            "amount": qty * (p.get("price") or 0),
            "mold_label": p.get("mold_no") or "(공용)",
            "mold_base": p.get("mold_no") or "(공용)",
            "mold_part_name": m.get("part_name"),
            "mold_part_no": m.get("part_no"),
            "mold_status": m.get("status"),
            "last_out": last_out.get(p["id"]),
        })
        out.append(p)
    return out


def shortage():
    return [p for p in list_parts() if p["state"] in ("품절", "미달")]


def move(part_id, v, user, ip):
    p = db.one("SELECT * FROM parts WHERE id=?", (part_id,))
    if not p:
        raise ValueError("부품을 찾을 수 없습니다.")
    kind = v.get("kind")
    try:
        q = int(round(float(str(v.get("qty", "")).replace(",", ""))))
    except ValueError:
        raise ValueError("수량을 입력하세요.")
    cur = p.get("qty") or 0
    if kind == "입고":
        if q <= 0:
            raise ValueError("입고 수량은 1 이상이어야 합니다.")
        new, delta = cur + q, q
    elif kind == "출고":
        if q <= 0:
            raise ValueError("출고 수량은 1 이상이어야 합니다.")
        if q > cur:
            raise ValueError("현재고(%d)보다 많이 출고할 수 없습니다." % cur)
        new, delta = cur - q, q
    elif kind == "조정":
        if q < 0:
            raise ValueError("실사 수량은 0 이상이어야 합니다.")
        new, delta = q, q - cur
    else:
        raise ValueError("구분이 올바르지 않습니다.")
    now = db.now()
    db.run("UPDATE parts SET qty=?, updated=?, updated_by=? WHERE id=?", (new, now, user, part_id))
    db.run("""INSERT INTO parts_tx(part_id,date,kind,qty,after_qty,mold_no,worker,note,created,created_by)
              VALUES(?,?,?,?,?,?,?,?,?,?)""",
           (part_id, v.get("date") or now[:10], kind, delta, new, v.get("mold_no") or None,
            v.get("worker") or None, v.get("note") or None, now, user))
    db.log(user, ip, "part_tx", kind, part_id, "%s %s %+d → 재고 %d" % (p["name"], kind, delta if kind != "출고" else -delta, new))
    safety = p.get("safety_qty") or 0
    return {"qty": new, "name": p["name"], "safety": safety, "warn": bool(safety and new < safety)}


def tx_list(part_id=None, d1=None, d2=None, kind=None):
    sql = """SELECT t.*, p.code, p.name, p.spec, p.unit, COALESCE(t.mold_no, p.mold_no, '(공용)') AS mold_label
             FROM parts_tx t LEFT JOIN parts p ON p.id=t.part_id WHERE 1=1"""
    args = []
    if part_id:
        sql += " AND t.part_id=?"
        args.append(part_id)
    if d1:
        sql += " AND t.date>=?"
        args.append(d1)
    if d2:
        sql += " AND t.date<=?"
        args.append(d2)
    if kind:
        sql += " AND t.kind=?"
        args.append(kind)
    sql += " ORDER BY t.date DESC, t.id DESC"
    return db.rows(sql, args)


def tx_delete(tx_id, user, ip):
    """이력 삭제 → 그 수량만큼 재고를 되돌림."""
    t = db.one("SELECT * FROM parts_tx WHERE id=?", (tx_id,))
    if not t:
        return
    p = db.one("SELECT * FROM parts WHERE id=?", (t["part_id"],))
    if p:
        q = t.get("qty") or 0
        back = -q if t["kind"] == "입고" else (q if t["kind"] == "출고" else -q)
        db.run("UPDATE parts SET qty=?, updated=?, updated_by=? WHERE id=?",
               ((p.get("qty") or 0) + back, db.now(), user, p["id"]))
    db.run("DELETE FROM parts_tx WHERE id=?", (tx_id,))
    db.log(user, ip, "part_tx", "delete", tx_id, "%s %s %s 이력 삭제 (재고 되돌림)" % (t["date"], t["kind"], (p or {}).get("name", "")))
