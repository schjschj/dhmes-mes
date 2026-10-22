/* 설정 · 백업 */
App.pages.settings = function (root) {
  root.innerHTML = '<div class="cols2">' +
    '<div class="panel"><div class="panel-h">설정</div><div class="panel-b">' +
    '<div class="form" style="grid-template-columns:1fr 1fr">' +
    '<label class="f full"><span>회사명 (화면 왼쪽 위에 표시)</span><input class="input" data-s="company"></label>' +
    '<label class="f"><span>금형 1차 알람 — 잔여율 (%) 이하</span><input class="input num" data-s="mold_alarm1" data-pct></label>' +
    '<label class="f"><span>금형 2차 알람 — 잔여율 (%) 이하</span><input class="input num" data-s="mold_alarm2" data-pct></label>' +
    '</div><div style="margin-top:12px"><button class="btn primary" data-a="save">설정 저장</button></div></div></div>' +
    '<div class="panel"><div class="panel-h">백업<span class="grow"></span><button class="btn small" data-a="now">지금 백업</button><button class="btn small" data-a="dl">현재 DB 내려받기</button></div><div class="panel-b">' +
    '<p class="desc" style="margin-top:0">서버가 매일 자동으로 백업합니다. 오래된 백업은 설정한 기간(기본 60일)이 지나면 지워집니다. 가끔 <b>현재 DB 내려받기</b>로 USB 등 다른 곳에도 보관하세요.</p>' +
    '<div class="muted" data-dir style="font-size:12px;margin-bottom:6px"></div><div class="scroll" data-list style="max-height:280px"></div></div></div>' +
    '<div class="panel" style="grid-column:1/-1"><div class="panel-h">전체 데이터 엑셀로 내보내기</div><div class="panel-b">' +
    '<p class="desc" style="margin-top:0">기준정보 · 금형 · 정비이력 · 부품 · 입출고 이력을 시트별로 한 파일에 저장합니다.</p>' +
    '<button class="btn" data-a="all">전체 엑셀 저장</button></div></div>' +
    (App.findMenu('plan') && App.knowhowPanel ? '<div class="panel" style="grid-column:1/-1"><div class="panel-h">편성 노하우 <span class="muted" style="font-weight:400">(납기 · 생산계획 자동 편성에 쓰임)</span></div><div class="panel-b" data-kh-b>불러오는 중…</div></div>' : '') +
    (App.me && App.me.admin ? '<div class="panel" style="grid-column:1/-1" data-upd><div class="panel-h">프로그램 업데이트 <span class="muted" style="font-weight:400">(관리자만 — 서버 PC 에 가지 않고 여기서 새 버전으로 바꿈)</span></div><div class="panel-b" data-upd-b>불러오는 중…</div></div>' : '') +
    '</div>';

  function loadSettings() {
    App.get('/api/settings').then(function (s) {
      App.$$('[data-s]', root).forEach(function (el) {
        var v = s[el.dataset.s];
        if (el.dataset.s === 'company') v = v || App.meta.company;
        if (el.dataset.s === 'mold_alarm1') v = v || '0.2';
        if (el.dataset.s === 'mold_alarm2') v = v || '0.1';
        el.value = el.hasAttribute('data-pct') ? Math.round(Number(v) * 1000) / 10 : v;
      });
    });
  }
  function loadBackups() {
    App.get('/api/backup/list').then(function (d) {
      root.querySelector('[data-dir]').textContent = '백업 폴더 (서버 PC): ' + d.dir;
      root.querySelector('[data-list]').innerHTML = d.files.length ? '<table class="mini"><tr><th>파일</th><th>시각</th><th class="num">크기</th><th></th></tr>' + d.files.map(function (f) {
        return '<tr><td>' + App.esc(f.name) + '</td><td>' + App.esc(f.time) + '</td><td class="num">' + App.fmt(Math.round(f.size / 1024)) + ' KB</td>' +
          '<td><a href="/api/backup/download?name=' + encodeURIComponent(f.name) + '">내려받기</a></td></tr>';
      }).join('') + '</table>' : '<div class="muted">백업 파일이 없습니다.</div>';
    }).catch(App.err);
  }
  root.addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'save') {
      var body = {};
      var bad = '';
      App.$$('[data-s]', root).forEach(function (el) {
        var v = el.value.trim();
        if (el.hasAttribute('data-pct')) {
          var n = Number(v);
          if (isNaN(n) || n < 0 || n > 100) bad = '알람 기준은 0~100 사이 숫자로 입력하세요.';
          v = String(n / 100);
        }
        body[el.dataset.s] = v;
      });
      if (bad) { App.toast(bad, 'bad'); return; }
      if (Number(body.mold_alarm2) > Number(body.mold_alarm1)) { App.toast('2차 알람 기준은 1차보다 작아야 합니다.', 'bad'); return; }
      App.api('PUT', '/api/settings', body).then(function () {
        App.toast('저장했습니다.');
        App.meta.company = body.company;
        document.getElementById('brandName').textContent = body.company;
        App.refreshBadges();
      }).catch(App.err);
    } else if (a === 'now') {
      App.api('POST', '/api/backup/now').then(function (r) { App.toast('백업했습니다: ' + r.name); loadBackups(); }).catch(App.err);
    } else if (a === 'dl') {
      location.href = '/api/backup/download';
    } else if (a === 'all') {
      var tabs = [['products', '제품'], ['molds', '금형'], ['equipment', '설비'], ['workers', '작업자'], ['defect_codes', '불량코드'], ['mold_maint', '금형정비이력'], ['parts', '금형부품'], ['production', '생산실적(입력값)'], ['defects', '공정불량']];
      Promise.all(tabs.map(function (t) { return App.get('/api/t/' + t[0]); }).concat([App.get('/api/parts/tx')])).then(function (res) {
        var sheets = tabs.map(function (t, i) {
          var cols = App.meta.tables[t[0]].cols;
          return {
            name: t[1], head: cols.map(function (c) { return c.l; }),
            rows: res[i].map(function (r) { return cols.map(function (c) { return c.t === 'yesno' ? (r[c.k] ? '예' : '') : r[c.k]; }); })
          };
        });
        sheets.push({
          name: '부품입출고이력', head: ['일자', '구분', '부품코드', '부품명', '규격', '수량', '처리후 재고', '단위', '사용금형', '작업자', '비고'],
          rows: res[tabs.length].map(function (t) { return [t.date, t.kind, t.code, t.name, t.spec, t.qty, t.after_qty, t.unit, t.mold_label, t.worker, t.note]; })
        });
        App.exportXlsx('통합관리_전체데이터_' + App.stamp() + '.xlsx', sheets);
      }).catch(App.err);
    }
  });
  loadSettings();
  loadBackups();
  if (App.me && App.me.admin) updPanel(root.querySelector('[data-upd-b]'));
  var khb = root.querySelector('[data-kh-b]'); if (khb) App.knowhowPanel(khb);
};

