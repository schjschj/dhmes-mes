/* [연동] 거래명세서 앱(dhmes-receipt) — 구매관리 화면
   금형부품 명세서(무경 · 다온 → 금형부품 재고 자동 입고, 못 찾은 품목 처리) / 일반 거래명세서(업체 · 품목별 정리)
   서버: /api/purchases/inbound (앱 → MES), /api/rc/*, /api/invoice/{id}/file · DELETE (입고 되돌림) */
(function () {
  'use strict';
  var esc = App.esc, fmt = App.fmt;
  function tag(v, map) { return v ? '<span class="tag ' + (map[v] || '') + '">' + esc(v) + '</span>' : ''; }
  function won(v) { return v === null || v === undefined || v === '' ? '' : fmt(Math.round(v)); }
  var ST = { '입고 완료': 'ok', '확인 필요': 'bad', '등록': 'steel' };
  var MT = { '자동 입고': 'ok', '수동 입고': 'ok', '새 부품 입고': 'ok', '확인 필요': 'bad', '입고 안 함': 'gray' };

  function head(r) {
    return '<div class="kv" style="margin-bottom:8px"><span class="k">공급자</span><span><b>' + esc(r.supplier || '') + '</b> <span class="muted">' + esc(r.supplier_biz || '') + '</span></span>' +
      '<span class="k">거래일 · 번호</span><span>' + esc(r.date || '') + (r.doc_no ? ' · ' + esc(r.doc_no) : '') + '</span>' +
      '<span class="k">금액</span><span>공급 ' + won(r.supply) + ' · 세액 ' + won(r.vat) + ' · <b>합계 ' + won(r.total) + '</b></span>' +
      '<span class="k">입력</span><span>' + esc(r.src || '') + ' · ' + esc(r.worker || r.created_by || '') + (r.receiver ? ' · 인수자 ' + esc(r.receiver) : '') + ' <span class="muted">' + esc((r.created || '').slice(0, 16)) + '</span></span>' +
      (r.note ? '<span class="k">메모</span><span style="white-space:pre-wrap">' + esc(r.note) + '</span>' : '') + '</div>';
  }
  function imgLink(r) { return r.has_file ? '<a class="btn small" target="_blank" href="/api/invoice/' + r.id + '/file">명세서 사진</a>' : ''; }

  // 연동 설정 (관리자): 금형부품 업체 · 연동 키
  function cfgDialog() {
    App.get('/api/rc/cfg').then(function (c) {
      var body = App.h('<div><div class="form">' +
        '<label class="f full"><span>금형부품 업체 (상호에 이 글자가 들어가면 금형부품 명세서 → 자동 입고, 한 줄에 하나)</span><textarea class="input" rows="3" data-sup>' + esc(c.mold_suppliers.join('\n')) + '</textarea></label>' +
        '<label class="f full"><span>연동 키 (명세서 앱 .env 의 MES_API_KEY)</span><input class="input" readonly data-key value="' + esc(c.api_key || '(아직 없음 — [새 키 발급])') + '"></label></div>' +
        '<div class="notice" style="margin-top:8px;line-height:1.7">명세서 앱(dhmes-receipt) 의 <b>.env</b> 에 아래 두 줄을 넣고 앱을 다시 켜세요.<br>' +
        '<code>MES_API_BASE_URL=' + esc(location.origin) + '/api</code><br><code>MES_API_KEY=' + esc(c.api_key || '(발급한 키)') + '</code><br>' +
        '<span class="muted">새 키를 발급하면 예전 키로는 보낼 수 없습니다.</span></div></div>');
      App.dialog({ title: '거래명세서 앱 연동 설정', body: body, wide: true, buttons: [
        { label: '닫기' },
        { label: '새 키 발급', onClick: function (d) {
          App.confirm('새 연동 키를 발급할까요? 명세서 앱의 MES_API_KEY 도 바꿔야 합니다.', '발급').then(function (ok) {
            if (ok) App.api('PUT', '/api/rc/cfg', { new_key: true }).then(function () { d.close(); cfgDialog(); }).catch(App.err);
          });
        } },
        { label: '저장', cls: 'primary', onClick: function (d) {
          App.api('PUT', '/api/rc/cfg', { mold_suppliers: body.querySelector('[data-sup]').value }).then(function () { d.close(); App.toast('저장했습니다.'); }).catch(function (e) { d.error(e.message); });
        } }] });
    }).catch(App.err);
  }

  function listPage(root, o) {
    var lv = App.curLevel || 0;
    root.innerHTML = '<div class="page-full"><div class="desc">' + o.desc + '</div>' +
      '<div class="toolbar">' + (o.seg || '') + '<span data-period style="display:contents"></span><input class="input search" placeholder="업체 · 품목 검색"><span class="grow"></span>' +
      (App.meta && App.meta.me && App.meta.me.admin ? '<button class="btn" data-a="cfg">연동 설정</button>' : '') +
      (lv >= 3 ? '<button class="btn danger" data-a="del">삭제</button>' : '') + '<button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
      '<div data-top></div><div data-box style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('rc_p_' + o.kind, { d1: App.addDays(-60), d2: App.today() }), function (p) { App.store.set('rc_p_' + o.kind, p); o.reload(); });
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'cfg') cfgDialog();
      else if (a === 'xlsx' && o.grid()) App.exportXlsx(o.title + '_' + App.stamp() + '.xlsx', [o.grid().sheet(o.title)]);
      else if (a === 'del') {
        var r = o.grid() && o.grid().selected(); if (!r || !r.supplier) return App.toast('목록에서 명세서를 먼저 고르세요.', 'warn');
        App.confirm(r.supplier + ' ' + r.date + ' 명세서를 삭제할까요?' + (o.kind === '금형부품' ? '\n자동 · 수동으로 입고한 부품 수량도 되돌립니다.' : ''), '삭제', true).then(function (ok) {
          if (ok) App.api('DELETE', '/api/invoice/' + r.id).then(function () { App.toast('삭제했습니다.'); o.reload(); }).catch(App.err);
        });
      }
    });
    root.querySelector('.search').addEventListener('input', function () { if (o.grid()) o.grid().setFilter(this.value); });
    return { period: period, top: root.querySelector('[data-top]'), box: root.querySelector('[data-box]'), search: root.querySelector('.search') };
  }

  // ================================================================ 금형부품 명세서 (자동 입고)
  App.pages.rc_mold = function (root) {
    var lv = App.curLevel || 0, grid = null, onlyPending = false, cur = null;
    var ui = listPage(root, {
      kind: '금형부품', title: '금형부품명세서',
      desc: '휴대폰 <b>거래명세서 앱</b>에서 확정한 <b>금형부품 업체(무경 · 다온 등)</b> 명세서는 품목의 <b>금형번호 + 부품번호(NO · 품번)</b>로 금형부품 재고에서 부품을 찾아 <b>자동으로 입고</b>합니다 (수량 · 단가 · 구입처). ' +
        '부품을 못 찾은 품목은 <b style="color:var(--bad)">확인 필요</b>로 남으니, 오른쪽에서 부품을 고르거나 새 부품으로 등록하면 입고됩니다.',
      seg: '<div class="seg"><button class="btn on" data-v="all">전체</button><button class="btn" data-v="pending">확인 필요만</button></div>',
      grid: function () { return grid; }, reload: function () { load(); }
    });
    ui.box.innerHTML = '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">명세서를 고르면 품목과 입고 결과가 보입니다.</div></div></div>';
    var right = ui.box.querySelector('.right');
    grid = new App.Grid(ui.box.querySelector('.left'), {
      cols: [{ k: 'date', l: '거래일', w: 80 }, { k: 'supplier', l: '공급자', w: 100 }, { k: 'items', l: '품목', w: 180 }, { k: 'n', l: '품목수', t: 'int', w: 45 },
        { k: 'total', l: '합계', t: 'int', w: 80 }, { k: 'status', l: '입고', w: 70, center: true, fmt: function (v, r) { return tag(v, ST) + (r.pending ? ' <b style="color:var(--bad)">' + r.pending + '</b>' : ''); } },
        { k: 'src', l: '입력', w: 70 }],
      sort: { k: 'date', dir: -1 }, extraFilter: function (r) { return !onlyPending || r.pending > 0; },
      rowClass: function (r) { return r.pending ? 'r-bad' : ''; }, onSelect: function (r) { show(r.id); }
    });
    ui.search.oninput = function () { grid.setFilter(this.value); };
    root.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      App.$$('.seg [data-v]', root).forEach(function (x) { x.classList.toggle('on', x === b); });
      onlyPending = b.dataset.v === 'pending'; grid.render();
    });
    function load() {
      var p = ui.period.get();
      App.get('/api/rc/list?kind=' + encodeURIComponent('금형부품') + '&d1=' + (p.d1 || '') + '&d2=' + (p.d2 || '')).then(function (rows) {
        grid.setRows(rows);
        var n = rows.reduce(function (a, r) { return a + (r.pending || 0); }, 0);
        ui.top.innerHTML = '<div class="wo-nums" style="margin-bottom:8px"><span><b>' + rows.length + '</b>명세서</span><span><b>' + fmt(rows.reduce(function (a, r) { return a + (r.total || 0); }, 0)) + '</b>합계 금액</span>' +
          '<span><b class="' + (n ? 'bad-t' : '') + '">' + n + '</b>확인 필요 품목</span></div>';
        if (cur) show(cur);
      }).catch(App.err);
    }
    function show(id) {
      cur = id;
      App.get('/api/rc/' + id).then(function (d) {
        var r = d.inv;
        right.innerHTML = '<div class="panel-h">' + esc(r.supplier || '') + ' ' + esc(r.date || '') + '<span class="grow"></span>' + imgLink(r) + ' ' + tag(r.status, ST) + '</div><div class="panel-b">' + head(r) +
          '<table class="mini" style="width:100%"><tr><th>#</th><th>품목 (금형)</th><th>NO</th><th>수량</th><th>단가</th><th>금액</th><th>결과</th><th>재고 부품</th>' + (lv >= 2 ? '<th></th>' : '') + '</tr>' +
          d.items.map(function (t) {
            var pend = t.match === '확인 필요';
            return '<tr' + (pend ? ' style="background:#fdeeee"' : '') + '><td>' + t.seq + '</td><td>' + esc(t.item) + '</td><td><b>' + esc(t.part_code || t.spec || '') + '</b></td><td class="num">' + fmt(t.qty) +
              '</td><td class="num">' + won(t.unit_price) + '</td><td class="num">' + won(t.amount) + '</td><td>' + tag(t.match || '', MT) + '</td>' +
              '<td>' + (t.part_id ? esc((t.p_mold || '') + ' · ' + (t.p_code || '') + ' ' + (t.p_name || '')) + ' <span class="muted">(재고 ' + fmt(t.p_qty) + ')</span>' :
                (t.cands && t.cands.length ? '<span class="muted">후보 ' + t.cands.length + '개</span>' : '<span class="muted">못 찾음</span>')) + '</td>' +
              (lv >= 2 ? '<td>' + (pend ? '<button class="btn small primary" data-fix="' + t.id + '">처리</button>' : '') + '</td>' : '') + '</tr>';
          }).join('') + '</table>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">입고된 수량은 <b>금형관리 &gt; 금형부품 재고 · 입출고 이력</b>에 "거래명세서 자동 입고"로 남습니다. 명세서를 삭제하면 입고도 되돌립니다.</div></div>';
        App.$$('[data-fix]', right).forEach(function (b) {
          b.onclick = function () { fix(d.items.filter(function (t) { return String(t.id) === b.dataset.fix; })[0], r); };
        });
      }).catch(App.err);
    }
    function fix(t, inv) {
      App.get('/api/rc/parts?mold=' + encodeURIComponent(t.mold_no || '')).then(function (pp) {
        var list = pp.parts;
        var body = App.h('<div><div class="notice" style="margin-bottom:8px">' + esc(inv.supplier) + ' · ' + esc(t.item) + ' / NO <b>' + esc(t.part_code || t.spec || '') + '</b> · 수량 ' + fmt(t.qty) + ' · 단가 ' + won(t.unit_price) + '</div>' +
          '<div class="seg" style="margin-bottom:8px"><button class="btn on" data-m="pick">재고 부품 고르기</button><button class="btn" data-m="new">새 부품으로 등록</button><button class="btn" data-m="skip">입고 안 함</button></div>' +
          '<div data-pane="pick"><div class="muted" style="font-size:12px;margin-bottom:4px">금형 ' + esc(pp.molds.join(', ') || t.mold_no || '-') + ' 의 부품 ' + list.length + '개' + (list.length ? '' : ' — 다른 금형이면 아래에 부품 번호(#)를 직접 입력') + '</div>' +
          '<input class="input" placeholder="찾기 (코드 · 이름)" data-q style="margin-bottom:6px;width:100%">' +
          '<div class="scroll" style="max-height:260px"><table class="mini" style="width:100%" data-plist></table></div>' +
          '<div class="form" style="margin-top:6px"><label class="f"><span>부품 번호 (#)</span><input class="input" data-pid></label><label class="f"><span>입고 수량</span><input class="input" data-qty value="' + esc(t.qty) + '"></label></div></div>' +
          '<div data-pane="new" style="display:none"><div class="form"><label class="f"><span>사용 금형</span><input class="input" data-nm value="' + esc(t.mold_no || '') + '" list="' + App.datalist('molds') + '"></label>' +
          '<label class="f"><span>부품코드</span><input class="input" data-nc value="' + esc(t.part_code || '') + '"></label>' +
          '<label class="f full"><span>부품명</span><input class="input" data-nn value="' + esc(t.item || '') + '"></label>' +
          '<label class="f"><span>입고 수량</span><input class="input" data-nq value="' + esc(t.qty) + '"></label></div></div>' +
          '<div data-pane="skip" style="display:none"><label class="f full"><span>입고하지 않는 이유 (수리비 · 가공비 등)</span><input class="input" data-sn></label></div></div>');
        var mode = 'pick';
        function drawList() {
          var q = body.querySelector('[data-q]').value.trim().toLowerCase();
          var rows = list.filter(function (p) { return !q || ((p.code || '') + ' ' + (p.name || '') + ' ' + (p.mold_no || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 200);
          body.querySelector('[data-plist]').innerHTML = '<tr><th>#</th><th>금형</th><th>코드</th><th>부품명</th><th>재고</th></tr>' + rows.map(function (p) {
            return '<tr data-p="' + p.id + '" style="cursor:pointer"><td>' + p.id + '</td><td>' + esc(p.mold_no || '') + '</td><td><b>' + esc(p.code || '') + '</b></td><td>' + esc(p.name || '') + '</td><td class="num">' + fmt(p.qty) + '</td></tr>';
          }).join('');
        }
        drawList();
        body.querySelector('[data-q]').oninput = drawList;
        body.querySelector('[data-plist]').onclick = function (e) {
          var tr = e.target.closest('[data-p]'); if (!tr) return;
          App.$$('[data-p]', body).forEach(function (x) { x.style.background = x === tr ? '#e3edfc' : ''; });
          body.querySelector('[data-pid]').value = tr.dataset.p;
        };
        body.querySelector('.seg').onclick = function (e) {
          var b = e.target.closest('[data-m]'); if (!b) return;
          mode = b.dataset.m;
          App.$$('.seg [data-m]', body).forEach(function (x) { x.classList.toggle('on', x === b); });
          App.$$('[data-pane]', body).forEach(function (x) { x.style.display = x.dataset.pane === mode ? '' : 'none'; });
        };
        App.dialog({ title: '확인 필요 품목 처리', body: body, wide: true, buttons: [{ label: '취소' }, { label: '저장', cls: 'primary', onClick: function (d) {
          var v = mode === 'pick' ? { action: 'pick', part_id: body.querySelector('[data-pid]').value.trim(), qty: body.querySelector('[data-qty]').value }
            : mode === 'new' ? { action: 'new', mold_no: body.querySelector('[data-nm]').value, code: body.querySelector('[data-nc]').value, name: body.querySelector('[data-nn]').value, qty: body.querySelector('[data-nq]').value }
              : { action: 'skip', note: body.querySelector('[data-sn]').value };
          if (mode === 'pick' && !v.part_id) return d.error('부품을 고르세요.');
          d.busy(true);
          App.api('POST', '/api/rc/item/' + t.id + '/resolve', v).then(function (r) {
            d.close(); App.toast(mode === 'skip' ? '입고하지 않음으로 처리했습니다.' : '입고했습니다 → 현재고 ' + fmt(r.qty)); App.refreshBadges(); load();
          }).catch(function (e) { d.busy(false); d.error(e.message); });
        } }] });
      }).catch(App.err);
    }
    load();
  };

  // ================================================================ 일반 거래명세서
  App.pages.rc_general = function (root) {
    var lv = App.curLevel || 0, grid = null, view = App.store.get('rcg_view', 'list'), cur = null;
    var ui = listPage(root, {
      kind: '일반', title: '일반거래명세서',
      desc: '금형부품 업체가 아닌 명세서(포장재 · 소모품 · 공구 · 사무용품 · 외주가공 등)를 모아 정리합니다. 거래명세서 앱에서 확정하면 자동으로 들어오고, 틀린 글자는 <b>[정정]</b>으로 고칩니다.',
      seg: '<div class="seg"><button class="btn' + (view === 'list' ? ' on' : '') + '" data-v="list">명세서 목록</button><button class="btn' + (view === 'sup' ? ' on' : '') + '" data-v="sup">업체별 정리</button>' +
        '<button class="btn' + (view === 'item' ? ' on' : '') + '" data-v="item">품목별 정리</button></div>',
      grid: function () { return grid; }, reload: function () { load(); }
    });
    root.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      App.$$('.seg [data-v]', root).forEach(function (x) { x.classList.toggle('on', x === b); });
      view = b.dataset.v; App.store.set('rcg_view', view); load();
    });
    function mk(o) { ui.box.innerHTML = ''; var h = document.createElement('div'); h.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0'; ui.box.appendChild(h); grid = new App.Grid(h, o); grid.setFilter(ui.search.value); return grid; }
    function load() {
      var p = ui.period.get(), qs = 'd1=' + (p.d1 || '') + '&d2=' + (p.d2 || '');
      if (view === 'list') {
        App.get('/api/rc/list?kind=' + encodeURIComponent('일반') + '&' + qs).then(function (rows) {
          ui.top.innerHTML = '<div class="wo-nums" style="margin-bottom:8px"><span><b>' + rows.length + '</b>명세서</span><span><b>' + fmt(rows.reduce(function (a, r) { return a + (r.total || 0); }, 0)) + '</b>합계 금액 (원)</span>' +
            '<span><b>' + Object.keys(rows.reduce(function (a, r) { a[r.supplier] = 1; return a; }, {})).length + '</b>업체</span></div>';
          ui.box.innerHTML = '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">명세서를 고르면 품목이 보입니다.</div></div></div>';
          var right = ui.box.querySelector('.right');
          grid = new App.Grid(ui.box.querySelector('.left'), {
            cols: [{ k: 'date', l: '거래일', w: 80 }, { k: 'supplier', l: '공급자', w: 110 }, { k: 'items', l: '품목', w: 220 }, { k: 'n', l: '품목수', t: 'int', w: 45 },
              { k: 'supply', l: '공급가액', t: 'int', w: 80 }, { k: 'vat', l: '세액', t: 'int', w: 65 }, { k: 'total', l: '합계', t: 'int', w: 85 }, { k: 'src', l: '입력', w: 70 }],
            sort: { k: 'date', dir: -1 }, onSelect: function (r) { show(r.id, right); }
          });
          grid.setRows(rows); grid.setFilter(ui.search.value);
          if (cur) grid.selectKey(cur);
        }).catch(App.err);
      } else App.get('/api/rc/summary?' + qs).then(function (s) {
        var mx = Math.max.apply(null, s.months.map(function (m) { return m.amount; }).concat([1]));
        ui.top.innerHTML = s.months.length ? '<div class="panel" style="margin-bottom:8px"><div class="panel-b"><div class="muted" style="font-size:12px">월별 구매 금액</div><table class="mini">' + s.months.map(function (m) {
          return '<tr><td style="width:70px">' + esc(m.ym) + '</td><td style="width:60%"><span class="hbar" style="width:' + Math.max(1, m.amount / mx * 100) + '%"></span></td><td class="num">' + fmt(m.amount) + '</td></tr>';
        }).join('') + '</table></div></div>' : '';
        if (view === 'sup') mk({ key: 'supplier', cols: [{ k: 'supplier', l: '업체', w: 140 }, { k: 'n', l: '명세서', t: 'int', w: 60 }, { k: 'items', l: '품목 줄', t: 'int', w: 60 },
          { k: 'amount', l: '합계 금액', t: 'int', w: 100 }, { k: 'last', l: '최근 거래', w: 85 }], sort: { k: 'amount', dir: -1 } }).setRows(s.suppliers);
        else {
          s.items.forEach(function (x, i) { x.id = i; });
          mk({ cols: [{ k: 'item', l: '품목', w: 180 }, { k: 'spec', l: '규격', w: 120 }, { k: 'n', l: '구매(회)', t: 'int', w: 55 }, { k: 'qty', l: '수량', t: 'num', w: 65 },
            { k: 'amount', l: '금액', t: 'int', w: 90 }, { k: 'last_price', l: '최근 단가', t: 'int', w: 75 }, { k: 'last', l: '최근', w: 80 }, { k: 'suppliers', l: '업체', w: 160 }],
          sort: { k: 'amount', dir: -1 } }).setRows(s.items);
        }
      }).catch(App.err);
    }
    function show(id, right) {
      cur = id;
      App.get('/api/rc/' + id).then(function (d) {
        var r = d.inv;
        right.innerHTML = '<div class="panel-h">' + esc(r.supplier || '') + ' ' + esc(r.date || '') + '<span class="grow"></span>' + imgLink(r) + (lv >= 2 ? ' <button class="btn small" data-edit>정정</button>' : '') + '</div><div class="panel-b">' + head(r) +
          '<table class="mini" style="width:100%"><tr><th>#</th><th>품목</th><th>규격</th><th>단위</th><th>수량</th><th>단가</th><th>공급가액</th><th>비고</th></tr>' +
          d.items.map(function (t) {
            return '<tr><td>' + t.seq + '</td><td>' + esc(t.item) + '</td><td>' + esc(t.spec || '') + '</td><td>' + esc(t.unit || '') + '</td><td class="num">' + fmt(t.qty) + '</td><td class="num">' + won(t.unit_price) +
              '</td><td class="num">' + won(t.amount) + '</td><td>' + esc(t.note || '') + '</td></tr>';
          }).join('') + '</table></div>';
        var b = right.querySelector('[data-edit]'); if (b) b.onclick = function () { edit(d); };
      }).catch(App.err);
    }
    function edit(d) {
      var r = d.inv;
      var body = App.h('<div><div class="form"><label class="f"><span>거래일</span><input type="date" class="input" data-h="date" value="' + esc(r.date || '') + '"></label>' +
        '<label class="f"><span>공급자</span><input class="input" data-h="supplier" value="' + esc(r.supplier || '') + '"></label>' +
        '<label class="f"><span>명세서 번호</span><input class="input" data-h="doc_no" value="' + esc(r.doc_no || '') + '"></label>' +
        '<label class="f full"><span>메모</span><input class="input" data-h="note" value="' + esc(r.note || '') + '"></label></div>' +
        '<table class="inv-t" style="margin-top:8px"><tr><th>품목</th><th>규격</th><th>단위</th><th>수량</th><th>단가</th><th>공급가액</th><th>비고</th></tr>' +
        d.items.map(function (t) {
          return '<tr data-id="' + t.id + '">' + ['item', 'spec', 'unit', 'qty', 'unit_price', 'amount', 'note'].map(function (k) {
            return '<td><input data-k="' + k + '" value="' + esc(t[k] === null || t[k] === undefined ? '' : t[k]) + '"' + (/qty|price|amount/.test(k) ? ' style="text-align:right"' : '') + '></td>';
          }).join('') + '</tr>';
        }).join('') + '</table></div>');
      App.dialog({ title: '거래명세서 정정', body: body, wide: true, buttons: [{ label: '취소' }, { label: '저장', cls: 'primary', onClick: function (dl) {
        var v = { items: [] };
        App.$$('[data-h]', body).forEach(function (el) { v[el.dataset.h] = el.value; });
        App.$$('tr[data-id]', body).forEach(function (tr) { var o = { id: +tr.dataset.id }; App.$$('[data-k]', tr).forEach(function (el) { o[el.dataset.k] = el.value; }); v.items.push(o); });
        App.api('PUT', '/api/rc/' + r.id, v).then(function () { dl.close(); App.toast('정정했습니다.'); load(); }).catch(function (e) { dl.error(e.message); });
      } }] });
    }
    load();
  };
})();
