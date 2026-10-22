/* 금형부품 입출고 이력 */
App.pages.parts_tx = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<input type="date" class="input" data-f="d1"> ~ <input type="date" class="input" data-f="d2">' +
    '<button class="btn small" data-q="0">오늘</button><button class="btn small" data-q="7">7일</button><button class="btn small" data-q="30">30일</button><button class="btn small" data-q="90">90일</button><button class="btn small" data-q="all">전체</button>' +
    '<span class="sep"></span>' +
    '<select class="input" data-f="kind"><option value="">전체 구분</option><option>입고</option><option>출고</option><option>조정</option></select>' +
    '<input class="input search" placeholder="부품 / 금형 / 작업자 검색">' +
    '<span class="grow"></span>' +
    '<button class="btn danger" data-a="del">선택 이력 삭제</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var cols = [
    { k: 'date', l: '일자', w: 85 },
    { k: 'kind', l: '구분', w: 50, fmt: function (v) { return '<span class="tag ' + (v === '입고' ? 'ok' : v === '출고' ? 'bad' : 'gray') + '">' + App.esc(v) + '</span>'; } },
    { k: 'code', l: '부품코드', w: 70, mono: true },
    { k: 'name', l: '부품명', w: 140 },
    { k: 'spec', l: '규격', w: 100 },
    { k: 'qty', l: '수량', t: 'int', w: 60, fmt: function (v, r) { return (r.kind === '입고' ? '+' : r.kind === '출고' ? '-' : (v >= 0 ? '+' : '')) + App.fmt(v); } },
    { k: 'after_qty', l: '처리후 재고', t: 'int', w: 75 },
    { k: 'unit', l: '단위', w: 40 },
    { k: 'mold_label', l: '사용금형', w: 70 },
    { k: 'worker', l: '작업자', w: 70 },
    { k: 'note', l: '비고', w: 200 },
    { k: 'created_by', l: '입력자', w: 80 },
    { k: 'created', l: '입력시각', w: 120 }
  ];
  var grid = new App.Grid(root.querySelector('.gridbox'), { cols: cols, sort: { k: 'date', dir: -1 } });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  var d1 = root.querySelector('[data-f=d1]'), d2 = root.querySelector('[data-f=d2]');
  d1.value = App.addDays(-30); d2.value = App.today();
  function load() {
    var q = '?d1=' + d1.value + '&d2=' + d2.value + '&kind=' + encodeURIComponent(root.querySelector('[data-f=kind]').value);
    return App.get('/api/parts/tx' + q).then(function (rows) { grid.setRows(rows); }).catch(App.err);
  }
  App.$$('[data-f]', root).forEach(function (el) { el.addEventListener('change', load); });
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var q = e.target.dataset && e.target.dataset.q;
    if (q) {
      if (q === 'all') { d1.value = ''; d2.value = ''; } else { d1.value = App.addDays(-(+q)); d2.value = App.today(); }
      load(); return;
    }
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'del') {
      var r = grid.selected();
      if (!r) { App.toast('목록에서 먼저 선택하세요.', 'warn'); return; }
      App.confirm(r.date + ' ' + r.kind + ' ' + r.name + ' (' + r.qty + ')\n이 이력을 삭제하면 해당 수량만큼 재고가 되돌려집니다. 삭제할까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/parts/tx/' + r.id).then(function () { App.toast('삭제하고 재고를 되돌렸습니다.'); App.refreshBadges(); load(); }).catch(App.err);
      });
    } else if (a === 'xlsx') App.exportXlsx('금형부품입출고이력_' + App.stamp() + '.xlsx', [grid.sheet('금형부품 입출고 이력')]);
  });
  load();
};
