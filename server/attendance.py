# -*- coding: utf-8 -*-
"""근태관리 — 기존 '대흥공업 근태관리' 프로그램 자료 구조 그대로.
설정(cfg) · 연차(leave) · 변경번호(rev) 는 settings JSON, 직원은 att_emps, 달별 근태는 att_months.
계산(근무일수·연차)은 화면(att.js)이 하고 서버는 저장만 한다.
"""
import datetime
import io
import json
import re
import secrets
import urllib.parse
import urllib.request
import zipfile

import db
from common import get_json, set_json

DEFAULT_CFG = {
    "companyName": "대흥공업",
    "overtimeBase": 0,
    "leaveMax": 25,
    "leaveStartYear": 2015,
    "holidayApiKey": "",
    "holidaySync": {},
    "codes": [
        {"name": "특근", "key": "1", "bg": "#FFC000", "fg": "#000000", "day": 1, "holiday": True, "leave": 0},
        {"name": "야특", "key": "2", "bg": "#7030A0", "fg": "#FFFFFF", "day": 1, "holiday": True, "leave": 0},
        {"name": "잔업無", "key": "3", "bg": "#BDD7EE", "fg": "#000000", "day": 1, "holiday": False, "leave": 0},
        {"name": "결근", "key": "4", "bg": "#FF0000", "fg": "#FFFFFF", "day": 0, "holiday": False, "leave": 0},
        {"name": "외출", "key": "5", "bg": "#C6E0B4", "fg": "#000000", "day": 1, "holiday": False, "leave": 0},
        {"name": "경휴", "key": "6", "bg": "#D9D9D9", "fg": "#000000", "day": 1, "holiday": False, "leave": 0},
        {"name": "병결", "key": "7", "bg": "#F8CBAD", "fg": "#000000", "day": 0, "holiday": False, "leave": 0},
        {"name": "월차", "key": "8", "bg": "#00B0F0", "fg": "#FFFFFF", "day": 0, "holiday": False, "leave": 1},
        {"name": "반차", "key": "9", "bg": "#9BC2E6", "fg": "#000000", "day": 0.5, "holiday": False, "leave": 0.5},
        {"name": "지각", "key": "0", "bg": "#FFE699", "fg": "#000000", "day": 1, "holiday": False, "leave": 0},
        {"name": "병가", "key": "q", "bg": "#F4B084", "fg": "#000000", "day": 0, "holiday": False, "leave": 0},
        {"name": "무급", "key": "w", "bg": "#A6A6A6", "fg": "#000000", "day": 0, "holiday": False, "leave": 0},
    ],
    # 2026년 공휴일 (설정 화면의 [공휴일 받아오기]로 다시 확인 가능)
    "holidays": {"2026": [
        ["01-01", "신정"], ["02-16", "설날 연휴"], ["02-17", "설날"], ["02-18", "설날 연휴"],
        ["03-02", "삼일절 대체공휴일"], ["05-05", "어린이날"], ["05-25", "부처님오신날 대체공휴일"],
        ["06-03", "전국동시지방선거"], ["08-17", "광복절 대체공휴일"], ["09-24", "추석 연휴"],
        ["09-25", "추석"], ["09-26", "추석 연휴"], ["10-05", "개천절 대체공휴일"], ["10-09", "한글날"],
        ["12-25", "성탄절"]]},
}


def cfg():
    c = get_json("att_cfg", None)
    if c is None:
        c = json.loads(json.dumps(DEFAULT_CFG))
        set_json("att_cfg", c)
    return c


def rev():
    return int(db.get_setting("att_rev") or 0)


def bump():
    r = rev() + 1
    db.set_setting("att_rev", r)
    return r


def _emp(r):
    return {"id": r["id"], "name": r["name"], "dept": r["dept"] or "", "rank": r["rank"] or "",
            "hireDate": r["hireDate"], "quitDate": r["quitDate"], "memo": r["memo"] or "",
            "foreign": bool(r["foreign_"]), "order": r["ord"] or 0, "updated": r["updated"], "updated_by": r["updated_by"]}


def emps():
    return [_emp(r) for r in db.rows("SELECT * FROM att_emps ORDER BY ord, name")]


def data(year):
    months = {}
    for r in db.rows("SELECT * FROM att_months WHERE ym LIKE ?", ("%s-%%" % year,)):
        months[r["ym"]] = {"roster": json.loads(r["roster"]) if r["roster"] else None,
                           "records": json.loads(r["records"] or "{}")}
    return {"cfg": cfg(), "emps": emps(), "leave": get_json("att_leave", {}), "months": months, "rev": rev()}


