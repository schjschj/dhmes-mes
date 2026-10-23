# -*- coding: utf-8 -*-
"""[개선제안] 생산실적 쉽게 넣기.

Case1 작업지시 기반: 그날 작업지시서의 설비 · 제번을 생산실적 하루치 입력 화면에 미리 채움 (수량만 입력).
Case2 작업일보 스캔: 스캔 그림을 올리면 OCR(ocr.py)로 읽어 설비 · 제번 · R/L · 시간 · 작업자 칸을 채움.
     그림은 data/scans 에 보관 (이미지 확보 → 나중에 LOT · 분석 근거).
     머리글(설비 · 제번 · 주간 · 야간 · 시작 · 종료 · 작업자 …)의 가로 위치로 칸을 맞추고,
     두 배율로 읽은 결과를 합쳐 빠진 칸을 메운다. 결과는 항상 사람이 확인한 뒤 저장한다.
"""
import datetime
import json
import os
import re

import db
import ocr
import workorders

SCAN_DIR = os.path.join(db.DATA_DIR, "scans")

# 머리글 낱말 → 생산실적 열 (앞에 있는 것이 먼저 맞춰짐)
HEAD = [
    ("equip_no", ["설비", "호기", "프레스"]),
    ("code", ["제번", "품번", "제품번호", "품목"]),
    ("day_reels", ["주간", "주간R/L", "주간릴"]),
    ("night_reels", ["야간", "야간R/L", "야간릴"]),
    ("start_time", ["시작", "시작시간"]),
    ("end_time", ["종료", "종료시간"]),
    ("dt_setup", ["셋업", "금형셋업"]),
    ("dt_first", ["초품", "초품검사"]),
    ("dt_mold", ["금형수리"]),
    ("dt_equip", ["설비수리"]),
    ("dt_etc", ["기타"]),
    ("day_worker", ["작업자", "주간작업자"]),
    ("night_worker", ["야간작업자"]),
    ("coil_lot", ["코일", "LOT", "로트", "코일LOT"]),
    ("note", ["비고"]),
]
NUM_KEYS = {"day_reels", "night_reels", "dt_setup", "dt_first", "dt_mold", "dt_equip", "dt_etc"}
TIME_KEYS = {"start_time", "end_time"}


# ──────────────────────────────────────────── Case1 작업지시 기반
def from_wo(date):
    """작업지시서의 설비별 현 생산 · 교체 제번 → 하루치 입력 줄."""
    w = workorders.get(date)
    doc = w.get("doc")
    if not doc:
        raise ValueError("%s 작업지시서가 없습니다. 작업지시서를 먼저 만드세요." % date)
    prods = {p["code"].upper(): p["code"] for p in db.rows("SELECT code FROM products")}
    last_worker = {}
    for r in db.rows("SELECT equip_no, day_worker, night_worker FROM production WHERE date<? ORDER BY date, id", (date,)):
        last_worker[str(r["equip_no"])] = (r["day_worker"], r["night_worker"])
    out = []
    for side in ("left", "right"):
        for ln in doc["data"].get(side, []):
            c = ln.get("cells") or {}
            codes = []
            for k in ("cur", "code"):
                for x in workorders.CODE_RE.findall((c.get(k) or {}).get("t") or ""):
                    x = prods.get(x.upper(), x)
                    if x not in codes:
                        codes.append(x)
            stop = ((c.get("cur") or {}).get("fill") in workorders.STOP_FILLS)
            for code in codes:
                dw, nw = last_worker.get(str(ln.get("equip")), (None, None))
                out.append({"equip_no": str(ln.get("equip")), "code": code, "day_worker": dw or "", "night_worker": nw or "",
                            "_known": code.upper() in prods, "_stop": stop})
    out.sort(key=lambda r: (len(r["equip_no"]), r["equip_no"]))
    return {"date": date, "status": doc.get("status"), "rows": out}


