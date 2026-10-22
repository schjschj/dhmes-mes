# -*- coding: utf-8 -*-
"""[개선제안] 품질관리 · LOT 추적.

- 수입검사 · 성적서 (q_incoming): 원재료 코일 입고 시 두께·폭·외관·포장 → 합격이면 코일 LOT(rawmat_lots) 자동 등록
- 초중종물 검사 (q_inproc): 초품 합격 + 승인이 있어야 그 날 그 설비·제번 생산실적 입력 가능 (인터락, 설정에서 켬)
- 고객불만 · 8D (q_claims): D1~D8 진행, 월별 · 유형별 현황
- 계측기 교정 (q_gauges + q_gauge_hist): 정기 검교정 · 자체 점검 주기, 다음 예정일 · 지남 알림
- 품질문서 (q_docs): CP · FMEA · 도면 · 검사기준서 파일 등록, 개정 이력 (최신본 표시)
- LOT 추적: 코일 LOT ↔ 생산실적 LOT ↔ 공정불량 ↔ 고객불만 을 한 번에 찾음
"""
import calendar
import datetime
import os
import re

import db

DOC_DIR = os.path.join(db.DATA_DIR, "docs")

# 표마다 입력받는 열 (그 외 열은 무시)
FIELDS = {
    "q_incoming": ["date", "lot_no", "mat_code", "maker", "spec", "weight", "thick_std", "thick_meas", "width_std", "width_meas",
                   "appearance", "packing", "cert_no", "result", "inspector", "note"],
    "q_inproc": ["date", "equip_no", "code", "lot_no", "stage", "reason", "items", "result", "inspector", "note"],
    "q_claims": ["claim_no", "date", "customer", "code", "lot_no", "type", "qty", "cost", "content", "d1_team", "d2_problem",
                 "d3_contain", "d4_cause", "d5_action", "d6_verify", "d7_prevent", "d8_close", "status", "due", "closed", "owner", "note"],
    "q_gauges": ["gauge_no", "name", "spec", "maker", "serial", "location", "owner", "cal_cycle", "check_cycle", "last_cal",
                 "last_check", "status", "note"],
    "rawmat_lots": ["lot_no", "mat_code", "mat_desc", "maker", "spec", "thickness", "width", "in_date", "in_weight",
                    "remain_weight", "cert_no", "status", "note"],
}
NUMS = {"weight", "thick_std", "thick_meas", "width_std", "width_meas", "qty", "cost", "cal_cycle", "check_cycle",
        "thickness", "width", "in_weight", "remain_weight"}
REQ = {"q_incoming": ["date", "lot_no"], "q_inproc": ["date", "equip_no", "code", "stage"], "q_claims": ["date", "customer"],
       "q_gauges": ["gauge_no", "name"], "rawmat_lots": ["lot_no"]}
LABEL = {"q_incoming": "수입검사", "q_inproc": "초중종물 검사", "q_claims": "고객불만", "q_gauges": "계측기", "rawmat_lots": "코일 LOT"}


def _clean(tbl, b):
    out = {}
    for k in FIELDS[tbl]:
        if k not in b:
            continue
        v = b[k]
        if v in ("", None):
            out[k] = None
        elif k in NUMS:
            try:
                out[k] = float(str(v).replace(",", ""))
            except ValueError:
                raise ValueError("숫자를 확인하세요: %s" % k)
        else:
            out[k] = str(v).strip()
    return out


def list_rows(tbl, d1=None, d2=None):
    sql = 'SELECT * FROM "%s" WHERE 1=1' % tbl
    args = []
    dcol = {"q_incoming": "date", "q_inproc": "date", "q_claims": "date", "rawmat_lots": "in_date"}.get(tbl)
    if dcol and d1:
        sql += " AND %s >= ?" % dcol
        args.append(d1)
    if dcol and d2:
        sql += " AND %s <= ?" % dcol
        args.append(d2)
    sql += " ORDER BY id DESC"
    rows = db.rows(sql, args)
    if tbl == "q_gauges":
        for r in rows:
            _gauge_due(r)
    return rows


