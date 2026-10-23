# -*- coding: utf-8 -*-
"""[개선제안] 거래명세서 자동 입력.

거래명세서 파일(엑셀 xlsx · CSV · 스캔 그림)을 올리면 공급자 · 일자 · 품목(품명 · 규격 · 수량 · 단가 · 금액)을 읽고,
품목마다 어디로 넣을지 정한다 (사람이 확인 · 고친 뒤 [입력]):
  - 금형부품 → 부품 입고 (재고 + 단가 · 구입처 기록 → 부품 구매단가 분석)
  - 원재료   → 코일 LOT 등록 (상태 '검사중' → 수입검사에서 판정)
  - 기타     → 명세서 기록만 (구매단가 분석에는 포함)
"""
import csv
import io
import json
import os
import re

import db
import ocr

INV_DIR = os.path.join(db.DATA_DIR, "invoices")

COLS = [
    ("item", ["품명", "품목", "품목명", "품명및규격", "내역", "적요"]),
    ("spec", ["규격", "사양", "SIZE", "치수"]),
    ("material", ["재질", "MATERIAL"]),
    ("qty", ["수량", "QTY"]),
    ("unit", ["단위"]),
    ("unit_price", ["단가"]),
    ("amount", ["금액", "공급가액", "공급가"]),
    ("tax", ["세액", "부가세"]),
    ("note", ["비고"]),
]
NUMS = {"qty", "unit_price", "amount", "tax"}
RM_WORDS = ["코일", "COIL", "SPCC", "SPHC", "SECC", "SUS", "C5191", "C5210", "C2680", "C1100", "C7025", "인청동", "황동", "동판",
            "스트립", "STRIP", "원자재", "원재료", "강판"]


def _n(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).replace(",", "").replace("₩", "").replace("원", "").strip()
    try:
        return float(t)
    except ValueError:
        return ocr.num(t)


def _date_of(text):
    m = re.search(r"(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})", text or "")
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    return None


def _company():
    return (db.get_setting("company") or "대흥공업").replace(" ", "")


def _supplier_from(cells_by_row):
    """'상호' · '공급자' 옆 칸 — 우리 회사 이름이 아닌 첫 번째."""
    me = _company()
    for row in cells_by_row:
        for i, c in enumerate(row):
            t = re.sub(r"\s", "", str(c or ""))
            if not t:
                continue
            m = re.match(r"^(상호|상호명|업체명|공급자|공급처)[:(（)]*(.*)$", t)
            if not m:
                continue
            cands = [m.group(2)] + [str(x or "") for x in row[i + 1:i + 4]]
            for v in cands:
                v = re.sub(r"\(.*?\)|^\W+|\W+$", "", v.strip())
                v2 = v.replace(" ", "")
                if v2 and v2 not in ("상호", "법인명", "성명", "대표자") and me not in v2 and not re.fullmatch(r"[\d\-]+", v2):
                    return v.strip()
    return ""


def _from_table(grid):
    """2차원 표 → (머리글 행 번호, 열 위치, 품목들)."""
    hdr_i, colmap = None, {}
    for i, row in enumerate(grid[:60]):
        m = {}
        for j, c in enumerate(row):
            t = re.sub(r"\s", "", str(c or "")).upper()
            if not t:
                continue
            for key, kws in COLS:
                if key not in m and any(t == k.upper() or (len(k) >= 2 and t.startswith(k.upper()) and len(t) <= len(k) + 4) for k in kws):
                    m[key] = j
                    break
        if "item" in m and ("qty" in m or "amount" in m) and len(m) >= 3:
            hdr_i, colmap = i, m
            break
    if hdr_i is None:
        return None, {}, []
    items = []
    blank = 0
    for row in grid[hdr_i + 1:]:
        get = lambda k: row[colmap[k]] if k in colmap and colmap[k] < len(row) else None
        name = str(get("item") or "").strip()
        if re.sub(r"\s", "", name) in ("합계", "계", "총계", "소계", "합계금액") or (not name and _n(get("amount")) and not _n(get("qty"))):
            break
        if not name:
            blank += 1
            if blank >= 3:
                break
            continue
        blank = 0
        x = {"item": name}
        for k in ("spec", "material", "unit", "note"):
            if get(k) not in (None, ""):
                x[k] = str(get(k)).strip()
        for k in NUMS:
            v = _n(get(k))
            if v is not None:
                x[k] = v
        if not (x.get("qty") or x.get("amount") or x.get("unit_price")):
            continue
        items.append(x)
    return hdr_i, colmap, items


