# -*- coding: utf-8 -*-
"""[개선제안] 금형관리 추가.

- 금형 이동 관리 (현황판 대체): 설비 장착 · 보관 · 사내 수리 · 외주 수리 · 폐기. 이동할 때마다 mold_moves 에 기록,
  molds.status / location 도 맞춰 바꿈. 작업지시서(오늘 또는 가장 최근)에 적힌 제번의 금형과 다르면 표시.
- 금형 기준정보 사진 · 도면 (mold_files): 개정 이력, 최신본 표시.
- 금형 유지비: 수리비(mold_repair.cost) + 부품 출고 금액(부품 출고 수량 × 단가) / 생산량 1,000 EA 당.
- 금형 부품 구매단가: 거래명세서 품목 + 부품 입고(단가 입력분) → 업체별 · 품목별 · 재질별 단가 비교.
"""
import datetime
import os
import re

import db
import workorders

FILE_DIR = os.path.join(db.DATA_DIR, "mold_files")
STATES = ["설비 장착", "보관", "사내 수리", "외주 수리", "폐기"]
STATUS_OF = {"설비 장착": "사용중", "보관": "보관", "사내 수리": "수리중", "외주 수리": "수리중", "폐기": "폐기"}


# ──────────────────────────────────────────── 이동 · 현황판
def _last_moves():
    out = {}
    for r in db.rows("SELECT * FROM mold_moves ORDER BY ts, id"):
        out[r["mold_no"]] = r
    return out


def _wo_expect():
    """작업지시서(오늘 이전 가장 최근) 설비별 현 생산 제번 → 금형."""
    today = datetime.date.today().isoformat()
    w = db.one("SELECT date FROM work_orders WHERE date<=? ORDER BY date DESC LIMIT 1", (today,))
    if not w:
        return None, {}
    doc = workorders.get(w["date"])["doc"]
    mold_of = {p["code"].upper(): p["mold_no"] for p in db.rows("SELECT code, mold_no FROM products WHERE mold_no<>''")}
    out = {}
    for side in ("left", "right"):
        for ln in doc["data"].get(side, []):
            codes = workorders.CODE_RE.findall(((ln.get("cells") or {}).get("cur") or {}).get("t") or "")
            ms = [mold_of[c.upper()] for c in codes if mold_of.get(c.upper())]
            if ms:
                out[str(ln.get("equip"))] = {"codes": codes, "molds": list(dict.fromkeys(ms))}
    return w["date"], out


def board():
    last = _last_moves()
    eqs = db.rows("SELECT no, ton, maker, status FROM equipment WHERE COALESCE(status,'')<>'폐기'")
    eqs.sort(key=lambda e: (len(str(e["no"])), str(e["no"])))
    used = {}
    for p in db.rows("SELECT code, name, mold_no FROM products WHERE mold_no<>''"):
        used.setdefault(p["mold_no"], []).append(p["code"])
    nfiles = {r["mold_no"]: r for r in db.rows("""SELECT mold_no, SUM(kind='사진') photos, SUM(kind='도면') drawings
                                                 FROM mold_files WHERE current=1 GROUP BY mold_no""")}
    molds = []
    for m in db.rows("SELECT mold_no, part_no, part_name, status, location FROM molds ORDER BY mold_no"):
        mv = last.get(m["mold_no"])
        if mv:
            state, place, since = mv["state"], mv["place"], mv["ts"]
        else:
            st = m.get("status") or ""
            state = "사내 수리" if st == "수리중" else "폐기" if st == "폐기" else "보관"
            place, since = m.get("location") or "", None
        f = nfiles.get(m["mold_no"]) or {}
        molds.append({"mold_no": m["mold_no"], "part_no": m["part_no"], "part_name": m["part_name"], "state": state,
                      "place": place or "", "since": since, "codes": used.get(m["mold_no"], []),
                      "photos": f.get("photos") or 0, "drawings": f.get("drawings") or 0})
    wo_date, expect = _wo_expect()
    mounted = {}
    for m in molds:
        if m["state"] == "설비 장착":
            mounted.setdefault(str(m["place"]), []).append(m["mold_no"])
    equips = []
    for e in eqs:
        no = str(e["no"])
        ex = expect.get(no) or {}
        miss = [x for x in ex.get("molds", []) if x not in mounted.get(no, [])]
        equips.append({"no": no, "ton": e.get("ton"), "maker": e.get("maker"), "molds": mounted.get(no, []),
                       "wo_codes": ex.get("codes", []), "wo_molds": ex.get("molds", []), "mismatch": miss})
    return {"states": STATES, "molds": molds, "equips": equips, "wo_date": wo_date}


