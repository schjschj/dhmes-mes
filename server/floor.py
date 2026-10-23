# -*- coding: utf-8 -*-
"""[개선제안] 현장 태블릿 입력 — 작업 시작 · 비가동(사유별 시작/끝) · 종료(R/L) 를 누르면 생산실적이 저절로 만들어진다.

한 번의 작업(floor_runs) = 설비 하나에서 제번 하나를 시작~종료.
종료하면 그날(주간 시작 전 새벽이면 전날) 같은 설비 · 제번 생산실적 줄에 R/L · 시간 · 비가동(분)을 더한다.
초품 승인 인터락이 켜져 있으면 생산실적 저장 단계에서 검사 · 승인이 있어야 반영된다 (없으면 '미반영' 으로 남김).
"""
import datetime
import json

import db
import prodcalc
import quality
import tables as T

DOWN = [("dt_setup", "금형셋업"), ("dt_first", "초품검사"), ("dt_mold", "금형수리"), ("dt_equip", "설비수리"), ("dt_etc", "기타")]


def _ts(s):
    return datetime.datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def _prod_date(ts):
    """주간 시작(기본 08:30) 전 새벽 작업은 전날 실적."""
    std = prodcalc.get_std()
    hh, mm = (std.get("day_start") or "08:30").split(":")
    t = _ts(ts)
    if t.time() < datetime.time(int(hh), int(mm)) and t.hour < 7:
        return (t.date() - datetime.timedelta(days=1)).isoformat()
    return t.date().isoformat()


def _shift_end():
    return prodcalc.get_std().get("shift_normal") or "20:30"


def _row(r):
    r = dict(r)
    r["downs"] = json.loads(r.get("downs") or "[]")
    r["down_open"] = next((d for d in r["downs"] if not d.get("e")), None)
    mins = {}
    now = datetime.datetime.now()
    for d in r["downs"]:
        e = _ts(d["e"]) if d.get("e") else now
        mins[d["k"]] = mins.get(d["k"], 0) + max(0, (e - _ts(d["s"])).total_seconds() / 60.0)
    r["down_min"] = {k: round(v) for k, v in mins.items()}
    end = _ts(r["end_ts"]) if r.get("end_ts") else now
    r["elapsed"] = round((end - _ts(r["start_ts"])).total_seconds() / 60.0)
    return r


def state():
    today = datetime.date.today().isoformat()
    eqs = db.rows("SELECT no, ton, maker, status FROM equipment WHERE COALESCE(status,'')<>'폐기'")
    eqs.sort(key=lambda e: (len(str(e["no"])), str(e["no"])))
    active = {}
    for r in db.rows("SELECT * FROM floor_runs WHERE status='진행' ORDER BY id"):
        active[str(r["equip_no"])] = _row(r)
    wo = {}
    try:
        import scan
        w = db.one("SELECT date FROM work_orders WHERE date<=? ORDER BY date DESC LIMIT 1", (today,))
        if w:
            for x in scan.from_wo(w["date"])["rows"]:
                wo.setdefault(x["equip_no"], []).append(x["code"])
    except ValueError:
        pass
    last = {}
    for r in db.rows("SELECT equip_no, code FROM production ORDER BY date, id"):
        last[str(r["equip_no"])] = r["code"]
    names = {p["code"].upper(): p["name"] for p in db.rows("SELECT code, name FROM products")}
    out = []
    for e in eqs:
        no = str(e["no"])
        codes = list(dict.fromkeys((wo.get(no) or []) + ([last[no]] if last.get(no) else [])))
        out.append({"no": no, "ton": e.get("ton"), "maker": e.get("maker"), "run": active.get(no),
                    "codes": [{"code": c, "name": names.get(c.upper(), "")} for c in codes]})
    done = [_row(r) for r in db.rows("SELECT * FROM floor_runs WHERE status<>'진행' AND date=? ORDER BY id DESC", (today,))]
    return {"now": db.now(), "today": today, "equips": out, "done": done, "downs": [{"k": k, "l": l} for k, l in DOWN],
            "shift_end": _shift_end(), "interlock": quality.interlock_on(),
            "workers": [w["name"] for w in db.rows("SELECT name FROM workers WHERE active=1 ORDER BY name")]}


def products(q):
    like = "%" + (q or "").strip() + "%"
    return db.rows("SELECT code, name FROM products WHERE code LIKE ? OR name LIKE ? ORDER BY code LIMIT 30", (like, like))


def _get(rid):
    r = db.one("SELECT * FROM floor_runs WHERE id=?", (rid,))
    if not r:
        raise ValueError("작업을 찾을 수 없습니다.")
    return r


