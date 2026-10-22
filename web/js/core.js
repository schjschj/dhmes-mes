/* 대흥공업 통합관리 — 공통 화면 기능
 * 화면(페이지)은 /js/pages/<page>.js 에서 App.pages.<page> = function(root, args, item) {...} 로 등록합니다.
 * 메뉴는 서버 모듈(web.menu)에서 정하고, 여기서는 필요할 때 페이지 파일을 불러옵니다.
 */
(function () {
  'use strict';
  var App = window.App = { pages: {}, meta: null, user: '', cache: {}, timers: [] };

  // ------------------------------------------------------------------ 기본 유틸
  App.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  App.fmt = function (n, d) {
    if (n === null || n === undefined || n === '') return '';
    var x = Number(n);
    if (isNaN(x)) return App.esc(n);
    return x.toLocaleString('ko-KR', { maximumFractionDigits: d === undefined ? 3 : d });
  };
  App.pct = function (r) { return r === null || r === undefined ? '' : (r * 100).toFixed(1) + '%'; };
  App.today = function () { return App.dstr(new Date()); };
  App.dstr = function (d) {
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  };
  App.addDays = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return App.dstr(d); };
  App.h = function (html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  App.$ = function (sel, root) { return (root || document).querySelector(sel); };
  App.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  App.store = {
    get: function (k, d) { try { var v = localStorage.getItem('dh_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('dh_' + k, JSON.stringify(v)); } catch (e) { /* 무시 */ } }
  };
  // 접속 프로그램(대흥공업.exe)으로 연 창인지 — 주소 끝의 ?app=1 을 기억
  if (/[?&]app=1/.test(location.search)) { App.store.set('is_app', 1); history.replaceState(null, '', location.pathname + location.hash); }
  App.isApp = !!App.store.get('is_app', 0);

  // ------------------------------------------------------------------ 서버 통신
  App.api = function (method, url, body) {
    var opt = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      if (body instanceof Blob || body instanceof ArrayBuffer) { opt.body = body; opt.headers['Content-Type'] = 'application/octet-stream'; }
      else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    }
    return fetch(url, opt).then(function (r) {
      setConn(true);
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') < 0) {
        if (!r.ok) throw new Error('서버 오류 (' + r.status + ')');
        return r;
      }
      return r.json().then(function (j) {
        if (r.status === 401 && j && j.login && url !== '/api/login') {
          App.showLogin(App.meta ? '로그인이 끝났습니다. 다시 로그인하세요.' : '');
          throw new Error('로그인이 필요합니다.');
        }
        if (!r.ok) throw new Error(j && j.error ? j.error : '서버 오류 (' + r.status + ')');
        return j;
      });
    }, function () {
      setConn(false);
      throw new Error('서버에 연결할 수 없습니다.\n서버 PC 가 켜져 있는지, 네트워크가 연결되어 있는지 확인하세요.');
    });
  };
  App.get = function (url) { return App.api('GET', url); };
  App.saveBlob = function (blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  App.exportXlsx = function (filename, sheets) {
    return App.api('POST', '/api/xlsx', { filename: filename, sheets: sheets }).then(function (r) {
      return r.blob();
    }).then(function (b) {
      App.saveBlob(b, filename.toLowerCase().slice(-5) === '.xlsx' ? filename : filename + '.xlsx');
      App.toast('엑셀 파일을 저장했습니다.');
    }).catch(App.err);
  };
  App.stamp = function () { var d = new Date(); return App.today().replace(/-/g, '') + '_' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2); };

  function setConn(ok) {
    var c = document.getElementById('conn');
    if (c) { c.classList.toggle('off', !ok); c.title = ok ? '서버 연결됨' : '서버 연결 끊김'; }
  }

  // ------------------------------------------------------------------ 알림 / 대화창
  App.toast = function (msg, kind, ms) {
    var t = App.h('<div class="toast ' + (kind || '') + '"></div>');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (kind === 'bad' ? 6000 : 3000));
  };
  App.err = function (e) { App.toast(e && e.message ? e.message : String(e), 'bad'); };

  App.dialog = function (o) {
    var back = App.h('<div class="dlg-back"><div class="dlg ' + (o.wide ? 'wide' : '') + '">' +
      '<div class="dlg-h"><span class="grow"></span><button class="icon-btn" style="display:block" data-x>✕</button></div>' +
      '<div class="dlg-b"></div><div class="dlg-f"><span class="err"></span></div></div></div>');
    back.querySelector('.dlg-h .grow').textContent = o.title || '';
    var body = back.querySelector('.dlg-b');
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    var foot = back.querySelector('.dlg-f');
    var api = {
      el: back, body: body,
      close: function () { back.remove(); document.removeEventListener('keydown', onKey, true); if (o.onClose) o.onClose(); },
      error: function (m) { foot.querySelector('.err').textContent = m || ''; },
      busy: function (b) { App.$$('.dlg-f .btn', back).forEach(function (x) { x.disabled = b; }); }
    };
    (o.buttons || [{ label: '닫기' }]).forEach(function (b) {
      var btn = App.h('<button class="btn ' + (b.cls || '') + '"></button>');
      btn.textContent = b.label;
      btn.onclick = function () { if (b.onClick) b.onClick(api); else api.close(); };
      foot.appendChild(btn);
      if (b.default) api.defaultBtn = btn;
    });
    back.querySelector('[data-x]').onclick = api.close;
    back.addEventListener('mousedown', function (e) { if (e.target === back) back.dataset.down = '1'; });
    back.addEventListener('mouseup', function (e) { if (e.target === back && back.dataset.down && o.closeOnBack !== false) api.close(); back.dataset.down = ''; });
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
      else if (e.key === 'Enter' && api.defaultBtn && e.target.tagName !== 'TEXTAREA' && !e.isComposing) {
        e.preventDefault(); api.defaultBtn.click();
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    var first = back.querySelector(o.focus || '.dlg-b input:not([disabled]):not([type=checkbox]), .dlg-b select, .dlg-b textarea');
    if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    return api;
  };

  App.confirm = function (msg, okLabel, danger) {
    return new Promise(function (res) {
      var d = App.dialog({
        title: '확인', body: '<div style="white-space:pre-line">' + App.esc(msg) + '</div>',
        onClose: function () { res(false); },
        buttons: [{ label: '취소' }, {
          label: okLabel || '확인', cls: danger ? 'primary danger' : 'primary', default: true,
          onClick: function (a) { res(true); a.close(); }
        }]
      });
      return d;
    });
  };

  // ------------------------------------------------------------------ 참조 목록 (금형/작업자 등 자동완성)
  App.refList = function (table, force) {
    if (!force && App.cache['ref_' + table]) return Promise.resolve(App.cache['ref_' + table]);
    return App.get('/api/t/' + table).then(function (rows) { App.cache['ref_' + table] = rows; return rows; });
  };
  App.clearRef = function (table) { delete App.cache['ref_' + table]; };
  function refLabel(table, r) {
    var spec = App.meta.tables[table];
    var key = spec.key;
    var second = spec.cols.filter(function (c) { return c.k !== key && (c.t || 'text') === 'text'; })[0];
    return { value: r[key], label: second ? (r[second.k] || '') : '' };
  }
  App.datalist = function (table) {
    var id = 'dl-' + table;
    var dl = document.getElementById(id);
    if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
    App.refList(table).then(function (rows) {
      dl.innerHTML = rows.map(function (r) {
        var x = refLabel(table, r);
        return '<option value="' + App.esc(x.value) + '">' + App.esc(x.label) + '</option>';
      }).join('');
    });
    return id;
  };

  // ------------------------------------------------------------------ 입력창 (표 정의로 자동 생성)
  App.form = function (o) {
    var vals = Object.assign({}, o.values || {});
    var edit = o.mode === 'edit';
    var html = ['<div class="form">'];
    var lastGrp = '';
    var cols = o.cols.filter(function (c) { return !c.skip; });
    cols.forEach(function (c, i) {
      // 연속된 체크박스는 한 줄로 묶음
      if ((c.t || '') === 'yesno') {
        if (i > 0 && cols[i - 1].t === 'yesno') return;
        var run = [];
        for (var j = i; j < cols.length && cols[j].t === 'yesno'; j++) run.push(cols[j]);
        html.push('<div class="f full"><span>' + App.esc(run.length > 1 ? '구분' : '') + '&nbsp;</span><div class="chkrow">' + run.map(function (x) {
          var dis2 = (edit && x.lock_edit) || x.readonly ? ' disabled' : '';
          return '<label class="chk"><input type="checkbox" data-k="' + x.k + '"' + (vals[x.k] ? ' checked' : '') + dis2 + '> ' + App.esc(x.l) + '</label>';
        }).join('') + '</div></div>');
        return;
      }
      if ((c.grp || '') !== lastGrp && c.grp) html.push('<div class="grp">' + App.esc(c.grp) + '</div>');
      lastGrp = c.grp || lastGrp;
      var t = c.t || 'text';
      var v = vals[c.k];
      var dis = (edit && c.lock_edit) || c.readonly ? ' disabled' : '';
      var full = (t === 'memo' || c.full) ? ' full' : '';
      var lab = '<span>' + App.esc(c.l) + (c.req ? '<b>*</b>' : '') + '</span>';
      var inp;
      if (t === 'memo') inp = '<textarea class="input" data-k="' + c.k + '"' + dis + '>' + App.esc(v) + '</textarea>';
      else if (t === 'select') {
        var opts = (c.opts || []).slice();
        if (v && opts.indexOf(v) < 0) opts.push(v);
        inp = '<select class="input" data-k="' + c.k + '"' + dis + '><option value=""></option>' + opts.map(function (x) {
          return '<option' + (x === v ? ' selected' : '') + '>' + App.esc(x) + '</option>';
        }).join('') + '</select>';
      } else if (t === 'yesno') {
        inp = '<label class="chk" style="height:30px"><input type="checkbox" data-k="' + c.k + '"' + (v ? ' checked' : '') + dis + '> ' + App.esc(c.l) + '</label>';
        lab = '<span>&nbsp;</span>';
      } else if (t === 'date') inp = '<input type="date" class="input" data-k="' + c.k + '" value="' + App.esc(v || '') + '"' + dis + '>';
      else if (t === 'time') inp = '<input class="input" placeholder="08:30" maxlength="5" data-k="' + c.k + '" value="' + App.esc(v || '') + '"' + dis + '>';
      else if (t === 'int' || t === 'num') inp = '<input class="input num" inputmode="decimal" data-k="' + c.k + '" value="' + (v === null || v === undefined ? '' : App.fmt(v, 6)) + '"' + dis + '>';
      else if (t === 'ref') inp = '<input class="input" autocomplete="off" list="' + App.datalist(c.ref) + '" data-k="' + c.k + '" value="' + App.esc(v || '') + '"' + dis + '>';
      else inp = '<input class="input" data-k="' + c.k + '" value="' + App.esc(v === null || v === undefined ? '' : v) + '"' + dis + '>';
      var help = c.help ? '<small>' + App.esc(c.help) + '</small>' : '';
      html.push('<label class="f' + full + '">' + lab + inp + help + '</label>');
    });
    html.push('</div>');
    if (o.top) html.unshift(o.top);
    var readOnly = App.curLevel !== undefined && App.curLevel < 2 && !o.always;
    if (readOnly) html.unshift('<div class="notice" style="margin-bottom:12px">이 메뉴는 보기 권한만 있어서 저장할 수 없습니다.</div>');
    if (edit && (vals.created_by || vals.created)) {
      var au = '등록 ' + App.esc(vals.created_by || '-') + ' · ' + App.esc((vals.created || '').slice(0, 16));
      if (vals.updated && vals.updated !== vals.created) au += '  /  마지막 수정 ' + App.esc(vals.updated_by || '-') + ' · ' + App.esc(vals.updated.slice(0, 16));
      html.push('<div class="muted" style="font-size:12px;margin-top:12px;padding-top:8px;border-top:1px solid var(--line-2)">' + au + '</div>');
    }
    var body = App.h('<div>' + html.join('') + '</div>');
    function read() {
      var out = {};
      App.$$('[data-k]', body).forEach(function (el) {
        if (el.disabled) return;
        out[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
      });
      return out;
    }
    function setVal(k, v) {
      var el = body.querySelector('[data-k="' + k + '"]');
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = (el.classList.contains('num') && v !== '' && v !== null && v !== undefined) ? App.fmt(v, 6) : (v === null || v === undefined ? '' : v);
    }
    App.$$('input.num', body).forEach(function (el) {
      el.addEventListener('blur', function () {
        var n = Number(String(el.value).replace(/,/g, ''));
        if (el.value.trim() !== '' && !isNaN(n)) el.value = App.fmt(n, 6);
      });
    });
    if (o.onChange) {
      App.$$('[data-k]', body).forEach(function (el) {
        var fire = function () { o.onChange(el.dataset.k, el.type === 'checkbox' ? el.checked : el.value, setVal, read); };
        el.addEventListener('change', fire);
      });
    }
    var dlg = App.dialog({
      title: o.title, body: body, wide: o.wide, closeOnBack: false,
      buttons: readOnly ? [{ label: '닫기' }] : (o.extraButtons || []).concat([{ label: '취소' }, {
        label: o.okLabel || '저장', cls: 'primary', default: true,
        onClick: function (d) {
          d.error('');
          d.busy(true);
          Promise.resolve(o.onSave(read(), d)).then(function (r) {
            d.busy(false);
            if (r !== false) d.close();
          }, function (e) { d.busy(false); d.error(e.message || String(e)); });
        }
      }])
    });
    dlg.setVal = setVal;
    dlg.read = read;
    if (o.onOpen) o.onOpen(dlg, setVal, read);
    return dlg;
  };

  // ------------------------------------------------------------------ 표(그리드)
  function Grid(container, o) {
    this.o = o;
    this.cols = o.cols;
    this.rows = [];
    this.view = [];
    this.filter = '';
    this.sort = o.sort || null; // {k, dir}
    this.selKey = null;
    this.wrap = App.h('<div class="grid-wrap"></div>');
    this.foot = App.h('<div class="grid-foot"><span class="cnt"></span><span class="hint">' + App.esc(o.hint || '') + '</span></div>');
    container.appendChild(this.wrap);
    container.appendChild(this.foot);
    var self = this;
    this.wrap.addEventListener('click', function (e) {
      var th = e.target.closest('th');
      if (th) { self.sortBy(th.dataset.k); return; }
      var tr = e.target.closest('tr[data-i]');
      if (tr) self.select(self.view[+tr.dataset.i], e);
    });
    this.wrap.addEventListener('dblclick', function (e) {
      var tr = e.target.closest('tr[data-i]');
      if (tr && o.onDbl) o.onDbl(self.view[+tr.dataset.i]);
    });
  }
  Grid.prototype.key = function (r) { return r ? r[this.o.key || 'id'] : null; };
  Grid.prototype.setRows = function (rows) {
    this.rows = rows || [];
    this.render();
  };
  Grid.prototype.setFilter = function (t) { this.filter = (t || '').trim().toLowerCase(); this.render(); };
  Grid.prototype.sortBy = function (k) {
    if (!k) return;
    if (this.sort && this.sort.k === k) this.sort.dir = -this.sort.dir; else this.sort = { k: k, dir: 1 };
    this.render();
  };
  Grid.prototype.value = function (c, r) { return c.val ? c.val(r) : r[c.k]; };
  Grid.prototype.render = function () {
    var self = this, cols = this.cols;
    var rows = this.rows;
    if (this.filter) {
      var words = this.filter.split(/\s+/);
      rows = rows.filter(function (r) {
        var s = cols.map(function (c) { var v = self.value(c, r); return v === null || v === undefined ? '' : String(v); }).join(' ').toLowerCase();
        return words.every(function (w) { return s.indexOf(w) >= 0; });
      });
    }
    if (this.o.extraFilter) rows = rows.filter(this.o.extraFilter);
    if (this.sort) {
      var c = cols.filter(function (x) { return x.k === self.sort.k; })[0];
      if (c) {
        var dir = this.sort.dir;
        rows = rows.slice().sort(function (a, b) {
          var x = self.value(c, a), y = self.value(c, b);
          var ex = x === null || x === undefined || x === '', ey = y === null || y === undefined || y === '';
          if (ex && ey) return 0; if (ex) return 1; if (ey) return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
          return String(x).localeCompare(String(y), 'ko', { numeric: true }) * dir;
        });
      }
    }
    this.view = rows;
    var h = ['<table class="grid"><thead><tr>'];
    cols.forEach(function (c) {
      var s = self.sort && self.sort.k === c.k;
      h.push('<th data-k="' + c.k + '" class="' + (s ? 'sorted' : '') + '" style="' + (c.w ? 'min-width:' + c.w + 'px;' : '') +
        (isNum(c) ? 'text-align:right' : '') + '">' + App.esc(c.l) + (s ? '<span class="arr">' + (self.sort.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>');
    });
    h.push('</tr></thead><tbody>');
    var lim = Math.min(rows.length, this.o.limit || 3000);
    for (var i = 0; i < lim; i++) {
      var r = rows[i];
      var cls = (this.o.rowClass ? this.o.rowClass(r) : '') + (this.key(r) === this.selKey && this.selKey !== null ? ' sel' : '');
      h.push('<tr data-i="' + i + '" class="' + cls + '">');
      for (var j = 0; j < cols.length; j++) {
        var c2 = cols[j];
        var v = this.value(c2, r);
        var out = c2.fmt ? c2.fmt(v, r) : defFmt(c2, v);
        var cc = (isNum(c2) ? 'c-num ' : '') + (c2.t === 'yesno' || c2.center ? 'c-center ' : '') + (c2.mono ? 'c-mono ' : '');
        h.push('<td class="' + cc + '"' + (c2.w ? ' style="max-width:' + Math.max(c2.w * 2.2, 160) + 'px"' : '') + ' title="' + (c2.fmt ? '' : App.esc(v === null || v === undefined ? '' : v)) + '">' + out + '</td>');
      }
      h.push('</tr>');
    }
    h.push('</tbody></table>');
    if (!rows.length) h.push('<div class="grid-empty">' + App.esc(this.o.emptyText || (this.rows.length ? '검색 결과가 없습니다.' : '자료가 없습니다.')) + '</div>');
    var st = this.wrap.scrollTop, sl = this.wrap.scrollLeft;
    this.wrap.innerHTML = h.join('');
    this.wrap.scrollTop = st; this.wrap.scrollLeft = sl;
    var more = rows.length > lim ? ' (앞의 ' + lim.toLocaleString() + '건만 표시 — 검색으로 좁혀 주세요)' : '';
    this.foot.querySelector('.cnt').textContent = rows.length === this.rows.length
      ? '전체 ' + rows.length.toLocaleString() + '건' + more
      : rows.length.toLocaleString() + '건 / 전체 ' + this.rows.length.toLocaleString() + '건' + more;
    if (this.o.onRender) this.o.onRender(rows);
  };
  Grid.prototype.select = function (r, e) {
    this.selKey = this.key(r);
    App.$$('tr.sel', this.wrap).forEach(function (x) { x.classList.remove('sel'); });
    var i = this.view.indexOf(r);
    var tr = this.wrap.querySelector('tr[data-i="' + i + '"]');
    if (tr) tr.classList.add('sel');
    if (this.o.onSelect) this.o.onSelect(r, e);
  };
  Grid.prototype.selected = function () {
    var self = this;
    if (this.selKey === null) return null;
    return this.rows.filter(function (r) { return self.key(r) === self.selKey; })[0] || null;
  };
  Grid.prototype.selectKey = function (k, scroll) {
    this.selKey = k;
    this.render();
    var r = this.selected();
    if (r && scroll) {
      var tr = this.wrap.querySelector('tr.sel');
      if (tr) tr.scrollIntoView({ block: 'center' });
    }
    if (r && this.o.onSelect) this.o.onSelect(r);
    return r;
  };
  Grid.prototype.sheet = function (name, cols) {
    var self = this;
    cols = cols || this.cols.filter(function (c) { return !c.noExport; });
    return {
      name: name,
      head: cols.map(function (c) { return c.l; }),
      rows: this.view.map(function (r) {
        return cols.map(function (c) {
          var v = c.xval ? c.xval(r) : self.value(c, r);
          if (c.t === 'yesno') return v ? '예' : '';
          return v === undefined ? null : v;
        });
      })
    };
  };
  function isNum(c) { return c.t === 'int' || c.t === 'num' || c.num; }
  function defFmt(c, v) {
    if (v === null || v === undefined || v === '') return '';
    if (c.t === 'int' || c.t === 'num') return App.fmt(v);
    if (c.t === 'yesno') return v ? '✔' : '';
    return App.esc(v);
  }
  App.Grid = Grid;

  // 표 정의(spec.cols) → 그리드 열
  App.specCols = function (table, opt) {
    opt = opt || {};
    return App.meta.tables[table].cols.filter(function (c) { return opt.all || !c.hide; }).map(function (c) {
      return { k: c.k, l: c.l, t: c.t, w: c.w };
    });
  };

  // 등록/수정 기록 열 (목록 맨 뒤에 붙임)
  App.auditCols = function (opt) {
    var c = [
      { k: 'created_by', l: '등록자', w: 70 },
      { k: 'created', l: '등록일시', w: 115, fmt: function (v) { return App.esc((v || '').slice(0, 16)); } },
      { k: 'updated_by', l: '수정자', w: 70, val: function (r) { return r.updated && r.created && r.updated !== r.created ? r.updated_by : ''; } },
      { k: 'updated', l: '수정일시', w: 115, val: function (r) { return r.updated && r.updated !== r.created ? r.updated : ''; }, fmt: function (v) { return App.esc((v || '').slice(0, 16)); } }
    ];
    return opt === 'created' ? c.slice(0, 2) : c;
  };

  // 공통: 바(잔여율) 표시
  App.ratioBar = function (ratio, level) {
    if (ratio === null || ratio === undefined) return '<span class="muted">-</span>';
    var cls = level === '초과' || level === '2차' ? 'bad' : level === '1차' ? 'warn' : '';
    return '<span class="bar ' + cls + '"><i style="width:' + Math.max(2, Math.min(100, ratio * 100)) + '%"></i></span>' + App.pct(ratio);
  };
  App.levelTag = function (lv) {
    if (!lv) return '';
    var cls = lv === '초과' || lv === '2차' ? 'bad' : lv === '1차' ? 'warn' : 'ok';
    return '<span class="tag ' + cls + '">' + App.esc(lv === '1차' || lv === '2차' ? lv + ' 알람' : lv) + '</span>';
  };
  App.stateTag = function (st) {
    var cls = st === '품절' || st === '미달' ? 'bad' : st === '주의' ? 'warn' : 'ok';
    return '<span class="tag ' + cls + '">' + App.esc(st) + '</span>';
  };

  // ------------------------------------------------------------------ 사용자
  App.askUser = function (force) {
    return App.refList('workers').then(function (ws) {
      return new Promise(function (res) {
        var names = ws.filter(function (w) { return w.active; }).map(function (w) { return w.name; });
        var body = App.h('<div><p class="muted" style="margin-top:0">입력·수정 기록에 남길 이름을 선택하거나 입력하세요. 이 PC 에 저장됩니다.</p>' +
          '<input class="input" style="width:100%;margin-bottom:10px" placeholder="이름" value="' + App.esc(App.user) + '">' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' + names.map(function (n) {
            return '<button class="btn small" data-n="' + App.esc(n) + '">' + App.esc(n) + '</button>';
          }).join('') + '</div></div>');
        var inp = body.querySelector('input');
        var d = App.dialog({
          title: '사용자 선택', body: body, closeOnBack: !!App.user,
          onClose: function () { res(App.user); },
          buttons: [{
            label: '확인', cls: 'primary', default: true, onClick: function (a) {
              var v = inp.value.trim();
              if (!v) { a.error('이름을 입력하세요.'); return; }
              App.user = v; App.store.set('user', v); showUser(); a.close();
            }
          }]
        });
        App.$$('[data-n]', body).forEach(function (b) {
          b.onclick = function () { inp.value = b.dataset.n; d.defaultBtn.click(); };
        });
      });
    });
  };
  function showUser() {
    document.getElementById('userChip').textContent = '👤 ' + (App.user || '') + (App.me && App.me.admin ? ' (관리자)' : '');
  }

  // ------------------------------------------------------------------ 로그인 / 권한
  App.level = function (group) {
    if (!App.me) return 0;
    if (App.me.admin || group === '홈') return 3;
    return (App.me.perms || {})[group] || 0;
  };
  App.showLogin = function (msg) {
    if (document.getElementById('loginBox')) return;
    var saved = App.store.get('login_id', '');
    var box = App.h('<div id="loginBox" class="login-back"><form class="login" autocomplete="on">' +
      '<div class="brand-big"><div class="logo">DH</div><div><b>' + App.esc((App.meta && App.meta.company) || '대흥공업') + '</b><div class="muted">통합관리</div></div></div>' +
      (msg ? '<div class="notice" style="margin:0 0 12px">' + App.esc(msg) + '</div>' : '') +
      '<label class="f"><span>아이디</span><input class="input" name="login" autocomplete="username" value="' + App.esc(saved) + '"></label>' +
      '<label class="f"><span>비밀번호</span><input class="input" name="password" type="password" autocomplete="current-password"></label>' +
      '<label class="chk" style="margin:4px 0 14px"><input type="checkbox" name="remember" checked> 이 PC 에서 로그인 유지 (30일)</label>' +
      '<div class="err" style="color:var(--bad);min-height:18px;font-size:12.5px;margin-bottom:6px"></div>' +
      '<button class="btn primary" style="width:100%;height:38px">로그인</button>' +
      '<div class="muted" style="font-size:11.5px;margin-top:12px">계정이 없거나 비밀번호를 잊었으면 관리자에게 문의하세요.</div>' +
      (App.isApp ? '' : '<div style="font-size:11.5px;margin-top:8px"><a href="/api/client.zip" download="대흥공업_접속프로그램.zip">PC 접속 프로그램 내려받기</a> <span class="muted">— 주소 없이 아이콘으로 바로 열기</span></div>') +
      '</form></div>');
    document.body.appendChild(box);
    var f = box.querySelector('form');
    (saved ? f.password : f.login).focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var err = f.querySelector('.err');
      err.textContent = '';
      App.api('POST', '/api/login', { login: f.login.value.trim(), password: f.password.value, remember: f.remember.checked }).then(function () {
        App.store.set('login_id', f.login.value.trim());
        location.reload();
      }).catch(function (x) { err.textContent = x.message; f.password.select(); });
    };
  };
  App.changePassword = function (force) {
    var d = App.form({
      title: force ? '비밀번호를 바꿔 주세요' : '비밀번호 변경', okLabel: '변경', always: true,
      top: force ? '<div class="notice" style="margin-bottom:12px">처음 받은 비밀번호입니다. 본인만 아는 비밀번호로 바꿔 주세요.</div>' : '',
      cols: [{ k: 'old', l: '지금 비밀번호', req: true }, { k: 'new', l: '새 비밀번호 (4자 이상)', req: true }, { k: 'new2', l: '새 비밀번호 한 번 더', req: true }],
      onSave: function (v) {
        if (v.new !== v.new2) return Promise.reject(new Error('새 비밀번호가 서로 다릅니다.'));
        return App.api('POST', '/api/password', { old: v.old, new: v.new }).then(function () { App.toast('비밀번호를 바꿨습니다.'); if (App.me) App.me.must_change = false; });
      }
    });
    App.$$('input', d.el).forEach(function (i) { i.type = 'password'; });
    return d;
  };
  function userMenu() {
    var d = App.dialog({
      title: App.user + (App.me && App.me.admin ? ' (관리자)' : ''),
      body: '<div class="muted" style="margin-bottom:10px">아이디: ' + App.esc(App.me ? App.me.login : '') + '</div>' +
        '<div style="display:flex;gap:8px"><button class="btn" data-u="pw">비밀번호 변경</button><button class="btn danger" data-u="out">로그아웃</button></div>' +
        (App.isApp ? '' : '<div class="client-dl"><b>PC 접속 프로그램</b><div class="muted">주소를 치지 않고, 바탕화면 아이콘을 눌러 전용 창으로 여는 프로그램입니다.</div>' +
          '<a class="btn small" href="/api/client.zip" download="대흥공업_접속프로그램.zip">접속 프로그램 내려받기 (.zip)</a></div>'),
      buttons: [{ label: '닫기' }]
    });
    d.el.querySelector('[data-u=pw]').onclick = function () { d.close(); App.changePassword(false); };
    d.el.querySelector('[data-u=out]').onclick = function () {
      App.api('POST', '/api/logout').then(function () { location.hash = ''; location.reload(); });
    };
  }

  // ------------------------------------------------------------------ 메뉴 / 화면 이동
  var current = null;
  function buildNav() {
    var nav = document.getElementById('nav');
    var h = [];
    App.meta.menu.forEach(function (g) {
      if (g.group !== '홈') h.push('<div class="nav-group">' + App.esc(g.name || g.group) + '</div>');
      g.items.forEach(function (m) {
        h.push('<a class="nav-item" href="#/' + m.id + '" data-id="' + m.id + '"><span>' + App.esc(m.label) + '</span><span class="nav-badge" style="display:none"></span></a>');
      });
    });
    nav.innerHTML = h.join('');
  }
  // 메뉴 배치를 바꾼 뒤 — 메뉴만 다시 받아서 그림 (화면은 그대로)
  App.reloadMenu = function () {
    return App.get('/api/meta').then(function (m) {
      App.meta = m; App.me = m.me;
      buildNav();
      var id = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
      App.$$('.nav-item').forEach(function (a) { a.classList.toggle('on', a.dataset.id === id); });
      var it = App.findMenu(id);
      if (it) {
        document.getElementById('crumbGroup').textContent = it.group === '홈' ? '' : (it.group_name || it.group);
        document.getElementById('crumbTitle').textContent = it.label;
      }
      App.refreshBadges();
    });
  };
  App.findMenu = function (id) {
    for (var i = 0; i < App.meta.menu.length; i++) {
      var g = App.meta.menu[i];
      for (var j = 0; j < g.items.length; j++) if (g.items[j].id === id) return g.items[j];
    }
    return null;
  };
  App.go = function (id, params) {
    App.nextParams = params || null;
    if (location.hash === '#/' + id) route(); else location.hash = '#/' + id;
  };
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src + '?v=' + encodeURIComponent(App.meta.version);
      s.onload = res;
      s.onerror = function () { rej(new Error('화면 파일을 불러오지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
  }
  // 서버 확인 (20초마다): 새 버전으로 바뀌었는지, 업데이트 예정 알림
  App.stale = false;
  function banner(html, cls) {
    var b = document.getElementById('sysBanner');
    if (!html) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'sysBanner';
      b.style.cssText = 'padding:8px 14px;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      var top = document.getElementById('top');
      top.parentNode.insertBefore(b, top.nextSibling);
    }
    b.style.background = cls === 'warn' ? '#fff4d6' : '#e3f0ff';
    b.style.borderBottom = '1px solid ' + (cls === 'warn' ? '#f0c040' : '#9cc4f0');
    b.innerHTML = html;
  }
  var noticeEnd = 0, noticeIv = null;
  function ping() {
    fetch('/api/ping', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      setConn(true);
      if (App.meta && j.v && j.v !== App.meta.version) {
        App.stale = true;
        clearInterval(noticeIv); noticeIv = null;
        banner('<b>프로그램이 새 버전(v' + App.esc(j.v) + ')으로 바뀌었습니다.</b><span>새로고침하면 새 화면이 나옵니다. 입력 중인 것이 있으면 저장한 뒤 누르세요.</span>' +
          '<button class="btn small primary" onclick="location.reload()">새로고침</button>', 'info');
        return;
      }
      if (j.notice) {
        noticeEnd = Date.now() + j.notice.secs * 1000;
        if (!noticeIv) {
          var tick = function () {
            var s = Math.max(0, Math.round((noticeEnd - Date.now()) / 1000));
            banner('<b>⚠ ' + (s > 0 ? (s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초') + ' 뒤' : '지금') + ' 프로그램 업데이트를 합니다.</b>' +
              '<span>20~30초 동안 연결이 끊깁니다. 입력 중인 내용을 지금 저장하세요.</span>', 'warn');
          };
          tick(); noticeIv = setInterval(tick, 1000);
        }
      } else if (noticeIv) { clearInterval(noticeIv); noticeIv = null; banner(''); }
    }).catch(function () { setConn(false); });
  }
  App.startPing = function () { ping(); setInterval(ping, 20000); };

  App.reloadPage = function () { route(); };
  function route() {
    if (App.stale) { location.reload(); return; }      // 새 버전으로 바뀐 뒤 메뉴를 누르면 새로 불러옴
    var id = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    var item = App.findMenu(id) || App.findMenu('home');
    App.$$('.nav-item').forEach(function (a) { a.classList.toggle('on', a.dataset.id === item.id); });
    document.getElementById('crumbGroup').textContent = item.group === '홈' ? '' : (item.group_name || item.group);
    document.getElementById('crumbTitle').textContent = item.label;
    document.title = item.label + ' - ' + (App.meta.company || '') + ' 통합관리';
    document.getElementById('app').classList.remove('nav-open');
    var lv = App.level(item.group);
    App.curLevel = lv;
    document.body.classList.toggle('ro', lv < 2);
    document.body.classList.toggle('nodel', lv < 3);
    if (current && current.destroy) { try { current.destroy(); } catch (e) { /* 무시 */ } }
    App.timers.forEach(clearInterval); App.timers = [];
    // 화면마다 새 #page 로 바꿔 끼움 — 앞 화면이 붙여 둔 클릭 처리 등이 남아서 두 번 실행되지 않게
    var oldPage = document.getElementById('page');
    var page = oldPage.cloneNode(false);
    oldPage.replaceWith(page);
    page.innerHTML = '<div class="muted">불러오는 중…</div>';
    var params = App.nextParams; App.nextParams = null;
    var p = App.pages[item.page] ? Promise.resolve() : loadScript('/js/pages/' + item.page + '.js');
    p.then(function () {
      page.innerHTML = '';
      page.scrollTop = 0;
      current = App.pages[item.page](page, Object.assign({}, item.args, params || {}), item) || null;
    }).catch(function (e) { page.innerHTML = '<div class="panel panel-b">' + App.esc(e.message) + '</div>'; });
  }

  // 메뉴 옆 숫자(미달 부품, 금형 알람) — 2분마다 갱신
  App.refreshBadges = function () {
    return App.get('/api/dashboard').then(function (d) {
      setBadge('parts', d.shortage.length, '');
      var bad = d.mold_alarms.filter(function (m) { return m.level === '초과' || m.level === '2차'; }).length;
      var warn = d.mold_alarms.length - bad;
      setBadge('mold_status', bad || warn, bad ? '' : 'warn');
      App.lastDash = d;
      return d;
    }).catch(function () { /* 연결 표시만 */ });
  };
  function setBadge(id, n, cls) {
    var a = App.$('.nav-item[data-id="' + id + '"] .nav-badge');
    if (!a) return;
    a.style.display = n ? '' : 'none';
    a.className = 'nav-badge ' + (cls || '');
    a.textContent = n;
  }

  function start() {
    App.get('/api/meta').then(function (m) {
      App.meta = m;
      App.me = m.me;
      App.user = m.me.name;
      document.getElementById('brandName').textContent = m.company || '대흥공업';
      document.getElementById('sideFoot').textContent = 'v' + m.version;
      buildNav();
      showUser();
      window.addEventListener('hashchange', route);
      route();
      App.refreshBadges();
      setInterval(App.refreshBadges, 120000);
      App.startPing();
      if (App.ai) App.ai.init();
      if (m.me.must_change) App.changePassword(true);
    }).catch(function (e) {
      if (document.getElementById('loginBox')) return;
      document.getElementById('page').innerHTML = '<div class="panel panel-b" style="white-space:pre-line">' + App.esc(e.message) + '</div>';
    });
    document.getElementById('userChip').onclick = userMenu;
    document.getElementById('navToggle').onclick = function () { document.getElementById('app').classList.toggle('nav-open'); };
  }
  document.addEventListener('DOMContentLoaded', start);
})();