def _grid_xlsx(buf):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(buf), data_only=True, read_only=True)
    ws = wb.worksheets[0]
    grid = []
    for row in ws.iter_rows(values_only=True):
        grid.append([("%s" % v.date().isoformat() if hasattr(v, "date") and callable(v.date) else v) for v in row])
        if len(grid) > 400:
            break
    wb.close()
    return grid


def _grid_csv(buf):
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = buf.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("CSV 글자 인코딩을 알 수 없습니다.")
    return [r for r in csv.reader(io.StringIO(text))]


def _from_image(buf):
    res = ocr.read(buf, 2.0)
    rows = ocr.rows(res)
    # 머리글 줄 찾기 → 칸 가로 위치
    hdr, cols = None, []
    for r in rows:
        found = []
        for t, x, w in zip(r["cells"], r["xs"], r["ws"]):
            tt = re.sub(r"\s", "", t).upper()
            for key, kws in COLS:
                if any(tt.startswith(k.upper()) for k in kws):
                    found.append((key, x + w / 2.0))
                    break
        keys = {k for k, _ in found}
        if "item" in keys and ({"qty", "amount", "unit_price"} & keys):
            hdr, cols = r, found
            break
    items = []
    if hdr:
        for r in rows:
            if r["y"] <= hdr["y"]:
                continue
            x = {}
            for t, cx, cw in zip(r["cells"], r["xs"], r["ws"]):
                key = min(cols, key=lambda k: abs(k[1] - (cx + cw / 2.0)))[0]
                x[key] = (x[key] + " " + t) if x.get(key) else t
            name = (x.get("item") or "").strip()
            if re.sub(r"\s", "", name) in ("합계", "계", "총계", "소계"):
                break
            if not name:
                continue
            y = {"item": name}
            for k in ("spec", "material", "unit", "note"):
                if x.get(k):
                    y[k] = x[k].strip()
            for k in NUMS:
                if x.get(k):
                    v = _n(x[k].split()[-1])
                    if v is not None:
                        y[k] = v
            if y.get("qty") or y.get("amount"):
                items.append(y)
    else:
        # 머리글을 못 찾음: 숫자가 셋 이상 있는 줄에서 수량 × 단가 ≈ 금액 인 묶음을 찾음
        for r in rows:
            nums = [(i, _n(c)) for i, c in enumerate(r["cells"]) if _n(c) is not None]
            for a in range(len(nums) - 2):
                (i1, q), (_, p), (_, amt) = nums[a], nums[a + 1], nums[a + 2]
                if q and p and amt and abs(q * p - amt) <= max(1, amt * 0.01):
                    name = " ".join(c for c in r["cells"][:i1] if _n(c) is None).strip()
                    if name:
                        items.append({"item": name, "qty": q, "unit_price": p, "amount": amt})
                    break
    cells_by_row = [r["cells"] for r in rows]
    return res["text"], cells_by_row, items


def _match(items):
    parts = db.rows("SELECT id, code, name, spec, material, price, maker FROM parts")
    mats = {p["mat_code"] for p in db.rows("SELECT DISTINCT mat_code FROM products WHERE mat_code<>''")}
    norm = lambda s: re.sub(r"[\s\-_()]", "", (s or "").upper())
    for x in items:
        nm, sp = norm(x.get("item")), norm(x.get("spec"))
        hit = None
        for p in parts:
            if p["code"] and norm(p["code"]) and norm(p["code"]) in (nm + sp):
                hit = p
                break
        if not hit:
            same = [p for p in parts if norm(p["name"]) == nm and (not sp or not p["spec"] or norm(p["spec"]) == sp)]
            if len(same) >= 1:
                hit = same[0]
        if hit:
            x.update({"target": "금형부품", "part_id": hit["id"], "part_label": "%s %s" % (hit["name"], hit["spec"] or ""),
                      "last_price": hit["price"]})
        elif any(w in (x.get("item", "") + " " + x.get("spec", "") + " " + x.get("material", "")).upper() for w in RM_WORDS) or \
                any(m and norm(m) in nm + sp for m in mats):
            x["target"] = "원재료"
            mc = next((m for m in mats if m and norm(m) in nm + sp), None)
            if mc:
                x["mat_code"] = mc
            if (x.get("unit") or "").upper() in ("KG", "㎏") and x.get("qty"):
                x["weight"] = x["qty"]
        else:
            x["target"] = "기타"
        if x.get("amount") is None and x.get("qty") and x.get("unit_price"):
            x["amount"] = round(x["qty"] * x["unit_price"])
        if x.get("unit_price") is None and x.get("qty") and x.get("amount"):
            x["unit_price"] = round(x["amount"] / x["qty"], 2)
    return items


