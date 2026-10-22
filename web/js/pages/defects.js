/* 공정불량 등록 (엑셀 '공정불량현황' 대체) */
App.pages.defects = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar"><span data-period style="display:contents"></span>' +
    '<input class="input search" placeholder="제번 / 불량코드 / 사유 / 작업자 검색">' +
    '<span class="grow"></span>' +
    '<button class="btn primary" data-a="add">+ 불량 등록</button>' +
    '<button class="btn" data-a="edit">수정</button>' +
    '<button class="btn danger" data-a="del">삭제</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="sumbar" data-sum></div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var spec = App.meta.tables.defects;
  var names = {};
  var cols = [
    { k: 'date', l: '생산일자', w: 82 },
    { k: 'equip_no', l: '설비', w: 40, center: true, val: function (r) { return +r.equip_no || r.equip_no; } },
    { k: 'lot_no', l: 'LOT NO', w: 55 },
    { k: 'code', l: '제번', w: 90 },
    { k: 'pname', l: '품명', w: 170, val: function (r) { return names[(r.code || '').toLowerCase()] || ''; } },
    { k: 'qty', l: '폐기수량(EA)', t: 'int', w: 80 },
    { k: 'reels', l: '폐기(릴)', t: 'num', w: 55 },
    { k: 'defect_code', l: '불량코드', w: 55, fmt: function (v) { return v ? '<span class="tag steel">' + App.esc(v) + '</span>' : ''; } },
    { k: 'reason', l: '불량사유', w: 160 },
    { k: 'worker', l: '작업자', w: 65 },
    { k: 'disposal_date', l: '폐기일', w: 82 },
    { k: 'note', l: '비고', w: 120 }
  ].concat(App.auditCols());
  var sumEl = root.querySelector('[data-sum]');
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    cols: cols, sort: { k: 'date', dir: -1 }, hint: '두 번 클릭하면 수정',
    onDbl: function (r) { form(r); },
    onRender: function (rows) {
      var q = rows.reduce(function (a, r) { return a + (r.qty || 0); }, 0);
      var byc = {};
      rows.forEach(function (r) { byc[r.defect_code || '-'] = (byc[r.defect_code || '-'] || 0) + (r.qty || 0); });
      var top = Object.keys(byc).sort(function (a, b) { return byc[b] - byc[a]; }).slice(0, 5);
      sumEl.innerHTML = '<span><span class="muted">건수</span> <b>' + rows.length + '</b></span><span><span class="muted">폐기수량</span> <b>' + App.fmt(q) + ' EA</b></span>' +
        '<span class="muted">많은 순:</span>' + top.map(function (c) { return '<span>' + App.esc(c) + ' <b>' + App.fmt(byc[c]) + '</b></span>'; }).join('');
    }
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('def_period', null), function (p) { App.store.set('def_period', p); load(); });

  function load(sel) {
    var p = period.get();
    return Promise.all([App.get('/api/t/defects'), App.refList('products')]).then(function (res) {
      names = {};
      res[1].forEach(function (x) { names[(x.code || '').toLowerCase()] = x.name; });
      grid.setRows(res[0].filter(function (r) { return (!p.d1 || r.date >= p.d1) && (!p.d2 || r.date <= p.d2); }));
      if (sel) grid.selectKey(sel, true);
    }).catch(App.err);
  }
  function form(r) {
    var edit = !!(r && r.id);
    App.form({
      title: edit ? '공정불량 수정' : '공정불량 등록', cols: spec.cols, mode: edit ? 'edit' : 'new', wide: true,
      values: r || { date: App.today(), worker: App.user, disposal_date: App.today() },
      onSave: function (v) {
        var p = edit ? App.api('PUT', '/api/t/defects/' + r.id, v) : App.api('POST', '/api/t/defects', v);
        return p.then(function (x) { App.toast('저장했습니다.'); load(edit ? r.id : x.id); });
      }
    });
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    var r = grid.selected();
    if ((a === 'edit' || a === 'del') && !r) { App.toast('목록에서 먼저 선택하세요.', 'warn'); return; }
    if (a === 'add') form(null);
    else if (a === 'edit') form(r);
    else if (a === 'del') App.confirm(r.date + ' ' + r.code + ' ' + (r.defect_code || '') + ' 불량 기록을 삭제할까요?', '삭제', true).then(function (ok) {
      if (ok) App.api('DELETE', '/api/t/defects/' + r.id).then(function () { App.toast('삭제했습니다.'); load(); }).catch(App.err);
    });
    else if (a === 'xlsx') App.exportXlsx('공정불량_' + App.stamp() + '.xlsx', [grid.sheet('공정불량현황')]);
  });
  load();
};
