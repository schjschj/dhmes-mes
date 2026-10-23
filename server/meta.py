# -*- coding: utf-8 -*-
"""메뉴 · 기준정보 테이블 정의 — /api/meta 의 단일 출처.

원본 MES(v1.19.0)를 역분석해 재구성했다. 프론트(core.js)는 App.meta.tables[t].cols 의
k(키)·l(라벨)·t(타입)·req·hide·ref·opts·grp·w·default 를 사용한다.
타입: text, num, int, date, time, select, ref, yesno, memo
"""

VERSION = "2.1.0"
COMPANY = "대흥공업"

# ──────────────────────────────────────────────────── 기준정보 테이블
# c(key, label, type, **flags) 헬퍼로 간결하게 정의
def c(k, l, t="text", **kw):
    d = {"k": k, "l": l, "t": t}
    d.update(kw)
    return d

TABLES = {
    "products": {
        "key": "code", "label": "제품",
        "cols": [
            c("code", "제번", req=True, w=100),
            c("name", "제품명", w=230),
            c("mold_no", "금형번호", "ref", ref="molds", w=80),
            c("reel_qty", "릴수량", "num", w=70),
            c("box_qty", "박스수량", "num", w=70),
            c("box_reels", "박스단위(릴)", "num", w=70),
            c("mat_code", "자재번호", w=80),
            c("mat_desc", "자재내역", w=200),
            c("spm", "SPM", "num", w=55),
            c("efficiency", "생산효율", "num", w=60),
            c("weight", "제품중량", "num", w=65),
            c("scrap_weight", "스크랩중량", "num", w=65),
            c("prod_weight", "생산중량", "num", w=65),
            c("price", "단가", "num", w=60),
            c("ship_to", "출고처", "select", opts=["케이씨텍출고", "공영도금출고", "남동공장출고"], w=80,
              help="출하관리에서 이 제품의 기본 출고처로 쓰입니다."),
            c("valid_count", "OEE 타당생산수", "num", hide=True, w=60,
              help="OEE 계산 시 양품 기준 수량. 비우면 생산수량을 사용합니다."),
            c("sub_box", "박스", grp="부자재"),
            c("sub_reel", "릴판"),
            c("sub_foam", "스티로폼패드"),
            c("sub_plate", "릴플레이트"),
            c("sub_core", "지관"),
            c("sub_pack", "패킹"),
            c("note", "비고", "memo", w=120),
        ],
    },
    "molds": {
        "key": "mold_no", "label": "금형",
        "cols": [
            c("mold_no", "금형관리번호", req=True, w=90),
            c("part_no", "대표 품번", w=95),
            c("part_name", "대표 품명", w=200),
            c("status", "상태", "select", opts=["사용중", "보관", "수리중", "폐기"], default="사용중", w=60),
            c("managed", "타수관리 대상", "yesno", default=1, w=60,
              help="체크하면 타수 알람(오버홀·세척·부품교환) 대상이 됩니다."),
            c("cavity", "Cavity", "num", grp="사양", w=55),
            c("pitch", "피치", "num", w=55),
            c("size", "사이즈", w=95),
            c("weight", "중량", "num", w=55),
            c("location", "보관위치", w=70),
            c("base_date", "기초타수 기준일", "date", grp="타수 관리"),
            c("base_shots", "기초 타수", "int"),
            c("adj_shots", "타수 보정(±)", "int"),
            c("oh_cycle", "오버홀 주기", "int"),
            c("clean_cycle", "세척 주기", "int"),
            c("part_cycle", "부품교환 주기", "int"),
            c("oh_base", "오버홀 기초타수", "int"),
            c("clean_base", "세척 기초타수", "int"),
            c("part_base", "부품교환 기초타수", "int"),
            c("note", "비고", "memo"),
        ],
    },
    "equipment": {
        "key": "no", "label": "설비",
        "cols": [
            c("no", "설비번호", req=True, w=70),
            c("ton", "Ton", "num"),
            c("maker", "Maker"),
            c("type", "Type"),
            c("std_spm", "표준SPM", "num"),
            c("die_height", "Die Height", "num"),
            c("stroke", "Stroke", "num"),
            c("adjust", "Adjust", "num"),
            c("made_year", "제작년도", "int"),
            c("bought_year", "구입년도", "int"),
            c("efficiency", "효율(%)", "num"),
            c("model", "모델명"),
            c("bolster", "볼스터"),
            c("serial", "시리얼"),
            c("status", "상태", "select", opts=["가동", "유휴", "수리중", "폐기"], default="가동"),
            c("note", "비고", "memo"),
        ],
    },
    "workers": {
        "key": "name", "label": "작업자",
        "cols": [
            c("name", "이름", req=True),
            c("dept", "부서/구분", "select", opts=["생산", "금형", "품질", "관리", "기타"]),
            c("shift", "근무조", "select", opts=["주간", "야간", "교대"]),
            c("active", "재직", "yesno", default=1),
            c("join_date", "입사일", "date"),
            c("phone", "연락처"),
            c("note", "비고", "memo"),
        ],
    },
    "defect_codes": {
        "key": "code", "label": "불량코드",
        "cols": [
            c("code", "불량코드", req=True),
            c("category", "대분류"),
            c("criteria", "판정 기준", "memo"),
            c("note", "비고", "memo"),
        ],
    },
    "repair_types": {
        "key": "code", "label": "금형수리유형",
        "cols": [
            c("code", "코드", req=True),
            c("name", "수리유형", req=True),
            c("note", "비고", "memo"),
        ],
    },
    # ── 이력성 테이블 (key=id 자동증가) ──
    "production": {
        "key": None, "label": "생산실적",
        "cols": [
            c("date", "생산날짜", "date", req=True),
            c("equip_no", "설비", "ref", ref="equipment", req=True),
            c("code", "제번", "ref", ref="products", req=True),
            c("kind", "구분", "select", opts=["특근", "특근2"]),
            c("day_reels", "주간 R/L", "num"),
            c("night_reels", "야간 R/L", "num"),
            c("day_worker", "주간 작업자", "ref", ref="workers"),
            c("night_worker", "야간 작업자", "ref", ref="workers"),
            c("start_time", "시작시간", "time"),
            c("end_time", "종료시간", "time"),
            c("dt_setup", "금형셋업", "int", grp="비가동(분)"),
            c("dt_first", "초품검사", "int"),
            c("dt_mold", "금형수리", "int"),
            c("dt_equip", "설비수리", "int"),
            c("dt_etc", "기타", "int"),
            c("dt_note", "비가동사유 비고"),
            c("mat_qty", "원재료 생산수량", "num", grp="로스(수량)"),
            c("loss_mold_chg", "금형교체", "num"),
            c("loss_mold_fix", "금형수리", "num"),
            c("loss_coil", "원재료교체", "num"),
            c("loss_adjust", "조건조정", "num"),
            c("loss_vision", "비전셋업", "num"),
            c("loss_init", "초기허용", "num"),
            c("lot_no", "생산 LOT", grp="LOT 추적",
              help="[개선] 이 실적의 생산 LOT. 원재료 코일 LOT과 연결해 역추적합니다."),
            # ref 로 바꾸려면 rawmat_lots 를 TABLES 에 등록해야 함 (core.js refLabel 이 meta.tables 를 참조)
            c("coil_lot", "원재료 코일 LOT",
              help="[개선] 사용한 원재료 코일 LOT 번호."),
            c("note", "비고", "memo"),
        ],
    },
    "defects": {
        "key": None, "label": "공정불량",
        "cols": [
            c("date", "생산일자", "date", req=True),
            c("equip_no", "설비(호기)", "ref", ref="equipment"),
            c("lot_no", "LOT NO"),
            c("code", "제번", "ref", ref="products", req=True),
            c("qty", "폐기수량(EA)", "int"),
            c("reels", "폐기(릴)", "num"),
            c("defect_code", "불량코드", "ref", ref="defect_codes"),
            c("reason", "불량사유"),
            c("worker", "작업자", "ref", ref="workers"),
            c("disposal_date", "폐기일", "date"),
            c("note", "비고", "memo"),
        ],
    },
    "mold_maint": {
        "key": None, "label": "금형 정비이력",
        "cols": [
            c("mold_no", "금형관리번호", "ref", ref="molds", req=True),
            c("date", "날짜", "date", req=True),
            c("oh", "오버홀", "yesno"),
            c("clean", "세척", "yesno"),
            c("partchg", "부품교환", "yesno"),
            c("shots", "누적 타수", "int"),
            c("worker", "작업자", "ref", ref="workers"),
            c("note", "정비 내용", "memo"),
        ],
    },
    "mold_repair": {
        "key": None, "label": "금형 수리이력",
        "cols": [
            c("mold_no", "금형번호", "ref", ref="molds", req=True),
            c("code", "제번"),
            c("date", "일자", "date", req=True),
            c("problem", "문제점 (의뢰내용)", "memo"),
            c("cause", "원인", "memo"),
            c("fix", "수리내용", "memo"),
            c("types", "수리유형"),
            c("reels", "생산수량 (릴)", "num"),
            c("qty", "생산수량 (EA)", "int"),
            c("worker", "수리자"),
            c("cost", "수리비용", "int", grp="[개선] 비용",
              help="[개선] 외주/부품 수리비. 금형별 유지비 집계에 쓰입니다."),
            c("note", "비고", "memo"),
            c("src", "원본 (카드 파일 · 시트 · 행)", hide=True),
            c("src_key", "중복 확인용", hide=True),
        ],
    },
    "parts": {
        "key": None, "label": "금형부품",
        "cols": [
            c("code", "부품코드"),
            c("name", "부품명", req=True),
            c("category", "구분", "select",
              opts=["펀치", "다이(인서트)", "스트리퍼", "파일럿", "가이드포스트", "가이드부시",
                    "스프링", "우레탄", "볼트/핀", "블록", "센서", "기타"]),
            c("spec", "규격"),
            c("material", "재질"),
            c("mold_no", "사용금형", "ref", ref="molds"),
            c("qty", "현재고", "int"),
            c("safety_qty", "안전재고", "int"),
            c("unit", "단위", "select", opts=["EA", "SET", "개", "본", "kg"]),
            c("price", "단가", "int"),
            c("maker", "제조사/구입처"),
            c("location", "보관위치"),
            c("note", "비고", "memo"),
        ],
    },
}

