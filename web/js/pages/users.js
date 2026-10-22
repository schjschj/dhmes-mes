/* 사용자 · 권한 관리 (관리자만) */
App.pages.users = function (root) {
  root.innerHTML = '<div class="page-full">' +
    '<div class="desc">사용자마다 메뉴묶음별 권한을 정합니다. <b>숨김</b> 메뉴가 안 보임 · <b>보기</b> 조회·엑셀만 · <b>입력·수정</b> 등록과 수정 · <b>삭제까지</b> 삭제와 기준 변경까지. ' +
    '관리자는 모든 권한 + 사용자 관리. 권한은 서버에서 검사하므로 화면을 우회해도 막힙니다.</div>' +
    '<div class="toolbar"><button class="btn primary" data-a="add">+ 사용자 추가</button><button class="btn" data-a="edit">수정 · 권한</button>' +
    '<button class="btn danger" data-a="del">삭제</button><span class="grow"></span><button class="btn" data-a="xlsx">엑셀로 저장</button></div>' +
    '<div class="gridbox" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>';
  var G = [], LV = {}, GN = {}, GM = {};
  var lvTag = function (n) { return '<span class="tag ' + (n >= 3 ? 'bad' : n === 2 ? 'steel' : n === 1 ? 'gray' : '') + '">' + App.esc(LV[n] || '') + '</span>'; };
  var grid = null;
  function build() {
    var cols = [
      { k: 'login', l: '아이디', w: 80, mono: true },
      { k: 'name', l: '이름', w: 80 },
      { k: 'admin', l: '관리자', w: 50, center: true, fmt: function (v) { return v ? '<span class="tag bad">관리자</span>' : ''; } },
      { k: 'active', l: '사용', w: 45, center: true, fmt: function (v) { return v ? '✔' : '<span class="tag gray">중지</span>'; } }
    ].concat(G.map(function (g) {
      return { k: 'p_' + g, l: GN[g] || g, w: 70, center: true, val: function (r) { return r.perms[g]; }, fmt: function (v, r) { return r.admin ? '<span class="muted">전체</span>' : lvTag(v); }, xval: function (r) { return r.admin ? '전체' : LV[r.perms[g]]; } };
    })).concat([
      { k: 'last_login', l: '마지막 로그인', w: 115 },
      { k: 'must_change', l: '비번 변경 필요', w: 70, center: true, fmt: function (v) { return v ? '<span class="tag warn">대기</span>' : ''; } },
      { k: 'note', l: '메모', w: 120 }
    ]).concat(App.auditCols());
    root.querySelector('.gridbox').innerHTML = '';
    grid = new App.Grid(root.querySelector('.gridbox'), { cols: cols, hint: '두 번 클릭하면 수정', onDbl: form,
      rowClass: function (r) { return r.active ? '' : 'r-dim'; } });
  }
  function load(sel) {
    return App.get('/api/users').then(function (d) {
      if (!G.length) { G = d.groups; LV = d.levels; GN = d.group_names || {}; GM = d.group_menus || {}; build(); }
      grid.setRows(d.users);
      if (sel) grid.selectKey(sel, true);
    }).catch(App.err);
  }
  var PRESETS = {
    '현장 작업자': { '생산관리': 2, '품질관리': 2, '금형관리': 1, '근태관리': 0, '원재료': 1, '출하관리': 1, '기준정보': 1, '시스템': 0 },
    '금형 담당': { '생산관리': 1, '품질관리': 1, '금형관리': 3, '근태관리': 0, '원재료': 1, '출하관리': 1, '기준정보': 2, '시스템': 0 },
    '근태 담당': { '생산관리': 1, '품질관리': 1, '금형관리': 1, '근태관리': 3, '원재료': 0, '출하관리': 0, '기준정보': 1, '시스템': 0 },
    '조회만': { '생산관리': 1, '품질관리': 1, '금형관리': 1, '근태관리': 0, '원재료': 1, '출하관리': 1, '기준정보': 1, '시스템': 0 },
    '관리 담당': { '생산관리': 3, '품질관리': 3, '금형관리': 3, '근태관리': 3, '원재료': 1, '출하관리': 3, '기준정보': 3, '시스템': 2 }
  };
  function form(r) {
    var edit = !!(r && r.id);
    r = r || { active: 1, perms: PRESETS['현장 작업자'] };
    var body = App.h('<div><div class="form">' +
      '<label class="f"><span>아이디 (로그인할 때 입력)<b>*</b></span><input class="input" data-k="login" value="' + App.esc(r.login || '') + '"></label>' +
      '<label class="f"><span>이름 (기록에 남는 이름)<b>*</b></span><input class="input" data-k="name" list="' + App.datalist('workers') + '" value="' + App.esc(r.name || '') + '"></label>' +
      '<label class="f"><span>' + (edit ? '비밀번호 초기화 (바꿀 때만 입력)' : '처음 비밀번호') + (edit ? '' : '<b>*</b>') + '</span><input class="input" data-k="password" autocomplete="new-password"><small>본인이 처음 로그인할 때 새 비밀번호로 바꾸게 됩니다</small></label>' +
      '<label class="f"><span>메모</span><input class="input" data-k="note" value="' + App.esc(r.note || '') + '"></label>' +
      '<div class="f full"><span>&nbsp;</span><div class="chkrow"><label class="chk"><input type="checkbox" data-k="admin"' + (r.admin ? ' checked' : '') + '> 관리자 (모든 권한 + 사용자 관리)</label>' +
      '<label class="chk"><input type="checkbox" data-k="active"' + (r.active ? ' checked' : '') + '> 사용 (끄면 로그인 못 함)</label></div></div>' +
      '</div><h4 style="margin:14px 0 6px">메뉴묶음별 권한</h4>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span class="muted" style="align-self:center">빠른 설정:</span>' +
      Object.keys(PRESETS).map(function (p) { return '<button type="button" class="btn small" data-preset="' + App.esc(p) + '">' + App.esc(p) + '</button>'; }).join('') + '</div>' +
      '<table class="perm-grid" data-perm>' + G.map(function (g) {
        return '<tr><th style="width:170px" title="' + App.esc((GM[g] || []).join(', ')) + '">' + App.esc(GN[g] || g) +
          '<div class="muted" style="font-weight:400;font-size:11px;line-height:1.3;max-width:160px;white-space:normal">' + App.esc((GM[g] || []).join(' · ') || '(메뉴 없음)') + '</div></th><td>' + [0, 1, 2, 3].map(function (n) {
          return '<label class="chk"><input type="radio" name="pg_' + App.esc(g) + '" value="' + n + '"' + ((r.perms[g] || 0) === n ? ' checked' : '') + '> ' + App.esc(LV[n]) + '</label>';
        }).join('') + '</td></tr>';
      }).join('') + '</table></div>');
    var permBox = body.querySelector('[data-perm]');
    function syncAdmin() { permBox.style.opacity = body.querySelector('[data-k=admin]').checked ? 0.4 : 1; }
    body.querySelector('[data-k=admin]').addEventListener('change', syncAdmin);
    syncAdmin();
    App.$$('[data-preset]', body).forEach(function (b) {
      b.onclick = function () {
        var p = PRESETS[b.dataset.preset];
        G.forEach(function (g) { var x = body.querySelector('input[name="pg_' + g + '"][value="' + (p[g] || 0) + '"]'); if (x) x.checked = true; });
      };
    });
    var d = App.dialog({
      title: edit ? '사용자 수정 — ' + r.name : '사용자 추가', body: body, wide: true, closeOnBack: false,
      buttons: [{ label: '취소' }, {
        label: '저장', cls: 'primary', default: true, onClick: function (dd) {
          var v = {};
          App.$$('[data-k]', body).forEach(function (el) { v[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim(); });
          v.perms = {};
          G.forEach(function (g) { var x = body.querySelector('input[name="pg_' + g + '"]:checked'); v.perms[g] = x ? +x.value : 0; });
          dd.error(''); dd.busy(true);
          (edit ? App.api('PUT', '/api/users/' + r.id, v) : App.api('POST', '/api/users', v)).then(function (res) {
            dd.busy(false); dd.close(); App.toast('저장했습니다.' + (v.password ? ' (새 비밀번호를 본인에게 알려 주세요)' : ''));
            load(edit ? r.id : res.id);
          }, function (e) { dd.busy(false); dd.error(e.message); });
        }
      }]
    });
    return d;
  }
  root.querySelector('.toolbar').addEventListener('click', function (e) {
    var a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    var r = grid && grid.selected();
    if ((a === 'edit' || a === 'del') && !r) { App.toast('목록에서 먼저 선택하세요.', 'warn'); return; }
    if (a === 'add') form(null);
    else if (a === 'edit') form(r);
    else if (a === 'del') App.confirm(r.name + '(' + r.login + ') 계정을 삭제할까요?\n그동안 입력한 기록의 이름은 그대로 남습니다. 잠시 막기만 하려면 [수정]에서 \'사용\'을 끄세요.', '삭제', true).then(function (ok) {
      if (ok) App.api('DELETE', '/api/users/' + r.id).then(function () { App.toast('삭제했습니다.'); load(); }).catch(App.err);
    });
    else if (a === 'xlsx') App.exportXlsx('사용자권한_' + App.stamp() + '.xlsx', [grid.sheet('사용자 권한')]);
  });
  load();
};
