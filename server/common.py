# -*- coding: utf-8 -*-
"""라우터들이 같이 쓰는 요청 헬퍼 (로그인·권한·오류 응답)."""
import json

from fastapi import Request
from fastapi.responses import JSONResponse

import auth
import db


def client_ip(req: Request):
    return req.client.host if req.client else ""


def need_login():
    return JSONResponse({"error": "로그인이 필요합니다.", "login": 1}, status_code=401)


def me_of(req: Request):
    return auth.current(req.cookies.get(auth.COOKIE))


def level(me, group):
    """메뉴 배치로 다른 대목록에 옮긴 메뉴도 그 대목록 권한으로 쓸 수 있게."""
    import meta
    return max(auth.level(me, g) for g in meta.groups_holding(get_json("menu_layout", None), group))


def guard(req: Request, group, min_level):
    """로그인·권한 확인. (me, None) 통과 / (None, Response) 거부."""
    me = me_of(req)
    if not me:
        return None, need_login()
    if level(me, group) < min_level:
        return None, JSONResponse({"error": "권한이 없습니다."}, status_code=403)
    return me, None


def admin_only(req: Request):
    me = me_of(req)
    if not me:
        return None, need_login()
    if not me.get("admin"):
        return None, JSONResponse({"error": "관리자만 할 수 있습니다."}, status_code=403)
    return me, None


def bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def ok(data=None):
    return JSONResponse({"ok": True} if data is None else data)


async def body(req: Request):
    try:
        return await req.json()
    except Exception:
        return {}


# ── 설정값(JSON) 저장
def get_json(key, default):
    v = db.get_setting(key)
    if v is None:
        return default
    try:
        return json.loads(v)
    except ValueError:
        return default


def set_json(key, value):
    db.set_setting(key, json.dumps(value, ensure_ascii=False))
