/* [개선제안] 품질관리 · 코일 LOT 화면 — 수입검사 / 초중종물 / 고객불만(8D) / 계측기 / 품질문서 / 코일 LOT 추적
   서버: /api/q/<kind> (목록·등록·수정·삭제), /api/qx/... (승인·집계·이력·문서·추적) */
(function () {
  'use strict';
  var esc = App.esc, fmt = App.fmt;
  function tag(v, map) { return v ? '<span class="tag ' + (map[v] || '') + '">' + esc(v) + '</span>' : ''; }
  var RES = { '합격': 'ok', '불합격': 'bad', '조건부': 'warn', '검사중': 'gray' };

  // 공통 목록 화면: 검색 · 기간 · 등록 · 수정 · 삭제 · 엑셀 (+ 오른쪽 상세)
  App.qCrud = function (root, o) {
    var lv = App.curLevel || 0;
    root.innerHTML = '<div class="page-full">' + (o.desc ? '<div class="desc">' + o.desc + '</div>' : '') +
      '<div class="toolbar">' + (o.period ? '<span data-period style="display:contents"></span>' : '') +
      '<input class="input search" placeholder="검색">' + '<span class="grow"></span>' +
      (o.buttons || []).filter(function (b) { return lv >= (b.level || 2); }).map(function (b) { return '<button class="btn ' + (b.cls || '') + '" data-a="' + b.a + '">' + esc(b.label) + '</button>'; }).join('') +
      (lv >= 2 ? '<button class="btn primary" data-a="add">+ 등록</button><button class="btn" data-a="edit">수정</button>' : '') +
      (lv >= 3 ? '<button class="btn danger" data-a="del">삭제</button>' : '') +
      '<button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
      (o.top ? '<div data-top></div>' : '') +
      (o.detail ? '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">목록에서 고르면 자세히 보입니다.</div></div></div>'
        : '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>') + '</div>';
    var right = root.querySelector('.right');
    var grid = new App.Grid(root.querySelector(o.detail ? '.left' : '.gridbox'), {
      cols: o.cols.concat(App.auditCols()), sort: o.sort || { k: 'id', dir: -1 }, hint: lv >= 2 ? '두 번 클릭하면 수정' : '',
      rowClass: o.rowClass, onDbl: lv >= 2 ? function (r) { form(r); } : null,
      onSelect: o.detail ? function (r) { o.detail(r, right, reload); } : null
    });
    root.querySelector('.search').addEventListener('input', function () { grid.setFilter(this.value); });
    var period = o.period ? App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('q_' + o.kind, { d1: App.addDays(-90), d2: App.today() }), function (p) { App.store.set('q_' + o.kind, p); reload(); }) : null;
    var rows = [];
    function reload(sel) {
      var p = period ? period.get() : {};
      var keep = sel || (grid.selected() || {}).id;
      return App.get('/api/q/' + o.kind + (period ? '?d1=' + (p.d1 || '') + '&d2=' + (p.d2 || '') : '')).then(function (r) {
        rows = r; grid.setRows(r); if (keep) grid.selectKey(keep, true);
        if (o.onLoad) o.onLoad(r, root.querySelector('[data-top]'));
      }).catch(App.err);
    }
    function form(r) {
      var edit = !!(r && r.id);
      var vals = edit ? r : Object.assign({}, typeof o.defaults === 'function' ? o.defaults() : (o.defaults || {}));
      App.form({
        title: o.title + (edit ? ' 수정' : ' 등록'), cols: o.form, values: vals, mode: edit ? 'edit' : 'new', wide: o.form.length > 8,
        onSave: function (v) {
          return (edit ? App.api('PUT', '/api/q/' + o.kind + '/' + r.id, v) : App.api('POST', '/api/q/' + o.kind, v)).then(function (res) {
            App.toast('저장했습니다.'); reload(edit ? r.id : res.id);
          });
        }
      });
    }
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      var r = grid.selected();
      if (a === 'add') return form(null);
      if (a === 'xlsx') return App.exportXlsx(o.title + '_' + App.stamp() + '.xlsx', [grid.sheet(o.title)]);
      if (!r) return App.toast('목록에서 먼저 고르세요.', 'warn');
      if (a === 'edit') form(r);
      else if (a === 'del') App.confirm('고른 ' + o.title + ' 기록을 삭제할까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/q/' + o.kind + '/' + r.id).then(function () { App.toast('삭제했습니다.'); reload(); }).catch(App.err);
      });
      else (o.buttons || []).forEach(function (b) { if (b.a === a) b.fn(r, reload); });
    });
    reload();
    return { grid: grid, reload: reload };
  };

  function printDoc(title, html) {
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.contentDocument.open();
    fr.contentDocument.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      '@page{size:A4;margin:14mm}body{font-family:"Malgun Gothic",sans-serif;font-size:11pt}h1{text-align:center;font-size:20pt;margin:0 0 14px}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #333;padding:6px 8px}th{background:#eee;width:22%}' +
      '.sign{display:flex;justify-content:flex-end}.sign span{width:90px;height:60px;border:1px solid #333;margin-left:-1px;text-align:center;font-size:9pt;padding-top:3px}</style></head><body>' + html + '</body></html>');
    fr.contentDocument.close();
    setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 2000); }, 300);
  }

  // ================================================================ 수입검사 · 성적서
  App.pages.incoming = function (root) {
    App.qCrud(root, {
      kind: 'incoming', title: '수입검사', period: true,
      desc: '원재료 코일이 들어오면 두께 · 폭 · 외관 · 포장을 검사해 기록합니다. <b>합격</b>으로 저장하면 그 LOT 이 <b>원재료 > 코일 LOT 추적</b>에 자동 등록되어, 생산실적의 코일 LOT 과 연결됩니다.',
      cols: [
        { k: 'date', l: '입고일', w: 80 }, { k: 'lot_no', l: '코일 LOT', w: 110, mono: true }, { k: 'mat_code', l: '자재번호', w: 80 },
        { k: 'maker', l: '공급사', w: 90 }, { k: 'spec', l: '규격', w: 90 }, { k: 'weight', l: '중량(kg)', t: 'num', w: 65 },
        { k: 'thick', l: '두께 기준/측정', w: 100, val: function (r) { return (r.thick_std == null ? '' : r.thick_std) + ' / ' + (r.thick_meas == null ? '' : r.thick_meas); } },
        { k: 'width', l: '폭 기준/측정', w: 100, val: function (r) { return (r.width_std == null ? '' : r.width_std) + ' / ' + (r.width_meas == null ? '' : r.width_meas); } },
        { k: 'appearance', l: '외관', w: 50, center: true }, { k: 'packing', l: '포장', w: 50, center: true },
        { k: 'cert_no', l: '성적서 번호', w: 100 }, { k: 'result', l: '판정', w: 60, center: true, fmt: function (v) { return tag(v, RES); } },
        { k: 'inspector', l: '검사자', w: 65 }, { k: 'note', l: '비고', w: 140 }
      ],
      rowClass: function (r) { return r.result === '불합격' ? 'r-bad' : r.result === '조건부' ? 'r-warn' : ''; },
      defaults: function () { return { date: App.today(), result: '합격', appearance: '양호', packing: '양호', inspector: App.user }; },
      form: [
        { k: 'date', l: '입고일', t: 'date', req: true }, { k: 'lot_no', l: '코일 LOT (바코드)', req: true },
        { k: 'mat_code', l: '자재번호' }, { k: 'maker', l: '공급사' }, { k: 'spec', l: '규격 (재질 · 두께×폭)' }, { k: 'weight', l: '중량(kg)', t: 'num' },
        { k: 'thick_std', l: '두께 기준(mm)', t: 'num', grp: '측정' }, { k: 'thick_meas', l: '두께 측정(mm)', t: 'num' },
        { k: 'width_std', l: '폭 기준(mm)', t: 'num' }, { k: 'width_meas', l: '폭 측정(mm)', t: 'num' },
        { k: 'appearance', l: '외관', t: 'select', opts: ['양호', '불량'] }, { k: 'packing', l: '포장 상태', t: 'select', opts: ['양호', '불량'] },
        { k: 'cert_no', l: '공급사 성적서 번호' }, { k: 'result', l: '판정', t: 'select', opts: ['합격', '불합격', '조건부', '검사중'] },
        { k: 'inspector', l: '검사자', t: 'ref', ref: 'workers' }, { k: 'note', l: '비고', t: 'memo' }
      ],
      buttons: [{ a: 'print', label: '성적서 인쇄', level: 1, fn: function (r) {
        printDoc('수입검사 성적서', '<h1>원재료 수입검사 성적서</h1><table>' +
          [['입고일', r.date], ['코일 LOT', r.lot_no], ['자재번호', r.mat_code], ['공급사', r.maker], ['규격', r.spec], ['중량(kg)', fmt(r.weight)],
            ['두께 (기준 / 측정)', (r.thick_std || '') + ' / ' + (r.thick_meas || '')], ['폭 (기준 / 측정)', (r.width_std || '') + ' / ' + (r.width_meas || '')],
            ['외관', r.appearance], ['포장 상태', r.packing], ['공급사 성적서', r.cert_no], ['판정', r.result], ['비고', r.note]]
            .map(function (x) { return '<tr><th>' + x[0] + '</th><td>' + esc(x[1] == null ? '' : x[1]) + '</td></tr>'; }).join('') +
          '</table><div class="sign"><span>검사 ' + esc(r.inspector || '') + '</span><span>확인</span><span>승인</span></div>' +
          '<p style="font-size:9pt">' + esc((App.meta && App.meta.company) || '') + ' · 출력 ' + App.today() + '</p>');
      } }]
    });
  };

  // ================================================================ 초중종물 검사 (+ 생산 시작 승인 인터락)
  App.pages.inproc = function (root) {
    var c = App.qCrud(root, {
      kind: 'inproc', title: '초중종물 검사', period: true, top: true,
      desc: '초품(생산 시작) · 중품 · 종품 · 금형수리 후 검사를 기록합니다. <b>초품 합격을 승인</b>해야 생산을 시작하는 것으로 봅니다. ' +
        '설정 · 백업에서 <b>초품 승인 인터락</b>을 켜면, 승인 기록이 없는 날·설비·제번은 생산실적을 넣을 수 없습니다.',
      cols: [
        { k: 'date', l: '일자', w: 80 }, { k: 'equip_no', l: '설비', w: 45, center: true }, { k: 'code', l: '제번', w: 95 },
        { k: 'lot_no', l: '생산 LOT', w: 100 }, { k: 'stage', l: '구분', w: 75, center: true, fmt: function (v) { return tag(v, { '초품': 'steel', '금형수리 후': 'warn' }); } },
        { k: 'reason', l: '사유', w: 90 }, { k: 'items', l: '측정 항목 · 결과', w: 260 },
        { k: 'result', l: '판정', w: 55, center: true, fmt: function (v) { return tag(v, RES); } },
        { k: 'inspector', l: '검사자', w: 65 },
        { k: 'approved_by', l: '승인', w: 110, fmt: function (v, r) { return v ? '<span class="tag ok">' + esc(v) + '</span> <span class="muted">' + esc((r.approved_at || '').slice(5, 16)) + '</span>' : (r.result === '합격' ? '<span class="tag warn">승인 대기</span>' : ''); } },
        { k: 'note', l: '비고', w: 120 }
      ],
      rowClass: function (r) { return r.result === '불합격' ? 'r-bad' : (r.result === '합격' && !r.approved_by ? 'r-warn' : ''); },
      defaults: function () { return { date: App.today(), stage: '초품', result: '합격', inspector: App.user }; },
      form: [
        { k: 'date', l: '일자', t: 'date', req: true }, { k: 'equip_no', l: '설비', t: 'ref', ref: 'equipment', req: true },
        { k: 'code', l: '제번', t: 'ref', ref: 'products', req: true }, { k: 'lot_no', l: '생산 LOT' },
        { k: 'stage', l: '구분', t: 'select', opts: ['초품', '중품', '종품', '금형수리 후'], req: true },
        { k: 'reason', l: '사유', t: 'select', opts: ['생산 시작', '금형 교체', '원재료 교체', '조건 변경', '정기', '금형 수리'] },
        { k: 'items', l: '측정 항목 · 결과 (치수 · 외관 · 버 등)', t: 'memo' },
        { k: 'result', l: '판정', t: 'select', opts: ['합격', '불합격', '조건부'] }, { k: 'inspector', l: '검사자', t: 'ref', ref: 'workers' },
        { k: 'note', l: '비고', t: 'memo' }
      ],
      buttons: [{ a: 'approve', label: '승인 (생산 시작)', level: 3, cls: 'primary', fn: function (r, reload) {
        App.confirm(r.date + ' ' + r.equip_no + '호기 ' + r.code + ' ' + r.stage + ' 검사를 승인할까요?', '승인').then(function (ok) {
          if (ok) App.api('POST', '/api/qx/inproc/' + r.id + '/approve').then(function () { App.toast('승인했습니다.'); reload(r.id); }).catch(App.err);
        });
      } }],
      onLoad: function (rows, top) {
        App.get('/api/settings').then(function (s) {
          var on = s.interlock_first === '1';
          var wait = rows.filter(function (r) { return r.result === '합격' && !r.approved_by; }).length;
          top.innerHTML = '<div class="notice" style="margin-bottom:8px">초품 승인 인터락: <b>' + (on ? '켜짐 — 승인 없으면 생산실적 입력 불가' : '꺼짐') + '</b>' +
            (wait ? ' · 승인 대기 <b>' + wait + '건</b>' : '') + '</div>';
        }).catch(function () { top.innerHTML = ''; });
      }
    });
    return c;
  };

  // ================================================================ 고객불만 · 8D
  var D8 = [['d1_team', 'D1 팀 구성'], ['d2_problem', 'D2 문제 기술'], ['d3_contain', 'D3 임시 조치 (봉쇄)'], ['d4_cause', 'D4 근본 원인'],
    ['d5_action', 'D5 영구 대책'], ['d6_verify', 'D6 대책 실행 · 검증'], ['d7_prevent', 'D7 재발 방지 (표준화)'], ['d8_close', 'D8 종결 · 팀 인정']];
  App.pages.claims = function (root) {
    var lv = App.curLevel || 0;
    root.innerHTML = '<div class="page-full"><div class="toolbar"><div class="seg"><button class="btn on" data-v="list">목록</button><button class="btn" data-v="stats">현황</button></div><span class="grow"></span></div><div data-box style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var box = root.querySelector('[data-box]');
    function list() {
      box.innerHTML = '';
      var host = document.createElement('div'); host.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0'; box.appendChild(host);
      App.qCrud(host, {
        kind: 'claims', title: '고객불만', period: true, detail: show,
        cols: [
          { k: 'claim_no', l: '번호', w: 95, mono: true }, { k: 'date', l: '접수일', w: 80 }, { k: 'customer', l: '고객', w: 90 },
          { k: 'code', l: '제번', w: 90 }, { k: 'lot_no', l: 'LOT', w: 90 }, { k: 'type', l: '유형', w: 60, center: true },
          { k: 'qty', l: '수량', t: 'int', w: 55 }, { k: 'cost', l: '비용', t: 'int', w: 70 },
          { k: 'step', l: '8D', w: 60, center: true, val: function (r) { return D8.filter(function (d) { return r[d[0]]; }).length; }, fmt: function (v) { return v + '/8'; } },
          { k: 'status', l: '상태', w: 55, center: true, fmt: function (v) { return tag(v, { '완료': 'ok', '진행': 'warn', '접수': 'bad' }); } },
          { k: 'due', l: '회신 기한', w: 80 }, { k: 'owner', l: '담당', w: 65 }
        ],
        rowClass: function (r) { return r.status !== '완료' && r.due && r.due < App.today() ? 'r-bad' : ''; },
        defaults: function () { return { date: App.today(), status: '접수', owner: App.user }; },
        form: [
          { k: 'date', l: '접수일', t: 'date', req: true }, { k: 'customer', l: '고객', req: true }, { k: 'code', l: '제번', t: 'ref', ref: 'products' },
          { k: 'lot_no', l: 'LOT' }, { k: 'type', l: '유형', t: 'select', opts: ['치수', '외관', '버', '변형', '혼입', '수량', '포장', '기타'] },
          { k: 'qty', l: '불량 수량', t: 'int' }, { k: 'cost', l: '비용 (F-cost)', t: 'int' }, { k: 'due', l: '회신 기한', t: 'date' },
          { k: 'owner', l: '담당', t: 'ref', ref: 'workers' }, { k: 'status', l: '상태', t: 'select', opts: ['접수', '진행', '완료'] },
          { k: 'closed', l: '종결일', t: 'date' }, { k: 'content', l: '불만 내용', t: 'memo' }
        ].concat(D8.map(function (d, i) { return { k: d[0], l: d[1], t: 'memo', grp: i === 0 ? '8D 진행' : undefined }; })).concat([{ k: 'note', l: '비고', t: 'memo' }])
      });
    }
    function show(r, right) {
      right.innerHTML = '<div class="panel-h">' + esc(r.claim_no || '') + ' ' + esc(r.customer || '') + '<span class="grow"></span>' + tag(r.status, { '완료': 'ok', '진행': 'warn', '접수': 'bad' }) + '</div><div class="panel-b">' +
        '<div class="kv" style="margin-bottom:10px"><span class="k">제번 / LOT</span><span>' + esc(r.code || '') + ' / ' + esc(r.lot_no || '') + '</span>' +
        '<span class="k">유형 · 수량</span><span>' + esc(r.type || '') + ' · ' + fmt(r.qty) + '</span><span class="k">내용</span><span style="white-space:pre-wrap">' + esc(r.content || '') + '</span></div>' +
        D8.map(function (d) { return '<div class="kind-box"><div class="h"><span>' + d[1] + '</span>' + (r[d[0]] ? '<span class="tag ok">완료</span>' : '<span class="tag gray">-</span>') + '</div><div style="white-space:pre-wrap">' + esc(r[d[0]] || '') + '</div></div>'; }).join('') +
        (r.lot_no ? '<div style="margin-top:8px"><button class="btn small" data-tr>이 LOT 역추적</button></div>' : '') + '</div>';
      var b = right.querySelector('[data-tr]');
      if (b) b.onclick = function () { App.go('rm_lot', { q: r.lot_no }); };
    }
    function stats() {
      var y = new Date().getFullYear();
      box.innerHTML = '<div class="muted">불러오는 중…</div>';
      App.get('/api/qx/claims/stats?year=' + y).then(function (s) {
        var mx = Math.max.apply(null, s.by_month.concat([1]));
        box.innerHTML = '<div style="overflow:auto"><div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
          '<div class="kpi"><div class="k-l">' + y + '년 고객불만</div><div class="k-v">' + s.total + '</div><div class="k-s">건</div></div>' +
          '<div class="kpi ' + (s.open ? 'bad' : '') + '"><div class="k-l">미결 (8D 진행 중)</div><div class="k-v">' + s.open + '</div><div class="k-s">건</div></div>' +
          '<div class="kpi"><div class="k-l">불만 비용 합계</div><div class="k-v">' + fmt(s.cost) + '</div><div class="k-s">원</div></div></div>' +
          '<div class="cols2" style="align-items:start;margin-top:12px"><div class="panel"><div class="panel-h">월별 발생</div><div class="panel-b"><table class="mini">' +
          s.by_month.map(function (n, i) { return '<tr><td style="width:40px">' + (i + 1) + '월</td><td><span class="hbar" style="width:' + Math.max(1, n / mx * 100) + '%"></span></td><td class="num" style="width:40px">' + n + '</td></tr>'; }).join('') +
          '</table></div></div><div class="panel"><div class="panel-h">유형별</div><div class="panel-b"><table class="mini">' +
          (s.by_type.map(function (t) { return '<tr><td>' + esc(t[0]) + '</td><td class="num">' + t[1] + '</td></tr>'; }).join('') || '<tr><td class="muted">없음</td></tr>') +
          '</table></div></div></div><div class="panel" style="margin-top:12px"><div class="panel-h">미결 8D 진행 현황</div><div class="panel-b"><table class="mini" style="width:100%"><tr><th>번호</th><th>고객</th><th>제번</th><th>진행</th><th>기한</th><th>담당</th></tr>' +
          (s.open_rows.map(function (r) { return '<tr><td>' + esc(r.claim_no) + '</td><td>' + esc(r.customer) + '</td><td>' + esc(r.code || '') + '</td><td>' + r.step + '/8 단계</td><td' + (r.due && r.due < App.today() ? ' style="color:var(--bad);font-weight:700"' : '') + '>' + esc(r.due || '') + '</td><td>' + esc(r.owner || '') + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="muted">미결 없음</td></tr>') +
          '</table></div></div></div>';
      }).catch(App.err);
    }
    root.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      App.$$('[data-v]', root).forEach(function (x) { x.classList.toggle('on', x === b); });
      if (b.dataset.v === 'list') list(); else stats();
    });
    list();
  };

  // ================================================================ 계측기 교정관리
  App.pages.gauges = function (root) {
    var ST = { '지남': 'bad', '임박': 'warn', '정상': 'ok' };
    App.qCrud(root, {
      kind: 'gauges', title: '계측기', detail: detail,
      desc: '계측기마다 <b>정기 검교정 주기</b>(외부 기관)와 <b>자체 점검 주기</b>(개월)를 넣으면 다음 예정일을 계산해 지난 것 · 30일 안에 올 것을 표시합니다. 오른쪽에서 검교정 · 점검 결과를 등록하세요.',
      sort: { k: 'due', dir: 1 },
      cols: [
        { k: 'due_state', l: '상태', w: 50, center: true, fmt: function (v) { return tag(v, ST); } },
        { k: 'gauge_no', l: '관리번호', w: 80, mono: true }, { k: 'name', l: '계측기명', w: 130 }, { k: 'spec', l: '규격 · 범위', w: 100 },
        { k: 'maker', l: '제조사', w: 80 }, { k: 'location', l: '위치', w: 70 }, { k: 'owner', l: '담당', w: 60 },
        { k: 'last_cal', l: '최근 검교정', w: 85 }, { k: 'next_cal', l: '다음 검교정', w: 85 },
        { k: 'last_check', l: '최근 점검', w: 85 }, { k: 'next_check', l: '다음 점검', w: 85 },
        { k: 'due', l: '남은 일수', t: 'int', w: 60, val: function (r) { var a = [r.cal_left, r.check_left].filter(function (x) { return x !== null && x !== undefined; }); return a.length ? Math.min.apply(null, a) : null; } },
        { k: 'status', l: '사용', w: 60 }
      ],
      rowClass: function (r) { return r.due_state === '지남' ? 'r-bad' : r.due_state === '임박' ? 'r-warn' : ''; },
      defaults: { cal_cycle: 12, check_cycle: 3, status: '사용' },
      form: [
        { k: 'gauge_no', l: '관리번호', req: true }, { k: 'name', l: '계측기명', req: true }, { k: 'spec', l: '규격 · 측정범위' },
        { k: 'maker', l: '제조사' }, { k: 'serial', l: '시리얼' }, { k: 'location', l: '보관 위치' }, { k: 'owner', l: '담당', t: 'ref', ref: 'workers' },
        { k: 'cal_cycle', l: '검교정 주기(개월)', t: 'int' }, { k: 'check_cycle', l: '자체 점검 주기(개월)', t: 'int' },
        { k: 'last_cal', l: '최근 검교정일', t: 'date' }, { k: 'last_check', l: '최근 점검일', t: 'date' },
        { k: 'status', l: '사용 상태', t: 'select', opts: ['사용', '사용중지', '폐기'] }, { k: 'note', l: '비고', t: 'memo' }
      ]
    });
    function detail(r, right, reload) {
      App.get('/api/qx/gauges/' + r.id + '/hist').then(function (h) {
        right.innerHTML = '<div class="panel-h">' + esc(r.gauge_no) + ' ' + esc(r.name) + '<span class="grow"></span>' + tag(r.due_state, ST) + '</div><div class="panel-b">' +
          '<div class="kv" style="margin-bottom:10px"><span class="k">다음 검교정</span><span>' + esc(r.next_cal || '-') + (r.cal_left != null ? ' (' + r.cal_left + '일)' : '') + '</span>' +
          '<span class="k">다음 점검</span><span>' + esc(r.next_check || '-') + (r.check_left != null ? ' (' + r.check_left + '일)' : '') + '</span></div>' +
          ((App.curLevel || 0) >= 2 ? '<div style="display:flex;gap:6px;margin-bottom:10px"><button class="btn small primary" data-k="검교정">+ 검교정 결과</button><button class="btn small" data-k="자체점검">+ 자체 점검</button></div>' : '') +
          '<table class="mini" style="width:100%"><tr><th>일자</th><th>구분</th><th>결과</th><th>기관 · 성적서</th><th class="num">비용</th><th>담당</th></tr>' +
          (h.map(function (x) { return '<tr title="' + esc(x.note || '') + '"><td>' + esc(x.date) + '</td><td>' + esc(x.kind) + '</td><td>' + tag(x.result, RES) + '</td><td>' + esc([x.agency, x.cert_no].filter(Boolean).join(' · ')) + '</td><td class="num">' + (x.cost ? fmt(x.cost) : '') + '</td><td>' + esc(x.worker || '') + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="muted">이력이 없습니다.</td></tr>') + '</table></div>';
        App.$$('[data-k]', right).forEach(function (b) {
          b.onclick = function () {
            App.form({
              title: r.gauge_no + ' ' + b.dataset.k, values: { date: App.today(), result: '합격', worker: App.user },
              cols: [{ k: 'date', l: '일자', t: 'date', req: true }, { k: 'result', l: '결과', t: 'select', opts: ['합격', '불합격'] },
                { k: 'agency', l: b.dataset.k === '검교정' ? '교정 기관' : '점검 방법' }, { k: 'cert_no', l: '성적서 번호' }, { k: 'cost', l: '비용', t: 'int' },
                { k: 'worker', l: '담당', t: 'ref', ref: 'workers' }, { k: 'note', l: '비고', t: 'memo' }],
              onSave: function (v) { v.kind = b.dataset.k; return App.api('POST', '/api/qx/gauges/' + r.id + '/hist', v).then(function () { App.toast('등록했습니다.'); reload(r.id); }); }
            });
          };
        });
      }).catch(App.err);
    }
  };

  // ================================================================ 품질문서 (CP · FMEA · 도면 · 검사기준서)
  App.pages.quality_docs = function (root) {
    var lv = App.curLevel || 0, KINDS = ['CP', 'FMEA', '도면', '검사기준서', '작업표준서', '기타'], data = null, view = 'list';
    root.innerHTML = '<div class="page-full"><div class="toolbar"><div class="seg"><button class="btn on" data-v="list">문서 목록</button><button class="btn" data-v="check">제품별 정합성</button></div>' +
      '<input class="input search" placeholder="제번 / 제목 검색"><label class="chk"><input type="checkbox" data-old> 옛 개정판도 보기</label><span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn primary" data-a="up">+ 문서 등록 · 개정</button>' : '') + (lv >= 3 ? '<button class="btn danger" data-a="del">삭제</button>' : '') +
      '<button class="btn" data-a="xlsx">엑셀로 저장</button></div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var gb = root.querySelector('.gridbox'), grid = null, search = root.querySelector('.search');
    function build() {
      gb.innerHTML = '';
      if (view === 'list') {
        grid = new App.Grid(gb, {
          cols: [{ k: 'current', l: '', w: 40, center: true, fmt: function (v) { return v ? '<span class="tag ok">최신</span>' : '<span class="tag gray">옛판</span>'; } },
            { k: 'kind', l: '종류', w: 70 }, { k: 'code', l: '제번', w: 95 }, { k: 'title', l: '제목', w: 200 }, { k: 'rev', l: '개정', w: 45, center: true },
            { k: 'rev_date', l: '개정일', w: 80 }, { k: 'file_name', l: '파일', w: 220, fmt: function (v, r) { return '<a href="/api/qx/docs/' + r.id + '/file">' + esc(v) + '</a>'; } },
            { k: 'file_size', l: 'KB', t: 'int', w: 55, val: function (r) { return Math.round((r.file_size || 0) / 1024); } }, { k: 'note', l: '개정 내용', w: 180 },
            { k: 'created_by', l: '등록', w: 60 }, { k: 'created', l: '등록일시', w: 110 }],
          extraFilter: function (r) { return root.querySelector('[data-old]').checked || r.current; },
          rowClass: function (r) { return r.current ? '' : 'r-dim'; }
        });
        grid.setRows(data.rows);
      } else {
        var k = data.check.kinds;
        grid = new App.Grid(gb, {
          cols: [{ k: 'code', l: '제번', w: 95 }, { k: 'name', l: '제품명', w: 200 }].concat(k.map(function (x) { return { k: x, l: x, w: 120, fmt: function (v) { return v ? esc(v) : '<span class="tag bad">없음</span>'; } }; }))
            .concat([{ k: 'nm', l: '빠진 문서', w: 70, t: 'int', val: function (r) { return r.missing.length; } }]),
          rowClass: function (r) { return r.missing.length ? 'r-warn' : ''; }, sort: { k: 'nm', dir: -1 }
        });
        grid.setRows(data.check.rows);
      }
      if (search.value) grid.setFilter(search.value);
    }
    function load() { App.get('/api/qx/docs').then(function (d) { data = d; build(); }).catch(App.err); }
    search.addEventListener('input', function () { grid.setFilter(search.value); });
    root.querySelector('[data-old]').onchange = function () { if (grid && view === 'list') grid.render(); };
    root.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      view = b.dataset.v; App.$$('[data-v]', root).forEach(function (x) { x.classList.toggle('on', x === b); }); build();
    });
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'xlsx') App.exportXlsx('품질문서_' + App.stamp() + '.xlsx', [grid.sheet(view === 'list' ? '품질문서' : '정합성')]);
      else if (a === 'del') {
        var r = grid.selected(); if (!r || view !== 'list') return App.toast('문서 목록에서 고르세요.', 'warn');
        App.confirm(r.kind + ' ' + (r.code || '') + ' ' + (r.title || '') + ' rev.' + (r.rev || '') + ' 을(를) 삭제할까요?', '삭제', true).then(function (ok) {
          if (ok) App.api('DELETE', '/api/qx/docs/' + r.id).then(load).catch(App.err);
        });
      } else if (a === 'up') {
        var sel = view === 'list' && grid.selected();
        var body = App.h('<div><div class="form">' +
          '<label class="f"><span>종류 *</span><select class="input" data-k="kind">' + KINDS.map(function (k) { return '<option' + (sel && sel.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
          '<label class="f"><span>제번</span><input class="input" data-k="code" list="' + App.datalist('products') + '" value="' + esc(sel ? sel.code : '') + '"></label>' +
          '<label class="f full"><span>제목</span><input class="input" data-k="title" value="' + esc(sel ? sel.title : '') + '"></label>' +
          '<label class="f"><span>개정 번호</span><input class="input" data-k="rev"></label>' +
          '<label class="f"><span>개정일</span><input class="input" type="date" data-k="rev_date" value="' + App.today() + '"></label>' +
          '<label class="f full"><span>개정 내용</span><input class="input" data-k="note"></label>' +
          '<label class="f full"><span>파일 *</span><input type="file" data-file></label></div>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">같은 종류 · 제번 · 제목으로 올리면 새 개정판이 최신이 되고 예전 것은 이력으로 남습니다.</div></div>');
        App.dialog({ title: '품질문서 등록 · 개정', body: body, buttons: [{ label: '취소' }, { label: '올리기', cls: 'primary', onClick: function (d) {
          var f = body.querySelector('[data-file]').files[0];
          if (!f) { d.error('파일을 고르세요.'); return; }
          var qs = ['kind', 'code', 'title', 'rev', 'rev_date', 'note'].map(function (k) { return k + '=' + encodeURIComponent(body.querySelector('[data-k=' + k + ']').value.trim()); }).join('&');
          d.busy(true);
          f.arrayBuffer().then(function (buf) { return App.api('POST', '/api/qx/docs?' + qs + '&name=' + encodeURIComponent(f.name), buf); })
            .then(function () { d.close(); App.toast('문서를 등록했습니다.'); load(); }).catch(function (e) { d.busy(false); d.error(e.message); });
        } }] });
      }
    });
    load();
  };

  // ================================================================ 코일 LOT 추적
  App.pages.rmlot = function (root, args) {
    root.innerHTML = '<div class="page-full"><div class="toolbar"><b>LOT 역추적</b><input class="input" data-q placeholder="코일 LOT · 생산 LOT · 성적서 번호" style="width:240px">' +
      '<button class="btn primary" data-a="trace">찾기</button><span class="muted" style="font-size:12px">불량이 나면 언제 · 어느 코일로 · 누가 만들었는지 한 번에 찾습니다</span></div>' +
      '<div data-trace></div><h3 style="margin:10px 0 6px">코일 LOT 목록</h3><div data-list style="flex:1;display:flex;flex-direction:column;min-height:320px"></div></div>';
    var tr = root.querySelector('[data-trace]'), qi = root.querySelector('[data-q]');
    App.qCrud(root.querySelector('[data-list]'), {
      kind: 'lots', title: '코일 LOT', period: true,
      desc: '수입검사를 합격으로 저장하면 자동으로 생깁니다. 생산실적을 넣을 때 <b>원재료 코일 LOT</b> 칸에 이 번호를 적으면 연결됩니다.',
      cols: [{ k: 'lot_no', l: '코일 LOT', w: 120, mono: true }, { k: 'mat_code', l: '자재번호', w: 80 }, { k: 'maker', l: '공급사', w: 90 },
        { k: 'spec', l: '규격', w: 100 }, { k: 'thickness', l: '두께', t: 'num', w: 50 }, { k: 'width', l: '폭', t: 'num', w: 50 },
        { k: 'in_date', l: '입고일', w: 80 }, { k: 'in_weight', l: '입고 kg', t: 'num', w: 65 }, { k: 'remain_weight', l: '남은 kg', t: 'num', w: 65 },
        { k: 'cert_no', l: '성적서', w: 100 }, { k: 'status', l: '상태', w: 60, center: true, fmt: function (v) { return tag(v, { '입고': 'ok', '사용중': 'steel', '소진': 'gray', '불합격': 'bad' }); } },
        { k: 'note', l: '비고', w: 120 }],
      defaults: function () { return { in_date: App.today(), status: '입고' }; },
      form: [{ k: 'lot_no', l: '코일 LOT', req: true }, { k: 'mat_code', l: '자재번호' }, { k: 'mat_desc', l: '자재내역' }, { k: 'maker', l: '공급사' },
        { k: 'spec', l: '규격' }, { k: 'thickness', l: '두께', t: 'num' }, { k: 'width', l: '폭', t: 'num' }, { k: 'in_date', l: '입고일', t: 'date' },
        { k: 'in_weight', l: '입고 kg', t: 'num' }, { k: 'remain_weight', l: '남은 kg', t: 'num' }, { k: 'cert_no', l: '성적서 번호' },
        { k: 'status', l: '상태', t: 'select', opts: ['입고', '사용중', '소진', '불합격'] }, { k: 'note', l: '비고', t: 'memo' }],
      buttons: [{ a: 'tr1', label: '고른 LOT 추적', level: 1, fn: function (r) { qi.value = r.lot_no; trace(); } }]
    });
    function sec(title, rows, cols) {
      return '<div class="panel" style="margin-bottom:8px"><div class="panel-h">' + title + ' <span class="muted" style="font-weight:400">' + rows.length + '건</span></div><div class="panel-b">' +
        (rows.length ? '<div class="scroll" style="max-height:220px"><table class="mini" style="width:100%"><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr>' +
          rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = typeof c[0] === 'function' ? c[0](r) : r[c[0]]; return '<td>' + esc(v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>' : '<div class="muted">없음</div>') + '</div></div>';
    }
    function trace() {
      var q = qi.value.trim(); if (!q) { tr.innerHTML = ''; return; }
      tr.innerHTML = '<div class="muted">찾는 중…</div>';
      App.get('/api/qx/trace?q=' + encodeURIComponent(q)).then(function (d) {
        tr.innerHTML = '<div class="notice" style="margin-bottom:8px"><b>' + esc(q) + '</b> → 코일 ' + d.lots.length + ' · 생산 ' + d.production.length + ' · 공정불량 ' + d.defects.length + ' · 고객불만 ' + d.claims.length +
          (d.equips.length ? ' · 설비 ' + esc(d.equips.join(', ')) + '호기' : '') + (d.workers.length ? ' · 작업자 ' + esc(d.workers.join(', ')) : '') + '</div>' +
          '<div class="cols2" style="align-items:start">' +
          '<div>' + sec('① 원재료 코일', d.lots, [['lot_no', 'LOT'], ['mat_code', '자재'], ['maker', '공급사'], ['in_date', '입고'], ['status', '상태']]) +
          sec('② 수입검사', d.incoming, [['date', '일자'], ['lot_no', 'LOT'], ['result', '판정'], ['inspector', '검사자']]) +
          sec('③ 초중종물 검사', d.inproc, [['date', '일자'], ['equip_no', '설비'], ['code', '제번'], ['stage', '구분'], ['result', '판정'], ['approved_by', '승인']]) + '</div>' +
          '<div>' + sec('④ 생산실적', d.production, [['date', '날짜'], ['equip_no', '설비'], ['code', '제번'], ['lot_no', '생산 LOT'], ['coil_lot', '코일 LOT'],
            [function (r) { return [r.day_worker, r.night_worker].filter(Boolean).join('/'); }, '작업자']]) +
          sec('⑤ 공정불량', d.defects, [['date', '날짜'], ['code', '제번'], ['lot_no', 'LOT'], ['defect_code', '불량'], ['qty', '수량'], ['worker', '작업자']]) +
          sec('⑥ 고객불만', d.claims, [['claim_no', '번호'], ['date', '접수'], ['customer', '고객'], ['type', '유형'], ['status', '상태']]) + '</div></div>';
      }).catch(App.err);
    }
    root.querySelector('[data-a=trace]').onclick = trace;
    qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') trace(); });
    if (args && args.q) { qi.value = args.q; trace(); }
  };
})();