def _month(ym):
    r = db.one("SELECT * FROM att_months WHERE ym=?", (ym,))
    if not r:
        return None, {}
    return (json.loads(r["roster"]) if r["roster"] else None), json.loads(r["records"] or "{}")


def _save_month(ym, roster, records):
    db.run("""INSERT INTO att_months(ym,roster,records,updated) VALUES(?,?,?,?)
              ON CONFLICT(ym) DO UPDATE SET roster=excluded.roster, records=excluded.records, updated=excluded.updated""",
           (ym, json.dumps(roster, ensure_ascii=False) if roster is not None else None,
            json.dumps(records, ensure_ascii=False), db.now()))


def cells(b):
    ym = b.get("ym")
    roster, records = _month(ym)
    if b.get("roster") and not roster:
        roster = b["roster"]
    for it in b.get("items") or []:
        eid, d, rec = it.get("id"), str(it.get("d")), it.get("rec") or {}
        clean = {k: v for k, v in rec.items() if v not in (None, "", False)}
        if clean:
            records.setdefault(eid, {})[d] = rec
        else:
            records.get(eid, {}).pop(d, None)
            if eid in records and not records[eid]:
                records.pop(eid)
    _save_month(ym, roster, records)
    return bump()


def set_roster(ym, ids):
    _, records = _month(ym)
    _save_month(ym, ids, records)
    return bump()


def set_leave(b):
    lv = get_json("att_leave", {})
    e = lv.setdefault(b["id"], {})
    y = str(b.get("year"))
    g = b.get("grant")
    e[y] = {"grant": None if g in (None, "") else float(g), "adjust": float(b.get("adjust") or 0), "note": b.get("note") or ""}
    set_json("att_leave", lv)
    return bump()


def save_emp(b, user):
    now = db.now()
    if not (b.get("name") or "").strip():
        raise ValueError("성명을 입력하세요.")
    vals = (b["name"].strip(), b.get("dept") or "", b.get("rank") or "", b.get("hireDate") or None,
            b.get("quitDate") or None, b.get("memo") or "", 1 if b.get("foreign") else 0, now, user)
    if b.get("id") and db.one("SELECT id FROM att_emps WHERE id=?", (b["id"],)):
        db.run("UPDATE att_emps SET name=?,dept=?,rank=?,hireDate=?,quitDate=?,memo=?,foreign_=?,updated=?,updated_by=? WHERE id=?",
               vals + (b["id"],))
        eid = b["id"]
    else:
        eid = b.get("id") or ("e" + secrets.token_hex(5))
        n = (db.one("SELECT MAX(ord) m FROM att_emps")["m"] or 0) + 1
        db.run("INSERT INTO att_emps(name,dept,rank,hireDate,quitDate,memo,foreign_,updated,updated_by,id,ord) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
               vals + (eid, n))
    return {"rev": bump(), "id": eid}


def delete_emp(eid):
    for r in db.rows("SELECT ym, records FROM att_months"):
        if json.loads(r["records"] or "{}").get(eid):
            raise ValueError("근태 기록이 있어서 삭제할 수 없습니다. 퇴사일을 넣어 주세요. (%s)" % r["ym"])
    db.run("DELETE FROM att_emps WHERE id=?", (eid,))
    return bump()


def emp_order(ids):
    for i, eid in enumerate(ids, 1):
        db.run("UPDATE att_emps SET ord=? WHERE id=?", (i, eid))
    return bump()


def save_cfg(c):
    for x in c.get("codes", []):
        x.pop("_new", None)
    set_json("att_cfg", c)
    return bump()


def fetch_holidays(key, year):
    """공공데이터포털 한국천문연구원 특일 정보 (getRestDeInfo)."""
    out = []
    for month in range(1, 13):
        q = "serviceKey=%s&solYear=%s&solMonth=%02d&numOfRows=50&_type=json" % (
            key if "%" in key else urllib.parse.quote(key, safe=""), year, month)
        url = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?" + q
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                raw = r.read().decode("utf-8", "replace")
        except Exception as e:
            raise ValueError("공휴일 서버에 연결하지 못했습니다: %s" % e)
        try:
            j = json.loads(raw)
        except ValueError:
            m = re.search(r"<returnAuthMsg>([^<]+)", raw) or re.search(r"<resultMsg>([^<]+)", raw)
            raise ValueError("인증키를 확인하세요: " + (m.group(1) if m else raw[:120]))
        body = (j.get("response") or {}).get("body") or {}
        items = (body.get("items") or {})
        items = items.get("item", []) if isinstance(items, dict) else []
        if isinstance(items, dict):
            items = [items]
        for it in items:
            if it.get("isHoliday", "Y") != "Y":
                continue
            ld = str(it.get("locdate"))
            out.append([ld[4:6] + "-" + ld[6:8], it.get("dateName", "공휴일")])
    return sorted({x[0]: x for x in out}.values())


