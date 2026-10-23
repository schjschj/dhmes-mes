# -*- coding: utf-8 -*-
"""[연동] 거래명세서 앱(dhmes-receipt) → MES.

명세서 앱이 사진을 AI 로 읽어 확정하면 POST /api/purchases/inbound 로 ReceiptData(JSON) 를 보낸다
(헤더 Authorization: Bearer <연동 키>, 연동 키는 구매관리 화면에서 발급).

- 금형부품 업체(기본: 무경 · 다온, 구매관리 화면에서 바꿈):
  품목 = 금형번호 ('10664 (H)', '10196-1 (LINER)'), NO/품번 = 그 금형의 부품번호 ('166', 'P23-3')
  → 금형부품 재고에서 같은 금형(끝 글자 · 모디파이 '-숫자' 차이 허용) + 부품코드를 찾아 바로 입고 (수량 · 단가 · 구입처).
  못 찾거나 후보가 여럿이면 '확인 필요' 로 남기고, 구매관리 > 금형부품 명세서에서 부품을 골라 입고.
- 그 밖의 업체: 일반 거래명세서로 등록 (업체 · 월별 정리, 사진 보관).
저장은 invoices / invoice_items (거래명세서 직접 입력과 같은 표, kind 로 구분).
"""
import base64
import hmac
import json
import os
import re
import secrets

import db
import parts as P
from common import get_json, set_json

IMG_DIR = os.path.join(db.DATA_DIR, "invoices")
DEFAULT_CFG = {"mold_suppliers": ["무경", "다온"]}


# ──────────────────────────────────────────── 설정 · 연동 키
def cfg():
    c = dict(DEFAULT_CFG)
    c.update(get_json("receipt_cfg", {}))
    return c


def cfg_view(is_admin):
    c = cfg()
    out = {"mold_suppliers": c["mold_suppliers"], "key_set": bool(c.get("api_key")), "gemini_set": bool(c.get("gemini_key")),
           "gemini_model": c.get("gemini_model") or "gemini-2.5-flash"}
    if is_admin:
        out["api_key"] = c.get("api_key") or ""
        k = c.get("gemini_key") or ""
        out["gemini_key_mask"] = (k[:4] + "…" + k[-4:]) if len(k) > 10 else ("설정됨" if k else "")
    return out


def save_cfg(b):
    c = get_json("receipt_cfg", {})
    if "mold_suppliers" in b:
        sup = b["mold_suppliers"]
        if isinstance(sup, str):
            sup = re.split(r"[,\n]", sup)
        c["mold_suppliers"] = [s.strip() for s in sup if s and s.strip()]
    if "gemini_key" in b:          # 모바일 촬영 분석용 (비우면 Windows OCR)
        c["gemini_key"] = (b.get("gemini_key") or "").strip()
    if b.get("gemini_model"):
        c["gemini_model"] = b["gemini_model"].strip()
    if b.get("new_key"):
        c["api_key"] = "mes_" + secrets.token_urlsafe(24)
    set_json("receipt_cfg", c)
    return cfg_view(True)


def check_key(auth_header):
    key = cfg().get("api_key")
    if not key:
        return False
    got = (auth_header or "").replace("Bearer", "", 1).strip()
    return bool(got) and hmac.compare_digest(got, key)


# ──────────────────────────────────────────── 금형부품 매칭
def is_mold_supplier(name, biz=None):
    n = re.sub(r"\s|\(주\)|㈜|주식회사", "", name or "")
    return any(s and re.sub(r"\s", "", s) in n for s in cfg()["mold_suppliers"])


def _n(s):
    return re.sub(r"[\s\-_./]", "", (s or "").upper())


def split_item(name, spec):
    """'10664 (H)' + '166' → ('10664', '166'). 품목에 부품번호까지 붙은 경우('10933 D10-1')도 나눔."""
    nm = re.sub(r"\(.*?\)", " ", name or "").strip()
    toks = nm.split()
    mold = toks[0] if toks else ""
    code = (spec or "").strip()
    if not code and len(toks) > 1:
        code = toks[1]
    code = re.sub(r"\(.*?\)", "", code).strip()
    return mold, code


