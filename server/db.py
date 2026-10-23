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
    # [개선] 작업일보 스캔 (OCR)
    """CREATE TABLE IF NOT EXISTS prod_scans(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, file_name TEXT, file_path TEXT, file_size INTEGER,
        text TEXT, rows TEXT, status TEXT, applied_at TEXT, applied_by TEXT, created TEXT, created_by TEXT)""",
    # [개선] 현장 태블릿 입력 (작업 시작 · 비가동 · 종료)
    """CREATE TABLE IF NOT EXISTS floor_runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, equip_no TEXT, code TEXT, worker TEXT,
        start_ts TEXT, end_ts TEXT, downs TEXT, day_reels REAL, night_reels REAL, reels REAL, coil_lot TEXT,
        note TEXT, error TEXT, status TEXT,
        production_id INTEGER, created TEXT, created_by TEXT, updated TEXT, updated_by TEXT)""",
    # [개선] 금형 이동 (현황판) · 사진 · 도면
    """CREATE TABLE IF NOT EXISTS mold_moves(
        id INTEGER PRIMARY KEY AUTOINCREMENT, mold_no TEXT, ts TEXT, state TEXT, place TEXT,
        from_state TEXT, from_place TEXT, worker TEXT, note TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS mold_files(
        id INTEGER PRIMARY KEY AUTOINCREMENT, mold_no TEXT, kind TEXT, title TEXT, rev TEXT, rev_date TEXT,
        file_name TEXT, file_path TEXT, file_size INTEGER, current INTEGER DEFAULT 1, note TEXT,
        created TEXT, created_by TEXT)""",
    # [개선] 거래명세서 자동 입력
    """CREATE TABLE IF NOT EXISTS invoices(
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, supplier TEXT, doc_no TEXT, total INTEGER,
        file_name TEXT, file_path TEXT, src TEXT, note TEXT, created TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS invoice_items(
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, seq INTEGER, target TEXT, item TEXT, spec TEXT,
        material TEXT, qty REAL, unit TEXT, unit_price REAL, amount REAL, part_id INTEGER, lot_no TEXT, mat_code TEXT,
        weight REAL, ref_id INTEGER, note TEXT)""",
    # [구매관리] 모바일 명세서 촬영 (dhmes-receipt 앱과 같은 구조): 촬영 → 분석 → 검수 → MES 등록
    """CREATE TABLE IF NOT EXISTS rc_jobs(
        id TEXT PRIMARY KEY, worker_id TEXT, worker_name TEXT, image_id TEXT, original_size_kb REAL, compressed_size_kb REAL,
        status TEXT, created_at TEXT, completed_at TEXT, data_json TEXT, mes_inbound_no TEXT, error_message TEXT,
        engine TEXT, created_by TEXT)""",
    """CREATE TABLE IF NOT EXISTS rc_workers(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT)""",
]

# 이미 만든 테이블에 나중에 생긴 컬럼 (ALTER 로 보충)
EXTRA_COLS = {
    "users": [("note", "TEXT"), ("last_login", "TEXT")],
    "parts_tx": [("after_qty", "INTEGER"), ("price", "REAL"), ("supplier", "TEXT"), ("invoice_id", "INTEGER")],
    # [연동] 거래명세서 앱(dhmes-receipt) → kind: 금형부품/일반, status: 입고 완료/확인 필요/등록
    "invoices": [("kind", "TEXT"), ("status", "TEXT"), ("ext_id", "TEXT"), ("supplier_biz", "TEXT"), ("supply", "INTEGER"),
                 ("vat", "INTEGER"), ("receiver", "TEXT"), ("worker", "TEXT"), ("raw", "TEXT")],
    "invoice_items": [("mold_no", "TEXT"), ("part_code", "TEXT"), ("match", "TEXT"), ("tax", "REAL"), ("cands", "TEXT")],
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


def _legacy_ok(stored, pw):
    """원본 MES 형식 'pbkdf2$salt$hash' (반복 횟수 · salt 인코딩을 몰라서 흔한 값을 차례로 맞춰 봄)."""
    import hmac
    try:
        _, salt, want = stored.split("$")
    except ValueError:
        return False
    salts = [salt.encode("utf-8")]
    try:
        salts.append(bytes.fromhex(salt))
    except ValueError:
        pass
    for it in (100000, 120000, 200000, 260000, 150000, 310000, 390000, 600000, 50000, 10000, 1000):
        for s in salts:
            for algo in ("sha256", "sha512", "sha1"):
                h = hashlib.pbkdf2_hmac(algo, pw.encode("utf-8"), s, it)
                if hmac.compare_digest(h.hex()[:len(want)], want):
                    return True
    return False


def check_password(user, pw):
    if not user:
        return False
    stored = user.get("pw_hash") or ""
    if stored.startswith("pbkdf2$"):
        if not _legacy_ok(stored, pw):
            return False
        # 원본에서 옮긴 비밀번호 → 맞으면 새 형식으로 바꿔 둠 (must_change 는 그대로)
        salt = secrets.token_hex(8)
        run("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?", (_hash(pw, salt), salt, user["id"]))
        return True
    return stored == _hash(pw, user.get("pw_salt", ""))


def set_password(user_id, pw, by=""):
    salt = secrets.token_hex(8)
    run("UPDATE users SET pw_hash=?,pw_salt=?,must_change=0,updated=?,updated_by=? WHERE id=?",
        (_hash(pw, salt), salt, now(), by, user_id))


# ──────────────────────────────────────────── 변경 기록
def log(user, ip, tbl, action, row_id, summary):
    run("INSERT INTO change_log(ts,user,ip,tbl,action,row_id,summary) VALUES(?,?,?,?,?,?,?)",
        (now(), user, ip, tbl, action, str(row_id), summary))