# 권한 그룹 (원본의 난수 그룹 @mve5bmwfs6 → '설정' 으로 정리)
PERM_GROUPS = ["생산관리", "품질관리", "금형관리", "근태관리", "원재료", "출하관리", "기준정보", "설정", "시스템"]

# ──────────────────────────────────────────────────── 메뉴
# (group, group_label, [(id, label, page, args)])
MENU_DEF = [
    ("홈", "홈", [
        ("home", "대시보드", "home", {}),
    ]),
    ("생산관리", "생산관리", [
        ("workorder", "작업지시서", "workorder", {}),
        ("plan", "납기 · 생산계획", "plan", {}),
        ("prod_entry", "생산실적 입력", "prod_entry", {}),
        ("prod_scan", "작업일보 스캔 (OCR)", "prod_scan", {}),     # [개선] 신규
        ("floor", "현장 입력 (태블릿)", "floor_admin", {}),         # [개선] 신규
        ("prod_daily", "일일 생산현황", "report", {"report": "daily"}),
        ("prod_monthly", "월간 생산현황", "report", {"report": "monthly"}),
        ("prod_equip", "설비 가동률 · OEE", "report", {"report": "equip"}),
        ("prod_worker", "작업자별 집계", "report", {"report": "worker"}),
        ("prod_month", "월간 보고", "report", {"report": "month"}),
        ("prod_year", "연간 누계 보고", "report", {"report": "year"}),
    ]),
    ("품질관리", "품질관리", [
        ("defects", "공정불량 등록", "defects", {}),
        ("defect_report", "불량 집계", "report", {"report": "defect"}),
        ("incoming", "수입검사 · 성적서", "incoming", {}),       # [개선] 신규
        ("inproc", "초중종물 검사", "inproc", {}),               # [개선] 신규
        ("claims", "고객불만 · 8D", "claims", {}),               # [개선] 신규
        ("gauges", "계측기 교정관리", "gauges", {}),             # [개선] 신규
        ("quality_docs", "품질문서(CP/FMEA/도면)", "quality_docs", {}),  # [개선] 신규
        ("q_month", "품질 월간 리포트", "report", {"report": "qmonth"}),  # [개선] 신규
    ]),
    ("금형관리", "금형관리", [
        ("mold_status", "타수 · 정비 알람", "mold_status", {}),
        ("mold_board", "금형 위치 · 사진/도면", "mold_board", {}),   # [개선] 신규 (현황판 대체)
        ("mold_maint", "정비이력", "mold_maint", {}),
        ("mold_repair", "수리이력", "mold_repair", {}),
        ("parts", "금형부품 재고", "parts", {}),
        ("parts_tx", "금형부품 입출고 이력", "parts_tx", {}),
        ("mold_cost", "유지비 · 부품 구매단가", "mold_cost", {}),   # [개선] 신규
    ]),
    ("근태관리", "근태관리", [
        ("att_month", "월별 근태", "att", {"tab": "month"}),
        ("att_leave", "연차 현황", "att", {"tab": "leave"}),
        ("att_year", "연간 집계", "att", {"tab": "year"}),
    ]),
    ("원재료", "원재료", [
        ("rm_stock", "원재료 재고", "rawmat", {"tab": "stock"}),
        ("rm_lot", "코일 LOT 추적", "rmlot", {}),               # [개선] 신규
        ("rm_hist", "원재료 입출고 이력", "rawmat", {"tab": "hist"}),
        ("rm_need", "소요량 · 수율 · 발주 알림", "rm_need", {}),     # [개선] 신규
        ("invoices", "거래명세서 입력", "invoices", {}),            # [개선] 신규
    ]),
    ("출하관리", "출하관리", [
        ("ship_prep", "출하 준비", "ship", {"tab": "prep"}),
        ("ship_hold", "보류 현황", "ship", {"tab": "hold"}),
        ("ship_list", "출고 현황", "ship", {"tab": "list"}),
    ]),
    ("기준정보", "기준정보", [
        ("t_products", "제품", "table", {"table": "products"}),
        ("t_molds", "금형", "table", {"table": "molds"}),
        ("t_equipment", "설비(프레스)", "table", {"table": "equipment"}),
        ("t_workers", "작업자", "table", {"table": "workers"}),
        ("t_defect_codes", "불량코드", "table", {"table": "defect_codes"}),
        ("t_repair_types", "금형수리유형", "table", {"table": "repair_types"}),
    ]),
    ("설정", "설정", [
        ("prod_std", "생산 기준 (근무·휴게)", "prod_std", {}),
        ("prod_missing", "금형·SPM 미등록", "prod_missing", {}),
        ("att_settings", "근태 설정", "att", {"tab": "settings"}),
        ("att_emp", "직원 관리", "att", {"tab": "emp"}),
    ]),
    ("시스템", "시스템", [
        ("import", "데이터 가져오기", "import", {}),
        ("settings", "설정 · 백업", "settings", {}),
        ("changelog", "변경 기록", "changelog", {}),
        ("users", "사용자 · 권한", "users", {}),
        ("menu_layout", "메뉴 배치", "menu_layout", {}),
    ]),
]

