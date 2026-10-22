/* AI 편성 도우미 — 화면 오른쪽에 열고 닫는 창 (납기 · 생산계획, 작업지시서 화면에서 사용)
   대화는 서버에 사용자별로 저장 → 메뉴를 옮기거나 새로고침해도 그대로. [새 대화] / 새 납기 파일이면 지워짐 */
(function () {
  var A = App.ai = { on: false };
  var esc = App.esc;
  var PAGES = { plan: '납기 · 생산계획', workorder: '작업지시서' };

  function curPage() { return (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]; }
  function canUse() {
    return ['plan', 'workorder'].some(function (id) { var m = App.findMenu(id); return m && App.level(m.group) >= 2; });
  }
  function css() {
    if (document.getElementById('aiCss')) return;
    var s = document.createElement('style'); s.id = 'aiCss';
    s.textContent =
      '#aiBtn{border:1px solid #7aa7e0;background:#eef4fb;color:#1f4f8a;border-radius:16px;padding:4px 12px;cursor:pointer;font-weight:600}' +
      '#aiBtn.on{background:#1f4f8a;color:#fff;border-color:#1f4f8a}' +
      '#aiDrawer{position:fixed;top:56px;right:10px;bottom:10px;width:380px;max-width:calc(100vw - 20px);z-index:60;display:none;flex-direction:column;' +
      'background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18)}' +
      '#aiDrawer.open{display:flex}' +
      '#aiDrawer .h{padding:9px 12px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:6px;font-weight:700}' +
      '#aiDrawer .ctx{font-size:11.5px;color:var(--muted);font-weight:400}' +
      '#aiDrawer .log{flex:1;overflow:auto;padding:10px 12px;font-size:13px;line-height:1.55}' +
      '#aiDrawer .m{margin-bottom:10px;white-space:pre-wrap}#aiDrawer .m.u{background:#eef4fb;border-radius:8px;padding:6px 9px}' +
      '#aiDrawer .m .ap{font-size:11.5px;color:#1e7b3a;margin-top:3px}#aiDrawer .m .pg{font-size:10.5px;color:var(--muted)}' +
      '#aiDrawer .prop{border:1px solid #e0a000;background:#fff8e1;border-radius:8px;padding:7px 9px;margin-bottom:8px;font-size:12.5px}' +
      '#aiDrawer .in{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line-2)}#aiDrawer textarea{flex:1;height:58px;resize:none}' +
      '@media (min-width:1150px){body.ai-open #main{margin-right:392px}}';
    document.head.appendChild(s);
  }
  function build() {
    css();
    var btn = document.createElement('button');
    btn.id = 'aiBtn'; btn.textContent = 'AI 도우미'; btn.title = '작업지시 편성 AI 도우미 (납기 · 생산계획 / 작업지시서 화면)';
    var tr = document.querySelector('#top .top-right');
    tr.insertBefore(btn, tr.firstChild);
    var dr = App.h('<div id="aiDrawer"><div class="h">AI 편성 도우미 <span class="ctx" data-ctx></span><span class="grow"></span>' +
      '<button class="btn small" data-x="new">새 대화</button><button class="icon-btn" style="display:block" data-x="close">✕</button></div>' +
      '<div class="log" data-log></div>' +
      '<div class="in"><textarea class="input" data-q placeholder="질문 또는 요청 (Enter 보내기, Shift+Enter 줄바꿈)"></textarea><button class="btn primary" data-x="send">보내기</button></div></div>');
    document.body.appendChild(dr);
    A.el = dr;
    btn.onclick = function () { toggle(); };
    dr.addEventListener('click', function (e) {
      var b = e.target.closest('[data-x]');
      if (b) {
        if (b.dataset.x === 'close') toggle(false);
        else if (b.dataset.x === 'send') ask();
        else if (b.dataset.x === 'new') App.api('POST', '/api/plan/ai', { reset: true }).then(load);
        return;
      }
      var r = e.target.closest('[data-rule]');
      if (r) {
        var p = r.dataset.rule.split('|');
        App.api('PUT', '/api/plan/rules/' + p[0], { active: p[1] === '1' }).then(function () {
          App.toast(p[1] === '1' ? '노하우로 저장했습니다. 다음 계산부터 적용됩니다.' : '제안을 버렸습니다.');
          load(); if (curPage() === 'plan') App.reloadPage();
        }).catch(App.err);
      }
    });
    dr.querySelector('[data-q]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
    });
    window.addEventListener('hashchange', ctxLabel);
    if (App.store.get('ai_open', 0)) toggle(true);
  }
  function ctxLabel() {
    if (!A.el) return;
    var p = curPage();
    A.el.querySelector('[data-ctx]').textContent = PAGES[p] ? '· ' + PAGES[p] + (p === 'workorder' ? ' ' + App.store.get('wo_date', App.today()) : '') + ' 보는 중' : '· 계획 기준';
  }
  function toggle(on) {
    var open = on === undefined ? !A.el.classList.contains('open') : on;
    A.el.classList.toggle('open', open);
    document.getElementById('aiBtn').classList.toggle('on', open);
    App.store.set('ai_open', open ? 1 : 0);
    document.body.classList.toggle('ai-open', open);
    if (open) { ctxLabel(); load(); setTimeout(function () { A.el.querySelector('[data-q]').focus(); }, 50); }
  }
  A.open = function () { toggle(true); };
  function render(st) {
    var log = A.el.querySelector('[data-log]');
    var h = [];
    if (!st.history.length) {
      h.push('<div class="muted" style="font-size:12.5px">계획이나 작업지시서를 보면서 물어보거나 바꿔 달라고 하세요.<br>' +
        '예) "1호기 왜 부족해?", "8호기 야간 빼고 다시 짜 줘", "이 작업지시서랑 계획 다른 설비 알려줘", "계획대로 내일 작업지시서 채워 줘", "앞으로 3호기는 야간 안 해"<br><br>' +
        '이 도우미는 작업지시 편성에만 쓰이고, 생산계획 · 작업지시서 자료만 봅니다. 대화는 [새 대화]를 누르거나 새 납기 파일을 올릴 때까지 남습니다.</div>');
    }
    st.history.forEach(function (m) {
      if (m.role === 'user') h.push('<div class="m u">' + esc(m.text) + (m.page && PAGES[m.page] ? '<div class="pg">' + esc(PAGES[m.page]) + '에서</div>' : '') + '</div>');
      else h.push('<div class="m a">' + esc(m.text) + ((m.applied || []).length ? '<div class="ap">✔ ' + esc(m.applied.join(' / ')) + '</div>' : '') + '</div>');
    });
    (st.pending || []).forEach(function (r) {
      h.push('<div class="prop"><b>노하우 제안</b> (' + esc(r.source) + ') ' + esc(r.text) + (r.evidence ? '<div class="muted" style="font-size:11.5px">' + esc(r.evidence) + '</div>' : '') +
        '<div style="margin-top:5px"><button class="btn small primary" data-rule="' + r.id + '|1">앞으로 이렇게</button> <button class="btn small" data-rule="' + r.id + '|0">버림</button></div></div>');
    });
    log.innerHTML = h.join('');
    log.scrollTop = log.scrollHeight;
  }
  function load() {
    return App.get('/api/plan/ai/state').then(function (st) { A.state = st; render(st); }).catch(function () { /* 무시 */ });
  }
  function ask() {
    var ta = A.el.querySelector('[data-q]');
    var q = ta.value.trim();
    if (!q || A.busy) return;
    var page = curPage();
    var log = A.el.querySelector('[data-log]');
    if (log.querySelector('.muted') && !log.querySelector('.m')) log.innerHTML = '';
    log.insertAdjacentHTML('beforeend', '<div class="m u">' + esc(q) + '</div><div class="m a muted" data-wait>생각 중…</div>');
    log.scrollTop = log.scrollHeight;
    ta.value = '';
    A.busy = true;
    App.api('POST', '/api/plan/ai', { text: q, page: page, date: page === 'workorder' ? App.store.get('wo_date', App.today()) : '' }).then(function (r) {
      A.busy = false;
      return load().then(function () {
        if ((r.applied || []).length && page === 'plan' && curPage() === 'plan') App.reloadPage();
        if (r.wo_changed && curPage() === 'workorder') App.reloadPage();
      });
    }).catch(function (e) {
      A.busy = false;
      var w = log.querySelector('[data-wait]');
      if (w) { w.removeAttribute('data-wait'); w.innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>'; }
    });
  }
  A.init = function () {
    if (!canUse()) return;
    App.get('/api/plan/ai/state').then(function (st) {
      A.on = st.ai && st.ai.on;
      if (A.on && !document.getElementById('aiBtn')) build();
    }).catch(function () { /* 권한 없음 등 */ });
  };
})();