def read(name, buf, user):
    if not buf:
        raise ValueError("파일이 비었습니다.")
    low = (name or "").lower()
    text = ""
    if low.endswith((".xlsx", ".xlsm")) or buf[:2] == b"PK":
        grid = _grid_xlsx(buf)
        src = "엑셀"
    elif low.endswith((".csv", ".txt")):
        grid = _grid_csv(buf)
        src = "CSV"
    elif ocr.image_ext(buf):
        grid = None
        src = "스캔(OCR)"
    elif low.endswith(".xls"):
        raise ValueError("옛 엑셀(.xls)은 엑셀에서 '다른 이름으로 저장 → .xlsx' 로 바꿔서 올려 주세요.")
    else:
        raise ValueError("엑셀(xlsx) · CSV · 그림(JPG · PNG) 파일만 읽을 수 있습니다.")
    if grid is not None:
        _, _, items = _from_table(grid)
        cells_by_row = [[("" if c is None else str(c)) for c in r] for r in grid]
        text = "\n".join(" ".join(c for c in r if c) for r in cells_by_row)
    else:
        text, cells_by_row, items = _from_image(buf)
    os.makedirs(INV_DIR, exist_ok=True)
    safe = re.sub(r"[^\w.\-가-힣]", "_", name or "invoice")[-80:]
    token = "%s_%s" % (db.now().replace(":", "").replace(" ", "_").replace("-", ""), safe)
    with open(os.path.join(INV_DIR, token), "wb") as f:
        f.write(buf)
    supplier = _supplier_from(cells_by_row)
    m = re.search(r"(?:NO|No|번호)\s*[.:]?\s*([A-Z0-9\-]{3,})", text)
    return {"token": token, "file_name": name, "src": src, "date": _date_of(text), "supplier": supplier,
            "doc_no": m.group(1) if m else "", "items": _match(items), "text": text[:4000]}


def _auto_lot(supplier, date, seq):
    base = "R%s-%s" % ((date or db.now()[:10]).replace("-", "")[2:], re.sub(r"\W", "", supplier or "X")[:4] or "X")
    n = db.one("SELECT COUNT(*) n FROM rawmat_lots WHERE lot_no LIKE ?", (base + "-%",))["n"]
    return "%s-%02d" % (base, n + seq)


