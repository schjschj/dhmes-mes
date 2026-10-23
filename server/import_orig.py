# -*- coding: utf-8 -*-
"""원본 MES(v1.x) 백업 DB(main_*.db) → 새 MES DB 로 전체 옮기기.

쓰는 법 (서버를 끄고):  python server/import_orig.py <원본 백업 .db 경로>
- 새 DB 는 먼저 data/backup/before_import_*.db 로 복사해 둔다.
- 원본에 있는 표는 새 DB 의 같은 표를 비우고 그대로(id 유지) 넣는다. 새 MES 에만 있는 표(품질 · 개선 기능)는 건드리지 않는다.
- 사용자 비밀번호는 원본 형식(pbkdf2$salt$hash) 그대로 옮기고, 처음 로그인할 때 새 형식으로 바뀐다 (db.check_password).
"""
import base64
import datetime
import json
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db  # noqa: E402

# 원본 표 → 새 표 (이름이 같으면 같은 열끼리 복사)
SAME = ["products", "molds", "equipment", "workers", "defect_codes", "repair_types", "production", "defects",
        "mold_maint", "mold_repair", "parts", "work_orders", "memos", "memo_comments", "change_log"]
GROUP_MAP = {"@mve5bmwfs6": "설정"}          # 원본의 무작위 이름 그룹 → 새 MES 의 '설정'


def _cols(c, t):
    return [r[1] for r in c.execute('PRAGMA table_info("%s")' % t)]


def _copy(src, dst, st, dt, rename=None, fixed=None):
    rename = rename or {}
    scols = _cols(src, st)
    dcols = set(_cols(dst, dt))
    pairs = [(s, rename.get(s, s)) for s in scols if rename.get(s, s) in dcols]
    extra = list((fixed or {}).items())
    dst.execute('DELETE FROM "%s"' % dt)
    sql = 'INSERT INTO "%s" (%s) VALUES (%s)' % (dt, ",".join('"%s"' % d for _, d in pairs + [(k, k) for k, _ in extra]),
                                                ",".join("?" * (len(pairs) + len(extra))))
    n = 0
    for r in src.execute('SELECT %s FROM "%s"' % (",".join('"%s"' % s for s, _ in pairs), st)):
        dst.execute(sql, list(r) + [v for _, v in extra])
        n += 1
    return n


def _setting(src, k):
    r = src.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    return r[0] if r else None