def import_file(name, buf):
    """기존 근태관리 프로그램의 employees.json · config.json · leave.json · months/YYYY-MM.json (또는 .zip)."""
    files = []
    if name.lower().endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(buf)) as z:
            for n in z.namelist():
                if n.lower().endswith(".json"):
                    files.append((n.split("/")[-1], z.read(n)))
        rank = lambda n: 0 if "employees" in n else 1 if "config" in n else 2 if "leave" in n else 3
        files.sort(key=lambda x: (rank(x[0]), x[0]))
    else:
        files = [(name, buf)]
    report = []
    for n, raw in files:
        try:
            j = json.loads(raw.decode("utf-8-sig"))
        except Exception:
            report.append("%s: 읽을 수 없는 파일" % n)
            continue
        if "employees" in n:
            lst = j if isinstance(j, list) else j.get("employees", [])
            for i, e in enumerate(lst, 1):
                eid = str(e.get("id") or ("e" + secrets.token_hex(5)))
                db.run("""INSERT INTO att_emps(id,name,dept,rank,hireDate,quitDate,memo,foreign_,ord,updated,updated_by)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, dept=excluded.dept,
                          rank=excluded.rank, hireDate=excluded.hireDate, quitDate=excluded.quitDate, memo=excluded.memo,
                          foreign_=excluded.foreign_, ord=excluded.ord""",
                       (eid, e.get("name"), e.get("dept"), e.get("rank"), e.get("hireDate"), e.get("quitDate"),
                        e.get("memo"), 1 if e.get("foreign") else 0, e.get("order") or i, db.now(), "가져오기"))
            report.append("%s: 직원 %d명" % (n, len(lst)))
        elif "config" in n:
            c = cfg()
            c.update({k: v for k, v in j.items() if k in DEFAULT_CFG or k in ("holidays", "codes")})
            set_json("att_cfg", c)
            report.append("%s: 설정" % n)
        elif "leave" in n:
            lv = get_json("att_leave", {})
            lv.update(j)
            set_json("att_leave", lv)
            report.append("%s: 연차 %d명" % (n, len(j)))
        else:
            m = re.search(r"(\d{4})-(\d{2})", n)
            if not m:
                report.append("%s: 어떤 자료인지 모름 (건너뜀)" % n)
                continue
            ym = m.group(0)
            _save_month(ym, j.get("roster"), j.get("records") or {})
            report.append("%s: %s 근태 %d명" % (n, ym, len(j.get("records") or {})))
    return report, bump()


def today_summary(today):
    c = cfg()
    cmap = {x["name"]: x for x in c["codes"]}
    y, m, d = today.year, today.month, today.day
    hol = next((h[1] for h in c.get("holidays", {}).get(str(y), []) if h[0] == "%02d-%02d" % (m, d)), None)
    off = today.weekday() >= 5 or bool(hol)
    _, records = _month("%04d-%02d" % (y, m))
    es = [e for e in emps() if not e["quitDate"] or e["quitDate"] >= today.isoformat()]
    es = [e for e in es if not e["hireDate"] or e["hireDate"] <= today.isoformat()]
    names = {e["id"]: e["name"] for e in es}
    by = {}
    for eid, recs in records.items():
        rec = recs.get(str(d)) or {}
        if rec.get("code") and eid in names:
            by.setdefault(rec["code"], []).append(names[eid])
    codes = [{"code": k, "bg": (cmap.get(k) or {}).get("bg"), "fg": (cmap.get(k) or {}).get("fg"), "names": v} for k, v in by.items()]
    if off:
        present = sum(len(v) for k, v in by.items() if (cmap.get(k) or {}).get("holiday"))
    else:
        absent = sum(len(v) for k, v in by.items() if float((cmap.get(k) or {}).get("day", 1)) == 0)
        present = len(es) - absent
    return {"present": present, "total": len(es), "off": off, "holiday": hol, "codes": codes}


def holidays_map():
    """출하 화면 등에서 쓰는 {YYYY-MM-DD: 이름}."""
    out = {}
    for y, lst in cfg().get("holidays", {}).items():
        for h in lst:
            out["%s-%s" % (y, h[0])] = h[1]
    return out
