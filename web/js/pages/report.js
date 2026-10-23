/* 생산 보고서 공통 화면: 서버 /api/report/<이름> 이 준 섹션(표·차트)을 그대로 그림 */
App.pages.report = function (root, args, item) {
  var name = args.report;
  var MODE = { daily: 'date', monthly: 'month', equip: 'range', worker: 'range', defect: 'year', month: 'month', year: 'month', qmonth: 'month' }[name] || 'range';
  root.innerHTML = '<div class="toolbar"><span data-period style="display:contents"></span><span class="grow"></span>' +
    '<button class="btn" data-a="print">인쇄</button><button class="btn" data-a="xlsx">엑셀로 저장</button></div><div data-body><div class="muted">불러오는 중…</div></div>';
  var body = root.querySelector('[data-body]');
  var data = null;
  var key = 'rep_' + name;
  var period = App.periodBar(root.querySelector('[data-period]'), MODE, App.store.get(key, null), function (p) { App.store.set(key, p); load(); });

  function fmt(v, t) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return App.esc(v);
    if (t === 'pct') return (v * 100).toFixed(1) + '%';
    if (t === 'pct2') return (v * 100).toFixed(2) + '%';
    if (t === 'int') return App.fmt(Math.round(v));
    if (t === 'num1') return App.fmt(v, 1);
    if (t === 'num') return App.fmt(v, 2);
    return App.fmt(v, 2);
  }
  function isNum(t) { return t && t !== 'text'; }

  function table(sec) {
    var cols = sec.cols;
    var h = ['<div class="rep-wrap"><table class="rep"><thead><tr>'];
    cols.forEach(function (c, i) {
      h.push('<th class="' + (sec.freeze && i < sec.freeze ? 'fz' : '') + '"' + (c.w ? ' style="min-width:' + c.w + 'px"' : '') + '>' + App.esc(c.l) + '</th>');
    });
    h.push('</tr></thead><tbody>');
    function row(r, ri, cls) {
      h.push('<tr class="' + (cls || '') + '">');
      r.forEach(function (v, i) {
        var t = (cols[i] || {}).t;
        if (t === 'auto') t = (sec.rowtypes && sec.rowtypes[ri]) || 'int';
        var neg = typeof v === 'number' && v < 0;
        h.push('<td class="' + (isNum(t) && (typeof v === 'number') ? 'n ' : '') + (neg ? 'neg ' : '') + (sec.freeze && i < sec.freeze ? 'fz' : '') + '">' + fmt(v, t) + '</td>');
      });
      h.push('</tr>');
    }
    sec.rows.forEach(function (r, i) { row(r, i); });
    if (!sec.rows.length) h.push('<tr><td colspan="' + cols.length + '" class="muted" style="text-align:center;padding:24px">자료가 없습니다.</td></tr>');
    if (sec.total) row(sec.total, -1, 'tot');
    h.push('</tbody></table></div>');
    return h.join('');
  }
  function chart(sec) {
    var W = 900, H = 220, pl = 84, pb = 22, pt = 8;
    var n = sec.labels.length, ns = sec.series.length;
    var max = 0;
    sec.series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    if (!max) return '<div class="chart muted">자료가 없습니다.</div>';
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.ceil(max / step) * step;
    var colors = ['#2f5f8f', '#b7c4d3'];
    var gw = (W - pl) / n, bw = Math.max(2, Math.min(18, (gw - 4) / ns));
    var y = function (v) { return pt + (H - pb - pt) * (1 - v / top); };
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">'];
    for (var g = 0; g <= 4; g++) {
      var v = top * g / 4, yy = y(v);
      s.push('<line x1="' + pl + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#e3e8ee"/>');
      s.push('<text x="' + (pl - 6) + '" y="' + (yy + 4) + '" font-size="10" text-anchor="end" fill="#8a95a1">' + App.fmt(v) + '</text>');
    }
    sec.labels.forEach(function (l, i) {
      var x0 = pl + gw * i + (gw - bw * ns) / 2;
      sec.series.forEach(function (sr, j) {
        var v = sr.values[i];
        if (v) s.push('<rect x="' + (x0 + j * bw) + '" y="' + y(v) + '" width="' + (bw - 1) + '" height="' + (H - pb - y(v)) + '" fill="' + colors[j % 2] + '" rx="1"><title>' + App.esc(l + ' ' + sr.name + ': ' + App.fmt(v)) + '</title></rect>');
      });
      if (n <= 16 || i % 2 === 0) s.push('<text x="' + (pl + gw * i + gw / 2) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#56636f">' + App.esc(l) + '</text>');
    });
    s.push('</svg>');
    return '<div class="chart">' + s.join('') + '<div class="legend">' + sec.series.map(function (sr, j) {
      return '<span><i style="background:' + colors[j % 2] + '"></i>' + App.esc(sr.name) + '</span>';
    }).join('') + '</div></div>';
  }
  function render(d) {
    data = d;
    var h = ['<div class="rep-head"><h2>' + App.esc(d.title) + '</h2>' + (d.subtitle ? '<span class="muted">' + App.esc(d.subtitle) + '</span>' : '') + '</div>'];
    d.sections.forEach(function (sec) {
      h.push('<div class="rep-sec"><h3>' + App.esc(sec.title || '') + '</h3>' + (sec.note ? '<div class="note">' + App.esc(sec.note) + '</div>' : '') +
        (sec.type === 'bars' ? chart(sec) : table(sec)) + '</div>');
    });
    body.innerHTML = h.join('');
    // 왼쪽 고정 열 위치
    App.$$('table.rep', body).forEach(function (t) {
      var first = t.querySelector('tr');
      if (!first) return;
      var left = 0;
      App.$$('th.fz', first).forEach(function (th, i) {
        App.$$('tr', t).forEach(function (tr) { var c = tr.children[i]; if (c && c.classList.contains('fz')) c.style.left = left + 'px'; });
        left += th.offsetWidth;
      });
    });
  }
  function load() {
    var p = period.get();
    var q = Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k] || ''); }).join('&');
    body.innerHTML = '<div class="muted">계산 중…</div>';
    App.get('/api/report/' + name + '?' + q).then(render).catch(function (e) { body.innerHTML = ''; App.err(e); });
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (a === 'print') window.print();
    else if (a === 'xlsx' && data) {
      var used = {};
      var sheets = data.sections.filter(function (s) { return s.type !== 'bars'; }).map(function (s, i) {
        var nm = (s.title || ('표' + (i + 1))).replace(/^[①-⑳▪\s]+/, '').replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 28);
        while (used[nm]) nm = nm.slice(0, 26) + '_' + i;
        used[nm] = 1;
        var rows = s.rows.slice();
        if (s.total) rows.push(s.total);
        return { name: nm, head: s.cols.map(function (c) { return c.l; }), rows: rows, fmts: s.cols.map(function (c) { return c.t === 'pct' || c.t === 'pct2' ? c.t : ''; }) };
      });
      App.exportXlsx(data.title.replace(/[\\\/:*?"<>|]/g, ' ') + '.xlsx', sheets);
    }
  });
  load();
};
