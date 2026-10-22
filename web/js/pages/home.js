/* 대시보드: 오늘 챙겨야 할 것만 (권한 있는 것만 보임)
   위: 금형 정비 알람 / 이번 달 생산량 / 이번 달 OEE / 오늘 출근
   왼쪽: 이번 달 일별 생산량, 최근 생산일 설비별 현황
   오른쪽: 오늘 작업지시서, 오늘 근태, 이번 달 공정불량, 한줄 메모(코멘트) */
App.pages.home = function (root) {
  var fmt = App.fmt, esc = App.esc;
  var pct = function (v, d) { return v === null || v === undefined ? '-' : (v * 100).toFixed(d === undefined ? 1 : d) + '%'; };
  root.innerHTML = '<div class="kpis" data-kpis></div><div class="dash home2"><div class="col" data-left></div><div class="col col-r"><div class="col" data-right></div>' +
    '<div class="panel memo-panel" data-memo><div class="panel-h">한줄 메모 <span class="muted" style="font-weight:400" data-mcount></span><span class="grow"></span>' +
    '<button class="btn small" data-mall>메모 전체 보기</button></div>' +
    '<form class="memo-in" data-mform><input class="input" maxlength="300" placeholder="메모를 입력하고 Enter (전달사항, 특이사항 …)"><button class="btn primary small">등록</button></form>' +
    '<div class="memo-list" data-mlist></div></div></div></div>';

  function kpi(go, label, v, cls, sub, raw) {
    return '<div class="kpi ' + (cls || '') + '"' + (go ? ' data-go="' + go + '"' : '') + '><div class="k-l">' + label + '</div><div class="k-v">' + (raw ? v : fmt(v)) + '</div><div class="k-s">' + sub + '</div></div>';
  }
  function panel(title, go, goLabel, body, extra) {
    return '<div class="panel"><div class="panel-h">' + title + '<span class="grow"></span>' + (extra || '') +
      (go ? '<button class="btn small" data-go="' + go + '">' + (goLabel || '열기') + '</button>' : '') + '</div><div class="panel-b2">' + body + '</div></div>';
  }
  function oeeCls(v) { return v === null || v === undefined ? '' : v < 0.6 ? 'bad-t' : v < 0.8 ? 'warn-t' : ''; }

  // ---------------------------------------------------------------- 일별 생산량 막대 (마우스를 올리면 값)
  function dayChart(p) {
    var d1 = new Date(p.days.length ? p.days[0].date : App.today()), y = d1.getFullYear(), m = d1.getMonth();
    var n = new Date(y, m + 1, 0).getDate(), by = {};
    p.days.forEach(function (d) { by[+d.date.slice(8, 10)] = d; });
    var max = Math.max.apply(null, p.days.map(function (d) { return d.qty; }).concat([1]));
    var avgPrev = p.prev_month_days ? p.prev_month_qty / p.prev_month_days : 0;
    max = Math.max(max, avgPrev) * 1.08;
    var W = 640, H = 170, L = 6, B = 20, T = 8, bw = (W - L * 2) / n;
    var yv = function (v) { return T + (H - T - B) * (1 - v / max); };
    var s = '<svg class="dchart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    for (var i = 1; i <= n; i++) {
      var dow = new Date(y, m, i).getDay(), x = L + (i - 1) * bw, d = by[i];
      if (dow === 0 || dow === 6) s += '<rect x="' + x + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" class="we"/>';
      if (d && d.qty > 0) {
        var top = yv(d.qty), h = H - B - top, w = Math.max(2, bw - 3);
        s += '<path class="bar" d="M' + (x + 1.5) + ',' + (H - B) + 'v' + (-(h - 3)) + 'q0,-3 3,-3h' + (w - 6) + 'q3,0 3,3v' + (h - 3) + 'z"/>';
      }
      s += '<rect class="hit" x="' + x + '" y="' + T + '" width="' + bw + '" height="' + (H - T) + '" data-i="' + i + '"/>';
      if (i === 1 || i % 5 === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" class="ax">' + i + '</text>';
    }
    if (avgPrev) s += '<line x1="' + L + '" x2="' + (W - L) + '" y1="' + yv(avgPrev) + '" y2="' + yv(avgPrev) + '" class="ref"/>';
    s += '<line x1="' + L + '" x2="' + (W - L) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" class="base"/></svg>';
    return '<div class="dchart-wrap" data-chart>' + s + '<div class="dtip" hidden></div></div>' +
      '<div class="dchart-leg"><span><i class="sw-bar"></i>일별 생산량 (EA)</span>' + (avgPrev ? '<span><i class="sw-ref"></i>지난달 하루 평균 ' + fmt(Math.round(avgPrev)) + '</span>' : '') +
      '<span class="muted">막대에 마우스를 올리면 수량·OEE</span></div>';
  }
  function bindChart(p) {
    var w = root.querySelector('[data-chart]'); if (!w) return;
    var tip = w.querySelector('.dtip'), by = {};
    p.days.forEach(function (d) { by[+d.date.slice(8, 10)] = d; });
    w.addEventListener('mousemove', function (e) {
      var r = e.target.closest('[data-i]');
      if (!r) { tip.hidden = true; return; }
      var i = +r.dataset.i, d = by[i], dt = new Date(p.days.length ? p.days[0].date : App.today());
      dt.setDate(i);
      tip.innerHTML = '<b>' + (dt.getMonth() + 1) + '/' + i + ' (' + '일월화수목금토'[dt.getDay()] + ')</b><br>' + (d ? fmt(d.qty) + ' EA · OEE ' + pct(d.oee) : '생산 없음');
      tip.hidden = false;
      var b = w.getBoundingClientRect();
      tip.style.left = Math.min(b.width - 150, Math.max(0, e.clientX - b.left + 10)) + 'px';
      tip.style.top = Math.max(0, e.clientY - b.top - 46) + 'px';
    });
    w.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  function render(d) {
    var k = [], L = [], R = [];
    // ---------- 위 숫자
    if (d.mold) k.push(kpi('mold_status', '금형 정비 알람 (초과·2차)', d.mold.bad, d.mold.bad ? 'bad' : '', '1차 알람 ' + d.mold.warn + '개'));
    if (d.prod) {
      var p = d.prod, diff = p.prev_same_qty ? (p.month_qty / p.prev_same_qty - 1) : null;
      k.push(kpi('month_report', '이번 달 생산량 (EA)', p.month_qty, '',
        (diff === null ? '' : '지난달 같은 기간보다 <b class="' + (diff < 0 ? 'bad-t' : 'ok-t') + '">' + (diff < 0 ? '▼ ' : '▲ ') + Math.abs(diff * 100).toFixed(1) + '%</b> · ') + '생산일 ' + p.month_days + '일'));
      var lastDay = p.days.length ? p.days[p.days.length - 1] : null;
      k.push(kpi('prod_equip', '이번 달 OEE', pct(p.month_oee), oeeCls(p.month_oee) === 'bad-t' ? 'bad' : '',
        lastDay ? '최근 ' + lastDay.date.slice(5) + ' OEE ' + pct(lastDay.oee) + ' · ' + fmt(lastDay.qty) + ' EA' : '이번 달 실적 없음', true));
    }
    if (d.att) {
      var a = d.att, absent = a.codes.filter(function (c) { return !/특근|야특|잔업/.test(c.code); }).reduce(function (s, c) { return s + c.names.length; }, 0);
      k.push(kpi('att_month', '오늘 출근 (근태)', a.off ? a.present + '명' : a.present + ' / ' + a.total, '',
        a.off ? (a.holiday || '휴무일') + ' — 특근·야특 입력 인원' : '월차·결근 등 ' + absent + '명', true));
    } else if (d.defect) {
      k.push(kpi('defects', '이번 달 공정불량 (EA)', d.defect.qty, '', d.defect.n + '건 등록'));
    }
    root.querySelector('[data-kpis]').innerHTML = k.join('');
    root.querySelector('[data-kpis]').style.gridTemplateColumns = 'repeat(' + Math.max(1, k.length) + ', minmax(0, 1fr))';

    // ---------- 왼쪽: 생산
    if (d.prod) {
      var p2 = d.prod;
      L.push(panel('이번 달 일별 생산량', 'prod_daily', '일일 생산현황', p2.days.length ? dayChart(p2) : '<div class="grid-empty">이번 달 생산실적이 아직 없습니다.</div>'));
      var eqs = p2.equips;
      L.push(panel('설비별 현황 <span class="muted" style="font-weight:400">' + (p2.last_date ? '최근 생산일 ' + p2.last_date + ' (' + '일월화수목금토'[new Date(p2.last_date).getDay()] + ')' : '') + '</span>',
        'prod_equip', '설비 가동률·OEE',
        eqs.length ? '<div class="scroll" style="max-height:420px"><table class="mini"><tr><th>설비</th><th>제번 · 품명</th><th class="num">생산량</th><th class="num">시간가동률</th><th class="num">성능</th><th class="num">OEE</th><th class="num">부동(분)</th></tr>' +
          eqs.map(function (e) {
            return '<tr><td><b>DH-' + esc(e.equip) + '</b></td><td>' + esc(e.codes) + ' <span class="muted">' + esc(e.names) + '</span></td><td class="num">' + fmt(e.qty) + '</td>' +
              '<td class="num">' + pct(e.time_rate, 0) + '</td><td class="num">' + pct(e.perf, 0) + '</td><td class="num"><b class="' + oeeCls(e.oee) + '">' + pct(e.oee, 0) + '</b></td>' +
              '<td class="num ' + (e.down >= 120 ? 'warn-t' : '') + '">' + (e.down ? fmt(e.down) : '') + '</td></tr>';
          }).join('') + '</table></div><div class="hint-line">OEE 60% 미만 빨강 · 80% 미만 주황 · 부동 2시간 이상 주황</div>'
          : '<div class="grid-empty">생산실적이 없습니다.</div>'));
    }
    // ---------- 오른쪽
    if (d.wo) {
      var w = d.wo, body;
      if (!w.exists) body = '<div class="grid-empty">오늘(' + esc(d.today) + ') 작업지시서가 아직 없습니다.<br><button class="btn primary small" data-go="workorder" style="margin-top:8px">작업지시서 만들기</button></div>';
      else {
        var tag = '<span class="tag ' + (w.status === '승인' ? 'ok' : w.status === '검토' ? 'steel' : 'gray') + '">' + esc(w.status) + '</span>';
        body = '<div class="wo-sum">' + tag + ' <span class="muted">작성 ' + esc(w.written_by || '-') + (w.reviewed_by ? ' · 검토 ' + esc(w.reviewed_by) : '') + (w.approved_by ? ' · 승인 ' + esc(w.approved_by) : '') + '</span>' +
          '<div class="wo-nums"><span><b>' + w.change.length + '</b>교체 예정</span><span><b class="' + (w.stop.length ? 'bad-t' : '') + '">' + w.stop.length + '</b>가동중단</span><span><b>' + w.night + '</b>★ 야간생산</span></div></div>' +
          (w.change.length ? '<table class="mini"><tr><th>설비</th><th>교체 제번</th><th>상태 · 시간</th></tr>' + w.change.map(function (c) {
            return '<tr><td><b>' + esc(c.equip) + '</b></td><td>' + (/^\?+$/.test(c.code) ? '<span class="muted">제번 미정</span>' : esc(c.code)) + '</td><td>' + esc([c.die, c.time].filter(Boolean).join(' · ')) + '</td></tr>';
          }).join('') + '</table>' : '') +
          (w.stop.length ? '<div class="stop-line">가동중단: ' + w.stop.map(function (s) { return '<b>' + esc(s.equip) + '</b> ' + esc(s.why); }).join(' · ') + '</div>' : '');
      }
      R.push(panel('오늘 작업지시서', 'workorder', '작업지시서', body));
    }
    if (d.att) {
      var a2 = d.att;
      R.push(panel('오늘 근태 <span class="muted" style="font-weight:400">' + esc(d.today) + (a2.off ? ' · ' + esc(a2.holiday || '휴무일') : '') + '</span>', 'att_month', '월별 근태',
        a2.codes.length ? '<div class="att-today">' + a2.codes.map(function (c) {
          return '<div><span class="chip-s" style="background:' + (c.bg || '#eee') + ';color:' + (c.fg || '#000') + '">' + esc(c.code) + '</span> <b>' + c.names.length + '명</b> <span class="muted">' + esc(c.names.join(', ')) + '</span></div>';
        }).join('') + '</div>' : '<div class="grid-empty">' + (a2.off ? '오늘은 휴무일입니다. 특근·야특이 입력되지 않았습니다.' : '오늘 입력된 근태(월차·결근·특근 등)가 없습니다. 전원 정상 출근으로 계산됩니다.') + '</div>'));
    }
    if (d.defect) {
      var df = d.defect, mx = Math.max.apply(null, df.top.map(function (t) { return t.qty; }).concat([1]));
      R.push(panel('이번 달 공정불량 <span class="muted" style="font-weight:400">' + fmt(df.qty) + ' EA · ' + df.n + '건</span>', 'defects', '공정불량 등록',
        df.top.length ? '<table class="mini">' + df.top.map(function (t) {
          return '<tr><td style="width:150px"><b>' + esc(t.code) + '</b> <span class="muted">' + esc(t.name) + '</span></td><td><span class="hbar" style="width:' + Math.max(2, t.qty / mx * 100) + '%"></span></td><td class="num" style="width:80px">' + fmt(t.qty) + '</td></tr>';
        }).join('') + '</table>' : '<div class="grid-empty">이번 달 등록된 공정불량이 없습니다.' + (df.last ? ' (마지막 등록 ' + esc(df.last) + ')' : '') + '</div>'));
    }
    if (!L.length) { L = R; R = []; }
    root.querySelector('[data-left]').innerHTML = L.join('');
    root.querySelector('[data-right]').innerHTML = R.join('');
    if (d.prod) bindChart(d.prod);
    fitMemos();
  }
  // ---------------------------------------------------------------- 한줄 메모
  var memos = [], mtotal = 0;
  var mlist = root.querySelector('[data-mlist]');
  function when(t) { return (t || '').slice(5, 16); }
  function memoLine(m) {
    return '<div class="memo-i" data-mid="' + m.id + '"><span class="mt">' + esc(m.text) + (m.n ? ' <span class="mc">💬 ' + m.n + '</span>' : '') + '</span>' +
      '<span class="mw">' + esc(m.created_by || '') + ' · ' + esc(when(m.created)) + '</span></div>';
  }
  function fitMemos() {
    // 칸 높이에 맞는 만큼만 (새 메모가 위, 넘치는 옛 메모는 숨김)
    // 메모 칸 높이 = 왼쪽 높이 - 오른쪽 다른 칸들 (왼쪽 아래 끝과 맞춤, 최소 260)
    var mp = root.querySelector('[data-memo]'), left = root.querySelector('[data-left]'), others = root.querySelector('[data-right]');
    var oneCol = left.getBoundingClientRect().top !== others.getBoundingClientRect().top && left.getBoundingClientRect().left === others.getBoundingClientRect().left;
    mp.style.height = (oneCol ? 420 : Math.max(260, left.offsetHeight - others.offsetHeight - (others.offsetHeight ? 12 : 0))) + 'px';
    var items = App.$$('.memo-i', mlist);
    items.forEach(function (it) { it.style.display = ''; });
    var h = mlist.clientHeight - 8, shown = 0, full = false;
    items.forEach(function (it) {   // memo-list 가 position:relative 라서 offsetTop 은 목록 안 위치
      if (full || it.offsetTop + it.offsetHeight > h) { full = true; it.style.display = 'none'; } else shown++;
    });
    root.querySelector('[data-mcount]').textContent = mtotal ? (shown < mtotal ? '최근 ' + shown + '개 / 전체 ' + mtotal + '개' : '전체 ' + mtotal + '개') : '';
  }
  function loadMemos() {
    return App.get('/api/memos?limit=60').then(function (r) {
      memos = r.rows; mtotal = r.total;
      mlist.innerHTML = memos.length ? memos.map(memoLine).join('') : '<div class="grid-empty">아직 메모가 없습니다. 위 칸에 전달사항을 남겨 보세요.</div>';
      fitMemos();
    }).catch(function () { /* 무시 */ });
  }
  root.querySelector('[data-mform]').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = e.target.querySelector('input'), t = inp.value.trim();
    if (!t) { inp.focus(); return; }
    App.api('POST', '/api/memos', { text: t }).then(function () { inp.value = ''; loadMemos(); }).catch(App.err);
  });
  function commentsHtml(m) {
    return '<div class="cm-list">' + (m.comments || []).map(function (c) {
      return '<div class="cm"><span class="ct">↳ ' + esc(c.text) + '</span><span class="mw">' + esc(c.created_by || '') + ' · ' + esc(when(c.created)) +
        (c.mine ? ' <a class="del" data-cdel="' + c.id + '" title="지우기">✕</a>' : '') + '</span></div>';
    }).join('') + '</div><form class="cm-in" data-cform="' + m.id + '"><input class="input" maxlength="500" placeholder="코멘트 달기…"><button class="btn small">등록</button></form>';
  }
  function memoBlock(m) {
    return '<div class="memo-b" data-bid="' + m.id + '"><div class="memo-h"><span class="mt">' + esc(m.text) + '</span><span class="mw">' + esc(m.created_by || '') + ' · ' + esc(when(m.created)) +
      (m.mine ? ' <a class="del" data-mdel="' + m.id + '" title="메모 지우기">✕</a>' : '') + '</span></div>' + commentsHtml(m) + '</div>';
  }
  // 메모 하나 (코멘트 보기·달기)
  function openMemo(id) {
    App.get('/api/memos/' + id).then(function (m) {
      var body = App.h('<div class="memo-dlg">' + memoBlock(m) + '</div>');
      var dlg = App.dialog({ title: '메모', body: body, buttons: [{ label: '닫기' }], onClose: loadMemos });
      bindMemoBody(body, function () { dlg.close(); openMemo(id); }, function () { dlg.close(); });
      setTimeout(function () { var i = body.querySelector('.cm-in input'); if (i) i.focus(); }, 50);
    }).catch(App.err);
  }
  // 전체 보기 (검색, 코멘트 포함)
  function openAll(q) {
    App.get('/api/memos?all=1' + (q ? '&q=' + encodeURIComponent(q) : '')).then(function (r) {
      var body = App.h('<div class="memo-dlg"><div class="memo-search"><input class="input" placeholder="내용·작성자 검색" value="' + esc(q || '') + '"><span class="muted">' +
        (q ? '찾은 메모 ' + r.rows.length + '개 / ' : '') + '전체 ' + r.total + '개</span></div>' +
        '<div class="memo-all">' + (r.rows.map(memoBlock).join('') || '<div class="grid-empty">메모가 없습니다.</div>') + '</div></div>');
      var dlg = App.dialog({ title: '한줄 메모 전체', body: body, wide: true, buttons: [{ label: '닫기' }], onClose: loadMemos });
      var si = body.querySelector('.memo-search input'), st;
      si.addEventListener('input', function () { clearTimeout(st); st = setTimeout(function () { dlg.close(); openAll(si.value.trim()); }, 500); });
      if (q) setTimeout(function () { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }, 30);
      bindMemoBody(body, function () { var top = body.querySelector('.memo-all').scrollTop; dlg.close(); openAll(q); setTimeout(function () { var a = document.querySelector('.memo-all'); if (a) a.scrollTop = top; }, 120); });
    }).catch(App.err);
  }
  function bindMemoBody(body, reload, gone) {
    body.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-cform]'); if (!f) return;
      e.preventDefault();
      var inp = f.querySelector('input'), t = inp.value.trim();
      if (!t) { inp.focus(); return; }
      App.api('POST', '/api/memos/' + f.dataset.cform + '/comments', { text: t }).then(reload).catch(App.err);
    });
    body.addEventListener('click', function (e) {
      var md = e.target.closest('[data-mdel]'), cd = e.target.closest('[data-cdel]');
      if (md) App.confirm('이 메모를 지울까요? (코멘트도 같이 지워집니다)', '지우기', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/memos/' + md.dataset.mdel).then(gone || reload).catch(App.err);
      });
      if (cd) App.confirm('이 코멘트를 지울까요?', '지우기', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/memo_comments/' + cd.dataset.cdel).then(reload).catch(App.err);
      });
    });
  }
  mlist.addEventListener('click', function (e) { var it = e.target.closest('[data-mid]'); if (it) openMemo(it.dataset.mid); });
  root.querySelector('[data-mall]').addEventListener('click', function () { openAll(''); });
  function onResize() { fitMemos(); }
  window.addEventListener('resize', onResize);
  loadMemos();
  App.timers.push(setInterval(loadMemos, 30000));

  root.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (!g) return;
    if (g.dataset.go === 'mold_status' && g.classList.contains('kpi')) App.go('mold_status', { lv: 'alarm' });
    else App.go(g.dataset.go);
  });
  function load() { App.get('/api/home').then(render).catch(App.err); App.refreshBadges(); }
  load();
  App.timers.push(setInterval(load, 60000));
  return { destroy: function () { window.removeEventListener('resize', onResize); } };
};