# ──────────────────────────────────────────── Case2 작업일보 스캔
def _header(res):
    """머리글 낱말들의 가로 중심 위치 → [(key, x, y)]. 가장 많이 모인 줄을 머리글로 본다."""
    words = [w for l in res["lines"] for w in l["words"]]
    found = []
    for w in words:
        t = re.sub(r"\s", "", w["t"]).upper()
        # 똑같은 낱말 먼저, 없으면 가장 길게 맞는 앞부분 ('설비수리' 가 '설비' 로 잡히지 않게)
        hit = next((key for key, kws in HEAD if any(k.upper() == t for k in kws)), None)
        if not hit:
            cands = [(len(k), key) for key, kws in HEAD for k in kws if len(k) >= 2 and t.startswith(k.upper())]
            hit = max(cands)[1] if cands else None
        if hit:
            found.append((hit, w["x"] + w["w"] / 2.0, w["y"], w["h"]))
    if len(found) < 2:
        return [], None
    # 같은 높이(글자 높이 이내)에 가장 많이 모인 무리
    best = []
    for _, _, y, h in found:
        grp = [f for f in found if abs(f[2] - y) <= max(h, 12)]
        if len(grp) > len(best):
            best = grp
    if len(best) < 2:
        return [], None
    cols, seen = [], set()
    for key, x, y, h in sorted(best, key=lambda f: f[1]):
        if key == "day_worker" and "day_worker" in seen:
            key = "night_worker"
        if key in seen:
            continue
        seen.add(key)
        cols.append((key, x))
    return cols, max(f[2] + f[3] for f in best)


ORDER = [k for k, _ in HEAD]


def _between(cols, c):
    """읽은 머리글 사이 빈 자리 → 양식 순서(HEAD)로 그 사이에 있어야 할 머리글 후보들 ('?a|b' 꼴)."""
    left = [k for k, x in cols if x < c]
    right = [k for k, x in cols if x > c]
    i = ORDER.index(left[-1]) + 1 if left else 0
    j = ORDER.index(right[0]) if right else len(ORDER)
    seen = {k for k, _ in cols}
    cand = [k for k in ORDER[i:j] if k not in seen]
    return "?" + "|".join(cand) if cand else (left[-1] if left else right[0])


def _grid(res):
    cols, hy = _header(res)
    rows = []
    for r in ocr.rows(res):
        if hy is not None and r["y"] <= hy:
            continue
        cells = list(zip(r["cells"], r["xs"], r["ws"]))
        x = {"_y": r["y"], "_raw": r["cells"], "_seq": []}
        if cols:
            xs = [k[1] for k in cols]
            gap = min([b - a for a, b in zip(xs, xs[1:])] or [200])
            for t, cx, cw in cells:
                c = cx + cw / 2.0
                key, kx = min(cols, key=lambda k: abs(k[1] - c))
                if abs(kx - c) > gap * 0.6:       # 머리글과 멀다 → 못 읽은 머리글 칸일 수 있음
                    key = _between(cols, c)
                x["_seq"] += [(key, tok) for tok in t.split()]
        else:
            x["_cells"] = [t for t, _, _ in cells]
        rows.append(x)
    return cols, rows


class _Ref:
    def __init__(self):
        self.prods = db.rows("SELECT code, name FROM products")
        self.by_loose = {}
        for p in self.prods:
            self.by_loose.setdefault(ocr.loose(p["code"]), p["code"])
        self.eqs = {str(e["no"]) for e in db.rows("SELECT no FROM equipment")}
        self.workers = [w["name"] for w in db.rows("SELECT name FROM workers") if w["name"]]

    def code(self, s):
        if not s:
            return None
        for tok in re.split(r"\s+", s.strip()) + [s]:
            k = ocr.loose(tok)
            if k in self.by_loose:
                return self.by_loose[k]
        # 한 글자 틀린 것까지 (길이 6 이상)
        k = ocr.loose(s)
        if len(k) >= 6:
            near = [c for l, c in self.by_loose.items() if len(l) == len(k) and sum(a != b for a, b in zip(l, k)) <= 1]
            if len(near) == 1:
                return near[0]
        return None

    def equip(self, s):
        if not s:
            return None
        t = (s or "").translate(ocr._FIX)
        m = re.search(r"(\d{1,3})\s*(호기|호|#)?", t.replace("#", ""))
        if m and (not self.eqs or m.group(1).lstrip("0") in self.eqs or m.group(1) in self.eqs):
            return m.group(1).lstrip("0") or m.group(1)
        return None

    def worker(self, s):
        s = re.sub(r"\s", "", s or "")
        if not s:
            return None
        if s in self.workers:
            return s
        near = [w for w in self.workers if len(w) == len(s) and sum(a != b for a, b in zip(w, s)) <= 1]
        return near[0] if len(near) == 1 else None


