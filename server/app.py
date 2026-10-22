# -*- coding: utf-8 -*-
"""대흥공업 MES — FastAPI 백엔드 (재구축 v2).

원본(v1.19.0)의 프론트엔드를 그대로 서빙하고, 프론트가 호출하는 API 계약을 구현한다.
구동:  python server/app.py       (기본 0.0.0.0:8000)
"""
import os
import sys

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
from meta import meta_for, VERSION, TABLES
from tables import TABLE_GROUP

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

app = FastAPI(title="대흥공업 MES")


# ──────────────────────────────────────────── 공통 헬퍼
def client_ip(req: Request):
    return req.client.host if req.client else ""


def need_login():
    return JSONResponse({"error": "로그인이 필요합니다.", "login": 1}, status_code=401)


def me_of(req: Request):
    return auth.current(req.cookies.get(auth.COOKIE))


def guard(req: Request, group, min_level):
    """로그인·권한 확인. (me, None) 통과 / (None, Response) 거부."""
    me = me_of(req)
    if not me:
        return None, need_login()
    if auth.level(me, group) < min_level:
        return None, JSONResponse({"error": "권한이 없습니다."}, status_code=403)
    return me, None


# ──────────────────────────────────────────── 인증
@app.post("/api/login")
async def api_login(req: Request):
    body = await req.json()
    token, me = auth.login(body.get("login", "").strip(), body.get("password", ""),
                           body.get("remember", True), client_ip(req))
    if not token:
        return JSONResponse({"error": "아이디 또는 비밀번호가 올바르지 않습니다."}, status_code=400)
    resp = JSONResponse({"ok": True, "me": me})
    days = 30 if body.get("remember", True) else 1
    resp.set_cookie(auth.COOKIE, token, max_age=days * 86400, httponly=True, samesite="lax")
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
    body = await req.json()
    user = db.one("SELECT * FROM users WHERE id=?", (me["id"],))
    if not db.check_password(user, body.get("old", "")):
        return JSONResponse({"error": "지금 비밀번호가 올바르지 않습니다."}, status_code=400)
    if len(body.get("new", "")) < 4:
        return JSONResponse({"error": "새 비밀번호는 4자 이상이어야 합니다."}, status_code=400)
    db.set_password(me["id"], body["new"], me["name"])
    return JSONResponse({"ok": True})


# ──────────────────────────────────────────── 메타 · 핑
@app.get("/api/meta")
async def api_meta(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    settings = {"company": db.get_setting("company")}
    return JSONResponse(meta_for(me, settings))


@app.get("/api/ping")
async def api_ping():
    return JSONResponse({"v": VERSION, "notice": None})


@app.get("/api/dashboard")
async def api_dashboard(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    return JSONResponse(dashboard.data())


# ──────────────────────────────────────────── 기준정보/이력 CRUD
@app.get("/api/t/{name}")
async def api_table_list(name: str, req: Request):
    if name not in TABLES:
        return JSONResponse({"error": "없는 표입니다."}, status_code=404)
    me, err = guard(req, TABLE_GROUP[name], 1)
    if err:
        return err
    return JSONResponse(T.list_rows(name))


@app.post("/api/t/{name}")
async def api_table_create(name: str, req: Request):
    if name not in TABLES:
        return JSONResponse({"error": "없는 표입니다."}, status_code=404)
    me, err = guard(req, TABLE_GROUP[name], 2)
    if err:
        return err
    body = await req.json()
    try:
        return JSONResponse(T.create(name, body, me["name"], client_ip(req)))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@app.put("/api/t/{name}/{rid}")
async def api_table_update(name: str, rid: int, req: Request):
    if name not in TABLES:
        return JSONResponse({"error": "없는 표입니다."}, status_code=404)
    me, err = guard(req, TABLE_GROUP[name], 2)
    if err:
        return err
    body = await req.json()
    try:
        return JSONResponse(T.update(name, rid, body, me["name"], client_ip(req)))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@app.delete("/api/t/{name}/{rid}")
async def api_table_delete(name: str, rid: int, req: Request):
    if name not in TABLES:
        return JSONResponse({"error": "없는 표입니다."}, status_code=404)
    me, err = guard(req, TABLE_GROUP[name], 3)
    if err:
        return err
    return JSONResponse(T.delete(name, rid, me["name"], client_ip(req)))


# ──────────────────────────────────────────── 엑셀
@app.post("/api/xlsx")
async def api_xlsx(req: Request):
    me = me_of(req)
    if not me:
        return need_login()
    body = await req.json()
    data = xlsx.build(body)
    fn = body.get("filename", "export.xlsx")
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=export.xlsx"})


# ──────────────────────────────────────────── 변경기록
@app.get("/api/log")
async def api_log(req: Request):
    me, err = guard(req, "시스템", 1)
    if err:
        return err
    return JSONResponse(db.rows("SELECT * FROM change_log ORDER BY id DESC LIMIT 2000"))


# ──────────────────────────────────────────── 정적 파일 (프론트)
# /css, /js 등은 StaticFiles 로, 그 외 경로는 SPA 라우팅이므로 index.html 반환
app.mount("/css", StaticFiles(directory=os.path.join(WEB_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(WEB_DIR, "js")), name="js")


@app.get("/")
async def index():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


@app.get("/{path:path}")
async def spa(path: str):
    # API 외 나머지는 프론트로 (해시 라우팅이라 보통 / 로 충분)
    full = os.path.join(WEB_DIR, path)
    if os.path.isfile(full):
        return FileResponse(full)
    idx = os.path.join(WEB_DIR, "index.html")
    if os.path.isfile(idx):
        return FileResponse(idx)
    return PlainTextResponse("web/index.html 이 없습니다. 프론트 파일을 web/ 에 복사하세요.", status_code=404)


def main():
    db.init()
    host = os.environ.get("MES_HOST", "0.0.0.0")
    port = int(os.environ.get("MES_PORT", "8000"))
    print("대흥공업 MES v%s  →  http://%s:%d" % (VERSION, host, port))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
