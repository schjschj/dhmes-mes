# -*- coding: utf-8 -*-
"""[구매관리] 모바일 거래명세서 촬영 — dhmes-receipt 앱과 같은 구조 · 화면을 MES 안에서 그대로 돌린다.

휴대폰 /m/receipt/ (web/m_receipt/ = 앱의 static 그대로) → 같은 API(/api/v1/...):
  1. 작업자 선택 (rc_workers)
  2. 촬영 즉시 업로드: EXIF 회전 · 1600px JPEG 압축 보관 + 썸네일 → rc_jobs 'processing'
  3. 백그라운드 분석: Gemini 비전 (연동 설정에 키가 있으면) / 없으면 Windows OCR (invoice._from_image)
     → ReceiptData(앱과 같은 JSON) 로 'completed' (검수 대기) / 'failed'
  4. 휴대폰에서 검수 · 수정 → [MES에 등록] = receipts.inbound (금형부품 업체 자동 입고 / 일반 명세서) → 'registered'
     같은 거래일자 + 합계금액이 이미 등록돼 있으면 409 (강제 등록 가능)
"""
import io
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

import db
import receipts

log = logging.getLogger("mes.rcmobile")
STORE = os.path.join(db.DATA_DIR, "invoices", "mobile")
THUMBS = os.path.join(STORE, "thumbs")


# ──────────────────────────────────────────── 데이터 형식 (앱 models.py 와 같음)
class SupplierInfo(BaseModel):
    company_name: str = Field(..., description="공급자 상호 (예: 다온하이텍, 부원산업)")
    biz_no: Optional[str] = Field(None, description="사업자등록번호 (xxx-xx-xxxxx)")
    representative: Optional[str] = Field(None, description="대표자 성명")
    tel: Optional[str] = Field(None, description="전화번호")
    address: Optional[str] = Field(None, description="사업장 주소")


class BuyerInfo(BaseModel):
    company_name: Optional[str] = Field("대흥공업", description="공급받는자 상호")
    biz_no: Optional[str] = Field("139-10-79181", description="공급받는자 사업자등록번호")
    receiver_name: Optional[str] = Field(None, description="인수자 서명 또는 성명 (예: 심재우)")


class AmountSummary(BaseModel):
    supply_amount: Optional[int] = Field(0, description="공급가액 합계")
    vat_amount: Optional[int] = Field(0, description="세액 합계")
    total_amount: int = Field(..., description="총 합계금액")


class ReceiptItem(BaseModel):
    item_no: Optional[int] = Field(None, description="순번")
    item_name: str = Field(..., description="품목명 또는 부품명")
    specification: Optional[str] = Field(None, description="규격/품번/재질 등 상세 사양")
    unit: Optional[str] = Field(None, description="단위 (EA, 박스, 캔, 1CUT 등)")
    quantity: float = Field(..., description="수량")
    unit_price: Optional[int] = Field(None, description="단가")
    amount: int = Field(..., description="공급금액")
    tax: Optional[int] = Field(None, description="세액")
    remarks: Optional[str] = Field(None, description="비고 / 발주번호 / 수주번호")


class ReceiptHeader(BaseModel):
    invoice_date: str = Field(..., description="거래일자 (YYYY-MM-DD)")
    invoice_number: Optional[str] = Field(None, description="명세서 일련번호 또는 전표번호")
    supplier: SupplierInfo
    buyer: BuyerInfo = Field(default_factory=BuyerInfo)
    summary: AmountSummary


class ReceiptData(BaseModel):
    header: ReceiptHeader
    items: List[ReceiptItem] = Field(default_factory=list)
    image_id: Optional[str] = None
    image_url: Optional[str] = None
    worker_id: Optional[str] = None
    confidence_notes: Optional[str] = Field(None, description="인식 특이사항 (수기 여부, 훼손/인식 주의점 등)")