def _clean_row(x, ref):
    """칸 글자 → 생산실적 값. 못 알아본 칸은 _warn 에 남김."""
    out, warn = {}, []
    if "_cells" in x:                               # 머리글을 못 찾음 → 글자 모양으로 추정
        times, nums, rest = [], [], []
        for t in x["_cells"]:
            if not out.get("equip_no") and re.search(r"호기|#", t) and ref.equip(t):
                out["equip_no"] = ref.equip(t)
            elif not out.get("code") and ref.code(t):
                out["code"] = ref.code(t)
            elif ocr.time_of(t) and (":" in t or "." in t or len(re.sub(r"\D", "", t)) == 4):
                times.append(ocr.time_of(t))
            elif ocr.num(t) is not None:
                nums.append(ocr.num(t))
            elif ref.worker(t):
                out.setdefault("day_worker", ref.worker(t))
            else:
                rest.append(t)
        if not out.get("equip_no") and nums and str(int(nums[0])) in ref.eqs and nums[0] == int(nums[0]):
            out["equip_no"] = str(int(nums.pop(0)))
        if times:
            out["start_time"] = times[0]
        if len(times) > 1:
            out["end_time"] = times[1]
        if nums:
            out["day_reels"] = nums[0]
        if len(nums) > 1:
            out["night_reels"] = nums[1]
        if rest:
            out["note"] = " ".join(rest)
        warn.append("머리글을 못 찾아 글자 모양으로 칸을 추정했습니다")
    else:
        # 시간은 칸이 어긋나도 모양으로 골라 왼쪽부터 시작 → 종료 ('종료' 머리글을 못 읽은 경우 등)
        times, vals = [], {}
        for k, tok in x["_seq"]:
            t9 = tok.translate(ocr._FIX)
            strong = ":" in tok or (k not in ("code", "coil_lot", "note") and (
                re.fullmatch(r"\d{4}", t9) or (k not in NUM_KEYS and re.fullmatch(r"\d{1,2}\.\d{2}", t9))))
            if k.startswith("?"):          # 머리글을 못 읽은 칸: 글자 모양으로 후보 중에서 고름
                cand = [c for c in k[1:].split("|") if c and not vals.get(c)]
                if ocr.time_of(tok) and strong:
                    times.append(ocr.time_of(tok))
                    continue
                if ocr.num(tok) is not None:
                    k = next((c for c in cand if c in NUM_KEYS), None)
                elif ref.worker(tok):
                    k = next((c for c in cand if c in ("day_worker", "night_worker")), None)
                else:
                    k = next((c for c in cand if c in ("coil_lot", "note")), None)
                if not k:
                    k = "note"
            elif k in ("day_worker", "night_worker") and ocr.num(tok) is not None and not ref.worker(tok):
                warn.append("작업자 칸에 숫자 '%s'" % tok)
                continue
            if ocr.time_of(tok) and (k in TIME_KEYS or strong):
                times.append(ocr.time_of(tok))
            else:
                vals[k] = (vals[k] + " " + tok) if vals.get(k) else tok
        if times:
            vals["start_time"] = times[0]
        if len(times) > 1:
            vals["end_time"] = times[-1]
        for k, v in vals.items():
            if k == "equip_no":
                out[k] = ref.equip(v)
                if not out[k]:
                    warn.append("설비 '%s'" % v)
            elif k == "code":
                out[k] = ref.code(v)
                if not out[k]:
                    out[k] = ocr.norm_code(v)
                    warn.append("제번 '%s' 없음" % v)
            elif k in NUM_KEYS:
                n = ocr.num(v)
                out[k] = n
                if n is None:
                    warn.append("%s '%s'" % (k, v))
            elif k in TIME_KEYS:
                t = ocr.time_of(v)
                out[k] = t
                if not t:
                    warn.append("시간 '%s'" % v)
            elif k in ("day_worker", "night_worker"):
                out[k] = ref.worker(v) or v.strip()
                if not ref.worker(v):
                    warn.append("작업자 '%s'" % v)
            else:
                out[k] = v.strip()
    out = {k: v for k, v in out.items() if v not in (None, "")}
    out["_raw"] = " | ".join(x.get("_raw") or [])
    out["_warn"] = warn
    out["_y"] = x.get("_y")
    return out