def move(b, user, ip):
    nos = b.get("mold_nos") or ([b["mold_no"]] if b.get("mold_no") else [])
    state = b.get("state")
    if not nos:
        raise ValueError("금형을 고르세요.")
    if state not in STATES:
        raise ValueError("이동 구분이 올바르지 않습니다.")
    place = str(b.get("place") or "").strip()
    if state == "설비 장착":
        if not db.one("SELECT no FROM equipment WHERE CAST(no AS TEXT)=?", (place,)):
            raise ValueError("장착할 설비를 고르세요.")
    last = _last_moves()
    ts = (b.get("ts") or db.now())[:19]
    for no in nos:
        m = db.one("SELECT mold_no, status, location FROM molds WHERE mold_no=?", (no,))
        if not m:
            raise ValueError("없는 금형: %s" % no)
        prev = last.get(no) or {}
        db.run("""INSERT INTO mold_moves(mold_no,ts,state,place,from_state,from_place,worker,note,created_by)
                  VALUES(?,?,?,?,?,?,?,?,?)""",
               (no, ts, state, place, prev.get("state") or "", prev.get("place") or m.get("location") or "",
                b.get("worker") or user, b.get("note") or "", user))
        sets = {"status": STATUS_OF[state], "updated": db.now(), "updated_by": user}
        if state == "보관" and place:
            sets["location"] = place
        db.run("UPDATE molds SET %s WHERE mold_no=?" % ",".join('"%s"=?' % k for k in sets), list(sets.values()) + [no])
        db.log(user, ip, "mold_moves", "move", no, "금형 %s → %s %s" % (no, state, place))
    return {"n": len(nos)}


def moves(mold_no=None, d1=None, d2=None):
    sql, args = "SELECT * FROM mold_moves WHERE 1=1", []
    if mold_no:
        sql += " AND mold_no=?"
        args.append(mold_no)
    if d1:
        sql += " AND ts>=?"
        args.append(d1)
    if d2:
        sql += " AND ts<=?"
        args.append(d2 + " 99")
    return db.rows(sql + " ORDER BY ts DESC, id DESC LIMIT 2000", args)


def delete_move(mid, user, ip):
    m = db.one("SELECT * FROM mold_moves WHERE id=?", (mid,))
    if not m:
        return
    db.run("DELETE FROM mold_moves WHERE id=?", (mid,))
    db.log(user, ip, "mold_moves", "delete", mid, "금형 이동 기록 삭제 %s %s" % (m["mold_no"], m["ts"]))


# ──────────────────────────────────────────── 사진 · 도면
def files(mold_no):
    return db.rows("SELECT * FROM mold_files WHERE mold_no=? ORDER BY kind, current DESC, id DESC", (mold_no,))


def add_file(meta, filename, buf, user, ip):
    if not meta.get("mold_no") or not db.one("SELECT mold_no FROM molds WHERE mold_no=?", (meta["mold_no"],)):
        raise ValueError("금형을 고르세요.")
    if not buf:
        raise ValueError("파일이 비었습니다.")
    kind = meta.get("kind") or "사진"
    os.makedirs(FILE_DIR, exist_ok=True)
    safe = re.sub(r"[^\w.\-가-힣]", "_", filename or "file")
    path = os.path.join(FILE_DIR, "%s_%s_%s" % (re.sub(r"[^\w\-]", "_", meta["mold_no"]),
                                                db.now().replace(":", "").replace(" ", "_").replace("-", ""), safe))
    with open(path, "wb") as f:
        f.write(buf)
    title = meta.get("title") or ""
    if kind == "도면":       # 도면은 같은 제목의 이전 판을 지난 판으로
        db.run("UPDATE mold_files SET current=0 WHERE mold_no=? AND kind=? AND COALESCE(title,'')=?", (meta["mold_no"], kind, title))
    cur = db.run("""INSERT INTO mold_files(mold_no,kind,title,rev,rev_date,file_name,file_path,file_size,current,note,created,created_by)
                    VALUES(?,?,?,?,?,?,?,?,1,?,?,?)""",
                 (meta["mold_no"], kind, title, meta.get("rev") or "", meta.get("rev_date") or db.now()[:10], filename, path,
                  len(buf), meta.get("note") or "", db.now(), user))
    db.log(user, ip, "mold_files", "upload", cur.lastrowid, "금형 %s %s %s 등록" % (meta["mold_no"], kind, title or filename))
    return {"id": cur.lastrowid}


