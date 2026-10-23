# -*- coding: utf-8 -*-
"""대흥공업 MES — FastAPI 백엔드 (재구축 v2).

원본(v1.19.0)의 프론트엔드를 그대로 서빙하고, 프론트가 호출하는 API 계약을 구현한다.
구동:  python server/app.py       (기본 0.0.0.0:8000, 환경변수 MES_PORT 로 변경)
"""
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

import db
import auth
import tables as T
import dashboard
import xlsx
import prodcalc
import reports
import molds
import parts
import workorders
import attendance
import shipping
import rawmat
import plan
import quality
import system
import scan
import floor
import moldx
import rmx
import invoice
from common import client_ip, need_login, me_of, guard, admin_only, bad, ok, body, level, get_json
from meta import meta_for, VERSION, TABLES
from tables import TABLE_GROUP

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

app = FastAPI(title="대흥공업 MES")


def q(req, k, d=None):
    return req.query_params.get(k, d)


def file_resp(data, filename, media="application/octet-stream"):
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(filename)})


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def run(fn, *a, **kw):
    """ValueError → 400 {error}."""
    try:
        r = fn(*a, **kw)
        return JSONResponse(r if r is not None else {"ok": True})
    except ValueError as e:
        return bad(str(e))


# ════════════════════════════════════════════ 인증 · 메타
@app.post("/api/login")
async def api_login(req: Request):
    b = await body(req)
    token, me = auth.login((b.get("login") or "").strip(), b.get("password") or "", b.get("remember", True), client_ip(req))
    if not token:
        return bad("아이디 또는 비밀번호가 올바르지 않습니다.")
    db.run("UPDATE users SET last_login=? WHERE id=?", (db.now(), me["id"]))
    resp = JSONResponse({"ok": True, "me": me})
    resp.set_cookie(auth.COOKIE, token, max_age=(30 if b.get("remember", True) else 1) * 86400, httponly=True, samesite="lax")
    db.log(me["name"], client_ip(req), "auth", "login", me["login"], "로그인")
    return resp


