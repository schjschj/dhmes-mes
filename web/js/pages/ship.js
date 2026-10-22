/* 출하관리 — 출하 준비 / 보류 현황 / 출고 현황
   생산실적이 제품의 출고처별로 '출하대기 재고'에 자동으로 쌓임. 수량은 R/L 로 저장, BOX·EA 는 제품 기준(박스단위·릴수량)으로 계산 */
App.pages.ship = function (root, args) {
  var tab = args.tab || 'prep';
  var esc = App.esc, fmt = App.fmt;
  var lv = App.curLevel || 0;
  var EPS = 1e-6;
  var DESTS = ['물류출고', '케이씨텍출고', '공영도금출고', '남동공장출고'];
  var REASONS = ['불량선별 대기', '발주 부족'];
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var holidays = {};

  if (!document.getElementById('shipCss')) {
    var css = document.createElement('style'); css.id = 'shipCss';
    css.textContent =
      '.sh .seg{display:inline-flex}.sh .seg .btn{border-radius:0;margin-left:-1px}.sh .seg .btn:first-child{border-radius:6px 0 0 6px;margin-left:0}.sh .seg .btn:last-child{border-radius:0 6px 6px 0}' +
      '.sh .seg .btn.on{background:var(--steel);border-color:var(--steel);color:#fff}' +
      '.sh .seg .btn .n{display:inline-block;min-width:16px;margin-left:5px;padding:0 4px;border-radius:8px;background:rgba(0,0,0,.08);font-size:11px}' +
      '.sh .seg .btn.on .n{background:rgba(255,255,255,.25)}' +
      '.sh-info{font-size:12px;color:var(--muted);margin:2px 0 8px}' +
      '.sh-tw{flex:1;min-height:0;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}' +
      '.sh-t{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}' +
      '.sh-t th{position:sticky;top:0;z-index:1;background:#f3f5f8;border-bottom:1px solid var(--line);padding:6px 6px;font-weight:600;white-space:nowrap;text-align:center}' +
      '.sh-t th.g1{background:#eef6ee}.sh-t th.g2{background:#fff6e5}' +
      '.sh-t td{border-bottom:1px solid var(--line-2);padding:4px 6px;white-space:nowrap}' +
      '.sh-t td.n{text-align:right;font-variant-numeric:tabular-nums}' +
      '.sh-t td.c{text-align:center}' +
      '.sh-t tfoot td{position:sticky;bottom:0;background:#f3f5f8;font-weight:700;border-top:1px solid var(--line)}' +
      '.sh-t input.input{height:26px;width:72px;text-align:right;padding:2px 6px}' +
      '.sh-t select.input{height:26px;font-size:12px;padding:0 4px}' +
      '.sh-t tr.neg td{color:var(--bad)}' +
      '.sh-t tr.zero td{color:var(--muted)}' +
      '.sh-t input.bad{border-color:var(--bad);background:#fff0f0}' +
      '.sh-t select.chg{border-color:#e0a000;background:#fff8e1}' +
      '.sh-t .u{color:var(--muted);font-size:11px;margin-left:3px}' +
      '.sh-dates{cursor:help;border-bottom:1px dotted var(--muted)}' +
      '.sh-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;margin-top:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}' +
      '.sh-bar .sum{color:var(--muted);font-size:12.5px}' +
      '.sh-day{font-size:12px;padding:2px 8px;border-radius:10px;background:#eef}' +
      '.sh-day.warn{background:var(--warn-bg);color:var(--warn);font-weight:700}' +
      '.sh-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}' +
      '.sh-chip{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:6px 10px;font-size:12.5px}' +
      '.sh-chip b{font-size:14px}' +
      '.sh-empty{padding:40px;text-align:center;color:var(--muted)}';
    document.head.appendChild(css);
  }

  // ---------------------------------------------------------------- 공통
  function boxOf(r, reels) { return r.box_reels > 0 ? reels / r.box_reels : null; }
  function eaOf(r, reels) { return r.reel_qty > 0 ? Math.round(reels * r.reel_qty) : null; }
  function n2(v) { return v === null || v === undefined ? '' : fmt(Math.round(v * 100) / 100, 2); }
  function n0(v) { return v === null || v === undefined ? '' : fmt(Math.round(v), 0); }
  function unitName(r) { return r.box_reels > 0 ? 'BOX' : 'R/L'; }
  function toReels(r, v) { v = Number(v); if (isNaN(v)) return NaN; return r.box_reels > 0 ? v * r.box_reels : v; }
  function fromReels(r, reels) { return r.box_reels > 0 ? reels / r.box_reels : reels; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function dayInfo(d) {
    if (!d) return { text: '', warn: false };
    var dt = new Date(d + 'T00:00:00');
    if (isNaN(dt)) return { text: '', warn: false };
    var w = dt.getDay(), h = holidays[d];
    var t = d.slice(5).replace('-', '/') + ' (' + WD[w] + ')' + (h ? ' ' + h : '');
    return { text: t, warn: w === 0 || w === 6 || !!h };
  }
  function nextDow(dow) {          // 다음 ○요일 (오늘 이후)
    var d = new Date(); d.setDate(d.getDate() + 1);
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
    return App.dstr(d);
  }
  function dateField(cls, val) {
    return '<input type="date" class="input ' + cls + '" value="' + esc(val) + '" style="width:140px">' +
      '<button type="button" class="btn small" data-dq="1">내일</button><button type="button" class="btn small" data-dq="sat">토</button><button type="button" class="btn small" data-dq="mon">월</button>' +
      '<span class="sh-day"></span>';
  }
  function wireDate(scope, sel) {
    var inp = scope.querySelector(sel), lab = inp.parentNode.querySelector('.sh-day') || scope.querySelector('.sh-day');
    function show() { var i = dayInfo(inp.value); lab.textContent = i.text + (i.warn ? ' 출고' : ''); lab.classList.toggle('warn', i.warn); }
    App.$$('[data-dq]', scope).forEach(function (b) {
      b.onclick = function () { inp.value = b.dataset.dq === '1' ? App.addDays(1) : nextDow(b.dataset.dq === 'sat' ? 6 : 1); show(); };
    });
    inp.addEventListener('change', show); inp.addEventListener('input', show);
    show();
    return inp;
  }
  function tabBtns(list, cur, counts) {
    return '<div class="seg" data-seg>' + list.map(function (d) {
      var n = counts && counts[d];
      return '<button class="btn' + (d === cur ? ' on' : '') + '" data-d="' + esc(d) + '">' + esc(d) + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function loadStock() {
    return App.get('/api/ship/stock').then(function (d) { holidays = d.holidays || {}; DESTS = d.dests; REASONS = d.reasons; return d; });
  }

  // 퀵 출고 창 (재고가 모자라도 나감)
  function quickDialog(stockRows, preset, done) {
    var dl = App.datalist('products');
    var body = App.h('<div><div class="form">' +
      '<label class="f"><span>제번<b>*</b></span><input class="input" data-k="code" list="' + dl + '"></label>' +
      '<div class="f"><span>재고</span><div data-info class="muted" style="padding-top:6px">제번을 입력하세요</div></div>' +
      '<label class="f"><span>수량 <span data-unit>BOX</span><b>*</b></span><input class="input" data-k="q" type="number" step="any" min="0"><small data-calc></small></label>' +
      '<label class="f"><span>출고처</span><select class="input" data-k="dest">' + DESTS.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('') + '</select></label>' +
      '<div class="f full"><span>출고일</span><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' + dateField('qd', App.today()) +
      '<input class="input" data-k="time" type="time" style="width:100px" value="' + new Date().toTimeString().slice(0, 5) + '"></div></div>' +
      '<label class="f full"><span>메모 (받는 곳 · 기사 등)</span><input class="input" data-k="memo" maxlength="200"></label>' +
      '</div><div class="muted" style="margin-top:6px">재고가 모자라도 나갑니다 (오늘 찍은 것을 실적 입력 전에 보내는 경우). 실적을 넣으면 맞춰집니다.</div></div>');
    var $ = function (s) { return body.querySelector(s); };
    var byCode = {};
    stockRows.forEach(function (r) { byCode[r.code.toLowerCase()] = r; });
    var cur = null, prodRow = null;
    function info() {
      var code = $('[data-k=code]').value.trim();
      cur = byCode[code.toLowerCase()] || null;
      var p = (App.cache.ref_products || []).filter(function (x) { return (x.code || '').toLowerCase() === code.toLowerCase(); })[0];
      prodRow = cur || (p ? { code: p.code, name: p.name, dest: p.ship_to || '물류출고', box_reels: +p.box_reels || 0, reel_qty: +p.reel_qty || 0, avail: 0, held: 0 } : null);
      if (!prodRow) { $('[data-info]').textContent = code ? '등록되지 않은 제번입니다' : '제번을 입력하세요'; return; }
      $('[data-info]').innerHTML = esc(prodRow.name) + '<br>출고 가능 <b>' + n2(fromReels(prodRow, prodRow.avail)) + '</b> ' + unitName(prodRow) +
        (prodRow.held > EPS ? ' · 보류 ' + n2(fromReels(prodRow, prodRow.held)) + ' ' + unitName(prodRow) : '');
      $('[data-unit]').textContent = unitName(prodRow);
      $('[data-k=dest]').value = prodRow.dest || '물류출고';
      calc();
    }
    function calc() {
      if (!prodRow) return;
      var reels = toReels(prodRow, $('[data-k=q]').value);
      $('[data-calc]').textContent = isNaN(reels) || !reels ? '' : '= ' + n2(reels) + ' R/L' + (prodRow.reel_qty ? ' · ' + n0(eaOf(prodRow, reels)) + ' EA' : '');
    }
    $('[data-k=code]').addEventListener('input', info);
    $('[data-k=code]').addEventListener('change', info);
    $('[data-k=q]').addEventListener('input', calc);
    App.refList('products');
    App.dialog({
      title: '퀵 출고', body: body, buttons: [{ label: '취소' }, {
        label: '출고', cls: 'primary', default: true, onClick: function (d) {
          if (!prodRow) { d.error('제번을 확인하세요.'); return; }
          var reels = toReels(prodRow, $('[data-k=q]').value);
          if (!(reels > 0)) { d.error('수량을 입력하세요.'); return; }
          d.busy(true);
          App.api('POST', '/api/ship/quick', {
            code: prodRow.code, reels: reels, dest: $('[data-k=dest]').value, ship_date: $('.qd').value,
            ship_time: $('[data-k=time]').value, memo: $('[data-k=memo]').value
          }).then(function () { d.close(); App.toast('퀵 출고했습니다.'); if (done) done(); })
            .catch(function (e) { d.busy(false); d.error(e.message); });
        }
      }]
    });
    wireDate(body, '.qd');
    if (preset) { $('[data-k=code]').value = preset; info(); }
  }

  // ================================================================ 출하 준비
  function prep() {
    var dest = App.store.get('ship_dest', DESTS[0]);
    var data = null, inp = {};
    root.innerHTML = '<div class="page-full sh">' +
      '<div class="toolbar"><span data-tabs></span>' +
      '<input class="input search" placeholder="제번 / 품명 검색" style="width:140px">' +
      (lv >= 2 ? '<button class="btn small" data-a="none" title="이 출고처의 출고 수량을 모두 0으로">출고 비우기</button><button class="btn small" data-a="all" title="이 출고처의 출고 수량을 모두 재고만큼">출고 채우기</button>' : '') +
      '<span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn" data-a="quick">퀵 출고</button>' : '') +
      (lv >= 3 ? '<button class="btn" data-a="adjust" title="실제 수량으로 재고 맞추기">재고 조정</button><button class="btn" data-a="start">재고 시작일</button>' : '') +
      '<button class="btn" data-a="reload">새로고침</button></div>' +
      '<div class="sh-info" data-info></div>' +
      '<div class="sh-tw" data-tw></div>' +
      (lv >= 2 ? '<div class="sh-bar" data-bar><b>출고일</b>' + dateField('sd', App.addDays(1)) +
        '<input class="input" data-memo placeholder="메모" style="width:180px" maxlength="200">' +
        '<span class="grow"></span><span class="sum" data-sum></span>' +
        '<button class="btn primary" data-a="confirm">출하 확정</button></div>' : '') +
      '</div>';
    var tw = root.querySelector('[data-tw]'), search = root.querySelector('.search');
    var sdInp = lv >= 2 ? wireDate(root.querySelector('[data-bar]'), '.sd') : null;

    function rowsOf(d) { return (data.rows || []).filter(function (r) { return r.dest === d; }); }
    function st(r) {
      var k = r.code.toLowerCase();
      if (!inp[k]) inp[k] = { out: null, hold: '', reason: REASONS[0], dest: r.dest, memo: '' };
      return inp[k];
    }
    function outReels(r) {        // 출고 수량 (릴)
      var s = st(r);
      var holdR = s.hold === '' ? 0 : toReels(r, s.hold) || 0;
      if (s.out === null) return Math.max(0, r.avail - holdR);      // 손대지 않았으면 남은 것 전부
      var v = toReels(r, s.out);
      return isNaN(v) ? 0 : v;
    }
    function holdReels(r) { var s = st(r); if (s.hold === '') return 0; var v = toReels(r, s.hold); return isNaN(v) ? 0 : v; }
    function bad(r) { return outReels(r) < -EPS || holdReels(r) < -EPS || outReels(r) + holdReels(r) > r.avail + 0.001; }

    function draw() {
      var counts = {};
      DESTS.forEach(function (d) { counts[d] = rowsOf(d).filter(function (r) { return r.avail > EPS; }).length; });
      root.querySelector('[data-tabs]').innerHTML = tabBtns(DESTS, dest, counts);
      root.querySelector('[data-info]').innerHTML = data.start
        ? '재고 시작일 <b>' + esc(data.start) + '</b> 이후 생산분이 생산실적에서 자동으로 쌓입니다. 출고 수량은 처음에 전부 채워져 있고, 덜 내보낼 것만 고치면 남은 것은 재고에 그대로 남습니다.'
        : '<span class="tag warn">재고 시작일이 없습니다</span> ' + (lv >= 3 ? '오른쪽 위 [재고 시작일]에서 정하세요.' : '"삭제까지" 권한이 있는 사람이 [재고 시작일]을 정해야 시작됩니다.');
      var q = (search.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      var rows = rowsOf(dest).filter(function (r) {
        var s = (r.code + ' ' + r.name).toLowerCase();
        return q.every(function (w) { return s.indexOf(w) >= 0; });
      });
      if (!rows.length) {
        tw.innerHTML = '<div class="sh-empty">' + esc(dest) + ' 재고가 없습니다.</div>';
        sum(); return;
      }
      var h = ['<table class="sh-t"><thead><tr>' +
        '<th rowspan="2">제번</th><th rowspan="2">품명</th><th rowspan="2">생산일</th>' +
        '<th colspan="3" class="g1">출고 가능 재고</th><th rowspan="2">보류 중</th>' +
        (lv >= 2 ? '<th colspan="4" class="g1">이번 출고</th><th colspan="2" class="g2">보류 걸기</th>' : '') +
        '</tr><tr><th class="g1">R/L</th><th class="g1">BOX</th><th class="g1">EA</th>' +
        (lv >= 2 ? '<th class="g1">수량</th><th class="g1">R/L</th><th class="g1">EA</th><th class="g1">출고처</th><th class="g2">수량</th><th class="g2">사유</th>' : '') +
        '</tr></thead><tbody>'];
      var T = { ar: 0, ab: 0, ae: 0, or: 0, ob: 0, oe: 0 };
      rows.forEach(function (r) {
        var s = st(r), o = outReels(r);
        var dates = r.dates || [];
        var dtxt = dates.length ? (dates[0][0].slice(5) + (dates.length > 1 ? ' ~ ' + dates[dates.length - 1][0].slice(5) + ' (' + dates.length + '일)' : '')) : '';
        var dtitle = dates.map(function (x) { return x[0] + '  ' + n2(x[1]) + ' R/L'; }).join('\n');
        T.ar += r.avail; T.ab += boxOf(r, r.avail) || 0; T.ae += eaOf(r, r.avail) || 0;
        if (lv >= 2) { T.or += o; T.ob += boxOf(r, o) || 0; T.oe += eaOf(r, o) || 0; }
        var cls = r.avail < -EPS ? 'neg' : (r.avail <= EPS ? 'zero' : '');
        h.push('<tr class="' + cls + '" data-c="' + esc(r.code.toLowerCase()) + '">' +
          '<td>' + esc(r.code) + (r.registered ? '' : ' <span class="tag bad" title="기준정보 > 제품에 없음">미등록</span>') + '</td>' +
          '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.name) + '">' + esc(r.name) + '</td>' +
          '<td class="c"><span class="sh-dates" title="' + esc(dtitle) + '">' + esc(dtxt) + '</span></td>' +
          '<td class="n">' + n2(r.avail) + '</td><td class="n">' + n2(boxOf(r, r.avail)) + '</td><td class="n">' + n0(eaOf(r, r.avail)) + '</td>' +
          '<td class="n">' + (r.held > EPS ? n2(fromReels(r, r.held)) + '<span class="u">' + unitName(r) + '</span>' : '') + '</td>' +
          (lv >= 2 ?
            '<td class="n"><input class="input' + (bad(r) ? ' bad' : '') + '" data-f="out" type="number" step="any" min="0" value="' + (s.out === null ? round2(fromReels(r, o)) : esc(s.out)) + '"><span class="u">' + unitName(r) + '</span></td>' +
            '<td class="n" data-o="r">' + n2(o) + '</td><td class="n" data-o="e">' + n0(eaOf(r, o)) + '</td>' +
            '<td><select class="input' + (s.dest !== r.dest ? ' chg' : '') + '" data-f="dest" title="이번만 다른 곳으로 보낼 때">' + DESTS.map(function (d) { return '<option' + (d === s.dest ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select></td>' +
            '<td class="n"><input class="input" data-f="hold" type="number" step="any" min="0" value="' + esc(s.hold) + '" placeholder="0"><span class="u">' + unitName(r) + '</span></td>' +
            '<td><select class="input" data-f="reason">' + REASONS.map(function (x) { return '<option' + (x === s.reason ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></td>'
            : '') + '</tr>');
      });
      h.push('</tbody><tfoot><tr><td colspan="3">합계 (' + rows.length + '품번)</td><td class="n">' + n2(T.ar) + '</td><td class="n">' + n2(T.ab) + '</td><td class="n">' + n0(T.ae) + '</td><td></td>' +
        (lv >= 2 ? '<td class="n" data-t="ob">' + n2(T.ob) + '</td><td class="n" data-t="or">' + n2(T.or) + '</td><td class="n" data-t="oe">' + n0(T.oe) + '</td><td colspan="3"></td>' : '') +
        '</tr></tfoot></table>');
      var stp = tw.scrollTop;
      tw.innerHTML = h.join('');
      tw.scrollTop = stp;
      sum();
    }
    function picks() {
      var items = [], holds = [];
      (data.rows || []).forEach(function (r) {
        var k = r.code.toLowerCase();
        if (!inp[k] && r.dest !== dest) return;
        if (r.dest !== dest) return;                   // 지금 보고 있는 출고처만 확정
        var s = st(r), o = outReels(r), hr = holdReels(r);
        if (o > EPS) items.push({ code: r.code, reels: Math.round(o * 10000) / 10000, dest: s.dest, row: r });
        if (hr > EPS) holds.push({ code: r.code, reels: Math.round(hr * 10000) / 10000, reason: s.reason, row: r });
      });
      return { items: items, holds: holds };
    }
    function sum() {
      var el = root.querySelector('[data-sum]');
      if (!el) return;
      var p = picks();
      var b = 0, e = 0;
      p.items.forEach(function (i) { b += boxOf(i.row, i.reels) || 0; e += eaOf(i.row, i.reels) || 0; });
      el.innerHTML = '출고 <b>' + p.items.length + '</b>품번 · ' + n2(b) + ' BOX · ' + n0(e) + ' EA' + (p.holds.length ? ' / 보류 <b>' + p.holds.length + '</b>품번' : '');
    }
    function refreshRow(tr) {
      var r = (data.rows || []).filter(function (x) { return x.code.toLowerCase() === tr.dataset.c; })[0];
      if (!r) return;
      var s = st(r), o = outReels(r);
      var outI = tr.querySelector('[data-f=out]');
      if (s.out === null && document.activeElement !== outI) outI.value = round2(fromReels(r, o));
      outI.classList.toggle('bad', bad(r));
      tr.querySelector('[data-o=r]').textContent = n2(o);
      tr.querySelector('[data-o=e]').innerHTML = n0(eaOf(r, o));
      tr.querySelector('[data-f=dest]').classList.toggle('chg', s.dest !== r.dest);
      var T = { ob: 0, or: 0, oe: 0 };
      rowsOf(dest).forEach(function (x) { var y = outReels(x); T.or += y; T.ob += boxOf(x, y) || 0; T.oe += eaOf(x, y) || 0; });
      var f = tw.querySelector('tfoot');
      if (f) { f.querySelector('[data-t=ob]').textContent = n2(T.ob); f.querySelector('[data-t=or]').textContent = n2(T.or); f.querySelector('[data-t=oe]').textContent = n0(T.oe); }
      sum();
    }
    tw.addEventListener('input', function (e) {
      var el = e.target, tr = el.closest('tr[data-c]');
      if (!tr || !el.dataset.f) return;
      var k = tr.dataset.c;
      var r = (data.rows || []).filter(function (x) { return x.code.toLowerCase() === k; })[0];
      var s = st(r);
      if (el.dataset.f === 'out') s.out = el.value;
      else if (el.dataset.f === 'hold') s.hold = el.value;
      refreshRow(tr);
    });
    tw.addEventListener('change', function (e) {
      var el = e.target, tr = el.closest('tr[data-c]');
      if (!tr) return;
      var r = (data.rows || []).filter(function (x) { return x.code.toLowerCase() === tr.dataset.c; })[0];
      if (el.dataset.f === 'dest') st(r).dest = el.value;
      if (el.dataset.f === 'reason') st(r).reason = el.value;
      refreshRow(tr);
    });
    tw.addEventListener('keydown', function (e) {       // Enter → 아래 칸
      if (e.key !== 'Enter' || !e.target.dataset.f || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      var all = App.$$('input[data-f="' + e.target.dataset.f + '"]', tw);
      var i = all.indexOf(e.target);
      if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select(); }
    });
    root.querySelector('[data-tabs]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      dest = b.dataset.d; App.store.set('ship_dest', dest); draw();
    });
    search.addEventListener('input', draw);

    function load() {
      return loadStock().then(function (d) {
        data = d;
        if (DESTS.indexOf(dest) < 0) dest = DESTS[0];
        // 재고가 바뀌었으니 손대지 않은 칸은 새 재고로
        Object.keys(inp).forEach(function (k) { if (inp[k].out === null && !inp[k].hold) delete inp[k]; });
        draw();
      }).catch(App.err);
    }
    root.querySelector('[data-a=reload]').onclick = function () { inp = {}; load(); };
    if (lv >= 2) {
      root.querySelector('[data-a=quick]').onclick = function () { quickDialog(data ? data.rows : [], '', load); };
      root.querySelector('[data-a=none]').onclick = function () { rowsOf(dest).forEach(function (r) { st(r).out = '0'; }); draw(); };
      root.querySelector('[data-a=all]').onclick = function () { rowsOf(dest).forEach(function (r) { st(r).out = null; }); draw(); };
      root.querySelector('[data-a=confirm]').onclick = function () {
        if (!data.start) { App.toast('재고 시작일을 먼저 정하세요.', 'bad'); return; }
        var p = picks();
        var wrong = rowsOf(dest).filter(bad);
        if (wrong.length) { App.toast('출고 + 보류가 재고보다 많은 줄이 있습니다: ' + wrong.map(function (r) { return r.code; }).join(', '), 'bad'); return; }
        if (!p.items.length && !p.holds.length) { App.toast('출고하거나 보류할 수량이 없습니다.', 'bad'); return; }
        var sd = sdInp.value;
        if (!sd) { App.toast('출고일을 넣으세요.', 'bad'); return; }
        var di = dayInfo(sd);
        var byDest = {};
        p.items.forEach(function (i) { var x = byDest[i.dest] = byDest[i.dest] || { n: 0, b: 0, e: 0 }; x.n++; x.b += boxOf(i.row, i.reels) || 0; x.e += eaOf(i.row, i.reels) || 0; });
        var msg = '출고일: ' + sd + ' ' + di.text.replace(/^\S+ /, '') + (di.warn ? '  ← 주말/휴일입니다' : '') + '\n\n' +
          Object.keys(byDest).map(function (d) { var x = byDest[d]; return '· ' + d + ': ' + x.n + '품번  ' + n2(x.b) + ' BOX  ' + n0(x.e) + ' EA'; }).join('\n') +
          (p.holds.length ? '\n\n보류: ' + p.holds.map(function (h) { return h.code + ' ' + n2(fromReels(h.row, h.reels)) + unitName(h.row) + '(' + h.reason + ')'; }).join(', ') : '') +
          '\n\n이대로 확정할까요?';
        App.confirm(msg, '출하 확정').then(function (ok) {
          if (!ok) return;
          App.api('POST', '/api/ship/confirm', {
            dest: dest, ship_date: sd, memo: root.querySelector('[data-memo]').value,
            items: p.items.map(function (i) { return { code: i.code, reels: i.reels, dest: i.dest }; }),
            holds: p.holds.map(function (h) { return { code: h.code, reels: h.reels, reason: h.reason }; })
          }).then(function () {
            App.toast('출하를 확정했습니다.');
            rowsOf(dest).forEach(function (r) { delete inp[r.code.toLowerCase()]; });
            root.querySelector('[data-memo]').value = '';
            load();
          }).catch(App.err);
        });
      };
    }
    if (lv >= 3) {
      root.querySelector('[data-a=start]').onclick = function () {
        var body = App.h('<div><label class="f"><span>이 날짜 생산분부터 출하대기 재고로 쌓기</span><input type="date" class="input" value="' + esc(data.start || App.today()) + '"></label>' +
          '<div class="muted" style="margin-top:8px;line-height:1.6">· 시작하는 날 이미 쌓여 있던 출하대기 물량은 [재고 조정]으로 넣으세요.<br>· 시작일을 바꾸면 그 날짜 기준으로 생산분이 다시 계산됩니다 (출고·보류 기록은 그대로).</div></div>');
        App.dialog({
          title: '재고 시작일', body: body, buttons: [{ label: '취소' }, {
            label: '저장', cls: 'primary', default: true, onClick: function (d) {
              App.api('PUT', '/api/ship/start', { date: body.querySelector('input').value }).then(function () { d.close(); App.toast('재고 시작일을 정했습니다.'); load(); }).catch(function (e) { d.error(e.message); });
            }
          }]
        });
      };
      root.querySelector('[data-a=adjust]').onclick = function () {
        var dl = App.datalist('products');
        var body = App.h('<div><div class="form">' +
          '<label class="f"><span>제번<b>*</b></span><input class="input" data-k="code" list="' + dl + '"></label>' +
          '<div class="f"><span>지금 재고 (보류 포함)</span><div data-cur class="muted" style="padding-top:6px"></div></div>' +
          '<label class="f"><span>실제 수량 <span data-unit>BOX</span><b>*</b></span><input class="input" data-k="q" type="number" step="any" min="0"><small data-calc></small></label>' +
          '<label class="f"><span>메모</span><input class="input" data-k="memo" placeholder="예: 시작 재고, 실사"></label></div></div>');
        var cur = null;
        function info() {
          var code = body.querySelector('[data-k=code]').value.trim().toLowerCase();
          var r = (data.rows || []).filter(function (x) { return x.code.toLowerCase() === code; })[0];
          var p = (App.cache.ref_products || []).filter(function (x) { return (x.code || '').toLowerCase() === code; })[0];
          cur = r || (p ? { code: p.code, box_reels: +p.box_reels || 0, reel_qty: +p.reel_qty || 0, total: 0 } : null);
          body.querySelector('[data-cur]').textContent = cur ? n2(fromReels(cur, cur.total)) + ' ' + unitName(cur) + ' (' + n2(cur.total) + ' R/L)' : '';
          if (cur) body.querySelector('[data-unit]').textContent = unitName(cur);
        }
        body.querySelector('[data-k=code]').addEventListener('input', info);
        App.refList('products');
        App.dialog({
          title: '재고 조정 (실제 수량으로 맞추기)', body: body, buttons: [{ label: '취소' }, {
            label: '맞추기', cls: 'primary', default: true, onClick: function (d) {
              if (!cur) { d.error('제번을 확인하세요.'); return; }
              var reels = toReels(cur, body.querySelector('[data-k=q]').value);
              if (isNaN(reels) || reels < 0 || body.querySelector('[data-k=q]').value === '') { d.error('실제 수량을 입력하세요.'); return; }
              App.api('POST', '/api/ship/adjust', { code: cur.code, reels: reels, memo: body.querySelector('[data-k=memo]').value })
                .then(function (r) { d.close(); App.toast(r.diff ? '재고를 맞췄습니다 (' + (r.diff > 0 ? '+' : '') + n2(r.diff) + ' R/L)' : '차이가 없습니다.'); load(); })
                .catch(function (e) { d.error(e.message); });
            }
          }]
        });
      };
    }
    load();
  }

  // ================================================================ 보류 현황
  function holdTab() {
    var reason = App.store.get('ship_hold_reason', '전체');
    root.innerHTML = '<div class="page-full sh">' +
      '<div class="toolbar"><span data-tabs></span>' +
      '<label class="chk"><input type="checkbox" data-all> 끝난 것도 보기</label>' +
      '<input class="input search" placeholder="제번 / 품명 / 메모 검색" style="width:170px">' +
      '<span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn primary" data-a="act">처리 (출고 · 선별 결과)</button><button class="btn" data-a="add">+ 보류 걸기</button>' : '') +
      (lv >= 3 ? '<button class="btn danger" data-a="del">잘못 건 보류 삭제</button>' : '') +
      '<button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
      '<div class="sh-chips" data-chips></div>' +
      '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var rows = [];
    function u(r, reels) { return n2(fromReels(r, reels)) + ' ' + unitName(r); }
    var grid = new App.Grid(root.querySelector('.gridbox'), {
      cols: [
        { k: 'hold_date', l: '보류일', w: 80, center: true },
        { k: 'days', l: '경과(일)', t: 'int', w: 50, fmt: function (v, r) { return r.closed ? '' : '<b style="color:' + (v >= 7 ? 'var(--bad)' : v >= 3 ? 'var(--warn)' : 'inherit') + '">' + v + '</b>'; } },
        { k: 'reason', l: '사유', w: 90, center: true, fmt: function (v) { return '<span class="tag ' + (v === '불량선별 대기' ? 'bad' : 'warn') + '">' + esc(v) + '</span>'; }, xval: function (r) { return r.reason; } },
        { k: 'code', l: '제번', w: 90 }, { k: 'name', l: '품명', w: 180 }, { k: 'dest', l: '출고처', w: 80 },
        { k: 'reels', l: '보류 수량', w: 75, num: true, fmt: function (v, r) { return u(r, v); }, xval: function (r) { return round2(fromReels(r, r.reels)); } },
        { k: 'remain', l: '남은 수량', w: 75, num: true, fmt: function (v, r) { return r.closed ? '<span class="muted">끝남</span>' : '<b>' + u(r, v) + '</b>'; }, xval: function (r) { return round2(fromReels(r, r.remain)); } },
        { k: 'remain_rl', l: '남은 R/L', w: 60, num: true, val: function (r) { return r.remain; }, fmt: function (v) { return n2(v); } },
        { k: 'remain_ea', l: '남은 EA', w: 70, num: true, val: function (r) { return eaOf(r, r.remain); }, fmt: function (v) { return n0(v); } },
        { k: 'acts_t', l: '처리 내역', w: 220, val: function (r) {
          return (r.acts || []).map(function (t) {
            return { out: '출고' + (t.quick ? '(퀵)' : ''), defect: '불량', release: '재고로' }[t.kind] + ' ' + n2(fromReels(r, t.reels)) + ' (' + (t.ship_date || '').slice(5) + ')';
          }).join(', ');
        } },
        { k: 'memo', l: '메모', w: 120 }, { k: 'created_by', l: '등록', w: 60 }
      ], key: 'id', sort: { k: 'hold_date', dir: 1 }, hint: '두 번 클릭하면 처리',
      extraFilter: function (r) { return reason === '전체' || r.reason === reason; },
      rowClass: function (r) { return r.closed ? 'r-dim' : ''; },
      onDbl: function (r) { if (lv >= 2 && !r.closed) act(r); }
    });
    var search = root.querySelector('.search');
    search.addEventListener('input', function () { grid.setFilter(search.value); });
    function drawTabs() {
      var open = rows.filter(function (r) { return !r.closed; });
      var cnt = { '전체': open.length };
      REASONS.forEach(function (x) { cnt[x] = open.filter(function (r) { return r.reason === x; }).length; });
      root.querySelector('[data-tabs]').innerHTML = tabBtns(['전체'].concat(REASONS), reason, cnt);
      root.querySelector('[data-chips]').innerHTML = REASONS.map(function (x) {
        var rs = open.filter(function (r) { return r.reason === x; });
        var b = 0, e = 0, old = 0;
        rs.forEach(function (r) { b += boxOf(r, r.remain) || 0; e += eaOf(r, r.remain) || 0; old = Math.max(old, r.days || 0); });
        return '<div class="sh-chip">' + esc(x) + ' <b>' + rs.length + '</b>건 · ' + n2(b) + ' BOX · ' + n0(e) + ' EA' + (rs.length ? ' · 가장 오래된 것 ' + old + '일째' : '') + '</div>';
      }).join('');
    }
    root.querySelector('[data-tabs]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      reason = b.dataset.d; App.store.set('ship_hold_reason', reason); drawTabs(); grid.render();
    });
    function load() {
      var all = root.querySelector('[data-all]').checked;
      return App.get('/api/ship/holds' + (all ? '?all=1' : '')).then(function (d) {
        DESTS = d.dests; REASONS = d.reasons;
        rows = d.rows; drawTabs(); grid.setRows(rows);
      }).catch(App.err);
    }
    root.querySelector('[data-all]').onchange = load;
    function act(r) {
      var isSort = r.reason === '불량선별 대기';
      var un = unitName(r);
      var body = App.h('<div>' +
        '<div style="margin-bottom:10px"><b>' + esc(r.code) + '</b> ' + esc(r.name) + '<br><span class="muted">' + esc(r.reason) + ' · ' + esc(r.hold_date) + ' 보류 · 남은 수량 </span><b>' + u(r, r.remain) + '</b> <span class="muted">(' + n2(r.remain) + ' R/L)</span></div>' +
        '<div class="form">' +
        '<label class="f"><span>' + (isSort ? '양품' : '풀 수량') + ' ' + un + '</span><input class="input" data-k="good" type="number" step="any" min="0" value="' + round2(fromReels(r, r.remain)) + '"></label>' +
        (isSort ? '<label class="f"><span>선별 불량 ' + un + '</span><input class="input" data-k="bad" type="number" step="any" min="0" value="0"></label>' : '<div class="f"></div>') +
        '<div class="f full"><span>' + (isSort ? '양품은' : '푼 수량은') + '</span><div class="chkrow">' +
        '<label class="chk"><input type="radio" name="gto" value="stock"' + (isSort ? ' checked' : '') + '> 재고로 되돌리기 (다음 출하 때 같이 나감)</label>' +
        '<label class="chk"><input type="radio" name="gto" value="out"' + (isSort ? '' : ' checked') + '> 바로 출고</label></div></div>' +
        '<div class="f full" data-outbox><span>출고일</span><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' + dateField('hd', App.today()) +
        '<select class="input" data-k="dest" style="width:130px">' + DESTS.map(function (d) { return '<option' + (d === r.dest ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
        '<label class="chk"><input type="checkbox" data-k="quick"> 퀵</label></div></div>' +
        '<label class="f full"><span>메모</span><input class="input" data-k="memo" maxlength="200"></label>' +
        '</div><div class="muted" data-left style="margin-top:6px"></div></div>');
      var $ = function (s) { return body.querySelector(s); };
      function upd() {
        var out = body.querySelector('input[name=gto]:checked').value === 'out';
        $('[data-outbox]').style.display = out ? '' : 'none';
        var g = toReels(r, $('[data-k=good]').value || 0), b = isSort ? toReels(r, $('[data-k=bad]').value || 0) : 0;
        var left = r.remain - (g || 0) - (b || 0);
        $('[data-left]').textContent = left < -0.001 ? '남은 수량보다 많습니다.' : left > 0.001 ? '처리 후 보류에 ' + u(r, left) + ' 남음' : '처리하면 이 보류는 끝납니다.';
      }
      body.addEventListener('input', upd); body.addEventListener('change', upd);
      App.dialog({
        title: '보류 처리', body: body, buttons: [{ label: '취소' }, {
          label: '처리', cls: 'primary', default: true, onClick: function (d) {
            var g = toReels(r, $('[data-k=good]').value || 0), b = isSort ? toReels(r, $('[data-k=bad]').value || 0) : 0;
            if (isNaN(g) || isNaN(b) || g < 0 || b < 0 || g + b <= 0) { d.error('수량을 입력하세요.'); return; }
            if (g + b > r.remain + 0.001) { d.error('남은 수량보다 많습니다.'); return; }
            if (g > r.remain - b - 0.001 && g > r.remain - b) g = r.remain - b;     // 반올림 차이는 남은 것 전부로
            var out = body.querySelector('input[name=gto]:checked').value === 'out';
            d.busy(true);
            App.api('POST', '/api/ship/holds/' + r.id, {
              good: Math.max(0, g), bad: b, good_to: out ? 'out' : 'stock', ship_date: $('.hd').value, dest: $('[data-k=dest]').value,
              quick: $('[data-k=quick]').checked, memo: $('[data-k=memo]').value
            }).then(function () { d.close(); App.toast('처리했습니다.'); load(); }).catch(function (e) { d.busy(false); d.error(e.message); });
          }
        }]
      });
      wireDate(body, '.hd');
      upd();
    }
    if (lv >= 2) {
      root.querySelector('[data-a=act]').onclick = function () {
        var r = grid.selected();
        if (!r) { App.toast('처리할 보류를 고르세요.', 'bad'); return; }
        if (r.closed) { App.toast('이미 끝난 보류입니다.', 'bad'); return; }
        act(r);
      };
      root.querySelector('[data-a=add]').onclick = function () {
        loadStock().then(function (sd) {
          var dl = App.datalist('products');
          var body = App.h('<div><div class="form">' +
            '<label class="f"><span>제번<b>*</b></span><input class="input" data-k="code" list="' + dl + '"></label>' +
            '<div class="f"><span>출고 가능</span><div data-info class="muted" style="padding-top:6px"></div></div>' +
            '<label class="f"><span>보류 수량 <span data-unit>BOX</span><b>*</b></span><input class="input" data-k="q" type="number" step="any" min="0"></label>' +
            '<label class="f"><span>사유</span><select class="input" data-k="reason">' + REASONS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label>' +
            '<label class="f full"><span>메모</span><input class="input" data-k="memo" maxlength="200"></label></div></div>');
          var cur = null;
          body.querySelector('[data-k=code]').addEventListener('input', function () {
            var c = this.value.trim().toLowerCase();
            cur = sd.rows.filter(function (x) { return x.code.toLowerCase() === c; })[0] || null;
            body.querySelector('[data-info]').textContent = cur ? n2(fromReels(cur, cur.avail)) + ' ' + unitName(cur) : (c ? '재고가 없습니다' : '');
            if (cur) body.querySelector('[data-unit]').textContent = unitName(cur);
          });
          App.dialog({
            title: '보류 걸기', body: body, buttons: [{ label: '취소' }, {
              label: '보류', cls: 'primary', default: true, onClick: function (d) {
                if (!cur) { d.error('재고가 있는 제번을 입력하세요.'); return; }
                var reels = toReels(cur, body.querySelector('[data-k=q]').value);
                if (!(reels > 0)) { d.error('수량을 입력하세요.'); return; }
                App.api('POST', '/api/ship/holds', { code: cur.code, reels: reels, reason: body.querySelector('[data-k=reason]').value, memo: body.querySelector('[data-k=memo]').value })
                  .then(function () { d.close(); App.toast('보류했습니다.'); load(); }).catch(function (e) { d.error(e.message); });
              }
            }]
          });
        }).catch(App.err);
      };
    }
    if (lv >= 3) {
      root.querySelector('[data-a=del]').onclick = function () {
        var r = grid.selected();
        if (!r) { App.toast('지울 보류를 고르세요.', 'bad'); return; }
        App.confirm(r.code + ' ' + r.reason + ' 보류를 지울까요?\n(처리한 기록이 없는 보류만 지울 수 있습니다. 보류했던 수량은 출고 가능 재고로 돌아갑니다)', '삭제', true).then(function (ok) {
          if (ok) App.api('DELETE', '/api/ship/holds/' + r.id).then(function () { App.toast('지웠습니다.'); load(); }).catch(App.err);
        });
      };
    }
    root.querySelector('[data-a=xlsx]').onclick = function () { App.exportXlsx('출하보류_' + App.stamp() + '.xlsx', [grid.sheet('출하 보류')]); };
    loadStock().then(load);
  }

  // ================================================================ 출고 현황
  function listTab() {
    var dsel = App.store.get('ship_list_dest', '전체');
    var KIND = { out: '출고', defect: '선별 불량', adjust: '재고 조정', release: '보류→재고' };
    root.innerHTML = '<div class="page-full sh">' +
      '<div class="toolbar">' +
      '<input type="date" class="input" data-f="d1"> ~ <input type="date" class="input" data-f="d2">' +
      '<button class="btn small" data-p="today">오늘</button><button class="btn small" data-p="month">이번 달</button><button class="btn small" data-p="prev">지난 달</button>' +
      '<span data-tabs></span>' +
      '<select class="input" data-f="kind" style="width:120px"><option value="out">출고</option><option value="defect">선별 불량</option><option value="adjust">재고 조정</option><option value="out,defect,adjust,release">전부</option></select>' +
      '<label class="chk"><input type="checkbox" data-f="quick"> 퀵만</label>' +
      '<input class="input search" placeholder="제번 / 품명 / 메모 검색" style="width:150px">' +
      '<span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn" data-a="date">출고일 수정</button>' : '') +
      (lv >= 3 ? '<button class="btn danger" data-a="del">출고 취소</button>' : '') +
      '<button class="btn" data-a="print">인쇄</button><button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
      '<div class="sh-chips" data-chips></div>' +
      '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var rows = [];
    var d1 = root.querySelector('[data-f=d1]'), d2 = root.querySelector('[data-f=d2]'), kindSel = root.querySelector('[data-f=kind]'), quickChk = root.querySelector('[data-f=quick]');
    var today = App.today();
    function monthEnd() { var t = new Date(); return App.dstr(new Date(t.getFullYear(), t.getMonth() + 1, 0)); }
    d1.value = today.slice(0, 8) + '01'; d2.value = monthEnd();     // 미리 잡아 둔 출고일(내일·월요일)도 보이게 달 끝까지
    function typeOf(r) {
      if (r.kind !== 'out') return KIND[r.kind];
      return r.quick ? '퀵' : (r.hold_id ? '보류분' : '정기');
    }
    var grid = new App.Grid(root.querySelector('.gridbox'), {
      cols: [
        { k: 'ship_date', l: '출고일', w: 80, center: true, fmt: function (v) { var i = dayInfo(v); return esc(v) + (i.warn ? ' <span class="tag warn">' + esc(i.text.replace(/^\S+ /, '').replace(/[()]/g, '')) + '</span>' : ''); }, xval: function (r) { return r.ship_date; } },
        { k: 'ship_time', l: '시간', w: 45, center: true },
        { k: 'dest', l: '출고처', w: 85 },
        { k: 'type', l: '구분', w: 60, center: true, val: typeOf, fmt: function (v) { return '<span class="tag ' + ({ '퀵': 'bad', '보류분': 'warn', '정기': 'gray', '선별 불량': 'bad' }[v] || '') + '">' + esc(v) + '</span>'; }, xval: typeOf },
        { k: 'code', l: '제번', w: 90 }, { k: 'name', l: '품명', w: 180 },
        { k: 'reels', l: 'R/L', t: 'num', w: 55, fmt: function (v) { return n2(v); } },
        { k: 'box', l: 'BOX', t: 'num', w: 55, fmt: function (v) { return n2(v); } },
        { k: 'ea', l: 'EA', t: 'num', w: 75, fmt: function (v) { return n0(v); } },
        { k: 'memo', l: '메모', w: 140, val: function (r) { return [r.hold_reason, r.memo, r.batch_memo].filter(Boolean).join(' · '); } },
        { k: 'created_by', l: '처리', w: 60 }, { k: 'created', l: '처리 시각', w: 115 }
      ], key: 'id', hint: '',
      extraFilter: function (r) { return (dsel === '전체' || r.dest === dsel || r.kind !== 'out') && (!quickChk.checked || r.quick); },
      onRender: chips
    });
    var search = root.querySelector('.search');
    search.addEventListener('input', function () { grid.setFilter(search.value); });
    function chips(view) {
      var out = view.filter(function (r) { return r.kind === 'out'; });
      var by = {};
      out.forEach(function (r) { var x = by[r.dest] = by[r.dest] || { b: 0, e: 0, q: 0, n: 0 }; x.b += r.box || 0; x.e += r.ea || 0; x.n++; if (r.quick) x.q++; });
      var tb = 0, te = 0;
      var h = DESTS.filter(function (d) { return by[d]; }).map(function (d) {
        var x = by[d]; tb += x.b; te += x.e;
        return '<div class="sh-chip">' + esc(d) + ' <b>' + n2(x.b) + '</b> BOX · ' + n0(x.e) + ' EA' + (x.q ? ' · 퀵 ' + x.q + '건' : '') + '</div>';
      });
      if (h.length > 1) h.push('<div class="sh-chip">합계 <b>' + n2(tb) + '</b> BOX · ' + n0(te) + ' EA</div>');
      root.querySelector('[data-chips]').innerHTML = h.join('');
    }
    function drawTabs() {
      root.querySelector('[data-tabs]').innerHTML = tabBtns(['전체'].concat(DESTS), dsel);
    }
    root.querySelector('[data-tabs]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      dsel = b.dataset.d; App.store.set('ship_list_dest', dsel); drawTabs(); grid.render();
    });
    function load() {
      return App.get('/api/ship/list?d1=' + d1.value + '&d2=' + d2.value + '&kinds=' + kindSel.value).then(function (d) {
        DESTS = d.dests; rows = d.rows; drawTabs(); grid.setRows(rows);
      }).catch(App.err);
    }
    App.$$('[data-p]', root).forEach(function (b) {
      b.onclick = function () {
        var t = new Date();
        if (b.dataset.p === 'today') { d1.value = d2.value = App.today(); }
        else if (b.dataset.p === 'month') { d1.value = App.today().slice(0, 8) + '01'; d2.value = monthEnd(); }
        else { var a = new Date(t.getFullYear(), t.getMonth() - 1, 1), z = new Date(t.getFullYear(), t.getMonth(), 0); d1.value = App.dstr(a); d2.value = App.dstr(z); }
        load();
      };
    });
    d1.onchange = load; d2.onchange = load; kindSel.onchange = load; quickChk.onchange = function () { grid.render(); };
    if (lv >= 2) {
      root.querySelector('[data-a=date]').onclick = function () {
        var r = grid.selected();
        if (!r || r.kind !== 'out') { App.toast('출고 줄을 고르세요.', 'bad'); return; }
        var same = r.batch_id ? rows.filter(function (x) { return x.batch_id === r.batch_id && x.kind === 'out'; }).length : 1;
        var body = App.h('<div><div style="margin-bottom:8px">' + (r.batch_id ? '같이 확정한 출고 <b>' + same + '줄</b>의 출고일을 같이 바꿉니다.' : esc(r.code) + ' 한 줄의 출고일을 바꿉니다.') + '</div>' +
          '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' + dateField('ed', r.ship_date) + '</div>' +
          (r.batch_id ? '<label class="chk" style="margin-top:8px"><input type="checkbox" data-one> 이 줄만 바꾸기</label>' : '') + '</div>');
        App.dialog({
          title: '출고일 수정', body: body, buttons: [{ label: '취소' }, {
            label: '저장', cls: 'primary', default: true, onClick: function (d) {
              var one = body.querySelector('[data-one]');
              App.api('PUT', '/api/ship/tx/' + r.id, { ship_date: body.querySelector('.ed').value, whole: !(one && one.checked) })
                .then(function () { d.close(); App.toast('출고일을 바꿨습니다.'); load(); }).catch(function (e) { d.error(e.message); });
            }
          }]
        });
        wireDate(body, '.ed');
      };
    }
    if (lv >= 3) {
      root.querySelector('[data-a=del]').onclick = function () {
        var r = grid.selected();
        if (!r) { App.toast('취소할 줄을 고르세요.', 'bad'); return; }
        var same = r.batch_id ? rows.filter(function (x) { return x.batch_id === r.batch_id; }).length : 1;
        var body = App.h('<div style="line-height:1.7">' + esc(r.ship_date) + ' ' + esc(r.code) + ' ' + esc(typeOf(r)) + ' ' + n2(r.box) + ' BOX 를 취소합니다.<br>' +
          (r.batch_id ? '<label class="chk"><input type="radio" name="wh" value="1" checked> 같이 확정한 출하 전체 취소 (' + same + '줄 + 그때 건 보류)</label><br><label class="chk"><input type="radio" name="wh" value="0"> 이 줄만 취소</label><br>' : '') +
          '<span class="muted">취소한 수량은 재고로 돌아갑니다.</span></div>');
        App.dialog({
          title: '출고 취소', body: body, buttons: [{ label: '닫기' }, {
            label: '취소하기', cls: 'primary danger', onClick: function (d) {
              var w = body.querySelector('input[name=wh]:checked');
              App.api('DELETE', '/api/ship/tx/' + r.id + (w && w.value === '0' ? '?whole=0' : '')).then(function () { d.close(); App.toast('취소했습니다.'); load(); }).catch(function (e) { d.error(e.message); });
            }
          }]
        });
      };
    }
    root.querySelector('[data-a=xlsx]').onclick = function () { App.exportXlsx('출고현황_' + d1.value + '_' + d2.value + '.xlsx', [grid.sheet('출고 현황')]); };
    root.querySelector('[data-a=print]').onclick = function () {
      var view = grid.view.filter(function (r) { return r.kind === 'out'; });
      if (!view.length) { App.toast('인쇄할 출고가 없습니다.', 'bad'); return; }
      var groups = {};
      view.forEach(function (r) { var k = r.ship_date + '|' + r.dest; (groups[k] = groups[k] || []).push(r); });
      var h = [];
      Object.keys(groups).sort().forEach(function (k) {
        var p = k.split('|'), rs = groups[k], b = 0, e = 0, rl = 0;
        rs.sort(function (a, c) { return a.code.localeCompare(c.code); });
        h.push('<div class="pg"><h2>출고 목록 — ' + esc(p[1]) + '</h2><div class="sub">출고일 ' + esc(p[0]) + ' ' + esc(dayInfo(p[0]).text.replace(/^\S+ /, '')) + ' · ' + esc((App.meta && App.meta.company) || '대흥공업') + '</div>' +
          '<table><thead><tr><th>No</th><th>제번</th><th>품명</th><th>R/L</th><th>BOX</th><th>EA</th><th>구분</th><th>비고</th><th>확인</th></tr></thead><tbody>' +
          rs.map(function (r, i) {
            rl += r.reels || 0; b += r.box || 0; e += r.ea || 0;
            return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td class="n">' + n2(r.reels) + '</td><td class="n">' + n2(r.box) + '</td><td class="n">' + n0(r.ea) + '</td><td class="c">' + esc(typeOf(r)) + '</td><td>' + esc([r.memo].filter(Boolean).join(' ')) + '</td><td></td></tr>';
          }).join('') +
          '</tbody><tfoot><tr><td colspan="3">합계 ' + rs.length + '품번</td><td class="n">' + n2(rl) + '</td><td class="n">' + n2(b) + '</td><td class="n">' + n0(e) + '</td><td colspan="3"></td></tr></tfoot></table>' +
          '<div class="sign"><span>출고 담당</span><span>운송</span><span>확인</span></div></div>');
      });
      var doc = '<!doctype html><html><head><meta charset="utf-8"><title>출고 목록</title><style>' +
        '@page{size:A4 portrait;margin:12mm}body{font-family:"Malgun Gothic",sans-serif;font-size:11pt;color:#000}' +
        '.pg{page-break-after:always}.pg:last-child{page-break-after:auto}h2{margin:0 0 4px;font-size:16pt}.sub{margin-bottom:8px;font-size:10pt}' +
        'table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:4px 5px;font-size:10pt}th{background:#eee}td.n{text-align:right}td.c{text-align:center}tfoot td{font-weight:700;background:#f5f5f5}' +
        '.sign{display:flex;justify-content:flex-end;gap:0;margin-top:14px}.sign span{display:inline-block;width:90px;height:56px;border:1px solid #444;margin-left:-1px;text-align:center;font-size:9pt;padding-top:3px}' +
        '</style></head><body>' + h.join('') + '</body></html>';
      var fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(fr);
      fr.contentDocument.open(); fr.contentDocument.write(doc); fr.contentDocument.close();
      setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 2000); }, 300);
    };
    loadStock().then(load);
  }

  if (tab === 'hold') holdTab();
  else if (tab === 'list') listTab();
  else loadStock().then(prep).catch(function (e) { App.err(e); prep(); });
};
