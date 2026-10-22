/* 편성 노하우 — 설정 · 백업 화면 안 패널
   배운 노하우: 작업지시서를 승인할 때마다 그날 계획과 비교해서 자동으로 배우고, 기준을 넘으면 계획 계산에 자동 적용 (승인 없음)
   직접 넣은 노하우: 사람이 넣거나 AI 에게 "앞으로 …" 라고 말한 것 */
App.knowhowPanel = function (box) {
  var esc = App.esc;
  var m = App.findMenu('plan');
  var lv = m ? App.level(m.group) : 0;
  var K = {}, RK = {}, st = null, showObs = false;
  var STATE = function (x) {
    if (x.user_off) return '<span class="tag">꺼 둠</span>';
    if (x.on_) return x.kind === 'extra' ? '<span class="tag" style="background:#eef4fb">AI 참고</span>' : '<span class="tag" style="background:#e3f4e8;color:#1e7b3a">적용 중</span>';
    return '<span class="tag" style="background:#f3f3f3;color:#777">지켜보는 중</span>';
  };
  function pct(v) { return v === null || v === undefined ? '-' : v + '%'; }
  function draw() {
    var c = st.cfg, a = st.accuracy;
    var on = st.learned.filter(function (x) { return x.on_ && !x.user_off; });
    var watch = st.learned.filter(function (x) { return !x.on_ && !x.user_off; });
    var off = st.learned.filter(function (x) { return x.user_off; });
    var row = function (x) {
      return '<tr><td style="white-space:nowrap">' + STATE(x) + '</td><td><span class="muted">' + esc(K[x.kind] || x.kind) + '</span> <b>' + esc(x.text) + '</b>' +
        '<div class="muted" style="font-size:11.5px">' + esc(x.evidence || '') + '</div></td>' +
        '<td class="num">' + x.hits + ' / ' + x.opp + '<br><span class="muted">' + Math.round(x.ratio) + '%</span></td>' +
        '<td style="white-space:nowrap">' + (lv >= 2 ? (x.user_off ? '<button class="btn small" data-lk="' + esc(x.key) + '|0">다시 켜기</button>' : '<button class="btn small" data-lk="' + esc(x.key) + '|1">끄기</button>') : '') + '</td></tr>';
    };
    var tbl = function (arr, empty) { return arr.length ? '<table class="mini" style="width:100%">' + arr.map(row).join('') + '</table>' : '<div class="muted">' + empty + '</div>'; };
    var h = [];
    h.push('<p class="desc" style="margin-top:0">작업지시서를 <b>승인</b>하면 그날 프로그램 계획(배운 노하우 없이 계산한 것)과 실제 편성을 설비마다 비교하고, 그때의 원재료 · 납기 상황과 함께 기록합니다. ' +
      '최근 <b>' + c.days + '일</b> 동안 같은 상황에서 <b>' + c.min + '번 이상</b>, <b>' + c.ratio + '% 이상</b> 같은 식으로 편성했으면 다음 계산부터 <b>자동 적용</b>하고, 사람이 다시 다르게 하면 저절로 꺼집니다. ' +
      '노하우 때문에 +20일 결품을 못 맞추게 되면 그 노하우는 그 계산에서 건너뜁니다.</p>');
    h.push('<div class="kh-acc">' +
      '<div><span class="muted">기록한 날</span><b>' + a.days + '일</b></div>' +
      '<div><span class="muted">프로그램 계획 = 실제 (첫 제품군)</span><b>' + pct(a.base) + '</b></div>' +
      '<div><span class="muted">초안(프로그램 · AI 채움) = 실제</span><b>' + pct(a.draft) + '</b>' + (a.draft_lines ? '' : ' <span class="muted" style="font-size:11px">초안 없음</span>') + '</div>' +
      '<div><span class="muted">야간 판단 맞음</span><b>' + pct(a.night) + '</b></div></div>');
    h.push('<div class="cols2" style="align-items:start;margin-top:10px">');
    h.push('<div><h4 class="kh-h">배운 노하우 — 적용 중 (' + on.length + ')</h4>' + tbl(on, '아직 없습니다. 작업지시서를 승인할수록 쌓입니다.') +
      '<h4 class="kh-h" style="margin-top:12px">지켜보는 중 (' + watch.length + ') <span class="muted" style="font-weight:400;font-size:12px">— 기준을 넘으면 저절로 적용</span></h4>' +
      (watch.length ? '<details><summary class="muted" style="cursor:pointer">펼치기</summary>' + tbl(watch, '') + '</details>' : '<div class="muted">없음</div>') +
      (off.length ? '<h4 class="kh-h" style="margin-top:12px">사람이 끈 것 (' + off.length + ')</h4>' + tbl(off, '') : '') + '</div>');
    var rules = st.rules;
    h.push('<div><h4 class="kh-h">직접 넣은 노하우<span class="grow"></span>' + (lv >= 2 ? '<button class="btn small" data-kh="ruleadd">+ 노하우</button>' : '') + '</h4>' +
      '<div class="muted" style="font-size:12px;margin-bottom:6px">사람이 넣거나 AI 도우미에게 "앞으로 3호기는 야간 안 해" 처럼 말한 것 — 바로 적용, 배운 노하우보다 먼저</div>' +
      (rules.length ? '<table class="mini" style="width:100%">' + rules.map(function (x) {
        return '<tr' + (x.active ? '' : ' style="opacity:.55"') + '><td><span class="tag">' + esc(RK[x.kind] || x.kind) + '</span></td><td>' + esc(x.text) + '<div class="muted" style="font-size:11.5px">' + esc(x.source || '') + ' · ' + esc((x.created || '').slice(0, 10)) + ' ' + esc(x.created_by || '') + '</div></td>' +
          '<td style="white-space:nowrap">' + (lv >= 2 ? '<button class="btn small" data-rs="' + x.id + '|' + (x.active ? 0 : 1) + '">' + (x.active ? '끄기' : '켜기') + '</button>' : '') +
          (lv >= 3 ? ' <button class="btn small" data-rd="' + x.id + '">삭제</button>' : '') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted">없음</div>'));
    if (lv >= 2) {
      h.push('<h4 class="kh-h" style="margin-top:14px">배우는 기준</h4><div class="toolbar" style="flex-wrap:wrap;gap:6px">' +
        '최근 <input class="input num" data-c="days" value="' + c.days + '" style="width:52px">일 동안 ' +
        '<input class="input num" data-c="min" value="' + c.min + '" style="width:44px">번 이상 · ' +
        '<input class="input num" data-c="ratio" value="' + c.ratio + '" style="width:48px">% 이상이면 적용 ' +
        '<button class="btn small primary" data-kh="cfg">저장</button><button class="btn small" data-kh="rebuild" title="최근 승인된 작업지시서로 기록을 다시 만듦">다시 계산</button></div>');
    }
    h.push('</div></div>');
    h.push('<div style="margin-top:12px"><a href="#" data-kh="obs">' + (showObs ? '▾' : '▸') + ' 비교 기록 보기 (' + st.obs.length + ')</a></div>');
    if (showObs) {
      h.push('<div class="scroll" style="max-height:420px;margin-top:6px"><table class="mini" style="width:100%"><tr><th>날짜</th><th>설비</th><th>계획</th><th>초안</th><th>실제</th><th>야간 계획/실제</th><th>그때 상황</th></tr>' +
        st.obs.map(function (o) {
          var diff = o.act_fam && o.base_fam !== o.act_fam;
          var cx = o.ctx || {};
          var sit = [];
          if ((cx.mat_short || []).length) sit.push('원재료 부족 ' + cx.mat_short.join(','));
          Object.keys(cx.T || {}).forEach(function (f) { if (cx.T[f]) sit.push(f + ' +20일 ' + App.fmt(cx.T[f], 0)); });
          if (o.act_fam && (cx.act_eqs || []).length && cx.act_eqs.indexOf(o.eq) < 0) sit.push(o.act_fam + ' 계획 설비 ' + cx.act_eqs.join(',') + '호기');
          return '<tr><td>' + esc(o.date) + '</td><td>' + o.eq + '호기</td><td>' + esc(o.base_fam || '-') + '</td><td>' + esc(o.draft_fam || '') + '</td>' +
            '<td>' + (diff ? '<b style="color:#5b2a9a">' + esc(o.act_fam) + '</b>' : esc(o.act_fam || '-')) + '</td>' +
            '<td' + (o.base_fam && o.base_night !== o.act_night ? ' style="color:#5b2a9a;font-weight:700"' : '') + '>' + (o.base_night ? '야' : '주') + ' / ' + (o.act_night ? '야' : '주') + '</td>' +
            '<td class="muted" style="font-size:11.5px">' + esc(sit.join(' · ')) + '</td></tr>';
        }).join('') + '</table></div>');
    }
    box.innerHTML = h.join('');
  }
  function load() {
    return App.get('/api/plan/learned').then(function (r) { st = r; K = r.kinds; RK = r.rule_kinds; draw(); }).catch(function (e) { box.textContent = e.message; });
  }
  function ruleAdd() {
    var body = App.h('<div><div class="form">' +
      '<label class="f full"><span>종류</span><select class="input" data-k="kind">' + Object.keys(RK).map(function (k) { return '<option value="' + k + '">' + esc(RK[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>설비</span><input class="input" data-k="eq" type="number" placeholder="예: 3"></label>' +
      '<label class="f"><span>제품군</span><input class="input" data-k="fam" placeholder="예: 711074"></label>' +
      '<label class="f"><span>다음 제품군 (이어서 생산일 때)</span><input class="input" data-k="fam2" placeholder="예: 711076"></label>' +
      '<label class="f full"><span>설명 (참고 노하우는 꼭)</span><input class="input" data-k="text"></label></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">야간 안 함 = 설비 / 이어서 생산 = (설비) 제품군 → 다음 제품군 / 늘 먼저 = 제품군 / 옮기지 않음 = 제품군 + 설비 / 참고 노하우 = 설명 (AI 만 참고)</div></div>');
    App.dialog({ title: '편성 노하우 추가', body: body, buttons: [{ label: '취소' }, { label: '저장', cls: 'primary', default: true, onClick: function (dd) {
      var g = function (k) { return body.querySelector('[data-k=' + k + ']').value.trim(); };
      App.api('POST', '/api/plan/rules', { kind: g('kind'), eq: g('eq'), fam: g('fam'), fam2: g('fam2'), text: g('text') }).then(function () { dd.close(); App.toast('노하우를 저장했습니다.'); load(); }).catch(function (e) { dd.error(e.message); });
    } }] });
  }
  if (!document.getElementById('khCss')) {
    var s = document.createElement('style'); s.id = 'khCss';
    s.textContent = '.kh-acc{display:flex;gap:10px;flex-wrap:wrap}.kh-acc>div{border:1px solid var(--line);border-radius:8px;padding:6px 12px;display:flex;flex-direction:column;min-width:150px}' +
      '.kh-acc b{font-size:18px}.kh-h{margin:0 0 6px;font-size:13.5px;display:flex;align-items:center;gap:6px}';
    document.head.appendChild(s);
  }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lk]');
    if (b) { var p = b.dataset.lk.split('|'); App.api('PUT', '/api/plan/learned', { key: p.slice(0, -1).join('|'), off: p[p.length - 1] === '1' }).then(load).catch(App.err); return; }
    var rs = e.target.closest('[data-rs]');
    if (rs) { var q = rs.dataset.rs.split('|'); App.api('PUT', '/api/plan/rules/' + q[0], { active: q[1] === '1' }).then(load).catch(App.err); return; }
    var rd = e.target.closest('[data-rd]');
    if (rd) { App.confirm('이 노하우를 지울까요?').then(function (ok) { if (ok) App.api('DELETE', '/api/plan/rules/' + rd.dataset.rd).then(load).catch(App.err); }); return; }
    var a = e.target.closest('[data-kh]');
    if (!a) return;
    e.preventDefault();
    var k = a.dataset.kh;
    if (k === 'ruleadd') ruleAdd();
    else if (k === 'obs') { showObs = !showObs; draw(); }
    else if (k === 'cfg') {
      var cfg = {};
      App.$$('[data-c]', box).forEach(function (el) { cfg[el.dataset.c] = el.value; });
      App.api('PUT', '/api/plan/learned', { cfg: cfg }).then(function () { App.toast('기준을 저장하고 노하우를 다시 계산했습니다.'); load(); }).catch(App.err);
    } else if (k === 'rebuild') {
      App.api('POST', '/api/plan/learned/rebuild').then(function (r) { App.toast('작업지시서 ' + r.days + '일로 다시 계산했습니다.' + (r.changed.length ? ' (' + r.changed.length + '개 바뀜)' : '')); load(); }).catch(App.err);
    }
  });
  load();
};