def commit(b, user, ip, can_parts):
    import parts as P
    items = [x for x in (b.get("items") or []) if (x.get("item") or "").strip() and x.get("target") != "제외"]
    if not items:
        raise ValueError("넣을 품목이 없습니다.")
    date = b.get("date") or db.now()[:10]
    supplier = (b.get("supplier") or "").strip()
    if any(x.get("target") == "금형부품" for x in items) and not can_parts:
        raise ValueError("금형부품 입고 권한(금형관리 입력)이 없습니다.")
    token = os.path.basename(b.get("token") or "")
    path = os.path.join(INV_DIR, token) if token and os.path.isfile(os.path.join(INV_DIR, token)) else None
    total = sum(_n(x.get("amount")) or 0 for x in items)
    kind = "금형부품" if any(x.get("target") == "금형부품" for x in items) else "일반"
    cur = db.run("""INSERT INTO invoices(date,supplier,doc_no,total,file_name,file_path,src,note,created,created_by,kind,status,supply)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (date, supplier, b.get("doc_no") or "", round(total), b.get("file_name") or "", path, b.get("src") or "직접 입력",
                  b.get("note") or "", db.now(), user, kind, "입고 완료" if kind == "금형부품" else "등록", round(total)))
    inv = cur.lastrowid
    done = {"금형부품": 0, "새 부품": 0, "원재료": 0, "기타": 0}
    for i, x in enumerate(items):
        tgt = x.get("target") or "기타"
        qty, up, amt = _n(x.get("qty")), _n(x.get("unit_price")), _n(x.get("amount"))
        if up is None and qty and amt:
            up = amt / qty
        if amt is None and qty and up is not None:
            amt = qty * up
        part_id, lot, ref = x.get("part_id") or None, None, None
        if tgt == "금형부품":
            if not part_id:        # 없는 부품이면 새로 만듦
                now = db.now()
                c2 = db.run("""INSERT INTO parts(code,name,spec,material,qty,unit,price,maker,note,created,created_by,updated,updated_by)
                               VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?)""",
                            (x.get("code") or "", x["item"].strip(), x.get("spec") or "", x.get("material") or "", x.get("unit") or "EA",
                             up, supplier, "거래명세서로 등록", now, user, now, user))
                part_id = c2.lastrowid
                done["새 부품"] += 1
            r = P.move(int(part_id), {"kind": "입고", "qty": qty or 0, "date": date, "price": up, "supplier": supplier,
                                      "invoice_id": inv, "note": "거래명세서 %s" % (b.get("doc_no") or inv), "worker": user}, user, ip)
            ref = r.get("tx_id")
            done["금형부품"] += 1
        elif tgt == "원재료":
            lot = (x.get("lot_no") or "").strip() or _auto_lot(supplier, date, i + 1)
            w = _n(x.get("weight")) or (qty if (x.get("unit") or "").upper() in ("KG", "㎏") else None)
            if db.one("SELECT id FROM rawmat_lots WHERE lot_no=?", (lot,)):
                raise ValueError("이미 있는 코일 LOT 입니다: %s" % lot)
            now = db.now()
            c3 = db.run("""INSERT INTO rawmat_lots(lot_no,mat_code,mat_desc,maker,spec,in_date,in_weight,remain_weight,cert_no,status,note,
                           created,created_by,updated,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (lot, x.get("mat_code") or "", x["item"].strip(), supplier, x.get("spec") or "", date, w, w,
                         b.get("doc_no") or "", "검사중", "거래명세서 입력 → 수입검사 필요", now, user, now, user))
            ref = c3.lastrowid
            done["원재료"] += 1
        else:
            done["기타"] += 1
        db.run("""INSERT INTO invoice_items(invoice_id,seq,target,item,spec,material,qty,unit,unit_price,amount,part_id,lot_no,mat_code,weight,ref_id,note,match)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (inv, i + 1, tgt, x["item"].strip(), x.get("spec") or "", x.get("material") or "", qty, x.get("unit") or "", up, amt,
                part_id, lot, x.get("mat_code") or "", _n(x.get("weight")), ref, x.get("note") or "",
                "수동 입고" if tgt == "금형부품" else ""))
    db.log(user, ip, "invoices", "create", inv, "거래명세서 %s %s 품목 %d" % (supplier, date, len(items)))
    return {"id": inv, "done": done}


def list_inv(d1=None, d2=None):
    sql, args = """SELECT i.*, (SELECT COUNT(*) FROM invoice_items t WHERE t.invoice_id=i.id) n FROM invoices i WHERE 1=1""", []
    if d1:
        sql += " AND i.date>=?"
        args.append(d1)
    if d2:
        sql += " AND i.date<=?"
        args.append(d2)
    out = db.rows(sql + " ORDER BY i.date DESC, i.id DESC", args)
    for r in out:
        r["has_file"] = bool(r.get("file_path") and os.path.isfile(r["file_path"]))
        r.pop("file_path", None)
    return out


def items_of(inv):
    return db.rows("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY seq", (inv,))


def file_of(inv):
    r = db.one("SELECT file_path, file_name FROM invoices WHERE id=?", (inv,))
    if r and r["file_path"] and os.path.isfile(r["file_path"]):
        return r["file_path"], r["file_name"] or os.path.basename(r["file_path"])
    return None, None


def delete(inv, user, ip):
    """명세서 기록 삭제 — 부품 입고는 되돌리고, 원재료 LOT 은 아직 '검사중'이면 지움."""
    import parts as P
    for it in items_of(inv):
        if it["target"] == "금형부품" and it["ref_id"]:
            P.tx_delete(it["ref_id"], user, ip)
        elif it["target"] == "원재료" and it["lot_no"]:
            db.run("DELETE FROM rawmat_lots WHERE lot_no=? AND status='검사중'", (it["lot_no"],))
    db.run("DELETE FROM invoice_items WHERE invoice_id=?", (inv,))
    p, _ = file_of(inv)
    db.run("DELETE FROM invoices WHERE id=?", (inv,))
    if p:
        try:
            os.remove(p)
        except OSError:
            pass
    db.log(user, ip, "invoices", "delete", inv, "거래명세서 삭제 (입고 되돌림)")