def start(b, user):
    eq, code = str(b.get("equip_no") or "").strip(), (b.get("code") or "").strip()
    if not eq or not code:
        raise ValueError("설비와 제번을 고르세요.")
    p = db.one("SELECT code FROM products WHERE UPPER(code)=UPPER(?)", (code,))
    if not p:
        raise ValueError("등록되지 않은 제번입니다: %s" % code)
    if db.one("SELECT id FROM floor_runs WHERE equip_no=? AND status='진행'", (eq,)):
        raise ValueError("%s호기는 이미 작업 중입니다. 먼저 종료하세요." % eq)
    now = db.now()
    cur = db.run("""INSERT INTO floor_runs(date,equip_no,code,worker,start_ts,downs,coil_lot,status,created,created_by,updated,updated_by)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (_prod_date(now), eq, p["code"], b.get("worker") or user, now, "[]", (b.get("coil_lot") or "").strip(),
                  "진행", now, user, now, user))
    return {"id": cur.lastrowid}


def down(rid, b, user):
    r = _get(rid)
    if r["status"] != "진행":
        raise ValueError("끝난 작업입니다.")
    k = b.get("k")
    if k not in dict(DOWN):
        raise ValueError("비가동 사유를 고르세요.")
    ds = json.loads(r["downs"] or "[]")
    now = db.now()
    for d in ds:                    # 열려 있던 비가동은 닫고 새로
        if not d.get("e"):
            d["e"] = now
    ds.append({"k": k, "s": now, "note": b.get("note") or ""})
    db.run("UPDATE floor_runs SET downs=?, updated=?, updated_by=? WHERE id=?", (json.dumps(ds, ensure_ascii=False), now, user, rid))
    return {"ok": True}


def up(rid, user):
    r = _get(rid)
    ds = json.loads(r["downs"] or "[]")
    now = db.now()
    for d in ds:
        if not d.get("e"):
            d["e"] = now
    db.run("UPDATE floor_runs SET downs=?, updated=?, updated_by=? WHERE id=?", (json.dumps(ds, ensure_ascii=False), now, user, rid))
    return {"ok": True}


def _apply(r, user, ip):
    """끝난 작업 → 생산실적 줄 (같은 날 · 설비 · 제번 줄이 있으면 더함)."""
    x = _row(r)
    st, en = _ts(r["start_ts"]).strftime("%H:%M"), _ts(r["end_ts"]).strftime("%H:%M")
    dr, nr = prodcalc._num(r.get("day_reels")), prodcalc._num(r.get("night_reels"))
    row = {"date": r["date"], "equip_no": r["equip_no"], "code": r["code"]}
    quality.check_interlock(row)
    old = db.one("SELECT * FROM production WHERE date=? AND equip_no=? AND UPPER(code)=UPPER(?) ORDER BY id LIMIT 1",
                 (r["date"], str(r["equip_no"]), r["code"]))
    dmin = x["down_min"]
    if old:
        v = {"day_reels": prodcalc._num(old.get("day_reels")) + dr or None,
             "night_reels": prodcalc._num(old.get("night_reels")) + nr or None,
             "start_time": min(filter(None, [old.get("start_time"), st])) if old.get("start_time") else st,
             "end_time": en}
        for k, _ in DOWN:
            v[k] = round(prodcalc._num(old.get(k)) + dmin.get(k, 0)) or None
        if r.get("coil_lot") and not old.get("coil_lot"):
            v["coil_lot"] = r["coil_lot"]
        if nr and not old.get("night_worker"):
            v["night_worker"] = r["worker"]
        elif dr and not old.get("day_worker"):
            v["day_worker"] = r["worker"]
        T.update("production", old["id"], v, user, ip)
        return old["id"]
    v = dict(row, day_reels=dr or None, night_reels=nr or None, start_time=st, end_time=en,
             coil_lot=r.get("coil_lot") or None, note="태블릿 입력")
    if nr and not dr:
        v["night_worker"] = r["worker"]
    else:
        v["day_worker"] = r["worker"]
    for k, _ in DOWN:
        v[k] = dmin.get(k) or None
    return T.create("production", v, user, ip)["id"]


def finish(rid, b, user, ip):
    r = _get(rid)
    if r["status"] == "반영":
        raise ValueError("이미 반영된 작업입니다.")
    try:
        dr = float(str(b.get("day_reels") or 0).replace(",", "") or 0)
        nr = float(str(b.get("night_reels") or 0).replace(",", "") or 0)
    except ValueError:
        raise ValueError("R/L 을 숫자로 넣으세요.")
    if dr < 0 or nr < 0 or (dr + nr) <= 0 and not b.get("zero_ok"):
        raise ValueError("생산 R/L 을 넣으세요 (생산이 없으면 '생산 없음' 을 고르세요).")
    now = db.now()
    ds = json.loads(r["downs"] or "[]")
    for d in ds:
        if not d.get("e"):
            d["e"] = now
    end = r["end_ts"] or now
    db.run("""UPDATE floor_runs SET end_ts=?, downs=?, day_reels=?, night_reels=?, reels=?, note=?, status='종료',
              updated=?, updated_by=? WHERE id=?""",
           (end, json.dumps(ds, ensure_ascii=False), dr, nr, dr + nr, b.get("note") or r.get("note"), now, user, rid))
    return _try_apply(rid, user, ip)


def _try_apply(rid, user, ip):
    try:
        pid = _apply(_get(rid), user, ip)
    except ValueError as e:
        db.run("UPDATE floor_runs SET status='미반영', error=? WHERE id=?", (str(e), rid))
        return {"ok": False, "error": str(e)}
    db.run("UPDATE floor_runs SET status='반영', production_id=?, error=NULL WHERE id=?", (pid, rid))
    return {"ok": True, "production_id": pid}


def retry(rid, user, ip):
    if _get(rid)["status"] != "미반영":
        raise ValueError("미반영 작업만 다시 반영할 수 있습니다.")
    return _try_apply(rid, user, ip)


def cancel(rid, user):
    r = _get(rid)
    if r["status"] == "반영":
        raise ValueError("이미 생산실적에 반영된 작업은 생산실적 화면에서 고치세요.")
    db.run("DELETE FROM floor_runs WHERE id=?", (rid,))


def runs(d1, d2):
    return [_row(r) for r in db.rows("SELECT * FROM floor_runs WHERE date BETWEEN ? AND ? ORDER BY id DESC", (d1, d2))]