ADMIN_ITEMS = {"users", "menu_layout"}     # 관리자만 보이는 메뉴
FIXED_ITEMS = {"menu_layout"}              # 메뉴 배치에서 옮길 수 없음


# ──────────────────────────────────────────────────── 메뉴 배치 (settings 'menu_layout')
def _items_def():
    """id → (orig_group, label, page, args)"""
    out = {}
    for gid, _, items in MENU_DEF:
        for iid, label, page, args in items:
            out[iid] = (gid, label, page, args)
    return out


def effective(layout):
    """메뉴 배치를 적용한 대목록 목록 (홈 제외). [{key,name,orig_name,custom,items:[{id,label,...}]}]"""
    defs = _items_def()
    base = [(gid, gname, [i[0] for i in items]) for gid, gname, items in MENU_DEF if gid != "홈"]
    orig_name = {gid: gname for gid, gname, _ in base}
    layout = layout or {}
    labels = layout.get("labels") or {}
    if layout.get("groups"):
        groups = [{"key": g["key"], "name": g.get("name") or orig_name.get(g["key"], g["key"]),
                   "orig_name": orig_name.get(g["key"], ""), "custom": bool(g.get("custom")) or g["key"] not in orig_name,
                   "ids": []} for g in layout["groups"]]
        keys = {g["key"] for g in groups}
        for gid, gname, _ in base:            # 배치에 없는 원래 대목록은 뒤에
            if gid not in keys:
                groups.append({"key": gid, "name": gname, "orig_name": gname, "custom": False, "ids": []})
        placed = set()
        by_key = {g["key"]: g for g in groups}
        for t in layout.get("tree") or []:
            g = by_key.get(t.get("group"))
            if not g:
                continue
            for iid in t.get("items") or []:
                if iid in defs and iid not in placed and iid not in FIXED_ITEMS:
                    g["ids"].append(iid)
                    placed.add(iid)
        for gid, _, ids in base:              # 배치에 없는 메뉴는 원래 자리
            for iid in ids:
                if iid not in placed and iid not in FIXED_ITEMS:
                    by_key[gid]["ids"].append(iid)
                    placed.add(iid)
        for iid in FIXED_ITEMS:
            by_key[defs[iid][0]]["ids"].append(iid)
    else:
        groups = [{"key": gid, "name": gname, "orig_name": gname, "custom": False, "ids": list(ids)}
                  for gid, gname, ids in base]
    out = []
    for g in groups:
        items = []
        for iid in g["ids"]:
            og, label, page, args = defs[iid]
            items.append({"id": iid, "label": labels.get(iid, label), "orig_label": label, "orig_group": og,
                          "page": page, "args": args, "fixed": iid in FIXED_ITEMS, "admin": iid in ADMIN_ITEMS})
        out.append({"group": g["key"], "key": g["key"], "name": g["name"], "orig_name": g["orig_name"],
                    "custom": g["custom"], "items": items})
    return out