@app.post("/api/logout")
async def api_logout(req: Request):
    auth.logout(req.cookies.get(auth.COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@app.post("/api/password")
async def api_password(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    b = await body(req)
    user = db.one("SELECT * FROM users WHERE id=?", (me["id"],))
    if not db.check_password(user, b.get("old", "")):
        return bad("지금 비밀번호가 올바르지 않습니다.")
    if len(b.get("new", "")) < 4:
        return bad("새 비밀번호는 4자 이상이어야 합니다.")
    db.set_password(me["id"], b["new"], me["name"])
    return ok()


@app.get("/api/meta")
async def api_meta(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    return JSONResponse(meta_for(me, {"company": db.get_setting("company")}, get_json("menu_layout", None)))


@app.get("/api/ping")
async def api_ping():
    return JSONResponse({"v": VERSION, "notice": system.update_notice()})


@app.get("/api/dashboard")
async def api_dashboard(req: Request):
    if not me_of(req):
        return need_login()
    return JSONResponse(dashboard.data())


@app.get("/api/home")
async def api_home(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    return JSONResponse(dashboard.home(lambda g: level(me, g)))


# ════════════════════════════════════════════ 기준정보/이력 공통 CRUD
def _prod_check(name, data, rid=None):
    if name == "production":
        row = dict(db.one("SELECT * FROM production WHERE id=?", (rid,)) or {}) if rid else {}
        row.update(data)
        quality.check_interlock(row)


@app.get("/api/t/{name}")
async def api_table_list(name: str, req: Request):
    if name not in TABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, TABLE_GROUP[name], 1)
    if err:
        return err
    return JSONResponse(T.list_rows(name))


@app.post("/api/t/{name}")
async def api_table_create(name: str, req: Request):
    if name not in TABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, TABLE_GROUP[name], 2)
    if err:
        return err
    b = await body(req)
    try:
        _prod_check(name, b)
        return JSONResponse(T.create(name, b, me["name"], client_ip(req)))
    except ValueError as e:
        return bad(str(e))


@app.put("/api/t/{name}/{rid}")
async def api_table_update(name: str, rid: int, req: Request):
    if name not in TABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, TABLE_GROUP[name], 2)
    if err:
        return err
    b = await body(req)
    try:
        _prod_check(name, b, rid)
        return JSONResponse(T.update(name, rid, b, me["name"], client_ip(req)))
    except ValueError as e:
        return bad(str(e))


@app.delete("/api/t/{name}/{rid}")
async def api_table_delete(name: str, rid: int, req: Request):
    if name not in TABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, TABLE_GROUP[name], 3)
    if err:
        return err
    if name == "parts":
        db.run("DELETE FROM parts_tx WHERE part_id=?", (rid,))
    return JSONResponse(T.delete(name, rid, me["name"], client_ip(req)))


# ════════════════════════════════════════════ 엑셀 · 변경기록
@app.post("/api/xlsx")
async def api_xlsx(req: Request):
    if not me_of(req):
        return need_login()
    b = await body(req)
    return file_resp(xlsx.build(b), b.get("filename", "export.xlsx"), XLSX)


@app.post("/api/xlsx_styled")
async def api_xlsx_styled(req: Request):
    if not me_of(req):
        return need_login()
    b = await body(req)
    return file_resp(xlsx.build_styled(b), b.get("filename", "export.xlsx"), XLSX)


@app.get("/api/log")
async def api_log(req: Request):
    me, err = guard(req, "시스템", 1)
    if err:
        return err
    sql, args = "SELECT * FROM change_log WHERE 1=1", []
    if q(req, "d1"):
        sql += " AND ts >= ?"
        args.append(q(req, "d1"))
    if q(req, "d2"):
        sql += " AND ts <= ?"
        args.append(q(req, "d2") + " 99")
    sql += " ORDER BY id DESC LIMIT %d" % min(int(q(req, "limit", 2000)), 20000)
    return JSONResponse(db.rows(sql, args))


# ════════════════════════════════════════════ 생산실적
@app.get("/api/production")
async def api_production(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(prodcalc.rows(q(req, "d1") or None, q(req, "d2") or None))


@app.get("/api/production/last")
async def api_production_last(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(db.one("SELECT * FROM production WHERE equip_no=? ORDER BY date DESC, id DESC LIMIT 1", (q(req, "equip"),)) or {})


@app.get("/api/production/missing")
async def api_production_missing(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(prodcalc.missing())


@app.get("/api/production/std")
async def api_production_std(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(prodcalc.std_summary(prodcalc.get_std()))


@app.put("/api/production/std")
async def api_production_std_put(req: Request):
    me, err = guard(req, "설정", 2)
    if err:
        return err
    prodcalc.save_std(await body(req))
    db.log(me["name"], client_ip(req), "settings", "update", "prod_std", "생산 기준(근무·휴게) 변경")
    return ok()


@app.get("/api/production/day")
async def api_production_day(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    d = q(req, "date")
    hol = attendance.holidays_map().get(d)
    import datetime as _dt
    off = bool(hol) or _dt.date.fromisoformat(d).weekday() >= 5
    return JSONResponse({"rows": db.rows("SELECT * FROM production WHERE date=? ORDER BY equip_no, id", (d,)),
                         "holiday": off, "holiday_name": hol or ("주말" if off else "")})


@app.post("/api/production/day")
async def api_production_day_save(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    b = await body(req)
    date, errors = b.get("date"), []
    for i, r in enumerate(b.get("rows") or []):
        r = dict(r, date=date)
        for k in ("equip_no", "code"):
            if not r.get(k):
                errors.append({"i": i, "msg": "%s 이(가) 비었습니다." % ("설비" if k == "equip_no" else "제번")})
                break
        else:
            if not db.one("SELECT id FROM products WHERE UPPER(code)=UPPER(?)", (r["code"],)):
                errors.append({"i": i, "msg": "등록되지 않은 제번: %s" % r["code"]})
            else:
                try:
                    quality.check_interlock(r)
                except ValueError as e:
                    errors.append({"i": i, "msg": str(e)})
    if errors:
        return JSONResponse({"ok": False, "errors": errors})
    if b.get("deleted") and level(me, "생산관리") < 3:
        return bad("삭제 권한이 없습니다.", 403)
    n_new = n_upd = 0
    for r in b.get("rows") or []:
        r = dict(r, date=date)
        if r.get("id"):
            T.update("production", int(r.pop("id")), r, me["name"], client_ip(req))
            n_upd += 1
        else:
            T.create("production", r, me["name"], client_ip(req))
            n_new += 1
    for rid in b.get("deleted") or []:
        T.delete("production", int(rid), me["name"], client_ip(req))
    return JSONResponse({"ok": True, "new": n_new, "upd": n_upd, "deleted": len(b.get("deleted") or [])})


@app.get("/api/report/{name}")
async def api_report(name: str, req: Request):
    grp = "품질관리" if name in ("defect", "qmonth") else "생산관리"
    me, err = guard(req, grp, 1)
    if err:
        return err
    fn = reports.REPORTS.get(name)
    if not fn:
        return bad("없는 보고서입니다.", 404)
    return JSONResponse(fn(dict(req.query_params)))


# ════════════════════════════════════════════ 금형 · 부품
@app.get("/api/molds/status")
async def api_molds_status(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    a1, a2 = molds.thresholds()
    return JSONResponse({"rows": molds.status(bool(q(req, "all"))), "alarm1": a1, "alarm2": a2})


@app.get("/api/molds/detail")
async def api_molds_detail(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    d = molds.detail(q(req, "no"))
    return JSONResponse(d) if d else bad("금형을 찾을 수 없습니다.", 404)


@app.get("/api/mold_repair/molds")
async def api_mr_molds(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse({"rows": molds.repair_molds()})


@app.get("/api/mold_repair/stats")
async def api_mr_stats(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(molds.repair_stats(q(req, "d1"), q(req, "d2")))


@app.post("/api/mold_repair/import")
async def api_mr_import(req: Request):
    me, err = guard(req, "금형관리", 2)
    if err:
        return err
    import repaircards
    return run(repaircards.import_file, q(req, "name") or "", await req.body(), me["name"])


@app.get("/api/parts")
async def api_parts(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(parts.list_parts())


@app.post("/api/parts/{pid}/move")
async def api_parts_move(pid: int, req: Request):
    me, err = guard(req, "금형관리", 2)
    if err:
        return err
    return run(parts.move, pid, await body(req), me["name"], client_ip(req))


@app.get("/api/parts/tx")
async def api_parts_tx(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(parts.tx_list(q(req, "part_id"), q(req, "d1") or None, q(req, "d2") or None, q(req, "kind") or None))


@app.delete("/api/parts/tx/{tid}")
async def api_parts_tx_del(tid: int, req: Request):
    me, err = guard(req, "금형관리", 3)
    if err:
        return err
    parts.tx_delete(tid, me["name"], client_ip(req))
    return ok()


# ════════════════════════════════════════════ 작업지시서
@app.get("/api/wo")
async def api_wo(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(workorders.get(q(req, "date")))


@app.get("/api/wo/list")
async def api_wo_list(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(workorders.list_all())


@app.get("/api/wo/hint")
async def api_wo_hint(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(workorders.hint(q(req, "date")))


@app.post("/api/wo")
async def api_wo_create(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    b = await body(req)
    r = run(workorders.create, b["date"], b.get("from_date"), b.get("mode"), me["name"])
    db.log(me["name"], client_ip(req), "workorder", "create", b["date"], "%s 작업지시서 만듦" % b["date"])
    return r


@app.post("/api/wo/import")
async def api_wo_import(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    try:
        return JSONResponse({"report": workorders.import_xlsx(await req.body(), me["name"])})
    except Exception as e:
        return bad("엑셀을 읽지 못했습니다: %s" % e)


@app.put("/api/wo/{wid}")
async def api_wo_save(wid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    b = await body(req)
    return run(workorders.save, wid, b.get("data"), b.get("version"), me["name"])


@app.post("/api/wo/{wid}/sign")
async def api_wo_sign(wid: int, req: Request):
    me, err = guard(req, "생산관리", 3)
    if err:
        return err
    b = await body(req)
    try:
        d = workorders.sign(wid, b.get("kind"), me["name"])
    except ValueError as e:
        return bad(str(e))
    db.log(me["name"], client_ip(req), "workorder", b.get("kind"), d, "%s 작업지시서 %s" % (d, {"review": "검토", "approve": "승인", "cancel": "결재 취소"}.get(b.get("kind"))))
    return ok()


@app.delete("/api/wo/{wid}")
async def api_wo_del(wid: int, req: Request):
    me, err = guard(req, "생산관리", 3)
    if err:
        return err
    d = workorders.delete(wid)
    db.log(me["name"], client_ip(req), "workorder", "delete", d, "%s 작업지시서 삭제" % d)
    return ok()


@app.get("/api/wo/{wid}/xlsx")
async def api_wo_xlsx(wid: int, req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    d, data = workorders.to_xlsx(wid)
    return file_resp(data, "작업지시서_%s.xlsx" % d, XLSX)


# ════════════════════════════════════════════ 납기 · 생산계획
@app.get("/api/plan")
async def api_plan(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return run(plan.compute, q(req, "start") or None, q(req, "date") or None)


@app.post("/api/plan/upload")
async def api_plan_upload(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    r = run(plan.upload, await req.body(), q(req, "name") or "", me["name"])
    db.log(me["name"], client_ip(req), "plan", "upload", "", "납기 파일 올림 %s" % (q(req, "name") or ""))
    return r


@app.post("/api/plan/workorder")
async def api_plan_wo(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(plan.wo_draft, await body(req), me["name"])


@app.get("/api/plan/families")
async def api_plan_fams(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse({"rows": plan.families()})


@app.post("/api/plan/families/refresh")
async def api_plan_fams_refresh(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return JSONResponse(plan.refresh_families())


@app.put("/api/plan/families/{fam}")
async def api_plan_fam_save(fam: str, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(plan.save_family, fam, await body(req), me["name"])


@app.post("/api/plan/override")
async def api_plan_ov(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(plan.add_override, await body(req), me["name"])


@app.delete("/api/plan/override/{oid}")
async def api_plan_ov_del(oid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    db.run("DELETE FROM plan_overrides WHERE id=?", (oid,))
    return ok()


@app.delete("/api/plan/override")
async def api_plan_ov_clear(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    db.run("DELETE FROM plan_overrides")
    return ok()


@app.get("/api/plan/incoming")
async def api_plan_inc(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(plan.incoming())


@app.post("/api/plan/incoming")
async def api_plan_inc_save(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(plan.save_incoming, await body(req), me["name"])


@app.delete("/api/plan/incoming/{iid}")
async def api_plan_inc_del(iid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    if q(req, "done"):
        db.run("UPDATE plan_incoming SET done=1 WHERE id=?", (iid,))
    else:
        db.run("DELETE FROM plan_incoming WHERE id=?", (iid,))
    return ok()


@app.post("/api/plan/rules")
async def api_plan_rule_add(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(lambda b: {"id": plan.add_rule(b, me["name"])}, await body(req))


@app.put("/api/plan/rules/{rid}")
async def api_plan_rule_put(rid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    b = await body(req)
    r = db.one("SELECT * FROM plan_rules WHERE id=?", (rid,))
    if r and r["pending"]:
        if b.get("active"):
            db.run("UPDATE plan_rules SET pending=0, active=1 WHERE id=?", (rid,))
        else:
            db.run("DELETE FROM plan_rules WHERE id=?", (rid,))
    else:
        db.run("UPDATE plan_rules SET active=? WHERE id=?", (1 if b.get("active") else 0, rid))
    return ok()


@app.delete("/api/plan/rules/{rid}")
async def api_plan_rule_del(rid: int, req: Request):
    me, err = guard(req, "생산관리", 3)
    if err:
        return err
    db.run("DELETE FROM plan_rules WHERE id=?", (rid,))
    return ok()


@app.get("/api/plan/learned")
async def api_plan_learned(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(plan.learned_view())


@app.put("/api/plan/learned")
async def api_plan_learned_put(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    plan.learned_update(await body(req))
    return ok()


@app.post("/api/plan/learned/rebuild")
async def api_plan_learned_rebuild(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return JSONResponse(plan.learned_rebuild())


@app.get("/api/plan/ai/state")
async def api_plan_ai_state(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(plan.ai_state(me["id"]))


@app.put("/api/plan/ai/config")
async def api_plan_ai_cfg(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    plan.ai_config(await body(req))
    return ok()


@app.post("/api/plan/ai")
async def api_plan_ai(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(plan.ai_ask, me, await body(req))


# ════════════════════════════════════════════ 근태
@app.get("/api/att/data")
async def api_att_data(req: Request):
    me, err = guard(req, "근태관리", 1)
    if err:
        return err
    return JSONResponse(attendance.data(int(q(req, "year"))))


@app.get("/api/att/rev")
async def api_att_rev(req: Request):
    me, err = guard(req, "근태관리", 1)
    if err:
        return err
    return JSONResponse({"rev": attendance.rev()})


@app.post("/api/att/cells")
async def api_att_cells(req: Request):
    me, err = guard(req, "근태관리", 2)
    if err:
        return err
    return JSONResponse({"rev": attendance.cells(await body(req))})


@app.put("/api/att/roster")
async def api_att_roster(req: Request):
    me, err = guard(req, "근태관리", 2)
    if err:
        return err
    b = await body(req)
    return JSONResponse({"rev": attendance.set_roster(b["ym"], b.get("roster") or [])})


@app.put("/api/att/leave")
async def api_att_leave(req: Request):
    me, err = guard(req, "근태관리", 2)
    if err:
        return err
    return JSONResponse({"rev": attendance.set_leave(await body(req))})


@app.post("/api/att/emp")
async def api_att_emp(req: Request):
    me, err = guard(req, "근태관리", 2)
    if err:
        return err
    return run(attendance.save_emp, await body(req), me["name"])


@app.delete("/api/att/emp/{eid}")
async def api_att_emp_del(eid: str, req: Request):
    me, err = guard(req, "근태관리", 3)
    if err:
        return err
    return run(lambda: {"rev": attendance.delete_emp(eid)})


@app.put("/api/att/emp_order")
async def api_att_emp_order(req: Request):
    me, err = guard(req, "근태관리", 2)
    if err:
        return err
    return JSONResponse({"rev": attendance.emp_order((await body(req)).get("ids") or [])})


@app.put("/api/att/config")
async def api_att_config(req: Request):
    me, err = guard(req, "근태관리", 3)
    if err:
        return err
    b = await body(req)
    r = attendance.save_cfg(b.get("cfg") or {})
    db.log(me["name"], client_ip(req), "settings", "att", "", "근태 설정: %s" % (b.get("what") or ""))
    return JSONResponse({"rev": r})


@app.post("/api/att/holidays/fetch")
async def api_att_holidays(req: Request):
    me, err = guard(req, "근태관리", 3)
    if err:
        return err
    b = await body(req)
    return run(lambda: {"list": attendance.fetch_holidays(b.get("key") or "", b.get("year"))})


@app.post("/api/att/import")
async def api_att_import(req: Request):
    me, err = guard(req, "근태관리", 3)
    if err:
        return err
    system.backup_now("before_att_import")
    rep, rev = attendance.import_file(q(req, "name") or "", await req.body())
    return JSONResponse({"report": rep, "rev": rev})


# ════════════════════════════════════════════ 원재료
@app.post("/api/rm/refresh")
async def api_rm_refresh(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(rawmat.refresh(bool((await body(req)).get("force")), me["name"]))


@app.get("/api/rm/data")
async def api_rm_data(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(rawmat.data_view(me.get("admin")))


@app.get("/api/rm/history")
async def api_rm_history(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(rawmat.history(q(req, "d1"), q(req, "d2"), q(req, "barcode")))


@app.put("/api/rm/path")
async def api_rm_path(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(rawmat.set_path, await body(req), me["name"])


# ════════════════════════════════════════════ 출하
@app.get("/api/ship/stock")
async def api_ship_stock(req: Request):
    me, err = guard(req, "출하관리", 1)
    if err:
        return err
    return JSONResponse(shipping.stock())


@app.put("/api/ship/start")
async def api_ship_start(req: Request):
    me, err = guard(req, "출하관리", 3)
    if err:
        return err
    return run(shipping.set_start, (await body(req)).get("date"), me["name"], client_ip(req))


@app.post("/api/ship/confirm")
async def api_ship_confirm(req: Request):
    me, err = guard(req, "출하관리", 2)
    if err:
        return err
    return run(shipping.confirm, await body(req), me["name"], client_ip(req))


@app.post("/api/ship/quick")
async def api_ship_quick(req: Request):
    me, err = guard(req, "출하관리", 2)
    if err:
        return err
    return run(shipping.quick, await body(req), me["name"], client_ip(req))


@app.post("/api/ship/adjust")
async def api_ship_adjust(req: Request):
    me, err = guard(req, "출하관리", 3)
    if err:
        return err
    return run(shipping.adjust, await body(req), me["name"], client_ip(req))


@app.get("/api/ship/holds")
async def api_ship_holds(req: Request):
    me, err = guard(req, "출하관리", 1)
    if err:
        return err
    return JSONResponse(shipping.holds(bool(q(req, "all"))))


@app.post("/api/ship/holds")
async def api_ship_hold_add(req: Request):
    me, err = guard(req, "출하관리", 2)
    if err:
        return err
    return run(shipping.add_hold, await body(req), me["name"], client_ip(req))


@app.post("/api/ship/holds/{hid}")
async def api_ship_hold_act(hid: int, req: Request):
    me, err = guard(req, "출하관리", 2)
    if err:
        return err
    return run(shipping.act_hold, hid, await body(req), me["name"], client_ip(req))


@app.delete("/api/ship/holds/{hid}")
async def api_ship_hold_del(hid: int, req: Request):
    me, err = guard(req, "출하관리", 3)
    if err:
        return err
    return run(shipping.del_hold, hid, me["name"], client_ip(req))


@app.get("/api/ship/list")
async def api_ship_list(req: Request):
    me, err = guard(req, "출하관리", 1)
    if err:
        return err
    return JSONResponse(shipping.tx_list(q(req, "d1"), q(req, "d2"), q(req, "kinds")))


@app.put("/api/ship/tx/{tid}")
async def api_ship_tx_put(tid: int, req: Request):
    me, err = guard(req, "출하관리", 2)
    if err:
        return err
    b = await body(req)
    return run(shipping.tx_date, tid, b.get("ship_date"), b.get("whole", True), me["name"], client_ip(req))


@app.delete("/api/ship/tx/{tid}")
async def api_ship_tx_del(tid: int, req: Request):
    me, err = guard(req, "출하관리", 3)
    if err:
        return err
    return run(shipping.tx_delete, tid, q(req, "whole") != "0", me["name"], client_ip(req))


# ════════════════════════════════════════════ [개선] 품질관리 · LOT 추적
QTABLES = {"incoming": "q_incoming", "inproc": "q_inproc", "claims": "q_claims", "gauges": "q_gauges", "lots": "rawmat_lots"}


def _qgroup(kind):
    return "원재료" if kind == "lots" else "품질관리"


@app.get("/api/q/{kind}")
async def api_q_list(kind: str, req: Request):
    if kind not in QTABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, _qgroup(kind), 1)
    if err:
        return err
    return JSONResponse(quality.list_rows(QTABLES[kind], q(req, "d1"), q(req, "d2")))


@app.post("/api/q/{kind}")
async def api_q_create(kind: str, req: Request):
    if kind not in QTABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, _qgroup(kind), 2)
    if err:
        return err
    return run(quality.save, QTABLES[kind], None, await body(req), me["name"], client_ip(req))


@app.put("/api/q/{kind}/{rid}")
async def api_q_update(kind: str, rid: int, req: Request):
    if kind not in QTABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, _qgroup(kind), 2)
    if err:
        return err
    return run(quality.save, QTABLES[kind], rid, await body(req), me["name"], client_ip(req))


@app.delete("/api/q/{kind}/{rid}")
async def api_q_delete(kind: str, rid: int, req: Request):
    if kind not in QTABLES:
        return bad("없는 표입니다.", 404)
    me, err = guard(req, _qgroup(kind), 3)
    if err:
        return err
    quality.delete(QTABLES[kind], rid, me["name"], client_ip(req))
    return ok()


@app.post("/api/qx/inproc/{rid}/approve")
async def api_q_inproc_approve(rid: int, req: Request):
    me, err = guard(req, "품질관리", 3)
    if err:
        return err
    return run(quality.approve_inproc, rid, me["name"], client_ip(req))


@app.get("/api/qx/claims/stats")
async def api_q_claim_stats(req: Request):
    me, err = guard(req, "품질관리", 1)
    if err:
        return err
    import datetime as _dt
    return JSONResponse(quality.claim_stats(int(q(req, "year") or _dt.date.today().year)))


@app.get("/api/qx/gauges/{gid}/hist")
async def api_q_gauge_hist(gid: int, req: Request):
    me, err = guard(req, "품질관리", 1)
    if err:
        return err
    return JSONResponse(quality.gauge_hist(gid))


@app.post("/api/qx/gauges/{gid}/hist")
async def api_q_gauge_hist_add(gid: int, req: Request):
    me, err = guard(req, "품질관리", 2)
    if err:
        return err
    return run(quality.add_gauge_hist, gid, await body(req), me["name"], client_ip(req))


@app.get("/api/qx/docs")
async def api_q_docs(req: Request):
    me, err = guard(req, "품질관리", 1)
    if err:
        return err
    return JSONResponse({"rows": quality.docs(), "check": quality.doc_check()})


@app.post("/api/qx/docs")
async def api_q_doc_add(req: Request):
    me, err = guard(req, "품질관리", 2)
    if err:
        return err
    m = {k: q(req, k) for k in ("kind", "code", "title", "rev", "rev_date", "note")}
    return run(quality.add_doc, m, q(req, "name") or "file", await req.body(), me["name"], client_ip(req))


@app.get("/api/qx/docs/{did}/file")
async def api_q_doc_file(did: int, req: Request):
    me, err = guard(req, "품질관리", 1)
    if err:
        return err
    p, n = quality.doc_file(did)
    if not p:
        return bad("파일이 없습니다.", 404)
    return FileResponse(p, filename=n)


@app.delete("/api/qx/docs/{did}")
async def api_q_doc_del(did: int, req: Request):
    me, err = guard(req, "품질관리", 3)
    if err:
        return err
    p, _ = quality.doc_file(did)
    db.run("DELETE FROM q_docs WHERE id=?", (did,))
    if p:
        try:
            os.remove(p)
        except OSError:
            pass
    return ok()


@app.get("/api/qx/trace")
async def api_q_trace(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    if max(level(me, "품질관리"), level(me, "원재료"), level(me, "생산관리")) < 1:
        return bad("권한이 없습니다.", 403)
    return JSONResponse(quality.trace(q(req, "q")))


@app.get("/api/qx/summary")
async def api_q_summary(req: Request):
    me, err = guard(req, "품질관리", 1)
    if err:
        return err
    return JSONResponse(quality.dashboard_extra())


# ════════════════════════════════════════════ [개선] 생산실적 쉽게 넣기 (작업지시 기반 · 작업일보 스캔)
def _inline(path, name):
    return FileResponse(path, filename=name, content_disposition_type="inline")


@app.get("/api/production/from_wo")
async def api_prod_from_wo(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return run(scan.from_wo, q(req, "date") or "")


@app.post("/api/scan")
async def api_scan_add(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(scan.save_scan, q(req, "name") or "", await req.body(), q(req, "date") or "", me["name"])


@app.get("/api/scan/list")
async def api_scan_list(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(scan.list_scans(q(req, "d1"), q(req, "d2")))


@app.get("/api/scan/{sid}")
async def api_scan_get(sid: int, req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    r = scan.get_scan(sid)
    if not r:
        return bad("스캔을 찾을 수 없습니다.", 404)
    r.pop("file_path", None)
    return JSONResponse(r)


@app.get("/api/scan/{sid}/image")
async def api_scan_image(sid: int, req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    r = db.one("SELECT file_path, file_name FROM prod_scans WHERE id=?", (sid,))
    if not r or not r["file_path"] or not os.path.isfile(r["file_path"]):
        return bad("그림 파일이 없습니다.", 404)
    return _inline(r["file_path"], r["file_name"] or "scan")


@app.post("/api/scan/{sid}/applied")
async def api_scan_applied(sid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    scan.mark_applied(sid, me["name"])
    return ok()


@app.delete("/api/scan/{sid}")
async def api_scan_del(sid: int, req: Request):
    me, err = guard(req, "생산관리", 3)
    if err:
        return err
    scan.delete_scan(sid)
    db.log(me["name"], client_ip(req), "prod_scans", "delete", sid, "작업일보 스캔 삭제")
    return ok()


# ════════════════════════════════════════════ [개선] 현장 태블릿 입력
@app.get("/api/floor/state")
async def api_floor_state(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(dict(floor.state(), me=me["name"], level=level(me, "생산관리")))


@app.get("/api/floor/products")
async def api_floor_products(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    return JSONResponse(floor.products(q(req, "q")))


@app.get("/api/floor/runs")
async def api_floor_runs(req: Request):
    me, err = guard(req, "생산관리", 1)
    if err:
        return err
    import datetime as _dt
    t = _dt.date.today().isoformat()
    return JSONResponse(floor.runs(q(req, "d1") or t, q(req, "d2") or t))


@app.post("/api/floor/start")
async def api_floor_start(req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(floor.start, await body(req), me["name"])


@app.post("/api/floor/{rid}/{act}")
async def api_floor_act(rid: int, act: str, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    b = await body(req)
    if act == "down":
        return run(floor.down, rid, b, me["name"])
    if act == "up":
        return run(floor.up, rid, me["name"])
    if act == "finish":
        return run(floor.finish, rid, b, me["name"], client_ip(req))
    if act == "retry":
        return run(floor.retry, rid, me["name"], client_ip(req))
    return bad("알 수 없는 동작입니다.", 404)


@app.delete("/api/floor/{rid}")
async def api_floor_cancel(rid: int, req: Request):
    me, err = guard(req, "생산관리", 2)
    if err:
        return err
    return run(floor.cancel, rid, me["name"])


@app.get("/floor")
async def floor_page():
    return FileResponse(os.path.join(WEB_DIR, "floor.html"))


# ════════════════════════════════════════════ [개선] 금형 이동 · 사진/도면 · 유지비 · 부품단가
@app.get("/api/moldx/board")
async def api_moldx_board(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.board())


@app.post("/api/moldx/move")
async def api_moldx_move(req: Request):
    me, err = guard(req, "금형관리", 2)
    if err:
        return err
    return run(moldx.move, await body(req), me["name"], client_ip(req))


@app.get("/api/moldx/moves")
async def api_moldx_moves(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.moves(q(req, "mold_no"), q(req, "d1"), q(req, "d2")))


@app.delete("/api/moldx/moves/{mid}")
async def api_moldx_move_del(mid: int, req: Request):
    me, err = guard(req, "금형관리", 3)
    if err:
        return err
    moldx.delete_move(mid, me["name"], client_ip(req))
    return ok()


@app.get("/api/moldx/files")
async def api_moldx_files(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.files(q(req, "mold_no")))


@app.post("/api/moldx/files")
async def api_moldx_file_add(req: Request):
    me, err = guard(req, "금형관리", 2)
    if err:
        return err
    m = {k: q(req, k) for k in ("mold_no", "kind", "title", "rev", "rev_date", "note")}
    return run(moldx.add_file, m, q(req, "name") or "file", await req.body(), me["name"], client_ip(req))


@app.get("/api/moldx/files/{fid}")
async def api_moldx_file(fid: int, req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    f = moldx.file_of(fid)
    if not f:
        return bad("파일이 없습니다.", 404)
    return _inline(f["file_path"], f["file_name"]) if not q(req, "dl") else FileResponse(f["file_path"], filename=f["file_name"])


@app.delete("/api/moldx/files/{fid}")
async def api_moldx_file_del(fid: int, req: Request):
    me, err = guard(req, "금형관리", 3)
    if err:
        return err
    moldx.delete_file(fid, me["name"], client_ip(req))
    return ok()


@app.get("/api/moldx/cost")
async def api_moldx_cost(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.cost(q(req, "d1") or "0000-00-00", q(req, "d2") or "9999-99-99"))


@app.get("/api/moldx/prices")
async def api_moldx_prices(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.prices(q(req, "d1") or "0000-00-00", q(req, "d2") or "9999-99-99"))


@app.get("/api/moldx/price_hist")
async def api_moldx_price_hist(req: Request):
    me, err = guard(req, "금형관리", 1)
    if err:
        return err
    return JSONResponse(moldx.price_hist(q(req, "item"), q(req, "spec")))


# ════════════════════════════════════════════ [개선] 원재료 소요량 · 안전재고 · 거래명세서
@app.get("/api/rmx/need")
async def api_rmx_need(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(rmx.need())


@app.put("/api/rmx/safety")
async def api_rmx_safety(req: Request):
    me, err = guard(req, "원재료", 2)
    if err:
        return err
    r = rmx.save_safety(await body(req), me["name"])
    db.log(me["name"], client_ip(req), "settings", "update", "rm_safety", "원재료 안전재고 변경")
    return JSONResponse(r)


@app.get("/api/rmx/yield")
async def api_rmx_yield(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(rmx.yields(q(req, "d1") or "0000-00-00", q(req, "d2") or "9999-99-99"))


@app.post("/api/invoice/read")
async def api_invoice_read(req: Request):
    me, err = guard(req, "원재료", 2)
    if err:
        return err
    return run(invoice.read, q(req, "name") or "", await req.body(), me["name"])


@app.post("/api/invoice/commit")
async def api_invoice_commit(req: Request):
    me, err = guard(req, "원재료", 2)
    if err:
        return err
    return run(invoice.commit, await body(req), me["name"], client_ip(req), level(me, "금형관리") >= 2)


@app.get("/api/invoice/list")
async def api_invoice_list(req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(invoice.list_inv(q(req, "d1"), q(req, "d2")))


@app.get("/api/invoice/{iid}/items")
async def api_invoice_items(iid: int, req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    return JSONResponse(invoice.items_of(iid))


@app.get("/api/invoice/{iid}/file")
async def api_invoice_file(iid: int, req: Request):
    me, err = guard(req, "원재료", 1)
    if err:
        return err
    p, n = invoice.file_of(iid)
    if not p:
        return bad("파일이 없습니다.", 404)
    return _inline(p, n)


@app.delete("/api/invoice/{iid}")
async def api_invoice_del(iid: int, req: Request):
    me, err = guard(req, "원재료", 3)
    if err:
        return err
    return run(invoice.delete, iid, me["name"], client_ip(req))


# ════════════════════════════════════════════ 한줄 메모
@app.get("/api/memos")
async def api_memos(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    return JSONResponse(system.memos(me, int(q(req, "limit", 60)), bool(q(req, "all")), q(req, "q") or ""))


@app.get("/api/memos/{mid}")
async def api_memo(mid: int, req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    return run(system.memo_one, mid, me)


@app.post("/api/memos")
async def api_memo_add(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    t = ((await body(req)).get("text") or "").strip()[:300]
    if not t:
        return bad("메모를 입력하세요.")
    db.run("INSERT INTO memos(text,user_id,created,created_by) VALUES(?,?,?,?)", (t, me["id"], db.now(), me["name"]))
    return ok()


@app.post("/api/memos/{mid}/comments")
async def api_memo_comment(mid: int, req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    t = ((await body(req)).get("text") or "").strip()[:500]
    if not t:
        return bad("코멘트를 입력하세요.")
    db.run("INSERT INTO memo_comments(memo_id,text,user_id,created,created_by) VALUES(?,?,?,?,?)", (mid, t, me["id"], db.now(), me["name"]))
    return ok()


@app.delete("/api/memos/{mid}")
async def api_memo_del(mid: int, req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    m = db.one("SELECT user_id FROM memos WHERE id=?", (mid,))
    if m and m["user_id"] != me["id"] and not me.get("admin"):
        return bad("자기 메모만 지울 수 있습니다.", 403)
    db.run("DELETE FROM memo_comments WHERE memo_id=?", (mid,))
    db.run("DELETE FROM memos WHERE id=?", (mid,))
    return ok()


@app.delete("/api/memo_comments/{cid}")
async def api_memo_comment_del(cid: int, req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    c = db.one("SELECT user_id FROM memo_comments WHERE id=?", (cid,))
    if c and c["user_id"] != me["id"] and not me.get("admin"):
        return bad("자기 코멘트만 지울 수 있습니다.", 403)
    db.run("DELETE FROM memo_comments WHERE id=?", (cid,))
    return ok()


# ════════════════════════════════════════════ 시스템
@app.get("/api/users")
async def api_users(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return JSONResponse(system.users_view())


@app.post("/api/users")
async def api_user_add(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(system.user_save, None, await body(req), me["name"])


@app.put("/api/users/{uid}")
async def api_user_put(uid: int, req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(system.user_save, uid, await body(req), me["name"])


@app.delete("/api/users/{uid}")
async def api_user_del(uid: int, req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(system.user_delete, uid, me["id"])


@app.get("/api/settings")
async def api_settings(req: Request):
    me, err = guard(req, "시스템", 1)
    if err:
        return err
    return JSONResponse(system.settings_get())


@app.put("/api/settings")
async def api_settings_put(req: Request):
    me, err = guard(req, "시스템", 2)
    if err:
        return err
    system.settings_put(await body(req))
    db.log(me["name"], client_ip(req), "settings", "update", "", "설정 저장")
    return ok()


@app.get("/api/backup/list")
async def api_backup_list(req: Request):
    me, err = guard(req, "시스템", 1)
    if err:
        return err
    return JSONResponse(system.backup_list())


@app.post("/api/backup/now")
async def api_backup_now(req: Request):
    me, err = guard(req, "시스템", 2)
    if err:
        return err
    return JSONResponse({"name": system.backup_now()})


@app.get("/api/backup/download")
async def api_backup_dl(req: Request):
    me, err = guard(req, "시스템", 2)
    if err:
        return err
    p, n = system.backup_path(q(req, "name"))
    if not p:
        return bad("파일이 없습니다.", 404)
    return FileResponse(p, filename=n)


@app.get("/api/update/status")
async def api_upd_status(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return JSONResponse(system.update_status())


@app.post("/api/update/upload")
async def api_upd_upload(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(system.update_upload, q(req, "name") or "", await req.body(), me["name"])


@app.post("/api/update/plan")
async def api_upd_plan(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return run(system.update_plan, await body(req), me["name"])


@app.delete("/api/update/plan")
async def api_upd_plan_del(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    system.update_cancel()
    return ok()


@app.delete("/api/update/staged")
async def api_upd_staged_del(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    db.set_setting("upd_staged", "null")
    return ok()


@app.get("/api/menu_layout")
async def api_menu_layout(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return JSONResponse(system.menu_layout_view())


@app.put("/api/menu_layout")
async def api_menu_layout_put(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    db.log(me["name"], client_ip(req), "settings", "menu", "", "메뉴 배치 저장")
    return JSONResponse(system.menu_layout_save(await body(req)))


@app.delete("/api/menu_layout")
async def api_menu_layout_reset(req: Request):
    me, err = admin_only(req)
    if err:
        return err
    return JSONResponse(system.menu_layout_reset())


@app.post("/api/import/{kind}")
async def api_import(kind: str, req: Request):
    me, err = guard(req, "시스템", 2)
    if err:
        return err
    buf = await req.body()
    try:
        if kind == "xlsm":
            rep = system.import_xlsm(buf, [w for w in (q(req, "what") or "").split(",") if w], me["name"], client_ip(req))
        elif kind == "partsdb":
            rep = system.import_partsdb(buf, me["name"], client_ip(req))
        else:
            return bad("알 수 없는 가져오기입니다.", 404)
    except ValueError as e:
        return bad(str(e))
    except Exception as e:
        return bad("가져오지 못했습니다: %s" % e)
    return JSONResponse({"report": rep})


@app.get("/api/client.zip")
async def api_client(req: Request):
    base = "%s://%s" % (req.url.scheme, req.headers.get("host") or req.url.netloc)
    return file_resp(system.client_zip(base), "대흥공업_접속프로그램.zip", "application/zip")


# ════════════════════════════════════════════ 정적 파일 (프론트)
app.mount("/css", StaticFiles(directory=os.path.join(WEB_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(WEB_DIR, "js")), name="js")


def _index_html():
    """index.html 의 /js/*.js 에 버전을 붙여 — 업데이트 뒤 브라우저가 옛 스크립트를 쓰지 않게."""
    with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace('.js"></script>', '.js?v=%s"></script>' % VERSION)
    return Response(html, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})


@app.get("/")
async def index():
    return _index_html()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def spa(path: str):
    # 아직 구현 안 된 API 는 JSON 오류로 — index.html 을 주면 화면이 엉뚱한 오류를 냄
    if path.startswith("api/"):
        return JSONResponse({"error": "아직 구현되지 않은 기능입니다: /" + path}, status_code=501)
    full = os.path.join(WEB_DIR, path)
    if os.path.isfile(full):
        return FileResponse(full)
    if os.path.isfile(os.path.join(WEB_DIR, "index.html")):
        return _index_html()
    return PlainTextResponse("web/index.html 이 없습니다.", status_code=404)


def main():
    db.init()
    system.daily_backup_loop()
    host = os.environ.get("MES_HOST", "0.0.0.0")
    port = int(os.environ.get("MES_PORT", "8000"))
    print("대흥공업 MES v%s  →  http://%s:%d" % (VERSION, host, port))
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