PROMPT = """
당신은 한국 제조업 공장에서 부품, 소모품 구매 거래명세서(거래명세표)를 정확하게 판독하여 MES 시스템용 정형 데이터로 변환하는 최고 전문가입니다.

[분석 지침]
1. 공급자와 공급받는자 구분:
   - 대다수 명세서에서 공급받는자(구매자)는 '대흥공업'(사업자등록번호 139-10-79181)입니다.
   - 다른 한쪽이 공급자(판매업체)입니다. 상호명, 사업자등록번호, 대표자명, 전화번호를 추출하세요.
   - 공급자란에 고무인(도장)이 찍혀 있는 경우 고무인 내부의 상호, 사업자번호, 주소 정보를 해독하세요.
2. 회전된 이미지 처리:
   - 사진이 90도 또는 180도 회전되어 있더라도 텍스트의 방향을 인식하여 정상 판독하세요.
3. 수기(손글씨) 명세서 처리:
   - 펜으로 직접 작성된 한글/영문/숫자 필기체를 정밀하게 인식하세요.
   - 빈칸에 그어진 사선, 'Z' 표시 또는 '이하 여백' 표시는 품목이 없음을 의미하므로 무시하세요.
4. 품목 리스트 정규화:
   - 명세서의 각 품목 행(Row)을 개별 아이템으로 추출하세요.
   - 품목명(item_name), 규격/사양(specification), 단위(unit), 수량(quantity), 단가(unit_price), 공급금액(amount), 세액(tax), 비고(remarks/발주번호/수주번호)를 분리하세요.
   - 금형부품 명세서(품목이 '10664 (H)' 같은 금형번호)는 'NO' 칸의 부품번호(예: 166, P23-3)를 specification 에 넣으세요.
5. 금액 및 날짜 정규화:
   - 모든 금액 숫자는 콤마(,)와 원(₩) 기호를 제거한 정수(integer)로 변환하세요.
   - 날짜는 반드시 'YYYY-MM-DD' 형식으로 변환하세요 (예: 2026년 10월 12일 -> 2026-10-12, 2026/09/29 -> 2026-09-29).
6. 인수자(인수인):
   - 우측 하단이나 비고란의 '인수자', '인수인' 서명란에 적힌 이름이나 표기를 가능한 범위에서 추출하세요.
"""


# ──────────────────────────────────────────── 작업자
def workers(me_name=None):
    rs = db.rows("SELECT id, name FROM rc_workers ORDER BY id")
    if not rs and me_name:
        add_worker(me_name)
        rs = db.rows("SELECT id, name FROM rc_workers ORDER BY id")
    return rs


def add_worker(name):
    name = (name or "").strip()
    if not name:
        raise ValueError("작업자 이름을 입력해주세요.")
    wid = "W%s_%s" % (datetime.now().strftime("%m%d%H%M%S"), uuid.uuid4().hex[:4].upper())
    db.run("INSERT INTO rc_workers(id,name,created_at) VALUES(?,?,?)", (wid, name, db.now()))
    return {"id": wid, "name": name}


def delete_worker(wid):
    db.run("DELETE FROM rc_workers WHERE id=?", (wid,))


# ──────────────────────────────────────────── 사진 보관 (앱 preprocessor 와 같음)
def _compress(buf):
    from PIL import Image, ImageOps
    img = Image.open(io.BytesIO(buf))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode != "RGB":
        img = img.convert("RGB")
    big = img.copy()                       # 분석용 (OCR 은 해상도가 높을수록 잘 읽음)
    if max(big.size) > 2400:
        k = 2400 / max(big.size)
        big = big.resize((int(big.size[0] * k), int(big.size[1] * k)), Image.Resampling.LANCZOS)
    if max(img.size) > 1600:
        k = 1600 / max(img.size)
        img = img.resize((int(img.size[0] * k), int(img.size[1] * k)), Image.Resampling.LANCZOS)
    image_id = "%s_%s" % (datetime.now().strftime("%Y%m%d_%H%M%S"), uuid.uuid4().hex[:8])
    os.makedirs(THUMBS, exist_ok=True)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=72, optimize=True, progressive=True)
    with open(os.path.join(STORE, image_id + ".jpg"), "wb") as f:
        f.write(out.getvalue())
    th = img.copy()
    th.thumbnail((300, 300), Image.Resampling.BILINEAR)
    th.save(os.path.join(THUMBS, image_id + "_thumb.jpg"), format="JPEG", quality=60, optimize=True)
    ab = io.BytesIO()
    big.save(ab, format="JPEG", quality=88)
    return image_id, round(len(buf) / 1024.0, 1), round(len(out.getvalue()) / 1024.0, 1), ab.getvalue()


def image_path(image_id, thumb=False):
    image_id = os.path.basename(image_id or "")
    p = os.path.join(THUMBS, image_id + "_thumb.jpg") if thumb else os.path.join(STORE, image_id + ".jpg")
    if thumb and not os.path.isfile(p):
        p = os.path.join(STORE, image_id + ".jpg")
    return p if os.path.isfile(p) else None