def groups_holding(layout, orig_group):
    """원래 대목록 orig_group 의 메뉴가 지금 들어 있는 대목록들 (권한 검사용)."""
    out = {orig_group}
    for g in effective(layout):
        if any(it["orig_group"] == orig_group for it in g["items"]):
            out.add(g["key"])
    return out


def build_menu(me, layout=None):
    """사용자 권한(me.perms)에 맞춰 볼 수 있는 메뉴만 구성."""
    home = MENU_DEF[0]
    groups = [{"group": "홈", "name": "홈", "items": [{
        "group": "홈", "group_name": "홈", "id": iid, "label": label, "page": page, "args": args,
        "order": 0, "need": 1, "orig_group": "홈", "orig_label": label} for iid, label, page, args in home[2]]}]
    for g in effective(layout):
        lv = 3 if me.get("admin") else me.get("perms", {}).get(g["key"], 0)
        if lv <= 0:
            continue
        items = []
        for i, it in enumerate(g["items"]):
            if it["admin"] and not me.get("admin"):
                continue
            items.append({"group": g["key"], "group_name": g["name"], "id": it["id"], "label": it["label"],
                          "page": it["page"], "args": it["args"], "order": i * 10, "need": 1,
                          "orig_group": it["orig_group"], "orig_label": it["orig_label"]})
        if items:
            groups.append({"group": g["key"], "name": g["name"], "items": items})
    return groups


def meta_for(me, settings, layout=None):
    return {
        "version": VERSION,
        "company": settings.get("company", COMPANY),
        "me": me,
        "menu": build_menu(me, layout),
        "tables": TABLES,
        "settings": {"company": settings.get("company", COMPANY)},
    }
