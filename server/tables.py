# -*- coding: utf-8 -*-
"""기준정보/이력 11개 테이블 공통 CRUD. meta.TABLES 스펙으로 타입 변환·검증."""
import db
from meta import TABLES

# 테이블 → 권한 그룹 (레벨 2 이상이어야 입력, 3이어야 삭제)
TABLE_GROUP = {
    "products": "기준정보", "molds": "기준정보", "equipment": "기준정보",
    "workers": "기준정보", "defect_codes": "기준정보", "repair_types": "기준정보",
    "production": "생산관리", "defects": "품질관리",
    "mold_maint": "금형관리", "mold_repair": "금형관리", "parts": "금형관리",
}


def _coerce(spec, values):
    """폼에서 온 문자열 값을 컬럼 타입에 맞춰 변환. 없는 키는 무시."""
    out = {}
    keys = {c["k"]: c for c in spec["cols"]}
    for k, col in keys.items():
        if k not in values:
            continue
        v = values[k]
        t = col.get("t", "text")
        if v is None or v == "":
            out[k] = None
        elif t in ("int",):
            try:
                out[k] = int(round(float(str(v).replace(",", ""))))
            except (ValueError, TypeError):
                out[k] = None
        elif t in ("num",):
            try:
                out[k] = float(str(v).replace(",", ""))
            except (ValueError, TypeError):
                out[k] = None
        elif t == "yesno":
            out[k] = 1 if v in (1, "1", True, "true", "on") else 0
        else:
            out[k] = str(v)
    return out


def _label(spec, row):
    key = spec.get("key")
    if key and row.get(key) is not None:
        return str(row[key])
    return str(row.get("id", ""))


def list_rows(name):
    if name not in TABLES:
        raise KeyError(name)
    spec = TABLES[name]
    order = spec.get("key") or "id"
    return db.rows('SELECT * FROM "%s" ORDER BY "%s"' % (name, order))


def _require(spec, data):
    for col in spec["cols"]:
        if col.get("req") and (data.get(col["k"]) is None or data.get(col["k"]) == ""):
            raise ValueError("필수 항목이 비었습니다: " + col["l"])


def create(name, values, user, ip):
    spec = TABLES[name]
    data = _coerce(spec, values)
    _require(spec, data)
    # 자연키 중복 확인
    key = spec.get("key")
    if key and data.get(key) is not None:
        if db.one('SELECT id FROM "%s" WHERE "%s"=?' % (name, key), (data[key],)):
            raise ValueError("이미 있는 %s 입니다: %s" % (spec["label"], data[key]))
    data["created"] = data["updated"] = db.now()
    data["created_by"] = data["updated_by"] = user
    cols = list(data.keys())
    sql = 'INSERT INTO "%s" (%s) VALUES (%s)' % (
        name, ",".join('"%s"' % c for c in cols), ",".join("?" * len(cols)))
    cur = db.run(sql, [data[c] for c in cols])
    rid = cur.lastrowid
    row = db.one('SELECT * FROM "%s" WHERE id=?' % name, (rid,))
    db.log(user, ip, name, "create", rid, "[%s] 등록" % _label(spec, row))
    return {"id": rid}


def update(name, rid, values, user, ip):
    spec = TABLES[name]
    old = db.one('SELECT * FROM "%s" WHERE id=?' % name, (rid,))
    if not old:
        raise ValueError("대상을 찾을 수 없습니다.")
    data = _coerce(spec, values)
    merged = dict(old)
    merged.update(data)
    _require(spec, merged)
    key = spec.get("key")
    if key and data.get(key) is not None and data[key] != old.get(key):
        if db.one('SELECT id FROM "%s" WHERE "%s"=? AND id<>?' % (name, key), (data[key], rid)):
            raise ValueError("이미 있는 %s 입니다: %s" % (spec["label"], data[key]))
    data["updated"] = db.now()
    data["updated_by"] = user
    sets = ",".join('"%s"=?' % c for c in data.keys())
    db.run('UPDATE "%s" SET %s WHERE id=?' % (name, sets), list(data.values()) + [rid])
    row = db.one('SELECT * FROM "%s" WHERE id=?' % name, (rid,))
    db.log(user, ip, name, "update", rid, "[%s] 수정" % _label(spec, row))
    return {"id": rid}


def delete(name, rid, user, ip):
    spec = TABLES[name]
    row = db.one('SELECT * FROM "%s" WHERE id=?' % name, (rid,))
    if not row:
        return {"ok": True}
    db.run('DELETE FROM "%s" WHERE id=?' % name, (rid,))
    db.log(user, ip, name, "delete", rid, "[%s] 삭제" % _label(spec, row))
    return {"ok": True}