# ──────────────────────────────────────────── 분석
def _gemini_cfg():
    c = receipts.cfg()
    return (c.get("gemini_key") or os.environ.get("GEMINI_API_KEY") or "").strip(), \
        (c.get("gemini_model") or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()


def _by_gemini(buf, key, model):
    from google import genai
    from google.genai import types
    from PIL import Image
    client = genai.Client(api_key=key)
    last = None
    for attempt in range(1, 4):
        try:
            r = client.models.generate_content(
                model=model,
                contents=[Image.open(io.BytesIO(buf)),
                          "이 거래명세서 이미지에서 거래일자, 공급업체 정보, 품목별 상세 내역(품명, 규격, 수량, 단가, 공급가액), 합계금액, 인수자를 빠짐없이 추출하여 지정된 스키마로 반환해주세요."],
                config=types.GenerateContentConfig(system_instruction=PROMPT, response_mime_type="application/json",
                                                   response_schema=ReceiptData, temperature=0.1))
            return ReceiptData(**json.loads(r.text)).model_dump()
        except Exception as e:          # 일시적 503 · 429 는 다시 시도
            last = e
            if any(s in str(e) for s in ("503", "UNAVAILABLE", "429")):
                time.sleep(attempt * 3)
                continue
            raise
    raise last


def _by_ocr(buf):
    """Windows OCR (AI 없음) → 앱과 같은 ReceiptData 형식."""
    import invoice
    text, cells, items, _ = invoice._from_image(buf)
    out = []
    for i, x in enumerate(items):
        qty, up, amt = x.get("qty"), x.get("unit_price"), x.get("amount")
        if amt is None and qty and up:
            amt = qty * up
        if up is None and qty and amt:
            up = amt / qty
        out.append({"item_no": i + 1, "item_name": x.get("item") or "", "specification": x.get("code") or x.get("spec") or None,
                    "unit": x.get("unit"), "quantity": qty or 0, "unit_price": int(round(up)) if up else None,
                    "amount": int(round(amt or 0)), "tax": int(round(x["tax"])) if x.get("tax") else None, "remarks": x.get("note")})
    supply = sum(i["amount"] for i in out)
    bizs = ["%s-%s-%s" % g for g in re.findall(r"(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})", text or "") if "%s-%s-%s" % g != "139-10-79181"]
    return {"header": {"invoice_date": invoice._date_of(text) or db.now()[:10], "invoice_number": None,
                       "supplier": {"company_name": invoice._supplier_from(cells) or "", "biz_no": bizs[0] if bizs else None},
                       "buyer": {"company_name": "대흥공업", "biz_no": "139-10-79181", "receiver_name": None},
                       "summary": {"supply_amount": supply, "vat_amount": 0, "total_amount": supply}},
            "items": out,
            "confidence_notes": "Windows OCR 로 읽음 (AI 없음) — 손글씨 · 흐린 글자는 틀릴 수 있으니 반드시 확인하세요." +
                                ("" if out else " 품목을 읽지 못했습니다. [수정]에서 직접 넣으세요.")}


def _analyze(job_id, buf, image_id):
    try:
        key, model = _gemini_cfg()
        engine, note = "OCR", ""
        if key:
            try:
                data, engine = _by_gemini(buf, key, model), "Gemini"
            except Exception as e:
                log.warning("Gemini 분석 실패 → OCR 로 대신: %s", e)
                note = "Gemini 분석 실패(%s) → " % str(e)[:80]
                data = _by_ocr(buf)
        else:
            data = _by_ocr(buf)
        if note:
            data["confidence_notes"] = note + (data.get("confidence_notes") or "")
        data["image_id"] = image_id
        data["image_url"] = "/api/v1/receipts/images/%s" % image_id
        db.run("UPDATE rc_jobs SET status='completed', completed_at=?, data_json=?, error_message=NULL, engine=? WHERE id=?",
               (db.now(), json.dumps(data, ensure_ascii=False), engine, job_id))
    except Exception as e:
        log.exception("명세서 분석 실패 %s", job_id)
        db.run("UPDATE rc_jobs SET status='failed', completed_at=?, error_message=? WHERE id=?", (db.now(), str(e)[:500], job_id))


def upload(buf, filename, content_type, worker_id, worker_name, user):
    if not (content_type or "").startswith("image/"):
        raise ValueError("이미지 파일만 업로드 가능합니다.")
    if not buf:
        raise ValueError("파일이 비었습니다.")
    image_id, okb, ckb, abuf = _compress(buf)
    rid = "REC-%s-%s" % (datetime.now().strftime("%m%d"), uuid.uuid4().hex[:6].upper())
    db.run("""INSERT INTO rc_jobs(id,worker_id,worker_name,image_id,original_size_kb,compressed_size_kb,status,created_at,created_by)
              VALUES(?,?,?,?,?,?,'processing',?,?)""", (rid, worker_id, worker_name, image_id, okb, ckb, db.now(), user))
    threading.Thread(target=_analyze, args=(rid, abuf, image_id), daemon=True).start()
    return {"success": True, "receipt_id": rid,
            "image_url": "/api/v1/receipts/images/%s" % image_id, "thumb_url": "/api/v1/receipts/thumbnails/%s" % image_id,
            "original_size_kb": okb, "compressed_size_kb": ckb, "saved_ratio": round((1 - ckb / max(okb, 1)) * 100, 1),
            "message": "사진 업로드 완료! 서버에서 자동으로 분석 중입니다."}


# ──────────────────────────────────────────── 목록 · 수정 · 삭제
def _job(r):
    r["data"] = json.loads(r["data_json"]) if r.get("data_json") else None
    r["image_url"] = "/api/v1/receipts/images/%s" % r["image_id"]
    r["thumb_url"] = "/api/v1/receipts/thumbnails/%s" % r["image_id"]
    return r


def jobs(limit=100):
    return [_job(r) for r in db.rows("SELECT * FROM rc_jobs ORDER BY created_at DESC LIMIT ?", (limit,))]


def job(rid):
    r = db.one("SELECT * FROM rc_jobs WHERE id=?", (rid,))
    return _job(r) if r else None


def update(rid, data):
    if not job(rid):
        raise LookupError("해당 명세서를 찾을 수 없습니다.")
    db.run("UPDATE rc_jobs SET data_json=? WHERE id=?", (json.dumps(data, ensure_ascii=False), rid))
    return {"success": True, "message": "데이터가 수정되었습니다."}


def delete(rid):
    j = job(rid)
    if not j:
        return {"success": True, "message": "명세서가 삭제되었습니다."}
    db.run("DELETE FROM rc_jobs WHERE id=?", (rid,))
    if j["status"] != "registered":          # MES 에 등록된 명세서는 사진을 MES 명세서가 계속 씀
        for p in (image_path(j["image_id"]), os.path.join(THUMBS, j["image_id"] + "_thumb.jpg")):
            try:
                if p:
                    os.remove(p)
            except OSError:
                pass
    return {"success": True, "message": "명세서가 삭제되었습니다."}


# ──────────────────────────────────────────── MES 등록 (중복 방지)
def _dup(date, total, exclude):
    for r in db.rows("SELECT id, mes_inbound_no, data_json FROM rc_jobs WHERE status='registered' AND id<>?", (exclude,)):
        try:
            h = json.loads(r["data_json"] or "{}").get("header") or {}
            if h.get("invoice_date") == date and int((h.get("summary") or {}).get("total_amount") or 0) == int(total):
                return {"existing_inbound_no": r["mes_inbound_no"], "supplier_name": (h.get("supplier") or {}).get("company_name") or "미상",
                        "invoice_date": date, "total_amount": int(total)}
        except (ValueError, TypeError):
            continue
    return None


def confirm(rid, payload, force, user, ip):
    """→ (상태 코드, 결과)"""
    j = job(rid)
    if not j:
        return 404, {"detail": "해당 명세서를 찾을 수 없습니다."}
    data = payload or j["data"]
    if not data:
        return 400, {"detail": "분석된 명세서 데이터가 없습니다."}
    h = data.get("header") or {}
    total = (h.get("summary") or {}).get("total_amount")
    if not force and h.get("invoice_date") and total:
        d = _dup(h["invoice_date"], total, rid)
        if d:
            return 409, dict(d, success=False, duplicate=True,
                             message="동일한 거래일자(%s)와 동일한 금액(%s원)으로 이미 MES에 등록된 전표가 존재합니다. (기존 전표번호: %s, 공급처: %s)" % (
                                 d["invoice_date"], format(d["total_amount"], ","), d["existing_inbound_no"], d["supplier_name"]))
    try:
        ReceiptData(**data)
    except Exception as e:
        return 400, {"detail": "명세서 내용을 확인하세요 (품명 · 수량 · 금액 · 공급자 · 거래일자 필요): %s" % str(e).splitlines()[0][:200]}
    send = dict(data, receipt_id=rid + ("-F" if force else ""), worker_name=j["worker_name"])
    try:
        r = receipts.inbound(send, ip, file_path=image_path(j["image_id"]), by="%s (%s)" % (j["worker_name"] or user, user), src="모바일 촬영")
    except ValueError as e:
        return 502, {"detail": "MES 등록 실패: %s" % e}
    db.run("UPDATE rc_jobs SET status='registered', mes_inbound_no=?, data_json=? WHERE id=?",
           (r["inbound_id"], json.dumps(data, ensure_ascii=False), rid))
    return 200, {"success": True, "inbound_no": r["inbound_id"], "mes_result": r, "message": r.get("message")}