def save(tbl, rid, b, user, ip):
    data = _clean(tbl, b)
    merged = dict(db.one('SELECT * FROM "%s" WHERE id=?' % tbl, (rid,)) or {}) if rid else {}
    merged.update(data)
    for k in REQ[tbl]:
        if merged.get(k) in (None, ""):
            raise ValueError("필수 항목이 비었습니다: %s" % k)
    if tbl == "q_claims" and not merged.get("claim_no"):
        data["claim_no"] = _claim_no(merged.get("date"))
    if tbl == "q_inproc" and rid:
        # 결과를 바꾸면 승인은 다시 받아야 함
        old = db.one("SELECT result FROM q_inproc WHERE id=?", (rid,))
        if old and old["result"] != merged.get("result"):
            data["approved_by"] = None
            data["approved_at"] = None
    now = db.now()
    if rid:
        data.update({"updated": now, "updated_by": user})
        db.run('UPDATE "%s" SET %s WHERE id=?' % (tbl, ",".join('"%s"=?' % k for k in data)), list(data.values()) + [rid])
        action = "update"
    else:
        data.update({"created": now, "created_by": user, "updated": now, "updated_by": user})
        cur = db.run('INSERT INTO "%s" (%s) VALUES (%s)' % (tbl, ",".join('"%s"' % k for k in data), ",".join("?" * len(data))),
                     list(data.values()))
        rid = cur.lastrowid
        action = "create"
    if tbl == "q_incoming":
        _incoming_to_lot(rid, user)
    db.log(user, ip, tbl, action, rid, "%s %s" % (LABEL[tbl], "등록" if action == "create" else "수정"))
    return {"id": rid}


def delete(tbl, rid, user, ip):
    db.run('DELETE FROM "%s" WHERE id=?' % tbl, (rid,))
    db.log(user, ip, tbl, "delete", rid, "%s 삭제" % LABEL[tbl])


def _claim_no(date):
    ym = (date or db.now())[:7].replace("-", "")
    n = db.one("SELECT COUNT(*) n FROM q_claims WHERE claim_no LIKE ?", ("C%s-%%" % ym,))["n"] + 1
    return "C%s-%03d" % (ym, n)


# ── 수입검사 → 코일 LOT
def _incoming_to_lot(iid, user):
    x = db.one("SELECT * FROM q_incoming WHERE id=?", (iid,))
    if not x or not x["lot_no"]:
        return
    status = "입고" if x["result"] == "합격" else ("불합격" if x["result"] == "불합격" else "검사중")
    if db.one("SELECT id FROM rawmat_lots WHERE lot_no=?", (x["lot_no"],)):
        db.run("UPDATE rawmat_lots SET status=?, cert_no=COALESCE(?,cert_no), updated=?, updated_by=? WHERE lot_no=?",
               (status, x["cert_no"], db.now(), user, x["lot_no"]))
    else:
        now = db.now()
        db.run("""INSERT INTO rawmat_lots(lot_no,mat_code,maker,spec,thickness,width,in_date,in_weight,remain_weight,cert_no,status,
                  created,created_by,updated,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (x["lot_no"], x["mat_code"], x["maker"], x["spec"], x["thick_meas"] or x["thick_std"], x["width_meas"] or x["width_std"],
                x["date"], x["weight"], x["weight"], x["cert_no"], status, now, user, now, user))


# ── 초중종물 · 인터락
def approve_inproc(rid, user, ip):
    x = db.one("SELECT * FROM q_inproc WHERE id=?", (rid,))
    if not x:
        raise ValueError("검사 기록이 없습니다.")
    if x["result"] != "합격":
        raise ValueError("합격인 검사만 승인할 수 있습니다.")
    db.run("UPDATE q_inproc SET approved_by=?, approved_at=? WHERE id=?", (user, db.now(), rid))
    db.log(user, ip, "q_inproc", "approve", rid, "초품 승인 %s %s호기 %s" % (x["date"], x["equip_no"], x["code"]))


def interlock_on():
    return db.get_setting("interlock_first") == "1"


def check_interlock(row):
    """생산실적 저장 전: 인터락이 켜져 있으면 그날 그 설비·제번의 초품 승인이 있어야 함."""
    if not interlock_on():
        return
    ok = db.one("""SELECT id FROM q_inproc WHERE date=? AND equip_no=? AND UPPER(code)=UPPER(?) AND stage IN ('초품','금형수리 후')
                   AND result='합격' AND approved_by IS NOT NULL""", (row.get("date"), str(row.get("equip_no")), row.get("code") or ""))
    if not ok:
        raise ValueError("%s %s호기 %s 초품검사 합격·승인 기록이 없어서 생산실적을 넣을 수 없습니다 (품질관리 > 초중종물 검사)."
                         % (row.get("date"), row.get("equip_no"), row.get("code")))


# ── 계측기
def _add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _gauge_due(r):
    today = datetime.date.today()
    for kind, last, cyc in (("cal", "last_cal", "cal_cycle"), ("check", "last_check", "check_cycle")):
        nxt = None
        if r.get(last) and r.get(cyc):
            try:
                nxt = _add_months(datetime.date.fromisoformat(r[last]), int(r[cyc])).isoformat()
            except ValueError:
                nxt = None
        r["next_" + kind] = nxt
        r[kind + "_left"] = (datetime.date.fromisoformat(nxt) - today).days if nxt else None
    lefts = [x for x in (r["cal_left"], r["check_left"]) if x is not None]
    m = min(lefts) if lefts else None
    r["due_state"] = "" if m is None else "지남" if m < 0 else "임박" if m <= 30 else "정상"
    return r


def gauge_hist(gid):
    return db.rows("SELECT * FROM q_gauge_hist WHERE gauge_id=? ORDER BY date DESC, id DESC", (gid,))


def add_gauge_hist(gid, b, user, ip):
    g = db.one("SELECT * FROM q_gauges WHERE id=?", (gid,))
    if not g:
        raise ValueError("계측기를 찾을 수 없습니다.")
    kind = b.get("kind") or "검교정"
    date = b.get("date") or db.now()[:10]
    db.run("""INSERT INTO q_gauge_hist(gauge_id,date,kind,result,agency,cert_no,cost,worker,note,created,created_by)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
           (gid, date, kind, b.get("result") or "합격", b.get("agency") or "", b.get("cert_no") or "",
            int(float(b.get("cost") or 0)), b.get("worker") or user, b.get("note") or "", db.now(), user))
    col = "last_cal" if kind == "검교정" else "last_check"
    db.run('UPDATE q_gauges SET "%s"=?, status=?, updated=?, updated_by=? WHERE id=?' % col,
           (date, "사용" if (b.get("result") or "합격") == "합격" else "사용중지", db.now(), user, gid))
    db.log(user, ip, "q_gauges", kind, gid, "%s %s %s" % (g["gauge_no"], kind, b.get("result") or "합격"))


