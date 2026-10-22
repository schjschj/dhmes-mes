/* 금형 타수 · 정비 알람 */
App.pages.mold_status = function (root, args) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<input class="input search" placeholder="금형번호 / 품번 / 품명 검색">' +
    '<select class="input" data-f="lv"><option value="">전체 금형</option><option value="alarm">알람만 (1차·2차·초과)</option><option value="bad">2차·초과만</option></select>' +
    '<label class="chk"><input type="checkbox" data-f="scrap"> 폐기 금형 포함</label>' +
    '<label class="chk" title="금형부품 등에서 들어온, 타수관리 대상이 아닌 금형"><input type="checkbox" data-all> 타수관리 외 금형도 보기</label>' +
    '<span class="grow"></span>' +
    '<button class="btn primary" data-a="maint">+ 정비 등록</button>' +
    '<button class="btn" data-a="edit">금형정보 수정</button>' +
    '<button class="btn" data-a="reload">새로고침</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div>' +
    '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">왼쪽에서 금형을 선택하세요.</div></div></div></div>';
  var right = root.querySelector('.right');
  var th = { a1: 0.2, a2: 0.1 };
  var lvOrder = { '초과': 0, '2차': 1, '1차': 2, '정상': 3, '': 4 };

  function kindCol(k, label) {
    return {
      k: k + '_ratio', l: label + ' 잔여율', w: 120, num: false,
      fmt: function (v, r) { return App.ratioBar(v, r[k + '_level']); },
      xval: function (r) { return r[k + '_ratio']; }
    };
  }
  var cols = [
    { k: 'level', l: '알람', w: 60, fmt: function (v, r) { return App.levelTag(r.level); }, val: function (r) { return lvOrder[r.level]; }, xval: function (r) { return r.level; } },
    { k: 'mold_no', l: '금형번호', w: 70, mono: true, fmt: function (v, r) {
      return App.esc(v) + (r.variants && r.variants.length ? ' <span class="muted" title="모디파이: ' + App.esc(r.variants.join(', ')) + '">+' + r.variants.length + '</span>' : '') +
        (r.variant_of ? ' <span class="muted">→ ' + App.esc(r.variant_of) + '</span>' : ''); } },
    { k: 'part_no', l: '대표 품번', w: 85 },
    { k: 'part_name', l: '대표 품명', w: 150 },
    { k: 'shots', l: '누적 타수', t: 'int', w: 95 },
    { k: 'oh_cycle', l: '오버홀 주기', t: 'int', w: 80 },
    { k: 'oh_after', l: '오버홀 후 타수', t: 'int', w: 90 },
    kindCol('oh', '오버홀'),
    { k: 'oh_last', l: '최근 오버홀', w: 80 },
    kindCol('clean', '세척'),
    kindCol('partchg', '부품교환')
  ];
  var grid = new App.Grid(root.querySelector('.left'), {
    cols: cols, key: 'mold_no', sort: { k: 'oh_ratio', dir: 1 },
    rowClass: function (r) { return (r.status === '폐기' || r.managed === 0) ? 'r-dim' : (r.level === '초과' || r.level === '2차') ? 'r-bad' : r.level === '1차' ? 'r-warn' : ''; },
    extraFilter: function (r) {
      var lv = root.querySelector('[data-f=lv]').value;
      if (!root.querySelector('[data-f=scrap]').checked && r.status === '폐기') return false;
      if (lv === 'alarm' && ['초과', '2차', '1차'].indexOf(r.level) < 0) return false;
      if (lv === 'bad' && ['초과', '2차'].indexOf(r.level) < 0) return false;
      return true;
    },
    onSelect: function (r) { detail(r.mold_no); },
    onDbl: function (r) { App.moldMaintForm({ mold_no: r.mold_no, onDone: reload }); },
    hint: '두 번 클릭하면 정비 등록'
  });
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  App.$$('[data-f]', root).forEach(function (el) { el.addEventListener('change', function () { grid.render(); }); });
  if (args.lv) root.querySelector('[data-f=lv]').value = args.lv;
  root.querySelector('[data-all]').addEventListener('change', function () { reload(); });

  var partsCache = null;
  function detail(no) {
    right.innerHTML = '<div class="panel-b muted">불러오는 중…</div>';
    var pp = partsCache ? Promise.resolve(partsCache) : App.get('/api/parts').then(function (r) { partsCache = r; return r; });
    Promise.all([App.get('/api/molds/detail?no=' + encodeURIComponent(no)), pp]).then(function (res) {
      var d = res[0], m = d.mold;
      var base = m.mold_no, multi = d.group.length > 1;
      var parts = res[1].filter(function (p) { return d.group.indexOf(p.mold_no) >= 0; });
      parts.sort(function (a, b) { return (a.mold_no === base ? '' : a.mold_no).localeCompare(b.mold_no === base ? '' : b.mold_no) || a.name.localeCompare(b.name); });
      var vtag = function (mn) { return multi ? '<span class="tag ' + (mn === base ? 'gray' : 'steel') + '" style="font-family:var(--mono)">' + App.esc(mn) + '</span> ' : ''; };
      var kinds = [['oh', '오버홀', 'oh_cycle'], ['clean', '세척', 'clean_cycle'], ['partchg', '부품교환', 'part_cycle']];
      var h = '<div class="panel-h"><span style="font-family:var(--mono)">' + App.esc(m.mold_no) + '</span>' + (multi ? ' <span class="muted" style="font-weight:400">+ 모디파이 ' + (d.group.length - 1) + '개</span>' : '') + '<span class="grow"></span>' + App.levelTag(m.level) + '</div><div class="panel-b">' +
        (d.asked !== base ? '<div class="notice" style="margin-bottom:10px">' + App.esc(d.asked) + ' 은(는) ' + App.esc(base) + ' 의 모디파이 금형입니다. 타수·정비는 ' + App.esc(base) + ' 기준으로 함께 관리됩니다.</div>' : '') +
        (multi ? '<div class="kind-box" style="background:#f6f8fa"><div class="h"><span>같은 금형 (모디파이)</span><span class="muted" style="font-weight:400">타수·정비 합산</span></div>' +
          d.variants.map(function (v) { return '<div>' + vtag(v.mold_no) + App.esc(v.part_no || '') + ' <span class="muted">' + App.esc(v.part_name || '') + '</span></div>'; }).join('') + '</div>' : '') +
        '<div class="kv" style="margin-bottom:12px">' +
        '<span class="k">대표 품번 / 품명</span><span>' + App.esc(m.part_no || '') + ' ' + App.esc(m.part_name || '') + '</span>' +
        '<span class="k">상태 / 보관위치</span><span>' + App.esc(m.status || '') + ' ' + App.esc(m.location || '') + '</span>' +
        '<span class="k">Cavity / 피치</span><span>' + App.fmt(m.cavity) + ' / ' + App.fmt(m.pitch) + '</span>' +
        '<span class="k">누적 타수</span><span><b>' + App.fmt(m.shots) + '</b> <span class="muted">(기초 ' + App.fmt(m.base_shots) + ' @' + App.esc(m.base_date || '-') + ' + 생산실적 ' + App.fmt(m.prod_shots) + (m.adj_shots ? ' + 보정 ' + App.fmt(m.adj_shots) : '') + ')</span></span>' +
        '</div>' +
        kinds.map(function (k) {
          var cyc = m[k[2]];
          if (!cyc) return '<div class="kind-box"><div class="h"><span>' + k[1] + '</span><span class="muted" style="font-weight:400">주기 미설정</span></div>' +
            '<div class="muted">최근: ' + App.esc(m[k[0] + '_last'] || '-') + '</div></div>';
          return '<div class="kind-box"><div class="h"><span>' + k[1] + '</span>' + App.levelTag(m[k[0] + '_level']) + '</div>' +
            '<div class="kv"><span class="k">주기</span><span>' + App.fmt(cyc) + '</span>' +
            '<span class="k">' + k[1] + ' 후 타수</span><span>' + App.fmt(m[k[0] + '_after']) + '</span>' +
            '<span class="k">잔여</span><span>' + App.fmt(m[k[0] + '_remain']) + ' · ' + App.ratioBar(m[k[0] + '_ratio'], m[k[0] + '_level']) + '</span>' +
            '<span class="k">최근 ' + k[1] + '</span><span>' + App.esc(m[k[0] + '_last'] || '-') + '</span></div></div>';
        }).join('') +
        '<div style="display:flex;gap:6px;margin:10px 0 4px"><button class="btn primary small" data-d="maint">+ 정비 등록</button><button class="btn small" data-d="edit">금형정보 수정</button></div>' +
        '<h4 style="margin:14px 0 6px">정비 이력 <span class="muted" style="font-weight:400">' + d.maint.length + '건</span></h4>' +
        (d.maint.length ? '<table class="mini">' + d.maint.slice(0, 30).map(function (x) {
          var kinds2 = [x.oh ? '오버홀' : '', x.clean ? '세척' : '', x.partchg ? '부품교환' : ''].filter(Boolean).join('·') || '기타';
          return '<tr><td>' + App.esc(x.date) + '</td><td>' + (x.mold_no !== base ? vtag(x.mold_no) : '') + '<span class="tag steel">' + kinds2 + '</span></td><td class="num">' + App.fmt(x.shots) + '</td></tr>' +
            (x.note ? '<tr><td colspan="3" class="wrap muted" style="border-top:0;padding-top:0">' + App.esc(x.note) + '</td></tr>' : '');
        }).join('') + '</table>' : '<div class="muted">정비 이력이 없습니다.</div>') +
        '<h4 style="margin:14px 0 6px">수리 이력 <span class="muted" style="font-weight:400">' + (d.repairs || []).length + (d.repairs && d.repairs.length >= 300 ? '건 이상' : '건') + '</span>' +
        (App.findMenu('mold_repair') ? ' <a href="#" data-d="repairs" style="font-weight:400;font-size:12px">수리이력에서 보기 ›</a>' : '') + '</h4>' +
        ((d.repairs || []).length ? '<table class="mini">' + d.repairs.slice(0, 15).map(function (x) {
          return '<tr><td style="white-space:nowrap">' + App.esc(x.date) + '</td><td>' + (x.mold_no !== base ? vtag(x.mold_no) : '') + (x.type_names ? '<span class="tag">' + App.esc(x.type_names) + '</span> ' : '') +
            App.esc((x.fix || x.problem || '').split('\n')[0]) + '</td><td class="muted">' + App.esc(x.worker || '') + '</td></tr>';
        }).join('') + '</table>' : '<div class="muted">수리 이력이 없습니다.</div>') +
        '<h4 style="margin:14px 0 6px">이 금형의 예비 부품' + (multi ? ' (모디파이 포함)' : '') + ' <span class="muted" style="font-weight:400">' + parts.length + '종</span></h4>' +
        (parts.length ? '<table class="mini">' + parts.map(function (p) {
          return '<tr><td>' + vtag(p.mold_no) + App.esc(p.name) + ' <span class="muted">' + App.esc(p.spec || '') + '</span></td><td class="num">' + App.fmt(p.qty) + ' / ' + App.fmt(p.safety_qty) + '</td><td>' + App.stateTag(p.state) + '</td></tr>';
        }).join('') + '</table>' : '<div class="muted">등록된 부품이 없습니다.</div>') +
        '<h4 style="margin:14px 0 6px">이 금형을 쓰는 제품 <span class="muted" style="font-weight:400">' + d.products.length + '개</span></h4>' +
        (d.products.length ? d.products.map(function (p) { return '<div>' + vtag(p.mold_no) + App.esc(p.code) + ' <span class="muted">' + App.esc(p.name || '') + '</span></div>'; }).join('') : '<div class="muted">-</div>') +
        '</div>';
      right.innerHTML = h;
      right.querySelector('[data-d=maint]').onclick = function () { App.moldMaintForm({ mold_no: base, onDone: reload }); };
      var rl = right.querySelector('[data-d=repairs]');
      if (rl) rl.onclick = function (e) { e.preventDefault(); App.go('mold_repair', { mold: base }); };
      right.querySelector('[data-d=edit]').onclick = function () { editMold(base); };
    }).catch(App.err);
  }
  function editMold(no) {
    App.get('/api/t/molds?q=' + encodeURIComponent(no)).then(function (rows) {
      var r = rows.filter(function (x) { return x.mold_no === no; })[0];
      if (!r) return;
      var spec = App.meta.tables.molds;
      App.form({
        title: '금형 수정 — ' + no, cols: spec.cols, values: r, mode: 'edit', wide: true,
        onSave: function (v) {
          return App.api('PUT', '/api/t/molds/' + r.id, v).then(function () { App.toast('저장했습니다.'); App.clearRef('molds'); reload(v.mold_no || no); });
        }
      });
    });
  }
  function reload(sel) {
    var keep = typeof sel === 'string' ? sel : (grid.selected() || {}).mold_no;
    partsCache = null;
    var all = root.querySelector('[data-all]').checked;
    return App.get('/api/molds/status' + (all ? '?all=1' : '')).then(function (d) {
      th = { a1: d.alarm1, a2: d.alarm2 };
      grid.setRows(d.rows);
      if (keep) grid.selectKey(keep, true);
    }).catch(App.err);
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    var r = grid.selected();
    if (a === 'maint') App.moldMaintForm({ mold_no: r ? r.mold_no : '', onDone: reload });
    else if (a === 'edit') { if (r) editMold(r.mold_no); else App.toast('금형을 먼저 선택하세요.', 'warn'); }
    else if (a === 'reload') reload();
    else if (a === 'xlsx') {
      var xc = cols.concat([{ k: 'status', l: '사용상태' },{ k: 'clean_last', l: '최근 세척' }, { k: 'partchg_last', l: '최근 부품교환' }, { k: 'oh_remain', l: '오버홀 잔여 타수', t: 'int' }]);
      App.exportXlsx('금형타수_알람_' + App.stamp() + '.xlsx', [grid.sheet('금형 타수·알람', xc)]);
    }
  });
  reload(args.select);
};
