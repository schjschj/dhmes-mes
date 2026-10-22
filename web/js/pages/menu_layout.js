/* 메뉴 배치 (관리자): 세부 메뉴를 다른 대목록으로 옮기기 · 순서 바꾸기 · 대목록 순서 바꾸기
   대목록 / 메뉴 이름 바꾸기 · 새 대목록 만들기 · 빈 새 대목록 지우기
   [저장] 하면 모든 PC 에 같이 적용. 권한은 메뉴가 들어 있는 대목록 기준 */
App.pages.menu_layout = function (root) {
  var st = null;
  root.innerHTML = '<div class="page-full" style="overflow:auto">' +
    '<div class="toolbar">' +
    '<button class="btn primary" data-a="save">저장 (모든 PC 적용)</button>' +
    '<button class="btn" data-a="undo">바꾼 것 취소</button>' +
    '<span class="ml-dirty tag warn" style="display:none">저장 안 됨</span>' +
    '<span class="grow"></span>' +
    '<button class="btn" data-a="reset">처음 배치로 되돌리기</button>' +
    '</div>' +
    '<div class="muted" style="margin:2px 0 10px;line-height:1.6">· 세부 메뉴 오른쪽의 <b>대목록</b>을 바꾸면 그 대목록으로 옮겨집니다. ▲▼ 로 순서, ✎ 로 이름을 바꿉니다.<br>' +
    '· 메뉴 권한은 <b>메뉴가 들어 있는 대목록의 권한</b>을 따릅니다. 옮긴 메뉴는 그 화면에 필요한 자료만 새 대목록 권한으로 쓸 수 있습니다.<br>' +
    '· 새 대목록을 만들면 사용자 · 권한 에 칸이 생깁니다 (처음엔 모두 \'숨김\' — 관리자가 권한을 줘야 보임).</div>' +
    '<div class="ml-wrap"></div></div>';
  if (!document.getElementById('mlCss')) {
    var css = document.createElement('style'); css.id = 'mlCss';
    css.textContent =
      '.ml-wrap{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}' +
      '.ml-order{width:260px;flex:none}' +
      '.ml-cards{flex:1;min-width:320px;display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}' +
      '.ml-row{display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--line-2);min-height:36px}' +
      '.ml-row:last-child{border-bottom:0}' +
      '.ml-row .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.ml-row select{height:26px;font-size:12px;max-width:110px}' +
      '.ml-row.moved{background:#fff8e1}' +
      '.ml-row.fixed{color:var(--muted)}' +
      '.ml-ud{display:flex;gap:2px}.ml-ud .btn{width:26px;padding:0}' +
      '.ml-num{display:inline-block;width:20px;color:var(--muted);font-size:12px}' +
      '.ml-empty{padding:10px;color:var(--muted);font-size:12px}' +
      '.ml-ed{border:0;background:none;cursor:pointer;color:var(--muted);padding:0 3px;font-size:13px}.ml-ed:hover{color:var(--steel)}' +
      '.ml-orig{color:var(--muted);font-size:11.5px;font-weight:400}' +
      '.ml-new{font-size:10.5px;padding:0 5px;border-radius:8px;background:#e6f4ea;color:#1e7b3a;font-weight:700;margin-left:4px}' +
      '.ml-card.flash{outline:2px solid var(--steel)}';
    document.head.appendChild(css);
  }
  var wrap = root.querySelector('.ml-wrap');
  var dirtyTag = root.querySelector('.ml-dirty');

  function setDirty(v) { dirtyTag.style.display = v ? '' : 'none'; }
  function load(data) {
    st = {
      groups: data.groups.map(function (g) {
        return { key: g.group, name: g.name, orig_name: g.orig_name, custom: g.custom, items: g.items.map(function (it) { return Object.assign({}, it); }) };
      })
    };
    setDirty(false); draw();
  }
  function gname(key) {
    for (var i = 0; i < st.groups.length; i++) if (st.groups[i].key === key) return st.groups[i].name;
    return key;
  }
  function ud(attr, upOk, downOk) {
    return '<span class="ml-ud"><button class="btn small" ' + attr + ' data-d="-1"' + (upOk ? '' : ' disabled') + ' title="위로">▲</button>' +
      '<button class="btn small" ' + attr + ' data-d="1"' + (downOk ? '' : ' disabled') + ' title="아래로">▼</button></span>';
  }
  function draw(flash) {
    var h = [];
    var n = st.groups.length;
    h.push('<div class="panel ml-order"><div class="panel-h">대목록</div>' +
      '<div class="ml-row fixed"><span class="ml-num"></span><span class="lbl">홈 (대시보드) — 항상 맨 위</span></div>' +
      st.groups.map(function (g, i) {
        var renamed = !g.custom && g.name !== g.orig_name;
        return '<div class="ml-row"><span class="ml-num">' + (i + 1) + '</span>' +
          '<span class="lbl" title="' + App.esc(g.name) + '"><b>' + App.esc(g.name) + '</b>' +
          (g.custom ? '<span class="ml-new" title="새로 만든 대목록">새</span>' : '') +
          ' <span class="muted">(' + g.items.length + ')</span>' +
          (renamed ? '<br><span class="ml-orig">원래: ' + App.esc(g.orig_name) + '</span>' : '') + '</span>' +
          '<button class="ml-ed" data-gren="' + i + '" title="이름 바꾸기">✎</button>' +
          (g.custom ? '<button class="ml-ed" data-gdel="' + i + '" title="' + (g.items.length ? '메뉴를 모두 빼야 지울 수 있음' : '지우기') + '">🗑</button>' : '') +
          ud('data-g="' + i + '"', i > 0, i < n - 1) + '</div>';
      }).join('') +
      '<div class="ml-row"><button class="btn small" data-a="gadd" style="width:100%">+ 대목록 추가</button></div></div>');
    h.push('<div class="ml-cards">');
    st.groups.forEach(function (g, gi) {
      var renamed = !g.custom && g.name !== g.orig_name;
      h.push('<div class="panel ml-card" data-card="' + gi + '"><div class="panel-h">' + App.esc(g.name) +
        (renamed ? ' <span class="ml-orig">(원래: ' + App.esc(g.orig_name) + ')</span>' : '') +
        (g.custom ? '<span class="ml-new">새로 만듦</span>' : '') +
        '<span class="grow"></span><span class="muted" style="font-weight:400;font-size:12px">' + g.items.length + '개</span></div>');
      if (!g.items.length) h.push('<div class="ml-empty">메뉴가 없습니다 — 다른 대목록의 메뉴를 이리로 옮기세요. (메뉴가 없는 대목록은 왼쪽 메뉴에 보이지 않습니다)</div>');
      g.items.forEach(function (it, ii) {
        var moved = it.orig_group !== g.key;
        var relabeled = it.label !== it.orig_label;
        var next = g.items[ii + 1];
        h.push('<div class="ml-row' + (moved ? ' moved' : '') + (it.fixed ? ' fixed' : '') + '">' +
          '<span class="lbl" title="' + App.esc(it.label) + '">' + App.esc(it.label) +
          (it.admin ? ' <span class="tag" style="background:#eef">관리자만</span>' : '') +
          ((moved || relabeled) ? '<br><span class="ml-orig">' +
            [relabeled ? '원래 이름: ' + App.esc(it.orig_label) : '', moved ? '원래 위치: ' + App.esc(gname(it.orig_group)) : ''].filter(Boolean).join(' · ') + '</span>' : '') +
          '</span>' +
          (it.fixed ? '<span class="muted" style="font-size:12px">고정</span>' :
            '<button class="ml-ed" data-iren="' + gi + ':' + ii + '" title="이름 바꾸기">✎</button>' +
            '<select class="input" data-mv="' + gi + ':' + ii + '">' + st.groups.map(function (x) {
              return '<option value="' + App.esc(x.key) + '"' + (x.key === g.key ? ' selected' : '') + '>' + App.esc(x.name) + '</option>';
            }).join('') + '</select>' + ud('data-i="' + gi + ':' + ii + '"', ii > 0, !!next && !next.fixed)) +
          '</div>');
      });
      h.push('</div>');
    });
    h.push('</div>');
    wrap.innerHTML = h.join('');
    if (flash != null) {
      var c = wrap.querySelector('[data-card="' + flash + '"]');
      if (c) { c.classList.add('flash'); c.scrollIntoView({ block: 'nearest' }); setTimeout(function () { c.classList.remove('flash'); }, 900); }
    }
  }

  // 이름 입력 창
  function askName(title, cur, orig, max, cb) {
    var body = App.h('<div><label class="f"><span>이름</span><input class="input" maxlength="' + max + '" style="width:100%"></label>' +
      (orig ? '<div class="muted" style="margin-top:6px">원래 이름: ' + App.esc(orig) + '</div>' : '') + '</div>');
    var inp = body.querySelector('input'); inp.value = cur || '';
    var btns = [{ label: '취소' }];
    if (orig) btns.push({ label: '원래 이름으로', onClick: function (d) { d.close(); cb(orig); } });
    btns.push({
      label: '확인', cls: 'primary', default: true, onClick: function (d) {
        var v = inp.value.replace(/\s+/g, ' ').trim();
        if (!v) { d.error('이름을 입력하세요.'); return; }
        var err = cb(v);
        if (err) { d.error(err); return; }
        d.close();
      }
    });
    App.dialog({ title: title, body: body, buttons: btns });
  }
  function nameTaken(name, exceptIdx) {
    var low = name.toLowerCase();
    if (name === '홈') return true;
    return st.groups.some(function (g, i) { return i !== exceptIdx && g.name.toLowerCase() === low; });
  }

  wrap.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.a === 'gadd') {
      askName('새 대목록', '', '', 20, function (v) {
        if (nameTaken(v, -1)) return '같은 이름의 대목록이 있습니다.';
        st.groups.push({ key: '@' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: v, orig_name: '', custom: true, items: [] });
        setDirty(true); draw(st.groups.length - 1);
      });
      return;
    }
    if (t.dataset.gren != null) {
      var gi = +t.dataset.gren, g = st.groups[gi];
      askName('대목록 이름 바꾸기', g.name, g.custom ? '' : g.orig_name, 20, function (v) {
        if (nameTaken(v, gi)) return '같은 이름의 대목록이 있습니다.';
        g.name = v; setDirty(true); draw();
      });
      return;
    }
    if (t.dataset.gdel != null) {
      var dg = st.groups[+t.dataset.gdel];
      if (dg.items.length) { App.toast('메뉴를 모두 다른 대목록으로 옮긴 뒤에 지울 수 있습니다.', 'bad'); return; }
      App.confirm('대목록 \'' + dg.name + '\' 을(를) 지울까요?\n(사용자 · 권한 의 이 대목록 칸도 없어집니다)', '지우기', true).then(function (ok) {
        if (!ok) return;
        st.groups.splice(+t.dataset.gdel, 1);
        setDirty(true); draw();
      });
      return;
    }
    if (t.dataset.iren) {
      var q = t.dataset.iren.split(':'), it = st.groups[+q[0]].items[+q[1]];
      askName('메뉴 이름 바꾸기', it.label, it.orig_label, 30, function (v) { it.label = v; setDirty(true); draw(); });
      return;
    }
    if (!t.dataset.d) return;
    var d = +t.dataset.d;
    if (t.dataset.g != null) {
      var i = +t.dataset.g, j = i + d;
      if (j < 0 || j >= st.groups.length) return;
      var x = st.groups[i]; st.groups[i] = st.groups[j]; st.groups[j] = x;
      setDirty(true); draw();
    } else if (t.dataset.i) {
      var p = t.dataset.i.split(':'), grp = st.groups[+p[0]], a = +p[1], z = a + d;
      if (z < 0 || z >= grp.items.length || grp.items[z].fixed) return;
      var y = grp.items[a]; grp.items[a] = grp.items[z]; grp.items[z] = y;
      setDirty(true); draw();
    }
  });
  wrap.addEventListener('change', function (e) {
    var s = e.target.closest('select[data-mv]');
    if (!s) return;
    var p = s.dataset.mv.split(':'), from = st.groups[+p[0]];
    var it = from.items.splice(+p[1], 1)[0];
    var ti = -1;
    st.groups.forEach(function (g, i) { if (g.key === s.value) ti = i; });
    var to = st.groups[ti];
    var at = to.items.length;                  // 맨 끝 (고정 메뉴 '메뉴 배치' 보다는 앞)
    while (at > 0 && to.items[at - 1].fixed) at--;
    to.items.splice(at, 0, it);
    setDirty(true); draw(ti);
  });
  root.querySelector('[data-a=save]').onclick = function () {
    var labels = {};
    st.groups.forEach(function (g) { g.items.forEach(function (it) { if (it.label !== it.orig_label) labels[it.id] = it.label; }); });
    var body = {
      groups: st.groups.map(function (g) { return { key: g.key, name: g.name, custom: g.custom }; }),
      tree: st.groups.map(function (g) { return { group: g.key, items: g.items.filter(function (it) { return !it.fixed; }).map(function (it) { return it.id; }) }; }),
      labels: labels
    };
    App.api('PUT', '/api/menu_layout', body).then(function (r) {
      load(r); App.toast('메뉴 배치를 저장했습니다. 다른 PC 는 새로고침(F5)하면 바뀝니다.');
      return App.reloadMenu();
    }).catch(App.err);
  };
  root.querySelector('[data-a=undo]').onclick = function () {
    App.get('/api/menu_layout').then(load).catch(App.err);
  };
  root.querySelector('[data-a=reset]').onclick = function () {
    App.confirm('메뉴 배치를 처음 상태로 되돌릴까요?\n(옮긴 메뉴, 바꾼 순서·이름이 모두 원래대로 돌아가고, 새로 만든 대목록은 없어집니다)', '되돌리기', true).then(function (ok) {
      if (!ok) return;
      App.api('DELETE', '/api/menu_layout').then(function (r) {
        load(r); App.toast('처음 배치로 되돌렸습니다.');
        return App.reloadMenu();
      }).catch(App.err);
    });
  };
  App.get('/api/menu_layout').then(load).catch(App.err);
};
