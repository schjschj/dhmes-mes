/* 생산 기준: 평일 · 특근 · 특근2 각각의 근무시간 · 휴게 · 교대기준 (엑셀 '기준정보(휴게)' 대체) */
App.pages.prod_std = function (root) {
  root.innerHTML = '<div class="desc">여기 값을 바꾸면 <b>모든 생산실적의 작업시간·주야 시간·가동률이 다시 계산</b>됩니다. ' +
    '실적의 <b>구분</b>(빈칸=평일 / 특근 / 특근2)에 따라 아래 기준이 따로 적용됩니다. 적용하지 않는 휴게는 시작·종료를 모두 00:00 으로 두세요. 자정은 00:00 으로 입력합니다.</div>' +
    '<div data-body class="muted">불러오는 중…</div>';
  var body = root.querySelector('[data-body]');
  var KINDS = [['normal', '평일', ''], ['t1', '특근', '특근'], ['t2', '특근2', '특근2']];
  var cur = null;
  function inp(attr, v, w) { return '<input class="input" style="width:' + (w || 76) + 'px" ' + attr + ' value="' + App.esc(v) + '">'; }
  function card(k, d) {
    var s = d.std, key = k[0];
    var w = s['work_' + key];
    return '<div class="panel"><div class="panel-h">' + k[1] + '<span class="grow"></span><span class="tag steel">조업가능 ' + App.fmt(d.avail[k[2]]) + '분</span></div><div class="panel-b">' +
      '<div class="kv" style="grid-template-columns:96px 1fr;align-items:center;margin-bottom:10px">' +
      '<span class="k">근무시간</span><span>' + inp('data-w="' + key + '" data-j="0"', w[0]) + ' ~ ' + inp('data-w="' + key + '" data-j="1"', w[1]) +
      ' <span class="muted">' + App.fmt(d.work[k[2]]) + '분</span></span>' +
      '<span class="k">주/야 교대기준</span><span>' + inp('data-s="shift_' + key + '"', s['shift_' + key]) + ' <span class="muted">까지 주간</span></span></div>' +
      '<table class="mini"><tr><th>휴게</th><th>시작</th><th>종료</th></tr>' +
      s['breaks_' + key].map(function (b, i) {
        return '<tr><td>' + App.esc(b[0]) + '</td><td>' + inp('data-b="' + key + '" data-i="' + i + '" data-j="1"', b[1]) + '</td><td>' + inp('data-b="' + key + '" data-i="' + i + '" data-j="2"', b[2]) + '</td></tr>';
      }).join('') + '</table>' +
      '<div class="muted" style="font-size:11.5px;margin-top:6px">조업가능 = 근무시간 − 근무시간 안의 휴게</div></div></div>';
  }
  function load() {
    App.get('/api/production/std').then(function (d) {
      cur = d.std;
      body.className = '';
      body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px" class="std3">' +
        KINDS.map(function (k) { return card(k, d); }).join('') + '</div>' +
        '<div class="panel" style="margin-top:12px"><div class="panel-h">공통</div><div class="panel-b"><div class="form" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
        '<label class="f"><span>주간 시작시각</span><input class="input" data-s="day_start" value="' + App.esc(d.std.day_start) + '"><small>이 시각부터 교대기준까지 주간, 그 외 야간</small></label>' +
        '<label class="f"><span>제품검사 LOSS (릴당 EA)</span><input class="input" data-s="inspect_per_reel" value="' + App.esc(d.std.inspect_per_reel) + '"></label>' +
        '</div></div></div>' +
        '<div style="margin-top:12px"><button class="btn primary" data-a="save">저장하고 다시 계산</button></div>';
    }).catch(App.err);
  }
  root.addEventListener('click', function (e) {
    if (!(e.target.dataset && e.target.dataset.a === 'save')) return;
    var b = {};
    KINDS.forEach(function (k) {
      b['breaks_' + k[0]] = JSON.parse(JSON.stringify(cur['breaks_' + k[0]]));
      b['work_' + k[0]] = cur['work_' + k[0]].slice();
    });
    App.$$('[data-b]', root).forEach(function (el) { b['breaks_' + el.dataset.b][+el.dataset.i][+el.dataset.j] = el.value.trim(); });
    App.$$('[data-w]', root).forEach(function (el) { b['work_' + el.dataset.w][+el.dataset.j] = el.value.trim(); });
    App.$$('[data-s]', root).forEach(function (el) { b[el.dataset.s] = el.value.trim(); });
    App.api('PUT', '/api/production/std', b).then(function () { App.toast('저장했습니다. 모든 실적에 바로 반영됩니다.'); App.clearRef('_std'); App.refreshBadges(); load(); }).catch(App.err);
  });
  load();
};
