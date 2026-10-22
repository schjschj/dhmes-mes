/* 생산실적 입력 · 조회 (엑셀 '생산실적통합' 대체) */
App.pages.prod_entry = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="notice" data-miss style="display:none"></div>' +
    '<div class="toolbar"><span data-period style="display:contents"></span>' +
    '<select class="input" data-f="equip"><option value="">전체 설비</option></select>' +
    '<input class="input search" placeholder="제번 / 품명 / 작업자 검색">' +
    '<span class="grow"></span>' +
    '<button class="btn primary" data-a="add">+ 실적 입력</button>' +
    '<button class="btn" data-a="copy" title="선택한 실적을 복사해서 새로 입력">복사 입력</button>' +
    '<button class="btn" data-a="edit">수정</button>' +
    '<button class="btn danger" data-a="del">삭제</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div>' +
    '<div class="sumbar" data-sum></div>' +
    '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var spec = App.meta.tables.production;
  var pct = function (v) { return v === null || v === undefined || v === '' ? '' : (v * 100).toFixed(1) + '%'; };
  var cols = [
    { k: 'date', l: '생산날짜', w: 82 },
    { k: 'equip_no', l: '설비', w: 38, center: true, val: function (r) { return +r.equip_no || r.equip_no; } },
    { k: 'code', l: '제번', w: 85 },
    { k: 'name', l: '품명', w: 170 },
    { k: 'kind', l: '구분', w: 42 },
    { k: 'day_reels', l: '주간', t: 'num', w: 42 },
    { k: 'night_reels', l: '야간', t: 'num', w: 42 },
    { k: 'reels', l: '합계R/L', t: 'num', w: 50 },
    { k: 'boxes', l: 'BOX', t: 'num', w: 42, fmt: function (v) { return v === null || v === undefined ? '' : App.fmt(v, 1); } },
    { k: 'qty', l: '일 생산량', t: 'int', w: 75, fmt: function (v) { return '<b>' + App.fmt(v) + '</b>'; } },
    { k: 'day_worker', l: '주간작업자', w: 62 },
    { k: 'night_worker', l: '야간작업자', w: 62 },
    { k: 'start_time', l: '시작', w: 42, center: true },
    { k: 'end_time', l: '종료', w: 42, center: true },
    { k: 'work_min', l: '작업(분)', t: 'int', w: 52 },
    { k: 'downtime', l: '부동(분)', t: 'int', w: 52, fmt: function (v) { return v ? '<span style="color:var(--bad)">' + App.fmt(v) + '</span>' : ''; } },
    { k: 'run_min', l: '실적(분)', t: 'int', w: 52 },
    { k: 'dt_note', l: '비가동 비고', w: 110 },
    { k: 'mold_no', l: '금형', w: 60 },
    { k: 'shots', l: '금형타수', t: 'int', w: 75 },
    { k: 'loss_pcs', l: 'LOSS(EA)', t: 'int', w: 60 },
    { k: 'defect_qty', l: '공정불량', t: 'int', w: 60 },
    { k: 'theo', l: '이론생산량', t: 'int', w: 75 },
    { k: 'perf', l: '성능', w: 50, num: true, val: function (r) { return r.theo ? r.qty / r.theo : null; }, fmt: pct },
    { k: 'note', l: '비고', w: 100 }
  ].concat(App.auditCols());
  var sumEl = root.querySelector('[data-sum]');
  var grid = new App.Grid(root.querySelector('.gridbox'), {
    cols: cols, sort: { k: 'date', dir: -1 }, hint: '두 번 클릭하면 수정 · 빨간 행 = 금형번호/SPM 미등록 제번',
    rowClass: function (r) { return r.missing ? 'r-bad' : (r.kind ? 'r-warn' : ''); },
    extraFilter: function (r) { var e = root.querySelector('[data-f=equip]').value; return !e || String(r.equip_no) === e; },
    onDbl: function (r) { openForm(r, 'edit'); },
    onRender: function (rows) {
      var s = function (k) { return rows.reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0); };
      var q = s('qty'), w = s('work_min'), run = s('run_min'), th = s('theo'), dq = s('defect_qty');
      var t = w ? run / w : null, p = th ? q / th : null, ql = q ? (q - dq) / q : null;
      sumEl.innerHTML = item('생산량', App.fmt(q) + ' EA') + item('주간 / 야간', App.fmt(s('day_qty')) + ' / ' + App.fmt(s('night_qty'))) +
        item('작업 / 부동 / 실적', App.fmt(w) + ' / ' + App.fmt(s('downtime')) + ' / ' + App.fmt(run) + ' 분') +
        item('시간가동률', pct(t)) + item('성능가동률', pct(p)) + item('품질률', ql === null ? '' : (ql * 100).toFixed(2) + '%') +
        item('OEE', t !== null && p !== null && ql !== null ? pct(t * p * ql) : '');
    }
  });
  function item(l, v) { return '<span><span class="muted">' + l + '</span> <b>' + v + '</b></span>'; }
  var search = root.querySelector('.search');
  search.addEventListener('input', function () { grid.setFilter(search.value); });
  root.querySelector('[data-f=equip]').addEventListener('change', function () { grid.render(); });

  var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('prod_period', { d1: App.addDays(-6), d2: App.today() }), function (p) {
    App.store.set('prod_period', p); load();
  });

  function load(selId) {
    var p = period.get();
    var keep = selId || (grid.selected() || {}).id;
    return Promise.all([App.get('/api/production?d1=' + (p.d1 || '') + '&d2=' + (p.d2 || '')), App.refList('equipment')]).then(function (res) {
      var fe = root.querySelector('[data-f=equip]'), v = fe.value;
      fe.innerHTML = '<option value="">전체 설비</option>' + res[1].map(function (e) { return '<option value="' + App.esc(e.no) + '">' + App.esc(e.no) + '호기</option>'; }).join('');
      fe.value = v;
      grid.setRows(res[0]);
      if (keep) grid.selectKey(keep, true);
    }).catch(App.err);
  }
  function checkMissing() {
    App.get('/api/production/missing').then(function (m) {
      var el = root.querySelector('[data-miss]');
      if (!m.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.innerHTML = '⚠ 금형번호 또는 SPM 이 없는 제번 <b>' + m.length + '개</b>가 실적에 있습니다. 금형 타수·이론생산량이 0 으로 계산됩니다. <a href="#/prod_missing">확인하기 →</a>';
    });
  }

  // 입력창
  var products = null;
  function productInfo(code) {
    var p = products ? Promise.resolve(products) : App.refList('products', true).then(function (r) { products = r; return r; });
    return p.then(function (rows) { var c = (code || '').toLowerCase(); return rows.filter(function (x) { return (x.code || '').toLowerCase() === c; })[0]; });
  }
  function openForm(row, mode) {
    var edit = mode === 'edit';
    var vals = row ? Object.assign({}, row) : { date: App.today() };
    // 작업시간(시작·종료)은 자동으로 넣지 않음 — 직접 입력
    if (mode === 'copy') { delete vals.id; vals.date = App.today(); vals.start_time = ''; vals.end_time = ''; }
    var top = '<div class="move-info" data-info style="display:none"></div>';
    var dlg = App.form({
      title: edit ? '생산실적 수정' : '생산실적 입력', cols: spec.cols, values: vals, mode: edit ? 'edit' : 'new', wide: true, top: top,
      onChange: function (k, v, setVal, read) {
        if (k === 'code') showProduct(v);
        if (k === 'equip_no' && !edit && v) {
          var cur = read();
          if (!cur.code) {
            App.get('/api/production/last?equip=' + encodeURIComponent(v)).then(function (l) {
              if (!l || !l.code) return;
              ['code', 'day_worker', 'night_worker'].forEach(function (x) { if (!read()[x]) setVal(x, l[x]); });
              showProduct(l.code);
              App.toast(v + '호기 직전 실적(' + l.date + ')의 제번·작업자를 불러왔습니다. 작업시간은 직접 입력하세요.');
            });
          }
        }
      },
      extraButtons: edit ? [] : [{
        label: '저장 후 계속 입력', onClick: function (d) {
          d.error('');
          var v = d.read();
          App.api('POST', '/api/t/production', v).then(function () {
            App.toast('저장했습니다. 다음 실적을 입력하세요.');
            ['equip_no', 'code', 'start_time', 'end_time', 'day_reels', 'night_reels', 'dt_setup', 'dt_first', 'dt_mold', 'dt_equip', 'dt_etc', 'dt_note',
              'loss_mold_chg', 'loss_mold_fix', 'loss_coil', 'loss_adjust', 'loss_vision', 'loss_init', 'mat_qty', 'note'].forEach(function (k) { dlg.setVal(k, ''); });
            dlg.el.querySelector('[data-info]').style.display = 'none';
            var f = dlg.el.querySelector('[data-k=equip_no]'); if (f) f.focus();
            load(); App.refreshBadges();
          }).catch(function (e) { d.error(e.message); });
        }
      }],
      onSave: function (v) {
        var p = edit ? App.api('PUT', '/api/t/production/' + row.id, v) : App.api('POST', '/api/t/production', v);
        return p.then(function (r) { App.toast('저장했습니다.'); load(edit ? row.id : r.id); App.refreshBadges(); checkMissing(); });
      }
    });
    function showProduct(code) {
      var box = dlg.el.querySelector('[data-info]');
      if (!code) { box.style.display = 'none'; return; }
      productInfo(code).then(function (p) {
        box.style.display = '';
        if (!p) { box.innerHTML = '<span class="tag bad">등록되지 않은 제번</span> 기준정보 > 제품 에서 먼저 등록하세요.'; return; }
        var warn = (!p.mold_no || !(p.spm > 0)) ? ' <span class="tag bad">' + (!p.mold_no ? '금형번호 없음 ' : '') + (!(p.spm > 0) ? 'SPM 없음' : '') + '</span>' : '';
        box.innerHTML = '<div><div class="muted">품명</div><b>' + App.esc(p.name || '') + '</b>' + warn + '</div>' +
          '<div><div class="muted">금형</div>' + App.esc(p.mold_no || '-') + '</div>' +
          '<div><div class="muted">릴수량</div>' + App.fmt(p.reel_qty) + '</div>' +
          '<div><div class="muted">SPM × 효율</div>' + App.fmt(p.spm) + ' × ' + App.fmt(p.efficiency) + '</div>';
      });
    }
    if (vals.code) showProduct(vals.code);
  }

  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    var r = grid.selected();
    if ((a === 'edit' || a === 'del' || a === 'copy') && !r) { App.toast('목록에서 실적을 먼저 선택하세요.', 'warn'); return; }
    if (a === 'add') openForm(null, 'new');
    else if (a === 'copy') openForm(r, 'copy');
    else if (a === 'edit') openForm(r, 'edit');
    else if (a === 'del') {
      App.confirm(r.date + ' ' + r.equip_no + '호기 ' + r.code + ' 실적을 삭제할까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/t/production/' + r.id).then(function () { App.toast('삭제했습니다.'); load(); App.refreshBadges(); }).catch(App.err);
      });
    } else if (a === 'xlsx') {
      var p = period.get();
      var xc = cols.concat([{ k: 'dt_setup', l: '금형셋업' }, { k: 'dt_first', l: '초품검사' }, { k: 'dt_mold', l: '금형수리' }, { k: 'dt_equip', l: '설비수리' }, { k: 'dt_etc', l: '기타' },
        { k: 'day_qty', l: '주간생산량' }, { k: 'night_qty', l: '야간생산량' }, { k: 'day_min', l: '주간작업시간' }, { k: 'night_min', l: '야간작업시간' },
        { k: 'loss_mold_chg', l: 'LOSS 금형교체' }, { k: 'loss_mold_fix', l: 'LOSS 금형수리' }, { k: 'loss_coil', l: 'LOSS 원재료교체' }, { k: 'loss_adjust', l: 'LOSS 조건조정' },
        { k: 'loss_vision', l: 'LOSS 비전셋업' }, { k: 'loss_init', l: 'LOSS 초기허용' }, { k: 'inspect_loss', l: '제품검사' }, { k: 'unit_rate', l: '단위이론율' }]);
      var sh = grid.sheet('생산실적', xc);
      sh.fmts = xc.map(function (c) { return c.k === 'perf' ? 'pct' : ''; });
      App.exportXlsx('생산실적_' + (p.d1 || '') + '_' + (p.d2 || '') + '.xlsx', [sh]);
    }
  });
  load();
  checkMissing();
};
