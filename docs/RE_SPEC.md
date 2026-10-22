# 대흥공업 MES 재구축 — 리버스 엔지니어링 명세

> 원본: `http://192.168.0.108:8000` (다른 PC, Python 3.8 커스텀 서버, v1.19.0)
> 소스코드를 받을 수 없어, 실행 중인 화면/API를 역분석(REA)해 새로 구축한다.
> 이 문서는 세션이 끊겨도 이어서 작업하기 위한 기준 명세다.

## 핵심 전략
원본의 **프론트엔드(클라이언트) JS/CSS는 모두 확보**했다 (core.js, shared.js, ai.js,
knowhow.js, app.css, pages/*.js 22개). 받을 수 없는 것은 **백엔드(Python 서버 + DB)** 뿐이다.
따라서 작업은 "프론트가 호출하는 API 계약을 만족하는 FastAPI 백엔드 + SQLite DB를 재구축"하는 것이다.

- 백엔드: FastAPI + 표준 sqlite3 + openpyxl (모두 설치됨, Python 3.14)
- 프론트: 원본 클라이언트 파일 재사용 (사용자 소유물)
- 구동: 사내 PC 1대에서 서버, 여러 명이 브라우저로 접속 (원본과 동일 구조)

## 기술 환경
- Python: `C:\Users\schjs\AppData\Local\Python\pythoncore-3.14-64\python.exe`
- 설치됨: fastapi 0.159.1, uvicorn 0.52.4, openpyxl 3.1.5, starlette, jinja2
- 프로젝트: `C:\Users\schjs\OneDrive\BCgen process\DHmes\MES`
  - `web/` 프론트(static), `server/` 백엔드, `data/` SQLite DB·백업, `docs/` 문서

## 프론트 로딩 구조 (core.js 분석)
- `index.html` → `/css/app.css`, `/js/core.js`, `/js/shared.js`, `/js/ai.js`, `/js/knowhow.js`
- 화면은 `App.pages.<page>` 로 등록. 메뉴 클릭 시 `/js/pages/<page>.js` 동적 로드.
- 시작 시 `GET /api/meta` 로 메뉴·표정의·사용자 정보를 받아 네비게이션 구성.
- `GET /api/ping` (20초마다): `{v, notice}` — 버전 바뀌면 새로고침 배너.
- 공통: `App.api(method,url,body)` JSON, 401+`{login:1}` 이면 로그인창.
- 엑셀: `POST /api/xlsx` `{filename, sheets:[{name,head,rows}]}` → xlsx blob. `/api/xlsx_styled` 도 있음.
- 권한: `App.me.perms[group]` 레벨 0(없음)/1(보기)/2(입력)/3(삭제·관리), `admin` 이면 전부 3.

## 메뉴 구조 (9개 그룹)
```
홈:        대시보드[home]
생산관리:   작업지시서[workorder] | 납기·생산계획[plan] | 생산실적 입력[prod_entry]
           | 일일/월간 생산현황·설비 OEE·작업자별·월간보고·연간누계[report:{report:...}]
품질관리:   공정불량 등록[defects] | 불량 집계[report:{report:defect}]
금형관리:   타수·정비 알람[mold_status] | 정비이력[mold_maint] | 수리이력[mold_repair]
           | 금형부품 재고[parts] | 입출고 이력[parts_tx]
근태관리:   월별 근태 / 연차 현황 / 연간 집계 [att:{tab:...}]
원재료:     원재료 재고 / 입출고 이력 [rawmat:{tab:...}]
출하관리:   출하 준비 / 보류 현황 / 출고 현황 [ship:{tab:...}]
기준정보:   제품 / 금형 / 설비 / 작업자 / 불량코드 / 금형수리유형 [table:{table:...}]
설정:      생산기준(근무·휴게)[prod_std] | 금형·SPM 미등록[prod_missing] | 근태설정·직원관리[att]
시스템:    데이터 가져오기[import] | 설정·백업[settings] | 변경기록[changelog]
           | 사용자·권한[users] | 메뉴 배치[menu_layout]
```
report 리포트 종류: daily, monthly, equip, worker, month, year, defect

## 기준정보 테이블 (11개, `/api/t/<table>` CRUD)
`GET /api/t/<t>` 목록, `POST /api/t/<t>` 생성, `PUT /api/t/<t>/<id>` 수정, `DELETE /api/t/<t>/<id>`.
공통 감사 컬럼: created, created_by, updated, updated_by. 컬럼 타입: text/num/int/date/time/select/ref/yesno/memo.

### products (제품) key=code
code(제번)·name(제품명)·mold_no(금형번호→molds)·reel_qty(릴수량)·box_qty(박스수량)·
box_reels(박스단위릴)·mat_code(자재번호)·mat_desc(자재내역)·spm(SPM)·efficiency(생산효율)·
weight(제품중량)·scrap_weight(스크랩중량)·prod_weight(생산중량)·price(단가)·
ship_to(출고처:케이씨텍출고/공영도금출고/남동공장출고)·valid_count(OEE타당생산수,hide)·
sub_box(박스)·sub_reel(릴판)·sub_foam(스티로폼패드)·sub_plate(릴플레이트)·sub_core(지관)·sub_pack(패킹)·note(비고)

### molds (금형) key=mold_no
mold_no(금형관리번호)·part_no(대표품번)·part_name(대표품명)·status(상태,select)·managed(타수관리대상,yesno)·
cavity·pitch·size·weight·location(보관위치)·base_date(기초타수기준일)·base_shots(기초타수)·
adj_shots(타수보정±)·oh_cycle(오버홀주기)·clean_cycle(세척주기)·part_cycle(부품교환주기)·
oh_base(오버홀기초타수)·clean_base(세척기초타수)·part_base(부품교환기초타수)·note

### equipment (설비) key=no
no(설비번호)·ton(Ton)·maker·type·std_spm(표준SPM)·die_height·stroke·adjust·made_year·bought_year·
efficiency(효율%)·model(모델명)·bolster(볼스터)·serial(시리얼)·status(상태,select)·note

### workers (작업자) key=name
name(이름)·dept(부서/구분,select)·shift(근무조,select)·active(재직,yesno)·join_date(입사일)·phone·note

### defect_codes (불량코드) key=code
code(불량코드)·category(대분류)·criteria(판정기준,memo)·note

### repair_types (금형수리유형) key=code
code·name(수리유형)·note

### production (생산실적) key=id (자동)
date(생산날짜)·equip_no(설비→equipment)·code(제번→products)·kind(구분,select)·
day_reels(주간R/L)·night_reels(야간R/L)·day_worker(→workers)·night_worker(→workers)·
start_time·end_time·dt_setup(금형셋업)·dt_first(초품검사)·dt_mold(금형수리)·dt_equip(설비수리)·
dt_etc(기타)·dt_note(비가동사유)·mat_qty(원재료생산수량)·loss_mold_chg(금형교체)·loss_mold_fix(금형수리)·
loss_coil(원재료교체)·loss_adjust(조건조정)·loss_vision(비전셋업)·loss_init(초기허용)·note
(dt_* = 비가동 분(分), loss_* = 로스 수량)

### defects (공정불량) key=id
date(생산일자)·equip_no(설비→equipment)·lot_no(LOT NO)·code(제번→products)·qty(폐기수량EA)·
reels(폐기릴)·defect_code(→defect_codes)·reason(불량사유)·worker(→workers)·disposal_date(폐기일)·note

### mold_maint (금형 정비이력) key=id
mold_no(→molds)·date·oh(오버홀,yesno)·clean(세척,yesno)·partchg(부품교환,yesno)·shots(누적타수)·worker(→workers)·note

### mold_repair (금형 수리이력) key=id
mold_no(→molds)·code(제번)·date·problem(문제점)·cause(원인)·fix(수리내용)·types(수리유형)·
reels(생산수량릴)·qty(생산수량EA)·worker(수리자)·note·src·src_key(중복확인)

### parts (금형부품) key=id
code(부품코드)·name·category(구분,select)·spec(규격)·material(재질)·mold_no(사용금형→molds)·
qty(현재고)·safety_qty(안전재고)·unit(단위,select)·price(단가)·maker(제조사/구입처)·location(보관위치)·note

## 주요 비(非)테이블 API (페이지별 — 구현 시 해당 pages/*.js 정독)
- 대시보드 `GET /api/dashboard`: `{shortage[], mold_alarms[], counts{products,molds,equipment,workers,parts}, recent[], alarm1, alarm2, prod{month_qty,month_oee,month_time,last_date,last_qty,month_days}}`
- 홈 `GET /api/home`, 메모 `/api/memos`, `/api/memo_comments/`
- 작업지시 `/api/wo`, `/api/wo/list`, `/api/wo/hint`, `/api/wo/import`
- 생산계획 `/api/plan`, `/api/plan/upload`(납기엑셀), `/api/plan/workorder`, `/api/plan/families`,
  `/api/plan/incoming`, `/api/plan/rules`, `/api/plan/override`, `/api/plan/learned`,
  `/api/plan/ai`, `/api/plan/ai/config`, `/api/plan/ai/state` (AI 1차 자동계획)
- 생산실적 `/api/production`, `/api/production/last`, `/api/production/missing`, `/api/production/std`
- 리포트 `/api/report/<종류>`
- 금형 `/api/molds/status`, `/api/molds/detail`; 수리 `/api/mold_repair/molds|stats|import`
- 부품 `/api/parts`, `/api/parts/tx` (입출고)
- 근태 `/api/att/config|roster|emp|emp_order|data|cells|leave|rev|holidays/fetch|import`
- 원재료 `/api/rm/data|history|path|refresh` (외부 창고 데이터를 읽어옴)
- 출하 `/api/ship/stock|prep?|start|confirm|adjust|holds|list|quick|tx`
- 로그인 `/api/login`,`/api/logout`,`/api/password`; 사용자 `/api/users`
- 시스템 `/api/settings`, `/api/backup/*`, `/api/log`(변경기록), `/api/menu_layout`,
  `/api/import/*`, `/api/update/*`, `/api/client.zip`(PC 접속 런처)

## 개선제안 반영 (MES개선제안.docx) — 신규/개선 항목
1. 생산실적↔작업지시 연결: 작업지시 기반 리스트에서 수량만 입력 / 작업일보 스캔 OCR 자동기입
2. LOT 추적: 원재료 코일 LOT ↔ 생산 LOT ↔ 불량 역추적
3. 작업지시 최적화: 최근 6개월 데이터로 설비별 생산가능 제품 분류, 납기엑셀→1차 자동계획, 기종교환 최소화
4. 대시보드 추가: 납기임박 품목(건수), 월 불량율 추이(막대), 비가동 상위사유, 원재료 부족예상
5. 보고서: 시각화, 목표값(생산량·불량율), 비가동 파레토
6. 품질: 수입검사(두께·폭·외관·포장) 성적서, 초중종물검사 전산화, 초품검사 승인 인터락,
   고객불만(8D)·유형별/월별 현황, 계측기 교정주기, F-cost 손실분석, CP/FMEA/도면 문서이력
7. 금형: 수리비 집계, 부품단가 분석, 금형 이동 현황판, 기준정보(사진·도면)
8. 원재료: 코일별 LOT추적, 소요량(수율)=제품중량·스크랩·생산량 기반, 안전재고 자동알림, 거래명세서 자동입력
* 장기: 태블릿 현장입력 → 프레스 타수 자동카운터 연동(실시간 가동률·자재소모·스크랩·금형OH계획)

## 진행 현황 (TODO) — 이어서 작업할 때 여기부터
- [x] 1단계: 백엔드 백본 (FastAPI, SQLite, 세션인증, /api/meta, /api/ping, static 서빙) — 2026-10-22 HTTP 검증 완료
- [x] 2단계: 기준정보 11테이블 CRUD + 감사로그(/api/log) + 엑셀(/api/xlsx)
- [~] 3단계: 대시보드 /api/dashboard — shape 일치. 타수 알람 임계(0.75/0.9/1.0)는 추정값, month_oee/month_time 미구현
- [x] 0단계: web/ 에 원본 프론트 복사 (사용자 재사용 승인)
- 2026-10-22 브라우저 전체 메뉴 점검: 정상 10개 (기준정보 6, 공정불량 등록, 정비이력, 수리이력, 변경기록)
  미구현 API (화면별): home·memos(대시보드) / wo, wo/list / plan / production, production/missing, production/std
  / report/{daily,monthly,equip,worker,month,year,defect} / molds/status / parts, parts/tx / att/data
  / rm/data, rm/refresh(POST) / ship/stock / settings, backup/list, update/status, plan/learned / users / menu_layout
  + [개선] 페이지 파일 없음: incoming, inproc, claims, gauges, quality_docs
- 주의: meta.py 의 [개선] 신규 메뉴(incoming, inproc, claims, gauges, quality_docs, rawmat lot 탭)는 페이지 파일이 아직 없음
- [ ] 4단계: 생산실적 입력 + 리포트
- [ ] 5단계: 금형(타수알람·정비·수리) + 부품 입출고
- [ ] 6단계: 작업지시 + 생산계획(+AI)
- [ ] 7단계: 근태 / 원재료 / 출하
- [ ] 8단계: 사용자·권한 / 설정·백업 / 변경기록 / 가져오기
- [ ] 9단계: 개선제안 신규 기능 (LOT추적, 품질, 대시보드 확장 등)
