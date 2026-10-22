/* 공통 목록 화면: 서버 표 정의(spec)만으로 목록·검색·등록·수정·삭제·엑셀 */
App.pages.table = function (root, args, item) {
  var name = args.table;
  var spec = App.meta.tables[name];
  root.innerHTML = '<div class="page-full">' +
    (spec.desc ? '<div class="desc">' + App.esc(spec.desc) + '</div>' : '') +
    '<div class="toolbar">' +
    '<input class="input search" placeholder="검색 (여러 단어는 띄어쓰기)">' +
    '<button class="btn primary" data-a="add">+ 새로 등록</button>' +
    '<button class="btn" data-a="edit">수정</button>' +
    '<button class="btn danger" data-a="del">삭제</button>' +
    '<span class="grow"></span>' +
    '<button class="btn" data-a="reload">새로고침</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';

  var cols = App.specCols(name).concat(App.auditCols());
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    cols: cols, hint: '두 번 클릭하면 수정',
    sort: { k: spec.key || cols[0].k, dir: 1 },
    onDbl: function (r) { edit(r); }
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });

  function load(selId) {
    return App.get('/api/t/' + name).then(function (rows) {
      grid.setRows(rows);
      if (selId) grid.selectKey(selId, true);
    }).catch(App.err);
  }
  function need() {
    var r = grid.selected();
    if (!r) App.toast('목록에서 먼저 항목을 선택하세요.', 'warn');
    return r;
  }
  function edit(r) {
    if (!r) return;
    App.form({
      title: spec.label + ' 수정', cols: spec.cols, values: r, mode: 'edit', wide: spec.cols.length > 8,
      onSave: function (v) {
        return App.api('PUT', '/api/t/' + name + '/' + r.id, v).then(function () {
          App.toast('저장했습니다.'); App.clearRef(name); load(r.id);
        });
      }
    });
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'add') {
      var init = {};
      spec.cols.forEach(function (c) { if (c.default !== undefined) init[c.k] = c.default; });
      App.form({
        title: spec.label + ' 등록', cols: spec.cols, values: init, wide: spec.cols.length > 8,
        onSave: function (v) {
          return App.api('POST', '/api/t/' + name, v).then(function (res) {
            App.toast('등록했습니다.'); App.clearRef(name); load(res.id);
          });
        }
      });
    } else if (a === 'edit') {
      edit(need());
    } else if (a === 'del') {
      var r = need();
      if (!r) return;
      App.confirm('[' + (r[spec.key] || r.id) + '] 을(를) 삭제할까요?\n삭제하면 되돌릴 수 없습니다.', '삭제', true).then(function (ok) {
        if (!ok) return;
        App.api('DELETE', '/api/t/' + name + '/' + r.id).then(function () {
          App.toast('삭제했습니다.'); App.clearRef(name); load();
        }).catch(App.err);
      });
    } else if (a === 'reload') {
      load();
    } else if (a === 'xlsx') {
      var all = App.specCols(name, { all: true }).concat(App.auditCols());
      App.exportXlsx(spec.label + '_' + App.stamp() + '.xlsx', [grid.sheet(spec.label, all)]);
    }
  });
  load();
};
