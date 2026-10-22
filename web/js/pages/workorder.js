/* 작업지시서 (주/야간 생산계획) 편성 — 엑셀 양식 그대로 보이고, 칸을 눌러 고침. 고치면 자동 저장 */
App.pages.workorder = function (root, args) {
  var canEdit = App.curLevel >= 2, canSign = App.curLevel >= 3;
  root.innerHTML = '<div class="wo-page">' +
    '<div class="toolbar no-print"><span data-period style="display:contents"></span>' +
    '<select class="input" data-list style="max-width:190px"><option value="">지난 작업지시서…</option></select>' +
    '<span class="wo-state muted" data-state></span><span class="grow"></span>' +
    '<label class="chk" title="설비별 최근 생산실적과 현 생산품을 비교해서 보여줌 (인쇄에는 안 나옴)"><input type="checkbox" data-hint> 실적 비교</label>' +
    '<button class="btn" data-a="sign_review">검토</button><button class="btn" data-a="sign_approve">승인</button><button class="btn" data-a="sign_cancel">결재 취소</button>' +
    '<button class="btn" data-a="print">인쇄</button><button class="btn" data-a="xlsx">엑셀로 저장</button>' +
    '<button class="btn" data-a="import">엑셀 가져오기</button><button class="btn danger" data-a="del">삭제</button>' +
    '</div><div data-body></div></div>';
  var body = root.querySelector('[data-body]');
  var stateEl = root.querySelector('[data-state]');
  var cur = null;           // {id, date, data, version, ...}
  var products = {};        // 제번(소문자) → 제품
  var hints = null;
  var saveTimer = null, saving = false, pending = false;
  // 실제 작성 방식: 교체 당일 = 노랑 (Die·제번·교체시간), 현 생산품 칸은 늘 연한 하늘색
  var LEGEND = [['FF0000', 'FFFFFF', '가동중단(3일 이하)'], ['0000FF', 'FFFFFF', '가동중단(3일 이상)'], ['FFFF00', '000000', '교체(당일)'],
    ['92D050', '000000', '교체(내일)'], ['B3A2C7', '000000', '교체(모레)']];
  var FILLS = [['', '없음'], ['B7DEE8', '현 생산품(기본)'], ['FF0000', '가동중단(3일 이하)'], ['0000FF', '가동중단(3일 이상)'], ['FFFF00', '교체(당일)'],
    ['92D050', '교체(내일)'], ['B3A2C7', '교체(모레)'], ['00FF00', '연두'], ['C0C0C0', '회색'], ['FDE9D9', '연분홍']];
  var FONTS = [['', '검정'], ['FF0000', '빨강'], ['0000FF', '파랑 (원재료 결품 · 야간생산 금지)'], ['FFFFFF', '흰색']];
  // 빠른 입력: [글자, 채우기, 글자색]  (누르면 실제 작성 방식의 색까지 같이 들어감)
  var Y_R = ['FFFF00', 'FF0000'], STOP = ['FF0000', 'FFFFFF'], NONE = ['', ''];
  var QUICK = {
    die: [['☞☞'].concat(NONE), ['출근즉시'].concat(Y_R), ['생산완료'].concat(Y_R), ['재료소진'].concat(Y_R), ['야간생산\n금지', '', '0000FF'],
      ['인원대기'].concat(STOP), ['재료대기'].concat(STOP), ['원재료대기'].concat(STOP), ['생산대기'].concat(STOP), ['금형수리'].concat(STOP),
      ['TRY'].concat(STOP), ['오더 완료'].concat(STOP), ['선별'].concat(STOP)],
    code: [['☞☞'].concat(NONE), ['??????'].concat(NONE)],
    time: [['생산준비', 'FFFF00', ''], ['출근즉시', 'FFFF00', ''], ['10시', 'FFFF00', ''], ['13시', 'FFFF00', ''], ['15시', 'FFFF00', ''], ['16시', 'FFFF00', ''],
      ['야간', 'FFFF00', ''], ['', '', '']],
    next: [], cur: []
  };
  var STOP_WORDS = ['인원대기', '재료대기', '원재료대기', '생산대기', '금형수리', 'TRY', '오더 완료', '선별'];

  // ---------------------------------------------------------------- 기간·목록
  var period = App.periodBar(root.querySelector('[data-period]'), 'date', { date: args.date || App.store.get('wo_date', App.today()) }, function (p) {
    App.store.set('wo_date', p.date); load(p.date);
  });
  function loadList() {
    App.get('/api/wo/list').then(function (l) {
      var sel = root.querySelector('[data-list]');
      sel.innerHTML = '<option value="">지난 작업지시서 (' + l.length + '장)…</option>' + l.map(function (x) {
        return '<option value="' + x.date + '">' + x.date + ' · ' + App.esc(x.status || '') + (x.written_by ? ' · ' + App.esc(x.written_by) : '') + '</option>';
      }).join('');
    }).catch(function () { /* 무시 */ });
  }
  root.querySelector('[data-list]').addEventListener('change', function (e) {
    if (e.target.value) { period.set({ date: e.target.value }); App.store.set('wo_date', e.target.value); load(e.target.value); e.target.value = ''; }
  });

  // ---------------------------------------------------------------- 그리기
  function esc(t) { return App.esc(t || ''); }
  // 한 칸 안의 글자색 여러 가지: c.r = [[글자, 'RRGGBB'|''], ...]
  function runsHtml(c) {
    if (!c.r || !c.r.length) return esc(c.t);
    return c.r.map(function (x) { return x[1] ? '<span style="color:#' + x[1] + '">' + esc(x[0]) + '</span>' : esc(x[0]); }).join('');
  }
  function cellHtml(c, path, cls) {
    c = c || { t: '' };
    var st = (c.fill ? 'background:#' + c.fill + ';' : '') + (c.font ? 'color:#' + c.font + ';' : '');
    var ghost = c.font === 'FFFFFF' && !c.fill && c.t ? ' ghost' : '';   // 흰 글씨로 숨겨 둔 내용 (화면에선 흐리게, 인쇄엔 안 보임)
    return '<td class="wc ' + (cls || '') + ghost + '" data-p="' + path + '" style="' + st + '">' + runsHtml(c) + '</td>';
  }
  function hintHtml(ln) {
    if (!hints || !ln) return '';
    var h = hints[ln.equip];
    if (!h || !h.length) return '<div class="wo-hint">실적 없음</div>';
    // 제번 표기 차이(H730141A-2 / 730141-2)는 같은 것으로 봄
    var loose = function (c) { return (c || '').toUpperCase().replace(/^H(?=\d)/, '').replace(/([0-9])[A-Z]+(?=-)/, '$1'); };
    var curCodes = codesIn(ln.cells.cur.t).map(loose);
    var codes = h.map(function (x) { return x.code; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var ok = codes.every(function (c) { return curCodes.indexOf(loose(c)) >= 0; });
    return '<div class="wo-hint ' + (ok ? '' : 'bad') + '">실적 ' + esc(h[0].date.slice(5)) + ' ' + esc(codes.join(', ')) + (ok ? '' : ' ≠') + '</div>';
  }
  function lineCells(side, i) {
    var ln = cur.data[side][i];
    if (!ln) return '<td class="wc empty"></td>'.repeat(6);
    var p = side + '.' + i;
    return '<td class="wc wlabel" data-p="' + p + '.label">' + (ln.star ? '<span class="wo-star">★</span>' : '') + esc(ln.label) + '</td>' +
      cellHtml(ln.cells.cur, p + '.cur', 'big').replace('</td>', hintHtml(ln) + '</td>') + cellHtml(ln.cells.die, p + '.die') + cellHtml(ln.cells.code, p + '.code', 'big') +
      cellHtml(ln.cells.time, p + '.time') + cellHtml(ln.cells.next, p + '.next', 'big');
  }
  function signBox() {
    var s = function (lab, who, at) {
      return '<td><div class="sg-h">' + lab + '</div><div class="sg-b">' + esc(who || '') + (at ? '<small>' + esc(at.slice(5, 16)) + '</small>' : '') + '</div></td>';
    };
    return '<table class="wo-sign"><tr>' + s('작성', cur.written_by, cur.written_at) + s('검토', cur.reviewed_by, cur.reviewed_at) + s('승인', cur.approved_by, cur.approved_at) + '</tr></table>';
  }
  function render() {
    if (!cur) return;
    var d = cur.data, n = Math.max(d.left.length, d.right.length);
    var h = ['<div class="wo-sheet' + (canEdit ? ' editable' : '') + '">',
      '<div class="wo-top"><div class="wo-legend"><span class="wo-prio"><span class="wo-star">★</span> 야간생산</span>' +
      LEGEND.map(function (l) { return '<span class="lg" style="background:#' + l[0] + ';color:#' + l[1] + '">' + l[2] + '</span>'; }).join('') +
      '</div>' + signBox() + '</div>',
      '<table class="wo"><colgroup>' + [8, 12.5, 8, 12.5, 7, 12.5, 8, 12.5, 8, 12.5, 7, 12.5].map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup>',
      '<tr class="wo-title"><td colspan="2" class="wday">' + esc(cur.day) + '</td><td colspan="8" class="wname">주/야간 생산계획</td>' +
      '<td colspan="2" class="wstat">' + statusTag(cur.status) + '</td></tr>',
      '<tr class="wh"><td colspan="2">현 생산품</td><td colspan="4">교체 계획</td><td colspan="2">현 생산품</td><td colspan="4">교체 계획</td></tr>',
      '<tr class="wh2">' + ['설비', '제    번', 'Die No', '제 번', '교체시간', '차기생산품', '설비', '제    번', 'Die No', '제 번', '교체시간', '차기생산품'].map(function (t) { return '<td>' + t + '</td>'; }).join('') + '</tr>'];
    for (var i = 0; i < n; i++) h.push('<tr class="wl">' + lineCells('left', i) + lineCells('right', i) + '</tr>');
    var rows = Math.max(d.t60.length, d.elec.length);
    var mid = Math.ceil((rows + 2) / 2);
    h.push('<tr class="wb-h"><td colspan="2" class="pink">60톤</td><td colspan="4" class="pink" style="color:#0000FF">파란색 제번은 원재료 결품 &amp; 부족</td>' +
      '<td colspan="2" class="pink">전자용</td><td rowspan="' + mid + '" class="pink">기타<br>전달사항</td>' + cellHtml(d.etc, 'etc', 'note').replace('<td', '<td colspan="3" rowspan="' + mid + '"') + '</tr>');
    h.push('<tr class="wh2">' + ['Die', '제    번', 'Die', '제    번', 'Die', '제    번', 'Die', '제    번'].map(function (t) { return '<td>' + t + '</td>'; }).join('') + '</tr>');
    for (var j = 0; j < rows; j++) {
      var r = '<tr class="wbl">';
      (d.t60[j] || []).forEach(function (pr, k) { r += cellHtml(pr.die, 't60.' + j + '.' + k + '.die') + cellHtml(pr.code, 't60.' + j + '.' + k + '.code', 'big'); });
      var e = d.elec[j] || { die: {}, code: {} };
      r += cellHtml(e.die, 'elec.' + j + '.die') + cellHtml(e.code, 'elec.' + j + '.code', 'big');
      if (j + 2 === mid) r += '<td rowspan="' + (rows + 2 - mid) + '" class="pink">금형<br>준비</td>' + cellHtml(d.prep, 'prep', 'note').replace('<td', '<td colspan="3" rowspan="' + (rows + 2 - mid) + '"');
      h.push(r + '</tr>');
    }
    h.push('</table></div>');
    body.innerHTML = h.join('');
  }
  function statusTag(s) {
    return '<span class="tag ' + (s === '승인' ? 'ok' : s === '검토' ? 'steel' : 'gray') + '">' + esc(s || '작성') + '</span>';
  }
  function setState(t, cls) { stateEl.textContent = t || ''; stateEl.className = 'wo-state ' + (cls || 'muted'); }

  // ---------------------------------------------------------------- 불러오기 / 만들기
  function load(date) {
    if (pending) { flush(); }
    body.innerHTML = '<div class="muted">불러오는 중…</div>';
    return App.get('/api/wo?date=' + date).then(function (r) {
      cur = r.doc;
      if (cur) cur.day = r.day;
      toggleButtons(!!cur);
      if (!cur) {
        setState('');
        body.innerHTML = '<div class="panel panel-b wo-empty"><h3 style="margin-top:0">' + esc(r.day) + ' 작업지시서가 없습니다.</h3>' +
          (canEdit ? (r.prev ? '<p><button class="btn primary" data-new="' + r.prev + '" data-mode="next">직전 작업지시서(' + r.prev + ')에서 다음날로 넘겨 만들기</button></p>' +
            '<p class="muted" style="font-size:12.5px;margin-top:-4px">교체 제번에 적힌 제품 → 현 생산품으로 올리고 제번은 ☞☞, 노랑(교체 당일)·생산완료·출근즉시·재료소진 지움, ' +
            '가동중단·야간생산 금지·★야간생산은 그대로, 차기생산품 보라(모레) → 초록(내일)</p>' +
            '<p><button class="btn" data-new="' + r.prev + '">직전 작업지시서(' + r.prev + ') 그대로 복사</button></p>' : '') +
            '<p><button class="btn" data-new="">빈 양식으로 만들기</button> <span class="muted">설비 목록과 설비별 최근 생산 제번으로 채움</span></p>' +
            '<p class="muted">예전 엑셀 작업지시서가 있으면 [엑셀 가져오기]로 한 번에 넣을 수 있습니다.</p>'
            : '<p class="muted">보기 권한만 있어서 새로 만들 수 없습니다.</p>') + '</div>';
        App.$$('[data-new]', body).forEach(function (b) {
          b.onclick = function () {
            App.api('POST', '/api/wo', { date: date, from_date: b.dataset.new || null, mode: b.dataset.mode || '' }).then(function (res) {
              App.toast('작업지시서를 만들었습니다.' + (b.dataset.mode ? '\n교체 반영: ' + (res.moved && res.moved.length ? res.moved.join(', ') : '없음') +
                '\n오늘 교체할 것·상태를 확인해서 고쳐 주세요.' : b.dataset.new ? ' (' + b.dataset.new + ' 복사)' : ''), '', 7000);
              loadList(); load(date);
            }).catch(App.err);
          };
        });
        return;
      }
      setState(cur.updated_by ? '마지막 저장 ' + (cur.updated || '').slice(5, 16) + ' ' + cur.updated_by : '');
      render();
      if (root.querySelector('[data-hint]').checked) loadHints();
    }).catch(App.err);
  }
  function toggleButtons(has) {
    App.$$('[data-a^=sign_], [data-a=del]', root).forEach(function (b) { b.style.display = has && canSign ? '' : 'none'; });
    App.$$('[data-a=print], [data-a=xlsx]', root).forEach(function (b) { b.style.display = has ? '' : 'none'; });
    root.querySelector('[data-a=import]').style.display = canEdit ? '' : 'none';
  }
  function loadHints() {
    App.get('/api/wo/hint?date=' + cur.date).then(function (h) { hints = h; render(); }).catch(App.err);
  }
  root.querySelector('[data-hint]').addEventListener('change', function (e) {
    if (e.target.checked) loadHints(); else { hints = null; render(); }
  });

  // ---------------------------------------------------------------- 저장 (고치면 1.5초 뒤 자동)
  function changed() {
    if (cur.status && cur.status !== '작성' && !cur._warned) {
      cur._warned = true;
      App.toast('결재된 작업지시서를 고치면 결재가 취소되고 다시 [작성] 상태가 됩니다.', 'warn', 6000);
    }
    pending = true;
    setState('저장 대기…', 'warn-t');
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1500);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!pending || saving || !cur) return;
    saving = true; pending = false;
    setState('저장 중…', 'warn-t');
    var doc = cur;
    App.api('PUT', '/api/wo/' + doc.id, { data: doc.data, version: doc.version }).then(function (r) {
      saving = false;
      doc.version = r.version;
      if (r.reset) { doc.status = '작성'; doc.reviewed_by = doc.approved_by = doc.reviewed_at = doc.approved_at = null; }
      doc.written_by = App.user; doc.written_at = App.today() + ' ' + new Date().toTimeString().slice(0, 8);
      setState('저장됨 ' + new Date().toTimeString().slice(0, 5), 'ok-t');
      if (doc === cur) render();
      if (pending) flush();
    }, function (e) {
      saving = false; pending = true;
      setState('저장 안 됨', 'bad-t');
      App.err(e);
    });
  }
  window.addEventListener('beforeunload', beforeUnload);
  function beforeUnload(e) { if (pending || saving) { flush(); e.preventDefault(); e.returnValue = ''; } }

  // ---------------------------------------------------------------- 칸 고치기
  function getCell(path) {
    var p = path.split('.'), d = cur.data;
    if (p[0] === 'etc' || p[0] === 'prep') return { get: function () { return d[p[0]]; }, set: function (c) { d[p[0]] = c; }, kind: 'note' };
    if (p[0] === 't60') return { get: function () { return d.t60[+p[1]][+p[2]][p[3]]; }, set: function (c) { d.t60[+p[1]][+p[2]][p[3]] = c; }, kind: p[3] === 'die' ? 'bdie' : 'code' };
    if (p[0] === 'elec') return { get: function () { return d.elec[+p[1]][p[2]]; }, set: function (c) { d.elec[+p[1]][p[2]] = c; }, kind: p[2] === 'die' ? 'bdie' : 'code' };
    var ln = d[p[0]][+p[1]];
    if (p[2] === 'label') return { line: ln, kind: 'label' };
    return { get: function () { return ln.cells[p[2]]; }, set: function (c) { ln.cells[p[2]] = c; }, kind: p[2], line: ln };
  }
  function codesIn(t) { return ((t || '').match(/[0-9A-Z]{3,}-[0-9A-Z]+/gi) || []); }
  function prodInfo(t) {
    var cs = codesIn(t);
    if (!cs.length) return '';
    return cs.map(function (c) {
      var p = products[c.toLowerCase()];
      return '<div>' + (p ? '<b>' + esc(c) + '</b> ' + esc(p.name || '') + ' <span class="muted">금형 ' + esc(p.mold_no || '-') + '</span>'
        : '<span class="tag warn">' + esc(c) + '</span> <span class="muted">제품 기준정보에 없음</span>') + '</div>';
    }).join('');
  }
  function editLabel(ln) {
    App.form({
      title: '설비 — ' + ln.label.replace(/\n/g, ' '), cols: [{ k: 'label', l: '설비 표시 (줄바꿈 가능)', t: 'memo' }, { k: 'star', l: '★ 야간생산', t: 'yesno' }],
      values: { label: ln.label, star: ln.star ? 1 : 0 },
      onSave: function (v) { ln.label = v.label; ln.star = !!+v.star; changed(); }
    });
  }
  // ---- 글자 편집칸 (드래그로 고른 부분만 글자색 바꾸기 가능)
  function hex(rgb) {
    var m = (rgb || '').match(/\d+/g);
    if (!m) return '';
    return m.slice(0, 3).map(function (x) { return ('0' + (+x).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  function readEditor(ed, base) {
    // 편집칸 → {t, r}  (base = 칸 글자색. 같은 색은 '')
    var runs = [], baseHex = base || '000000';
    function add(txt, col) {
      if (!txt) return;
      if (col === baseHex) col = '';
      var last = runs[runs.length - 1];
      if (last && last[1] === col) last[0] += txt; else runs.push([txt, col]);
    }
    function walk(n, first) {
      n.childNodes.forEach(function (ch, i) {
        if (ch.nodeType === 3) add(ch.nodeValue.replace(/ /g, ' '), hex(getComputedStyle(ch.parentElement).color));
        else if (ch.nodeName === 'BR') add('\n', runs.length ? runs[runs.length - 1][1] : '');
        else if (ch.nodeType === 1) {
          var block = /^(DIV|P)$/.test(ch.nodeName);
          if (block && runs.length && !/\n$/.test(runs[runs.length - 1][0])) add('\n', runs[runs.length - 1][1]);
          walk(ch);
        }
      });
    }
    walk(ed);
    // 끝 공백·줄바꿈 정리
    while (runs.length && !runs[runs.length - 1][0].replace(/\s+$/, '')) runs.pop();
    if (runs.length) runs[runs.length - 1][0] = runs[runs.length - 1][0].replace(/\s+$/, '');
    var t = runs.map(function (x) { return x[0]; }).join('');
    var colored = runs.some(function (x) { return x[1]; });
    return { t: t, r: colored ? runs : null };
  }
  function fillEditor(ed, c) {
    ed.innerHTML = (c.r && c.r.length ? c.r : [[c.t || '', '']]).map(function (x) {
      var h = esc(x[0]).replace(/\n/g, '<br>');
      return x[1] ? '<span style="color:#' + x[1] + '">' + h + '</span>' : h;
    }).join('') + (/\n$/.test(c.t || '') ? '<br>' : '');
  }
  function editCell(path) {
    var x = getCell(path);
    if (x.kind === 'label') { editLabel(x.line); return; }
    var c = JSON.parse(JSON.stringify(x.get() || { t: '', fill: '', font: '' }));
    var quick = QUICK[x.kind] || [];
    var title = x.line ? x.line.label.replace(/\n.*/, '') + ' · ' + ({ cur: '현 생산품', die: '교체 Die No / 상태', code: '교체 제번', time: '교체시간', next: '차기생산품' }[x.kind]) :
      ({ note: path === 'etc' ? '기타 전달사항' : '금형 준비', bdie: 'Die', code: '제번' }[x.kind] || '');
    var hint = x.line && hints && hints[x.line.equip] ? '<div class="muted" style="font-size:12px;margin-top:4px">이 설비 최근 실적: ' +
      hints[x.line.equip].map(function (h) { return esc(h.date.slice(5) + ' ' + h.code + ' ' + (h.reels || '') + '릴'); }).join(', ') + '</div>' : '';
    var memoBtn = /^(cur|code|next|bdie|note)$/.test(x.kind) || (x.kind === 'code') ?
      '<button type="button" class="btn small" data-memo title="줄을 바꿔 빨간 글씨 ( ) 를 넣음 — 릴 수·LOT·재질 메모">＋빨간 메모 ( )</button>' : '';
    var b = App.h('<div>' +
      '<div class="input wo-ed' + (x.kind === 'note' ? ' note' : '') + '" contenteditable="true" spellcheck="false"></div>' +
      '<div class="wo-quick">' + quick.map(function (q, i) {
        return '<button type="button" class="btn small" data-q="' + i + '" style="' + (q[1] ? 'background:#' + q[1] + ';' : '') + (q[2] ? 'color:#' + q[2] + ';' : '') + '">' +
          (q[0] ? esc(q[0].replace('\n', ' ')) : '지우기') + '</button>';
      }).join('') + memoBtn + '</div>' +
      '<div class="wo-prod" data-prod></div>' + hint +
      '<div class="wo-pal"><span class="muted">채우기</span>' + FILLS.map(function (f) {
        return '<button type="button" class="sw" data-fill="' + f[0] + '" title="' + f[1] + '" style="background:' + (f[0] ? '#' + f[0] : '#fff') + '">' + (f[0] ? '' : '✕') + '</button>';
      }).join('') + '<span class="muted" data-fname style="margin-left:6px;width:auto"></span></div>' +
      '<div class="wo-pal"><span class="muted">글자색</span>' + FONTS.map(function (f) {
        return '<button type="button" class="sw t" data-font="' + f[0] + '" title="' + f[1] + '" style="color:' + (f[0] ? '#' + f[0] : '#000') + ';' + (f[0] === 'FFFFFF' ? 'background:#666' : '') + '">가</button>';
      }).join('') + '<span class="muted" data-fsel style="margin-left:6px;width:auto"></span></div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:6px">글자색: 글자를 <b>드래그해서 고르고</b> 누르면 그 부분만, 고르지 않고 누르면 칸 전체 · Ctrl+Enter 로 적용</div></div>');
    var ed = b.querySelector('.wo-ed');
    fillEditor(ed, c);
    function hasSel() {
      var s = window.getSelection();
      return s.rangeCount && !s.isCollapsed && ed.contains(s.getRangeAt(0).commonAncestorContainer);
    }
    function sync() {
      App.$$('[data-fill]', b).forEach(function (s) { s.classList.toggle('on', s.dataset.fill === c.fill); });
      App.$$('[data-font]', b).forEach(function (s) { s.classList.toggle('on', s.dataset.font === c.font); });
      var f = FILLS.filter(function (z) { return z[0] === c.fill; })[0];
      b.querySelector('[data-fname]').textContent = f ? f[1] : '#' + c.fill;
      ed.style.background = c.fill ? '#' + c.fill : '';
      ed.style.color = c.font ? '#' + c.font : '#000';
      b.querySelector('[data-prod]').innerHTML = prodInfo(readEditor(ed, c.font).t);
    }
    function selInfo() { b.querySelector('[data-fsel]').textContent = hasSel() ? '← 고른 글자에만 적용됩니다' : ''; }
    document.addEventListener('selectionchange', selInfo);
    // 버튼을 눌러도 편집칸의 글자 선택이 풀리지 않게
    b.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    b.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.q !== undefined) {
        var q = quick[+t.dataset.q];
        c.fill = q[1]; c.font = q[2]; c.r = null;
        fillEditor(ed, { t: q[0] });
        ed.focus();
      }
      if (t.dataset.memo !== undefined) {
        ed.focus();
        var s = window.getSelection(), rg = document.createRange();
        rg.selectNodeContents(ed); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
        document.execCommand('styleWithCSS', false, true);
        if (readEditor(ed, c.font).t) document.execCommand('insertLineBreak');
        document.execCommand('foreColor', false, '#FF0000');
        document.execCommand('insertText', false, '()');
        s.modify('move', 'backward', 'character');
      }
      if (t.dataset.fill !== undefined) c.fill = t.dataset.fill;
      if (t.dataset.font !== undefined) {
        if (hasSel()) {
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, '#' + (t.dataset.font || '000000'));
          window.getSelection().collapseToEnd();
        } else {
          c.font = t.dataset.font;
          fillEditor(ed, { t: readEditor(ed, c.font).t });     // 칸 전체 색 → 부분 색은 없앰
        }
      }
      sync(); selInfo();
    });
    ed.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); App.$('.dlg-f .btn.primary', dlg.el).click(); return; }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    });
    ed.addEventListener('paste', function (e) {      // 붙여넣기는 글자만
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
    });
    ed.addEventListener('input', function () { b.querySelector('[data-prod]').innerHTML = prodInfo(readEditor(ed, c.font).t); });
    var dlg = App.dialog({
      title: title, body: b, closeOnBack: true, focus: '.wo-ed',
      onClose: function () { document.removeEventListener('selectionchange', selInfo); },
      buttons: [{ label: '취소' }, {
        label: '적용', cls: 'primary', onClick: function (d) {
          var v = readEditor(ed, c.font);
          c.t = v.t; c.r = v.r;
          if (!c.r) delete c.r;
          x.set(c);
          // 가동중단 상태를 넣으면 현 생산품 칸도 빨강(흰 글씨)로, ☞☞ 로 되돌리면 현 생산품 칸도 기본색으로 — 실제 작성 방식
          if (x.kind === 'die' && x.line) {
            var cc = x.line.cells.cur;
            var stop = c.fill === 'FF0000' || c.fill === '0000FF' || STOP_WORDS.indexOf(c.t.split('\n')[0]) >= 0 && c.fill;
            if (stop && cc.fill !== c.fill) { cc.fill = c.fill; cc.font = 'FFFFFF'; delete cc.r; }
            else if (!stop && (cc.fill === 'FF0000' || cc.fill === '0000FF')) { cc.fill = 'B7DEE8'; cc.font = ''; }
          }
          d.close(); changed();
        }
      }]
    });
    sync();
    // 커서를 맨 끝으로
    setTimeout(function () { var s = window.getSelection(), rg = document.createRange(); rg.selectNodeContents(ed); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); }, 40);
  }
  body.addEventListener('click', function (e) {
    var td = e.target.closest('td[data-p]');
    if (!td || !canEdit || !cur) return;
    editCell(td.dataset.p);
  });

  // ---------------------------------------------------------------- 버튼
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === 'print') { flush(); fitPrint(); window.print(); }
    else if (a === 'xlsx') { flush(); setTimeout(function () { location.href = '/api/wo/' + cur.id + '/xlsx'; }, pending || saving ? 800 : 0); }
    else if (a.indexOf('sign_') === 0) {
      var kind = a.slice(5);
      flush();
      var msg = { review: '검토 완료로 표시할까요?', approve: '승인할까요?', cancel: '결재(검토·승인)를 취소할까요?' }[kind];
      App.confirm(cur.date + ' 작업지시서\n' + msg, { review: '검토', approve: '승인', cancel: '결재 취소' }[kind]).then(function (ok) {
        if (ok) App.api('POST', '/api/wo/' + cur.id + '/sign', { kind: kind }).then(function () { App.toast('처리했습니다.'); loadList(); load(cur.date); }).catch(App.err);
      });
    } else if (a === 'del') {
      App.confirm(cur.date + ' 작업지시서를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/wo/' + cur.id).then(function () { App.toast('삭제했습니다.'); pending = false; loadList(); load(cur.date); }).catch(App.err);
      });
    } else if (a === 'import') {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx';
      inp.onchange = function () {
        var f = inp.files[0];
        if (!f) return;
        App.confirm(f.name + '\n이 파일의 작업지시서(시트마다 하루)를 가져옵니다.\n이미 있는 날짜는 건너뛸까요? [확인] 건너뜀 / [취소] 가져오기 취소', '가져오기').then(function (ok) {
          if (!ok) return;
          App.toast('가져오는 중…');
          f.arrayBuffer().then(function (buf) { return App.api('POST', '/api/wo/import', buf); }).then(function (r) {
            App.toast('작업지시서 가져오기\n' + r.report.join('\n'), '', 8000);
            loadList(); load(period.get().date);
          }).catch(App.err);
        });
      };
      inp.click();
    }
  });

  // ---------------------------------------------------------------- 인쇄: A4 가로 한 장에 맞춤
  // A4 가로(297×210mm)에서 여백 7mm 를 뺀 크기 ≈ 1069×740px → 여유를 두고 1060×725 안에 들어가게 줄임
  function fitPrint() {
    var sh = body.querySelector('.wo-sheet');
    if (!sh) return;
    sh.style.removeProperty('--wo-pw'); sh.style.removeProperty('--wo-pz');
    sh.classList.add('wo-measure');
    var h = sh.scrollHeight, w = Math.max(sh.scrollWidth, 1060);
    sh.classList.remove('wo-measure');
    var z = Math.min(1, 725 / h, 1060 / w);
    sh.style.setProperty('--wo-pz', z.toFixed(4));
    sh.style.setProperty('--wo-pw', Math.floor(1060 / z) + 'px');
  }
  window.addEventListener('beforeprint', fitPrint);

  App.refList('products').then(function (rows) { rows.forEach(function (p) { products[(p.code || '').toLowerCase()] = p; }); });
  loadList();
  load(period.get().date);
  return { destroy: function () { flush(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('beforeprint', fitPrint); } };
};
