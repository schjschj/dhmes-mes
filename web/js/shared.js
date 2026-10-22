/* 여러 화면에서 같이 쓰는 입력창: 금형 정비 등록, 부품 입고/출고/재고조정 */
(function () {
  'use strict';

  // 금형 정비 등록/수정 — 금형을 고르면 누적 타수가 자동으로 채워짐
  App.moldMaintForm = function (opt) {
    opt = opt || {};
    var spec = App.meta.tables.mold_maint;
    var edit = !!(opt.row && opt.row.id);
    var vals = edit ? opt.row : { mold_no: opt.mold_no || '', date: App.today(), worker: App.user, shots: null };
    vals = Object.assign({}, vals, opt.preset || {});
    var statusCache = null;
    function shotsOf(no) {
      var p = statusCache ? Promise.resolve(statusCache) : App.get('/api/molds/status?all=1').then(function (d) { statusCache = d.rows; return d.rows; });
      return p.then(function (rows) { return rows.filter(function (m) { return m.mold_no === no; })[0]; });
    }
    var info = '<div class="move-info" data-info style="display:none"></div>';
    var dlg = App.form({
      title: edit ? '금형 정비이력 수정' : '금형 정비 등록', cols: spec.cols, values: vals, mode: edit ? 'edit' : 'new', top: info,
      onChange: function (k, v, setVal) {
        if (k === 'mold_no') showMold(v, setVal);
      },
      onSave: function (v) {
        var p = edit ? App.api('PUT', '/api/t/mold_maint/' + opt.row.id, v) : App.api('POST', '/api/t/mold_maint', v);
        return p.then(function () {
          App.toast(edit ? '수정했습니다.' : '정비 이력을 등록했습니다.');
          App.refreshBadges();
          if (opt.onDone) opt.onDone();
        });
      }
    });
    function showMold(no, setVal) {
      var box = dlg.el.querySelector('[data-info]');
      if (!no) { box.style.display = 'none'; return; }
      shotsOf(no).then(function (m) {
        if (!m) { box.style.display = ''; box.innerHTML = '<span class="tag bad">등록되지 않은 금형</span>'; return; }
        box.style.display = '';
        box.innerHTML = '<div><div class="muted">금형</div><b>' + App.esc(m.mold_no) + '</b> ' + App.esc(m.part_name || '') + '</div>' +
          '<div><div class="muted">현재 누적 타수</div><b>' + App.fmt(m.shots) + '</b></div>' +
          '<div><div class="muted">최근 오버홀</div>' + App.esc(m.oh_last || '-') + '</div>';
        if (m.variant_of) box.innerHTML += '<div><div class="muted">같은 금형</div>' + App.esc(m.variant_of) + ' 의 모디파이 — 타수·정비는 ' + App.esc(m.variant_of) + ' 에 합산</div>';
        if (!edit) setVal('shots', m.shots);
      });
    }
    if (vals.mold_no) showMold(vals.mold_no, dlg.setVal);
    return dlg;
  };

  // 부품 입고 / 출고 / 재고조정(실사)
  App.partMove = function (p, kind, onDone) {
    var label = kind === '조정' ? '재고조정 (실사)' : kind;
    var top = '<div class="move-info">' +
      '<div><div class="muted">부품</div><b>' + App.esc(p.name) + '</b> <span class="muted">' + App.esc(p.code || '') + ' ' + App.esc(p.spec || '') + '</span></div>' +
      '<div><div class="muted">사용금형</div>' + App.esc(p.mold_no || '(공용)') + '</div>' +
      '<div><div class="muted">현재고</div><b>' + App.fmt(p.qty) + '</b> ' + App.esc(p.unit || '') + '</div>' +
      '<div><div class="muted">안전재고</div>' + App.fmt(p.safety_qty) + '</div></div>';
    var cols = [
      { k: 'qty', l: kind === '조정' ? '실사 수량 (실제로 센 수량)' : kind + ' 수량', t: 'int', req: true },
      { k: 'date', l: '일자', t: 'date', req: true },
      { k: 'mold_no', l: kind === '출고' ? '사용 금형' : '관련 금형', t: 'ref', ref: 'molds', skip: kind === '조정' },
      { k: 'worker', l: '작업자', t: 'ref', ref: 'workers' },
      { k: 'note', l: '비고', t: 'memo' }
    ];
    var dlg = App.form({
      title: '부품 ' + label, cols: cols, top: top, okLabel: label + ' 저장',
      values: { qty: kind === '조정' ? p.qty : '', date: App.today(), mold_no: kind === '출고' ? (p.mold_no || '') : '', worker: App.user },
      onSave: function (v) {
        v.kind = kind;
        return App.api('POST', '/api/parts/' + p.id + '/move', v).then(function (r) {
          App.toast(p.name + ' ' + label + ' 완료 → 현재고 ' + App.fmt(r.qty));
          if (r.warn) App.toast('⚠ 안전재고 미달: ' + r.name + '\n현재고 ' + App.fmt(r.qty) + ' / 안전재고 ' + App.fmt(r.safety) + ' — 발주가 필요합니다.', 'warn', 8000);
          App.refreshBadges();
          if (onDone) onDone(r);
        });
      }
    });
    var q = dlg.el.querySelector('[data-k="qty"]');
    q.classList.add('big-qty');
    return dlg;
  };
})();

