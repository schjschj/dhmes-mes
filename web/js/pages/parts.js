/* 금형부품 재고: 입고 / 출고 / 재고조정, 안전재고 */
App.pages.parts = function (root, args) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<input class="input search" placeholder="부품명 / 규격 / 금형 검색">' +
    '<select class="input" data-f="mold"><option value="">전체 금형</option></select>' +
    '<select class="input" data-f="cat"><option value="">전체 구분</option></select>' +
    '<label class="chk"><input type="checkbox" data-f="short"> 안전재고 미달만</label>' +
    '<span class="sep"></span>' +
    '<button class="btn in" data-a="입고">입고</button>' +
    '<button class="btn out" data-a="출고">출고</button>' +
    '<button class="btn" data-a="조정">재고조정(실사)</button>' +
    '<span class="grow"></span>' +
    '<button class="btn primary" data-a="add">+ 부품 등록</button>' +
    '<button class="btn" data-a="edit">수정</button>' +
    '<button class="btn danger" data-a="del">삭제</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div>' +
    '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">부품을 선택하면 입출고 내역이 보입니다.</div></div></div></div>';
  var right = root.querySelector('.right');
  var stOrder = { '품절': 0, '미달': 1, '주의': 2, '정상': 3 };
  var cols = [
    { k: 'state', l: '상태', w: 50, fmt: function (v, r) { return App.stateTag(r.state); }, val: function (r) { return stOrder[r.state]; }, xval: function (r) { return r.state; } },
    { k: 'code', l: '부품코드', w: 70, mono: true },
    { k: 'name', l: '부품명', w: 140 },
    { k: 'category', l: '구분', w: 70 },
    { k: 'spec', l: '규격', w: 100 },
    { k: 'material', l: '재질', w: 55 },
    { k: 'mold_label', l: '사용금형', w: 80, fmt: function (v, r) { return App.esc(v) + (r.mold_base && r.mold_base !== r.mold_label ? ' <span class="muted" title="모체 금형">(' + App.esc(r.mold_base) + ')</span>' : ''); } },
    { k: 'mold_part_name', l: '금형 품명', w: 140 },
    { k: 'qty', l: '현재고', t: 'int', w: 55, fmt: function (v) { return '<b>' + App.fmt(v) + '</b>'; } },
    { k: 'safety_qty', l: '안전재고', t: 'int', w: 55 },
    { k: 'short', l: '부족', t: 'int', w: 45, fmt: function (v) { return v ? '<b style="color:var(--bad)">' + App.fmt(v) + '</b>' : ''; } },
    { k: 'unit', l: '단위', w: 40 },
    { k: 'price', l: '단가', t: 'int', w: 65 },
    { k: 'amount', l: '재고금액', t: 'int', w: 80 },
    { k: 'maker', l: '제조사/구입처', w: 90 },
    { k: 'location', l: '보관위치', w: 65 },
    { k: 'last_out', l: '최근 출고', w: 80 },
    { k: 'note', l: '비고', w: 120 }
  ].concat(App.auditCols());
  var grid = new App.Grid(root.querySelector('.left'), {
    cols: cols, sort: { k: 'state', dir: 1 }, hint: '두 번 클릭하면 출고',
    rowClass: function (r) { return r.state === '품절' || r.state === '미달' ? 'r-bad' : r.state === '주의' ? 'r-warn' : ''; },
    extraFilter: function (r) {
      var m = root.querySelector('[data-f=mold]').value, c = root.querySelector('[data-f=cat]').value;
      if (m && (m.indexOf('g:') === 0 ? r.mold_base !== m.slice(2) : r.mold_label !== m)) return false;
      if (c && r.category !== c) return false;
      if (root.querySelector('[data-f=short]').checked && !(r.state === '미달' || r.state === '품절')) return false;
      return true;
    },
    onSelect: function (r) { detail(r); },
    onDbl: function (r) { App.partMove(r, '출고', after); }
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  App.$$('[data-f]', root).forEach(function (el) { el.addEventListener('change', function () { grid.render(); }); });
  if (args.short) root.querySelector('[data-f=short]').checked = true;

  function detail(p) {
    App.get('/api/parts/tx?part_id=' + p.id).then(function (tx) {
      right.innerHTML = '<div class="panel-h">' + App.esc(p.name) + '<span class="grow"></span>' + App.stateTag(p.state) + '</div><div class="panel-b">' +
        '<div class="kv" style="margin-bottom:12px">' +
        '<span class="k">부품코드</span><span>' + App.esc(p.code) + '</span>' +
        '<span class="k">구분 / 규격</span><span>' + App.esc(p.category || '') + ' ' + App.esc(p.spec || '') + '</span>' +
        '<span class="k">사용금형</span><span>' + App.esc(p.mold_label) + ' <span class="muted">' + App.esc(p.mold_part_name || '') + '</span></span>' +
        '<span class="k">현재고 / 안전재고</span><span><b>' + App.fmt(p.qty) + '</b> / ' + App.fmt(p.safety_qty) + ' ' + App.esc(p.unit || '') + '</span>' +
        '<span class="k">보관위치</span><span>' + App.esc(p.location || '-') + '</span>' +
        '</div><div style="display:flex;gap:6px;margin-bottom:12px">' +
        '<button class="btn in small" data-m="입고">입고</button><button class="btn out small" data-m="출고">출고</button><button class="btn small" data-m="조정">재고조정</button></div>' +
        '<h4 style="margin:6px 0">입출고 내역 <span class="muted" style="font-weight:400">' + tx.length + '건</span></h4>' +
        (tx.length ? '<table class="mini"><tr><th>일자</th><th>구분</th><th class="num">수량</th><th class="num">재고</th><th>작업자</th></tr>' + tx.slice(0, 50).map(function (t) {
          var q = t.kind === '입고' ? '+' + App.fmt(t.qty) : t.kind === '출고' ? '-' + App.fmt(t.qty) : (t.qty >= 0 ? '+' : '') + App.fmt(t.qty);
          var cls = t.kind === '입고' ? 'ok' : t.kind === '출고' ? 'bad' : 'gray';
          return '<tr title="' + App.esc(t.note || '') + '"><td>' + App.esc(t.date) + '</td><td><span class="tag ' + cls + '">' + App.esc(t.kind) + '</span></td><td class="num">' + q +
            '</td><td class="num">' + App.fmt(t.after_qty) + '</td><td>' + App.esc(t.worker || '') + (t.mold_no ? ' <span class="muted">' + App.esc(t.mold_no) + '</span>' : '') + '</td></tr>';
        }).join('') + '</table>' : '<div class="muted">내역이 없습니다.</div>') + '</div>';
      App.$$('[data-m]', right).forEach(function (b) { b.onclick = function () { App.partMove(p, b.dataset.m, after); }; });
    }).catch(App.err);
  }
  function after() { load(); }
  function fillFilters(rows) {
    var ms = {}, cs = {};
    rows.forEach(function (r) { (ms[r.mold_base] = ms[r.mold_base] || {})[r.mold_label] = 1; if (r.category) cs[r.category] = 1; });
    var fm = root.querySelector('[data-f=mold]'), fc = root.querySelector('[data-f=cat]');
    var vm = fm.value, vc = fc.value;
    fm.innerHTML = '<option value="">전체 금형</option>' + Object.keys(ms).sort().map(function (b) {
      var subs = Object.keys(ms[b]).sort();
      if (subs.length === 1 && subs[0] === b) return '<option value="' + App.esc(b) + '">' + App.esc(b) + '</option>';
      return '<option value="g:' + App.esc(b) + '">' + App.esc(b) + ' (모디파이 포함 ' + subs.length + ')</option>' +
        subs.map(function (x) { return '<option value="' + App.esc(x) + '">　└ ' + App.esc(x) + '</option>'; }).join('');
    }).join('');
    fc.innerHTML = '<option value="">전체 구분</option>' + Object.keys(cs).sort().map(function (m) { return '<option>' + App.esc(m) + '</option>'; }).join('');
    fm.value = vm; fc.value = vc;
  }
  function load(selId) {
    var keep = selId || (grid.selected() || {}).id;
    return App.get('/api/parts').then(function (rows) {
      fillFilters(rows);
      grid.setRows(rows);
      if (keep) grid.selectKey(keep, true);
    }).catch(App.err);
  }
  var spec = App.meta.tables.parts;
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    var r = grid.selected();
    if ((a === '입고' || a === '출고' || a === '조정' || a === 'edit' || a === 'del') && !r) { App.toast('목록에서 부품을 먼저 선택하세요.', 'warn'); return; }
    if (a === '입고' || a === '출고' || a === '조정') App.partMove(r, a, after);
    else if (a === 'add') {
      var m = root.querySelector('[data-f=mold]').value.replace(/^g:/, '');
      App.form({
        title: '부품 등록', cols: spec.cols, wide: true,
        values: { unit: 'EA', qty: 0, safety_qty: 0, price: 0, mold_no: m && m !== '(공용)' ? m : '' },
        onSave: function (v) { return App.api('POST', '/api/t/parts', v).then(function (res) { App.toast('등록했습니다.'); App.refreshBadges(); load(res.id); }); }
      });
    } else if (a === 'edit') {
      App.form({
        title: '부품 수정', cols: spec.cols, values: r, mode: 'edit', wide: true,
        onSave: function (v) { return App.api('PUT', '/api/t/parts/' + r.id, v).then(function () { App.toast('저장했습니다.'); App.refreshBadges(); load(r.id); }); }
      });
    } else if (a === 'del') {
      App.confirm('[' + r.name + '] 부품을 삭제할까요?\n입출고 이력도 함께 삭제됩니다.', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/t/parts/' + r.id).then(function () { App.toast('삭제했습니다.'); right.innerHTML = ''; App.refreshBadges(); load(); }).catch(App.err);
      });
    } else if (a === 'xlsx') App.exportXlsx('금형부품재고_' + App.stamp() + '.xlsx', [grid.sheet('금형부품 재고')]);
  });
  load();
};