# ── 품질문서
def docs():
    return db.rows("SELECT * FROM q_docs ORDER BY kind, code, current DESC, id DESC")


def add_doc(meta, filename, buf, user, ip):
    if not meta.get("kind") or not (meta.get("title") or meta.get("code")):
        raise ValueError("문서 종류와 제목(또는 제번)을 넣으세요.")
    os.makedirs(DOC_DIR, exist_ok=True)
    safe = re.sub(r"[^\w.\-가-힣]", "_", filename or "file")
    path = os.path.join(DOC_DIR, "%s_%s" % (db.now().replace(":", "").replace(" ", "_").replace("-", ""), safe))
    with open(path, "wb") as f:
        f.write(buf)
    db.run("UPDATE q_docs SET current=0 WHERE kind=? AND COALESCE(code,'')=? AND COALESCE(title,'')=?",
           (meta["kind"], meta.get("code") or "", meta.get("title") or ""))
    cur = db.run("""INSERT INTO q_docs(kind,code,title,rev,rev_date,file_name,file_path,file_size,current,note,created,created_by)
                    VALUES(?,?,?,?,?,?,?,?,1,?,?,?)""",
                 (meta["kind"], meta.get("code") or "", meta.get("title") or "", meta.get("rev") or "",
                  meta.get("rev_date") or db.now()[:10], filename, path, len(buf), meta.get("note") or "", db.now(), user))
    db.log(user, ip, "q_docs", "upload", cur.lastrowid, "%s %s %s rev.%s 등록" % (meta["kind"], meta.get("code") or "", meta.get("title") or "", meta.get("rev") or ""))
    return {"id": cur.lastrowid}


def doc_file(did):
    d = db.one("SELECT * FROM q_docs WHERE id=?", (did,))
    if not d or not d["file_path"] or not os.path.isfile(d["file_path"]):
        return None, None
    return d["file_path"], d["file_name"]