def _mold_candidates(mold):
    """명세서 금형번호 → MES 금형번호 후보: 같은 것, 끝 글자(A·B…) 붙은 것, 모디파이 '-숫자' 의 기본 금형."""
    base = re.sub(r"-\d+$", "", mold)
    rows = db.rows("SELECT DISTINCT mold_no FROM parts WHERE mold_no LIKE ?", (base + "%",))
    out = []
    for r in rows:
        m = r["mold_no"] or ""
        if m == mold or m == base or re.fullmatch(re.escape(base) + r"[A-Z]?(-\d+)?", m, re.I):
            out.append(m)
    return out


def match_part(mold, code):
    """→ (part_id or None, 후보 [{id, label}])"""
    if not mold or not code:
        return None, []
    molds = _mold_candidates(mold)
    if not molds:
        return None, []
    rows = db.rows("SELECT id, code, name, spec, mold_no, qty FROM parts WHERE mold_no IN (%s)" % ",".join("?" * len(molds)), molds)
    hit = [r for r in rows if _n(r["code"]) == _n(code)]
    cands = [{"id": r["id"], "label": "%s · %s %s (재고 %s)" % (r["mold_no"], r["code"] or "", r["name"] or "", r["qty"] or 0)} for r in hit]
    if not hit:
        return None, []
    exact = [r for r in hit if r["mold_no"] == mold] or hit
    # 같은 부품이 두 번 등록된 경우(이름까지 같음)는 최근 등록 것으로 — 이름이 다르면 사람이 고름
    if len({(r["name"] or "").strip().upper() for r in exact}) == 1:
        return max(exact, key=lambda r: r["id"])["id"], cands
    return None, cands


# ──────────────────────────────────────────── 받기
def _int(v):
    try:
        return int(round(float(str(v).replace(",", "")))) if v not in (None, "") else None
    except ValueError:
        return None


def _num(v):
    try:
        return float(str(v).replace(",", "")) if v not in (None, "") else None
    except ValueError:
        return None