// ------------------------------------------------------------------ 프로그램 업데이트 (관리자)
function updPanel(box) {
  var esc = App.esc, st = null, timer = null;
  function fmtSize(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }
  function left(p) { var s = Math.max(0, Math.round(p.at_ts - Date.now() / 1000)); return s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; }
  function draw() {
    var h = [];
    h.push('<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">');
    // 왼쪽: 올리기 / 실행
    h.push('<div style="flex:1;min-width:320px">');
    h.push('<div style="margin-bottom:8px">지금 버전 <b>v' + esc(st.version) + '</b></div>');
    if (st.plan) {
      var p = st.plan;
      h.push('<div class="notice" style="margin-bottom:10px"><b>' + (p.kind === 'rollback' ? '되돌리기' : '업데이트') + ' 예정</b> v' + esc(p.from_ver) + ' → <b>v' + esc(p.to_ver) + '</b><br>' +
        esc(p.at) + ' (<span data-left>' + left(p) + '</span> 남음) · ' + esc(p.by) +
        '<div style="margin-top:6px"><button class="btn small" data-u="cancel">예약 취소</button></div></div>');
    }
    if (st.staged) {
      var g = st.staged;
      h.push('<div class="kind-box" style="padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:10px">' +
        '<div>올린 파일: <b>v' + esc(g.version) + '</b> <span class="muted">(' + esc(g.name || '') + ' · ' + fmtSize(g.size) + ' · ' + esc(g.by) + ' ' + esc(g.at) + ')</span></div>' +
        (g.same ? '<div class="tag warn" style="margin-top:4px">지금과 같은 버전입니다</div>' : g.older ? '<div class="tag bad" style="margin-top:4px">지금보다 낮은 버전입니다</div>' : '') +
        (st.plan ? '' :
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
          '<button class="btn primary" data-u="now">바로 업데이트</button><span class="muted" style="font-size:12px">30초 뒤 시작 (각 PC 에 알림)</span></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
          '<input type="date" class="input" data-d style="width:140px"><input type="time" class="input" data-t value="22:00" style="width:110px">' +
          '<button class="btn" data-u="sched">예약 업데이트</button><span class="muted" style="font-size:12px">5분 전부터 각 PC 에 알림</span></div>') +
        '<div style="margin-top:8px"><button class="btn small" data-u="del">올린 파일 지우기</button></div></div>');
    }
    h.push('<label class="btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">' + (st.staged ? '다른 파일 올리기' : '새 버전 zip 올리기') +
      '<input type="file" accept=".zip" data-file style="display:none"></label>' +
      '<span class="muted" style="font-size:12px;margin-left:8px">받은 \'대흥공업_통합관리_v○○.zip\' 을 그대로 (여기에 끌어다 놓아도 됨)</span>');
    if (st.result) {
      var r = st.result;
      h.push('<div style="margin-top:12px;font-size:12.5px">지난 결과 (' + esc(r.at) + '): ' + (r.ok ? '<span class="tag ok">성공</span> ' : '<span class="tag bad">실패</span> ') + esc(r.msg) + '</div>');
    }
    h.push('<div class="muted" style="margin-top:10px;font-size:12px;line-height:1.6">· 업데이트 직전에 DB 를 자동 백업하고, 지금 프로그램은 이전 버전으로 보관합니다.<br>' +
      '· 업데이트하는 20~30초 동안 각 PC 연결이 끊겼다가 자동으로 다시 붙습니다. 새 버전이 안 켜지면 스스로 이전 버전으로 되돌립니다.<br>' +
      '· 바뀌는 것: 프로그램 · 버튼 파일 · 사용법 · 접속 프로그램 / 그대로: data 폴더(모든 자료) · config.ini</div>');
    h.push('</div>');
    // 오른쪽: 이전 버전
    h.push('<div style="width:340px;max-width:100%"><div style="font-weight:700;margin-bottom:6px">이전 버전 (최근 3개)</div>' +
      (st.olds.length ? '<table class="mini"><tr><th>버전</th><th>보관 시각</th><th></th></tr>' + st.olds.map(function (o) {
        return '<tr><td>v' + esc(o.version) + '</td><td>' + esc(o.time) + '</td><td>' + (st.plan ? '' : '<button class="btn small" data-u="rb" data-name="' + esc(o.name) + '" data-v="' + esc(o.version) + '">이 버전으로 되돌리기</button>') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted">아직 없습니다 (업데이트를 한 번 하면 생김)</div>') +
      (st.log ? '<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">업데이트 기록 보기</summary><pre style="font-size:11px;white-space:pre-wrap;max-height:200px;overflow:auto">' + esc(st.log) + '</pre></details>' : '') +
      '</div></div>');
    box.innerHTML = h.join('');
    var dIn = box.querySelector('[data-d]');
    if (dIn) dIn.value = App.today();
    var f = box.querySelector('[data-file]');
    f.onchange = function () { if (f.files[0]) upload(f.files[0]); };
  }
  function load() {
    return App.get('/api/update/status').then(function (d) { st = d; draw(); }).catch(function (e) { box.textContent = e.message; });
  }
  function upload(file) {
    if (!/\.zip$/i.test(file.name)) { App.toast('zip 파일을 올리세요.', 'bad'); return; }
    box.style.opacity = 0.5;
    file.arrayBuffer().then(function (buf) {
      return App.api('POST', '/api/update/upload?name=' + encodeURIComponent(file.name), buf);
    }).then(function (r) {
      App.toast('v' + r.version + ' 파일을 올렸습니다. [바로 업데이트] 또는 [예약 업데이트]를 누르세요.');
    }).catch(App.err).then(function () { box.style.opacity = 1; load(); });
  }
  function waitRestart(toVer) {
    var d = App.dialog({ title: '프로그램 업데이트', closeOnBack: false, body: '<div style="line-height:1.8" data-w>업데이트를 시작합니다…<br><span class="muted">서버가 잠깐 꺼졌다가 새 버전으로 켜지면 이 화면이 자동으로 새로고침됩니다.</span></div>', buttons: [{ label: '닫기' }] });
    var t0 = Date.now(), seenDown = false;
    var iv = setInterval(function () {
      fetch('/api/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.v === toVer && (seenDown || Date.now() - t0 > 40000)) { clearInterval(iv); location.reload(); }
        var n = j.notice;
        var w = d.el.querySelector('[data-w]');
        if (w && n) w.firstChild.textContent = n.secs + '초 뒤 시작합니다…';
      }).catch(function () {
        seenDown = true;
        var w = d.el.querySelector('[data-w]');
        if (w) w.firstChild.textContent = '서버를 바꾸는 중입니다… (' + Math.round((Date.now() - t0) / 1000) + '초)';
      });
      if (Date.now() - t0 > 180000) {
        clearInterval(iv);
        var w2 = d.el.querySelector('[data-w]');
        if (w2) w2.innerHTML = '시간이 오래 걸립니다. 잠시 뒤 새로고침(F5)해 보세요.<br>계속 안 되면 서버 PC 에서 "2_서버시작.bat" 을 실행하세요.';
      }
    }, 2000);
  }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-u]');
    if (!b) return;
    var u = b.dataset.u;
    if (u === 'now') {
      App.confirm('v' + st.staged.version + ' 로 바로 업데이트할까요?\n30초 뒤 시작하고, 20~30초 동안 모든 PC 의 연결이 끊깁니다.', '업데이트').then(function (ok) {
        if (!ok) return;
        App.api('POST', '/api/update/plan', { kind: 'update', at: 'now' }).then(function () { waitRestart(st.staged.version); }).catch(App.err);
      });
    } else if (u === 'sched') {
      var at = box.querySelector('[data-d]').value + ' ' + box.querySelector('[data-t]').value;
      App.api('POST', '/api/update/plan', { kind: 'update', at: at }).then(function () { App.toast(at + ' 에 업데이트하도록 예약했습니다. (서버가 켜져 있어야 합니다)'); load(); }).catch(App.err);
    } else if (u === 'cancel') {
      App.api('DELETE', '/api/update/plan').then(function () { App.toast('예약을 취소했습니다.'); load(); }).catch(App.err);
    } else if (u === 'del') {
      App.api('DELETE', '/api/update/staged').then(load).catch(App.err);
    } else if (u === 'rb') {
      App.confirm('v' + b.dataset.v + ' 로 되돌릴까요?\n(자료는 그대로이고 프로그램만 바뀝니다. 30초 뒤 시작)', '되돌리기', true).then(function (ok) {
        if (!ok) return;
        App.api('POST', '/api/update/plan', { kind: 'rollback', name: b.dataset.name, at: 'now' }).then(function () { waitRestart(b.dataset.v); }).catch(App.err);
      });
    }
  });
  box.addEventListener('dragover', function (e) { e.preventDefault(); box.style.outline = '2px dashed var(--steel)'; });
  box.addEventListener('dragleave', function () { box.style.outline = ''; });
  box.addEventListener('drop', function (e) { e.preventDefault(); box.style.outline = ''; if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  timer = setInterval(function () {
    if (!box.isConnected) { clearInterval(timer); return; }
    var el = box.querySelector('[data-left]');
    if (el && st && st.plan) el.textContent = left(st.plan);
  }, 1000);
  load();
}
