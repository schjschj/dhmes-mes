/* 기존 데이터 가져오기 */
App.pages.import = function (root) {
  var opts = [['products', '제품 (기초정보(제품))'], ['molds', '금형 (금형타수관리 · 금형BOM · 금형부품관리)'], ['maint', '금형 정비이력 (금형정비이력 · 금형부품정비이력)'],
    ['equipment', '설비 (기초정보(설비))'], ['production', '생산실적 · 공정불량 · 휴게기준 (생산실적통합 · 공정불량현황 · 기준정보(휴게))'], ['defects', '불량코드 (기준정보(불량코드))'], ['workers', '작업자 (작업자별집계의 이름)']];
  root.innerHTML = '<div class="cols2">' +
    '<div class="panel"><div class="panel-h">생산관리 엑셀 (.xlsm / .xlsx)</div><div class="panel-b">' +
    '<p class="desc" style="margin-top:0">지금 쓰는 생산관리 엑셀 파일에서 기준정보와 금형 정보를 가져옵니다. 같은 제번·금형번호는 새 값으로 갱신되고, 정비이력은 중복을 건너뜁니다. 생산실적·공정불량은 엑셀에 있는 기간만큼 엑셀 내용으로 교체됩니다 (그 기간에 이 프로그램에서 입력한 실적도 교체되니 주의). 여러 번 가져와도 괜찮습니다.</p>' +
    '<div style="display:grid;gap:6px;margin-bottom:12px">' + opts.map(function (o) {
      return '<label class="chk"><input type="checkbox" checked value="' + o[0] + '"> ' + App.esc(o[1]) + '</label>';
    }).join('') + '</div>' +
    '<div class="drop" data-drop="xlsm">여기에 엑셀 파일을 끌어다 놓거나 <b>클릭해서 선택</b><input type="file" accept=".xlsm,.xlsx" hidden></div>' +
    '<div data-rep></div></div></div>' +
    '<div class="panel"><div class="panel-h">기존 금형부품관리 프로그램 데이터</div><div class="panel-b">' +
    '<p class="desc" style="margin-top:0">금형부품관리.exe 옆에 있는 <b>parts_data.db</b> 파일을 넣으면 금형·부품·입출고 이력을 옮겨 옵니다. <b>지금 있는 금형부품 재고 · 입출고 이력은 지우고</b> 이 파일 내용으로 다시 넣습니다 (품번이 같아도 금형·재질이 다르면 따로).</p>' +
    '<div class="drop" data-drop="partsdb">parts_data.db 파일을 끌어다 놓거나 <b>클릭해서 선택</b><input type="file" accept=".db" hidden></div>' +
    '<div data-rep></div></div></div>' +
    '</div><p class="muted" style="margin-top:14px">가져오기 전에 현재 데이터가 자동으로 백업됩니다 (설정 · 백업 화면에서 확인).</p>';

  App.$$('[data-drop]', root).forEach(function (zone) {
    var input = zone.querySelector('input');
    var rep = zone.parentNode.querySelector('[data-rep]');
    zone.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { if (input.files[0]) send(input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); });
    function send(file) {
      var kind = zone.dataset.drop;
      var url = '/api/import/' + kind;
      if (kind === 'xlsm') {
        var what = App.$$('input[type=checkbox]:checked', zone.parentNode).map(function (c) { return c.value; });
        if (!what.length) { App.toast('가져올 항목을 하나 이상 선택하세요.', 'warn'); return; }
        url += '?what=' + what.join(',');
      }
      rep.innerHTML = '<div class="report" style="background:#f3f5f8;color:var(--text-2)">' + App.esc(file.name) + ' 가져오는 중… (큰 파일은 몇 초 걸립니다)</div>';
      file.arrayBuffer().then(function (buf) {
        return App.api('POST', url, buf);
      }).then(function (r) {
        rep.innerHTML = '<div class="report"><b>완료</b> — ' + App.esc(file.name) + '\n' + r.report.map(App.esc).join('\n') + '</div>';
        ['molds', 'workers', 'products'].forEach(App.clearRef);
        App.refreshBadges();
      }).catch(function (e) {
        rep.innerHTML = '<div class="report" style="background:var(--bad-bg);color:var(--bad)">' + App.esc(e.message) + '</div>';
      });
    }
  });
};