def _merge(a, b):
    """두 배율 결과를 합침: 설비+제번이 같거나 세로 위치가 비슷한 줄의 빈 칸을 채움."""
    used = set()
    for r in a:
        for j, s in enumerate(b):
            if j in used:
                continue
            same = (r.get("code") and r.get("code") == s.get("code") and r.get("equip_no") == s.get("equip_no")) or \
                   (r.get("_y") is not None and s.get("_y") is not None and abs(r["_y"] - s["_y"]) < 8)
            if same:
                used.add(j)
                for k, v in s.items():
                    if not k.startswith("_") and r.get(k) in (None, ""):
                        r[k] = v
                break
    return a


def parse(buf, date=None):
    ref = _Ref()
    runs = []
    for sc in (2.0, 1.5):
        res = ocr.read(buf, sc)
        cols, grid = _grid(res)
        rows = [_clean_row(x, ref) for x in grid]
        runs.append((res, cols, [r for r in rows if r.get("code") or r.get("equip_no")]))
    res, cols, rows = runs[0]
    rows = _merge(rows, runs[1][2])
    if not date:
        m = re.search(r"(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})", res["text"])
        if m:
            try:
                date = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
            except ValueError:
                date = None
    for r in rows:
        r.pop("_y", None)
        if r.get("code") and r.get("_warn") == []:
            r.pop("_warn")
    return {"date": date, "header": [c[0] for c in cols], "rows": rows, "text": res["text"]}


# ──────────────────────────────────────────── 보관
def save_scan(name, buf, date, user):
    ext = ocr.image_ext(buf)
    if not ext:
        raise ValueError("그림 파일(JPG · PNG · BMP · TIF)만 올릴 수 있습니다.")
    p = parse(buf, date or None)
    d = p["date"] or date or db.now()[:10]
    folder = os.path.join(SCAN_DIR, d[:7])
    os.makedirs(folder, exist_ok=True)
    safe = re.sub(r"[^\w.\-가-힣]", "_", os.path.splitext(name or "scan")[0])[:60]
    path = os.path.join(folder, "%s_%s%s" % (db.now().replace(":", "").replace(" ", "_").replace("-", ""), safe, ext))
    with open(path, "wb") as f:
        f.write(buf)
    cur = db.run("""INSERT INTO prod_scans(date,file_name,file_path,file_size,text,rows,status,created,created_by)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                 (d, name or os.path.basename(path), path, len(buf), p["text"], json.dumps(p["rows"], ensure_ascii=False), "읽음", db.now(), user))
    p.update({"id": cur.lastrowid, "date": d})
    return p


def list_scans(d1=None, d2=None):
    sql, args = "SELECT id,date,file_name,file_size,status,applied_at,applied_by,created,created_by FROM prod_scans WHERE 1=1", []
    if d1:
        sql += " AND date>=?"
        args.append(d1)
    if d2:
        sql += " AND date<=?"
        args.append(d2)
    return db.rows(sql + " ORDER BY date DESC, id DESC", args)


def get_scan(sid):
    r = db.one("SELECT * FROM prod_scans WHERE id=?", (sid,))
    if r:
        r["rows"] = json.loads(r["rows"] or "[]")
    return r


def mark_applied(sid, user):
    db.run("UPDATE prod_scans SET status='반영', applied_at=?, applied_by=? WHERE id=?", (db.now(), user, sid))


def delete_scan(sid):
    r = db.one("SELECT file_path FROM prod_scans WHERE id=?", (sid,))
    if r and r["file_path"]:
        try:
            os.remove(r["file_path"])
        except OSError:
            pass
    db.run("DELETE FROM prod_scans WHERE id=?", (sid,))
