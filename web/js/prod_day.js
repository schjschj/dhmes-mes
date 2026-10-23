/* 생산실적 하루치 한 번에 입력 (엑셀처럼) — 생산실적 입력 화면의 [하루치 입력] */
/* [개선] preset = {rows, scanId} : 작업일보 스캔(OCR)으로 읽은 줄을 미리 채움 */
App.prodDay = function (root, date, onBack, preset) {
  var esc = App.esc;
  var NUM = function (k, l, w, g) { return { k: k, l: l, w: w || 52, t: 'num', g: g }; };
  var COLS = [
    { k: 'equip_no', l: '설비', w: 50, t: 'eq', fix: 1 },
    { k: 'code', l: '제번', w: 100, t: 'prod', fix: 2 },
    { k: '_name', l: '품명', w: 150, ro: true },
    { k: 'kind', l: '구분', w: 66, t: 'kind' },
    NUM('day_reels', '주간', 52, '생산 R/L'), NUM('night_reels', '야간', 52, '생산 R/L'),
    { k: '_reels', l: '합계', w: 52, ro: true, g: '생산 R/L' },
    { k: '_qty', l: '생산량 EA', w: 78, ro: true },
    { k: 'day_worker', l: '주간', w: 86, t: 'staff', g: '작업자' }, { k: 'night_worker', l: '야간', w: 86, t: 'staff', g: '작업자' },
    { k: 'start_time', l: '시작', w: 56, t: 'time', g: '작업시간' }, { k: 'end_time', l: '종료', w: 56, t: 'time', g: '작업시간' },
    NUM('dt_setup', '금형셋업', 56, '비가동 (분)'), NUM('dt_first', '초품검사', 56, '비가동 (분)'), NUM('dt_mold', '금형수리', 56, '비가동 (분)'),
    NUM('dt_equip', '설비수리', 56, '비가동 (분)'), NUM('dt_etc', '기타', 50, '비가동 (분)'),
    { k: 'dt_note', l: '비가동 비고', w: 140, t: 'text', g: '비가동 (분)' },
    NUM('loss_mold_chg', '금형교체', 56, 'LOSS (중량)'), NUM('loss_mold_fix', '금형수리', 56, 'LOSS (중량)'), NUM('loss_coil', '원재료교체', 62, 'LOSS (중량)'),
    NUM('loss_adjust', '조건조정', 56, 'LOSS (중량)'), NUM('loss_vision', '비전셋업', 56, 'LOSS (중량)'), NUM('loss_init', '초기허용', 56, 'LOSS (중량)'),
    { k: 'note', l: '비고', w: 140, t: 'text' }
  ];
  var EDIT = COLS.filter(function (c) { return !c.ro; });
  var KEYS = EDIT.map(function (c) { return c.k; });
  var rows = [], deleted = [], info = {}, prods = {}, staff = [], eqs = [];
  var lv = App.curLevel || 1;

  if (!document.getElementById('pdCss')) {
    var st = document.createElement('style'); st.id = 'pdCss';
    st.textContent =
      '.pd-wrap{flex:1;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}' +
      '.pd{border-collapse:separate;border-spacing:0;font-size:12.5px}' +
      '.pd th{position:sticky;top:0;background:var(--line-2);z-index:2;font-weight:600;padding:3px 4px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);white-space:nowrap}' +
      '.pd thead tr:nth-child(2) th{top:22px}' +
      '.pd td{border-bottom:1px solid var(--line-2);border-right:1px solid var(--line-2);padding:0;height:27px;background:var(--panel)}' +
      '.pd td input,.pd td select{width:100%;height:26px;border:0;background:transparent;padding:0 5px;font:inherit;outline:none}' +
      '.pd td select{padding:0 2px}.pd td input.n{text-align:right}' +
      '.pd td:focus-within{box-shadow:inset 0 0 0 2px #2f6fd0}' +
      '.pd td.ro{color:var(--muted);padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}.pd td.ro.q{color:inherit;font-weight:600;text-align:right}' +
      '.pd td.bad{background:#fde8e8}.pd tr.err td{background:#fff3f3}.pd tr.err td.no{color:var(--bad);font-weight:700}' +
      '.pd td.no{text-align:center;color:var(--muted);padding:0 4px;white-space:nowrap}' +
      '.pd .fx{position:sticky;z-index:1}.pd th.fx{z-index:3}' +
      '.pd tr.dirty td.no{color:#2f6fd0;font-weight:700}' +
      '.pd td.no button{border:0;background:none;cursor:pointer;color:var(--muted);padding:0 2px;font-size:12px}.pd td.no button:hover{color:var(--bad)}';
    document.head.appendChild(st);
  }
  root.innerHTML = '<div class="page-full">' +
    '<div class="toolbar">' +
    '<button class="btn" data-a="back">‹ 목록으로</button>' +
    '<button class="btn small" data-a="prev">◀</button><input type="date" class="input" data-date value="' + date + '" style="width:150px"><button class="btn small" data-a="next">▶</button>' +
    '<span data-hol class="muted"></span><span class="grow"></span>' +
    (lv >= 2 ? '<button class="btn" data-a="wo" title="[개선] 그날 작업지시서의 설비 · 제번을 줄로 채웁니다 — 수량만 넣으면 됩니다">작업지시서 불러오기</button>' +
      '<button class="btn" data-a="add">+ 줄 추가</button><button class="btn" data-a="add5">+ 5줄</button><button class="btn primary" data-a="save">한 번에 저장</button>' : '') +
    '</div>' +
    '<div class="muted" style="font-size:12px;margin:-4px 0 6px;line-height:1.6">Enter = 아래 칸 · Tab = 옆 칸 · ↑↓ 줄 이동 · 엑셀에서 여러 칸 복사해서 붙여넣기 가능 · 숫자 칸에 <b>100+100+120</b> 처럼 쓰면 계산 · 시간은 0830 처럼 써도 됨 · ' +
    '구분은 휴일이면 자동 (종료가 17시를 넘는 줄이 하나라도 있으면 그날 모두 특근2), 직접 바꾸면 그대로 · 줄 번호의 ⧉ 복사 · ✕ 삭제</div>' +
    '<div class="pd-wrap"><table class="pd"><thead></thead><tbody></tbody></table></div>' +
    '<div class="sumbar" data-sum style="margin-top:6px"></div></div>';
  var $ = function (s) { return root.querySelector(s); };
  var tbody = $('tbody');

  // ---------------------------------------------------------- 머리
  (function head() {
    var left = 64, fxl = {};
    COLS.forEach(function (c) { if (c.fix) { fxl[c.k] = left; left += c.w; } });
    var g1 = ['<tr><th rowspan="2" class="fx" style="left:0;min-width:64px;max-width:64px">#</th>'], g2 = ['<tr>'], i = 0;
    while (i < COLS.length) {
      var c = COLS[i];
      var sty = 'min-width:' + c.w + 'px;max-width:' + c.w + 'px' + (c.fix ? ';left:' + fxl[c.k] + 'px' : '');
      if (!c.g) { g1.push('<th rowspan="2"' + (c.fix ? ' class="fx"' : '') + ' style="' + sty + '">' + esc(c.l) + '</th>'); i++; continue; }
      var j = i;
      while (j < COLS.length && COLS[j].g === c.g) { g2.push('<th style="min-width:' + COLS[j].w + 'px;max-width:' + COLS[j].w + 'px">' + esc(COLS[j].l) + '</th>'); j++; }
      g1.push('<th colspan="' + (j - i) + '">' + esc(c.g) + '</th>');
      i = j;
    }
    $('thead').innerHTML = g1.join('') + '</tr>' + g2.join('') + '</tr>';
    COLS.forEach(function (c) { c.left = fxl[c.k]; });
  })();

  // ---------------------------------------------------------- 계산
  function calc(s) {
    s = String(s === null || s === undefined ? '' : s).replace(/,/g, '').trim();
    if (s === '') return '';
    if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
    if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
    try { var v = Function('"use strict";return (' + s + ')')(); return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : NaN; } catch (e) { return NaN; }
  }
  function normTime(s) {
    s = String(s || '').trim();
    if (!s) return '';
    var m = s.match(/^(\d{1,2})[:.]?(\d{2})$/);
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59 || (h === 24 && mi)) return null;
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }
  function over17(r) {
    var s = normTime(r.start_time), e = normTime(r.end_time);
    if (!e) return false;
    return e > '17:00' || (s && e < s);
  }
  function autoKind() {
    var used = rows.filter(hasContent);
    var k = !info.holiday ? '' : (used.some(over17) ? '특근2' : '특근');
    rows.forEach(function (r, i) {
      if (r._kindManual || r.kind === k || !hasContent(r)) return;
      r.kind = k; r._dirty = r._dirty || hasContent(r);
      var el = tbody.querySelector('[data-r="' + i + '"][data-c="kind"]');
      if (el) el.value = k;
    });
  }
  function hasContent(r) { return KEYS.some(function (k) { return k !== 'kind' && r[k] !== '' && r[k] !== null && r[k] !== undefined; }); }
  function derived(r) {
    var p = prods[(r.code || '').toUpperCase()];
    var dr = calc(r.day_reels), nr = calc(r.night_reels);
    var t = (isNaN(dr) || dr === '' ? 0 : dr) + (isNaN(nr) || nr === '' ? 0 : nr);
    return { name: p ? p.name : (r.code ? '(없는 제번)' : ''), reels: t || '', qty: p && t ? Math.round(t * (+p.reel_qty || 0)) : '' };
  }

  // ---------------------------------------------------------- 그리기
  function cellHtml(r, i, c) {
    var wd = 'min-width:' + c.w + 'px;max-width:' + c.w + 'px';
    var fx = c.fix ? ' class="fx" style="left:' + c.left + 'px;' + wd + '"' : ' style="' + wd + '"';
    var v = r[c.k] === null || r[c.k] === undefined ? '' : r[c.k];
    var at = 'data-r="' + i + '" data-c="' + c.k + '"' + (lv < 2 ? ' disabled' : '');
    if (c.ro) {
      var d = derived(r);
      var t = c.k === '_name' ? d.name : c.k === '_reels' ? (d.reels === '' ? '' : App.fmt(d.reels, 2)) : (d.qty === '' ? '' : App.fmt(d.qty));
      return '<td class="ro' + (c.k === '_qty' ? ' q' : '') + '" data-ro="' + c.k + '" title="' + esc(t) + '" style="' + wd + '">' + esc(t) + '</td>';
    }
    var inp;
    if (c.t === 'kind') inp = '<select ' + at + '>' + ['', '특근', '특근2'].map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>';
    else if (c.t === 'staff') inp = App.staffSelect('생산팀', v, at);
    else if (c.t === 'eq') inp = '<input ' + at + ' list="pdEq" value="' + esc(v) + '">';
    else if (c.t === 'prod') inp = '<input ' + at + ' list="pdProd" value="' + esc(v) + '">';
    else inp = '<input ' + at + (c.t === 'num' ? ' class="n" inputmode="decimal"' : '') + ' value="' + esc(v) + '"' + (c.t === 'time' ? ' maxlength="5"' : '') + '>';
    return '<td' + fx + '>' + inp + '</td>';
  }
  function rowHtml(r, i) {
    return '<tr data-row="' + i + '" class="' + (r._dirty ? 'dirty' : '') + (r._err ? ' err' : '') + '"' + (r._err ? ' title="' + esc(r._err) + '"' : '') + '>' +
      '<td class="no fx" style="left:0;min-width:64px;max-width:64px">' + (i + 1) + (lv >= 2 ? '<button data-dup="' + i + '" title="이 줄 복사">⧉</button><button data-del="' + i + '" title="이 줄 삭제">✕</button>' : '') + '</td>' +
      COLS.map(function (c) { return cellHtml(r, i, c); }).join('') + '</tr>';
  }
  function render() {
    tbody.innerHTML = rows.map(rowHtml).join('');
    summary();
  }
  function refreshRow(i) {
    var tr = tbody.querySelector('tr[data-row="' + i + '"]');
    if (!tr) return;
    var r = rows[i], d = derived(r);
    tr.classList.toggle('dirty', !!r._dirty);
    App.$$('[data-ro]', tr).forEach(function (td) {
      var k = td.dataset.ro;
      var t = k === '_name' ? d.name : k === '_reels' ? (d.reels === '' ? '' : App.fmt(d.reels, 2)) : (d.qty === '' ? '' : App.fmt(d.qty));
      td.textContent = t; td.title = t;
    });
    summary();
  }
  function summary() {
    var used = rows.filter(hasContent), q = 0, rl = 0;
    used.forEach(function (r) { var d = derived(r); q += +d.qty || 0; rl += +d.reels || 0; });
    var dirty = rows.filter(function (r) { return r._dirty && hasContent(r); }).length + deleted.length;
    $('[data-sum]').innerHTML = '<span><span class="muted">줄</span> <b>' + used.length + '</b></span><span><span class="muted">합계 R/L</span> <b>' + App.fmt(rl, 1) + '</b></span>' +
      '<span><span class="muted">생산량</span> <b>' + App.fmt(q) + ' EA</b></span>' + (dirty ? '<span style="color:#2f6fd0"><b>저장 안 한 줄 ' + dirty + '개</b></span>' : '<span class="muted">모두 저장됨</span>');
  }
  function blank() { var r = { _dirty: false, _kindManual: false }; KEYS.forEach(function (k) { r[k] = ''; }); return r; }

  // ---------------------------------------------------------- 불러오기 · 저장
  function load(d) {
    date = d;
    App.store.set('prod_day_last', d);
    $('[data-date]').value = d;
    return Promise.all([App.get('/api/production/day?date=' + d), App.refList('products', true), App.refList('equipment'), App.refList('workers')]).then(function (res) {
      info = res[0];
      prods = {};
      res[1].forEach(function (p) { prods[(p.code || '').toUpperCase()] = p; });
      eqs = res[2];
      if (!document.getElementById('pdEq')) {
        var dl = App.h('<div><datalist id="pdEq"></datalist><datalist id="pdProd"></datalist></div>');
        document.body.appendChild(dl);
      }
      document.getElementById('pdEq').innerHTML = eqs.map(function (e) { return '<option value="' + esc(e.no) + '">' + esc((e.maker || '') + ' ' + (e.ton || '')) + '</option>'; }).join('');
      document.getElementById('pdProd').innerHTML = res[1].map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name || '') + '</option>'; }).join('');
      $('[data-hol]').innerHTML = info.holiday ? '<span class="tag warn">' + esc(info.holiday_name || '휴일') + '</span> 휴일 근무 → 구분 자동 (특근 / 특근2)' : '평일';
      var auto = !info.holiday ? '' : (info.rows.some(over17) ? '특근2' : '특근');
      rows = info.rows.map(function (x) {
        var r = { id: x.id, _dirty: false, _kindManual: (x.kind || '') !== auto };
        KEYS.forEach(function (k) { r[k] = x[k] === null || x[k] === undefined ? '' : x[k]; });
        return r;
      });
      deleted = [];
      if (preset && preset.rows && preset.date === d) {
        addRows(preset.rows, true);
        App.toast('스캔에서 읽은 ' + preset.rows.length + '줄을 채웠습니다. 확인 · 고친 뒤 [한 번에 저장] 하세요.', '', 6000);
      }
      var need = Math.max(5, 30 - rows.length);
      if (rows.length) need = 5;
      for (var i = 0; i < need; i++) rows.push(blank());
      render();
    }).catch(App.err);
  }
  // [개선] 바깥에서 받은 줄(작업지시서 · 스캔)을 빈 줄 자리에 채움. warn 이면 확인할 줄로 표시
  function addRows(list, warn) {
    var used = rows.filter(hasContent);
    var have = {};
    used.forEach(function (r) { have[r.equip_no + '|' + String(r.code).toUpperCase()] = 1; });
    list.forEach(function (x) {
      var r = blank();
      KEYS.forEach(function (k) { if (x[k] !== undefined && x[k] !== null) r[k] = x[k]; });
      r._dirty = true;
      var msg = (warn && x._warn && x._warn.length) ? ['확인: ' + x._warn.join(', ')] : [];
      if (have[r.equip_no + '|' + String(r.code).toUpperCase()]) msg.push('같은 설비 · 제번 줄이 이미 있습니다 — 중복이면 ✕ 로 지우세요');
      if (msg.length) r._err = msg.join(' / ');
      used.push(r);
    });
    rows = used;
    autoKind();
  }
  function fromWo() {
    App.get('/api/production/from_wo?date=' + date).then(function (w) {
      var have = {};
      rows.filter(hasContent).forEach(function (r) { have[r.equip_no + '|' + String(r.code).toUpperCase()] = 1; });
      var add = w.rows.filter(function (x) { return !have[x.equip_no + '|' + x.code.toUpperCase()]; });
      if (!add.length) { App.toast('작업지시서의 설비 · 제번이 이미 모두 있습니다.'); return; }
      addRows(add.map(function (x) { return { equip_no: x.equip_no, code: x.code, day_worker: x.day_worker, night_worker: x.night_worker }; }));
      for (var i = 0; i < 3; i++) rows.push(blank());
      render();
      App.toast('작업지시서 (' + (w.status || '작성중') + ')에서 ' + add.length + '줄을 채웠습니다. R/L · 시간만 넣으세요.');
    }).catch(App.err);
  }
  function dirty() { return rows.some(function (r) { return r._dirty && hasContent(r); }) || deleted.length > 0; }
  App.leaveGuard = function () { return dirty(); };
  function save() {
    var send = [], map = [];
    var bad = false;
    rows.forEach(function (r, i) {
      r._err = '';
      if (!hasContent(r)) return;
      if (!r._dirty && r.id) return;
      var o = r.id ? { id: r.id } : {};
      EDIT.forEach(function (c) {
        var v = r[c.k];
        if (c.t === 'num') { var n = calc(v); if (v !== '' && isNaN(n)) { r._err = c.l + ' 숫자를 확인하세요: ' + v; bad = true; } v = n === '' || isNaN(n) ? '' : n; }
        if (c.t === 'time') { var t = normTime(v); if (t === null) { r._err = c.l + ' 시간을 확인하세요: ' + v; bad = true; } v = t || ''; }
        o[c.k] = v;
      });
      send.push(o); map.push(i);
    });
    if (bad) { render(); App.toast('빨간 줄을 확인하세요.', 'bad'); return; }
    if (!send.length && !deleted.length) { App.toast('저장할 내용이 없습니다.'); return; }
    App.api('POST', '/api/production/day', { date: date, rows: send, deleted: deleted }).then(function (r) {
      if (!r.ok) {
        r.errors.forEach(function (e) { rows[map[e.i]]._err = e.msg; });
        render();
        App.dialog({ title: '저장하지 않았습니다', body: App.h('<div style="line-height:1.7">틀린 줄이 있어서 아무것도 저장하지 않았습니다. 고친 뒤 다시 [한 번에 저장]을 눌러 주세요.<br>' +
          r.errors.map(function (e) { return '<div><b>' + (map[e.i] + 1) + '번 줄</b>: ' + esc(e.msg).replace(/\n/g, ' ') + '</div>'; }).join('') + '</div>'),
          buttons: [{ label: '확인', cls: 'primary', default: true }] });
        return;
      }
      App.toast('저장했습니다 — 새로 ' + r.new + ' · 수정 ' + r.upd + (r.deleted ? ' · 삭제 ' + r.deleted : '') + '건');
      if (preset && preset.scanId) { App.api('POST', '/api/scan/' + preset.scanId + '/applied').catch(function () {}); }
      preset = null;
      App.refreshBadges();
      load(date);
    }).catch(App.err);
  }

  // ---------------------------------------------------------- 입력
  function setVal(i, k, v, el) {
    var r = rows[i];
    if (!r) return;
    r[k] = v;
    r._dirty = true;
    r._err = '';
    if (k === 'kind') r._kindManual = true;
    if (k === 'start_time' || k === 'end_time' || (k !== 'kind' && !r._kindManual && !r.kind)) autoKind();
    if (el) el.closest('td').classList.remove('bad');
    refreshRow(i);
  }
  tbody.addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset.c) return;
    setVal(+el.dataset.r, el.dataset.c, el.value);
  });
  tbody.addEventListener('change', function (e) {
    var el = e.target; if (!el.dataset.c) return;
    var i = +el.dataset.r, k = el.dataset.c, c = COLS.filter(function (x) { return x.k === k; })[0];
    if (c.t === 'num') {
      var n = calc(el.value);
      if (el.value !== '' && isNaN(n)) el.closest('td').classList.add('bad');
      else { el.value = n; setVal(i, k, n, el); }
    } else if (c.t === 'time') {
      var t = normTime(el.value);
      if (t === null) el.closest('td').classList.add('bad');
      else { el.value = t; setVal(i, k, t, el); }
    } else if (c.t === 'prod' || c.t === 'eq') {
      var u = el.value.trim();
      if (c.t === 'prod' && prods[u.toUpperCase()]) u = prods[u.toUpperCase()].code;
      el.value = u; setVal(i, k, u, el);
      if (c.t === 'prod') el.closest('td').classList.toggle('bad', !!u && !prods[u.toUpperCase()]);
      if (c.t === 'eq') el.closest('td').classList.toggle('bad', !!u && !eqs.some(function (x) { return String(x.no) === u; }));
    } else setVal(i, k, el.value, el);
  });
  function focusCell(i, k) {
    if (i >= rows.length) { rows.push(blank()); render(); }
    var el = tbody.querySelector('[data-r="' + i + '"][data-c="' + k + '"]');
    if (el) { el.focus(); if (el.select) el.select(); }
  }
  tbody.addEventListener('keydown', function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.c) return;
    var i = +el.dataset.r, k = el.dataset.c, ci = KEYS.indexOf(k);
    var isSel = el.tagName === 'SELECT';
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); el.dispatchEvent(new Event('change', { bubbles: true })); focusCell(i + (e.shiftKey ? -1 : 1), k); }
    else if (e.key === 'ArrowDown' && !isSel) { e.preventDefault(); focusCell(i + 1, k); }
    else if (e.key === 'ArrowUp' && !isSel) { e.preventDefault(); if (i > 0) focusCell(i - 1, k); }
    else if (e.key === 'ArrowRight' && (isSel || el.selectionStart === el.value.length) && ci < KEYS.length - 1) { e.preventDefault(); focusCell(i, KEYS[ci + 1]); }
    else if (e.key === 'ArrowLeft' && (isSel || el.selectionEnd === 0) && ci > 0) { e.preventDefault(); focusCell(i, KEYS[ci - 1]); }
  });
  tbody.addEventListener('paste', function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.c) return;
    var txt = (e.clipboardData || window.clipboardData).getData('text') || '';
    if (txt.indexOf('\t') < 0 && txt.replace(/\r?\n$/, '').indexOf('\n') < 0) return;      // 한 칸이면 그냥 붙여넣기
    e.preventDefault();
    var lines = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (l) { return l.split('\t'); });
    var i0 = +el.dataset.r, c0 = COLS.map(function (c) { return c.k; }).indexOf(el.dataset.c);
    while (rows.length < i0 + lines.length) rows.push(blank());
    lines.forEach(function (cells, di) {
      cells.forEach(function (v, dj) {
        var c = COLS[c0 + dj]; if (!c || c.ro) return;          // 화면 칸 순서대로 (품명 · 합계 · 생산량 칸은 건너뜀)
        var k = c.k;
        v = v.trim();
        if (k === 'kind' && !v) return;
        if (c.t === 'num') { var n = calc(v); v = isNaN(n) ? v : n; }
        if (c.t === 'time') { var t = normTime(v); v = t === null ? v : t; }
        if (c.t === 'prod' && prods[v.toUpperCase()]) v = prods[v.toUpperCase()].code;
        var r = rows[i0 + di];
        r[k] = v; r._dirty = true;
        if (k === 'kind') r._kindManual = true;
      });
    });
    autoKind();
    render();
    App.toast(lines.length + '줄 붙여넣었습니다.');
  });
  tbody.addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]'), u = e.target.closest('[data-dup]');
    if (d) {
      var i = +d.dataset.del, r = rows[i];
      if (r.id) deleted.push(r.id);
      rows.splice(i, 1);
      if (!rows.length) rows.push(blank());
      autoKind(); render();
    } else if (u) {
      var j = +u.dataset.dup, src = rows[j], cp = blank();
      KEYS.forEach(function (k) { cp[k] = src[k]; });
      cp._dirty = true; cp._kindManual = src._kindManual;
      rows.splice(j + 1, 0, cp);
      render();
      focusCell(j + 1, 'equip_no');
    }
  });
  function go(d) {
    if (dirty() && !window.confirm('저장하지 않은 내용이 있습니다. 다른 날짜로 넘어갈까요?')) { $('[data-date]').value = date; return; }
    load(d);
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.closest('[data-a]'); if (!a) return;
    var act = a.dataset.a;
    if (act === 'back') { if (!dirty() || window.confirm('저장하지 않은 내용이 있습니다. 목록으로 갈까요?')) { App.leaveGuard = null; onBack(); } }
    else if (act === 'prev' || act === 'next') { var x = new Date(date + 'T00:00:00'); x.setDate(x.getDate() + (act === 'prev' ? -1 : 1)); go(x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2)); }
    else if (act === 'add' || act === 'add5') { for (var n = 0; n < (act === 'add' ? 1 : 5); n++) rows.push(blank()); render(); }
    else if (act === 'save') save();
    else if (act === 'wo') fromWo();
  });
  $('[data-date]').addEventListener('change', function () { if (this.value) go(this.value); });
  load(date);
};
