/* 근태관리 — 기존 '대흥공업 근태관리' 프로그램을 통합관리로 옮김.
   월별 근태 / 연차 현황 / 연간 집계 / 직원 관리 / 근태 설정  (args.tab)
   계산(Calc)은 기존 프로그램과 똑같음. 저장은 칸 단위로 서버에 바로 (여러 PC 동시 입력 가능) */
(function () {
  'use strict';
  if (!document.getElementById('att-css')) {
    var l = document.createElement('link');
    l.id = 'att-css'; l.rel = 'stylesheet'; l.href = '/css/att.css?v=' + encodeURIComponent((App.meta && App.meta.version) || '');
    document.head.appendChild(l);
  }

  // ================================================================== 계산 (기존 calc.js 그대로)
  var Calc = (function () {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var ymKey = function (y, m) { return y + '-' + pad(m); };
    var daysIn = function (y, m) { return new Date(y, m, 0).getDate(); };
    var WD = ['일', '월', '화', '수', '목', '금', '토'];
    function parseDate(s) {
      if (!s) return null;
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    function holidayName(cfg, y, m, d) {
      var list = (cfg.holidays && cfg.holidays[String(y)]) || [];
      var k = pad(m) + '-' + pad(d);
      var f = list.find(function (h) { return h[0] === k; });
      return f ? (f[1] || '휴무') : null;
    }
    function dayInfo(cfg, y, m, d) {
      var dow = new Date(y, m - 1, d).getDay();
      var hname = holidayName(cfg, y, m, d);
      return { d: d, dow: dow, wd: WD[dow], weekend: dow === 0 || dow === 6, holidayName: hname, off: dow === 0 || dow === 6 || !!hname };
    }
    function monthDays(cfg, y, m) {
      var n = daysIn(y, m), out = [];
      for (var d = 1; d <= n; d++) out.push(dayInfo(cfg, y, m, d));
      return out;
    }
    function employed(emp, y, m, d) {
      var t = new Date(y, m - 1, d);
      var h = parseDate(emp.hireDate), q = parseDate(emp.quitDate);
      if (h && t < h) return false;
      if (q && t > q) return false;
      return true;
    }
    function activeInMonth(emp, y, m) {
      var s = new Date(y, m - 1, 1), e = new Date(y, m, 0);
      var h = parseDate(emp.hireDate), q = parseDate(emp.quitDate);
      if (h && h > e) return false;
      if (q && q < s) return false;
      return true;
    }
    function codeMap(cfg) { var o = {}; cfg.codes.forEach(function (c) { o[c.name] = c; }); return o; }
    // 한 사람의 한 달 집계
    function summarize(cfg, y, m, emp, recs) {
      var cm = codeMap(cfg);
      var days = monthDays(cfg, y, m);
      var s = { work: 0, counts: {}, early: 0, leaveUsed: 0, deduct: 0, workdaysBase: 0 };
      cfg.codes.forEach(function (c) { s.counts[c.name] = 0; });
      days.forEach(function (di) {
        var r = (recs && recs[di.d]) || {};
        var c = r.code ? cm[r.code] : null;
        if (r.code) s.counts[r.code] = (s.counts[r.code] || 0) + 1;
        if (r.early) s.early++;
        if (c) s.leaveUsed += +c.leave || 0;
        if (r.deduct) { s.leaveUsed += +r.deduct; s.deduct += +r.deduct; }
        if (!employed(emp, y, m, di.d)) return;
        if (!di.off) { s.workdaysBase++; s.work += c ? (+c.day) : 1; }
        else if (c && c.holiday) s.work += 1;
      });
      s.special = (s.counts['특근'] || 0) + (s.counts['야특'] || 0);
      s.outLate = (s.counts['외출'] || 0) + (s.counts['지각'] || 0);
      s.overtime2 = (+cfg.overtimeBase || 0) - s.early - (s.counts['잔업無'] || 0);
      return s;
    }
    // 규칙에 따른 연차 발생 (asOfMonth 말 기준)
    function ruleGrant(cfg, emp, y, asOfMonth) {
      var h = parseDate(emp.hireDate);
      if (!h) return null;
      var realHy = h.getFullYear();
      var startY = cfg.leaveStartYear === undefined ? 2015 : (+cfg.leaveStartYear || 0);
      var hy = startY && realHy < startY ? startY - 1 : realHy;
      if (hy > y) return 0;
      if (hy === y && hy === realHy) {
        var end = new Date(y, asOfMonth, 0), n = 0;
        for (var k = 1; k <= 11; k++) {
          var t = new Date(h.getFullYear(), h.getMonth() + k, h.getDate());
          if (t.getFullYear() !== y || t > end) break;
          n++;
        }
        return n;
      }
      return Math.min(+cfg.leaveMax || 25, 15 + Math.floor((y - hy - 1) / 2));
    }
    function grantInfo(cfg, leave, emp, y, asOfMonth) {
      var L = (leave[emp.id] && leave[emp.id][String(y)]) || {};
      var rule = ruleGrant(cfg, emp, y, asOfMonth);
      var fixed = L.grant !== undefined && L.grant !== null && L.grant !== '';
      var base = fixed ? +L.grant : rule;
      var adjust = +L.adjust || 0;
      return { rule: rule, fixed: fixed, base: base, adjust: adjust, total: base === null ? null : base + adjust, note: L.note || '' };
    }
    function serviceText(hireDate, y, m) {
      var h = parseDate(hireDate); if (!h) return '';
      var ref = new Date(y, m, 1); // 다음달 1일 기준(기존 엑셀과 동일)
      var months = (ref.getFullYear() - h.getFullYear()) * 12 + (ref.getMonth() - h.getMonth());
      if (ref.getDate() < h.getDate()) months--;
      if (months < 0) return '';
      return Math.floor(months / 12) + '년 ' + (months % 12) + '개월';
    }
    var fmtNum = function (v) { return v === null || v === undefined ? '' : (Math.round(v * 10) / 10).toString(); };
    return { pad: pad, ymKey: ymKey, daysIn: daysIn, WD: WD, parseDate: parseDate, monthDays: monthDays, dayInfo: dayInfo, employed: employed,
      activeInMonth: activeInMonth, codeMap: codeMap, summarize: summarize, ruleGrant: ruleGrant, grantInfo: grantInfo, serviceText: serviceText, fmtNum: fmtNum };
  })();
  App.AttCalc = Calc;

  var SUMCOLS = [
    { key: 'work', label: '근무<br>일수', k: true },
    { code: '특근' }, { code: '야특' }, { code: '잔업無', label: '잔업<br>無' }, { code: '결근' }, { code: '외출' },
    { code: '경휴' }, { code: '병결' }, { code: '월차' }, { code: '반차' }, { code: '지각' }, { key: 'early', label: '조퇴' },
    { key: 'special', label: '특근<br>일수', k: true }, { key: 'outLate', label: '외출<br>지각', k: true },
    { key: 'overtime2', label: '잔업<br>2회', k: true }, { key: 'usedThis', label: '연차<br>사용' }, { key: 'remain', label: '연차<br>잔여', k: true }
  ];
  var METRICS = [
    ['work', '근무일수'], ['special', '특근일수(특근+야특)'], ['code:특근', '특근'], ['code:야특', '야특'], ['code:잔업無', '잔업無'],
    ['code:결근', '결근'], ['code:월차', '월차'], ['code:반차', '반차'], ['code:외출', '외출'], ['code:지각', '지각'], ['early', '조퇴'],
    ['code:경휴', '경휴'], ['code:병결', '병결'], ['code:병가', '병가'], ['code:무급', '무급'], ['leaveUsed', '연차 사용']
  ];
  var QUICK_MEMO = ['17:30퇴근', '24:00퇴근', '15:00퇴근', '17:00퇴근', '12:00퇴근', '13:00퇴근', '13:00출근', '무단결근'];
  var PUBLIC_RE = /설날|추석|대체|신정|1월1일|삼일절|어린이날|부처님|석가|현충일|광복절|개천절|한글날|성탄|기독탄신|선거|제헌절/;

  App.pages.att = function (root, args) {
    var C = Calc;
    var $ = function (s, el) { return (el || document).querySelector(s); };
    var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
    var esc = App.esc;
    var today = new Date();
    var canEdit = App.curLevel >= 2, canAdmin = App.curLevel >= 3;
    var S = {
      cfg: null, emps: [], leave: {}, months: {}, loaded: {}, rev: 0,
      y: App.store.get('att_y', today.getFullYear()), m: App.store.get('att_m', today.getMonth() + 1), tab: args.tab || 'month', readOnly: !canEdit,
      sel: null, anchor: null, undo: [], redo: [], clip: null,
      queue: [], saveTimer: null, saving: false,
      yearOf: { leave: 0, year: 0, hol: 0 }, empFilter: 'active', empNat: 'all', yearMetric: 'work'
    };
    var G = null;
    root.innerHTML = '<div class="att page-full"><div class="att-view" data-view><div class="muted" style="padding:20px">불러오는 중…</div></div>' +
      '<div class="att-ctx" hidden></div><div class="att-tip" hidden></div><div class="att-save" data-save></div></div>';
    var view = root.querySelector('[data-view]'), ctxEl = root.querySelector('.att-ctx'), tipEl = root.querySelector('.att-tip');
    var saveEl = root.querySelector('[data-save]');

    function toast(msg, err) { App.toast(msg, err ? 'bad' : '', err ? 6000 : 2500); }
    // ---------- 대화창 (App.dialog 위에)
    var dlg = null;
    function modal(html, onMount) {
      if (dlg) dlg.close();
      var title = '';
      html = html.replace(/^\s*<h2>([\s\S]*?)<\/h2>/, function (_, t) { var x = document.createElement('div'); x.innerHTML = t; title = x.textContent; return ''; });
      var body = App.h('<div class="att-dlg">' + html + '</div>');
      var me = App.dialog({ title: title, body: body, buttons: [], onClose: function () { if (dlg === me) dlg = null; setTimeout(focusGrid, 0); } });
      dlg = me;
      me.el.querySelector('.dlg-f').style.display = 'none';
      if (onMount) onMount(body);
      var first = body.querySelector('[autofocus]');
      if (first) setTimeout(function () { first.focus(); }, 40);
      return me;
    }
    function closeModal() { if (dlg) dlg.close(); }
    function modalOpen() { return !!document.querySelector('.dlg-back'); }
    function confirmBox(title, msg, okText, danger) {
      return App.confirm(title + '\n\n' + msg, okText || '확인', danger);
    }
    function setSaveState(t, cls) { saveEl.textContent = t || ''; saveEl.className = 'att-save ' + (cls || ''); }

    // ================================================================ 데이터
    function empById(id) { return S.emps.find(function (e) { return e.id === id; }); }
    function sortedEmps() { return S.emps.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
    function loadYear(y, force) {
      if (S.loaded[y] && !force) return Promise.resolve();
      return App.get('/api/att/data?year=' + y).then(function (d) {
        S.cfg = d.cfg; S.emps = d.emps; S.leave = d.leave; S.rev = d.rev;
        for (var m = 1; m <= 12; m++) {
          var k = C.ymKey(y, m), mo = d.months[k];
          S.months[k] = mo ? { year: y, month: m, roster: mo.roster, records: mo.records } : { year: y, month: m, roster: null, records: {}, _virtual: true };
        }
        S.loaded[y] = true;
      });
    }
    function ensureYear(y) { return loadYear(y); }
    function monthObj(y, m) { return S.months[C.ymKey(y, m)]; }
    function rosterFor(y, m) {
      var mo = monthObj(y, m), ids = {};
      if (mo && mo.roster) mo.roster.forEach(function (id) { ids[id] = 1; });
      else S.emps.filter(function (e) { return C.activeInMonth(e, y, m); }).forEach(function (e) { ids[e.id] = 1; });
      if (mo) Object.keys(mo.records).forEach(function (id) { if (Object.keys(mo.records[id]).length) ids[id] = 1; });
      return sortedEmps().filter(function (e) { return ids[e.id]; });
    }

    // ---------- 저장 (칸 단위, 0.3초 모아서)
    function queueSave(y, m, items) {
      var mo = monthObj(y, m), roster = null;
      if (!mo.roster) { mo.roster = rosterFor(y, m).map(function (e) { return e.id; }); roster = mo.roster; }
      delete mo._virtual;
      S.queue.push({ ym: C.ymKey(y, m), roster: roster, items: items });
      setSaveState('저장 중…', 'warn');
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(flushSave, 300);
    }
    function flushSave() {
      if (S.saving || !S.queue.length) return;
      // 같은 달끼리 묶음
      var first = S.queue[0], batch = { ym: first.ym, roster: null, items: [] }, rest = [];
      S.queue.forEach(function (q) {
        if (q.ym === first.ym) { if (q.roster && !batch.roster) batch.roster = q.roster; batch.items = batch.items.concat(q.items); }
        else rest.push(q);
      });
      S.queue = rest;
      S.saving = true;
      var myRev = S.rev;
      App.api('POST', '/api/att/cells', batch).then(function (r) {
        S.saving = false;
        if (r.rev === myRev + 1) S.rev = r.rev;
        setSaveState('저장됨 ' + new Date().toTimeString().slice(0, 5), 'ok');
        if (S.queue.length) flushSave();
      }, function (e) {
        S.saving = false;
        S.queue.unshift(batch);
        setSaveState('⚠ 저장 실패 — 10초 뒤 다시 저장', 'bad');
        App.err(e);
        clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushSave, 10000);
      });
    }
    function afterWrite(r) { if (r && r.rev) S.rev = r.rev; }
    // 다른 PC 에서 바꾼 내용 반영 (15초마다 확인)
    App.timers.push(setInterval(function () {
      if (S.saving || S.queue.length || modalOpen() || document.hidden) return;
      App.get('/api/att/rev').then(function (r) {
        if (r.rev === S.rev || S.saving || S.queue.length || modalOpen()) return;
        var ys = Object.keys(S.loaded);
        S.loaded = {};
        Promise.all(ys.map(function (y) { return loadYear(+y, true); })).then(function () {
          var w = $('#attGrid'), sl = w && w.scrollLeft, st = w && w.scrollTop;
          render(true);
          w = $('#attGrid'); if (w && sl !== undefined) { w.scrollLeft = sl; w.scrollTop = st; }
          setSaveState('다른 PC 에서 바꾼 내용을 반영했습니다 ' + new Date().toTimeString().slice(0, 5), 'ok');
        });
      }).catch(function () { /* 연결 표시는 core 에서 */ });
    }, 15000));

    // ================================================================ 화면 전환
    function render(keep) {
      hideCtx();
      if (!S.cfg) {
        return ensureYear(S.y).then(function () { render(keep); }).catch(function (e) { view.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
      }
      if (S.tab === 'month') return renderMonth(keep);
      if (S.tab === 'leave') return renderLeave();
      if (S.tab === 'year') return renderYear();
      if (S.tab === 'emp') return renderEmp();
      if (S.tab === 'settings') return renderSettings();
    }

    // ================================================================ 월별 근태
    function leaveStatus(emp, y, m) {
      if (emp.foreign) return { foreign: true, rule: null, fixed: false, base: null, adjust: 0, total: null, used: 0, usedThis: null, remain: null };
      var g = C.grantInfo(S.cfg, S.leave, emp, y, m);
      var used = 0, usedThis = 0;
      for (var k = 1; k <= m; k++) {
        var mo = monthObj(y, k); if (!mo) continue;
        var s = C.summarize(S.cfg, y, k, emp, mo.records[emp.id]);
        used += s.leaveUsed; if (k === m) usedThis = s.leaveUsed;
      }
      return Object.assign({}, g, { used: used, usedThis: usedThis, remain: g.total === null ? null : g.total - used });
    }
    function sumValue(col, s, lv) {
      if (col.code) return s.counts[col.code] || 0;
      if (col.key === 'usedThis') return lv.usedThis;
      if (col.key === 'remain') return lv.remain;
      return s[col.key];
    }
    function renderMonth(keep) {
      return ensureYear(S.y).then(function () {
        if (!root.isConnected) return;       // 이미 다른 화면으로 넘어감
        var y = S.y, m = S.m;
        var days = C.monthDays(S.cfg, y, m);
        var rows = rosterFor(y, m);
        G = { rows: rows, days: days, y: y, m: m };
        var offCount = days.filter(function (d) { return d.off; }).length;
        var isThisMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
        var hols = days.filter(function (d) { return d.holidayName; }).map(function (d) { return d.d + '일 ' + d.holidayName; }).join(', ');
        view.innerHTML =
          '<div class="toolbar no-print">' +
          '<div class="monthNav"><button class="btn icon" id="mPrev" title="이전 달 (PageUp)">◀</button><div class="title">' + y + '년 ' + m + '월</div>' +
          '<button class="btn icon" id="mNext" title="다음 달 (PageDown)">▶</button><button class="btn small" id="mToday" ' + (isThisMonth ? 'disabled' : '') + '>이번 달</button></div>' +
          '<div class="info">평일 <b>' + (days.length - offCount) + '</b>일 · 휴무일 <b>' + offCount + '</b>일 · 인원 <b>' + rows.length + '</b>명' +
          (hols ? ' · <span title="' + esc(hols) + '">공휴일: ' + esc(hols.length > 46 ? hols.slice(0, 46) + '…' : hols) + '</span>' : '') + '</div>' +
          '<span class="grow"></span>' +
          (S.readOnly ? '<span class="tag gray">보기 전용</span>' : '<button class="btn" id="mRoster">명단 편집</button>') +
          '<button class="btn" id="mPrint">인쇄</button><button class="btn" id="mExport">엑셀로 저장</button><button class="btn icon" id="mHelp" title="사용법">?</button></div>' +
          (S.readOnly ? '' : '<div class="palette no-print" id="palette">' +
            S.cfg.codes.map(function (c) { return '<button class="chip" data-code="' + esc(c.name) + '" style="background:' + c.bg + ';color:' + c.fg + '" title="단축키 ' + esc(c.key || '') + '"><kbd>' + esc((c.key || '').toUpperCase()) + '</kbd>' + esc(c.name) + '</button>'; }).join('') +
            '<span class="sep"></span><button class="chip plain" data-act="early"><kbd>J</kbd>조퇴</button><button class="chip plain" data-act="detail"><kbd>↵</kbd>메모·상세</button>' +
            '<button class="chip plain" data-act="mleft" title="고른 칸의 메모를 엑셀로 저장할 때 칸 왼쪽에 보이게 (다시 누르면 오른쪽)"><kbd>L</kbd>메모 ◀ 왼쪽</button>' +
            '<button class="chip plain" data-act="clear"><kbd>Del</kbd>지우기</button>' +
            '<span class="hint">칸 선택 후 단축키 · 드래그로 여러 칸 · 같은 코드를 다시 누르면 해제 · Ctrl+Z 되돌리기</span></div>') +
          '<div class="print-title">' + esc(S.cfg.companyName || '') + ' 근태현황 (' + y + '년 ' + m + '월)</div>' +
          '<div class="gridWrap" id="attGrid" tabindex="0">' + (rows.length ? gridHTML() : '<div class="empty">이 달에 표시할 직원이 없습니다.<br><br><button class="btn" id="goEmp">직원 관리로 이동</button></div>') + '</div>';
        $('#mPrev').onclick = function () { moveMonth(-1); };
        $('#mNext').onclick = function () { moveMonth(1); };
        $('#mToday').onclick = function () { S.y = today.getFullYear(); S.m = today.getMonth() + 1; saveYm(); S.sel = S.anchor = null; renderMonth(); };
        if ($('#mRoster')) $('#mRoster').onclick = rosterDialog;
        $('#mExport').onclick = exportMonth;
        $('#mPrint').onclick = printMonth;
        $('#mHelp').onclick = helpDialog;
        if ($('#goEmp')) $('#goEmp').onclick = function () { App.go('att_emp'); };
        if ($('#palette')) $('#palette').addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.code) applyCode(b.dataset.code);
          else if (b.dataset.act === 'early') toggleEarly();
          else if (b.dataset.act === 'detail') detailDialog();
          else if (b.dataset.act === 'mleft') toggleMemoLeft();
          else if (b.dataset.act === 'clear') clearSel();
          focusGrid();
        });
        bindGrid();
        if (!S.anchor && rows.length) {
          var td = isThisMonth ? today.getDate() - 1 : 0;
          S.anchor = { r: 0, c: td }; S.sel = { r0: 0, c0: td, r1: 0, c1: td };
        }
        clampSel(); paintSel();
        if (!keep) focusGrid();
        if (isThisMonth && !keep && !S._scrolled) {
          S._scrolled = true;
          var th = $('#attGrid th.day[data-c="' + Math.max(0, today.getDate() - 6) + '"]');
          if (th) $('#attGrid').scrollLeft = th.offsetLeft - 210;
        }
      }).catch(App.err);
    }
    function saveYm() { App.store.set('att_y', S.y); App.store.set('att_m', S.m); }
    function moveMonth(d) {
      var y = S.y, m = S.m + d;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      S.y = y; S.m = m; saveYm(); S.sel = S.anchor = null; S.undo = []; S.redo = [];
      renderMonth();
    }
    function cellHTML(emp, di, c) {
      var mo = monthObj(G.y, G.m);
      var r = (mo.records[emp.id] || {})[di.d] || {};
      var code = r.code ? S.cfg.codes.find(function (x) { return x.name === r.code; }) : null;
      var inEmp = C.employed(emp, G.y, G.m, di.d);
      var cls = 'cell' + (di.off ? ' off' : '') + (!inEmp ? ' out' : '') + (!r.code && r.early ? ' onlyE' : '');
      var style = code ? ' style="background:' + code.bg + ';color:' + code.fg + '"' : (r.code ? ' style="background:#eee;color:#555"' : '');
      var inner = r.code ? esc(r.code) : '';
      if (r.early) inner += '<span class="e">' + (r.code ? '조' : '조퇴') + '</span>';
      if (r.memo) inner += '<span class="mm' + (r.ml ? ' l' : '') + '"' + (r.ml ? ' title="엑셀 메모: 칸 왼쪽"' : '') + '></span>';
      if (r.deduct) inner += '<span class="dd">-' + r.deduct + '</span>';
      return '<td class="' + cls + '" data-r="' + G.rows.indexOf(emp) + '" data-c="' + c + '"' + style + '>' + inner + '</td>';
    }
    function sumCellsHTML(emp) {
      var mo = monthObj(G.y, G.m);
      var s = C.summarize(S.cfg, G.y, G.m, emp, mo.records[emp.id]);
      var lv = leaveStatus(emp, G.y, G.m);
      return SUMCOLS.map(function (col, i) {
        var v = sumValue(col, s, lv);
        var cls = ['sum', col.k ? 'k' : '', i === 0 ? 'sumStart' : '', v === 0 && !col.k ? 'z' : '', typeof v === 'number' && v < 0 ? 'neg' : ''].join(' ');
        var title = '';
        if (lv.foreign && (col.key === 'remain' || col.key === 'usedThis')) return '<td class="sum z" title="외국인 — 연차 관리 안 함"></td>';
        if (col.key === 'remain') title = lv.total === null ? '입사일이 없어 자동 계산 불가 (연차 현황에서 직접 지정)' : '발생 ' + C.fmtNum(lv.total) + (lv.fixed ? '(직접지정)' : '') + ' - 사용 ' + C.fmtNum(lv.used);
        if (col.key === 'work') title = '평일 ' + s.workdaysBase + '일 기준';
        return '<td class="' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (v === null || v === undefined ? '-' : C.fmtNum(v)) + '</td>';
      }).join('');
    }
    function rowHTML(emp, r) {
      var sv = C.serviceText(emp.hireDate, G.y, G.m);
      return '<tr data-r="' + r + '"><td class="fix c-no">' + (r + 1) + '</td><td class="fix c-dept">' + esc(emp.dept) + '</td><td class="fix c-rank">' + esc(emp.rank) + '</td>' +
        '<td class="fix c-name" data-r="' + r + '" title="' + esc(emp.name) + (emp.hireDate ? ' · 입사 ' + emp.hireDate + ' · 근속 ' + sv : '') + (emp.foreign ? ' · 외국인' : '') + '">' +
        esc(emp.name) + (emp.foreign ? '<i class="fx">외</i>' : '') + '</td>' +
        G.days.map(function (di, c) { return cellHTML(emp, di, c); }).join('') + sumCellsHTML(emp) + '</tr>';
    }
    function gridHTML() {
      var isThisMonth = today.getFullYear() === G.y && today.getMonth() + 1 === G.m;
      var h = '<table class="grid"><thead><tr>';
      h += '<th class="fix c-no" rowspan="2">No</th><th class="fix c-dept" rowspan="2">부서</th><th class="fix c-rank" rowspan="2">직급</th><th class="fix c-name" rowspan="2">성명</th>';
      G.days.forEach(function (di, c) {
        var cls = ['day', di.dow === 6 ? 'sat' : '', di.dow === 0 ? 'sun' : '', di.holidayName ? 'hol' : '', di.off ? 'off' : '', isThisMonth && di.d === today.getDate() ? 'today' : ''].join(' ');
        h += '<th class="' + cls + '" data-c="' + c + '" title="' + esc(di.holidayName || '') + '">' + di.d + '</th>';
      });
      SUMCOLS.forEach(function (col, i) { h += '<th class="sum ' + (col.k ? 'k' : '') + ' ' + (i === 0 ? 'sumStart' : '') + '" rowspan="2">' + (col.label || col.code) + '</th>'; });
      h += '</tr><tr>';
      G.days.forEach(function (di, c) {
        var cls = ['day', di.dow === 6 ? 'sat' : '', di.dow === 0 ? 'sun' : '', di.holidayName ? 'hol' : '', di.off ? 'off' : ''].join(' ');
        h += '<th class="' + cls + '" data-c="' + c + '">' + (di.holidayName ? '휴' : di.wd) + '</th>';
      });
      h += '</tr></thead><tbody>';
      G.rows.forEach(function (emp, r) { h += rowHTML(emp, r); });
      h += '</tbody><tfoot><tr><td class="fix c-no"></td><td class="fix c-dept"></td><td class="fix c-rank"></td><td class="fix c-name">출근인원</td>';
      G.days.forEach(function (di) { h += '<td>' + headcount(di) + '</td>'; });
      h += '<td colspan="' + SUMCOLS.length + '" class="sumStart" style="text-align:left;padding-left:8px">평일은 표시가 없으면 출근, 휴무일은 특근·야특이 있어야 출근으로 계산</td></tr></tfoot></table>';
      return h;
    }
    function headcount(di) {
      var mo = monthObj(G.y, G.m), cm = C.codeMap(S.cfg), n = 0;
      G.rows.forEach(function (emp) {
        if (!C.employed(emp, G.y, G.m, di.d)) return;
        var r = (mo.records[emp.id] || {})[di.d] || {};
        var c = r.code ? cm[r.code] : null;
        if (!di.off) { if (!c || +c.day > 0) n++; } else if (c && c.holiday) n++;
      });
      return n || '';
    }
    function refreshRow(r) {
      var tr = $('#attGrid tbody tr[data-r="' + r + '"]'); if (!tr) return;
      var tmp = document.createElement('tbody');
      tmp.innerHTML = rowHTML(G.rows[r], r);
      tr.replaceWith(tmp.firstChild);
    }
    function refreshFooter() {
      var tds = $$('#attGrid tfoot td');
      G.days.forEach(function (di, i) { if (tds[4 + i]) tds[4 + i].textContent = headcount(di); });
    }

    // ---------- 선택
    function clampSel() {
      if (!G || !S.sel) return;
      var R = G.rows.length - 1, Cc = G.days.length - 1;
      var cl = function (v, mx) { return Math.max(0, Math.min(mx, v)); };
      S.sel = { r0: cl(S.sel.r0, R), r1: cl(S.sel.r1, R), c0: cl(S.sel.c0, Cc), c1: cl(S.sel.c1, Cc) };
      S.anchor = { r: cl(S.anchor.r, R), c: cl(S.anchor.c, Cc) };
    }
    function selRect() {
      var s = S.sel; if (!s) return null;
      return { r0: Math.min(s.r0, s.r1), r1: Math.max(s.r0, s.r1), c0: Math.min(s.c0, s.c1), c1: Math.max(s.c0, s.c1) };
    }
    function paintSel() {
      $$('#attGrid td.cell.sel, #attGrid td.cell.anchor').forEach(function (td) { td.classList.remove('sel', 'anchor'); });
      var q = selRect(); if (!q) return;
      for (var r = q.r0; r <= q.r1; r++) for (var c = q.c0; c <= q.c1; c++) {
        var td = $('#attGrid td.cell[data-r="' + r + '"][data-c="' + c + '"]'); if (td) td.classList.add('sel');
      }
      var a = $('#attGrid td.cell[data-r="' + S.anchor.r + '"][data-c="' + S.anchor.c + '"]');
      if (a) a.classList.add('anchor');
    }
    function scrollToAnchor() {
      var a = $('#attGrid td.cell[data-r="' + S.anchor.r + '"][data-c="' + S.anchor.c + '"]'); if (!a) return;
      var w = $('#attGrid'), fixedW = 220, headH = 44;
      if (a.offsetLeft - fixedW < w.scrollLeft) w.scrollLeft = a.offsetLeft - fixedW;
      else if (a.offsetLeft + a.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = a.offsetLeft + a.offsetWidth - w.clientWidth + 10;
      if (a.offsetTop - headH < w.scrollTop) w.scrollTop = a.offsetTop - headH;
      else if (a.offsetTop + a.offsetHeight > w.scrollTop + w.clientHeight - 28) w.scrollTop = a.offsetTop + a.offsetHeight - w.clientHeight + 30;
    }
    function focusGrid() { var w = $('#attGrid'); if (w && S.tab === 'month' && !modalOpen()) w.focus({ preventScroll: true }); }
    var dragging = false;
    function onMouseUp() { dragging = false; }
    window.addEventListener('mouseup', onMouseUp);
    function bindGrid() {
      var w = $('#attGrid'); if (!w || !G.rows.length) return;
      w.addEventListener('mousedown', function (e) {
        hideCtx();
        var td = e.target.closest('td.cell'), th = e.target.closest('th.day'), nm = e.target.closest('td.c-name');
        if (td) {
          var r = +td.dataset.r, c = +td.dataset.c;
          if (e.button === 2 && inSel(r, c)) return;
          if (e.shiftKey && S.anchor) S.sel = { r0: S.anchor.r, c0: S.anchor.c, r1: r, c1: c };
          else { S.anchor = { r: r, c: c }; S.sel = { r0: r, c0: c, r1: r, c1: c }; }
          dragging = e.button === 0; paintSel(); e.preventDefault(); w.focus({ preventScroll: true });
        } else if (th) {
          var c2 = +th.dataset.c;
          S.anchor = { r: 0, c: c2 }; S.sel = { r0: 0, c0: e.shiftKey && S.sel ? S.sel.c0 : c2, r1: G.rows.length - 1, c1: c2 };
          paintSel(); e.preventDefault(); w.focus({ preventScroll: true });
        } else if (nm && nm.dataset.r !== undefined) {
          var r2 = +nm.dataset.r;
          S.anchor = { r: r2, c: 0 }; S.sel = { r0: e.shiftKey && S.sel ? S.sel.r0 : r2, c0: 0, r1: r2, c1: G.days.length - 1 };
          paintSel(); e.preventDefault(); w.focus({ preventScroll: true });
        }
      });
      w.addEventListener('mouseover', function (e) {
        var td = e.target.closest('td.cell');
        if (dragging && td) { S.sel.r1 = +td.dataset.r; S.sel.c1 = +td.dataset.c; paintSel(); }
        showTip(td);
      });
      w.addEventListener('mouseleave', function () { showTip(null); });
      w.addEventListener('dblclick', function (e) { if (e.target.closest('td.cell')) detailDialog(); });
      w.addEventListener('contextmenu', function (e) {
        var td = e.target.closest('td.cell'); if (!td || S.readOnly) return;
        e.preventDefault(); showCtx(e.clientX, e.clientY);
      });
      w.addEventListener('keydown', gridKey);
    }
    function inSel(r, c) { var q = selRect(); return q && r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1; }
    function showTip(td) {
      if (!td) { tipEl.hidden = true; return; }
      var emp = G.rows[+td.dataset.r], di = G.days[+td.dataset.c];
      var r = (monthObj(G.y, G.m).records[emp.id] || {})[di.d] || {};
      if (!r.memo && !r.deduct && !di.holidayName && !r.by) { tipEl.hidden = true; return; }
      var t = emp.name + ' · ' + G.m + '/' + di.d + '(' + di.wd + ')' + (di.holidayName ? ' ' + di.holidayName : '');
      if (r.memo) t += '\n' + r.memo;
      if (r.memo && r.ml) t += '\n(엑셀 메모: 칸 왼쪽에 표시)';
      if (r.deduct) t += '\n연차 추가차감 ' + r.deduct + '일';
      if (r.by) t += '\n입력: ' + r.by + (r.at ? ' ' + r.at.slice(5) : '');
      tipEl.textContent = t; tipEl.hidden = false;
      var b = td.getBoundingClientRect();
      tipEl.style.left = Math.min(window.innerWidth - 270, b.right + 6) + 'px';
      tipEl.style.top = (b.top - 4) + 'px';
    }
    function keyMatches(code, e) {
      var k = String(code.key || '').toLowerCase(); if (!k) return false;
      if (/^[0-9]$/.test(k)) return e.code === 'Digit' + k || e.code === 'Numpad' + k;
      if (/^[a-z]$/.test(k)) return e.code === 'Key' + k.toUpperCase();
      return e.key.toLowerCase() === k;
    }
    function gridKey(e) {
      if (modalOpen() || !G || !G.rows.length || !S.anchor) return;
      var ctrl = e.ctrlKey || e.metaKey;
      var mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      var one = function () { S.sel = { r0: S.anchor.r, c0: S.anchor.c, r1: S.anchor.r, c1: S.anchor.c }; };
      if (mv) {
        e.preventDefault();
        if (e.shiftKey) { S.sel.r1 += mv[0]; S.sel.c1 += mv[1]; clampSel(); }
        else { S.anchor.r += mv[0]; S.anchor.c += mv[1]; clampSel(); one(); }
        paintSel(); scrollToAnchor(); return;
      }
      if (e.key === 'Tab') { e.preventDefault(); S.anchor.c += e.shiftKey ? -1 : 1; clampSel(); one(); paintSel(); scrollToAnchor(); return; }
      if (e.key === 'Home') { e.preventDefault(); S.anchor.c = 0; one(); paintSel(); scrollToAnchor(); return; }
      if (e.key === 'End') { e.preventDefault(); S.anchor.c = G.days.length - 1; one(); paintSel(); scrollToAnchor(); return; }
      if (e.key === 'PageUp') { e.preventDefault(); moveMonth(-1); return; }
      if (e.key === 'PageDown') { e.preventDefault(); moveMonth(1); return; }
      if (ctrl && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
      if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
      if (ctrl && e.code === 'KeyC') { e.preventDefault(); copySel(); return; }
      if (ctrl && e.code === 'KeyV') { e.preventDefault(); pasteSel(); return; }
      if (ctrl && e.code === 'KeyA') { e.preventDefault(); S.sel = { r0: 0, c0: 0, r1: G.rows.length - 1, c1: G.days.length - 1 }; paintSel(); return; }
      if (ctrl && e.code === 'KeyP') { e.preventDefault(); printMonth(); return; }
      if (ctrl || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); detailDialog(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); return; }
      if (e.code === 'KeyJ') { e.preventDefault(); toggleEarly(); return; }
      if (e.code === 'KeyL') { e.preventDefault(); toggleMemoLeft(); return; }
      var code = S.cfg.codes.find(function (c) { return keyMatches(c, e); });
      if (code) { e.preventDefault(); applyCode(code.name); }
    }

    // ---------- 편집
    function guardRO() { if (S.readOnly) { toast('보기 권한만 있어서 고칠 수 없습니다.', true); return true; } return false; }
    function selCells() {
      var q = selRect(); if (!q) return [];
      var out = [];
      for (var r = q.r0; r <= q.r1; r++) for (var c = q.c0; c <= q.c1; c++) out.push({ r: r, c: c, emp: G.rows[r], d: G.days[c].d });
      return out;
    }
    function plain(rec) {
      var o = {};
      if (rec.code) o.code = rec.code;
      if (rec.early) o.early = true;
      if (rec.memo) o.memo = rec.memo;
      if (rec.deduct) o.deduct = +rec.deduct;
      if (rec.ml && rec.memo) o.ml = true;        // 엑셀 메모를 칸 왼쪽에
      return o;
    }
    function getRec(emp, d) { var mo = monthObj(G.y, G.m); return plain((mo.records[emp.id] || {})[d] || {}); }
    function setRec(emp, d, rec) {
      var mo = monthObj(G.y, G.m);
      if (!mo.records[emp.id]) mo.records[emp.id] = {};
      var clean = plain(rec);
      if (Object.keys(clean).length) { clean.by = App.user || ''; clean.at = App.today() + ' ' + new Date().toTimeString().slice(0, 5); mo.records[emp.id][d] = clean; }
      else delete mo.records[emp.id][d];
    }
    function edit(cells, fn) {
      if (guardRO() || !cells.length) return;
      var step = { y: G.y, m: G.m, items: [] }, rowsTouched = {};
      cells.forEach(function (x) {
        var before = getRec(x.emp, x.d);
        var after = plain(fn(Object.assign({}, before), x));
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        step.items.push({ id: x.emp.id, d: x.d, before: before, after: after });
        setRec(x.emp, x.d, after);
        rowsTouched[x.r] = 1;
      });
      if (!step.items.length) return;
      S.undo.push(step); if (S.undo.length > 200) S.undo.shift(); S.redo = [];
      Object.keys(rowsTouched).forEach(function (r) { refreshRow(+r); }); refreshFooter(); paintSel();
      queueSave(G.y, G.m, step.items.map(function (it) { return { id: it.id, d: it.d, rec: it.after }; }));
    }
    function applyCode(name) {
      var cells = selCells();
      var allHave = cells.length && cells.every(function (x) { return getRec(x.emp, x.d).code === name; });
      edit(cells, function (rec) { rec.code = allHave ? undefined : name; return rec; });
      if (cells.length === 1 && !S.readOnly) { // 한 칸이면 오른쪽으로 이동
        S.anchor.c = Math.min(G.days.length - 1, S.anchor.c + 1);
        S.sel = { r0: S.anchor.r, c0: S.anchor.c, r1: S.anchor.r, c1: S.anchor.c }; paintSel(); scrollToAnchor();
      }
    }
    function toggleEarly() {
      var cells = selCells();
      var allHave = cells.length && cells.every(function (x) { return getRec(x.emp, x.d).early; });
      edit(cells, function (rec) { rec.early = !allHave; return rec; });
    }
    function clearSel() { edit(selCells(), function () { return {}; }); }
    // 고른 칸의 엑셀 메모를 칸 왼쪽에 (다시 누르면 오른쪽) — 메모가 있는 칸만
    function toggleMemoLeft() {
      var cells = selCells().filter(function (x) { return getRec(x.emp, x.d).memo; });
      if (!cells.length) { toast('메모가 있는 칸을 고르세요. (빨간 삼각형이 있는 칸)'); return; }
      var allLeft = cells.every(function (x) { return getRec(x.emp, x.d).ml; });
      edit(cells, function (rec) { rec.ml = !allLeft; return rec; });
      toast(cells.length + '칸의 메모를 엑셀에서 칸 ' + (allLeft ? '오른쪽(기본)' : '왼쪽') + '에 보이게 했습니다.');
    }
    function applyStep(step, dir) {
      S.y = step.y; S.m = step.m;
      var mo = monthObj(step.y, step.m);
      step.items.forEach(function (it) {
        var rec = dir === 'undo' ? it.before : it.after;
        if (!mo.records[it.id]) mo.records[it.id] = {};
        if (Object.keys(rec).length) mo.records[it.id][it.d] = Object.assign({ by: App.user || '' }, rec); else delete mo.records[it.id][it.d];
      });
      queueSave(step.y, step.m, step.items.map(function (it) { return { id: it.id, d: it.d, rec: dir === 'undo' ? it.before : it.after }; }));
      renderMonth(true);
    }
    function undo() { if (guardRO()) return; var s = S.undo.pop(); if (!s) { toast('되돌릴 작업이 없습니다.'); return; } S.redo.push(s); applyStep(s, 'undo'); }
    function redo() { if (guardRO()) return; var s = S.redo.pop(); if (!s) return; S.undo.push(s); applyStep(s, 'redo'); }
    function copySel() {
      var q = selRect(); if (!q) return;
      var data = [];
      for (var r = q.r0; r <= q.r1; r++) { var row = []; for (var c = q.c0; c <= q.c1; c++) row.push(getRec(G.rows[r], G.days[c].d)); data.push(row); }
      S.clip = data; toast(data.length + '행 × ' + data[0].length + '칸 복사됨');
    }
    function pasteSel() {
      if (!S.clip) return;
      var q = selRect(), cells = [];
      var R = S.clip.length, Cn = S.clip[0].length;
      var fillR = (q.r1 - q.r0 + 1) % R === 0 ? q.r1 - q.r0 + 1 : R, fillC = (q.c1 - q.c0 + 1) % Cn === 0 ? q.c1 - q.c0 + 1 : Cn;
      for (var i = 0; i < fillR; i++) for (var j = 0; j < fillC; j++) {
        var r = q.r0 + i, c = q.c0 + j;
        if (r < G.rows.length && c < G.days.length) cells.push({ r: r, c: c, emp: G.rows[r], d: G.days[c].d, src: S.clip[i % R][j % Cn] });
      }
      edit(cells, function (rec, x) { return Object.assign({}, x.src); });
    }

    // ---------- 우클릭 메뉴
    function showCtx(x, y) {
      ctxEl.innerHTML = S.cfg.codes.map(function (c) { return '<button data-code="' + esc(c.name) + '"><span class="dot" style="background:' + c.bg + '"></span>' + esc(c.name) + '<kbd>' + esc((c.key || '').toUpperCase()) + '</kbd></button>'; }).join('') +
        '<hr><button data-act="early">조퇴 표시/해제<kbd>J</kbd></button><button data-act="detail">메모·상세 입력<kbd>Enter</kbd></button><button data-act="mleft">메모 왼쪽/오른쪽<kbd>L</kbd></button><button data-act="copy">복사<kbd>Ctrl+C</kbd></button><button data-act="paste">붙여넣기<kbd>Ctrl+V</kbd></button><button data-act="clear">지우기<kbd>Del</kbd></button>';
      ctxEl.hidden = false;
      var h = ctxEl.offsetHeight, w = ctxEl.offsetWidth;
      ctxEl.style.left = Math.min(x, window.innerWidth - w - 6) + 'px';
      ctxEl.style.top = Math.min(y, window.innerHeight - h - 6) + 'px';
      ctxEl.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        hideCtx();
        if (b.dataset.code) applyCode(b.dataset.code);
        else ({ early: toggleEarly, detail: detailDialog, mleft: toggleMemoLeft, copy: copySel, paste: pasteSel, clear: clearSel })[b.dataset.act]();
        focusGrid();
      };
    }
    function hideCtx() { ctxEl.hidden = true; }
    function onDocDown(e) { if (!e.target.closest('.att-ctx')) hideCtx(); }
    document.addEventListener('mousedown', onDocDown);

    // ---------- 상세 입력
    function detailDialog() {
      if (!S.anchor || !G || !G.rows.length || guardRO()) return;
      var cells = selCells(), multi = cells.length > 1;
      var emp = G.rows[S.anchor.r], di = G.days[S.anchor.c];
      var rec = getRec(emp, di.d);
      var code = rec.code || '';
      var raw = (monthObj(G.y, G.m).records[emp.id] || {})[di.d] || {};
      modal('<h2>' + (multi ? cells.length + '칸 일괄 입력' : esc(emp.name) + ' · ' + G.m + '월 ' + di.d + '일 (' + di.wd + ')') + '</h2>' +
        '<div class="sub">' + (di.holidayName ? esc(di.holidayName) + ' · ' : '') + (di.off ? '휴무일 — 특근/야특을 넣으면 출근으로 계산됩니다.' : '평일 — 표시가 없으면 출근으로 계산됩니다.') +
        (multi ? '<br>선택한 모든 칸에 같은 내용이 들어갑니다.' : (raw.by ? '<br>마지막 입력: ' + esc(raw.by) + ' ' + esc((raw.at || '').slice(5)) : '')) + '</div>' +
        '<div class="mb"><div class="form">' +
        '<label>근태</label><div class="codePick" id="dCodes"><span class="chip plain ' + (code ? '' : 'on') + '" data-code="">없음</span>' +
        S.cfg.codes.map(function (c) { return '<span class="chip ' + (code === c.name ? 'on' : '') + '" data-code="' + esc(c.name) + '" style="background:' + c.bg + ';color:' + c.fg + '">' + esc(c.name) + '</span>'; }).join('') + '</div>' +
        '<label>조퇴</label><label style="color:#1d2330"><input type="checkbox" id="dEarly" ' + (rec.early ? 'checked' : '') + '> 조퇴함</label>' +
        '<label>메모<br><span class="muted small">(시간 등)</span></label><div><textarea class="inp" id="dMemo" rows="3" placeholder="예: 17:30퇴근">' + esc(rec.memo || '') + '</textarea>' +
        '<div class="quick">' + QUICK_MEMO.map(function (q) { return '<button class="btn small" data-q="' + q + '">' + q + '</button>'; }).join('') + '</div>' +
        '<label style="display:block;margin-top:6px;color:#5a6372;font-size:12px"><input type="checkbox" id="dMl" ' + (rec.ml ? 'checked' : '') + '> 엑셀로 저장할 때 이 메모를 칸 왼쪽에 보이게</label></div>' +
        '<label>연차 추가차감</label><div><select class="inp" id="dDeduct">' + [0, 0.5, 1, 1.5, 2].map(function (v) { return '<option value="' + v + '" ' + ((+rec.deduct || 0) === v ? 'selected' : '') + '>' + (v ? v + '일 차감' : '없음') + '</option>'; }).join('') + '</select>' +
        '<span class="muted small">&nbsp;조퇴·외출 누적 등으로 연차를 따로 깎을 때</span></div>' +
        '</div></div><div class="mf"><button class="btn" id="dCancel">취소</button><button class="btn primary" id="dOk">저장 (Ctrl+Enter)</button></div>', function (body) {
        $('#dCodes', body).onclick = function (e) { var c = e.target.closest('[data-code]'); if (!c) return; code = c.dataset.code; $$('#dCodes .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); };
        $$('.quick button', body).forEach(function (b) { b.onclick = function () { var t = $('#dMemo'); t.value = t.value ? t.value + '\n' + b.dataset.q : b.dataset.q; t.focus(); }; });
        $('#dCancel').onclick = closeModal;
        var ok = function () {
          var nr = { code: code, early: $('#dEarly').checked, memo: $('#dMemo').value.trim(), deduct: +$('#dDeduct').value, ml: $('#dMl').checked };
          closeModal();
          edit(multi ? cells : [{ r: S.anchor.r, c: S.anchor.c, emp: emp, d: di.d }], function () { return Object.assign({}, nr); });
        };
        $('#dOk').onclick = ok;
        body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); ok(); } });
        setTimeout(function () { $('#dMemo').focus(); }, 40);
      });
    }

    // ---------- 명단 편집
    function rosterDialog() {
      if (guardRO()) return;
      var cur = {}; rosterFor(S.y, S.m).forEach(function (e) { cur[e.id] = 1; });
      modal('<h2>' + S.y + '년 ' + S.m + '월 명단</h2><div class="sub">이 달 근태표에 표시할 직원을 고르세요. 기록이 있는 직원은 뺄 수 없습니다.</div>' +
        '<div class="mb"><div class="checks">' + sortedEmps().map(function (e) {
          var has = Object.keys((monthObj(S.y, S.m).records[e.id]) || {}).length > 0;
          var act = C.activeInMonth(e, S.y, S.m);
          return '<label><input type="checkbox" value="' + e.id + '" ' + (cur[e.id] ? 'checked' : '') + ' ' + (has ? 'disabled' : '') + '> ' + esc(e.name) + ' <span class="muted small">' + esc(e.dept) + (!act ? ' · 재직기간 아님' : '') + '</span></label>';
        }).join('') + '</div></div>' +
        '<div class="mf"><button class="btn left" id="rAuto">재직자 기준으로 다시 맞추기</button><button class="btn" id="rCancel">취소</button><button class="btn primary" id="rOk">적용</button></div>');
      $('#rCancel').onclick = closeModal;
      $('#rAuto').onclick = function () { $$('.att-dlg .checks input').forEach(function (i) { if (!i.disabled) i.checked = C.activeInMonth(empById(i.value), S.y, S.m); }); };
      $('#rOk').onclick = function () {
        var ids = $$('.att-dlg .checks input').filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
        App.api('PUT', '/api/att/roster', { ym: C.ymKey(S.y, S.m), roster: ids }).then(function (r) {
          afterWrite(r);
          var mo = monthObj(S.y, S.m); mo.roster = ids; delete mo._virtual;
          closeModal(); S.sel = S.anchor = null; renderMonth();
        }).catch(App.err);
      };
    }
    function helpDialog() {
      modal('<h2>근태 입력 방법</h2><div class="mb"><ul class="helpList">' +
        '<li>칸을 클릭하고 <kbd>1</kbd>~<kbd>9</kbd>, <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> 단축키로 근태를 넣습니다. (한글 입력 상태여도 됩니다)</li>' +
        '<li>마우스로 끌거나 <kbd>Shift</kbd>+방향키로 여러 칸을 고른 뒤 한 번에 넣을 수 있습니다. 날짜 머리글을 누르면 그날 전체, 이름을 누르면 그 사람 한 달 전체가 선택됩니다.</li>' +
        '<li>같은 코드를 다시 누르면 지워집니다. <kbd>Del</kbd> 칸 지우기, <kbd>J</kbd> 조퇴 표시.</li>' +
        '<li><kbd>Enter</kbd> 또는 더블클릭: 퇴근시간 같은 메모와 연차 추가차감을 넣습니다. 메모가 있는 칸은 오른쪽 위에 빨간 표시가 생깁니다.</li>' +
        '<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 되돌리기, <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> 복사·붙여넣기, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> 이전·다음 달.</li>' +
        '<li>근무일수: 평일은 표시가 없으면 출근, 휴무일(주말·공휴일)은 특근·야특이 있어야 출근으로 셉니다. 결근·월차·경휴·병결·병가·무급은 평일 근무에서 빠집니다. (근태 설정에서 바꿀 수 있음)</li>' +
        '<li>입력하면 바로 서버에 저장됩니다. 여러 PC 에서 동시에 입력해도 되고, 다른 PC 에서 넣은 내용은 15초 안에 화면에 반영됩니다.</li>' +
        '<li>칸에 마우스를 올리면 누가 언제 입력했는지 보입니다.</li>' +
        '<li>엑셀로 저장하면 메모는 엑셀 메모(빨간 삼각형)로 들어가고 크기는 글에 맞춰집니다. 메모가 오른쪽 칸을 가리면 그 칸을 고르고 <kbd>L</kbd> (또는 [메모 ◀ 왼쪽]) — 엑셀에서 칸 왼쪽에 보입니다. 다시 누르면 오른쪽. 왼쪽으로 바꾼 칸은 삼각형이 왼쪽 위(파랑)에 표시됩니다.</li>' +
        '</ul></div><div class="mf"><button class="btn primary" id="hOk" autofocus>닫기</button></div>');
      $('#hOk').onclick = closeModal;
    }

    // ---------- 인쇄 (A4 가로 한 장)
    function printMonth() {
      var t = $('#attGrid table'); if (!t) return;
      view.classList.add('att-printing');
      var w = t.scrollWidth, h = t.scrollHeight + 30;
      view.classList.remove('att-printing');
      var z = Math.min(1, 1060 / w, 700 / h);
      view.style.setProperty('--att-pz', z.toFixed(4));
      window.print();
    }
    function onBeforePrint() { if (S.tab === 'month' && !view.style.getPropertyValue('--att-pz')) { var t = $('#attGrid table'); if (t) view.style.setProperty('--att-pz', Math.min(1, 1060 / t.scrollWidth, 700 / (t.scrollHeight + 30)).toFixed(4)); } }
    function onAfterPrint() { view.style.removeProperty('--att-pz'); }
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);

    // ================================================================ 엑셀 (기존 프로그램과 같은 모양)
    function colName(i) { var s = ''; i += 1; while (i) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
    function hex(c) { return c ? String(c).replace('#', '').toUpperCase() : ''; }
    function toStyled(sh) {
      // sh: {name, title, freezeCols, widths, header:[[cell]], merges:[[r1,c1,r2,c2]], rows:[[cell]]}
      var cells = [], row = 1, merges = [], heights = {}, notes = [];
      var off = sh.title ? 2 : 0;
      if (sh.title) { cells.push([1, 1, sh.title, { bold: true, size: 14, border: false, h: 'left', wrap: false }]); heights[1] = 22; row = 3; }
      function put(rows, isHeader) {
        rows.forEach(function (r) {
          r.forEach(function (c, i) {
            if (c === null || c === undefined) { if (isHeader) cells.push([row, i + 1, '', { fill: 'F2F2F2', bold: true, size: 9 }]); return; }
            var o = typeof c === 'object' ? c : { v: c };
            var st = { size: 9, bold: !!(isHeader || o.bold), h: o.align || 'center', wrap: !!isHeader };
            if (o.fg) st.font = hex(o.fg);
            var bg = o.bg || (isHeader ? '#F2F2F2' : null);
            if (bg) st.fill = hex(bg);
            if (typeof o.v === 'number' && !Number.isInteger(o.v)) st.num = 1;
            cells.push([row, i + 1, o.v === undefined || o.v === null ? '' : o.v, st]);
            if (o.note) notes.push([row, i + 1, o.note, o.noteLeft ? 'left' : 'right']);     // 엑셀 셀 메모
          });
          if (isHeader) heights[row] = 30;
          row++;
        });
      }
      put(sh.header, true);
      (sh.merges || []).forEach(function (m) { merges.push(colName(m[1] - 1) + (m[0] + off) + ':' + colName(m[3] - 1) + (m[2] + off)); });
      put(sh.rows, false);
      var widths = {}; sh.widths.forEach(function (w, i) { widths[i + 1] = w; });
      return { name: sh.name, cells: cells, merges: merges, widths: widths, heights: heights, landscape: true, fit: sh.fit === false ? false : (sh.fit || 'width'), freeze: [off + sh.header.length, sh.freezeCols || 0],
        print_cols: sh.printCols || null, print_rows: sh.printRows || null, scale: sh.scale || null, col_breaks: sh.colBreaks || null,
        notes: notes, note_author: S.cfg.companyName || '' };
    }
    function saveBook(fileName, sheets) {
      return App.api('POST', '/api/xlsx_styled', { filename: fileName, sheets: sheets.map(toStyled) }).then(function (r) { return r.blob(); })
        .then(function (b) { App.saveBlob(b, fileName); toast('엑셀 파일을 저장했습니다.'); }).catch(App.err);
    }
    // 인쇄: A4 가로 2장을 잘라 이어 붙이게 — 반복 열·머리글 없이, 두 장 모두 가로를 꽉 채움
    //   1장: No · 성명 · 1일 ~ k일 / 2장: k+1일 ~ 말일 · 집계  (k 는 달마다 계산)
    //   두 장이 같은 배율 → 붙였을 때 줄이 맞음. 날짜 칸 폭은 두 장 같음, 집계 칸 폭으로 2장째를 맞춤
    function printLayout(nDays, nSum, nRows) {
      var px = function (w) { return Math.round(w * 7 + 5); }, w = function (p) { return Math.max(1, Math.round((p - 5) / 7 * 100) / 100); };
      var PW = (11.69 - 0.6) * 96 * 0.88, PH = (8.27 - 0.6) * 96 * 0.95;   // A4 가로, 여백 0.3인치 (엑셀·프로그램마다 글자 폭 계산이 조금씩 달라 여유를 둠)
      var contentH = (22 + 15 + 30 + 30 + nRows * 15) * 4 / 3;              // 제목·빈줄·머리글 2줄·직원 줄 (pt → px)
      var scale = Math.max(40, Math.min(100, Math.floor(PH / contentH * 100)));
      var P = PW * 100 / scale;                                              // 배율 적용 전 한 장 폭 (px)
      var fixedPx = px(4) + px(10), best = null;
      for (var k = Math.ceil(nDays / 3); k <= nDays - 3; k++) {
        var dayPx = Math.floor((P - fixedPx) / k);
        var sumPx = Math.floor((P - (nDays - k) * dayPx) / nSum);
        if (sumPx < 30) continue;
        var score = Math.abs(sumPx - dayPx * 0.85);                          // 집계 칸이 날짜 칸보다 조금 좁은 정도가 보기 좋음
        if (!best || score < best.score) best = { k: k, dayPx: dayPx, sumPx: sumPx, score: score };
      }
      if (!best) best = { k: Math.ceil(nDays / 2), dayPx: 45, sumPx: 40 };
      var widths = [4, 10];
      for (var i = 0; i < nDays; i++) widths.push(w(best.dayPx));
      for (var j = 0; j < nSum; j++) widths.push(w(best.sumPx));
      return { scale: scale, breakCol: 2 + best.k, widths: widths };
    }
    function monthSheet(y, m) {
      var days = C.monthDays(S.cfg, y, m), rows = rosterFor(y, m), mo = monthObj(y, m), cm = C.codeMap(S.cfg);
      var fixed = ['No', '성명'];     // 부서·직급·입사일·근속은 엑셀에 안 넣음
      var sumL = SUMCOLS.map(function (c) { return (c.label || c.code).replace(/<br>/g, '\n'); });
      var dcol = function (di) { return di.dow === 0 || di.holidayName ? '#C62828' : di.dow === 6 ? '#1E5BB8' : undefined; };
      var h1 = fixed.map(function (v) { return { v: v }; }).concat(days.map(function (di) { return { v: di.d, bg: di.off ? '#FDEEB0' : '#F2F2F2', fg: dcol(di) }; })).concat(sumL.map(function (v) { return { v: v, bg: '#E3E9F3' }; }));
      var h2 = fixed.map(function () { return null; }).concat(days.map(function (di) { return { v: di.holidayName ? '휴' : di.wd, bg: di.off ? '#FDEEB0' : '#F2F2F2', fg: dcol(di) }; })).concat(sumL.map(function () { return null; }));
      var merges = [];
      fixed.forEach(function (_, i) { merges.push([1, i + 1, 2, i + 1]); });
      sumL.forEach(function (_, i) { var c = fixed.length + days.length + i + 1; merges.push([1, c, 2, c]); });
      var body = rows.map(function (emp, i) {
        var recs = mo.records[emp.id] || {};
        var s = C.summarize(S.cfg, y, m, emp, recs), lv = leaveStatus(emp, y, m);
        return [i + 1, { v: emp.name + (emp.foreign ? ' (외)' : ''), bold: true }].concat(days.map(function (di) {
          var r = recs[di.d] || {}, c = r.code ? cm[r.code] : null;
          var v = r.code || ''; if (r.early) v = v ? v + '/조퇴' : '조퇴';
          var note = [r.memo, r.deduct ? '연차 추가차감 ' + r.deduct + '일' : ''].filter(Boolean).join('\n');
          return { v: v, bg: c ? c.bg : (r.early ? '#BFBFBF' : di.off ? '#FFF8D6' : undefined), fg: c ? c.fg : undefined, note: note || undefined, noteLeft: !!r.ml };
        })).concat(SUMCOLS.map(function (col) {
          if (lv.foreign && (col.key === 'remain' || col.key === 'usedThis')) return '';
          var v = sumValue(col, s, lv); return { v: v === null ? '-' : Math.round(v * 10) / 10, bold: !!col.k };
        }));
      });
      var lay = printLayout(days.length, sumL.length, body.length);
      return { name: m + '월 근태', title: S.cfg.companyName + ' 근태현황 (' + y + '년 ' + m + '월)', freezeCols: 2,
        fit: false, scale: lay.scale, colBreaks: [lay.breakCol],
        widths: lay.widths, header: [h1, h2], merges: merges, rows: body };
    }
    function exportMonth() {
      ensureYear(S.y).then(function () { saveBook('근태현황_' + S.y + '년_' + S.m + '월.xlsx', [monthSheet(S.y, S.m), leaveSheet(S.y, S.m)]); });
    }

    // ================================================================ 연차 현황
    function leaveRows(y, upto) {
      var ids = {};
      for (var m = 1; m <= 12; m++) rosterFor(y, m).forEach(function (e) { ids[e.id] = 1; });
      return sortedEmps().filter(function (e) { return !e.foreign && (ids[e.id] || C.activeInMonth(e, y, upto)); }).map(function (emp) {
        var g = C.grantInfo(S.cfg, S.leave, emp, y, upto), monthly = [], used = 0;
        for (var m2 = 1; m2 <= 12; m2++) {
          var mo = monthObj(y, m2);
          var u = mo ? C.summarize(S.cfg, y, m2, emp, mo.records[emp.id]).leaveUsed : 0;
          monthly.push(u); if (m2 <= upto) used += u;
        }
        return { emp: emp, g: g, monthly: monthly, used: used, remain: g.total === null ? null : g.total - used };
      });
    }
    function leaveSheet(y, upto) {
      var rows = leaveRows(y, upto);
      var head = ['No', '부서', '직급', '성명', '입사일', '근속', '발생', '조정', '총 연차'].concat(Array.apply(null, Array(12)).map(function (_, i) { return (i + 1) + '월'; })).concat(['사용 계', '잔여', '비고']);
      return { name: y + ' 연차', title: S.cfg.companyName + ' 연차 현황 (' + y + '년, ' + upto + '월말 기준)', freezeCols: 4,
        widths: [4, 8, 6, 9, 10.5, 10, 6, 6, 7].concat(Array(12).fill(5)).concat([7, 7, 26]),
        header: [head.map(function (v) { return { v: v }; })],
        rows: rows.map(function (x, i) {
          return [i + 1, x.emp.dept, x.emp.rank, { v: x.emp.name, bold: true }, x.emp.hireDate || '', C.serviceText(x.emp.hireDate, y, upto),
            x.g.base === null ? '-' : x.g.base, x.g.adjust || '', x.g.total === null ? '-' : { v: x.g.total, bold: true }]
            .concat(x.monthly.map(function (v) { return v || ''; }))
            .concat([x.used, x.remain === null ? '-' : { v: x.remain, bold: true, fg: x.remain < 0 ? '#C62828' : undefined }, { v: (x.g.fixed ? '직접지정 ' : '') + (x.g.note || ''), align: 'left' }]);
        }) };
    }
    function renderLeave() {
      if (!S.yearOf.leave) S.yearOf.leave = S.y;
      var y = S.yearOf.leave;
      return ensureYear(y).then(function () {
        var upto = y === today.getFullYear() ? today.getMonth() + 1 : 12;
        var rows = leaveRows(y, upto);
        var ls = S.cfg.leaveStartYear === undefined || S.cfg.leaveStartYear === null ? 2015 : S.cfg.leaveStartYear;
        view.innerHTML = '<div class="toolbar no-print"><div class="monthNav"><button class="btn icon" id="lPrev">◀</button><div class="title">' + y + '년 연차</div><button class="btn icon" id="lNext">▶</button></div>' +
          '<div class="info">내국인만 표시 · ' + upto + '월말 기준 · 월차 1일, 반차 0.5일 + 추가차감 합계' + (canEdit ? ' · <b>발생</b> 칸을 누르면 직접 지정/조정할 수 있습니다' : '') + '</div>' +
          '<span class="grow"></span><button class="btn" id="lPrint">인쇄</button><button class="btn" id="lExport">엑셀로 저장</button></div>' +
          '<div class="print-title">' + esc(S.cfg.companyName || '') + ' 연차 현황 (' + y + '년, ' + upto + '월말 기준)</div>' +
          '<div class="apage"><div class="tableBox"><table class="list">' +
          '<thead><tr><th>No</th><th class="l">부서</th><th>직급</th><th class="l">성명</th><th>입사일</th><th>근속</th><th>규칙</th><th>발생</th><th>조정</th><th>총 연차</th>' +
          Array.apply(null, Array(12)).map(function (_, i) { return '<th>' + (i + 1) + '월</th>'; }).join('') + '<th>사용 계</th><th>잔여</th><th class="l">비고</th></tr></thead><tbody>' +
          rows.map(function (x, i) {
            return '<tr class="' + (x.emp.quitDate ? 'quit' : '') + '"><td>' + (i + 1) + '</td><td class="l">' + esc(x.emp.dept) + '</td><td>' + esc(x.emp.rank) + '</td><td class="l strong">' + esc(x.emp.name) + '</td>' +
              '<td>' + (x.emp.hireDate || '<span class="tag warn">입사일 없음</span>') + '</td><td>' + C.serviceText(x.emp.hireDate, y, upto) + '</td>' +
              '<td class="num">' + (x.g.rule === null ? '-' : x.g.rule) + '</td>' +
              '<td class="num ' + (canEdit ? 'edit' : '') + '" data-id="' + x.emp.id + '" title="' + (canEdit ? '눌러서 수정' : '') + '">' + (x.g.base === null ? '지정' : C.fmtNum(x.g.base)) + (x.g.fixed ? ' <span class="tag">지정</span>' : '') + '</td>' +
              '<td class="num ' + (canEdit ? 'edit' : '') + '" data-id="' + x.emp.id + '">' + (x.g.adjust ? (x.g.adjust > 0 ? '+' : '') + C.fmtNum(x.g.adjust) : '·') + '</td>' +
              '<td class="num strong">' + (x.g.total === null ? '-' : C.fmtNum(x.g.total)) + '</td>' +
              x.monthly.map(function (v, k) { return '<td class="num ' + (v ? '' : 'zero') + '" style="' + (k + 1 > upto ? 'opacity:.5' : '') + '">' + (v ? C.fmtNum(v) : '·') + '</td>'; }).join('') +
              '<td class="num strong">' + C.fmtNum(x.used) + '</td>' +
              '<td class="num strong" style="' + (x.remain !== null && x.remain < 0 ? 'color:#c62828' : '') + '">' + (x.remain === null ? '-' : C.fmtNum(x.remain)) + '</td>' +
              '<td class="l muted small">' + esc(x.g.note) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="muted small no-print" style="margin-top:12px;line-height:1.7">규칙: 입사한 해에는 한 달 개근마다 1일(최대 11일) → 다음 해 1월 1일에 15일 → 이후 2년마다 1일씩 추가 (최대 ' + S.cfg.leaveMax + '일).' +
          (ls ? ' ' + ls + '년 이전 입사자는 ' + ls + '년에 15일로 시작합니다.' : '') + '<br>입사일이 없거나 규칙과 다르게 운영하는 직원은 \'발생\'을 직접 지정해 주세요.</p></div>';
        $('#lPrev').onclick = function () { S.yearOf.leave--; renderLeave(); };
        $('#lNext').onclick = function () { S.yearOf.leave++; renderLeave(); };
        $('#lPrint').onclick = function () { window.print(); };
        $('#lExport').onclick = function () { saveBook('연차현황_' + y + '년.xlsx', [leaveSheet(y, upto)]); };
        if (canEdit) $$('td.edit', view).forEach(function (td) { td.onclick = function () { leaveDialog(empById(td.dataset.id), y, upto); }; });
      }).catch(App.err);
    }
    function leaveDialog(emp, y, upto) {
      if (guardRO()) return;
      var L = (S.leave[emp.id] && S.leave[emp.id][y]) || {};
      var rule = C.ruleGrant(S.cfg, emp, y, upto);
      modal('<h2>' + esc(emp.name) + ' · ' + y + '년 연차</h2>' +
        '<div class="sub">규칙 계산값: <b>' + (rule === null ? '입사일 없음' : rule + '일') + '</b>' + (emp.hireDate ? ' (입사 ' + emp.hireDate + ')' : '') + '</div>' +
        '<div class="mb"><div class="form">' +
        '<label>발생 직접 지정</label><div><input class="inp" id="lgGrant" type="number" step="0.5" style="width:100px" value="' + (L.grant === undefined || L.grant === null ? '' : L.grant) + '" placeholder="비우면 규칙"> 일</div>' +
        '<label>조정 (+/-)</label><div><input class="inp" id="lgAdj" type="number" step="0.5" style="width:100px" value="' + (L.adjust === undefined || L.adjust === null ? '' : L.adjust) + '" placeholder="0"> 일 <span class="muted small">이월, 포상 휴가 등</span></div>' +
        '<label>비고</label><input class="inp" id="lgNote" value="' + esc(L.note || '') + '">' +
        '</div></div><div class="mf"><button class="btn" id="lgCancel">취소</button><button class="btn primary" id="lgOk">저장</button></div>');
      $('#lgCancel').onclick = closeModal;
      $('#lgOk').onclick = function () {
        var g = $('#lgGrant').value.trim(), a = $('#lgAdj').value.trim(), n = $('#lgNote').value.trim();
        App.api('PUT', '/api/att/leave', { id: emp.id, year: y, grant: g, adjust: a, note: n }).then(function (r) {
          afterWrite(r);
          var o = {}; if (g !== '') o.grant = +g; if (a !== '' && +a) o.adjust = +a; if (n) o.note = n;
          if (!S.leave[emp.id]) S.leave[emp.id] = {};
          if (Object.keys(o).length) S.leave[emp.id][y] = o; else delete S.leave[emp.id][y];
          closeModal(); renderLeave();
        }).catch(App.err);
      };
    }

    // ================================================================ 연간 집계
    function metricVal(key, s) { return key.indexOf('code:') === 0 ? (s.counts[key.slice(5)] || 0) : s[key]; }
    function yearTable(y, key) {
      var ids = {};
      for (var m = 1; m <= 12; m++) if (!monthObj(y, m)._virtual) rosterFor(y, m).forEach(function (e) { ids[e.id] = 1; });
      return sortedEmps().filter(function (e) { return ids[e.id]; }).map(function (emp) {
        var vals = [];
        for (var m2 = 1; m2 <= 12; m2++) {
          var mo = monthObj(y, m2);
          if (mo._virtual || !(mo.roster || rosterFor(y, m2).map(function (e) { return e.id; })).includes(emp.id)) { vals.push(null); continue; }
          vals.push(metricVal(key, C.summarize(S.cfg, y, m2, emp, mo.records[emp.id])));
        }
        return { emp: emp, vals: vals, total: vals.reduce(function (a, b) { return a + (b || 0); }, 0) };
      });
    }
    function renderYear() {
      if (!S.yearOf.year) S.yearOf.year = S.y;
      var y = S.yearOf.year;
      return ensureYear(y).then(function () {
        var key = S.yearMetric, rows = yearTable(y, key);
        var colTot = Array.apply(null, Array(12)).map(function (_, i) { return rows.reduce(function (a, r) { return a + (r.vals[i] || 0); }, 0); });
        var label = (METRICS.find(function (x) { return x[0] === key; }) || ['', ''])[1];
        view.innerHTML = '<div class="toolbar no-print"><div class="monthNav"><button class="btn icon" id="yPrev">◀</button><div class="title">' + y + '년 집계</div><button class="btn icon" id="yNext">▶</button></div>' +
          '<select class="input" id="yMetric" style="max-width:200px">' + METRICS.map(function (x) { return '<option value="' + x[0] + '" ' + (x[0] === key ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
          '<div class="info">입력된 달만 집계합니다</div><span class="grow"></span><button class="btn" id="yPrint">인쇄</button><button class="btn" id="yExport">엑셀로 저장 (전체 항목)</button></div>' +
          '<div class="print-title">' + esc(S.cfg.companyName || '') + ' ' + y + '년 ' + esc(label) + '</div>' +
          '<div class="apage"><div class="tableBox"><table class="list"><thead><tr><th>No</th><th class="l">부서</th><th class="l">성명</th>' +
          Array.apply(null, Array(12)).map(function (_, i) { return '<th>' + (i + 1) + '월</th>'; }).join('') + '<th>합계</th></tr></thead><tbody>' +
          rows.map(function (r, i) {
            return '<tr><td>' + (i + 1) + '</td><td class="l">' + esc(r.emp.dept) + '</td><td class="l strong">' + esc(r.emp.name) + '</td>' +
              r.vals.map(function (v) { return '<td class="num ' + (v ? '' : 'zero') + '">' + (v === null ? '' : v ? C.fmtNum(v) : '·') + '</td>'; }).join('') + '<td class="num strong">' + C.fmtNum(r.total) + '</td></tr>';
          }).join('') + '</tbody><tfoot><tr><td></td><td></td><td class="l">합계</td>' + colTot.map(function (v) { return '<td class="num">' + (v ? C.fmtNum(v) : '') + '</td>'; }).join('') +
          '<td class="num">' + C.fmtNum(colTot.reduce(function (a, b) { return a + b; }, 0)) + '</td></tr></tfoot></table></div></div>';
        $('#yPrev').onclick = function () { S.yearOf.year--; renderYear(); };
        $('#yNext').onclick = function () { S.yearOf.year++; renderYear(); };
        $('#yMetric').onchange = function (e) { S.yearMetric = e.target.value; renderYear(); };
        $('#yPrint').onclick = function () { window.print(); };
        $('#yExport').onclick = function () {
          saveBook('연간집계_' + y + '년.xlsx', METRICS.map(function (x) {
            var rs = yearTable(y, x[0]);
            return { name: x[1].replace(/[\\/?*[\]:]/g, '').slice(0, 28), title: S.cfg.companyName + ' ' + y + '년 ' + x[1], freezeCols: 3,
              widths: [4, 9, 9].concat(Array(12).fill(6)).concat([7]),
              header: [['No', '부서', '성명'].concat(Array.apply(null, Array(12)).map(function (_, i) { return (i + 1) + '월'; })).concat(['합계']).map(function (v) { return { v: v }; })],
              rows: rs.map(function (r, i) { return [i + 1, r.emp.dept, { v: r.emp.name, bold: true }].concat(r.vals.map(function (v) { return v === null ? '' : v; })).concat([{ v: r.total, bold: true }]); }) };
          }));
        };
      }).catch(App.err);
    }

    // ================================================================ 직원 관리
    function natTag(e) { return e.foreign ? '<span class="tag nat-f">외국인</span>' : '<span class="tag nat-l">내국인</span>'; }
    function renderEmp() {
      return ensureYear(S.y).then(function () {
        var f = S.empFilter, nf = S.empNat;
        var list = sortedEmps().filter(function (e) { return f === 'all' || (f === 'active' ? !e.quitDate || C.parseDate(e.quitDate) >= today : !!e.quitDate); })
          .filter(function (e) { return nf === 'all' || (nf === 'foreign' ? !!e.foreign : !e.foreign); });
        var nFor = list.filter(function (e) { return e.foreign; }).length;
        view.innerHTML = '<div class="toolbar no-print">' +
          '<select class="input" id="eFilter" style="max-width:110px"><option value="active">재직자</option><option value="quit">퇴사자</option><option value="all">전체</option></select>' +
          '<select class="input" id="eNat" style="max-width:150px"><option value="all">내·외국인 전체</option><option value="local">내국인</option><option value="foreign">외국인</option></select>' +
          '<div class="info">' + list.length + '명 (내국인 ' + (list.length - nFor) + ' · 외국인 ' + nFor + ')' + (canEdit ? ' · 행을 누르면 수정 · 구분 칸을 누르면 내국인/외국인 전환' : '') + '</div>' +
          '<span class="grow"></span>' + (canEdit ? '<button class="btn primary" id="eAdd">+ 직원 추가</button>' : '') + '</div>' +
          '<div class="apage"><div class="tableBox"><table class="list"><thead><tr><th>순서</th><th>구분</th><th class="l">부서</th><th>직급</th><th class="l">성명</th><th>입사일</th><th>근속</th><th>퇴사일</th><th class="l">메모</th><th class="l">수정</th><th></th></tr></thead><tbody>' +
          list.map(function (e) {
            return '<tr class="' + (canEdit ? 'click ' : '') + (e.quitDate ? 'quit' : '') + '" data-id="' + e.id + '"><td>' + e.order + '</td><td data-nat="1" title="눌러서 내국인/외국인 전환">' + natTag(e) + '</td>' +
              '<td class="l">' + esc(e.dept) + '</td><td>' + esc(e.rank) + '</td><td class="l strong">' + esc(e.name) + '</td>' +
              '<td>' + (e.hireDate || (e.foreign ? '' : '<span class="tag warn">없음</span>')) + '</td><td>' + C.serviceText(e.hireDate, today.getFullYear(), today.getMonth() + 1) + '</td>' +
              '<td>' + (e.quitDate || '') + '</td><td class="l muted">' + esc(e.memo || '') + '</td><td class="l muted small">' + esc(e.updated_by || '') + ' ' + esc((e.updated || '').slice(2, 16)) + '</td>' +
              '<td>' + (canEdit ? '<button class="btn small" data-mv="-1">▲</button> <button class="btn small" data-mv="1">▼</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
        $('#eFilter').value = f; $('#eNat').value = nf;
        $('#eFilter').onchange = function (e) { S.empFilter = e.target.value; renderEmp(); };
        $('#eNat').onchange = function (e) { S.empNat = e.target.value; renderEmp(); };
        if ($('#eAdd')) $('#eAdd').onclick = function () { empDialog(null); };
        $('tbody', view).onclick = function (e) {
          if (!canEdit) return;
          var tr = e.target.closest('tr[data-id]'); if (!tr) return;
          var mvb = e.target.closest('[data-mv]');
          if (mvb) { moveEmp(tr.dataset.id, +mvb.dataset.mv); return; }
          var emp = empById(tr.dataset.id);
          if (e.target.closest('[data-nat]')) {
            saveEmp(Object.assign({}, emp, { foreign: !emp.foreign })).then(function () { toast(emp.name + ' 님을 ' + (!emp.foreign ? '외국인' : '내국인') + '으로 바꿨습니다.'); });
            return;
          }
          empDialog(emp);
        };
      }).catch(App.err);
    }
    function saveEmp(o) {
      return App.api('POST', '/api/att/emp', o).then(function (r) {
        afterWrite(r);
        return loadYear(S.y, true).then(function () { S.loaded = {}; S.loaded[S.y] = true; renderEmp(); return r; });
      }).catch(function (e) { App.err(e); throw e; });
    }
    function moveEmp(id, d) {
      var arr = sortedEmps(), i = arr.findIndex(function (e) { return e.id === id; }), j = i + d;
      if (j < 0 || j >= arr.length) return;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      arr.forEach(function (e, k) { e.order = k + 1; });
      renderEmp();
      App.api('PUT', '/api/att/emp_order', { ids: arr.map(function (e) { return e.id; }) }).then(afterWrite).catch(App.err);
    }
    function empDialog(emp) {
      if (guardRO()) return;
      var isNew = !emp, e = emp || { dept: '', rank: '', name: '', hireDate: '', quitDate: '', memo: '' };
      var uniq = function (k) { return S.emps.map(function (x) { return x[k]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }); };
      modal('<h2>' + (isNew ? '직원 추가' : '직원 정보 수정') + '</h2><div class="mb"><div class="form">' +
        '<label>성명 *</label><input class="inp" id="fName" value="' + esc(e.name) + '" autofocus>' +
        '<label>구분</label><div style="display:flex;gap:16px"><label style="color:#1d2330"><input type="radio" name="fNat" value="0" ' + (e.foreign ? '' : 'checked') + '> 내국인</label><label style="color:#1d2330"><input type="radio" name="fNat" value="1" ' + (e.foreign ? 'checked' : '') + '> 외국인 <span class="muted small">(연차 관리 안 함)</span></label></div>' +
        '<label>부서</label><input class="inp" id="fDept" list="attDlDept" value="' + esc(e.dept) + '"><datalist id="attDlDept">' + uniq('dept').map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
        '<label>직급</label><input class="inp" id="fRank" list="attDlRank" value="' + esc(e.rank) + '"><datalist id="attDlRank">' + uniq('rank').map(function (d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
        '<label>입사일</label><input class="inp" id="fHire" type="date" value="' + (e.hireDate || '') + '">' +
        '<label>퇴사일</label><input class="inp" id="fQuit" type="date" value="' + (e.quitDate || '') + '">' +
        '<label>메모</label><input class="inp" id="fMemo" value="' + esc(e.memo || '') + '">' +
        (emp && emp.updated_by ? '<label>마지막 수정</label><div class="muted small">' + esc(emp.updated_by) + ' ' + esc(emp.updated || '') + '</div>' : '') +
        '</div></div><div class="mf">' + (isNew || !canAdmin ? '' : '<button class="btn danger left" id="fDel">삭제</button>') + '<button class="btn" id="fCancel">취소</button><button class="btn primary" id="fOk">저장</button></div>');
      $('#fCancel').onclick = closeModal;
      $('#fOk').onclick = function () {
        var name = $('#fName').value.trim();
        if (!name) { toast('성명을 입력하세요.', true); return; }
        var go = function () {
          saveEmp({ id: emp ? emp.id : null, name: name, dept: $('#fDept').value.trim(), rank: $('#fRank').value.trim(), hireDate: $('#fHire').value || null,
            quitDate: $('#fQuit').value || null, memo: $('#fMemo').value.trim(), foreign: $('input[name=fNat]:checked').value === '1' })
            .then(function () { closeModal(); toast(isNew ? name + ' 님을 추가했습니다.' : '저장했습니다.'); });
        };
        if (S.emps.some(function (x) { return x.name === name && x !== emp; })) {
          confirmBox('같은 이름', "'" + name + "' 이름의 직원이 이미 있습니다. 그래도 저장할까요?").then(function (ok) { if (ok) go(); });
        } else go();
      };
      if ($('#fDel')) $('#fDel').onclick = function () {
        confirmBox('직원 삭제', emp.name + ' 님을 삭제할까요?\n(근태 기록이 있으면 삭제되지 않습니다. 퇴사일을 넣어 주세요)', '삭제', true).then(function (ok) {
          if (!ok) return;
          App.api('DELETE', '/api/att/emp/' + emp.id).then(function (r) {
            afterWrite(r); closeModal();
            return loadYear(S.y, true).then(renderEmp);
          }).catch(App.err);
        });
      };
    }

    // ================================================================ 근태 설정
    function saveCfg(what) {
      return App.api('PUT', '/api/att/config', { cfg: S.cfg, what: what }).then(function (r) { afterWrite(r); setSaveState('설정 저장됨 ' + new Date().toTimeString().slice(0, 5), 'ok'); })
        .catch(function (e) { App.err(e); S.loaded = {}; render(); });
    }
    function mergeHolidays(year, fetched) {
      var key = String(year), old = S.cfg.holidays[key] || [];
      var fset = {}; fetched.forEach(function (h) { fset[h[0]] = h[1]; });
      var added = [], removed = [], changed = [], next = [];
      old.forEach(function (h) {
        if (fset[h[0]] !== undefined) { if (h[1] !== fset[h[0]]) changed.push(h[0] + ' ' + h[1] + ' → ' + fset[h[0]]); return; }
        if (h[2] === 'api' || PUBLIC_RE.test(h[1])) { removed.push(h[0] + ' ' + h[1]); return; } // 예전 공휴일 목록은 새 결과로 교체
        next.push([h[0], h[1]]); // 회사 지정 휴일은 그대로 둠
      });
      Object.keys(fset).forEach(function (d) {
        if (!old.some(function (h) { return h[0] === d; })) added.push(d + ' ' + fset[d]);
        next.push([d, fset[d], 'api']);
      });
      next.sort(function (a, b) { return a[0].localeCompare(b[0]); });
      S.cfg.holidays[key] = next;
      S.cfg.holidaySync = S.cfg.holidaySync || {};
      S.cfg.holidaySync[key] = App.today();
      return { added: added, removed: removed, changed: changed };
    }
    function renderSettings() {
      if (!canAdmin) { view.innerHTML = '<div class="empty">근태 설정은 근태관리 \'삭제까지\' 권한이 있어야 바꿀 수 있습니다.</div>'; return; }
      var cfg = S.cfg, hy = S.yearOf.hol || S.y;
      var hol = (cfg.holidays[String(hy)] || []).slice().sort(function (a, b) { return a[0].localeCompare(b[0]); });
      var ls = cfg.leaveStartYear === undefined || cfg.leaveStartYear === null ? 2015 : cfg.leaveStartYear;
      view.innerHTML = '<div class="apage" style="max-width:1000px">' +
        '<div class="card"><h3>기존 근태관리 프로그램 자료 가져오기</h3><div class="body">' +
        '<div class="drop" id="aDrop">근태 데이터 폴더의 파일을 끌어다 놓거나 <b>클릭해서 선택</b><br><span class="muted small">employees.json · leave.json · config.json · months 폴더의 2026-01.json … (여러 개 한꺼번에) 또는 폴더를 압축한 .zip</span>' +
        '<input type="file" accept=".json,.zip" multiple hidden></div>' +
        '<p class="muted small" style="margin:8px 0 0;line-height:1.7">같은 달 자료를 다시 가져오면 그 달 근태는 가져온 내용으로 바뀝니다. 가져오기 전에 자동 백업됩니다.<br>' +
        '근태관리 프로그램의 데이터 폴더 위치: 프로그램 [설정 → 데이터 폴더 → 폴더 열기]</p></div></div>' +
        '<div class="card"><h3>기본값</h3><div class="body"><div class="form" style="max-width:560px">' +
        '<label>회사명</label><input class="inp" id="sName" value="' + esc(cfg.companyName) + '">' +
        '<label>잔업 2회 기준</label><div><input class="inp" id="sOt" type="number" style="width:80px" value="' + cfg.overtimeBase + '"> 회 <span class="muted small">잔업2회 = 기준 − 조퇴 − 잔업無</span></div>' +
        '<label>연차 최대</label><div><input class="inp" id="sMax" type="number" style="width:80px" value="' + cfg.leaveMax + '"> 일</div>' +
        '<label>연차제도 도입</label><div><input class="inp" id="sStart" type="number" style="width:80px" value="' + ls + '"> 년 <span class="muted small">이전 입사자는 이 해에 15일로 시작해서 근속을 셉니다</span></div>' +
        '</div></div></div>' +
        '<div class="card"><h3>근태 코드 <span class="muted small" style="font-weight:400">이미 쓰고 있는 코드의 이름은 바꿀 수 없습니다</span><span class="grow"></span><button class="btn small" id="sAddCode">+ 코드 추가</button></h3><div class="body" style="padding:0">' +
        '<table class="list"><thead><tr><th class="l">코드</th><th>단축키</th><th>배경색</th><th>글자색</th><th>평일에 쓰면</th><th>휴무일 출근 인정</th><th>연차 차감</th><th>미리보기</th><th></th></tr></thead>' +
        '<tbody id="codeBody">' + cfg.codes.map(function (c, i) {
          return '<tr data-i="' + i + '"><td class="l"><input class="inp" data-f="name" value="' + esc(c.name) + '" style="width:80px" ' + (c._new ? '' : 'readonly') + '></td>' +
            '<td><input class="inp" data-f="key" value="' + esc(c.key || '') + '" maxlength="1" style="width:40px;text-align:center"></td>' +
            '<td><input type="color" class="swatch" data-f="bg" value="' + c.bg + '"></td><td><input type="color" class="swatch" data-f="fg" value="' + c.fg + '"></td>' +
            '<td><select class="inp" data-f="day"><option value="1" ' + (+c.day === 1 ? 'selected' : '') + '>출근</option><option value="0.5" ' + (+c.day === 0.5 ? 'selected' : '') + '>반일 출근</option><option value="0" ' + (+c.day === 0 ? 'selected' : '') + '>결근 처리</option></select></td>' +
            '<td><input type="checkbox" data-f="holiday" ' + (c.holiday ? 'checked' : '') + '></td>' +
            '<td><select class="inp" data-f="leave">' + [0, 0.5, 1].map(function (v) { return '<option value="' + v + '" ' + (+c.leave === v ? 'selected' : '') + '>' + (v ? v + '일' : '-') + '</option>'; }).join('') + '</select></td>' +
            '<td><span class="chip" style="background:' + c.bg + ';color:' + c.fg + '">' + esc(c.name) + '</span></td><td><button class="btn small danger" data-cdel="' + i + '">삭제</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<div class="card"><h3>휴무일 (공휴일·회사 지정 휴일) <span class="grow"></span><button class="btn small icon" id="hPrev">◀</button><b>' + hy + '년</b><button class="btn small icon" id="hNext">▶</button></h3><div class="body">' +
        '<p class="muted small" style="margin:0 0 10px">주말은 자동으로 휴무일입니다. 여기에는 평일 중 쉬는 날만 넣으세요. 휴무일에는 특근·야특을 넣어야 근무일수에 들어갑니다.' +
        (hy > 2026 && !(cfg.holidaySync && cfg.holidaySync[hy]) ? ' <b style="color:#b45309">아직 자동으로 받아오지 않은 해입니다. 아래에서 받아오거나 회사 달력과 확인하세요.</b>' : '') + '</p>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:#f6f8fb;border:1px solid #e1e4e9;border-radius:8px">' +
        '<b style="font-size:12.5px">공휴일 자동 받아오기</b><input class="inp" id="hKey" type="password" placeholder="공공데이터포털 인증키 (일반 인증키)" style="flex:1;min-width:260px" value="' + esc(cfg.holidayApiKey || '') + '">' +
        '<button class="btn small" id="hKeyShow" type="button">보기</button><button class="btn primary" id="hFetch">' + hy + '년 공휴일 받아오기</button>' +
        '<div class="muted small" style="flex-basis:100%;line-height:1.6">공공데이터포털(data.go.kr)의 \'한국천문연구원_특일 정보\'에서 공휴일·대체공휴일을 받아옵니다 (서버 PC 에서 인터넷이 되어야 함). 회사 지정 휴일(창립기념일 등)은 지워지지 않습니다.' +
        (cfg.holidaySync && cfg.holidaySync[hy] ? ' <b>' + hy + '년 마지막 확인: ' + cfg.holidaySync[hy] + '</b>' : '') + '</div></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px"><input class="inp" type="date" id="hDate" min="' + hy + '-01-01" max="' + hy + '-12-31"><input class="inp" id="hName" placeholder="이름 (예: 창립기념일)"><button class="btn" id="hAdd">추가</button></div>' +
        '<table class="list" style="max-width:520px"><thead><tr><th>날짜</th><th>요일</th><th class="l">이름</th><th></th></tr></thead><tbody>' +
        (hol.map(function (h) {
          var p = h[0].split('-').map(Number), dow = new Date(hy, p[0] - 1, p[1]).getDay();
          return '<tr><td>' + hy + '-' + h[0] + '</td><td style="' + (dow === 0 || dow === 6 ? 'color:#c62828' : '') + '">' + C.WD[dow] + '</td><td class="l">' + esc(h[1]) + (h[2] === 'api' ? ' <span class="tag">자동</span>' : '') + '</td><td><button class="btn small danger" data-hdel="' + h[0] + '">삭제</button></td></tr>';
        }).join('') || '<tr><td colspan="4" class="muted">등록된 휴무일이 없습니다</td></tr>') +
        '</tbody></table></div></div></div>';
      // 가져오기
      var drop = $('#aDrop'), inp = $('input[type=file]', drop);
      drop.onclick = function (e) { if (e.target !== inp) inp.click(); };
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); importFiles(e.dataTransfer.files); });
      inp.onchange = function () { importFiles(inp.files); };
      $('#sName').onchange = function (e) { cfg.companyName = e.target.value.trim() || cfg.companyName; saveCfg('회사명'); };
      $('#sOt').onchange = function (e) { cfg.overtimeBase = +e.target.value || 0; saveCfg('잔업 2회 기준 ' + cfg.overtimeBase); };
      $('#sMax').onchange = function (e) { cfg.leaveMax = +e.target.value || 25; saveCfg('연차 최대 ' + cfg.leaveMax); };
      $('#sStart').onchange = function (e) { cfg.leaveStartYear = +e.target.value || 0; saveCfg('연차제도 도입 ' + cfg.leaveStartYear); };
      $('#codeBody').addEventListener('change', function (e) {
        var tr = e.target.closest('tr[data-i]'), c = cfg.codes[+tr.dataset.i], f = e.target.dataset.f;
        if (!f) return;
        var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (f === 'day' || f === 'leave') v = +v;
        if (f === 'key') { v = v.toLowerCase(); if (v && (!/^[0-9a-z]$/.test(v) || v === 'j' || cfg.codes.some(function (x) { return x !== c && x.key === v; }))) { toast('단축키는 다른 코드와 겹치지 않는 숫자/영문 한 글자로 하세요 (J 제외).', true); e.target.value = c.key; return; } }
        if (f === 'name') { v = v.trim(); if (!v || cfg.codes.some(function (x) { return x !== c && x.name === v; })) { toast('코드 이름이 비었거나 겹칩니다.', true); e.target.value = c.name; return; } }
        c[f] = v; saveCfg('근태 코드 ' + c.name + ' ' + f); if (f === 'bg' || f === 'fg' || f === 'name') renderSettings();
      });
      $('#codeBody').addEventListener('click', function (e) {
        var b = e.target.closest('[data-cdel]'); if (!b) return;
        var c = cfg.codes[+b.dataset.cdel];
        confirmBox('코드 삭제', "'" + c.name + "' 코드를 삭제할까요?\n이미 입력된 기록은 남지만 색상과 집계 규칙이 사라집니다.", '삭제', true).then(function (ok) {
          if (!ok) return; cfg.codes.splice(+b.dataset.cdel, 1); saveCfg('근태 코드 ' + c.name + ' 삭제'); renderSettings();
        });
      });
      $('#sAddCode').onclick = function () {
        var n = 1; while (cfg.codes.some(function (c) { return c.name === '새코드' + n; })) n++;
        cfg.codes.push({ name: '새코드' + n, key: '', bg: '#E0E0E0', fg: '#000000', day: 1, holiday: false, leave: 0, _new: true });
        renderSettings();
      };
      $('#hPrev').onclick = function () { S.yearOf.hol = hy - 1; renderSettings(); };
      $('#hNext').onclick = function () { S.yearOf.hol = hy + 1; renderSettings(); };
      $('#hKeyShow').onclick = function () { var i = $('#hKey'); i.type = i.type === 'password' ? 'text' : 'password'; };
      $('#hKey').onchange = function (e) { cfg.holidayApiKey = e.target.value.trim(); saveCfg('공휴일 인증키'); };
      $('#hFetch').onclick = function () {
        cfg.holidayApiKey = $('#hKey').value.trim();
        if (!cfg.holidayApiKey) { toast('먼저 공공데이터포털 인증키를 넣어 주세요.', true); $('#hKey').focus(); return; }
        var b = $('#hFetch'); b.disabled = true; b.textContent = '받아오는 중…';
        App.api('POST', '/api/att/holidays/fetch', { key: cfg.holidayApiKey, year: hy }).then(function (r) {
          var res = mergeHolidays(hy, r.list);
          return saveCfg(hy + '년 공휴일 받아오기').then(function () {
            renderSettings();
            var lines = [res.added.length ? '추가: ' + res.added.join(', ') : '', res.removed.length ? '삭제: ' + res.removed.join(', ') : '', res.changed.length ? '이름 변경: ' + res.changed.join(', ') : ''].filter(Boolean);
            modal('<h2>' + hy + '년 공휴일을 받아왔습니다</h2><div class="sub" style="white-space:pre-line;line-height:1.7">' + esc(lines.length ? lines.join('\n') : '바뀐 내용이 없습니다. 이미 최신입니다.') + '</div><div class="mf"><button class="btn primary" id="hOk" autofocus>확인</button></div>');
            $('#hOk').onclick = closeModal;
          });
        }).catch(function (e) {
          b.disabled = false; b.textContent = hy + '년 공휴일 받아오기';
          modal('<h2>공휴일을 받아오지 못했습니다</h2><div class="sub" style="line-height:1.7">' + esc(e.message) + '</div><div class="mf"><button class="btn primary" id="hOk" autofocus>확인</button></div>');
          $('#hOk').onclick = closeModal;
        });
      };
      $('#hAdd').onclick = function () {
        var d = $('#hDate').value; if (!d || d.indexOf(hy + '-') !== 0) { toast(hy + '년 날짜를 고르세요.', true); return; }
        var k = d.slice(5), list = cfg.holidays[String(hy)] = cfg.holidays[String(hy)] || [];
        var ex = list.find(function (h) { return h[0] === k; });
        if (ex) ex[1] = $('#hName').value.trim() || ex[1]; else list.push([k, $('#hName').value.trim() || '휴무']);
        saveCfg('휴무일 추가 ' + d); renderSettings();
      };
      $$('[data-hdel]', view).forEach(function (b) {
        b.onclick = function () { cfg.holidays[String(hy)] = cfg.holidays[String(hy)].filter(function (h) { return h[0] !== b.dataset.hdel; }); saveCfg('휴무일 삭제 ' + hy + '-' + b.dataset.hdel); renderSettings(); };
      });
    }
    function importFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      // 직원 → 설정 → 연차 → 월 순서
      var rank = function (n) { return /employees/.test(n) ? 0 : /config/.test(n) ? 1 : /leave/.test(n) ? 2 : 3; };
      files.sort(function (a, b) { return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name); });
      App.confirm(files.length + '개 파일을 가져옵니다.\n' + files.map(function (f) { return f.name; }).slice(0, 15).join(', ') + (files.length > 15 ? ' …' : '') +
        '\n\n같은 달 근태와 같은 직원 정보는 가져온 내용으로 바뀝니다.', '가져오기').then(function (ok) {
        if (!ok) return;
        var rep = [];
        var p = Promise.resolve();
        files.forEach(function (f) {
          p = p.then(function () { return f.arrayBuffer(); }).then(function (buf) {
            return App.api('POST', '/api/att/import?name=' + encodeURIComponent(f.name), buf);
          }).then(function (r) { rep = rep.concat(r.report); afterWrite(r); });
        });
        p.then(function () {
          S.loaded = {}; S.cfg = null;
          modal('<h2>근태 자료를 가져왔습니다</h2><div class="sub" style="white-space:pre-line;line-height:1.7">' + esc(rep.join('\n')) + '</div><div class="mf"><button class="btn primary" id="iOk" autofocus>확인</button></div>');
          $('#iOk').onclick = function () { closeModal(); render(); };
        }).catch(function (e) { App.err(e); S.loaded = {}; S.cfg = null; render(); });
      });
    }

    // ================================================================ 시작 / 정리
    function onWinKey(e) {
      if (e.defaultPrevented || modalOpen() || S.tab !== 'month' || !$('#attGrid')) return;
      if (e.target && e.target.closest && e.target.closest('#attGrid')) return;
      var a = document.activeElement;
      if (a && (['INPUT', 'SELECT', 'TEXTAREA'].indexOf(a.tagName) >= 0 || a.isContentEditable || a.id === 'attGrid')) return;
      if (a && a !== document.body && !root.contains(a)) return;
      $('#attGrid').focus({ preventScroll: true }); gridKey(e);
    }
    window.addEventListener('keydown', onWinKey);
    render();
    return {
      destroy: function () {
        clearTimeout(S.saveTimer); if (S.queue.length) flushSave();
        window.removeEventListener('keydown', onWinKey); window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('beforeprint', onBeforePrint); window.removeEventListener('afterprint', onAfterPrint);
        document.removeEventListener('mousedown', onDocDown);
        if (dlg) dlg.close();
      }
    };
  };
})();