def inbound(data, ip, file_path=None, by=None, src="명세서 앱"):
    """명세서 앱 → MES. 같은 명세서(앱 접수번호 · 사진)를 다시 보내면 처음 결과를 그대로 돌려줌.
    MES 모바일 촬영(/m/receipt/, rcmobile.confirm)도 같은 길로 들어옴 (file_path = 보관한 사진, by = 작업자 (로그인한 사람))."""
    h = data.get("header") or {}
    sup = h.get("supplier") or {}
    summ = h.get("summary") or {}
    buyer = h.get("buyer") or {}
    items = data.get("items") or []
    if not sup.get("company_name"):
        raise ValueError("공급자 상호가 없습니다.")
    if not items:
        raise ValueError("품목이 없습니다.")
    ext = data.get("receipt_id") or data.get("image_id") or ""
    if ext:
        old = db.one("SELECT id, status FROM invoices WHERE ext_id=?", (ext,))
        if old:
            return {"success": True, "inbound_id": "MES-%d" % old["id"], "status": old["status"], "duplicate": True,
                    "message": "이미 MES 에 등록된 명세서입니다 (MES-%d)." % old["id"]}
    kind = "금형부품" if is_mold_supplier(sup.get("company_name"), sup.get("biz_no")) else "일반"
    worker = data.get("worker_name") or data.get("worker_id") or "명세서 앱"
    by = by or "명세서 앱 (%s)" % worker
    # 사진 보관
    path = file_path
    if data.get("image_b64"):
        try:
            buf = base64.b64decode(data["image_b64"])
            os.makedirs(IMG_DIR, exist_ok=True)
            path = os.path.join(IMG_DIR, "app_%s_%s.jpg" % (db.now().replace(":", "").replace(" ", "_").replace("-", ""),
                                                           re.sub(r"[^\w\-]", "_", ext or "x")[-20:]))
            with open(path, "wb") as f:
                f.write(buf)
        except (ValueError, OSError):
            path = None
    raw = {k: v for k, v in data.items() if k != "image_b64"}
    item_sum = sum(_int(i.get("amount")) or 0 for i in items)
    total = _int(summ.get("total_amount")) or item_sum
    supply = _int(summ.get("supply_amount")) or item_sum          # 앱이 공급가액을 못 읽으면(0) 품목 금액 합
    vat = _int(summ.get("vat_amount")) or (max(0, total - supply) if total > supply else 0)
    cur = db.run("""INSERT INTO invoices(date,supplier,doc_no,total,file_name,file_path,src,note,created,created_by,
                    kind,status,ext_id,supplier_biz,supply,vat,receiver,worker,raw)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (h.get("invoice_date") or db.now()[:10], sup.get("company_name").strip(), h.get("invoice_number") or "", total,
                  "%s.jpg" % (ext or "receipt"), path, src, data.get("confidence_notes") or "", db.now(), by,
                  kind, "등록", ext, sup.get("biz_no") or "", supply, vat,
                  buyer.get("receiver_name") or "", worker, json.dumps(raw, ensure_ascii=False)))
    inv = cur.lastrowid
    n_in = n_wait = 0
    for i, it in enumerate(items):
        qty, up, amt = _num(it.get("quantity")), _num(it.get("unit_price")), _num(it.get("amount"))
        if up is None and qty and amt:
            up = round(amt / qty, 2)
        mold = code = None
        part_id, cands, match, ref = None, [], "", None
        if kind == "금형부품":
            mold, code = split_item(it.get("item_name"), it.get("specification"))
            part_id, cands = match_part(mold, code)
            if part_id and qty and qty > 0:
                r = P.move(part_id, {"kind": "입고", "qty": qty, "date": h.get("invoice_date"), "price": up,
                                     "supplier": sup.get("company_name"), "invoice_id": inv, "worker": worker,
                                     "note": "거래명세서 자동 입고 (%s %s)" % (sup.get("company_name"), h.get("invoice_date") or "")}, by, ip)
                ref, match = r.get("tx_id"), "자동 입고"
                n_in += 1
            else:
                match = "확인 필요"
                n_wait += 1
        db.run("""INSERT INTO invoice_items(invoice_id,seq,target,item,spec,qty,unit,unit_price,amount,part_id,ref_id,note,
                  mold_no,part_code,match,tax,cands) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (inv, it.get("item_no") or i + 1, "금형부품" if kind == "금형부품" else "기타", (it.get("item_name") or "").strip(),
                (it.get("specification") or "").strip(), qty, it.get("unit") or "", up, amt, part_id, ref, it.get("remarks") or "",
                mold, code, match, _num(it.get("tax")), json.dumps(cands, ensure_ascii=False) if cands else None))
    status = ("확인 필요" if n_wait else "입고 완료") if kind == "금형부품" else "등록"
    db.run("UPDATE invoices SET status=? WHERE id=?", (status, inv))
    db.log(by, ip, "invoices", "create", inv, "거래명세서 %s %s %s %s 품목 %d%s" % (
        src, kind, sup.get("company_name"), h.get("invoice_date"), len(items),
        (" · 자동 입고 %d · 확인 필요 %d" % (n_in, n_wait)) if kind == "금형부품" else ""))
    msg = "MES 등록 완료 (MES-%d, %s)" % (inv, kind)
    if kind == "금형부품":
        msg += " — 자동 입고 %d건%s" % (n_in, (", 확인 필요 %d건 (MES 구매관리에서 처리)" % n_wait) if n_wait else "")
    return {"success": True, "inbound_id": "MES-%d" % inv, "status": status, "kind": kind, "auto_in": n_in, "pending": n_wait, "message": msg}


# ──────────────────────────────────────────── 화면
def _refresh_status(inv):
    r = db.one("SELECT kind FROM invoices WHERE id=?", (inv,))
    if r and r["kind"] == "금형부품":
        n = db.one("SELECT COUNT(*) n FROM invoice_items WHERE invoice_id=? AND match='확인 필요'", (inv,))["n"]
        db.run("UPDATE invoices SET status=? WHERE id=?", ("확인 필요" if n else "입고 완료", inv))


