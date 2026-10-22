# -*- coding: utf-8 -*-
"""원재료 — 창고 PC 원재료관리 프로그램의 DataBase.mdb 를 읽기만 한다.

PowerShell + 64비트 Access ODBC 드라이버(Microsoft Access Driver (*.mdb, *.accdb))로 표를 읽어
JSON 으로 받아 온다 (파이썬 추가 설치 없음). 창고 파일의 표·열 이름을 미리 알 수 없어서
바코드 열이 있는 표를 찾고, 열 이름으로 바코드·품번·중량·위치·입고일 등을 맞춘다.
읽은 자료는 settings 'rm_cache' 에 보관 → 창고 PC 가 꺼져 있어도 마지막 자료를 보여 줌.
"""
import base64
import datetime
import json
import os
import subprocess
import threading

import db
from common import get_json, set_json

_lock = threading.Lock()

# 화면 열 이름 → 창고 파일에서 찾을 열 이름 후보 (소문자 비교)
FIELDS = {
    "barcode": ["barcode", "bar_code", "바코드", "bcd"],
    "part_no": ["part_no", "partno", "part", "품번", "pno", "matno", "mat_no", "자재번호"],
    "material": ["material", "재질", "mtrl", "matl"],
    "spec": ["spec", "규격", "size"],
    "weight": ["weight", "중량", "wgt", "wt", "kg"],
    "lot": ["lot", "lot_no", "lotno", "로트"],
    "lctn": ["lctn", "location", "loc", "위치"],
    "isd": ["isd", "in_date", "indate", "입고일", "ipgo"],
    "mfd": ["mfd", "mfg_date", "제조일"],
    "rd": ["rd", "reg_date", "regdate", "처리일시", "update", "dt", "date"],
    "prd": ["prd", "판정", "result", "judge"],
    "state": ["state", "status", "상태", "구분", "gubun"],
    "remark": ["remark", "비고", "note", "memo"],
}

PS = r"""
$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%PATH%'))
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%DBPW%'))
$cs = "Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=$path;"
if ($pw) { $cs += "Pwd=$pw;" }
$c = New-Object System.Data.Odbc.OdbcConnection($cs)
$c.Open()
$out = @{}
$schema = $c.GetSchema('Tables')
foreach ($t in $schema.Rows) {
  if ($t.TABLE_TYPE -ne 'TABLE') { continue }
  $name = $t.TABLE_NAME
  $cmd = $c.CreateCommand(); $cmd.CommandText = "SELECT * FROM [$name]"
  $r = $cmd.ExecuteReader()
  $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
  $rows = New-Object System.Collections.ArrayList
  while ($r.Read()) {
    $row = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) {
      $v = $r.GetValue($i)
      if ($v -is [DBNull]) { $row += $null } elseif ($v -is [DateTime]) { $row += $v.ToString('yyyy-MM-dd HH:mm:ss') } else { $row += "$v" }
    }
    [void]$rows.Add($row)
  }
  $r.Close()
  $out[$name] = @{ cols = $cols; rows = $rows }
}
$c.Close()
$json = $out | ConvertTo-Json -Depth 6 -Compress
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::Out.Write($json)
"""


def _b64(s):
    return base64.b64encode((s or "").encode("utf-8")).decode()


def _cfg():
    return get_json("rm_cfg", {})


def _net_use(path, user, pw):
    if not user or not path.startswith("\\\\"):
        return
    share = "\\".join(path.split("\\")[:4])
    subprocess.run(["net", "use", share, pw or "", "/user:" + user], capture_output=True, timeout=30)


def _read_mdb(path, dbpw):
    script = PS.replace("%PATH%", _b64(path)).replace("%DBPW%", _b64(dbpw))
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                       capture_output=True, timeout=180)
    if p.returncode != 0:
        msg = p.stderr.decode("utf-8", "replace") or p.stdout.decode("utf-8", "replace")
        if "password" in msg.lower() or "암호" in msg:
            raise ValueError("파일 암호가 필요하거나 틀렸습니다.")
        if "could not find" in msg.lower() or "찾을 수 없" in msg:
            raise ValueError("창고 파일을 찾을 수 없습니다: " + path)
        raise ValueError("창고 파일을 읽지 못했습니다: " + msg.strip().splitlines()[0][:200] if msg.strip() else "알 수 없는 오류")
    return json.loads(p.stdout.decode("utf-8", "replace") or "{}")


def _map_cols(cols):
    low = [c.lower() for c in cols]
    m = {}
    for f, cands in FIELDS.items():
        for cand in cands:
            if cand in low:
                m[f] = low.index(cand)
                break
        else:
            for i, c in enumerate(low):
                if any(cand in c for cand in cands if len(cand) >= 3):
                    m.setdefault(f, i)
    return m


