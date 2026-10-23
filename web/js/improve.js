/* [개선제안] 2단계 화면 — 작업일보 스캔(OCR) / 현장 입력(태블릿) 관리 / 금형 위치 · 사진/도면 / 금형 유지비 · 부품 구매단가 /
   원재료 소요량 · 수율 · 발주 알림 / 거래명세서 입력
   서버: /api/scan, /api/floor, /api/moldx, /api/rmx, /api/invoice */
(function () {
  'use strict';
  var esc = App.esc, fmt = App.fmt;
  function tag(v, map) { return v ? '<span class="tag ' + (map[v] || '') + '">' + esc(v) + '</span>' : ''; }
  function pct(v, d) { return v === null || v === undefined ? '' : (v * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function won(v) { return v === null || v === undefined || v === '' ? '' : fmt(Math.round(v)); }
  function box(el) { var d = document.createElement('div'); d.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0'; el.appendChild(d); return d; }
  function pickFile(accept) {
    return new Promise(function (res) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = accept || '';
      i.onchange = function () { if (i.files[0]) res(i.files[0]); };
      i.click();
    });
  }
  function seg(root, onPick) {
    root.querySelector('.seg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      App.$$('.seg [data-v]', root).forEach(function (x) { x.classList.toggle('on', x === b); });
      onPick(b.dataset.v);
    });
  }
  if (!document.getElementById('improveCss')) {
    var st = document.createElement('style'); st.id = 'improveCss';
    st.textContent =
      '.mb-wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:10px;flex:1;min-height:0}' +
      '.mb-main{overflow:auto;min-height:0}.mb-side{overflow:auto;min-height:0}' +
      '.mb-eqs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px}' +
      '.mb-eq{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:6px 8px;min-height:74px}' +
      '.mb-eq.drop,.mb-col.drop{outline:2px dashed #2f6fd0;outline-offset:-2px}' +
      '.mb-eq .h{display:flex;justify-content:space-between;font-weight:700;margin-bottom:4px}.mb-eq .h span{font-weight:400;color:var(--muted);font-size:11.5px}' +
      '.mb-eq.miss{border-color:#e0a000}.mb-eq .wo{font-size:11px;color:var(--muted);margin-top:4px}' +
      '.mb-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}' +
      '.mb-col{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:6px 8px;min-height:80px}' +
      '.mb-col .h{font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between}' +
      '.chip{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line);border-radius:12px;padding:1px 8px;margin:2px;font-size:12px;cursor:grab;background:var(--bg,#fff);user-select:none}' +
      '.chip.sel{background:#2f6fd0;color:#fff;border-color:#2f6fd0}.chip i{font-style:normal;font-size:10px;opacity:.7}' +
      '.thumbs{display:flex;flex-wrap:wrap;gap:6px}.thumbs a{display:block;width:92px;height:72px;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#f4f4f4}' +
      '.thumbs img{width:100%;height:100%;object-fit:cover}' +
      '.sc-img{max-width:100%;border:1px solid var(--line);border-radius:6px;cursor:zoom-in}.sc-img.big{max-width:none;cursor:zoom-out}' +
      '.inv-t{border-collapse:collapse;font-size:12.5px;width:100%}.inv-t th{background:var(--line-2);padding:3px 4px;white-space:nowrap;position:sticky;top:0}' +
      '.inv-t td{border-bottom:1px solid var(--line-2);padding:1px 2px}.inv-t input,.inv-t select{width:100%;border:1px solid transparent;background:transparent;padding:2px 3px;font:inherit}' +
      '.inv-t input:focus,.inv-t select:focus{border-color:#2f6fd0;outline:none;background:var(--panel)}.inv-t tr.x td{opacity:.45}' +
      '.vbars{display:flex;align-items:flex-end;gap:6px;height:120px;padding:4px 0}.vbars .b{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:11px}' +
      '.vbars .b span{display:block;width:70%;background:#2f6fd0;border-radius:3px 3px 0 0}.vbars .b span.p{background:#7aa7e8}' +
      '@media (max-width:900px){.mb-wrap{grid-template-columns:1fr}}';
    document.head.appendChild(st);
  }

  // ================================================================ 작업일보 스캔 (OCR)
  App.pages.prod_scan = function (root) {
    var lv = App.curLevel || 0;
    function main() {
      root.innerHTML = '<div class="page-full"><div class="desc">작업일보를 <b>스캔(사진)</b>해서 올리면 PC 에 들어 있는 Windows 글자 인식(OCR)으로 설비 · 제번 · R/L · 시간 · 작업자를 읽어 ' +
        '<b>생산실적 하루치 입력</b> 화면에 채워 줍니다. 손글씨는 틀리게 읽을 수 있으니 <b>반드시 확인 · 고친 뒤 저장</b>하세요. 올린 그림은 서버에 보관됩니다 (나중에 근거 확인 · LOT 추적).<br>' +
        '인쇄된 글자는 잘 읽으므로 <b>[작업일보 양식 인쇄]</b>로 설비 · 제번이 미리 찍힌 양식을 쓰면 정확도가 높아집니다.</div>' +
        '<div class="toolbar"><span data-period style="display:contents"></span><span class="grow"></span>' +
        '<button class="btn" data-a="form">작업일보 양식 인쇄</button>' +
        (lv >= 2 ? '<button class="btn primary" data-a="up">작업일보 올리기 (그림)</button>' : '') +
        (lv >= 3 ? '<button class="btn danger" data-a="del">삭제</button>' : '') + '</div>' +
        '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">목록에서 고르면 그림과 읽은 내용이 보입니다.</div></div></div></div>';
      var right = root.querySelector('.right');
      var grid = new App.Grid(root.querySelector('.left'), {
        cols: [{ k: 'date', l: '생산일', w: 80 }, { k: 'file_name', l: '파일', w: 160 },
          { k: 'status', l: '상태', w: 55, center: true, fmt: function (v) { return tag(v, { '반영': 'ok', '읽음': 'warn' }); } },
          { k: 'created', l: '올린 시각', w: 120 }, { k: 'created_by', l: '올린 사람', w: 70 }, { k: 'applied_by', l: '반영', w: 70 }],
        sort: { k: 'date', dir: -1 }, onSelect: function (r) { show(r.id); }
      });
      var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('scan_p', { d1: App.addDays(-30), d2: App.today() }), function (p) { App.store.set('scan_p', p); load(); });
      function load(sel) {
        var p = period.get();
        App.get('/api/scan/list?d1=' + (p.d1 || '') + '&d2=' + (p.d2 || '')).then(function (r) { grid.setRows(r); if (sel) grid.selectKey(sel, true); }).catch(App.err);
      }
      function show(id) {
        right.innerHTML = '<div class="panel-b muted">불러오는 중…</div>';
        App.get('/api/scan/' + id).then(function (s) {
          var warn = s.rows.filter(function (r) { return r._warn && r._warn.length; }).length;
          right.innerHTML = '<div class="panel-h">' + esc(s.date) + ' 작업일보<span class="grow"></span>' + tag(s.status, { '반영': 'ok', '읽음': 'warn' }) + '</div><div class="panel-b">' +
            '<div class="notice" style="margin-bottom:8px">읽은 줄 <b>' + s.rows.length + '</b>' + (warn ? ' · 확인 필요 <b>' + warn + '</b>' : '') + '</div>' +
            (lv >= 2 ? '<div style="margin-bottom:8px"><button class="btn primary" data-go>생산실적 하루치 입력으로 보내기 →</button></div>' : '') +
            '<table class="mini" style="width:100%;margin-bottom:8px"><tr><th>설비</th><th>제번</th><th>주간</th><th>야간</th><th>시작</th><th>종료</th><th>작업자</th><th>확인</th></tr>' +
            s.rows.map(function (r) {
              return '<tr' + (r._warn && r._warn.length ? ' style="background:#fff6e0"' : '') + '><td>' + esc(r.equip_no || '') + '</td><td>' + esc(r.code || '') + '</td><td class="num">' + esc(r.day_reels == null ? '' : r.day_reels) +
                '</td><td class="num">' + esc(r.night_reels == null ? '' : r.night_reels) + '</td><td>' + esc(r.start_time || '') + '</td><td>' + esc(r.end_time || '') + '</td><td>' + esc(r.day_worker || r.night_worker || '') +
                '</td><td class="muted" style="font-size:11px">' + esc((r._warn || []).join(', ')) + '</td></tr>';
            }).join('') + '</table>' +
            '<img class="sc-img" src="/api/scan/' + s.id + '/image" alt="스캔">' +
            '<details style="margin-top:6px"><summary class="muted">읽은 글자 전체</summary><pre style="white-space:pre-wrap;font-size:11.5px">' + esc(s.text || '') + '</pre></details></div>';
          right.querySelector('.sc-img').onclick = function () { this.classList.toggle('big'); };
          var go = right.querySelector('[data-go]');
          if (go) go.onclick = function () { day(s); };
        }).catch(App.err);
      }
      function day(s) {
        root.innerHTML = '';
        App.prodDay(root, s.date, function () { main(); }, { date: s.date, rows: s.rows, scanId: s.id });
      }
      function upload() {
        var body = App.h('<div><div class="form"><label class="f"><span>생산일</span><input type="date" class="input" data-d value="' + App.addDays(-1) + '"></label>' +
          '<label class="f full"><span>그림 파일 (JPG · PNG · BMP · TIF) *</span><input type="file" accept="image/*" data-f></label></div>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">그림 안에 날짜(2026-10-21 처럼)가 있으면 그 날짜를 씁니다. 읽는 데 몇 초 걸립니다.</div></div>');
        App.dialog({ title: '작업일보 올리기', body: body, buttons: [{ label: '취소' }, { label: '올리고 읽기', cls: 'primary', onClick: function (d) {
          var f = body.querySelector('[data-f]').files[0];
          if (!f) return d.error('그림 파일을 고르세요.');
          d.busy(true); d.error('글자를 읽는 중…');
          f.arrayBuffer().then(function (buf) {
            return App.api('POST', '/api/scan?name=' + encodeURIComponent(f.name) + '&date=' + body.querySelector('[data-d]').value, buf);
          }).then(function (r) {
            d.close(); App.toast(r.rows.length + '줄을 읽었습니다.');
            load(r.id); show(r.id);
          }).catch(function (e) { d.busy(false); d.error(e.message); });
        } }] });
      }
      function printForm() {
        var body = App.h('<div class="form"><label class="f"><span>생산일</span><input type="date" class="input" data-d value="' + App.today() + '"></label></div>');
        App.dialog({ title: '작업일보 양식 인쇄', body: body, buttons: [{ label: '취소' }, { label: '인쇄', cls: 'primary', default: true, onClick: function (d) {
          var dt = body.querySelector('[data-d]').value;
          App.get('/api/production/from_wo?date=' + dt).then(function (w) { d.close(); printSheet(dt, w.rows); })
            .catch(function (e) { d.error(e.message + ' — 빈 양식으로 인쇄합니다.'); setTimeout(function () { d.close(); printSheet(dt, []); }, 900); });
        } }] });
      }
      root.querySelector('.toolbar').addEventListener('click', function (e) {
        var a = e.target.dataset && e.target.dataset.a; if (!a) return;
        if (a === 'up') upload();
        else if (a === 'form') printForm();
        else if (a === 'del') {
          var r = grid.selected(); if (!r) return App.toast('목록에서 먼저 고르세요.', 'warn');
          App.confirm(r.date + ' 작업일보 스캔을 삭제할까요? (그림도 지웁니다. 이미 넣은 생산실적은 그대로)', '삭제', true).then(function (ok) {
            if (ok) App.api('DELETE', '/api/scan/' + r.id).then(function () { right.innerHTML = ''; load(); }).catch(App.err);
          });
        }
      });
      load();
    }
    main();
  };
  // OCR 이 잘 읽도록: 큰 글씨 · 굵은 칸 · 머리글 낱말은 서버(scan.py HEAD)와 같게
  function printSheet(date, rows) {
    var H = ['설비', '제번', '주간', '야간', '시작', '종료', '셋업', '초품', '금형수리', '설비수리', '기타', '작업자', '코일LOT', '비고'];
    var n = Math.max(rows.length + 4, 14);
    var tr = [];
    for (var i = 0; i < n; i++) {
      var r = rows[i] || {};
      tr.push('<tr><td>' + esc(r.equip_no ? r.equip_no + '호기' : '') + '</td><td>' + esc(r.code || '') + '</td>' + H.slice(2).map(function () { return '<td></td>'; }).join('') + '</tr>');
    }
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.contentDocument.open();
    fr.contentDocument.write('<!doctype html><html><head><meta charset="utf-8"><title>작업일보 ' + esc(date) + '</title><style>' +
      '@page{size:A4 landscape;margin:10mm}body{font-family:"Malgun Gothic",sans-serif}h1{font-size:18pt;margin:0 0 6px}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1.5px solid #000;height:30px;font-size:13pt;padding:2px 4px}th{background:#eee;font-size:12pt}' +
      '</style></head><body><h1>작업일보 ' + esc(date) + '</h1><p style="font-size:10pt;margin:0 0 6px">숫자는 칸 안에 또박또박 · R/L 은 소수점까지 · 시간은 08:30 처럼 · 비가동은 분</p>' +
      '<table><tr>' + H.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>' + tr.join('') + '</table></body></html>');
    fr.contentDocument.close();
    setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 2000); }, 300);
  }

  // ================================================================ 현장 입력 (태블릿) — 사무실용 관리 화면
  App.pages.floor_admin = function (root) {
    var lv = App.curLevel || 0;
    var url = location.origin + '/floor';
    root.innerHTML = '<div class="page-full"><div class="desc">현장 태블릿(또는 휴대폰)에서 <b>' + esc(url) + '</b> 를 열면, 설비를 누르고 <b>작업 시작 → 비가동(사유) → 작업 종료(R/L)</b> 만 누르면 ' +
      '생산실적이 저절로 들어갑니다. 같은 날 같은 설비 · 제번 줄이 있으면 R/L · 비가동 분이 더해집니다. 초품 승인 인터락이 켜져 있으면 승인 전 종료한 작업은 <b>미반영</b>으로 남고, 승인 뒤 [다시 반영]을 누르면 됩니다.<br>' +
      '<span class="muted">나중에 프레스 타수 카운터를 달면 이 기록에 타수를 자동으로 붙여 실시간 가동률 · 자재 소모까지 볼 수 있습니다.</span></div>' +
      '<div class="toolbar"><a class="btn primary" href="/floor" target="_blank">태블릿 화면 열기</a><button class="btn" data-a="copy">주소 복사</button>' +
      '<span data-period style="display:contents"></span><span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn" data-a="retry">다시 반영</button><button class="btn danger" data-a="cancel">작업 취소</button>' : '') + '</div>' +
      '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var grid = new App.Grid(root.querySelector('.gridbox'), {
      cols: [{ k: 'date', l: '생산일', w: 80 }, { k: 'equip_no', l: '설비', w: 45, center: true }, { k: 'code', l: '제번', w: 95 }, { k: 'worker', l: '작업자', w: 65 },
        { k: 'start_ts', l: '시작', w: 110 }, { k: 'end_ts', l: '종료', w: 110 }, { k: 'elapsed', l: '경과(분)', t: 'int', w: 60 },
        { k: 'day_reels', l: '주간 R/L', t: 'num', w: 60 }, { k: 'night_reels', l: '야간 R/L', t: 'num', w: 60 },
        { k: 'down', l: '비가동(분)', w: 160, val: function (r) { return Object.keys(r.down_min || {}).map(function (k) { return { dt_setup: '셋업', dt_first: '초품', dt_mold: '금형수리', dt_equip: '설비수리', dt_etc: '기타' }[k] + ' ' + r.down_min[k]; }).join(', '); } },
        { k: 'coil_lot', l: '코일 LOT', w: 90 },
        { k: 'status', l: '상태', w: 60, center: true, fmt: function (v) { return tag(v, { '반영': 'ok', '진행': 'steel', '미반영': 'bad', '종료': 'warn' }); } },
        { k: 'error', l: '미반영 이유', w: 260 }],
      sort: { k: 'start_ts', dir: -1 }, rowClass: function (r) { return r.status === '미반영' ? 'r-bad' : r.status === '진행' ? 'r-warn' : ''; }
    });
    var period = App.periodBar(root.querySelector('[data-period]'), 'range', { d1: App.addDays(-7), d2: App.today() }, load);
    function load() { var p = period.get(); App.get('/api/floor/runs?d1=' + p.d1 + '&d2=' + p.d2).then(function (r) { grid.setRows(r); }).catch(App.err); }
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'copy') { try { navigator.clipboard.writeText(url); App.toast('주소를 복사했습니다: ' + url); } catch (x) { App.toast(url); } return; }
      var r = grid.selected(); if (!r) return App.toast('목록에서 먼저 고르세요.', 'warn');
      if (a === 'retry') App.api('POST', '/api/floor/' + r.id + '/retry', {}).then(function (x) { App.toast(x.ok ? '생산실적에 반영했습니다.' : x.error, x.ok ? '' : 'bad'); load(); }).catch(App.err);
      else if (a === 'cancel') App.confirm(r.equip_no + '호기 ' + r.code + ' 작업 기록을 지울까요?', '삭제', true).then(function (ok) {
        if (ok) App.api('DELETE', '/api/floor/' + r.id).then(load).catch(App.err);
      });
    });
    load();
  };

  // ================================================================ 금형 위치 (현황판) · 사진/도면
  App.pages.mold_board = function (root) {
    var lv = App.curLevel || 0;
    var data = null, sel = null;
    root.innerHTML = '<div class="page-full"><div class="toolbar"><b>금형 위치</b><input class="input search" placeholder="금형 · 품번 · 제번 찾기" style="width:200px">' +
      '<span class="muted" style="font-size:12px" data-wo></span><span class="grow"></span>' +
      (lv >= 2 ? '<span class="muted" style="font-size:12px">금형을 끌어다 설비 · 칸에 놓으면 이동</span>' : '') + '<button class="btn" data-a="hist">이동 이력</button></div>' +
      '<div class="mb-wrap"><div class="mb-main"></div><div class="mb-side panel"><div class="panel-b muted">금형을 누르면 정보 · 사진 · 도면 · 이동 이력이 보입니다.</div></div></div></div>';
    var main = root.querySelector('.mb-main'), side = root.querySelector('.mb-side'), search = root.querySelector('.search');
    function chip(m) {
      return '<span class="chip' + (sel === m.mold_no ? ' sel' : '') + '" draggable="' + (lv >= 2) + '" data-m="' + esc(m.mold_no) + '" title="' + esc((m.part_name || '') + ' ' + (m.codes || []).join(',')) + '">' +
        esc(m.mold_no) + (m.photos ? '<i>📷</i>' : '') + (m.drawings ? '<i>📐</i>' : '') + '</span>';
    }
    function draw() {
      var q = search.value.trim().toLowerCase();
      var hit = function (m) { return !q || (m.mold_no + ' ' + (m.part_no || '') + ' ' + (m.part_name || '') + ' ' + m.codes.join(' ')).toLowerCase().indexOf(q) >= 0; };
      var byNo = {}; data.molds.forEach(function (m) { byNo[m.mold_no] = m; });
      root.querySelector('[data-wo]').textContent = data.wo_date ? '작업지시서 ' + data.wo_date + ' 기준 비교' : '';
      var h = '<h3 style="margin:2px 0 6px">설비 장착</h3><div class="mb-eqs">' + data.equips.map(function (e) {
        return '<div class="mb-eq' + (e.mismatch.length ? ' miss' : '') + '" data-drop="설비 장착" data-place="' + esc(e.no) + '"><div class="h">' + esc(e.no) + '호기<span>' + esc((e.maker || '') + ' ' + (e.ton ? e.ton + 'T' : '')) + '</span></div>' +
          e.molds.map(function (no) { return byNo[no] && hit(byNo[no]) ? chip(byNo[no]) : ''; }).join('') +
          (e.wo_codes.length ? '<div class="wo">지시서: ' + esc(e.wo_codes.join(', ')) + (e.mismatch.length ? ' <b style="color:#b07000">→ ' + esc(e.mismatch.join(', ')) + ' 미장착</b>' : '') + '</div>' : '') + '</div>';
      }).join('') + '</div><div class="mb-cols">' + data.states.filter(function (s) { return s !== '설비 장착'; }).map(function (s) {
        var ms = data.molds.filter(function (m) { return m.state === s && hit(m); });
        var groups = {};
        ms.forEach(function (m) { (groups[m.place || ''] = groups[m.place || ''] || []).push(m); });
        return '<div class="mb-col" data-drop="' + s + '"><div class="h">' + s + '<span class="muted">' + ms.length + '</span></div>' +
          Object.keys(groups).sort().map(function (p) { return (p ? '<div class="muted" style="font-size:11px;margin-top:3px">' + esc(p) + '</div>' : '') + groups[p].map(chip).join(''); }).join('') + '</div>';
      }).join('') + '</div>';
      main.innerHTML = h;
    }
    function load() { return App.get('/api/moldx/board').then(function (d) { data = d; draw(); if (sel) detail(sel); }).catch(App.err); }
    function moveDlg(nos, state, place) {
      var body = App.h('<div><div class="notice" style="margin-bottom:8px">' + esc(nos.join(', ')) + '</div><div class="form">' +
        '<label class="f"><span>이동 *</span><select class="input" data-k="state">' + data.states.map(function (s) { return '<option' + (s === state ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>위치 (설비번호 · 보관 랙 · 외주업체)</span><input class="input" data-k="place" value="' + esc(place || '') + '" list="mbPlaces"></label>' +
        '<label class="f"><span>작업자</span><input class="input" data-k="worker" list="' + App.datalist('workers') + '" value="' + esc(App.user || '') + '"></label>' +
        '<label class="f full"><span>비고</span><input class="input" data-k="note"></label></div>' +
        '<datalist id="mbPlaces">' + data.equips.map(function (e) { return '<option value="' + esc(e.no) + '">' + esc(e.no) + '호기</option>'; }).join('') + '</datalist></div>');
      App.dialog({ title: '금형 이동', body: body, buttons: [{ label: '취소' }, { label: '이동', cls: 'primary', default: true, onClick: function (d) {
        var v = {}; ['state', 'place', 'worker', 'note'].forEach(function (k) { v[k] = body.querySelector('[data-k=' + k + ']').value.trim(); });
        v.mold_nos = nos;
        d.busy(true);
        App.api('POST', '/api/moldx/move', v).then(function () { d.close(); App.toast('이동했습니다.'); load(); }).catch(function (e) { d.busy(false); d.error(e.message); });
      } }] });
    }
    function detail(no) {
      sel = no;
      var m = data.molds.filter(function (x) { return x.mold_no === no; })[0];
      if (!m) { side.innerHTML = ''; return; }
      Promise.all([App.get('/api/moldx/files?mold_no=' + encodeURIComponent(no)), App.get('/api/moldx/moves?mold_no=' + encodeURIComponent(no))]).then(function (res) {
        var files = res[0], mv = res[1];
        var photos = files.filter(function (f) { return f.kind === '사진'; }), dws = files.filter(function (f) { return f.kind !== '사진'; });
        side.innerHTML = '<div class="panel-h">' + esc(no) + '<span class="grow"></span>' + tag(m.state, { '설비 장착': 'ok', '보관': 'gray', '사내 수리': 'warn', '외주 수리': 'warn', '폐기': 'bad' }) + '</div><div class="panel-b">' +
          '<div class="kv" style="margin-bottom:8px"><span class="k">품번 · 품명</span><span>' + esc((m.part_no || '') + ' ' + (m.part_name || '')) + '</span>' +
          '<span class="k">위치</span><span>' + esc(m.state + ' ' + (m.place ? (m.state === '설비 장착' ? m.place + '호기' : m.place) : '')) + (m.since ? ' <span class="muted">(' + esc(m.since.slice(0, 16)) + '~)</span>' : '') + '</span>' +
          '<span class="k">쓰는 제번</span><span>' + esc(m.codes.join(', ')) + '</span></div>' +
          (lv >= 2 ? '<div style="margin-bottom:10px"><button class="btn small primary" data-mv>이동</button> <button class="btn small" data-up="사진">사진 올리기</button> <button class="btn small" data-up="도면">도면 올리기</button></div>' : '') +
          '<div class="muted" style="font-size:12px;margin-bottom:4px">사진 ' + photos.length + '</div><div class="thumbs" style="margin-bottom:10px">' +
          photos.map(function (f) { return '<a href="/api/moldx/files/' + f.id + '" target="_blank" title="' + esc((f.title || f.file_name) + ' ' + (f.rev_date || '')) + '"><img loading="lazy" src="/api/moldx/files/' + f.id + '"></a>'; }).join('') + '</div>' +
          '<div class="muted" style="font-size:12px;margin-bottom:4px">도면 · 기타</div><table class="mini" style="width:100%;margin-bottom:10px">' +
          (dws.length ? dws.map(function (f) {
            return '<tr' + (f.current ? '' : ' class="muted"') + '><td><a href="/api/moldx/files/' + f.id + '" target="_blank">' + esc(f.title || f.file_name) + '</a></td><td>rev.' + esc(f.rev || '-') + '</td><td>' + esc(f.rev_date || '') + '</td><td>' + (f.current ? '<span class="tag ok">최신</span>' : '지난 판') + '</td>' +
              (lv >= 3 ? '<td><button class="btn small" data-delf="' + f.id + '">✕</button></td>' : '') + '</tr>';
          }).join('') : '<tr><td class="muted">없음</td></tr>') + '</table>' +
          '<div class="muted" style="font-size:12px;margin-bottom:4px">이동 이력</div><table class="mini" style="width:100%">' +
          (mv.length ? mv.slice(0, 30).map(function (x) { return '<tr><td>' + esc(x.ts.slice(0, 16)) + '</td><td>' + esc((x.from_state || '') + ' → ' + x.state + ' ' + (x.place || '')) + '</td><td>' + esc(x.worker || '') + '</td></tr>'; }).join('') : '<tr><td class="muted">없음</td></tr>') + '</table></div>';
        var b = side.querySelector('[data-mv]'); if (b) b.onclick = function () { moveDlg([no], m.state, m.place); };
        App.$$('[data-up]', side).forEach(function (u) { u.onclick = function () { upload(no, u.dataset.up); }; });
        App.$$('[data-delf]', side).forEach(function (x) {
          x.onclick = function () { App.confirm('이 파일을 지울까요?', '삭제', true).then(function (ok) { if (ok) App.api('DELETE', '/api/moldx/files/' + x.dataset.delf).then(load).catch(App.err); }); };
        });
        draw();
      }).catch(App.err);
    }
    function upload(no, kind) {
      var body = App.h('<div class="form"><label class="f full"><span>제목' + (kind === '도면' ? ' (같은 제목으로 올리면 새 판)' : '') + '</span><input class="input" data-k="title"></label>' +
        (kind === '도면' ? '<label class="f"><span>개정 번호</span><input class="input" data-k="rev"></label>' : '') +
        '<label class="f"><span>날짜</span><input class="input" type="date" data-k="rev_date" value="' + App.today() + '"></label>' +
        '<label class="f full"><span>파일 *</span><input type="file" data-f ' + (kind === '사진' ? 'accept="image/*" multiple' : '') + '></label></div>');
      App.dialog({ title: no + ' ' + kind + ' 올리기', body: body, buttons: [{ label: '취소' }, { label: '올리기', cls: 'primary', onClick: function (d) {
        var fs = Array.prototype.slice.call(body.querySelector('[data-f]').files);
        if (!fs.length) return d.error('파일을 고르세요.');
        var qs = 'mold_no=' + encodeURIComponent(no) + '&kind=' + encodeURIComponent(kind) + ['title', 'rev', 'rev_date'].map(function (k) { var el = body.querySelector('[data-k=' + k + ']'); return el ? '&' + k + '=' + encodeURIComponent(el.value.trim()) : ''; }).join('');
        d.busy(true);
        fs.reduce(function (p, f) { return p.then(function () { return f.arrayBuffer(); }).then(function (buf) { return App.api('POST', '/api/moldx/files?' + qs + '&name=' + encodeURIComponent(f.name), buf); }); }, Promise.resolve())
          .then(function () { d.close(); App.toast(fs.length + '개 올렸습니다.'); load(); }).catch(function (e) { d.busy(false); d.error(e.message); });
      } }] });
    }
    main.addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (c) detail(c.dataset.m); });
    main.addEventListener('dragstart', function (e) { var c = e.target.closest('.chip'); if (c) e.dataTransfer.setData('text/plain', c.dataset.m); });
    main.addEventListener('dragover', function (e) { var t = e.target.closest('[data-drop]'); if (t && lv >= 2) { e.preventDefault(); t.classList.add('drop'); } });
    main.addEventListener('dragleave', function (e) { var t = e.target.closest('[data-drop]'); if (t) t.classList.remove('drop'); });
    main.addEventListener('drop', function (e) {
      var t = e.target.closest('[data-drop]'); if (!t) return;
      e.preventDefault(); t.classList.remove('drop');
      var no = e.dataTransfer.getData('text/plain'); if (!no) return;
      moveDlg([no], t.dataset.drop, t.dataset.place || '');
    });
    search.addEventListener('input', draw);
    root.querySelector('[data-a=hist]').onclick = function () {
      App.get('/api/moldx/moves?d1=' + App.addDays(-90)).then(function (rows) {
        var host = App.h('<div style="height:60vh;display:flex;flex-direction:column"></div>');
        var d = App.dialog({ title: '금형 이동 이력 (최근 90일)', wide: true, body: host });
        var g = new App.Grid(host, { cols: [{ k: 'ts', l: '일시', w: 120 }, { k: 'mold_no', l: '금형', w: 80 }, { k: 'from_state', l: '전', w: 70 }, { k: 'from_place', l: '전 위치', w: 70 },
          { k: 'state', l: '이동', w: 70 }, { k: 'place', l: '위치', w: 70 }, { k: 'worker', l: '작업자', w: 65 }, { k: 'note', l: '비고', w: 150 }], sort: { k: 'ts', dir: -1 } });
        g.setRows(rows);
        return d;
      }).catch(App.err);
    };
    load();
  };

  // ================================================================ 금형 유지비 · 부품 구매단가
  App.pages.mold_cost = function (root) {
    var view = App.store.get('mc_view', 'cost');
    root.innerHTML = '<div class="page-full"><div class="toolbar"><div class="seg"><button class="btn' + (view === 'cost' ? ' on' : '') + '" data-v="cost">금형별 유지비</button>' +
      '<button class="btn' + (view === 'price' ? ' on' : '') + '" data-v="price">부품 구매단가</button></div><span data-period style="display:contents"></span>' +
      '<input class="input search" placeholder="검색"><span class="grow"></span><button class="btn" data-a="xlsx">엑셀로 저장</button></div><div data-top></div>' +
      '<div data-box style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var top = root.querySelector('[data-top]'), bx = root.querySelector('[data-box]'), search = root.querySelector('.search');
    var grid = null, gname = '';
    var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('mc_p', { d1: App.today().slice(0, 4) + '-01-01', d2: App.today() }), function (p) { App.store.set('mc_p', p); load(); });
    function mkGrid(o) { bx.innerHTML = ''; grid = new App.Grid(box(bx), o); grid.setFilter(search.value); return grid; }
    function load() {
      var p = period.get(), qs = '?d1=' + p.d1 + '&d2=' + p.d2;
      if (view === 'cost') App.get('/api/moldx/cost' + qs).then(function (c) {
        var mx = Math.max.apply(null, c.months.map(function (m) { return m.repair + m.parts; }).concat([1]));
        top.innerHTML = '<div class="cols2" style="margin-bottom:8px;align-items:stretch"><div class="panel"><div class="panel-b"><div class="wo-nums"><span><b>' + won(c.total.repair_cost + c.total.parts_cost) + '</b>유지비 합계 (원)</span>' +
          '<span><b>' + won(c.total.repair_cost) + '</b>수리비</span><span><b>' + won(c.total.parts_cost) + '</b>부품 출고 금액</span><span><b>' + fmt(c.total.repairs) + '</b>수리 건수</span></div>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">수리비 = 수리이력의 수리비용 · 부품 출고 금액 = 부품 출고 수량 × 부품 단가</div></div></div>' +
          '<div class="panel"><div class="panel-b"><div class="vbars">' + c.months.map(function (m) {
            return '<div class="b" title="' + esc(m.ym) + ' 수리비 ' + won(m.repair) + ' / 부품 ' + won(m.parts) + '"><span class="p" style="height:' + (m.parts / mx * 100) + '%"></span><span style="height:' + (m.repair / mx * 100) + '%"></span>' + esc(m.ym.slice(5)) + '월</div>';
          }).join('') + '</div><div class="muted" style="font-size:11px">진한 색 수리비 · 연한 색 부품</div></div></div></div>';
        gname = '금형유지비';
        mkGrid({ key: 'mold_no', cols: [{ k: 'mold_no', l: '금형', w: 80 }, { k: 'part_name', l: '품명', w: 180 }, { k: 'repairs', l: '수리(건)', t: 'int', w: 60 },
          { k: 'repair_cost', l: '수리비', t: 'int', w: 80 }, { k: 'parts_n', l: '부품 출고(개)', t: 'int', w: 70 }, { k: 'parts_cost', l: '부품 금액', t: 'int', w: 80 },
          { k: 'total', l: '합계', t: 'int', w: 85 }, { k: 'qty', l: '생산량(EA)', t: 'int', w: 85 }, { k: 'per_k', l: '1,000EA 당 (원)', t: 'num', w: 85 }], sort: { k: 'total', dir: -1 } }).setRows(c.rows);
      }).catch(App.err);
      else App.get('/api/moldx/prices' + qs).then(function (d) {
        top.innerHTML = '<div class="panel" style="margin-bottom:8px"><div class="panel-b"><div class="wo-nums"><span><b>' + fmt(d.n) + '</b>구매 건수</span><span><b>' + won(d.amount) + '</b>구매 금액 (원)</span>' +
          '<span><b class="' + (d.save ? 'warn-t' : '') + '">' + won(d.save) + '</b>최저가 업체로 샀다면 아낄 수 있던 금액</span><span><b>' + d.suppliers.length + '</b>업체</span></div>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">자료: 거래명세서 입력(원재료 제외) + 금형부품 입고 때 넣은 단가. 품목을 두 번 누르면 단가 변동 이력.</div>' +
          '<div style="margin-top:6px;font-size:12px">업체별: ' + d.suppliers.slice(0, 8).map(function (s) { return '<b>' + esc(s.supplier) + '</b> ' + won(s.amount) + '원 (' + s.items + '품목)'; }).join(' · ') + '</div>' +
          '<div style="margin-top:3px;font-size:12px">재질 · 구분별: ' + d.materials.slice(0, 8).map(function (m) { return '<b>' + esc(m.material) + '</b> ' + won(m.amount) + '원'; }).join(' · ') + '</div></div></div>';
        gname = '부품구매단가';
        d.items.forEach(function (it, i) { it.id = i; });
        mkGrid({ cols: [{ k: 'item', l: '품명', w: 140 }, { k: 'spec', l: '규격', w: 110 }, { k: 'material', l: '재질', w: 70 }, { k: 'category', l: '구분', w: 70 },
          { k: 'n', l: '구매(회)', t: 'int', w: 55 }, { k: 'qty', l: '수량', t: 'int', w: 60 }, { k: 'amount', l: '금액', t: 'int', w: 85 },
          { k: 'min', l: '최저 단가', t: 'int', w: 70 }, { k: 'avg', l: '평균 단가', t: 'int', w: 70 }, { k: 'max', l: '최고 단가', t: 'int', w: 70 }, { k: 'last', l: '최근 단가', t: 'int', w: 70 },
          { k: 'change', l: '처음→최근', w: 70, num: true, fmt: function (v) { return v === null ? '' : '<span style="color:' + (v > 0 ? '#c03030' : v < 0 ? '#2f7d32' : 'inherit') + '">' + (v > 0 ? '+' : '') + pct(v) + '</span>'; } },
          { k: 'last_sup', l: '최근 업체', w: 90 }, { k: 'best_sup', l: '최저가 업체', w: 90 }, { k: 'save', l: '절감 가능', t: 'int', w: 70 },
          { k: 'sups', l: '업체별 평균', w: 220, val: function (r) { return r.sups.map(function (s) { return s.supplier + ' ' + Math.round(s.avg); }).join(' / '); } }],
          sort: { k: 'amount', dir: -1 }, hint: '두 번 누르면 단가 이력',
          onDbl: function (r) {
            App.get('/api/moldx/price_hist?item=' + encodeURIComponent(r.item || '') + '&spec=' + encodeURIComponent(r.spec || '')).then(function (h) {
              App.dialog({ title: r.item + ' ' + (r.spec || '') + ' 단가 이력', body: '<table class="mini" style="width:100%"><tr><th>일자</th><th>업체</th><th>수량</th><th>단가</th><th>금액</th><th>자료</th></tr>' +
                h.map(function (x) { return '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.supplier) + '</td><td class="num">' + fmt(x.qty) + '</td><td class="num">' + won(x.unit_price) + '</td><td class="num">' + won(x.amount) + '</td><td>' + (x.src === 'invoice' ? '명세서' : '부품 입고') + '</td></tr>'; }).join('') + '</table>' });
            }).catch(App.err);
          } }).setRows(d.items);
      }).catch(App.err);
    }
    seg(root, function (v) { view = v; App.store.set('mc_view', v); load(); });
    search.addEventListener('input', function () { if (grid) grid.setFilter(search.value); });
    root.querySelector('[data-a=xlsx]').onclick = function () { if (grid) App.exportXlsx(gname + '_' + App.stamp() + '.xlsx', [grid.sheet(gname)]); };
    load();
  };

  // ================================================================ 원재료 소요량 · 수율 · 발주 알림
  App.pages.rm_need = function (root) {
    var lv = App.curLevel || 0;
    var view = App.store.get('rn_view', 'need'), last = null;
    root.innerHTML = '<div class="page-full"><div class="toolbar"><div class="seg"><button class="btn' + (view === 'need' ? ' on' : '') + '" data-v="need">발주 알림 (납기 기준)</button>' +
      '<button class="btn' + (view === 'yield' ? ' on' : '') + '" data-v="yield">소요량 · 수율</button></div><span data-period style="display:contents"></span>' +
      '<input class="input search" placeholder="검색"><span class="grow"></span>' + (lv >= 2 ? '<button class="btn" data-a="safety">안전재고 정하기</button>' : '') +
      '<button class="btn" data-a="xlsx">엑셀로 저장</button></div><div data-top></div><div data-box style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
    var top = root.querySelector('[data-top]'), bx = root.querySelector('[data-box]'), search = root.querySelector('.search'), pEl = root.querySelector('[data-period]');
    var grid = null, gname = '';
    var period = App.periodBar(pEl, 'range', App.store.get('rn_p', { d1: App.today().slice(0, 7) + '-01', d2: App.today() }), function (p) { App.store.set('rn_p', p); load(); });
    function mkGrid(o) { bx.innerHTML = ''; grid = new App.Grid(box(bx), o); grid.setFilter(search.value); return grid; }
    var ST = { '발주 필요': 'bad', '주의': 'warn', '정상': 'ok' };
    function load() {
      pEl.style.display = view === 'yield' ? 'contents' : 'none';
      if (view === 'need') {
        top.innerHTML = '<div class="muted">계산 중… (납기 파일로 생산계획을 다시 계산합니다)</div>';
        App.get('/api/rmx/need').then(function (d) {
          last = d;
          top.innerHTML = '<div class="panel" style="margin-bottom:8px"><div class="panel-b"><div class="wo-nums"><span><b class="' + (d.count['발주 필요'] ? 'bad-t' : '') + '">' + d.count['발주 필요'] + '</b>발주 필요</span>' +
            '<span><b class="' + (d.count['주의'] ? 'warn-t' : '') + '">' + d.count['주의'] + '</b>주의</span><span><b>' + d.count['정상'] + '</b>정상</span>' +
            '<span class="muted" style="font-size:12px">' + (d.file_date ? '납기 파일 ' + esc(d.file_date) + ' 기준' : '납기 파일이 없어 필요량 없이 재고 · 안전재고만 봅니다 (생산관리 > 납기 · 생산계획에서 올리기)') +
            (d.has_stock ? '' : ' · 재고 자료 없음 (원재료 재고 · 코일 LOT)') + '</span></div>' +
            '<div class="muted" style="font-size:12px;margin-top:6px">필요량(kg) = 필요 수량 × 제품 1EA 원재료(생산중량, 없으면 제품중량+스크랩중량, g) ÷ 1000 · 판정: 재고+입고예정 − 월말 필요량 &lt; 안전재고 → <b>발주 필요</b>, 익월말 기준만 모자라면 <b>주의</b> · 발주 권장량 = 안전재고 + 익월말 필요량 − (재고+입고예정)</div>' +
            (d.nomat.length ? '<div class="muted" style="font-size:12px;margin-top:3px">자재번호 없는 제번 ' + d.nomat.length + ': ' + esc(d.nomat.slice(0, 15).join(', ')) + '</div>' : '') +
            (d.noweight.length ? '<div class="muted" style="font-size:12px">중량 없는 제번 ' + d.noweight.length + ': ' + esc(d.noweight.slice(0, 15).join(', ')) + '</div>' : '') +
            (d.plan_error ? '<div class="notice bad">계획 계산 오류: ' + esc(d.plan_error) + '</div>' : '') + '</div></div>';
          gname = '원재료발주알림';
          d.rows.forEach(function (r) { r.id = r.mat; });
          mkGrid({ cols: [{ k: 'state', l: '판정', w: 70, center: true, fmt: function (v) { return tag(v, ST); } }, { k: 'mat', l: '자재번호', w: 90 }, { k: 'desc', l: '자재내역', w: 160 },
            { k: 'stock', l: '재고 kg', t: 'num', w: 75 }, { k: 'rolls', l: '롤', t: 'int', w: 40 }, { k: 'src', l: '재고 자료', w: 65 }, { k: 'incoming', l: '입고예정 kg', t: 'num', w: 75 },
            { k: 'need_T', l: '+20일 필요', t: 'num', w: 75 }, { k: 'need_S', l: '월말 필요', t: 'num', w: 75 }, { k: 'need_R', l: '익월말 필요', t: 'num', w: 75 },
            { k: 'safety', l: '안전재고', t: 'num', w: 70 }, { k: 'left_S', l: '월말 남음', t: 'num', w: 75 }, { k: 'order', l: '발주 권장 kg', t: 'num', w: 80 },
            { k: 'lead', l: '조달(일)', t: 'int', w: 55 }, { k: 'codes', l: '제번', w: 200, val: function (r) { return r.codes.join(', ') + (r.n_codes > r.codes.length ? ' …' : ''); } }],
            sort: null, rowClass: function (r) { return r.state === '발주 필요' ? 'r-bad' : r.state === '주의' ? 'r-warn' : ''; } }).setRows(d.rows);
        }).catch(function (e) { top.innerHTML = ''; App.err(e); });
      } else {
        var p = period.get();
        App.get('/api/rmx/yield?d1=' + p.d1 + '&d2=' + p.d2).then(function (d) {
          var t = d.total;
          top.innerHTML = '<div class="panel" style="margin-bottom:8px"><div class="panel-b"><div class="wo-nums"><span><b>' + fmt(Math.round(t.input_kg)) + '</b>이론 투입 kg</span><span><b>' + fmt(Math.round(t.prod_kg)) + '</b>제품 kg</span>' +
            '<span><b>' + fmt(Math.round(t.scrap_kg)) + '</b>스크랩 kg</span><span><b>' + fmt(Math.round(t.loss_kg)) + '</b>LOSS kg</span><span><b>' + pct(t.yield) + '</b>이론 수율</span><span><b>' + pct(t.real_yield) + '</b>LOSS 포함 수율</span></div>' +
            '<div class="muted" style="font-size:12px;margin-top:6px">이론 투입 = 생산량 × 생산중량(g) · 수율 = 제품중량 합 ÷ 이론 투입 · LOSS 포함 = 제품중량 ÷ (이론 투입 + 생산실적 LOSS(중량) 칸 합) · 자재번호별 합계 아래 표는 제번별</div>' +
            (d.mats.length ? '<table class="mini" style="margin-top:6px"><tr><th>자재번호</th><th>제번 수</th><th>생산량</th><th>이론 투입 kg</th><th>제품 kg</th><th>LOSS kg</th><th>수율</th><th>LOSS 포함</th></tr>' +
              d.mats.map(function (m) { return '<tr><td>' + esc(m.mat) + '</td><td class="num">' + m.codes + '</td><td class="num">' + fmt(m.qty) + '</td><td class="num">' + fmt(Math.round(m.input_kg)) + '</td><td class="num">' + fmt(Math.round(m.prod_kg)) + '</td><td class="num">' + fmt(Math.round(m.loss_kg)) + '</td><td class="num">' + pct(m.yield) + '</td><td class="num">' + pct(m.real_yield) + '</td></tr>'; }).join('') + '</table>' : '') +
            (d.lots.length ? '<div class="muted" style="font-size:12px;margin-top:6px">코일 LOT 실사용 비교: ' + d.lots.map(function (l) { return esc(l.lot_no) + ' 실사용 ' + fmt(l.used_kg) + ' / 이론 ' + fmt(l.theory_kg) + 'kg'; }).join(' · ') + '</div>' : '') +
            (d.nodata.length ? '<div class="muted" style="font-size:12px">중량 없는 제번 ' + d.nodata.length + ': ' + esc(d.nodata.slice(0, 20).join(', ')) + '</div>' : '') + '</div></div>';
          gname = '원재료수율';
          d.codes.forEach(function (r) { r.id = r.code; });
          mkGrid({ cols: [{ k: 'code', l: '제번', w: 95 }, { k: 'name', l: '품명', w: 170 }, { k: 'mat', l: '자재번호', w: 80 }, { k: 'qty', l: '생산량', t: 'int', w: 75 },
            { k: 'unit_w', l: '제품중량 g', t: 'num', w: 70 }, { k: 'unit_tw', l: '생산중량 g', t: 'num', w: 70 }, { k: 'input_kg', l: '이론 투입 kg', t: 'num', w: 80 },
            { k: 'prod_kg', l: '제품 kg', t: 'num', w: 70 }, { k: 'scrap_kg', l: '스크랩 kg', t: 'num', w: 70 }, { k: 'loss_kg', l: 'LOSS kg', t: 'num', w: 65 },
            { k: 'yield', l: '수율', w: 60, num: true, fmt: function (v) { return pct(v); } }, { k: 'real_yield', l: 'LOSS 포함', w: 65, num: true, fmt: function (v) { return pct(v); } }],
            sort: { k: 'input_kg', dir: -1 } }).setRows(d.codes);
        }).catch(App.err);
      }
    }
    function safety() {
      var rows = (last && last.rows) || [];
      var body = App.h('<div><div class="muted" style="font-size:12px;margin-bottom:6px">자재번호마다 안전재고(kg)와 조달 기간(일)을 넣으세요. 0 으로 두면 지웁니다. 목록에 없는 자재는 맨 아래 빈 줄에.</div>' +
        '<div class="scroll" style="max-height:55vh"><table class="inv-t"><tr><th>자재번호</th><th>자재내역</th><th>재고 kg</th><th>안전재고 kg</th><th>조달(일)</th></tr>' +
        rows.concat([{ mat: '', desc: '', stock: '' }, { mat: '', desc: '', stock: '' }]).map(function (r) {
          return '<tr><td><input data-k="mat" value="' + esc(r.mat) + '"' + (r.mat ? ' readonly' : '') + '></td><td>' + esc(r.desc || '') + '</td><td class="num">' + (r.stock === '' ? '' : fmt(r.stock)) + '</td>' +
            '<td><input data-k="safety" inputmode="decimal" value="' + esc(r.safety || '') + '"></td><td><input data-k="lead" inputmode="numeric" value="' + esc(r.lead || '') + '"></td></tr>';
        }).join('') + '</table></div></div>');
      App.dialog({ title: '원재료 안전재고', wide: true, body: body, buttons: [{ label: '취소' }, { label: '저장', cls: 'primary', onClick: function (d) {
        var out = App.$$('tr', body).slice(1).map(function (tr) { var o = {}; App.$$('input', tr).forEach(function (i) { o[i.dataset.k] = i.value.trim(); }); return o; }).filter(function (o) { return o.mat; });
        App.api('PUT', '/api/rmx/safety', { rows: out }).then(function () { d.close(); App.toast('저장했습니다.'); load(); }).catch(function (e) { d.error(e.message); });
      } }] });
    }
    seg(root, function (v) { view = v; App.store.set('rn_view', v); load(); });
    search.addEventListener('input', function () { if (grid) grid.setFilter(search.value); });
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'xlsx' && grid) App.exportXlsx(gname + '_' + App.stamp() + '.xlsx', [grid.sheet(gname)]);
      else if (a === 'safety') { if (!last) { view = 'need'; load(); } safety(); }
    });
    load();
  };

  // ================================================================ 거래명세서 입력
  App.pages.invoices = function (root) {
    var lv = App.curLevel || 0;
    root.innerHTML = '<div class="page-full"><div class="desc">거래명세서 <b>엑셀(xlsx) · CSV · 스캔 그림</b>을 올리면 공급자 · 일자 · 품목(품명 · 규격 · 수량 · 단가 · 금액)을 읽어 옵니다. ' +
      '품목마다 <b>금형부품</b>(부품 입고 + 단가 기록) · <b>원재료</b>(코일 LOT 등록 → 수입검사) · <b>기타</b>(기록만)를 확인하고 [입력]을 누르세요. 입력한 단가는 <b>금형관리 > 유지비 · 부품 구매단가</b>에서 업체별로 비교됩니다.</div>' +
      '<div class="toolbar"><span data-period style="display:contents"></span><input class="input search" placeholder="검색"><span class="grow"></span>' +
      (lv >= 2 ? '<button class="btn primary" data-a="up">거래명세서 올리기</button><button class="btn" data-a="manual">직접 입력</button>' : '') +
      (lv >= 3 ? '<button class="btn danger" data-a="del">삭제 (입고 되돌림)</button>' : '') + '</div>' +
      '<div class="split"><div class="left"></div><div class="right panel"><div class="panel-b muted">목록에서 고르면 품목이 보입니다.</div></div></div></div>';
    var right = root.querySelector('.right');
    var grid = new App.Grid(root.querySelector('.left'), {
      cols: [{ k: 'date', l: '일자', w: 80 }, { k: 'supplier', l: '공급자', w: 110 }, { k: 'doc_no', l: '번호', w: 80 }, { k: 'n', l: '품목', t: 'int', w: 45 },
        { k: 'total', l: '금액', t: 'int', w: 85 }, { k: 'src', l: '자료', w: 60 }, { k: 'created_by', l: '입력', w: 60 }],
      sort: { k: 'date', dir: -1 }, onSelect: show
    });
    root.querySelector('.search').addEventListener('input', function () { grid.setFilter(this.value); });
    var period = App.periodBar(root.querySelector('[data-period]'), 'range', App.store.get('inv_p', { d1: App.addDays(-90), d2: App.today() }), function (p) { App.store.set('inv_p', p); load(); });
    function load(sel) { var p = period.get(); App.get('/api/invoice/list?d1=' + p.d1 + '&d2=' + p.d2).then(function (r) { grid.setRows(r); if (sel) grid.selectKey(sel, true); }).catch(App.err); }
    function show(r) {
      App.get('/api/invoice/' + r.id + '/items').then(function (items) {
        right.innerHTML = '<div class="panel-h">' + esc(r.supplier || '') + ' ' + esc(r.date) + '<span class="grow"></span>' + (r.has_file ? '<a class="btn small" target="_blank" href="/api/invoice/' + r.id + '/file">원본 보기</a>' : '') + '</div>' +
          '<div class="panel-b"><table class="mini" style="width:100%"><tr><th>#</th><th>구분</th><th>품명</th><th>규격</th><th>수량</th><th>단가</th><th>금액</th><th>연결</th></tr>' +
          items.map(function (x) {
            return '<tr><td>' + x.seq + '</td><td>' + tag(x.target, { '금형부품': 'steel', '원재료': 'warn', '기타': 'gray' }) + '</td><td>' + esc(x.item) + '</td><td>' + esc(x.spec || '') + '</td><td class="num">' + fmt(x.qty) +
              '</td><td class="num">' + won(x.unit_price) + '</td><td class="num">' + won(x.amount) + '</td><td>' + esc(x.lot_no ? 'LOT ' + x.lot_no : x.part_id ? '부품 #' + x.part_id : '') + '</td></tr>';
          }).join('') + '</table></div>';
      }).catch(App.err);
    }
    function review(d0) {
      var items = d0.items.length ? d0.items : [{ target: '기타' }];
      App.refList('parts', true).then(function (parts) {
        var dl = '<datalist id="invParts">' + parts.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name + ' ' + (p.spec || '') + ' (' + (p.code || '') + ')') + '</option>'; }).join('') + '</datalist>';
        var T = ['금형부품', '원재료', '기타', '제외'];
        function rowHtml(x, i) {
          return '<tr data-i="' + i + '"' + (x.target === '제외' ? ' class="x"' : '') + '><td><select data-k="target">' + T.map(function (t) { return '<option' + (t === x.target ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></td>' +
            ['item', 'spec', 'material', 'qty', 'unit', 'unit_price', 'amount'].map(function (k) { return '<td><input data-k="' + k + '" value="' + esc(x[k] == null ? '' : x[k]) + '"' + (/qty|price|amount/.test(k) ? ' inputmode="decimal" style="text-align:right"' : '') + '></td>'; }).join('') +
            '<td><input data-k="part_id" list="invParts" placeholder="새 부품" value="' + esc(x.part_id || '') + '" title="' + esc(x.part_label || '') + '"></td>' +
            '<td><input data-k="lot_no" placeholder="자동" value="' + esc(x.lot_no || '') + '"></td><td><input data-k="mat_code" value="' + esc(x.mat_code || '') + '"></td>' +
            '<td><input data-k="weight" inputmode="decimal" value="' + esc(x.weight == null ? '' : x.weight) + '"></td></tr>';
        }
        var body = App.h('<div>' + dl + '<div class="form" style="margin-bottom:8px"><label class="f"><span>일자 *</span><input type="date" class="input" data-h="date" value="' + esc(d0.date || App.today()) + '"></label>' +
          '<label class="f"><span>공급자</span><input class="input" data-h="supplier" value="' + esc(d0.supplier || '') + '"></label>' +
          '<label class="f"><span>명세서 번호</span><input class="input" data-h="doc_no" value="' + esc(d0.doc_no || '') + '"></label></div>' +
          '<div class="muted" style="font-size:12px;margin-bottom:4px">' + (d0.src ? esc(d0.src) + '에서 ' + d0.items.length + '품목을 읽었습니다. ' : '') + '금형부품: 부품 번호(목록에서 고르기)가 비면 새 부품으로 등록 · 원재료: LOT 이 비면 자동 번호, 중량(kg) 을 넣으세요</div>' +
          '<div class="scroll" style="max-height:55vh"><table class="inv-t"><thead><tr><th>구분</th><th>품명</th><th>규격</th><th>재질</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>부품 번호</th><th>코일 LOT</th><th>자재번호</th><th>중량 kg</th></tr></thead>' +
          '<tbody>' + items.map(rowHtml).join('') + '</tbody></table></div><div style="margin-top:6px"><button class="btn small" data-add>+ 줄</button> <span data-sum class="muted"></span></div>' +
          (d0.text ? '<details style="margin-top:6px"><summary class="muted">읽은 글자</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto">' + esc(d0.text) + '</pre></details>' : '') + '</div>');
        var tb = body.querySelector('tbody');
        function collect() {
          return App.$$('tr', tb).map(function (tr) { var o = {}; App.$$('[data-k]', tr).forEach(function (el) { o[el.dataset.k] = el.value.trim(); }); return o; });
        }
        function sum() { var s = 0; collect().forEach(function (o) { if (o.target !== '제외') s += +String(o.amount).replace(/,/g, '') || 0; }); body.querySelector('[data-sum]').textContent = '합계 ' + won(s) + '원'; }
        tb.addEventListener('change', function (e) {
          var tr = e.target.closest('tr'); if (e.target.dataset.k === 'target') tr.classList.toggle('x', e.target.value === '제외');
          if (/qty|unit_price/.test(e.target.dataset.k)) {
            var q = +tr.querySelector('[data-k=qty]').value.replace(/,/g, ''), p = +tr.querySelector('[data-k=unit_price]').value.replace(/,/g, ''), a = tr.querySelector('[data-k=amount]');
            if (q && p && !a.value) a.value = Math.round(q * p);
          }
          sum();
        });
        body.querySelector('[data-add]').onclick = function () { tb.insertAdjacentHTML('beforeend', rowHtml({ target: '기타' }, tb.children.length)); };
        sum();
        App.dialog({ title: '거래명세서 확인 · 입력', wide: true, body: body, closeOnBack: false, buttons: [{ label: '취소' }, { label: '입력', cls: 'primary', onClick: function (d) {
          var b = { token: d0.token, file_name: d0.file_name, src: d0.src };
          App.$$('[data-h]', body).forEach(function (el) { b[el.dataset.h] = el.value.trim(); });
          b.items = collect().map(function (o) { if (o.part_id && !/^\d+$/.test(o.part_id)) o.part_id = ''; return o; });
          d.busy(true);
          App.api('POST', '/api/invoice/commit', b).then(function (r) {
            d.close();
            var x = r.done;
            App.toast('입력했습니다 — 부품 입고 ' + x['금형부품'] + (x['새 부품'] ? ' (새 부품 ' + x['새 부품'] + ')' : '') + ' · 원재료 LOT ' + x['원재료'] + ' · 기타 ' + x['기타'], '', 6000);
            if (x['원재료']) App.toast('원재료 LOT 은 "검사중" 입니다. 품질관리 > 수입검사에서 판정하세요.', 'warn', 7000);
            App.refreshBadges(); load(r.id);
          }).catch(function (e) { d.busy(false); d.error(e.message); });
        } }] });
      }).catch(App.err);
    }
    root.querySelector('.toolbar').addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'up') pickFile('.xlsx,.xlsm,.csv,image/*').then(function (f) {
        App.toast('읽는 중… (' + f.name + ')');
        f.arrayBuffer().then(function (buf) { return App.api('POST', '/api/invoice/read?name=' + encodeURIComponent(f.name), buf); }).then(review).catch(App.err);
      });
      else if (a === 'manual') review({ items: [], date: App.today() });
      else if (a === 'del') {
        var r = grid.selected(); if (!r) return App.toast('목록에서 먼저 고르세요.', 'warn');
        App.confirm(r.supplier + ' ' + r.date + ' 명세서를 삭제할까요?\n부품 입고는 되돌리고, 아직 검사중인 원재료 LOT 은 지웁니다.', '삭제', true).then(function (ok) {
          if (ok) App.api('DELETE', '/api/invoice/' + r.id).then(function () { right.innerHTML = ''; load(); }).catch(App.err);
        });
      }
    });
    load();
  };
})();
