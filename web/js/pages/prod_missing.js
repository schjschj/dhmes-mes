/* 금형번호·SPM 미등록 제번 (엑셀 'SPM금형미등록' 대체) — 두 번 클릭해서 바로 제품정보에 입력 */
App.pages.prod_missing = function (root) {
  root.innerHTML = '<div class="page-full"><div class="desc">생산실적에 있는 제번 중 금형번호나 SPM 이 없어서 금형 타수·이론생산량이 0 으로 계산되는 것들입니다. ' +
    '두 번 클릭해서 금형번호와 SPM 을 입력하면 지난 실적까지 바로 다시 계산됩니다.</div>' +
    '<div class="toolbar"><button class="btn" data-a="reload">새로고침</button><span class="grow"></span><button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
    '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    key: 'code', sort: { k: 'last', dir: -1 }, hint: '두 번 클릭하면 제품정보 입력', emptyText: '미등록 제번이 없습니다. 👍',
    cols: [
      { k: 'code', l: '제번', w: 95 }, { k: 'name', l: '제품명', w: 220 }, { k: 'count', l: '생산건수', t: 'int', w: 60 },
      { k: 'qty', l: '총 생산수량', t: 'int', w: 90 }, { k: 'mold_no', l: '금형번호', w: 70 }, { k: 'spm', l: 'SPM', t: 'num', w: 50 },
      { k: 'state', l: '현재상태', w: 150, fmt: function (v) { return '<span class="tag bad">' + App.esc(v) + '</span>'; } },
      { k: 'last', l: '마지막생산일', w: 85 }
    ],
    rowClass: function () { return 'r-bad'; },
    onDbl: edit
  });
  function edit(r) {
    if (!r.product_id) { App.toast('기준정보 > 제품 에서 먼저 제번을 등록하세요.', 'warn'); return; }
    App.get('/api/t/products?q=' + encodeURIComponent(r.code)).then(function (rows) {
      var p = rows.filter(function (x) { return x.id === r.product_id; })[0];
      var spec = App.meta.tables.products;
      App.form({
        title: '제품 정보 — ' + r.code, cols: spec.cols, values: p, mode: 'edit', wide: true,
        onSave: function (v) { return App.api('PUT', '/api/t/products/' + p.id, v).then(function () { App.toast('저장했습니다. 실적이 다시 계산됩니다.'); App.clearRef('products'); load(); App.refreshBadges(); }); }
      });
    });
  }
  function load() { App.get('/api/production/missing').then(function (r) { grid.setRows(r); }).catch(App.err); }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'reload') load();
    else if (a === 'xlsx') App.exportXlsx('SPM금형미등록_' + App.stamp() + '.xlsx', [grid.sheet('미등록')]);
  });
  load();
};
