/* 납기 · 생산계획 — 납기현황 엑셀 → 설비별 편성 (+ AI 도우미) */
App.pages.plan = function (root) {
  var esc = App.esc, fmt = App.fmt;
  var lv = App.curLevel || 0;
  var d = null, tab = App.store.get('plan_tab', 'eq'), startDate = '', viewDate = '';
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  if (!document.getElementById('planCss')) {
    var css = document.createElement('style'); css.id = 'planCss';
    css.textContent =
      '.pl{display:flex;gap:12px;height:100%;min-height:0}.pl-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}' +
      '.pl-ai{width:340px;flex:none;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;background:var(--panel);min-height:0}' +
      '.pl-ai .h{padding:8px 12px;border-bottom:1px solid var(--line-2);font-weight:700;display:flex;align-items:center;gap:6px}' +
      '.pl-ai .log{flex:1;overflow:auto;padding:10px;font-size:13px;line-height:1.55}' +
      '.pl-ai .m{margin-bottom:10px;white-space:pre-wrap}.pl-ai .m.u{background:#eef4fb;border-radius:8px;padding:6px 9px}' +
      '.pl-ai .m.a{padding:2px 2px}.pl-ai .m .ap{font-size:11.5px;color:#1e7b3a;margin-top:3px}' +
      '.pl-ai .in{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line-2)}.pl-ai textarea{flex:1;height:54px;resize:none}' +
      '.pl .seg{display:inline-flex}.pl .seg .btn{border-radius:0;margin-left:-1px}.pl .seg .btn:first-child{border-radius:6px 0 0 6px;margin-left:0}.pl .seg .btn:last-child{border-radius:0 6px 6px 0}' +
      '.pl .seg .btn.on{background:var(--steel);border-color:var(--steel);color:#fff}' +
      '.pl-info{font-size:12.5px;color:var(--muted);margin:0 0 8px;line-height:1.6}' +
      '.pl-body{flex:1;min-height:0;overflow:auto}' +
      '.pl-t{border-collapse:separate;border-spacing:0;width:100%;font-size:13px;background:var(--panel)}' +
      '.pl-t th{position:sticky;top:0;background:#f3f5f8;border-bottom:1px solid var(--line);padding:6px;white-space:nowrap;z-index:1}' +
      '.pl-t td{border-bottom:1px solid var(--line-2);padding:5px 6px;vertical-align:top}.pl-t td.n{text-align:right;white-space:nowrap}' +
      '.pl-t tr.eqr{cursor:pointer}.pl-t tr.eqr:hover td{background:#f7fafd}' +
      '.mode{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:700;font-size:12px;white-space:nowrap}' +
      '.mode.k{background:var(--bad-bg);color:var(--bad)}.mode.dn{background:#fff1d6;color:#a35b00}.mode.d{background:#e6f4ea;color:#1e7b3a}.mode.x{background:#eee;color:#888}' +
      '.segs{font-size:12px;line-height:1.6}.segs b{font-weight:600}' +
      '.chip{display:inline-block;border:1px solid var(--line);border-radius:12px;padding:1px 8px;margin:1px 3px 1px 0;font-size:12px;background:#fff}' +
      '.chip.ext{border-color:#e0a000;background:#fff8e1}.chip.mv{border-color:#7aa7e0;background:#eef4fb}' +
      '.pl-cal td,.pl-cal th{text-align:center}.pl-cal select{height:24px;font-size:12px}';
    document.head.appendChild(css);
  }
  root.innerHTML = '<div class="page-full"><div class="pl"><div class="pl-main">' +
    '<div class="toolbar">' +
    (lv >= 2 ? '<label class="btn primary" style="cursor:pointer">납기 파일 올리기<input type="file" accept=".xlsx" data-file style="display:none"></label>' : '') +
    '<select class="input" data-up style="width:190px"></select>' +
    '<span class="muted" style="font-size:12px">계산 시작</span><input type="date" class="input" data-start style="width:140px">' +
    '<span data-tabs></span><span class="grow"></span>' +
    (lv >= 2 ? '<button class="btn" data-a="wo">작업지시서 초안</button>' : '') +
    '<button class="btn" data-a="aiopen" style="display:none">AI 도우미</button>' +
    (App.me && App.me.admin ? '<button class="btn" data-a="aicfg">AI 설정</button>' : '') +
    '<button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
    '<div class="pl-info" data-info></div><div class="pl-body" data-body></div></div>' +
    '</div></div>';
  var $ = function (s) { return root.querySelector(s); };
  $('[data-start]').value = startDate;
  if (tab === 'rule') tab = 'eq';
  var TABS = [['eq', '설비별'], ['item', '품번별'], ['mat', '원재료'], ['adj', '조정 · 근무'], ['fam', '금형 · 설비 표']];

  function n0(v) { return v === null || v === undefined || v === '' ? '' : fmt(Math.round(v), 0); }
  function n1(v) { return v === null || v === undefined || v === '' ? '' : fmt(Math.round(v * 10) / 10, 1); }
  function dlabel(ds) { if (!ds) return ''; var t = new Date(ds + 'T00:00:00'); return ds.slice(5).replace('-', '/') + '(' + WD[t.getDay()] + ')'; }
  function slotLabel(s) { return s ? dlabel(s[0]) + (s[1] === 'N' ? ' 야' : '') : ''; }
  function modeTag(m) { var c = { '케파 부족': 'k', '주·야': 'dn', '주간만': 'd' }[m] || 'x'; return '<span class="mode ' + c + '">' + esc(m) + '</span>'; }
  function eqLabel(no) { var e = (d && d.eqinfo && d.eqinfo[String(no)]) || {}; return no + '호기' + (e.maker || e.ton ? ' <span class="muted" style="font-size:11.5px">' + esc((e.maker || '').slice(0, 3)) + (e.ton ? '-' + esc(e.ton) : '') + '</span>' : ''); }
  function codesOf(fam) { return (d.rows || []).filter(function (r) { return r.fam === fam && r.plan > 0; }).map(function (r) { return r.code; }); }

  function load() {
    var q = '/api/plan?start=' + ($('[data-start]').value || '') + (viewDate ? '&date=' + viewDate : '');
    return App.get(q).then(function (r) { d = r; if (r.start && !$('[data-start]').value) $('[data-start]').value = r.start; draw(); }).catch(App.err);
  }
  function draw() {
    $('[data-up]').innerHTML = (d.uploads || []).map(function (u) {
      return '<option value="' + esc(u.file_date) + '"' + (u.file_date === d.file_date ? ' selected' : '') + '>납기 ' + esc(u.file_date) + ' ' + esc(u.file_time || '') + '</option>';
    }).join('') || '<option>납기 파일 없음</option>';
    $('[data-tabs]').innerHTML = '<div class="seg">' + TABS.map(function (t) { return '<button class="btn' + (t[0] === tab ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    $('[data-a=aiopen]').style.display = d.ai && d.ai.on && lv >= 2 ? '' : 'none';
    if (d.none) {
      $('[data-info]').innerHTML = '';
      $('[data-body]').innerHTML = tab === 'fam' ? '' : '<div class="panel panel-b" style="max-width:640px;line-height:1.8">아직 납기 파일이 없습니다.<br>KET 납기현황 엑셀(납기현황(제품별) 시트가 있는 .xlsx)을 [납기 파일 올리기]로 올리면 설비별 생산계획을 짭니다.<br><span class="muted">보안(DRM)이 걸린 파일은 읽을 수 없습니다.</span></div>';
      if (tab === 'fam') famTab();
      return;
    }
    var di = d.deduct_info || {};
    $('[data-info]').innerHTML = '납기 기준 <b>' + esc(d.file_date) + ' ' + esc(d.file_time || '') + '</b> · 계획 기간 <b>' + dlabel(d.start) + ' ~ ' + dlabel(d.end) + '</b>' +
      ' · ' + (di.stock_used ? '출하대기 재고(불량선별 대기 제외)와 ' + esc(d.file_date) + ' 이후 출고분을 뺀 수량' : '<span class="tag warn">출하관리 재고 시작일이 없어서 재고를 빼지 않음</span>') +
      (d.unassigned && d.unassigned.length ? ' · <span class="tag bad">설비 모름 ' + d.unassigned.length + '품번</span>' : '') +
      (d.overrides && d.overrides.length ? ' · 조정 ' + d.overrides.length + '건 적용 중' : '') +
      ((d.learned || []).length ? ' · <span class="tag" style="background:#efe7fb;color:#5b2a9a" title="' + esc(d.learned.map(function (x) { return x.text; }).join('\n')) + '">배운 노하우 ' + d.learned.length + '개 적용</span>' : '') +
      Object.keys(d.wk_changes || {}).filter(function (k) { return d.wk_changes[k].length > 2; }).map(function (k) {
        return ' · <span class="tag warn" title="특근일은 아침에 1~2대만 교체하는 게 보통">' + dlabel(k) + ' 아침 교체 ' + d.wk_changes[k].length + '대 (' + d.wk_changes[k].join(',') + '호기)</span>';
      }).join('') +
      ((d.learned_skipped || []).length ? ' · <span class="tag warn" title="' + esc(d.learned_skipped.map(function (x) { return x.text; }).join('\n')) + '">+20일 결품 때문에 노하우 ' + d.learned_skipped.length + '개 건너뜀</span>' : '');
    if (tab === 'eq') eqTab(); else if (tab === 'item') itemTab(); else if (tab === 'adj') adjTab(); else if (tab === 'mat') matTab(); else famTab();
  }

  // ---------------------------------------------------------------- 설비별
  function eqTab() {
    var h = ['<table class="pl-t"><thead><tr><th>설비</th><th>판단</th><th>필요 (주간 기준 일수)<br><span class="muted" style="font-weight:400">+20일 / 월말 / 익월말</span></th><th>가능</th><th>특근 연장 · 대체</th><th>생산 순서</th>' +
      (lv >= 2 ? '<th>야간</th>' : '') + '</tr></thead><tbody>'];
    var nightOv = {};
    (d.overrides || []).forEach(function (o) { if (o.kind === 'night') nightOv[o.k1] = o.val; });
    d.eqs.forEach(function (e) {
      if (e.mode === '없음' && !nightOv[e.eq]) return;
      var mv = (d.moved || []).filter(function (m) { return m.src === e.eq || m.dst === e.eq; });
      var nights = e.nights || 0;
      var segs = (e.segs || []).map(function (s) {
        var rt = (e.rates || {})[s.fam] || {};
        return '<div>' + (s.chg ? '<span class="muted" style="font-size:11px" title="금형 교체 ' + (e.setup || '') + '분">🔧' + dlabel(s.chg[0]) + '</span> ' : '') + '<b>' + esc(s.fam) + '</b> <span class="muted">' + esc(codesOf(s.fam).join(', ')) + '</span> · ' + n0(s.qty) + ' EA · ' + slotLabel(s.start) + ' ~ ' + slotLabel(s.end) +
          (rt.rpm ? ' <span class="muted" style="font-size:11px' + (/기본값/.test(rt.src) ? ';color:#b26b00' : '') + '" title="' + esc(rt.src) + '">분당 ' + n0(rt.rpm) + (/기본값/.test(rt.src) ? '*' : '') + '</span>' : '') + '</div>';
      }).join('');
      var shortT = (e.short || []).map(function (s) { return '<div style="color:var(--bad)">부족 ' + esc(s.fam) + ' ' + n0(s.qty) + ' EA</div>'; }).join('');
      h.push('<tr><td><b>' + eqLabel(e.eq) + '</b></td><td>' + modeTag(e.mode) + (nights ? '<div class="muted" style="font-size:11.5px;margin-top:3px">야간 ' + nights + '회</div>' : '') +
        ((e.changes || []).length ? '<div class="muted" style="font-size:11.5px">교체 ' + e.changes.length + '회 · ' + (e.setup || '') + '분</div>' : '') +
        ((e.learned || []).length ? '<div style="margin-top:3px"><span class="tag" style="background:#efe7fb;color:#5b2a9a;cursor:help" title="배운 노하우 적용:\n' + esc(e.learned.join('\n')) + '">노하우</span></div>' : '') + '</td>' +
        '<td class="n">' + n1(e.need_T) + ' / ' + n1(e.need_S) + ' / ' + n1(e.need_R) + '</td>' +
        '<td class="n">주간 ' + n1(e.cap_day) + '일<br><span class="muted">+ 평일 야간</span></td>' +
        '<td>' + Object.keys(e.ext || {}).map(function (k) { return '<span class="chip ext">' + dlabel(k) + ' ' + esc(e.ext[k]) + '까지</span>'; }).join('') +
        mv.map(function (m) { return '<span class="chip mv">' + esc(m.fam) + (m.src === e.eq ? ' → ' + m.dst + '호기' : ' ← ' + m.src + '호기') + (m.part ? ' (' + n0(m.qty) + ' EA)' : '') + '</span>'; }).join('') + '</td>' +
        '<td class="segs">' + (segs || '<span class="muted">-</span>') + shortT + '</td>' +
        (lv >= 2 ? '<td><select class="input" data-night="' + e.eq + '" style="height:26px;font-size:12px">' + [['auto', '규칙대로'], ['on', '항상'], ['off', '안 함']].map(function (x) {
          return '<option value="' + x[0] + '"' + ((nightOv[e.eq] || 'auto') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select></td>' : '') + '</tr>');
    });
    h.push('</tbody></table>');
    h.push('<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.6">· 필요 일수는 주간(560분)만 돌릴 때 기준. 판단: 주간만으로 월말 결품이 끝나면 <b>주간만</b>(남는 시간 익월말분) / 아니면 <b>주·야</b> / 주·야로도 안 되면 대체 설비 → 주말·공휴일 17:30 → 24:00 연장 → 그래도 안 되면 <b>케파 부족</b><br>' +
      '· 특근 연장은 <b>제안</b>입니다. 그대로 하려면 [조정 · 근무]에서 그 날 근무 시간을 정하세요.<br>' +
      '· 생산 속도 = SPM × 효율 × 타당생산수 (분당, * = 기준정보에 SPM·효율이 없어서 SPM 300 · 효율 0.8로 계산). 🔧 = 금형 교체 (설비별 셋업 시간 중간값, 기본 ' + (d.setup_default || 40) + '분)<br>' +
      '· 금형 교체는 평일 주간 18시 전까지만 · 야간은 교체 없이 걸어 둔 제품만 · 특근일은 아침 출근 때만. 그래서 제품이 18시 이후나 야간에 끝나면 남은 시간은 멈춤으로 계산</div>');
    $('[data-body]').innerHTML = h.join('');
  }

  // ---------------------------------------------------------------- 품번별
  var grid = null;
  function itemTab() {
    $('[data-body]').innerHTML = '<div class="toolbar" style="margin-bottom:6px"><input class="input search" placeholder="품번 / 제품군 / 설비 검색" style="width:200px">' +
      '<label class="chk"><input type="checkbox" data-all> 생산 안 하는 품번도 보기</label><span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn small" data-a="excl">선택 품번 빼기/넣기</button><button class="btn small" data-a="first">제품군 먼저</button><button class="btn small" data-a="move">제품군 설비 옮기기</button>' : '') +
      '</div><div class="gridbox" style="height:calc(100% - 40px);display:flex;flex-direction:column;min-height:0"></div>';
    var all = $('[data-all]');
    grid = new App.Grid(root.querySelector('.gridbox'), {
      cols: [
        { k: 'code', l: '품번', w: 95 }, { k: 'name', l: '품명', w: 170 }, { k: 'fam', l: '제품군', w: 60 },
        { k: 'eqs', l: '설비', w: 60, val: function (r) { return (r.eqs || (r.eq ? [r.eq] : [])).join(','); }, fmt: function (v, r) { return v ? esc(v) + '호기' + (r.moved ? ' <span class="tag" style="background:#eef4fb">' + esc(r.moved) + '</span>' : '') : ''; } },
        { k: 'T', l: '+20일 결품', t: 'int', w: 70 }, { k: 'S', l: '월말 결품', t: 'int', w: 70 }, { k: 'R', l: '익월말 결품', t: 'int', w: 75 },
        { k: 'ded', l: '뺀 재고', t: 'int', w: 65 },
        { k: 'plan', l: '생산 EA', t: 'int', w: 75, fmt: function (v) { return v ? '<b>' + n0(v) + '</b>' : ''; } },
        { k: 'plan_rl', l: 'R/L', t: 'num', w: 50 }, { k: 'plan_box', l: 'BOX', t: 'num', w: 50 },
        { k: 'tier', l: '어디까지', w: 55, center: true },
        { k: 'start', l: '시작', w: 70, fmt: function (v) { return dlabel(v); } }, { k: 'end', l: '끝', w: 70, fmt: function (v) { return dlabel(v); } },
        { k: 'short', l: '월말 부족', t: 'int', w: 70, fmt: function (v) { return v ? '<span style="color:var(--bad);font-weight:700">' + n0(v) + '</span>' : ''; } },
        { k: 'mat_short', l: '원재료 부족 EA', t: 'int', w: 80, fmt: function (v) { return v ? '<span style="color:#0000ff;font-weight:700">' + n0(v) + '</span>' : ''; } },
        { k: 'plan_kg', l: '원재료 kg', t: 'num', w: 65 },
        { k: 'note', l: '비고', w: 140, val: function (r) { return (r.excluded ? '계획에서 뺌 ' : '') + (r.note || ''); } }
      ], key: 'code', hint: '',
      extraFilter: function (r) { return all.checked || r.plan > 0 || r.short > 0 || r.excluded || r.note || r.mat_short; },
      rowClass: function (r) { return r.excluded ? 'r-dim' : (r.short > 0 || r.note ? 'row-bad' : ''); }
    });
    grid.setRows(d.rows);
    root.querySelector('.search').addEventListener('input', function () { grid.setFilter(this.value); });
    all.onchange = function () { grid.render(); };
    if (lv >= 2) {
      $('[data-a=excl]').onclick = function () { var r = grid.selected(); if (!r) return App.toast('품번을 고르세요.', 'bad'); ov(r.excluded ? null : { kind: 'exclude', k1: r.code, val: '1' }, r.excluded ? { kind: 'exclude', k1: r.code } : null); };
      $('[data-a=first]').onclick = function () { var r = grid.selected(); if (!r) return App.toast('품번을 고르세요.', 'bad'); ov({ kind: 'first', k1: r.fam, val: '1' }); };
      $('[data-a=move]').onclick = function () {
        var r = grid.selected(); if (!r) return App.toast('품번을 고르세요.', 'bad');
        var body = App.h('<div><div style="margin-bottom:8px">제품군 <b>' + esc(r.fam) + '</b> (' + esc(r.code) + ' 등)을 어느 설비에서 생산할까요?</div><input class="input" type="number" min="1" data-eq value="' + (r.eq || '') + '" style="width:100px"> 호기</div>');
        App.dialog({ title: '설비 옮기기', body: body, buttons: [{ label: '취소' }, { label: '옮기기', cls: 'primary', default: true, onClick: function (dd) { dd.close(); ov({ kind: 'move', k1: r.fam, val: body.querySelector('[data-eq]').value }); } }] });
      };
    }
  }

  // ---------------------------------------------------------------- 조정 · 근무
  function adjTab() {
    var kinds = { move: '설비 옮김', hours: '근무 시간', night: '야간', first: '먼저 생산', exclude: '계획에서 뺌' };
    var h = ['<div class="cols2" style="align-items:start">'];
    h.push('<div class="panel"><div class="panel-h">지금 걸려 있는 조정<span class="grow"></span>' + (lv >= 2 && d.overrides.length ? '<button class="btn small" data-a="ovclear">모두 지우기</button>' : '') + '</div><div class="panel-b">' +
      (d.overrides.length ? '<table class="mini" style="width:100%"><tr><th>구분</th><th>대상</th><th>값</th><th>누가</th><th></th></tr>' + d.overrides.map(function (o) {
        var tgt = o.kind === 'hours' ? (o.k1 ? o.k1 + '호기 ' : '모든 설비 ') + dlabel(o.k2) : o.kind === 'night' ? o.k1 + '호기' : o.k1;
        return '<tr><td>' + esc(kinds[o.kind] || o.kind) + '</td><td>' + esc(tgt) + '</td><td>' + esc(o.kind === 'move' ? o.val + '호기' : o.val === '1' ? '' : o.val) + '</td><td>' + esc(o.created_by) + (o.via === 'AI' ? ' <span class="tag">AI</span>' : '') + '</td>' +
          '<td>' + (lv >= 2 ? '<button class="btn small" data-ovdel="' + o.id + '">지움</button>' : '') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted">없음 — 규칙대로 계산 중</div>') + '</div></div>');
    // 근무 달력 (주말 · 공휴일)
    var dates = d.weekend_dates || [];
    var hv = {};
    (d.overrides || []).forEach(function (o) { if (o.kind === 'hours') hv[(o.k1 || '') + '|' + o.k2] = o.val; });
    var ext = {};
    (d.ext || []).forEach(function (x) { ext[x.eq + '|' + x.date] = x.mode; });
    h.push('<div class="panel"><div class="panel-h">주말 · 공휴일 근무 (기본 15시까지)</div><div class="panel-b" style="overflow:auto">' +
      (dates.length ? '<table class="mini pl-cal"><tr><th>날짜</th><th>모든 설비</th><th>연장 제안</th></tr>' + dates.map(function (ds) {
        var sel = hv['|' + ds] || '';
        var sug = (d.ext || []).filter(function (x) { return x.date === ds; });
        return '<tr><td>' + dlabel(ds) + (d.holidays[ds] ? ' <span class="muted">' + esc(d.holidays[ds]) + '</span>' : '') + '</td><td>' + hoursSel('', ds, sel) + '</td><td style="text-align:left">' +
          sug.map(function (x) { return '<span class="chip ext">' + x.eq + '호기 ' + esc(x.mode) + (lv >= 2 ? ' <a href="#" data-apply="' + x.eq + '|' + ds + '|' + x.mode + '">확정</a>' : '') + '</span>'; }).join('') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted">계획 기간에 주말·공휴일이 없습니다.</div>') +
      '<div class="muted" style="font-size:12px;margin-top:8px">설비 하나만 바꾸려면 연장 제안의 [확정]을 누르거나 AI 도우미에게 말하세요. 평일 휴무도 AI 로 지정할 수 있습니다.</div></div></div>');
    h.push('</div>');
    $('[data-body]').innerHTML = h.join('');
  }
  function hoursSel(eq, ds, val) {
    if (lv < 2) return esc(val || '15:00(기본)');
    return '<select class="input" data-hours="' + eq + '|' + ds + '">' + [['', '15:00 (기본)'], ['17:30', '17:30'], ['24:00', '24:00'], ['휴무', '휴무']].map(function (x) {
      return '<option value="' + x[0] + '"' + (x[0] === (val || '') ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>';
  }

  // ---------------------------------------------------------------- 원재료
  function matTab() {
    var m = d.material || {};
    var h = [];
    if (!m.ok) {
      h.push('<div class="panel panel-b" style="max-width:700px;line-height:1.7">창고 원재료 자료가 없어서 원재료를 따지지 않았습니다. 원재료 메뉴에서 창고 데이터를 한 번 읽어 오세요.</div>');
    } else {
      h.push('<div class="pl-info" style="margin-top:0">필요 kg = 결품 수량 × 생산중량(제품중량+스크랩중량). 쓸 수 있는 원재료 = 창고 보관 롤 + 계획 기간 안 입고 예정(날짜 정해진 것). 모자라는 품번은 그만큼 줄이고 남는 케파는 다른 품번으로 돌림 (<span style="color:#0000ff;font-weight:700">파란색</span>)' +
        (m.noweight && m.noweight.length ? '<br><span class="tag warn">생산중량 없는 품번 ' + m.noweight.length + '개</span> <span class="muted">' + esc(m.noweight.slice(0, 15).join(', ')) + (m.noweight.length > 15 ? ' …' : '') + ' — 기준정보 > 제품에서 제품중량·스크랩중량(또는 생산중량)을 넣으면 따짐</span>' : '') +
        (m.nomat && m.nomat.length ? '<br><span class="tag warn">자재번호 없는 품번</span> <span class="muted">' + esc(m.nomat.join(', ')) + '</span>' : '') + '</div>');
      h.push('<table class="pl-t"><thead><tr><th>자재번호</th><th>재질 · 규격</th><th>쓰는 품번</th><th>필요 kg<br><span class="muted" style="font-weight:400">+20일 / 월말 / 익월말</span></th><th>계획 kg</th><th>창고 재고 kg</th><th>입고 예정 kg</th><th>부족 kg<br><span class="muted" style="font-weight:400">월말 / 익월말</span></th><th>쓸 롤 (오래된 입고순)</th></tr></thead><tbody>' +
        (m.rows || []).map(function (r) {
          var bad = r.short_S > 0;
          return '<tr' + (bad ? ' style="background:#eef0ff"' : '') + '><td><b' + (bad ? ' style="color:#0000ff"' : '') + '>' + esc(r.mat) + '</b></td><td>' + esc(r.material) + ' ' + esc(r.spec) + '</td><td style="max-width:180px">' + esc(r.codes.join(', ')) + '</td>' +
            '<td class="n">' + n1(r.need_T) + ' / ' + n1(r.need_S) + ' / ' + n1(r.need_R) + '</td><td class="n">' + n1(r.plan) + '</td><td class="n">' + n1(r.stock) + (r.rolls ? '<div class="muted" style="font-size:11px">' + r.rolls + '롤</div>' : '') + '</td>' +
            '<td class="n">' + (r.incoming ? n1(r.incoming) : '') + (r.undated ? '<div class="muted" style="font-size:11px">날짜 미정 ' + n1(r.undated) + '</div>' : '') + '</td>' +
            '<td class="n" style="color:' + (bad ? '#0000ff;font-weight:700' : 'inherit') + '">' + (r.short_S ? n1(r.short_S) : '-') + ' / ' + (r.short_R ? n1(r.short_R) : '-') + '</td>' +
            '<td style="font-size:12px">' + r.use.map(function (u) { return esc(u.barcode) + ' ' + n1(u.kg) + 'kg ' + esc(u.lctn || '') + ' (' + esc(u.isd.slice(2)) + ')'; }).join('<br>') + '</td></tr>';
        }).join('') + '</tbody></table>');
    }
    h.push('<div class="panel" style="margin-top:12px"><div class="panel-h">원재료 입고 예정<span class="grow"></span>' + (lv >= 2 ? '<button class="btn small" data-a="incadd">+ 입고 예정</button>' : '') + '</div><div class="panel-b" data-inc>불러오는 중…</div></div>');
    $('[data-body]').innerHTML = h.join('');
    App.get('/api/plan/incoming').then(function (r) {
      var box = $('[data-inc]');
      if (!box) return;
      box.innerHTML = r.rows.length ? '<table class="mini" style="width:100%"><tr><th>자재번호</th><th>kg</th><th>입고 예정일</th><th>메모</th><th></th></tr>' + r.rows.map(function (x) {
        return '<tr><td>' + esc(x.part_no) + '</td><td class="num">' + n1(x.kg) + '</td><td>' + (x.date ? esc(x.date) : '<span class="muted">미정 (계산에 안 넣음)</span>') + '</td><td>' + esc(x.memo || '') + '</td>' +
          '<td>' + (lv >= 2 ? '<button class="btn small" data-inc-edit="' + x.id + '">고침</button> <button class="btn small" data-inc-done="' + x.id + '">입고됨</button> <button class="btn small" data-inc-del="' + x.id + '">지움</button>' : '') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted">입고 예정이 없습니다. 날짜가 정해진 입고 예정은 그 날짜가 계획 기간 안이면 쓸 수 있는 원재료에 더해집니다.</div>';
      box._rows = r.rows; box._parts = r.parts;
    });
  }
  function incEdit(x) {
    var box = $('[data-inc]');
    var parts = (box && box._parts) || [];
    var dlid = 'dl-rmparts';
    if (!document.getElementById(dlid)) {
      var dl = document.createElement('datalist'); dl.id = dlid;
      dl.innerHTML = parts.map(function (p) { return '<option value="' + esc(p.part_no) + '">' + esc(p.material + ' ' + p.spec) + '</option>'; }).join('');
      document.body.appendChild(dl);
    }
    var body = App.h('<div><div class="form">' +
      '<label class="f"><span>자재번호</span><input class="input" data-k="pn" list="' + dlid + '" value="' + esc(x.part_no || '') + '"></label>' +
      '<label class="f"><span>무게 (kg)</span><input class="input" data-k="kg" type="number" value="' + esc(x.kg || '') + '"></label>' +
      '<label class="f"><span>입고 예정일 (모르면 비움)</span><input class="input" data-k="date" type="date" value="' + esc(x.date || '') + '"></label>' +
      '<label class="f"><span>메모</span><input class="input" data-k="memo" value="' + esc(x.memo || '') + '"></label></div></div>');
    App.dialog({ title: '원재료 입고 예정', body: body, buttons: [{ label: '취소' }, { label: '저장', cls: 'primary', default: true, onClick: function (dd) {
      var g = function (k) { return body.querySelector('[data-k=' + k + ']').value.trim(); };
      App.api('POST', '/api/plan/incoming', { id: x.id, part_no: g('pn'), kg: g('kg'), date: g('date'), memo: g('memo') }).then(function () { dd.close(); load(); }).catch(function (e) { dd.error(e.message); });
    } }] });
  }

  // ---------------------------------------------------------------- 금형 · 설비 표
  var fgrid = null;
  function famTab() {
    $('[data-body]').innerHTML = '<div class="toolbar" style="margin-bottom:6px"><input class="input search" placeholder="제품군 / 품번 / 금형 / 설비 검색" style="width:220px">' +
      '<span class="muted" style="font-size:12px">주력 · 대체 설비와 생산량 (기준정보 SPM × 효율 × 타당생산수, * = SPM·효율 없어서 300 · 0.8, 🔒 = 사람이 고친 값). 두 번 클릭해서 고침</span><span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn small" data-a="famref" title="최근 실적에서 다른 설비로 돌린 제품군 찾기">설비 후보 찾기</button><button class="btn small" data-a="famadd">+ 제품군 추가</button>' : '') + '</div>' +
      '<div class="gridbox" style="height:calc(100% - 40px);display:flex;flex-direction:column;min-height:0"></div>';
    App.get('/api/plan/families').then(function (r) {
      fgrid = new App.Grid(root.querySelector('.gridbox'), {
        cols: [
          { k: 'fam', l: '제품군', w: 60 }, { k: 'codes', l: '품번', w: 200, val: function (r) { return (r.codes || []).join(', '); } },
          { k: 'molds', l: '금형', w: 80, val: function (r) { return (r.molds || []).join(', '); } },
          { k: 'main_eq', l: '주력 설비', t: 'int', w: 55 },
          { k: 'alts', l: '대체 설비', w: 160, val: function (r) { return (r.alts || []).filter(function (a) { return a.length < 3 || a[2]; }).map(function (a) { return a[0] + '호기' + (a[1] ? '(' + a[1] + '일)' : ''); }).join(', '); } },
          { k: 'rpm', l: '분당 EA', t: 'num', w: 60, fmt: function (v, r) { return v ? (r.dflt ? '<span style="color:#b26b00" title="기준정보에 SPM·효율 없음">' + n0(v) + '*</span>' : n0(v)) : ''; } },
          { k: 'rate_d', l: '주간 EA', t: 'int', w: 75 }, { k: 'rate_n', l: '야간 EA', t: 'int', w: 75 },
          { k: 'rate_src', l: '생산량 근거', w: 190, val: function (r) { return (r.locked ? '🔒 ' : '') + (r.rate_src || ''); } },
          { k: 'cand', l: '새 설비 후보', w: 80, val: function (r) { return (r.alts || []).filter(function (a) { return a.length >= 3 && !a[2] && a[1]; }).map(function (a) { return a[0] + '호기(' + a[1] + '일)'; }).join(', '); } },
          { k: 'days', l: '가동일(2년)', t: 'int', w: 60 }, { k: 'last', l: '마지막 생산', w: 80 }, { k: 'note', l: '비고', w: 100 }
        ], key: 'fam', hint: '두 번 클릭하면 고침', onDbl: lv >= 2 ? famEdit : null
      });
      fgrid.setRows(r.rows);
      root.querySelector('.search').addEventListener('input', function () { fgrid.setFilter(this.value); });
      if (lv >= 2) {
        $('[data-a=famadd]').onclick = function () { famEdit({ fam: '', alts: [], main_eq: '', rate_d: '', rate_n: '' }); };
        $('[data-a=famref]').onclick = function () { App.api('POST', '/api/plan/families/refresh').then(function (x) { App.toast('최근 실적에서 새 설비 후보 ' + x.candidates + '개'); famTab(); load(); }).catch(App.err); };
      }
    }).catch(App.err);
  }
  function famEdit(r) {
    var body = App.h('<div><div class="form">' +
      '<label class="f"><span>제품군 (숫자 6자리)</span><input class="input" data-k="fam" value="' + esc(r.fam) + '"' + (r.fam ? ' disabled' : '') + '></label>' +
      '<label class="f"><span>주력 설비</span><input class="input" data-k="main" type="number" value="' + esc(r.main_eq || '') + '"></label>' +
      '<label class="f full"><span>대체 설비 (쉼표로, 예: 9, 18)</span><input class="input" data-k="alts" value="' + esc((r.alts || []).filter(function (a) { return a.length < 3 || a[2]; }).map(function (a) { return a[0]; }).join(', ')) + '"></label>' +
      '<label class="f"><span>주간 한 근무 생산량 (EA)</span><input class="input" data-k="rd" type="number" value="' + esc(r.rate_d || '') + '"></label>' +
      '<label class="f"><span>야간 한 근무 생산량 (EA)</span><input class="input" data-k="rn" type="number" value="' + esc(r.rate_n || '') + '"></label>' +
      '<label class="f full"><span>비고</span><input class="input" data-k="note" value="' + esc(r.note || '') + '"></label>' +
      '<div class="f full"><span>&nbsp;</span><label class="chk"><input type="checkbox" data-k="auto"' + (r.locked ? '' : ' checked') + '> 생산량을 기준정보 SPM · 효율로 자동 계산 (생산량을 고치면 꺼지고 그 값으로 고정)</label></div>' +
      ((r.alts || []).some(function (a) { return a.length >= 3 && !a[2] && a[1]; }) ? '<div class="muted full" style="font-size:12px">새 설비 후보: ' + (r.alts || []).filter(function (a) { return a.length >= 3 && !a[2] && a[1]; }).map(function (a) { return a[0] + '호기(최근 ' + a[1] + '일)'; }).join(', ') + ' — 맞으면 대체 설비 칸에 넣으세요</div>' : '') +
      '</div></div>');
    ['rd', 'rn'].forEach(function (k) { body.querySelector('[data-k=' + k + ']').addEventListener('input', function () { body.querySelector('[data-k=auto]').checked = false; }); });
    App.dialog({
      title: '금형 · 설비 표', body: body, buttons: [{ label: '취소' }, {
        label: '저장', cls: 'primary', default: true, onClick: function (dd) {
          var g = function (k) { return body.querySelector('[data-k=' + k + ']').value.trim(); };
          var fam = g('fam');
          if (!/^\d{6}$/.test(fam)) { dd.error('제품군은 숫자 6자리입니다.'); return; }
          var old = {};
          (r.alts || []).forEach(function (a) { old[a[0]] = a[1]; });
          var alts = g('alts').split(/[,\s]+/).filter(Boolean).map(function (x) { return [+x, old[+x] || 0, 1]; });
          var keep = (r.alts || []).filter(function (a) { return a.length >= 3 && !a[2] && alts.every(function (x) { return x[0] !== a[0]; }); });
          App.api('PUT', '/api/plan/families/' + fam, { main_eq: g('main'), alts: alts.concat(keep), rate_d: g('rd'), rate_n: g('rn'), note: g('note'), auto: body.querySelector('[data-k=auto]').checked })
            .then(function () { dd.close(); App.toast('저장했습니다.'); famTab(); }).catch(function (e) { dd.error(e.message); });
        }
      }]
    });
  }

  // ---------------------------------------------------------------- 공통 동작
  function ov(add, del) {
    var p = add ? App.api('POST', '/api/plan/override', add) : Promise.resolve();
    if (del) {
      var o = (d.overrides || []).filter(function (x) { return x.kind === del.kind && (x.k1 || '').toUpperCase() === (del.k1 || '').toUpperCase(); })[0];
      if (o) p = App.api('DELETE', '/api/plan/override/' + o.id);
    }
    return p.then(load).catch(App.err);
  }
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]');
    if (t) { tab = t.dataset.t; App.store.set('plan_tab', tab); draw(); return; }
    var b = e.target.closest('[data-ovdel]');
    if (b) { App.api('DELETE', '/api/plan/override/' + b.dataset.ovdel).then(load).catch(App.err); return; }
    var ap = e.target.closest('[data-apply]');
    if (ap) { e.preventDefault(); var p = ap.dataset.apply.split('|'); ov({ kind: 'hours', k1: p[0], k2: p[1], val: p[2] }); return; }
    var ie = e.target.closest('[data-inc-edit]'), idn = e.target.closest('[data-inc-done]'), idl = e.target.closest('[data-inc-del]');
    if (ie) { var bx = $('[data-inc]'); incEdit((bx._rows || []).filter(function (x) { return String(x.id) === ie.dataset.incEdit; })[0] || {}); return; }
    if (idn) { App.api('DELETE', '/api/plan/incoming/' + idn.dataset.incDone + '?done=1').then(load).catch(App.err); return; }
    if (idl) { App.api('DELETE', '/api/plan/incoming/' + idl.dataset.incDel).then(load).catch(App.err); return; }
    var a = e.target.closest('[data-a]');
    if (!a) return;
    var act = a.dataset.a;
    if (act === 'ovclear') App.confirm('조정을 모두 지우고 규칙대로 다시 계산할까요?').then(function (ok) { if (ok) App.api('DELETE', '/api/plan/override').then(load).catch(App.err); });
    else if (act === 'wo') woDraft();
    else if (act === 'aicfg') aiCfg();
    else if (act === 'incadd') incEdit({});
    else if (act === 'aiopen') { if (App.ai && App.ai.open) App.ai.open(); }
    else if (act === 'xlsx') exportXlsx();
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.night) ov(t.value === 'auto' ? null : { kind: 'night', k1: t.dataset.night, val: t.value }, t.value === 'auto' ? { kind: 'night', k1: t.dataset.night } : null);
    else if (t.dataset.hours !== undefined) { var p = t.dataset.hours.split('|'); ov({ kind: 'hours', k1: p[0], k2: p[1], val: t.value || '기본' }); }
    else if (t.dataset.file !== undefined && t.files[0]) upload(t.files[0]);
    else if (t.dataset.up !== undefined) { viewDate = t.value; load(); }
    else if (t.dataset.start !== undefined) load();
  });
  function upload(f) {
    App.toast('납기 파일을 읽는 중…');
    f.arrayBuffer().then(function (buf) { return App.api('POST', '/api/plan/upload?name=' + encodeURIComponent(f.name), buf); })
      .then(function (r) { App.toast(r.file_date + ' 기준 납기 ' + r.items + '품번 (생산 필요 ' + r.need + ')을 읽었습니다.'); viewDate = ''; return load(); })
      .catch(App.err).then(function () { $('[data-file]').value = ''; });
  }
  function woDraft() {
    var st = (d && (d.default_start || d.start)) || App.today();
    var body = App.h('<div><div class="form">' +
      '<label class="f"><span>시작 날짜</span><input type="date" class="input" data-d1 value="' + st + '" min="' + st + '"></label>' +
      '<label class="f"><span>끝 날짜 (최대 7일)</span><input type="date" class="input" data-d2 value="' + st + '" min="' + st + '"></label></div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.6;font-size:12.5px">계획(' + st + ' 부터)을 날짜별로 잘라서, 설비마다 그날 교체할 제번(노랑)·차기생산품(초록)·야간생산 ★ 을 채웁니다.<br>' +
      '앞날을 계획대로 했다고 보고 이어서 만듭니다. 작업지시서가 없으면 전날 것을 넘겨받아 새로 만들고, 작성 중이면 그 칸만 고칩니다. 검토 · 승인된 날은 건너뜁니다.<br>' +
      '계획 시작일 = 오늘 (승인된 마지막 작업지시서가 오늘 이후면 그 다음 날)</div></div>');
    var i1 = body.querySelector('[data-d1]'), i2 = body.querySelector('[data-d2]');
    i1.onchange = function () { if (i2.value < i1.value) i2.value = i1.value; };
    App.dialog({
      title: '작업지시서 초안', body: body, buttons: [{ label: '취소' }, {
        label: '만들기', cls: 'primary', default: true, onClick: function (dd) {
          var go = function (over) {
            return App.api('POST', '/api/plan/workorder', { date: i1.value, date_to: i2.value, overwrite: over }).then(function (r) {
              if (r.exists) {
                return App.confirm(r.exists.join(', ') + ' 작업지시서가 이미 있습니다 (작성 중).\n계획대로 교체 제번·차기생산품·★ 칸을 덮어쓸까요?').then(function (ok) { if (ok) return go(true); });
              }
              dd.close();
              App.toast((r.made.length ? r.made.map(function (m) { return m.date.slice(5) + '(' + m.touched.length + '대)'; }).join(', ') + ' 작업지시서에 반영했습니다.' : '만든 작업지시서가 없습니다.') +
                (r.skipped.length ? ' 건너뜀: ' + r.skipped.map(function (x) { return x.date.slice(5) + ' ' + x.why; }).join(', ') : ''), r.made.length ? '' : 'warn');
              if (r.made.length) App.go('workorder', { date: r.made[0].date });
            });
          };
          go(false).catch(function (e) { dd.error(e.message); });
        }
      }]
    });
  }
  function aiCfg() {
    var ai = (d && d.ai) || {};
    var body = App.h('<div><div class="form">' +
      '<div class="f full"><span>&nbsp;</span><label class="chk"><input type="checkbox" data-k="on"' + (ai.on ? ' checked' : '') + '> AI 편성 도우미 사용</label></div>' +
      '<label class="f full"><span>Claude API 키 ' + (ai.key_set ? '(설정됨 — 바꿀 때만 입력)' : '') + '</span><input class="input" data-k="key" type="password" autocomplete="off" placeholder="sk-ant-…"></label>' +
      '<label class="f full"><span>모델</span><input class="input" data-k="model" value="' + esc(ai.model || 'claude-sonnet-5-5') + '"></label></div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.6;font-size:12.5px">· 키는 Anthropic Console(platform.claude.com)에서 만든 API 키입니다. 서버에만 저장되고 화면에는 다시 보이지 않습니다.<br>' +
      '· 이 키로 AI 에 보내는 것은 이 화면의 생산계획 자료(품번·수량·설비)와 질문뿐이고, AI 는 계획 조정 도구만 쓸 수 있습니다.<br>· 서버 PC 에서 인터넷이 되어야 합니다. 쓴 만큼 요금이 나옵니다.</div></div>');
    App.dialog({
      title: 'AI 설정 (관리자)', body: body, buttons: [{ label: '취소' }, { label: '키 지우기', onClick: function (dd) { App.api('PUT', '/api/plan/ai/config', { on: false, clear_key: true }).then(function () { dd.close(); load(); }); } }, {
        label: '저장', cls: 'primary', default: true, onClick: function (dd) {
          App.api('PUT', '/api/plan/ai/config', { on: body.querySelector('[data-k=on]').checked, key: body.querySelector('[data-k=key]').value, model: body.querySelector('[data-k=model]').value })
            .then(function () { dd.close(); App.toast('AI 설정을 저장했습니다.'); if (App.ai) App.ai.init(); load(); }).catch(function (e) { dd.error(e.message); });
        }
      }]
    });
  }
  function exportXlsx() {
    if (!d || d.none) return;
    var eqSheet = { name: '설비별', head: ['설비', '판단', '필요 +20일(주간 일수)', '필요 월말', '필요 익월말', '가능 주간 일수', '야간 회수', '특근 연장 제안', '생산 순서', '부족'],
      rows: d.eqs.filter(function (e) { return e.mode !== '없음'; }).map(function (e) {
        return [e.eq + '호기', e.mode, e.need_T, e.need_S, e.need_R, e.cap_day, e.nights || 0,
          Object.keys(e.ext || {}).map(function (k) { return k + ' ' + e.ext[k]; }).join(', '),
          (e.segs || []).map(function (s) { return s.fam + ' ' + Math.round(s.qty) + 'EA ' + s.start[0].slice(5) + '~' + s.end[0].slice(5); }).join(' / '),
          (e.short || []).map(function (s) { return s.fam + ' ' + s.qty; }).join(', ')];
      }) };
    var it = { name: '품번별', head: ['품번', '품명', '제품군', '설비', '+20일 결품', '월말 결품', '익월말 결품', '뺀 재고', '생산 EA', 'R/L', 'BOX', '어디까지', '시작', '끝', '월말 부족', '비고'],
      rows: d.rows.filter(function (r) { return r.plan > 0 || r.short > 0 || r.note; }).map(function (r) {
        return [r.code, r.name, r.fam, (r.eqs || []).join(','), r.T, r.S, r.R, r.ded, r.plan, r.plan_rl, r.plan_box, r.tier, r.start, r.end, r.short, r.note];
      }) };
    App.exportXlsx('생산계획_' + d.file_date + '.xlsx', [eqSheet, it]);
  }
  load();
};
