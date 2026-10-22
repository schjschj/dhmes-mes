/* 원재료 재고 / 입출고 이력 — 창고 PC 원재료관리 프로그램(DataBase.mdb)을 읽기만 함
   화면을 열 때 자동으로 창고 파일을 확인 (바뀌었을 때만 다시 읽음), [새로고침] 은 바로 다시 읽기 */
App.pages.rawmat = function (root, args) {
  var tab = args.tab || 'stock';
  var esc = App.esc, fmt = App.fmt;
  var data = null, view = App.store.get('rm_view', 'roll');
  root.innerHTML = '<div class="page-full rm">' +
    '<div class="toolbar">' +
    (tab === 'stock'
      ? '<div class="seg" data-views><button class="btn" data-v="roll">롤별</button><button class="btn" data-v="part">품번별 합계</button><button class="btn" data-v="loc">위치별</button></div>'
      : '<span data-period style="display:contents"></span><input class="input" data-bc placeholder="바코드로 찾기" style="width:150px">') +
    '<input class="input search" placeholder="품번 / 재질 / 규격 / LOT / 위치 검색">' +
    '<span class="grow"></span>' +
    '<button class="btn" data-a="refresh" title="창고 PC 의 파일을 지금 다시 읽습니다">새로고침</button>' +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    (App.me && App.me.admin ? '<button class="btn" data-a="path" title="관리자만">창고 데이터 위치</button>' : '') +
    '</div>' +
    '<div class="rm-status" data-status>창고 데이터 확인 중…</div>' +
    '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var box = root.querySelector('.gridbox'), statusEl = root.querySelector('[data-status]'), search = root.querySelector('.search');
  var grid = null;
  var kg = function (v) { return v === null || v === undefined ? '' : fmt(Math.round(v)); };
  var date = function (v) { return v ? esc(String(v).slice(0, 10)) : ''; };
  var dt = function (v) { return v ? esc(String(v).slice(0, 16)) : ''; };
  var stateTag = function (v) { return v ? '<span class="tag ' + (v === '보관' ? 'ok' : v === '반출' ? 'warn' : 'gray') + '">' + esc(v) + '</span>' : ''; };
  var prdTag = function (v) { return v && v !== '합격' ? '<span class="tag bad">' + esc(v) + '</span>' : esc(v || ''); };

  var COLS = {
    roll: [
      { k: 'barcode', l: '바코드', w: 110, mono: true }, { k: 'part_no', l: '품번', w: 70 }, { k: 'material', l: '재질', w: 140 }, { k: 'spec', l: '규격', w: 70 },
      { k: 'weight', l: '중량(kg)', t: 'num', w: 60, fmt: kg }, { k: 'lot', l: 'LOT', w: 80 }, { k: 'lctn', l: '위치', w: 60, center: true },
      { k: 'isd', l: '입고일', w: 80, fmt: date, center: true }, { k: 'days', l: '입고 경과(일)', t: 'int', w: 60 },
      { k: 'mfd', l: '제조일', w: 80, fmt: date, center: true }, { k: 'rd', l: '최근 처리', w: 110, fmt: dt, center: true },
      { k: 'prd', l: '판정', w: 50, center: true, fmt: prdTag, xval: function (r) { return r.prd; } }, { k: 'remark', l: '비고', w: 120 }
    ],
    part: [
      { k: 'part_no', l: '품번', w: 70 }, { k: 'material', l: '재질', w: 160 }, { k: 'spec', l: '규격', w: 80 },
      { k: 'rolls', l: '롤 수', t: 'int', w: 50 }, { k: 'weight', l: '총중량(kg)', t: 'num', w: 80, fmt: kg },
      { k: 'oldest', l: '가장 오래된 입고일', w: 100, fmt: date, center: true }, { k: 'lctns', l: '위치', w: 200 }
    ],
    loc: [
      { k: 'lctn', l: '위치', w: 80 }, { k: 'rolls', l: '롤 수', t: 'int', w: 50 }, { k: 'weight', l: '총중량(kg)', t: 'num', w: 80, fmt: kg },
      { k: 'parts', l: '품번 (규격)', w: 420 }
    ],
    hist: [
      { k: 'rd', l: '처리 일시', w: 120, fmt: dt, center: true }, { k: 'state', l: '구분', w: 50, center: true, fmt: stateTag, xval: function (r) { return r.state; } },
      { k: 'barcode', l: '바코드', w: 110, mono: true }, { k: 'part_no', l: '품번', w: 70 }, { k: 'material', l: '재질', w: 140 }, { k: 'spec', l: '규격', w: 70 },
      { k: 'weight', l: '중량(kg)', t: 'num', w: 60, fmt: kg }, { k: 'lot', l: 'LOT', w: 80 }, { k: 'lctn', l: '위치', w: 60, center: true },
      { k: 'isd', l: '입고일', w: 80, fmt: date, center: true }, { k: 'prd', l: '판정', w: 50, center: true, fmt: prdTag, xval: function (r) { return r.prd; } },
      { k: 'remark', l: '비고', w: 120 }
    ]
  };

  function makeGrid(kind) {
    box.innerHTML = '';
    grid = new App.Grid(box, {
      cols: COLS[kind], key: kind === 'roll' ? 'barcode' : kind === 'part' ? 'part_no' : kind === 'loc' ? 'lctn' : 'seq',
      hint: kind === 'roll' || kind === 'hist' ? '두 번 클릭하면 그 코일(바코드)의 전체 이력' : kind === 'part' ? '두 번 클릭하면 그 품번의 롤 목록' : '두 번 클릭하면 그 위치의 롤 목록',
      rowClass: function (r) { return r.prd && r.prd !== '합격' ? 'row-bad' : ''; },
      onDbl: function (r) {
        if (kind === 'roll' || kind === 'hist') showBarcode(r.barcode);
        else if (kind === 'part') { setView('roll'); search.value = r.part_no; grid.setFilter(r.part_no); }
        else if (kind === 'loc') { setView('roll'); search.value = r.lctn; grid.setFilter(r.lctn); }
      }
    });
    if (search.value) grid.setFilter(search.value);
  }
  search.addEventListener('input', function () { if (grid) grid.setFilter(search.value); });

  // ---------------------------------------------------------------- 재고
  function partRows() {
    var m = {}, order = [];
    data.stock.forEach(function (r) {
      var x = m[r.part_no];
      if (!x) { x = m[r.part_no] = { part_no: r.part_no, material: r.material, spec: r.spec, rolls: 0, weight: 0, oldest: '', lc: {} }; order.push(x); }
      x.rolls++; x.weight += r.weight || 0;
      if (r.isd && (!x.oldest || r.isd < x.oldest)) x.oldest = r.isd;
      x.lc[r.lctn] = (x.lc[r.lctn] || 0) + 1;
    });
    order.forEach(function (x) { x.lctns = Object.keys(x.lc).map(function (k) { return k + (x.lc[k] > 1 ? '(' + x.lc[k] + ')' : ''); }).join(', '); });
    return order;
  }
  function locRows() {
    var m = {}, out = [];
    data.stock.forEach(function (r) {
      var x = m[r.lctn];
      if (!x) { x = m[r.lctn] = { lctn: r.lctn, rolls: 0, weight: 0, pp: {} }; out.push(x); }
      x.rolls++; x.weight += r.weight || 0;
      var k = r.part_no + (r.spec ? ' (' + r.spec + ')' : '');
      x.pp[k] = (x.pp[k] || 0) + 1;
    });
    out.forEach(function (x) { x.parts = Object.keys(x.pp).map(function (k) { return k + (x.pp[k] > 1 ? ' ×' + x.pp[k] : ''); }).join(', '); });
    out.sort(function (a, b) { return String(a.lctn).localeCompare(String(b.lctn), 'ko', { numeric: true }); });
    return out;
  }
  function setView(v) {
    view = v; App.store.set('rm_view', v);
    App.$$('[data-v]', root).forEach(function (b) { b.classList.toggle('primary', b.dataset.v === v); });
    makeGrid(v);
    if (data) grid.setRows(v === 'roll' ? data.stock : v === 'part' ? partRows() : locRows());
  }
  if (tab === 'stock') root.querySelector('[data-views]').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) { search.value = ''; setView(b.dataset.v); } });

  function showStatus() {
    var m = (data && data.meta) || {};
    var s = '';
    if (!data || !data.has_path) {
      s = '<span class="tag warn">설정 필요</span> 창고 데이터베이스 위치가 아직 정해지지 않았습니다.' + (App.me && App.me.admin ? ' 오른쪽 위 [창고 데이터 위치] 에서 정해 주세요.' : ' 관리자에게 요청하세요.');
    } else {
      if (m.error) s += '<div class="rm-err">⚠ ' + esc(m.error) + (m.read_at ? '<br>마지막으로 읽은 자료(' + esc(m.read_at.slice(5, 16)) + ')를 보여 줍니다.' : '') + '</div>';
      var tot = 0, parts = {};
      (data.stock || []).forEach(function (r) { tot += r.weight || 0; parts[r.part_no] = 1; });
      s += m.read_at ? '창고 데이터 <b>' + esc(m.read_at.slice(5, 16)) + '</b> 읽음' + (m.read_by ? ' (' + esc(m.read_by) + ')' : '') +
        (m.file_time ? ' · 창고 파일 마지막 수정 ' + esc(m.file_time.slice(5, 16)) : '') +
        ' · 현재 재고 <b>' + fmt(data.stock.length) + '</b>롤 · <b>' + fmt(Math.round(tot)) + '</b> kg · ' + Object.keys(parts).length + '품번' : '';
    }
    statusEl.innerHTML = s;
  }

  // ---------------------------------------------------------------- 불러오기 (화면 열 때: 창고 파일 확인 → 자료)
  function load(force) {
    statusEl.innerHTML = '<span class="muted">창고 데이터 확인 중…</span>' + (data ? '' : '');
    return App.api('POST', '/api/rm/refresh', { force: !!force }).catch(function () { return null; }).then(function (r) {
      if (r && r.status === 'busy' && force) App.toast('다른 사람이 지금 읽는 중입니다. 잠시 뒤 다시 보여 줍니다.');
      if (r && r.status === 'read' && force) App.toast('창고 데이터를 다시 읽었습니다.');
      return App.get('/api/rm/data');
    }).then(function (d) {
      data = d;
      showStatus();
      if (tab === 'stock') setView(view); else loadHist();
    }).catch(App.err);
  }

  // ---------------------------------------------------------------- 이력
  var period = null;
  if (tab === 'hist') {
    period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('rm_period', { d1: App.addDays(-30), d2: App.today() }), function (p) {
      App.store.set('rm_period', p); loadHist();
    });
    root.querySelector('[data-bc]').addEventListener('change', loadHist);
  }
  function loadHist() {
    var p = period.get(), bc = root.querySelector('[data-bc]').value.trim();
    makeGrid('hist');
    App.get('/api/rm/history?' + (bc ? 'barcode=' + encodeURIComponent(bc) : 'd1=' + p.d1 + '&d2=' + (p.d2 || ''))).then(function (rows) { grid.setRows(rows); }).catch(App.err);
  }
  function showBarcode(bc) {
    App.get('/api/rm/history?barcode=' + encodeURIComponent(bc)).then(function (rows) {
      var first = rows[rows.length - 1] || {};
      var b = App.h('<div><div class="muted" style="margin-bottom:8px">' + esc(first.part_no || '') + ' · ' + esc(first.material || '') + ' ' + esc(first.spec || '') +
        ' · LOT ' + esc(first.lot || '') + ' · 입고 ' + date(first.isd) + ' · 제조 ' + date(first.mfd) + '</div>' +
        '<table class="mini" style="width:100%"><tr><th>처리 일시</th><th>구분</th><th class="num">중량(kg)</th><th>위치</th><th>판정</th><th>비고</th></tr>' +
        rows.map(function (r) {
          return '<tr><td>' + dt(r.rd) + '</td><td>' + stateTag(r.state) + '</td><td class="num">' + kg(r.weight) + '</td><td>' + esc(r.lctn) + '</td><td>' + prdTag(r.prd) + '</td><td>' + esc(r.remark || '') + '</td></tr>';
        }).join('') + '</table></div>');
      App.dialog({ title: '코일 이력 — ' + bc, body: b, wide: true });
    }).catch(App.err);
  }

  // ---------------------------------------------------------------- 버튼
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'refresh') load(true);
    else if (a === 'xlsx' && grid) {
      var nm = tab === 'hist' ? '원재료_입출고이력' : { roll: '원재료_재고_롤별', part: '원재료_재고_품번별', loc: '원재료_재고_위치별' }[view];
      App.exportXlsx(nm + '_' + App.stamp() + '.xlsx', [grid.sheet(nm.replace('원재료_', ''))]);
    } else if (a === 'path') pathDialog();
  });
  function pathDialog() {
    var d = App.dialog({
      title: '창고 데이터베이스 위치 (관리자)',
      body: '<div><p class="desc" style="margin-top:0">창고 PC 원재료관리 프로그램의 <b>DataBase.mdb</b> 위치를 넣으세요. 통합관리 서버 PC 에서 열 수 있는 경로여야 합니다.</p>' +
        '<input class="input" data-p style="width:100%" placeholder="예) \\\\창고PC\\공유\\DataBase.mdb" value="' + esc((data && data.path) || '') + '">' +
        '<div class="form" style="grid-template-columns:1fr 1fr;margin-top:10px">' +
        '<label class="f"><span>창고 PC 사용자 이름 (필요할 때만)</span><input class="input" data-u value="' + esc((data && data.share_user) || '') + '" placeholder="예) 창고PC\\user"></label>' +
        '<label class="f"><span>비밀번호</span><input class="input" type="password" data-w placeholder="' + (data && data.share_pw_set ? '저장됨 (바꿀 때만 입력)' : '') + '"></label></div>' +
        '<div class="form" style="grid-template-columns:1fr;margin-top:8px">' +
        '<label class="f"><span>파일 암호 (Access 파일에 암호가 걸린 경우)</span><input class="input" type="password" data-dw placeholder="' + (data && data.db_pw_set ? '저장됨 (바꿀 때만 입력)' : '암호가 없으면 비워 두세요') + '"></label></div>' +
        '<p class="muted" style="font-size:12px;line-height:1.6">· 창고 PC 공유폴더 경로를 탐색기 주소창에서 복사해 붙여 넣으면 됩니다. (\\\\컴퓨터이름\\공유폴더\\DataBase.mdb)<br>' +
        '· 서버는 윈도우 \'시스템\' 계정으로 돌아가서, 공유폴더에 비밀번호가 걸려 있으면 창고 PC 의 윈도우 사용자 이름·비밀번호가 필요합니다. 아니면 비워 두세요.<br>' +
        '· <b>파일 암호</b>는 공유폴더 비밀번호와 다릅니다. Access 파일을 열 때 암호를 물어보면 그 암호를 넣으세요.<br>' +
        '· [저장] 을 누르면 바로 읽어 보고, 안 되면 이유를 알려 줍니다. 창고 파일은 읽기만 하고 고치지 않습니다.<br>' +
        '· 권한 오류가 나면 창고 PC 공유폴더를 \'모든 사람 읽기\' 로 열어 주세요.</p></div>',
      buttons: [{ label: '취소' }, {
        label: '저장 (연결 시험)', cls: 'primary', onClick: function (dd) {
          var p = dd.el.querySelector('[data-p]').value.trim(), pw = dd.el.querySelector('[data-w]').value, dw = dd.el.querySelector('[data-dw]').value;
          var body = { path: p, user: dd.el.querySelector('[data-u]').value.trim() };
          if (pw || !body.user) body.pw = pw;        // 비밀번호 칸을 비우면 저장된 것 그대로 (사용자 이름을 지우면 비밀번호도 지움)
          if (dw) body.dbpw = dw;                    // 파일 암호: 입력했을 때만 바꿈 (비우면 저장된 것 그대로)
          dd.busy(true); dd.error('창고 데이터를 읽는 중…');
          App.api('PUT', '/api/rm/path', body).then(function (r) {
            dd.close(); App.toast('연결되었습니다. 창고 기록 ' + fmt(r.rows || 0) + '줄을 읽었습니다.'); load(false);
          }).catch(function (err) { dd.busy(false); dd.error(err.message); });
        }
      }]
    });
    setTimeout(function () { var i = d.el.querySelector('[data-p]'); i.focus(); i.select(); }, 50);
  }

  load(false);
};