def doc_check():
    """제품마다 CP · FMEA · 도면 · 검사기준서 최신본이 있는지 (정합성 확인)."""
    kinds = ["CP", "FMEA", "도면", "검사기준서"]
    have = {}
    for d in db.rows("SELECT kind, code, rev, rev_date FROM q_docs WHERE current=1 AND code<>''"):
        have.setdefault(d["code"].upper(), {})[d["kind"]] = d
    out = []
    for p in db.rows("SELECT code, name FROM products ORDER BY code"):
        h = have.get(p["code"].upper(), {})
        row = {"code": p["code"], "name": p["name"], "missing": [k for k in kinds if k not in h]}
        for k in kinds:
            row[k] = ("rev." + (h[k]["rev"] or "-") + " " + (h[k]["rev_date"] or "")) if k in h else ""
        out.append(row)
    return {"kinds": kinds, "rows": out}


# ── 현황 · 추적
def claim_stats(year):
    rows = db.rows("SELECT * FROM q_claims WHERE substr(date,1,4)=?", (str(year),))
    by_m = [0] * 12
    by_t, open_ = {}, []
    for r in rows:
        try:
            by_m[int(r["date"][5:7]) - 1] += 1
        except (TypeError, ValueError):
            pass
        by_t[r["type"] or "(미분류)"] = by_t.get(r["type"] or "(미분류)", 0) + 1
        if r["status"] != "완료":
            open_.append(r)
    steps = ["d1_team", "d2_problem", "d3_contain", "d4_cause", "d5_action", "d6_verify", "d7_prevent", "d8_close"]
    for r in open_:
        r["step"] = sum(1 for s in steps if r.get(s))
    return {"by_month": by_m, "by_type": sorted(by_t.items(), key=lambda x: -x[1]), "total": len(rows),
            "open": len(open_), "cost": sum(r["cost"] or 0 for r in rows), "open_rows": open_}


def trace(q):
    """LOT/바코드/제번 하나로 코일 → 생산 → 불량 → 고객불만 연결을 찾음."""
    q = (q or "").strip()
    if not q:
        return {}
    like = "%" + q + "%"
    lots = db.rows("SELECT * FROM rawmat_lots WHERE lot_no LIKE ? OR cert_no LIKE ?", (like, like))
    incs = db.rows("SELECT * FROM q_incoming WHERE lot_no LIKE ? OR cert_no LIKE ?", (like, like))
    coil_lots = {l["lot_no"] for l in lots} | {i["lot_no"] for i in incs}
    prods = db.rows("""SELECT p.*, pr.name FROM production p LEFT JOIN products pr ON pr.code=p.code
                       WHERE p.lot_no LIKE ? OR p.coil_lot LIKE ? %s ORDER BY p.date""" %
                    ("OR p.coil_lot IN (%s)" % ",".join("?" * len(coil_lots)) if coil_lots else ""),
                    [like, like] + list(coil_lots))
    prod_lots = {p["lot_no"] for p in prods if p["lot_no"]}
    keys = [like] + list(prod_lots)
    cond = " OR ".join(["lot_no LIKE ?"] + ["lot_no=?"] * len(prod_lots))
    defects = db.rows("SELECT * FROM defects WHERE %s ORDER BY date" % cond, keys)
    claims = db.rows("SELECT * FROM q_claims WHERE %s ORDER BY date" % cond, keys)
    inproc = db.rows("SELECT * FROM q_inproc WHERE %s ORDER BY date" % cond, keys)
    workers = sorted({w for p in prods for w in (p.get("day_worker"), p.get("night_worker")) if w})
    return {"q": q, "lots": lots, "incoming": incs, "production": prods, "defects": defects, "claims": claims,
            "inproc": inproc, "workers": workers, "equips": sorted({str(p["equip_no"]) for p in prods})}


def dashboard_extra():
    """[개선] 대시보드 추가 항목: 계측기 교정 지남·임박, 미결 고객불만, 초품 미승인."""
    g = [_gauge_due(r) for r in db.rows("SELECT * FROM q_gauges WHERE COALESCE(status,'')<>'폐기'")]
    return {"gauge_over": sum(1 for r in g if r["due_state"] == "지남"),
            "gauge_soon": sum(1 for r in g if r["due_state"] == "임박"),
            "claims_open": db.one("SELECT COUNT(*) n FROM q_claims WHERE COALESCE(status,'')<>'완료'")["n"],
            "inproc_wait": db.one("SELECT COUNT(*) n FROM q_inproc WHERE result='합격' AND approved_by IS NULL")["n"]}
