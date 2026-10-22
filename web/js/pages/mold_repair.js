/* 금형 수리이력 (금형수리이력카드) */
App.pages.mold_repair = function (root, args) {
  args = args || {};
  var esc = App.esc;
  var lv = App.curLevel || 1;
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<div class="seg"><button class="btn on" data-v="list">목록</button><button class="btn" data-v="stats">금형별 · 유형별 집계</button></div>' +
    '<input class="input search" placeholder="금형번호 / 문제점 / 원인 / 수리내용 / 수리자 검색" style="width:240px">' +
    '<input type="date" class="input" data-f="d1"> ~ <input type="date" class="input" data-f="d2">' +
    '<select class="input" data-f="type"><option value="">전체 수리유형</option></select>' +
    '<span class="grow"></span>' +
    (lv >= 2 ? '<button class="btn primary" data-a="add">+ 수리 등록</button><button class="btn" data-a="edit">수정</button>' : '') +
    (lv >= 3 ? '<button class="btn danger" data-a="del">삭제</button>' : '') +
    (lv >= 2 ? '<button class="btn" data-a="imp" title="금형수리이력카드 .xls 여러 개 또는 .zip">카드 가져오기</button>' : '') +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '</div><div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>' +
    '<div class="statbox" style="flex:1;overflow:auto;display:none"></div></div>';
  var types = {}, molds = {}, view = 'list';
  var $ = function (s) { return root.querySelector(s); };
  function tnames(v) { return (v || '').split(',').filter(Boolean).map(function (t) { return types[t] || t; }).join(', '); }
  var cols = [
    { k: 'date', l: '일자', w: 85 },
    { k: 'mold_no', l: '금형번호', w: 75, mono: true, fmt: function (v) { return molds[v] ? esc(v) : esc(v) + ' <span class="tag warn" title="기준정보 금형에 없음">?</span>'; }, xval: function (r) { return r.mold_no; } },
    { k: 'code', l: '제번', w: 85 },
    { k: 'part_name', l: '대표 품명', w: 150, val: function (r) { return (molds[r.mold_no] || {}).part_name || ''; } },
    { k: 'types', l: '수리유형', w: 100, val: function (r) { return tnames(r.types); }, fmt: function (v) { return v ? '<span class="tag">' + esc(v) + '</span>' : ''; } },
    { k: 'problem', l: '문제점', w: 140 },
    { k: 'cause', l: '원인', w: 150 },
    { k: 'fix', l: '수리내용', w: 260 },
    { k: 'reels', l: '생산 릴', t: 'num', w: 55 },
    { k: 'qty', l: '생산수량', t: 'int', w: 80 },
    { k: 'worker', l: '수리자', w: 65 },
    { k: 'note', l: '비고', w: 160 },
    { k: 'src', l: '원본 카드', w: 200 }
  ].concat(App.auditCols());
  var grid = new App.Grid($('.gridbox'), {
    cols: cols, sort: { k: 'date', dir: -1 }, hint: '두 번 클릭하면 수정',
    extraFilter: function (r) {
      var d1 = $('[data-f=d1]').value, d2 = $('[data-f=d2]').value, t = $('[data-f=type]').value;
      if (d1 && r.date < d1) return false;
      if (d2 && r.date > d2) return false;
      if (t && (',' + (r.types || '') + ',').indexOf(',' + t + ',') < 0) return false;
      return true;
    },
    onDbl: lv >= 2 ? function (r) { form(r); } : null
  });
  var search = $('.search');
  if (args.mold) search.value = args.mold;
  search.addEventListener('input', function () { grid.setFilter(search.value); if (view === 'stats') stats(); });
  App.$$('[data-f]', root).forEach(function (el) { el.addEventListener('change', function () { if (view === 'stats') stats(); else grid.render(); }); });

  function load() {
    return Promise.all([App.get('/api/t/mold_repair'), App.refList('molds', true), App.get('/api/t/repair_types')]).then(function (res) {
      molds = {};
      res[1].forEach(function (m) { molds[m.mold_no] = m; });
      types = {};
      res[2].forEach(function (t) { types[t.code] = t.name; });
      var sel = $('[data-f=type]'), cur = sel.value;
      sel.innerHTML = '<option value="">전체 수리유형</option>' + res[2].map(function (t) { return '<option value="' + esc(t.code) + '">' + esc(t.code + '. ' + t.name) + '</option>'; }).join('');
      sel.value = cur;
      grid.setRows(res[0]);
      if (args.mold) grid.setFilter(args.mold);
      if (view === 'stats') stats();
    }).catch(App.err);
  }
  function stats() {
    var box = $('.statbox');
    var d1 = $('[data-f=d1]').value, d2 = $('[data-f=d2]').value, q = search.value.trim().toUpperCase();
    App.get('/api/mold_repair/stats?d1=' + (d1 || '') + '&d2=' + (d2 || '')).then(function (r) {
      var rows = r.rows.filter(function (x) { return !q || x.mold_no.toUpperCase().indexOf(q) >= 0 || ((molds[x.mold_no] || {}).part_name || '').toUpperCase().indexOf(q) >= 0; });
      var tot = { total: 0 };
      rows.forEach(function (x) { tot.total += x.total; r.types.forEach(function (t) { tot[t[0]] = (tot[t[0]] || 0) + (x[t[0]] || 0); }); });
      stats.sheet = { name: '금형별 수리유형', head: ['금형번호', '대표 품명', '합계'].concat(r.types.map(function (t) { return t[0] + '. ' + t[1]; })),
        rows: rows.map(function (x) { return [x.mold_no, (molds[x.mold_no] || {}).part_name || '', x.total].concat(r.types.map(function (t) { return x[t[0]] || 0; })); }) };
      box.innerHTML = '<div class="muted" style="font-size:12px;margin:4px 0 8px">' + (d1 || d2 ? esc((d1 || '처음') + ' ~ ' + (d2 || '지금')) : '전체 기간') + ' · 한 건에 유형이 여러 개면 각각 셈 · 금형번호를 누르면 그 금형 목록</div>' +
        '<table class="mini" style="min-width:900px"><tr><th>금형번호</th><th>대표 품명</th><th class="num">합계</th>' + r.types.map(function (t) { return '<th class="num">' + esc(t[0] + '. ' + t[1]) + '</th>'; }).join('') + '</tr>' +
        '<tr style="font-weight:700;background:var(--line-2)"><td>전체</td><td>' + rows.length + '개 금형</td><td class="num">' + App.fmt(tot.total) + '</td>' + r.types.map(function (t) { return '<td class="num">' + (tot[t[0]] ? App.fmt(tot[t[0]]) : '') + '</td>'; }).join('') + '</tr>' +
        rows.map(function (x) {
          return '<tr><td><a href="#" data-m="' + esc(x.mold_no) + '">' + esc(x.mold_no) + '</a></td><td>' + esc((molds[x.mold_no] || {}).part_name || '') + '</td><td class="num"><b>' + App.fmt(x.total) + '</b></td>' +
            r.types.map(function (t) { return '<td class="num">' + (x[t[0]] ? App.fmt(x[t[0]]) : '') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table>';
    }).catch(App.err);
  }
  function setView(v) {
    view = v;
    App.$$('[data-v]', root).forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    $('.gridbox').style.display = v === 'list' ? 'flex' : 'none';
    $('.statbox').style.display = v === 'stats' ? '' : 'none';
    if (v === 'stats') stats();
  }
  var mlist = null;
  function moldList() {
    return mlist ? Promise.resolve(mlist) : App.get('/api/mold_repair/molds').then(function (d) { mlist = d.rows; return mlist; });
  }
  function form(r) {
    var edit = !!(r && r.id);
    var v = edit ? Object.assign({}, r) : { date: App.today(), mold_no: args.mold || '', worker: App.user || '' };
    moldList().then(function (ml) {
      var byNo = {};
      ml.forEach(function (m) { byNo[m.mold_no.toUpperCase()] = m; });
      var tlist = Object.keys(types).sort(function (a, b) { return (+a || 99) - (+b || 99); });
      var cur = (v.types || '').split(',');
      var body = App.h('<div><div class="form">' +
        '<label class="f"><span>금형번호 *</span><input class="input" data-k="mold_no" list="mrMolds" autocomplete="off" value="' + esc(v.mold_no || '') + '" placeholder="기초 금형번호 (예: 10933)"></label>' +
        '<label class="f"><span>제번</span><select class="input" data-k="code"></select></label>' +
        '<div class="f full muted" data-minfo style="font-size:12px;margin-top:-4px"></div>' +
        '<label class="f"><span>일자 *</span><input class="input" type="date" data-k="date" value="' + esc(v.date || '') + '"></label>' +
        '<label class="f"><span>수리자</span><input class="input" data-k="worker" value="' + esc(v.worker || '') + '"></label>' +
        '<label class="f full"><span>문제점 (의뢰내용)</span><textarea class="input" data-k="problem" rows="2">' + esc(v.problem || '') + '</textarea></label>' +
        '<label class="f full"><span>원인</span><textarea class="input" data-k="cause" rows="2">' + esc(v.cause || '') + '</textarea></label>' +
        '<label class="f full"><span>수리내용</span><textarea class="input" data-k="fix" rows="3">' + esc(v.fix || '') + '</textarea></label>' +
        '<div class="f full"><span>수리유형 (여러 개 가능)</span><div class="mr-types">' + tlist.map(function (t) {
          return '<label class="chk"><input type="checkbox" data-t="' + esc(t) + '"' + (cur.indexOf(t) >= 0 ? ' checked' : '') + '> ' + esc(t + '. ' + types[t]) + '</label>';
        }).join('') + '</div></div>' +
        '<label class="f"><span>생산 릴</span><input class="input num" data-k="reels" value="' + esc(v.reels === null || v.reels === undefined ? '' : v.reels) + '"></label>' +
        '<label class="f"><span>생산수량 (EA) <span class="muted" data-rq style="font-weight:400"></span></span><input class="input num" data-k="qty" value="' + esc(v.qty === null || v.qty === undefined ? '' : v.qty) + '"></label>' +
        '<label class="f full"><span>비고</span><input class="input" data-k="note" value="' + esc(v.note || '') + '"></label>' +
        '</div><datalist id="mrMolds">' + ml.map(function (m) { return '<option value="' + esc(m.mold_no) + '">' + esc((m.part_no || '') + ' ' + (m.part_name || '')) + '</option>'; }).join('') + '</datalist></div>');
      if (!document.getElementById('mrCss')) {
        var st = document.createElement('style'); st.id = 'mrCss';
        st.textContent = '.mr-types{display:flex;flex-wrap:wrap;gap:4px 12px;padding:4px 0}.mr-types .chk{white-space:nowrap}';
        document.head.appendChild(st);
      }
      var g = function (k) { return body.querySelector('[data-k=' + k + ']'); };
      var qtyAuto = !edit || v.qty === null || v.qty === undefined || v.qty === '';
      function rq() {
        var c = g('code').value, m = byNo[(g('mold_no').value || '').trim().toUpperCase()];
        var p = m && m.products.filter(function (x) { return x.code === c; })[0];
        return p ? +p.reel_qty || 0 : 0;
      }
      function calc() {
        var q = rq();
        g('qty').closest('label').querySelector('[data-rq]').textContent = q ? '릴당 ' + App.fmt(q) + '개' : '';
        var rl = parseFloat((g('reels').value || '').replace(/,/g, ''));
        if (qtyAuto && q && !isNaN(rl)) g('qty').value = Math.round(rl * q);
      }
      function fillCodes(keep) {
        var no = (g('mold_no').value || '').trim().toUpperCase();
        var m = byNo[no];
        var sel = g('code');
        var info = body.querySelector('[data-minfo]');
        if (!m) {
          sel.innerHTML = keep && v.code ? '<option>' + esc(v.code) + '</option>' : '<option value=""></option>';
          info.innerHTML = no ? '<span style="color:var(--bad)">기준정보에 없는 금형번호입니다</span>' : '';
          calc(); return;
        }
        info.textContent = (m.part_name || '') + (m.last ? ' · 최근 생산 ' + m.last[0] + ' (' + m.last[1] + ')' : '');
        var pick = keep && v.code ? v.code : (m.last ? m.last[0] : (m.products[0] || {}).code);
        var opts = m.products.slice();
        if (pick && !opts.some(function (x) { return x.code === pick; })) opts.unshift({ code: pick, name: '', reel_qty: 0 });
        sel.innerHTML = (opts.length ? '' : '<option value="">(이 금형에 등록된 제번 없음)</option>') + opts.map(function (x) {
          return '<option value="' + esc(x.code) + '"' + (x.code === pick ? ' selected' : '') + '>' + esc(x.code + (x.name ? ' · ' + x.name : '') + (x.reel_qty ? ' (릴당 ' + App.fmt(x.reel_qty) + ')' : '')) + '</option>';
        }).join('');
        calc();
      }
      g('mold_no').addEventListener('change', function () { fillCodes(false); });
      g('mold_no').addEventListener('input', function () { if (byNo[(this.value || '').trim().toUpperCase()]) fillCodes(false); });
      g('code').addEventListener('change', calc);
      g('reels').addEventListener('input', calc);
      g('qty').addEventListener('input', function () { qtyAuto = this.value === ''; });
      fillCodes(true);
      App.dialog({
        title: edit ? '금형 수리이력 수정' : '금형 수리 등록', body: body, wide: true,
        buttons: [{ label: '취소' }, {
          label: '저장', cls: 'primary', default: true, onClick: function (dd) {
            var out = {};
            ['mold_no', 'code', 'date', 'worker', 'problem', 'cause', 'fix', 'reels', 'qty', 'note'].forEach(function (k) { out[k] = (g(k).value || '').trim(); });
            out.mold_no = out.mold_no.toUpperCase();
            out.types = App.$$('[data-t]', body).filter(function (x) { return x.checked; }).map(function (x) { return x.dataset.t; }).join(',');
            ['reels', 'qty'].forEach(function (k) { out[k] = out[k].replace(/,/g, ''); });
            if (!out.mold_no) { dd.error('금형번호를 고르세요.'); return; }
            var p = edit ? App.api('PUT', '/api/t/mold_repair/' + r.id, out) : App.api('POST', '/api/t/mold_repair', out);
            p.then(function () { dd.close(); App.toast(edit ? '수정했습니다.' : '수리 이력을 등록했습니다.'); load(); }).catch(function (e) { dd.error(e.message); });
          }
        }]
      });
    }).catch(App.err);
  }
  function importCards() {
    var f = document.createElement('input');
    f.type = 'file'; f.accept = '.xls,.zip'; f.multiple = true;
    f.onchange = function () {
      var files = Array.prototype.slice.call(f.files);
      if (!files.length) return;
      App.toast('카드를 읽는 중입니다… (파일이 많으면 1분쯤 걸림)');
      var res = { files: 0, added: 0, dup: 0, bad: 0, fixed: [], unread: [], skipped_sheets: [], no_mold: [], bad_dates: [], odd_types: [] };
      files.reduce(function (p, file) {
        return p.then(function () {
          return file.arrayBuffer().then(function (buf) {
            return App.api('POST', '/api/mold_repair/import?name=' + encodeURIComponent(file.name), buf);
          }).then(function (r) {
            ['files', 'added', 'dup', 'bad'].forEach(function (k) { res[k] += r[k]; });
            ['fixed', 'unread', 'skipped_sheets', 'bad_dates', 'odd_types'].forEach(function (k) { res[k] = res[k].concat(r[k]); });
            res.no_mold = res.no_mold.concat(r.no_mold);
          });
        });
      }, Promise.resolve()).then(function () { showResult(res); load(); }).catch(App.err);
    };
    f.click();
  }
  function showResult(r) {
    var list = function (title, arr) { return arr.length ? '<details style="margin-top:6px"><summary style="cursor:pointer">' + title + ' (' + arr.length + ')</summary><div class="scroll" style="max-height:200px;font-size:12px">' + arr.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div></details>' : ''; };
    var body = App.h('<div style="line-height:1.7">파일 <b>' + r.files + '</b>개 · 새로 넣음 <b>' + App.fmt(r.added) + '</b>건 · 이미 있음/중복이라 건너뜀 <b>' + App.fmt(r.dup) + '</b>건' +
      (r.bad ? ' · 날짜를 못 읽어서 뺌 <b>' + r.bad + '</b>건' : '') +
      list('날짜 고친 것 (원래 날짜는 비고에)', r.fixed) +
      list('기준정보 금형에 없는 금형번호 (그대로 넣음)', r.no_mold.map(function (x) { return x[0] + ' — ' + x[1] + '건'; })) +
      list('날짜를 못 읽은 줄', r.bad_dates) + list('수리유형 값이 이상한 줄 (비고에 원래 값)', r.odd_types) +
      list('읽지 못한 파일', r.unread) + list('양식이 달라 건너뛴 시트', r.skipped_sheets) + '</div>');
    App.dialog({ title: '수리이력카드 가져오기 결과', body: body, buttons: [{ label: '확인', cls: 'primary', default: true }] });
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var v = e.target.closest('[data-v]');
    if (v) { setView(v.dataset.v); return; }
    var a = e.target.dataset && e.target.dataset.a;
    var r = grid.selected();
    if (a === 'add') form(null);
    else if (a === 'edit') { if (r) form(r); else App.toast('목록에서 먼저 선택하세요.', 'warn'); }
    else if (a === 'del') {
      if (!r) { App.toast('목록에서 먼저 선택하세요.', 'warn'); return; }
      App.confirm(r.date + ' ' + r.mold_no + ' 수리 이력을 삭제할까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/t/mold_repair/' + r.id).then(function () { App.toast('삭제했습니다.'); load(); }).catch(App.err);
      });
    } else if (a === 'imp') importCards();
    else if (a === 'xlsx') App.exportXlsx('금형수리이력_' + App.stamp() + '.xlsx', view === 'stats' && stats.sheet ? [stats.sheet] : [grid.sheet('금형수리이력')]);
  });
  root.addEventListener('click', function (e) {
    var m = e.target.closest('[data-m]');
    if (m) { e.preventDefault(); search.value = m.dataset.m; grid.setFilter(m.dataset.m); setView('list'); }
  });
  load();
};