def list_(kind, d1=None, d2=None):
    sql = """SELECT i.id, i.date, i.supplier, i.supplier_biz, i.doc_no, i.total, i.supply, i.vat, i.src, i.kind, i.status, i.receiver,
                    i.worker, i.created, i.created_by, i.note, (i.file_path IS NOT NULL AND i.file_path<>'') has_file,
                    (SELECT COUNT(*) FROM invoice_items t WHERE t.invoice_id=i.id) n,
                    (SELECT COUNT(*) FROM invoice_items t WHERE t.invoice_id=i.id AND t.match='확인 필요') pending,
                    (SELECT GROUP_CONCAT(t.item, ', ') FROM (SELECT item FROM invoice_items t2 WHERE t2.invoice_id=i.id ORDER BY seq LIMIT 4) t) items
             FROM invoices i WHERE 1=1"""
    args = []
    if kind == "금형부품":
        sql += " AND i.kind='금형부품'"
    elif kind == "일반":
        sql += " AND COALESCE(i.kind,'')<>'금형부품'"
    if d1:
        sql += " AND i.date>=?"
        args.append(d1)
    if d2:
        sql += " AND i.date<=?"
        args.append(d2)
    return db.rows(sql + " ORDER BY i.date DESC, i.id DESC", args)


def detail(inv):
    i = db.one("SELECT * FROM invoices WHERE id=?", (inv,))
    if not i:
        raise ValueError("명세서를 찾을 수 없습니다.")
    i.pop("raw", None)
    i["has_file"] = bool(i.get("file_path") and os.path.isfile(i["file_path"]))
    i.pop("file_path", None)
    items = db.rows("""SELECT t.*, p.code p_code, p.name p_name, p.mold_no p_mold, p.qty p_qty FROM invoice_items t
                       LEFT JOIN parts p ON p.id=t.part_id WHERE t.invoice_id=? ORDER BY t.seq, t.id""", (inv,))
    for t in items:
        t["cands"] = json.loads(t["cands"]) if t.get("cands") else []
    return {"inv": i, "items": items}


def resolve(item_id, b, user, ip):
    """확인 필요 품목: 고른 부품(또는 새로 만든 부품)으로 입고."""
    t = db.one("SELECT * FROM invoice_items WHERE id=?", (item_id,))
    if not t:
        raise ValueError("품목을 찾을 수 없습니다.")
    if t["match"] not in ("확인 필요",):
        raise ValueError("이미 처리된 품목입니다.")
    inv = db.one("SELECT * FROM invoices WHERE id=?", (t["invoice_id"],))
    act = b.get("action")
    if act == "skip":
        db.run("UPDATE invoice_items SET match='입고 안 함', note=? WHERE id=?", (b.get("note") or "", item_id))
        _refresh_status(t["invoice_id"])
        return {"ok": True}
    pid = b.get("part_id")
    if act == "new":
        now = db.now()
        mold = (b.get("mold_no") or t["mold_no"] or "").strip()
        cur = db.run("""INSERT INTO parts(code,name,spec,mold_no,qty,unit,price,maker,note,created,created_by,updated,updated_by)
                        VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?)""",
                     ((b.get("code") or t["part_code"] or "").strip(), (b.get("name") or t["item"]).strip(), t["spec"] or "", mold or None,
                      t["unit"] or "EA", t["unit_price"], inv["supplier"], "거래명세서로 등록", now, user, now, user))
        pid = cur.lastrowid
    if not pid:
        raise ValueError("부품을 고르세요.")
    pid = int(pid)
    qty = _num(b.get("qty")) or t["qty"]
    r = P.move(pid, {"kind": "입고", "qty": qty, "date": inv["date"], "price": t["unit_price"], "supplier": inv["supplier"],
                     "invoice_id": inv["id"], "worker": user, "note": "거래명세서 입고 (%s %s)" % (inv["supplier"], inv["date"])}, user, ip)
    db.run("UPDATE invoice_items SET part_id=?, ref_id=?, match=?, qty=? WHERE id=?",
           (pid, r.get("tx_id"), "새 부품 입고" if act == "new" else "수동 입고", qty, item_id))
    _refresh_status(inv["id"])
    return {"ok": True, "qty": r["qty"]}


