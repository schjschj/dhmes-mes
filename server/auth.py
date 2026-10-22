# -*- coding: utf-8 -*-
"""세션 쿠키 인증 + 권한 레벨. 프론트는 401 + {login:1} 을 받으면 로그인창을 띄운다."""
import json
import secrets
import datetime

import db

COOKIE = "sid"
SESSION_DAYS = 30


def _me(user):
    return {
        "id": user["id"],
        "login": user["login"],
        "name": user["name"],
        "admin": bool(user["admin"]),
        "perms": json.loads(user.get("perms") or "{}"),
        "must_change": bool(user.get("must_change")),
    }


def login(login_id, password, remember, ip):
    user = db.one("SELECT * FROM users WHERE login=? AND active=1", (login_id,))
    if not user or not db.check_password(user, password):
        return None, None
    token = secrets.token_urlsafe(24)
    days = db.SESSION_DAYS if hasattr(db, "SESSION_DAYS") else SESSION_DAYS
    days = SESSION_DAYS if remember else 1
    exp = (datetime.datetime.now() + datetime.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    db.run("INSERT INTO sessions(token,user_id,created,expires,ip) VALUES(?,?,?,?,?)",
           (token, user["id"], db.now(), exp, ip))
    return token, _me(user)


def logout(token):
    if token:
        db.run("DELETE FROM sessions WHERE token=?", (token,))


def current(token):
    """유효 세션이면 me dict, 아니면 None."""
    if not token:
        return None
    s = db.one("SELECT * FROM sessions WHERE token=?", (token,))
    if not s:
        return None
    if s["expires"] and s["expires"] < db.now():
        db.run("DELETE FROM sessions WHERE token=?", (token,))
        return None
    user = db.one("SELECT * FROM users WHERE id=? AND active=1", (s["user_id"],))
    return _me(user) if user else None


def level(me, group):
    """그룹별 권한 레벨 0(없음)/1(보기)/2(입력)/3(삭제·관리)."""
    if not me:
        return 0
    if me.get("admin") or group == "홈":
        return 3
    return me.get("perms", {}).get(group, 0)