/* 기간 선택 막대: mode = 'date' | 'month' | 'range' | 'year' */
(function () {
  'use strict';
  function ym(d) { return d.slice(0, 7); }
  function monthRange(m) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7);
    var last = new Date(y, mo, 0).getDate();
    return [m + '-01', m + '-' + (last < 10 ? '0' : '') + last];
  }
  function shiftMonth(m, n) {
    var d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  App.monthRange = monthRange;
  App.shiftMonth = shiftMonth;
  App.periodBar = function (host, mode, init, onChange) {
    var st = Object.assign({}, init || {});
    var today = App.today();
    var h = '';
    if (mode === 'date') {
      st.date = st.date || today;
      h = '<button class="btn small" data-s="-1">◀</button><input type="date" class="input" data-k="date" value="' + st.date + '"><button class="btn small" data-s="1">▶</button>' +
        '<button class="btn small" data-q="today">오늘</button><button class="btn small" data-q="yday">어제</button>';
    } else if (mode === 'month') {
      st.ym = st.ym || ym(today);
      h = '<button class="btn small" data-s="-1">◀</button><input type="month" class="input" data-k="ym" value="' + st.ym + '"><button class="btn small" data-s="1">▶</button>' +
        '<button class="btn small" data-q="this">이번 달</button><button class="btn small" data-q="prev">지난 달</button>';
    } else if (mode === 'year') {
      st.year = st.year || today.slice(0, 4);
      h = '<button class="btn small" data-s="-1">◀</button><input class="input" style="width:70px;text-align:center" data-k="year" value="' + st.year + '"><button class="btn small" data-s="1">▶</button>';
    } else {
      if (!st.d1) { var r = monthRange(ym(today)); st.d1 = r[0]; st.d2 = today; }
      h = '<input type="date" class="input" data-k="d1" value="' + st.d1 + '"> ~ <input type="date" class="input" data-k="d2" value="' + (st.d2 || '') + '">' +
        '<button class="btn small" data-q="this">이번 달</button><button class="btn small" data-q="prev">지난 달</button><button class="btn small" data-q="7">7일</button><button class="btn small" data-q="year">올해</button>';
    }
    host.insertAdjacentHTML('beforeend', h);
    function sync() { App.$$('[data-k]', host).forEach(function (el) { el.value = st[el.dataset.k] || ''; }); }
    function fire() { sync(); onChange(Object.assign({}, st)); }
    host.addEventListener('change', function (e) { var k = e.target.dataset && e.target.dataset.k; if (k) { st[k] = e.target.value; fire(); } });
    host.addEventListener('click', function (e) {
      var s = e.target.dataset && e.target.dataset.s, q = e.target.dataset && e.target.dataset.q;
      if (s) {
        if (mode === 'date') { var d = new Date(st.date + 'T00:00:00'); d.setDate(d.getDate() + (+s)); st.date = App.dstr(d); }
        else if (mode === 'month') st.ym = shiftMonth(st.ym, +s);
        else if (mode === 'year') st.year = String(+st.year + (+s));
        fire();
      } else if (q) {
        if (mode === 'date') st.date = q === 'today' ? today : App.addDays(-1);
        else if (mode === 'month') st.ym = q === 'this' ? ym(today) : shiftMonth(ym(today), -1);
        else {
          if (q === 'this') { st.d1 = ym(today) + '-01'; st.d2 = today; }
          else if (q === 'prev') { var r2 = monthRange(shiftMonth(ym(today), -1)); st.d1 = r2[0]; st.d2 = r2[1]; }
          else if (q === 'year') { st.d1 = today.slice(0, 4) + '-01-01'; st.d2 = today; }
          else { st.d1 = App.addDays(-(+q) + 1); st.d2 = today; }
        }
        fire();
      }
    });
    return { get: function () { return Object.assign({}, st); }, set: function (o) { Object.assign(st, o); sync(); } };
  };
})();