def parts_for(mold):
    """확인 필요 품목에서 고를 부품 목록 (같은 금형 계열 먼저)."""
    ms = _mold_candidates(mold or "") if mold else []
    rows = db.rows("SELECT id, code, name, spec, mold_no, qty FROM parts WHERE mold_no IN (%s) ORDER BY mold_no, code" % ",".join("?" * len(ms)), ms) if ms else []
    return {"molds": ms, "parts": rows}


def update_general(inv, b, user, ip):
    """일반 명세서: 업체 · 일자 · 메모 · 품목 정정."""
    i = db.one("SELECT * FROM invoices WHERE id=?", (inv,))
    if not i:
        raise ValueError("명세서를 찾을 수 없습니다.")
    sets = {k: (b[k] or "").strip() if isinstance(b[k], str) else b[k] for k in ("date", "supplier", "doc_no", "note") if k in b}
    if sets:
        db.run("UPDATE invoices SET %s WHERE id=?" % ",".join('"%s"=?' % k for k in sets), list(sets.values()) + [inv])
    for it in b.get("items") or []:
        if not it.get("id"):
            continue
        vals = {"item": it.get("item"), "spec": it.get("spec"), "qty": _num(it.get("qty")), "unit": it.get("unit"),
                "unit_price": _num(it.get("unit_price")), "amount": _num(it.get("amount")), "note": it.get("note")}
        db.run("UPDATE invoice_items SET %s WHERE id=? AND invoice_id=?" % ",".join('"%s"=?' % k for k in vals),
               list(vals.values()) + [it["id"], inv])
    tot = db.one("SELECT COALESCE(SUM(amount),0) s FROM invoice_items WHERE invoice_id=?", (inv,))["s"]
    db.run("UPDATE invoices SET supply=? WHERE id=?", (round(tot), inv))
    db.log(user, ip, "invoices", "update", inv, "거래명세서 정정 %s %s" % (sets.get("supplier") or i["supplier"], sets.get("date") or i["date"]))
    return {"ok": True}


def summary(d1, d2):
    """일반 명세서 정리: 업체별 · 월별 금액, 자주 사는 품목."""
    rows = db.rows("""SELECT i.date, i.supplier, i.total, i.supply, t.item, t.spec, t.qty, t.unit, t.unit_price, t.amount
                      FROM invoices i LEFT JOIN invoice_items t ON t.invoice_id=i.id
                      WHERE COALESCE(i.kind,'')<>'금형부품' AND i.date BETWEEN ? AND ?""", (d1, d2))
    by_sup, by_month, by_item, seen = {}, {}, {}, set()
    for r in rows:
        key = (r["date"], r["supplier"], r["total"])
        s = by_sup.setdefault(r["supplier"] or "(없음)", {"supplier": r["supplier"] or "(없음)", "n": 0, "amount": 0, "items": 0, "last": ""})
        if key not in seen:
            seen.add(key)
            s["n"] += 1
            s["amount"] += r["total"] or 0
            s["last"] = max(s["last"], r["date"] or "")
            ym = (r["date"] or "")[:7]
            by_month[ym] = by_month.get(ym, 0) + (r["total"] or 0)
        if r["item"]:
            s["items"] += 1
            k = re.sub(r"\s+", " ", "%s %s" % (r["item"], r["spec"] or "")).strip()
            x = by_item.setdefault(k, {"item": r["item"], "spec": r["spec"] or "", "n": 0, "qty": 0, "amount": 0, "suppliers": set(), "last_price": None, "last": ""})
            x["n"] += 1
            x["qty"] += r["qty"] or 0
            x["amount"] += r["amount"] or 0
            x["suppliers"].add(r["supplier"] or "")
            if (r["date"] or "") >= x["last"]:
                x["last"], x["last_price"] = r["date"] or "", r["unit_price"]
    items = sorted(({**v, "suppliers": ", ".join(sorted(v["suppliers"]))} for v in by_item.values()), key=lambda x: -x["amount"])
    return {"suppliers": sorted(by_sup.values(), key=lambda x: -x["amount"]),
            "months": [{"ym": k, "amount": v} for k, v in sorted(by_month.items())], "items": items[:200]}