def file_of(fid):
    f = db.one("SELECT * FROM mold_files WHERE id=?", (fid,))
    if not f or not f["file_path"] or not os.path.isfile(f["file_path"]):
        return None
    return f


def delete_file(fid, user, ip):
    f = db.one("SELECT * FROM mold_files WHERE id=?", (fid,))
    if not f:
        return
    db.run("DELETE FROM mold_files WHERE id=?", (fid,))
    try:
        os.remove(f["file_path"])
    except (OSError, TypeError):
        pass
    db.log(user, ip, "mold_files", "delete", fid, "금형 %s %s 삭제" % (f["mold_no"], f["file_name"]))


# ──────────────────────────────────────────── 유지비
def cost(d1, d2):
    """금형별 수리 건수 · 수리비 · 부품 출고 금액 · 생산량 · 1,000 EA 당 유지비."""
    import prodcalc
    agg = {}

    def a(no):
        return agg.setdefault(no, {"mold_no": no, "repairs": 0, "repair_cost": 0, "parts_cost": 0, "parts_n": 0, "qty": 0})
    for r in db.rows("SELECT mold_no, COUNT(*) n, COALESCE(SUM(cost),0) c FROM mold_repair WHERE date BETWEEN ? AND ? GROUP BY mold_no", (d1, d2)):
        x = a(r["mold_no"])
        x["repairs"], x["repair_cost"] = r["n"], r["c"]
    for r in db.rows("""SELECT COALESCE(t.mold_no, p.mold_no) mold_no, SUM(t.qty) n,
                               SUM(t.qty * COALESCE(p.price, 0)) c
                        FROM parts_tx t JOIN parts p ON p.id=t.part_id
                        WHERE t.kind='출고' AND t.date BETWEEN ? AND ? GROUP BY 1""", (d1, d2)):
        if not r["mold_no"]:
            continue
        x = a(r["mold_no"])
        x["parts_n"], x["parts_cost"] = r["n"] or 0, r["c"] or 0
    mold_of = {p["code"].upper(): p["mold_no"] for p in db.rows("SELECT code, mold_no FROM products WHERE mold_no<>''")}
    for r in prodcalc.rows(d1, d2):
        m = mold_of.get((r["code"] or "").upper())
        if m:
            a(m)["qty"] += r["qty"] or 0
    names = {m["mold_no"]: m for m in db.rows("SELECT mold_no, part_no, part_name FROM molds")}
    rows = []
    for x in agg.values():
        if not (x["repairs"] or x["parts_cost"] or x["repair_cost"]):
            continue
        m = names.get(x["mold_no"]) or {}
        x["part_name"] = m.get("part_name") or ""
        x["total"] = (x["repair_cost"] or 0) + (x["parts_cost"] or 0)
        x["per_k"] = round(x["total"] / x["qty"] * 1000, 1) if x["qty"] else None
        rows.append(x)
    rows.sort(key=lambda x: -x["total"])
    months = []
    d = datetime.date.fromisoformat(d1).replace(day=1)
    end = datetime.date.fromisoformat(d2)
    while d <= end:
        nxt = (d + datetime.timedelta(days=32)).replace(day=1)
        e = min(end, nxt - datetime.timedelta(days=1)).isoformat()
        s = max(d1, d.isoformat())
        rc = db.one("SELECT COALESCE(SUM(cost),0) c FROM mold_repair WHERE date BETWEEN ? AND ?", (s, e))["c"]
        pc = db.one("""SELECT COALESCE(SUM(t.qty*COALESCE(p.price,0)),0) c FROM parts_tx t JOIN parts p ON p.id=t.part_id
                       WHERE t.kind='출고' AND t.date BETWEEN ? AND ?""", (s, e))["c"]
        months.append({"ym": d.strftime("%Y-%m"), "repair": rc, "parts": pc})
        d = nxt
    return {"rows": rows, "months": months,
            "total": {"repair_cost": sum(x["repair_cost"] for x in rows), "parts_cost": sum(x["parts_cost"] for x in rows),
                      "repairs": sum(x["repairs"] for x in rows)}}