def _set(dst, k, v):
    dst.execute("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))


def _b64(v):
    try:
        return base64.b64decode(v).decode("utf-8") if v else ""
    except Exception:
        return v or ""


def menu_layout(orig):
    """원본 {groups:[key], names, custom, items:{id:{group,order}}} → 새 {groups:[{key,name,custom}], tree, labels}."""
    try:
        o = json.loads(orig or "")
    except ValueError:
        return None
    if not o or not o.get("groups"):
        return None
    names = o.get("names") or {}
    custom = set(o.get("custom") or [])
    groups, seen = [], set()
    for g in o["groups"]:
        k = GROUP_MAP.get(g, g)
        if k in seen:
            continue
        seen.add(k)
        groups.append({"key": k, "name": names.get(g, k) if k == g else k, "custom": g in custom and k == g})
    # 사용자 그룹(원본에만 있는 묶음)에 들어간 메뉴만 옮김 — 나머지는 새 MES 기본 자리
    tree = {}
    for iid, it in sorted((o.get("items") or {}).items(), key=lambda x: (x[1].get("order") or 0)):
        g = it.get("group")
        if g in custom and GROUP_MAP.get(g, g) == g:
            tree.setdefault(g, []).append(iid)
    return {"groups": groups, "tree": [{"group": g, "items": ids} for g, ids in tree.items()], "labels": o.get("labels") or {}}


def run(path):
    if not os.path.isfile(path):
        raise SystemExit("파일이 없습니다: " + path)
    db.init()
    bdir = os.path.join(db.DATA_DIR, "backup")
    os.makedirs(bdir, exist_ok=True)
    keep = os.path.join(bdir, "before_import_%s.db" % datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
    db.conn().execute("PRAGMA wal_checkpoint(FULL)")
    shutil.copyfile(db.DB_PATH, keep)
    print("새 DB 를 먼저 보관:", keep)

    src = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    dst = db.conn()
    rep = []
    try:
        dst.execute("BEGIN")
        for t in SAME:
            rep.append((t, _copy(src, dst, t, t)))
        rep.append(("parts_tx", _copy(src, dst, "part_tx", "parts_tx")))
        rep.append(("plan_uploads", _copy(src, dst, "plan_uploads", "plan_uploads",
                                          {"filename": "name", "items": "rows", "uploaded": "created", "uploaded_by": "created_by"})))
        rep.append(("plan_families", _copy(src, dst, "plan_families", "plan_families")))
        rep.append(("plan_overrides", _copy(src, dst, "plan_overrides", "plan_overrides")))
        rep.append(("plan_rules", _copy(src, dst, "plan_rules", "plan_rules")))
        rep.append(("plan_incoming", _copy(src, dst, "rm_incoming", "plan_incoming")))

        # 사용자 — 비밀번호는 원본 형식 그대로 (처음 로그인 때 새 형식으로)
        dst.execute("DELETE FROM sessions")
        mine = {r[0] for r in dst.execute("SELECT login FROM users")}
        n = 0
        for r in src.execute("SELECT login,name,pw,admin,perms,active,must_change,note,last_login,created,created_by FROM users"):
            login, name, pw, admin, perms, active, must, note, last, created, cby = r
            p = json.loads(perms or "{}")
            p = {GROUP_MAP.get(k, k): v for k, v in p.items()}
            vals = (name, pw, "", admin or 0, json.dumps(p, ensure_ascii=False), active if active is not None else 1, must or 0, note, last)
            if login in mine:
                dst.execute("UPDATE users SET name=?,pw_hash=?,pw_salt=?,admin=?,perms=?,active=?,must_change=?,note=?,last_login=? WHERE login=?", vals + (login,))
            else:
                dst.execute("""INSERT INTO users(name,pw_hash,pw_salt,admin,perms,active,must_change,note,last_login,login,created,created_by)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", vals + (login, created, cby))
            n += 1
        rep.append(("users", n))

        # 근태
        dst.execute("DELETE FROM att_emps")
        n = 0
        for r in src.execute("SELECT id,name,dept,rank,hire_date,quit_date,memo,foreign_,ord,updated,updated_by FROM att_emps"):
            dst.execute("INSERT INTO att_emps(id,name,dept,rank,hireDate,quitDate,memo,foreign_,ord,updated,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)", r)
            n += 1
        rep.append(("att_emps", n))
        months = {}
        for ym, roster in src.execute("SELECT ym, roster FROM att_month"):
            months[ym] = {"roster": json.loads(roster) if roster else None, "records": {}}
        n = 0
        for eid, date, code, early, memo, deduct, ml in src.execute("SELECT emp_id,date,code,early,memo,deduct,memo_left FROM att_rec"):
            ym, d = date[:7], str(int(date[8:10]))
            rec = {"code": code or ""}
            if early:
                rec["early"] = True
            if memo:
                rec["memo"] = memo
            if deduct not in (None, ""):
                rec["deduct"] = deduct
            if ml:
                rec["ml"] = True
            months.setdefault(ym, {"roster": None, "records": {}})["records"].setdefault(eid, {})[d] = rec
            n += 1
        dst.execute("DELETE FROM att_months")
        for ym, m in months.items():
            dst.execute("INSERT INTO att_months(ym,roster,records,updated) VALUES(?,?,?,?)",
                        (ym, json.dumps(m["roster"], ensure_ascii=False) if m["roster"] is not None else None,
                         json.dumps(m["records"], ensure_ascii=False), db.now()))
        rep.append(("att_rec → att_months", n))
        leave = {}
        for eid, y, g, adj, note in src.execute("SELECT emp_id,year,grant_,adjust,note FROM att_leave"):
            leave.setdefault(eid, {})[str(y)] = {"grant": g, "adjust": adj or 0, "note": note or ""}
        _set(dst, "att_leave", json.dumps(leave, ensure_ascii=False))
        for k, v in src.execute("SELECT k, v FROM att_kv"):
            if k == "config":
                _set(dst, "att_cfg", v)
            elif k == "rev":
                _set(dst, "att_rev", v)

        # 설정
        for k in ("mold_alarm1", "mold_alarm2", "prod_std", "ship_start", "company"):
            v = _setting(src, k)
            if v not in (None, ""):
                _set(dst, k, v)
        ml = menu_layout(_setting(src, "menu_layout"))
        if ml:
            _set(dst, "menu_layout", json.dumps(ml, ensure_ascii=False))
        if _setting(src, "rawmat_path"):
            _set(dst, "rm_cfg", json.dumps({"path": _setting(src, "rawmat_path"), "user": _setting(src, "rawmat_user") or "",
                                            "pw": _b64(_setting(src, "rawmat_pw")), "dbpw": _b64(_setting(src, "rawmat_dbpw"))}, ensure_ascii=False))

        # 원재료 (창고 자료 마지막 읽은 것) → rm_cache
        mats = {r[0]: (r[1], r[2]) for r in src.execute("SELECT part_no, material, spec FROM rm_parts")}
        hist = []
        for r in src.execute("SELECT seq,barcode,part_no,weight,lot,lctn,isd,mfd,rd,prd,state,thick,width,remark FROM rm_hist ORDER BY seq"):
            x = dict(zip(["seq", "barcode", "part_no", "weight", "lot", "lctn", "isd", "mfd", "rd", "prd", "state", "thick", "width", "remark"], r))
            try:
                x["weight"] = float(x["weight"]) if x["weight"] not in (None, "") else None
            except ValueError:
                x["weight"] = None
            m = mats.get(x["part_no"]) or ("", "")
            x["material"], x["spec"] = m[0] or "", m[1] or ("%s*%s" % (x["thick"], x["width"]) if x["thick"] else "")
            hist.append(x)
        last = {}
        for x in sorted(hist, key=lambda x: (x.get("rd") or "", x["seq"])):
            if x.get("barcode"):
                last[x["barcode"]] = x
        today = datetime.date.today()
        stock = []
        for x in last.values():
            if (x.get("state") or "").strip() not in ("보관", "입고", "재고"):
                continue
            y = dict(x)
            try:
                y["days"] = (today - datetime.date.fromisoformat(str(x.get("isd"))[:10])).days
            except (TypeError, ValueError):
                y["days"] = None
            stock.append(y)
        hist.reverse()
        meta = {}
        try:
            meta = json.loads(_setting(src, "rawmat_meta") or "{}")
        except ValueError:
            pass
        _set(dst, "rm_cache", json.dumps({"stock": stock, "hist": hist, "meta": {
            "read_at": meta.get("read_at") or db.now(), "read_by": "원본 MES 이전", "file_time": meta.get("file_time") or "",
            "table": "원본 rm_hist", "error": None}}, ensure_ascii=False))
        rep.append(("rm_hist → 원재료 (재고 롤 %d)" % len(stock), len(hist)))
        dst.execute("INSERT INTO change_log(ts,user,ip,tbl,action,row_id,summary) VALUES(?,?,?,?,?,?,?)",
                    (db.now(), "시스템", "", "import", "orig", "", "원본 MES 백업에서 전체 이전: " + os.path.basename(path)))
        dst.execute("COMMIT")
    except Exception:
        dst.execute("ROLLBACK")
        raise
    finally:
        src.close()
    for t, n in rep:
        print("%-28s %d" % (t, n))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    run(sys.argv[1])
