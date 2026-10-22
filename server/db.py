# -*- coding: utf-8 -*-
"""SQLite 데이터 계층. 기준정보 11개 테이블은 meta.TABLES 스펙에서 자동 생성한다."""
import os
import sqlite3
import threading
import hashlib
import secrets
import datetime

from meta import TABLES, COMPANY

DATA_DIR = os.environ.get("MES_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "mes.db")

_local = threading.local()

# meta 타입 → SQLite 저장형
_AFFINITY = {"int": "INTEGER", "num": "REAL", "yesno": "INTEGER"}


def _affinity(t):
    return _AFFINITY.get(t, "TEXT")


def conn():
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=30000")
        _local.conn = c
    return c


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def rows(sql, args=()):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def one(sql, args=()):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    cur = conn().execute(sql, args)
    conn().commit()
    return cur


# ──────────────────────────────────────────── 스키마
# meta 스펙 테이블 외에 직접 정의하는 고정 테이블
FIXED_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL,
        name TEXT,
        pw_hash TEXT,
        pw_salt TEXT,
        admin INTEGER DEFAULT 0,
        perms TEXT DEFAULT '{}',
        active INTEGER DEFAULT 1,
        must_change INTEGER DEFAULT 1,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY,
        user_id INTEGER,
        created TEXT,
        expires TEXT,
        ip TEXT)""",
    """CREATE TABLE IF NOT EXISTS change_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT, user TEXT, ip TEXT,
        tbl TEXT, action TEXT, row_id TEXT, summary TEXT)""",
    """CREATE TABLE IF NOT EXISTS settings(
        k TEXT PRIMARY KEY, v TEXT)""",
    # 금형부품 입출고
    """CREATE TABLE IF NOT EXISTS parts_tx(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_id INTEGER, date TEXT, kind TEXT, qty INTEGER,
        reason TEXT, mold_no TEXT, worker TEXT, note TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    # [개선] 원재료 코일 LOT 추적
    """CREATE TABLE IF NOT EXISTS rawmat_lots(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_no TEXT UNIQUE, mat_code TEXT, mat_desc TEXT,
        maker TEXT, spec TEXT, thickness REAL, width REAL,
        in_date TEXT, in_weight REAL, remain_weight REAL,
        cert_no TEXT, status TEXT DEFAULT '입고',
        note TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    # 대시보드 한줄 메모
    """CREATE TABLE IF NOT EXISTS memos(
        id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, user_id INTEGER,
        created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS memo_comments(
        id INTEGER PRIMARY KEY AUTOINCREMENT, memo_id INTEGER, text TEXT, user_id INTEGER,
        created TEXT, created_by TEXT)""",
    # 작업지시서 (하루 한 장, 양식 내용은 JSON)
    """CREATE TABLE IF NOT EXISTS work_orders(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE, data TEXT, version INTEGER DEFAULT 1,
        status TEXT DEFAULT '작성', written_by TEXT, written_at TEXT,
        reviewed_by TEXT, reviewed_at TEXT, approved_by TEXT, approved_at TEXT, draft TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    # 납기 · 생산계획
    """CREATE TABLE IF NOT EXISTS plan_uploads(
        id INTEGER PRIMARY KEY AUTOINCREMENT, file_date TEXT, file_time TEXT, name TEXT, rows TEXT,
        created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS plan_families(
        fam TEXT PRIMARY KEY, main_eq INTEGER, alts TEXT, rate_d REAL, rate_n REAL, locked INTEGER DEFAULT 0,
        note TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS plan_overrides(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, k1 TEXT, k2 TEXT, val TEXT, via TEXT,
        created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS plan_incoming(
        id INTEGER PRIMARY KEY AUTOINCREMENT, part_no TEXT, kg REAL, date TEXT, memo TEXT, done INTEGER DEFAULT 0,
        created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS plan_rules(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, eq INTEGER, fam TEXT, fam2 TEXT, text TEXT, source TEXT,
        evidence TEXT, active INTEGER DEFAULT 1, pending INTEGER DEFAULT 0, created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS plan_ai(
        user_id INTEGER PRIMARY KEY, history TEXT, updated TEXT)""",
    # 근태
    """CREATE TABLE IF NOT EXISTS att_emps(
        id TEXT PRIMARY KEY, name TEXT, dept TEXT, rank TEXT, hireDate TEXT, quitDate TEXT, memo TEXT,
        foreign_ INTEGER DEFAULT 0, ord INTEGER, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS att_months(
        ym TEXT PRIMARY KEY, roster TEXT, records TEXT, updated TEXT)""",
    # 출하
    """CREATE TABLE IF NOT EXISTS ship_tx(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, code TEXT, reels REAL, dest TEXT,
        ship_date TEXT, ship_time TEXT, memo TEXT, quick INTEGER DEFAULT 0, hold_id INTEGER, batch_id INTEGER,
        created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS ship_holds(
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, reels REAL, reason TEXT, dest TEXT, hold_date TEXT,
        memo TEXT, batch_id INTEGER, created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS ship_batches(
        id INTEGER PRIMARY KEY AUTOINCREMENT, dest TEXT, ship_date TEXT, memo TEXT, created TEXT, created_by TEXT)""",
    # [개선] 품질관리
    """CREATE TABLE IF NOT EXISTS q_incoming(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, lot_no TEXT, mat_code TEXT, maker TEXT, spec TEXT,
        weight REAL, thick_std REAL, thick_meas REAL, width_std REAL, width_meas REAL,
        appearance TEXT, packing TEXT, cert_no TEXT, result TEXT, inspector TEXT, note TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS q_inproc(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, equip_no TEXT, code TEXT, lot_no TEXT, stage TEXT,
        reason TEXT, items TEXT, result TEXT, inspector TEXT, approved_by TEXT, approved_at TEXT, note TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS q_claims(
        id INTEGER PRIMARY KEY AUTOINCREMENT, claim_no TEXT, date TEXT, customer TEXT, code TEXT, lot_no TEXT,
        type TEXT, qty INTEGER, cost INTEGER, content TEXT,
        d1_team TEXT, d2_problem TEXT, d3_contain TEXT, d4_cause TEXT, d5_action TEXT, d6_verify TEXT,
        d7_prevent TEXT, d8_close TEXT, status TEXT, due TEXT, closed TEXT, owner TEXT, note TEXT,
        created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS q_gauges(
        id INTEGER PRIMARY KEY AUTOINCREMENT, gauge_no TEXT UNIQUE, name TEXT, spec TEXT, maker TEXT, serial TEXT,
        location TEXT, owner TEXT, cal_cycle INTEGER, check_cycle INTEGER, last_cal TEXT, last_check TEXT,
        status TEXT, note TEXT, created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS q_gauge_hist(
        id INTEGER PRIMARY KEY AUTOINCREMENT, gauge_id INTEGER, date TEXT, kind TEXT, result TEXT, agency TEXT,
        cert_no TEXT, cost INTEGER, worker TEXT, note TEXT, created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS q_docs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, code TEXT, title TEXT, rev TEXT, rev_date TEXT,
        file_name TEXT, file_path TEXT, file_size INTEGER, current INTEGER DEFAULT 1, note TEXT,
        created TEXT, created_by TEXT)""",
]

# 이미 만든 테이블에 나중에 생긴 컬럼 (ALTER 로 보충)
EXTRA_COLS = {
    "users": [("note", "TEXT"), ("last_login", "TEXT")],
    "parts_tx": [("after_qty", "INTEGER")],
}


def _ensure_spec_table(name, spec):
    """meta.TABLES 한 개를 실제 테이블로 만들고, 스펙에 생긴 새 컬럼은 ALTER 로 추가."""
    cols_sql = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
    for col in spec["cols"]:
        cols_sql.append('"%s" %s' % (col["k"], _affinity(col.get("t", "text"))))
    for a in ("created", "created_by", "updated", "updated_by"):
        cols_sql.append('"%s" TEXT' % a)
    run('CREATE TABLE IF NOT EXISTS "%s" (%s)' % (name, ", ".join(cols_sql)))
    # 자연키 유니크 인덱스
    key = spec.get("key")
    if key:
        run('CREATE UNIQUE INDEX IF NOT EXISTS "ux_%s_%s" ON "%s"("%s")' % (name, key, name, key))
    # 누락 컬럼 보충 (스펙이 늘어났을 때)
    have = {r["name"] for r in rows('PRAGMA table_info("%s")' % name)}
    for col in spec["cols"]:
        if col["k"] not in have:
            run('ALTER TABLE "%s" ADD COLUMN "%s" %s' % (name, col["k"], _affinity(col.get("t", "text"))))


def init():
    for sql in FIXED_SCHEMA:
        run(sql)
    for name, spec in TABLES.items():
        _ensure_spec_table(name, spec)
    for name, cols in EXTRA_COLS.items():
        have = {r["name"] for r in rows('PRAGMA table_info("%s")' % name)}
        for col, typ in cols:
            if col not in have:
                run('ALTER TABLE "%s" ADD COLUMN "%s" %s' % (name, col, typ))
    # 기본 설정
    if get_setting("company") is None:
        set_setting("company", COMPANY)
    # 최초 관리자 계정
    if not one("SELECT id FROM users LIMIT 1"):
        create_user("admin", "관리자", "1234", admin=1, by="system", must_change=1)
        log("system", "-", "users", "seed", "admin", "최초 관리자 계정 생성 (초기 비밀번호 1234)")


# ──────────────────────────────────────────── 설정
def get_setting(k, default=None):
    r = one("SELECT v FROM settings WHERE k=?", (k,))
    return r["v"] if r else default


def set_setting(k, v):
    run("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))


# ──────────────────────────────────────────── 사용자 · 비밀번호
def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode("utf-8"), 120000).hex()


def create_user(login, name, pw, admin=0, perms=None, by="", must_change=1):
    import json
    salt = secrets.token_hex(8)
    run("""INSERT INTO users(login,name,pw_hash,pw_salt,admin,perms,active,must_change,created,created_by)
           VALUES(?,?,?,?,?,?,1,?,?,?)""",
        (login, name, _hash(pw, salt), salt, admin, json.dumps(perms or {}), must_change, now(), by))
    return one("SELECT * FROM users WHERE login=?", (login,))


def check_password(user, pw):
    return user and user.get("pw_hash") == _hash(pw, user.get("pw_salt", ""))


def set_password(user_id, pw, by=""):
    salt = secrets.token_hex(8)
    run("UPDATE users SET pw_hash=?,pw_salt=?,must_change=0,updated=?,updated_by=? WHERE id=?",
        (_hash(pw, salt), salt, now(), by, user_id))


# ──────────────────────────────────────────── 변경 기록
def log(user, ip, tbl, action, row_id, summary):
    run("INSERT INTO change_log(ts,user,ip,tbl,action,row_id,summary) VALUES(?,?,?,?,?,?,?)",
        (now(), user, ip, tbl, action, str(row_id), summary))