# ──────────────────────────────────────────── 부품 구매단가
def _purchases(d1, d2):
    """거래명세서 품목(금형부품 · 기타) + 부품 입고(단가 입력, 명세서 없이)."""
    out = []
    for r in db.rows("""SELECT i.date, i.supplier, it.item, it.spec, it.material, it.qty, it.unit, it.unit_price, it.amount,
                               it.part_id, p.category, p.code part_code, 'invoice' src
                        FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id LEFT JOIN parts p ON p.id=it.part_id
                        WHERE it.target<>'원재료' AND i.date BETWEEN ? AND ?""", (d1, d2)):
        out.append(r)
    for r in db.rows("""SELECT t.date, COALESCE(t.supplier, p.maker) supplier, p.name item, p.spec, p.material, t.qty, p.unit,
                               t.price unit_price, t.qty*t.price amount, p.id part_id, p.category, p.code part_code, 'parts' src
                        FROM parts_tx t JOIN parts p ON p.id=t.part_id
                        WHERE t.kind='입고' AND t.price IS NOT NULL AND t.invoice_id IS NULL AND t.date BETWEEN ? AND ?""", (d1, d2)):
        out.append(r)
    for r in out:
        r["supplier"] = (r.get("supplier") or "(구입처 없음)").strip()
        r["material"] = (r.get("material") or "").strip()
        if r.get("unit_price") is None and r.get("amount") and r.get("qty"):
            r["unit_price"] = r["amount"] / r["qty"]
        if r.get("amount") is None and r.get("unit_price") is not None and r.get("qty"):
            r["amount"] = r["unit_price"] * r["qty"]
    return [r for r in out if r.get("unit_price")]


def _key(r):
    return re.sub(r"\s+", " ", ("%s %s" % (r.get("item") or "", r.get("spec") or "")).strip()).upper()


def prices(d1, d2):
    ps = _purchases(d1, d2)
    by_sup, by_item, by_mat = {}, {}, {}
    for r in sorted(ps, key=lambda r: r["date"] or ""):
        s = by_sup.setdefault(r["supplier"], {"supplier": r["supplier"], "n": 0, "amount": 0, "items": set()})
        s["n"] += 1
        s["amount"] += r["amount"] or 0
        s["items"].add(_key(r))
        k = _key(r)
        it = by_item.setdefault(k, {"item": r["item"], "spec": r["spec"] or "", "material": r["material"], "category": r.get("category") or "",
                                     "n": 0, "qty": 0, "amount": 0, "min": None, "max": None, "first": None, "last": None,
                                     "last_date": None, "last_sup": None, "sups": {}})
        up = float(r["unit_price"])
        it["n"] += 1
        it["qty"] += r["qty"] or 0
        it["amount"] += r["amount"] or 0
        it["min"] = up if it["min"] is None else min(it["min"], up)
        it["max"] = up if it["max"] is None else max(it["max"], up)
        it["first"] = it["first"] if it["first"] is not None else up
        it["last"], it["last_date"], it["last_sup"] = up, r["date"], r["supplier"]
        sp = it["sups"].setdefault(r["supplier"], {"n": 0, "sum": 0.0, "last": None, "min": None})
        sp["n"] += 1
        sp["sum"] += up
        sp["last"] = up
        sp["min"] = up if sp["min"] is None else min(sp["min"], up)
        mk = r["material"] or r.get("category") or "(재질 없음)"
        m = by_mat.setdefault(mk, {"material": mk, "n": 0, "amount": 0, "qty": 0})
        m["n"] += 1
        m["amount"] += r["amount"] or 0
        m["qty"] += r["qty"] or 0
    items = []
    for it in by_item.values():
        it["avg"] = round(it["amount"] / it["qty"], 1) if it["qty"] else None
        it["change"] = (it["last"] - it["first"]) / it["first"] if it["first"] else None
        sups = [{"supplier": k, "n": v["n"], "avg": round(v["sum"] / v["n"], 1), "last": v["last"], "min": v["min"]} for k, v in it["sups"].items()]
        sups.sort(key=lambda s: s["avg"])
        it["sups"] = sups
        it["best_sup"] = sups[0]["supplier"] if len(sups) > 1 else None
        # 최저가 업체로 샀다면 아낄 수 있었던 금액
        it["save"] = round(max(0, it["amount"] - sups[0]["avg"] * it["qty"])) if len(sups) > 1 and it["qty"] else 0
        items.append(it)
    items.sort(key=lambda x: -x["amount"])
    sup = [dict(v, items=len(v["items"])) for v in by_sup.values()]
    sup.sort(key=lambda x: -x["amount"])
    mats = sorted(by_mat.values(), key=lambda x: -x["amount"])
    return {"suppliers": sup, "items": items, "materials": mats, "n": len(ps), "amount": sum(r["amount"] or 0 for r in ps),
            "save": sum(it["save"] for it in items)}


def price_hist(item, spec):
    k = re.sub(r"\s+", " ", ("%s %s" % (item or "", spec or "")).strip()).upper()
    return [r for r in sorted(_purchases("0000-00-00", "9999-99-99"), key=lambda r: r["date"] or "") if _key(r) == k]
