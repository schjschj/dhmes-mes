# 대흥공업 MES (재구축판)

원본 MES(다른 PC의 `http://192.168.0.108:8000`, v1.19.0)를 역분석(REA)해 새로 만든 버전.
받을 수 없는 백엔드(Python 서버 + DB)를 FastAPI + SQLite 로 재구축하고, 원본 프론트엔드를 재사용한다.

## 구조
```
MES/
  web/        프론트엔드 (index.html, css/, js/, js/pages/) — 원본 재사용
  server/     백엔드 (FastAPI)
    app.py        서버 진입점 · 라우팅 · 정적 서빙
    meta.py       메뉴 · 기준정보 테이블 정의 (/api/meta 출처)
    db.py         SQLite 데이터 계층 (스키마 자동 생성)
    auth.py       세션 쿠키 인증 · 권한
    tables.py     기준정보/이력 11개 테이블 공통 CRUD
    dashboard.py  대시보드 집계
    xlsx.py       엑셀 내보내기
  data/       mes.db (SQLite) · 백업
  docs/       RE_SPEC.md (역분석 명세 · 진행 TODO)
```

## 실행
1. `web/` 에 프론트 파일이 있어야 한다. (원본에서 받은 파일 복사 — 아래 참고)
2. `run.bat` 더블클릭. 또는:
   ```
   python server\app.py
   ```
3. 브라우저에서 `http://localhost:8000` (사내 다른 PC는 `http://서버IP:8000`).

> 주의: 이 PC 8000 포트를 이미 다른 프로그램이 쓰고 있으면,
> `set MES_PORT=8001` 로 포트를 바꾸거나 기존 프로그램을 끄고 실행한다.

## 최초 로그인
- 아이디 `admin` / 비밀번호 `1234` (최초 1회, 로그인 후 비밀번호 변경 요구)

## 프론트 파일 복사 (최초 1회)
안전상 자동 복사가 막혀 있어, 받아둔 원본 프론트를 아래처럼 직접 복사한다
(임시폴더 경로는 세션마다 다를 수 있음 — 작업 시 안내).

## 진행 상황
`docs/RE_SPEC.md` 의 TODO 참조. 매 작업 종료 시 git 커밋으로 저장.
