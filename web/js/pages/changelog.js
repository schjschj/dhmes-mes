/* 변경 기록: 누가 언제 무엇을 바꿨는지 */
App.pages.changelog = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<input type="date" class="input" data-f="d1"> ~ <input type="date" class="input" data-f="d2">' +
    '<input class="input search" placeholder="내용 / 사용자 검색">' +
    '<span class="grow"></span><button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  function tblName(t) { return App.meta.tables[t] ? App.meta.tables[t].label : ({ part_tx: '입출고', import: '가져오기', settings: '설정', users: '사용자', ship: '출하', rawmat: '원재료', memos: '메모', update: '업데이트' }[t] || t); }
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    cols: [
      { k: 'ts', l: '시각', w: 130 },
      { k: 'user', l: '사용자', w: 70 },
      { k: 'ip', l: 'PC 주소', w: 95 },
      { k: 'tbl', l: '대상', w: 80, val: function (r) { return tblName(r.tbl); } },
      { k: 'action', l: '작업', w: 60 },
      { k: 'summary', l: '내용', w: 520 }
    ], sort: { k: 'ts', dir: -1 }
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  var d1 = root.querySelector('[data-f=d1]'), d2 = root.querySelector('[data-f=d2]');
  d1.value = App.addDays(-30); d2.value = App.today();
  function load() {
    App.get('/api/log?d1=' + d1.value + '&d2=' + d2.value + '&limit=5000').then(function (r) { grid.setRows(r); }).catch(App.err);
  }
  d1.addEventListener('change', load); d2.addEventListener('change', load);
  root.querySelector('[data-a=xlsx]').onclick = function () { App.exportXlsx('변경기록_' + App.stamp() + '.xlsx', [grid.sheet('변경기록')]); };
  load();
};