def _convert(tables):
    """바코드 열이 있고 행이 가장 많은 표를 입출고 기록으로 본다."""
    best = None
    for name, t in tables.items():
        m = _map_cols(t.get("cols") or [])
        if "barcode" in m and (best is None or len(t.get("rows") or []) > len(best[1].get("rows") or [])):
            best = (name, t, m)
    if not best:
        desc = "; ".join("%s(%s)" % (n, ",".join((t.get("cols") or [])[:12])) for n, t in tables.items())
        raise ValueError("바코드 열이 있는 표를 찾지 못했습니다. 표 목록: " + desc[:600])
    name, t, m = best
    hist = []
    for i, r in enumerate(t.get("rows") or []):
        if not isinstance(r, list):
            r = [r]
        x = {"seq": i + 1}
        for f, idx in m.items():
            v = r[idx] if idx < len(r) else None
            if f == "weight":
                try:
                    v = float(v) if v not in (None, "") else None
                except ValueError:
                    v = None
            x[f] = v
        hist.append(x)
    hist.sort(key=lambda x: (x.get("rd") or "", x["seq"]))
    last = {}
    for x in hist:
        if x.get("barcode"):
            last[x["barcode"]] = x
    today = datetime.date.today()
    stock = []
    for x in last.values():
        st = (x.get("state") or "").strip()
        if st and st not in ("보관", "입고", "재고", "IN", "in"):
            continue
        y = dict(x)
        try:
            y["days"] = (today - datetime.date.fromisoformat(str(x.get("isd"))[:10])).days
        except (TypeError, ValueError):
            y["days"] = None
        stock.append(y)
    hist.reverse()
    return {"table": name, "stock": stock, "hist": hist}


def refresh(force, user):
    c = _cfg()
    path = c.get("path")
    if not path:
        return {"status": "nopath"}
    cache = get_json("rm_cache", {})
    meta = cache.get("meta", {})
    try:
        mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M:%S")
    except OSError:
        _net_use(path, c.get("user"), c.get("pw"))
        try:
            mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M:%S")
        except OSError as e:
            meta["error"] = "창고 파일에 접근할 수 없습니다 (%s). 창고 PC 가 켜져 있는지, 공유폴더 권한을 확인하세요." % e.strerror
            cache["meta"] = meta
            set_json("rm_cache", cache)
            return {"status": "error"}
    if not force and meta.get("file_time") == mtime and cache.get("stock") is not None:
        return {"status": "same"}
    if not _lock.acquire(blocking=False):
        return {"status": "busy"}
    try:
        data = _convert(_read_mdb(path, c.get("dbpw")))
        cache = {"stock": data["stock"], "hist": data["hist"],
                 "meta": {"read_at": db.now(), "read_by": user, "file_time": mtime, "table": data["table"], "error": None}}
        set_json("rm_cache", cache)
        return {"status": "read", "rows": len(data["hist"])}
    except Exception as e:
        meta["error"] = str(e)
        cache["meta"] = meta
        set_json("rm_cache", cache)
        return {"status": "error", "error": str(e)}
    finally:
        _lock.release()


def data_view(is_admin):
    c = _cfg()
    cache = get_json("rm_cache", {})
    out = {"has_path": bool(c.get("path")), "meta": cache.get("meta") or {}, "stock": cache.get("stock") or []}
    if is_admin:
        out.update({"path": c.get("path") or "", "share_user": c.get("user") or "",
                    "share_pw_set": bool(c.get("pw")), "db_pw_set": bool(c.get("dbpw"))})
    return out


def history(d1=None, d2=None, barcode=None):
    hist = get_json("rm_cache", {}).get("hist") or []
    if barcode:
        return [x for x in hist if (x.get("barcode") or "") == barcode]
    out = []
    for x in hist:
        rd = str(x.get("rd") or x.get("isd") or "")[:10]
        if d1 and rd < d1:
            continue
        if d2 and rd > d2:
            continue
        out.append(x)
    return out


def set_path(b, user):
    c = _cfg()
    c["path"] = (b.get("path") or "").strip()
    c["user"] = b.get("user") or ""
    if "pw" in b:
        c["pw"] = b.get("pw") or ""
    if not c["user"]:
        c["pw"] = ""
    if b.get("dbpw"):
        c["dbpw"] = b["dbpw"]
    set_json("rm_cfg", c)
    r = refresh(True, user)
    if r.get("status") == "error":
        raise ValueError(r.get("error") or get_json("rm_cache", {}).get("meta", {}).get("error") or "읽지 못했습니다.")
    return r


def stock_by_part():
    """생산계획 원재료 탭용: 자재번호별 롤 목록."""
    out = {}
    for x in get_json("rm_cache", {}).get("stock") or []:
        out.setdefault(str(x.get("part_no") or ""), []).append(x)
    return out
