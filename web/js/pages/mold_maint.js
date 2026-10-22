/* 금형 정비이력 */
App.pages.mold_maint = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<input class="input search" placeholder="금형번호 / 품명 / 정비내용 검색">' +
    '<input type="date" class="input" data-f="d1"> ~ <input type="date" class="input" data-f="d2">' +
    '<select class="input" data-f="kind"><option value="">전체 구분</option><option value="oh">오버홀</option><option value="clean">세척</option><option value="partchg">부품교환</option></select>' +
    '<span class="grow"></span>' +
    '<button class="btn primary" data-a="add">+ 정비 등록</button>' +
    '<button class="btn" data-a="edit">수정</button>' +
    '<button class="btn danger" data-a="del">삭제</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var molds = {};
  var cols = [
    { k: 'date', l: '날짜', w: 85 },
    { k: 'mold_no', l: '금형번호', w: 75, mono: true },
    { k: 'part_name', l: '대표 품명', w: 190, val: function (r) { return (molds[r.mold_no] || {}).part_name || ''; } },
    { k: 'kinds', l: '구분', w: 110, val: function (r) { return [r.oh ? '오버홀' : '', r.clean ? '세척' : '', r.partchg ? '부품교환' : ''].filter(Boolean).join('·') || '기타'; },
      fmt: function (v) { return '<span class="tag steel">' + App.esc(v) + '</span>'; }, xval: function (r) { return [r.oh ? '오버홀' : '', r.clean ? '세척' : '', r.partchg ? '부품교환' : ''].filter(Boolean).join('·') || '기타'; } },
    { k: 'shots', l: '누적 타수', t: 'int', w: 100 },
    { k: 'worker', l: '작업자', w: 70 },
    { k: 'note', l: '정비 내용', w: 340 }
  ].concat(App.auditCols());
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    cols: cols, sort: { k: 'date', dir: -1 }, hint: '두 번 클릭하면 수정',
    extraFilter: function (r) {
      var d1 = root.querySelector('[data-f=d1]').value, d2 = root.querySelector('[data-f=d2]').value, k = root.querySelector('[data-f=kind]').value;
      if (d1 && r.date < d1) return false;
      if (d2 && r.date > d2) return false;
      if (k && !r[k]) return false;
      return true;
    },
    onDbl: function (r) { App.moldMaintForm({ row: r, onDone: load }); }
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  App.$$('[data-f]', root).forEach(function (el) { el.addEventListener('change', function () { grid.render(); }); });

  function load() {
    return Promise.all([App.get('/api/t/mold_maint'), App.refList('molds', true)]).then(function (res) {
      molds = {};
      res[1].forEach(function (m) { molds[m.mold_no] = m; });
      grid.setRows(res[0]);
    }).catch(App.err);
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    var r = grid.selected();
    if (a === 'add') App.moldMaintForm({ onDone: load });
    else if (a === 'edit') { if (r) App.moldMaintForm({ row: r, onDone: load }); else App.toast('목록에서 먼저 선택하세요.', 'warn'); }
    else if (a === 'del') {
      if (!r) { App.toast('목록에서 먼저 선택하세요.', 'warn'); return; }
      App.confirm(r.date + ' ' + r.mold_no + ' 정비 이력을 삭제할까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/t/mold_maint/' + r.id).then(function () { App.toast('삭제했습니다.'); App.refreshBadges(); load(); }).catch(App.err);
      });
    } else if (a === 'xlsx') App.exportXlsx('금형정비이력_' + App.stamp() + '.xlsx', [grid.sheet('금형정비이력')]);
  });
  load();
};
