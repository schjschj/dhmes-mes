// 대흥공업 MES 거래명세서 자동입력 V2.2 (필터탭 + 공장표준전표 + 작업자관리 + 중복방지)
// [MES] dhmes-receipt 앱 화면을 MES 안에서 그대로 사용 — API 는 MES 가 같은 경로(/api/v1/...)로 제공.
//       MES 로그인이 필요하면(401) 로그인 창을 띄우고, 로그인 후 다시 불러온다.
(function () {
  const _fetch = window.fetch.bind(window);
  const loginModal = document.getElementById('login-modal');
  const loginError = document.getElementById('login-error');
  let shown = false;
  function showLogin(msg) {
    if (msg) { loginError.textContent = msg; loginError.style.display = 'block'; }
    if (shown) return;
    shown = true;
    loginModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('login-id').focus(), 50);
  }
  async function doLogin() {
    const login = document.getElementById('login-id').value.trim();
    const password = document.getElementById('login-pw').value;
    if (!login || !password) return showLogin('아이디와 비밀번호를 입력하세요.');
    try {
      const res = await _fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password, remember: true }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || '로그인 실패');
      location.reload();
    } catch (e) {
      showLogin(e.message);
    }
  }
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  window.fetch = async function (url, opts) {
    let res;
    try {
      res = await _fetch(url, opts);
    } catch (e) {
      throw new Error('MES 서버에 연결할 수 없습니다 (회사 Wi-Fi 연결 확인).');
    }
    if (String(url).startsWith('/api/') && (res.status === 401 || res.status === 403)) {
      if (res.status === 401) showLogin();
      else showLogin('구매관리 권한이 없는 계정입니다. 사무실에서 권한을 받거나 다른 계정으로 로그인하세요.');
      return new Response(JSON.stringify({ detail: res.status === 401 ? 'MES 로그인이 필요합니다.' : '구매관리 권한이 없습니다.' }),
        { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return res;
  };
})();

let currentWorker = null;
let pollingTimer = null;
let currentReceipts = [];
let currentFilter = 'all'; // 'all', 'pending', 'registered'
let pendingForceReceiptId = null;

// DOM 요소
const workerModal = document.getElementById('worker-modal');
const workerBtnList = document.getElementById('worker-btn-list');
const workerBadge = document.getElementById('worker-badge');
const workerNameDisplay = document.getElementById('worker-name-display');
const btnChangeWorker = document.getElementById('btn-change-worker');
const btnCloseWorkerModal = document.getElementById('btn-close-worker-modal');
const newWorkerName = document.getElementById('new-worker-name');
const btnAddWorker = document.getElementById('btn-add-worker');

const cameraInput = document.getElementById('camera-input');
const fileInput = document.getElementById('file-input');
const uploadToast = document.getElementById('upload-toast');
const toastMsg = document.getElementById('toast-msg');

const receiptCardsContainer = document.getElementById('receipt-cards-container');
const pendingCounter = document.getElementById('pending-counter');
const pendingCount = document.getElementById('pending-count');
const btnRefresh = document.getElementById('btn-refresh');

// 필터 탭
const filterTabs = document.querySelectorAll('.filter-tab');
const tabCountAll = document.getElementById('tab-count-all');
const tabCountPending = document.getElementById('tab-count-pending');
const tabCountRegistered = document.getElementById('tab-count-registered');
const currentTabTitle = document.getElementById('current-tab-title');

// 이미지 모달
const imageModal = document.getElementById('image-modal');
const modalFullImage = document.getElementById('modal-full-image');
const btnCloseImage = document.getElementById('btn-close-image');

// 전표 모달
const voucherModal = document.getElementById('voucher-modal');
const btnCloseVoucher = document.getElementById('btn-close-voucher');
const btnPrintVoucher = document.getElementById('btn-print-voucher');

// 중복 모달
const duplicateModal = document.getElementById('duplicate-modal');
const btnCancelDup = document.getElementById('btn-cancel-dup');
const btnForceDup = document.getElementById('btn-force-dup');

// 수정 모달
const editModal = document.getElementById('edit-modal');
const btnCloseEdit = document.getElementById('btn-close-edit');
const editReceiptId = document.getElementById('edit-receipt-id');
const editDate = document.getElementById('edit-date');
const editSupplier = document.getElementById('edit-supplier');
const editBizNo = document.getElementById('edit-bizno');
const editReceiver = document.getElementById('edit-receiver');
const editItemsList = document.getElementById('edit-items-list');
const btnAddEditItem = document.getElementById('btn-add-edit-item');
const editSumSupply = document.getElementById('edit-sum-supply');
const editSumVat = document.getElementById('edit-sum-vat');
const editSumTotal = document.getElementById('edit-sum-total');
const btnSaveEdit = document.getElementById('btn-save-edit');

// ==========================================
// [요구사항 3] 작업자 관리 (조회, 추가, 삭제, 선택)
// ==========================================
async function initWorker() {
  const saved = localStorage.getItem('dh_mes_worker');
  if (saved) {
    try {
      currentWorker = JSON.parse(saved);
      workerNameDisplay.textContent = currentWorker.name.split(' ')[0];
    } catch (e) {
      currentWorker = null;
    }
  }

  if (!currentWorker) {
    showWorkerModal();
  }
}

async function loadWorkersList() {
  try {
    const res = await fetch('/api/v1/workers');
    const workers = await res.json();
    workerBtnList.innerHTML = workers.map(w => `
      <div class="worker-item-wrap">
        <button class="btn-worker-select" data-id="${w.id}" data-name="${w.name}">
          ${w.name}
        </button>
        <button class="btn-worker-del" title="삭제" onclick="event.stopPropagation(); deleteWorker('${w.id}')">&times;</button>
      </div>
    `).join('');

    workerBtnList.querySelectorAll('.btn-worker-select').forEach(btn => {
      btn.addEventListener('click', () => {
        currentWorker = { id: btn.dataset.id, name: btn.dataset.name };
        localStorage.setItem('dh_mes_worker', JSON.stringify(currentWorker));
        workerNameDisplay.textContent = currentWorker.name.split(' ')[0];
        workerModal.classList.add('hidden');
      });
    });
  } catch (err) {
    console.error('작업자 로드 실패', err);
  }
}

function showWorkerModal() {
  loadWorkersList();
  workerModal.classList.remove('hidden');
}

btnChangeWorker.addEventListener('click', () => {
  showWorkerModal();
});

btnCloseWorkerModal.addEventListener('click', () => {
  if (currentWorker) {
    workerModal.classList.add('hidden');
  } else {
    alert('작업자를 선택해주세요.');
  }
});

async function handleAddWorker() {
  const name = newWorkerName.value.trim();
  if (!name) return alert('작업자 이름을 입력해주세요.');

  try {
    const res = await fetch('/api/v1/workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || '등록 실패');
    newWorkerName.value = '';
    await loadWorkersList();
  } catch (err) {
    alert('작업자 추가 오류: ' + err.message);
  }
}

btnAddWorker.addEventListener('click', handleAddWorker);
newWorkerName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleAddWorker();
  }
});

window.deleteWorker = async function(wid) {
  if (!confirm('이 작업자를 목록에서 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`/api/v1/workers/${wid}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('삭제 실패');
    
    if (currentWorker && currentWorker.id === wid) {
      currentWorker = null;
      localStorage.removeItem('dh_mes_worker');
      workerNameDisplay.textContent = '작업자 선택';
    }
    await loadWorkersList();
  } catch (err) {
    alert('삭제 오류: ' + err.message);
  }
};

// ==========================================
// 초고속 즉시 업로드 (대기 시간 0.2초)
// ==========================================
[cameraInput, fileInput].forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('📤 사진 업로드 및 압축 중...', true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('worker_id', currentWorker ? currentWorker.id : 'W001');
    formData.append('worker_name', currentWorker ? currentWorker.name : '심재우');

    try {
      const res = await fetch('/api/v1/receipts/upload', {
        method: 'POST',
        body: formData
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || '업로드 실패');

      showToast(`✅ 업로드 완료! (${result.saved_ratio}% 압축 보관) AI가 분석 중입니다.`, false);
      fetchReceipts();
      startPolling();

    } catch (err) {
      alert(`업로드 오류: ${err.message}`);
      hideToast();
    } finally {
      input.value = '';
    }
  });
});

function showToast(msg, showSpinner = false) {
  toastMsg.textContent = msg;
  uploadToast.querySelector('.toast-spinner').style.display = showSpinner ? 'block' : 'none';
  uploadToast.classList.remove('hidden');
}

function hideToast() {
  setTimeout(() => {
    uploadToast.classList.add('hidden');
  }, 4000);
}

// ==========================================
// [요구사항 1] 상단 필터 탭 (전체 / 검수대기 / MES 등록완료)
// ==========================================
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;

    if (currentFilter === 'all') currentTabTitle.textContent = '전체 명세서 목록';
    else if (currentFilter === 'pending') currentTabTitle.textContent = '⏳ 검수 대기 명세서';
    else if (currentFilter === 'registered') currentTabTitle.textContent = '🟢 MES 등록 완료 목록';

    renderReceiptCards(currentReceipts);
  });
});

// ==========================================
// 거래명세서 목록 조회 및 렌더링
// ==========================================
async function fetchReceipts() {
  try {
    const res = await fetch('/api/v1/receipts');
    const list = await res.json();
    currentReceipts = list;

    // 카운터 업데이트
    const totalCount = list.length;
    const pendingItems = list.filter(r => r.status === 'completed' || r.status === 'processing');
    const registeredItems = list.filter(r => r.status === 'registered');

    tabCountAll.textContent = totalCount;
    tabCountPending.textContent = pendingItems.length;
    tabCountRegistered.textContent = registeredItems.length;

    // 백그라운드 진행 중 체크
    const processingItems = list.filter(r => r.status === 'processing');
    if (processingItems.length > 0) {
      pendingCounter.classList.remove('hidden');
      pendingCount.textContent = processingItems.length;
      startPolling();
    } else {
      pendingCounter.classList.add('hidden');
      stopPolling();
    }

    renderReceiptCards(list);
  } catch (err) {
    console.error('명세서 조회 실패', err);
  }
}

function renderReceiptCards(list) {
  // 필터 적용
  let filtered = list;
  if (currentFilter === 'pending') {
    filtered = list.filter(r => r.status === 'completed' || r.status === 'processing');
  } else if (currentFilter === 'registered') {
    filtered = list.filter(r => r.status === 'registered');
  }

  if (!filtered || filtered.length === 0) {
    let msg = '등록된 명세서가 없습니다.';
    if (currentFilter === 'pending') msg = '현재 검수 대기 중인 명세서가 없습니다.';
    else if (currentFilter === 'registered') msg = '아직 MES에 등록 완료된 전표가 없습니다.';

    receiptCardsContainer.innerHTML = `
      <div class="empty-state">
        <p>${msg}<br>위의 <strong>카메라로 즉시 촬영</strong> 버튼을 눌러보세요.</p>
      </div>
    `;
    return;
  }

  receiptCardsContainer.innerHTML = filtered.map(item => {
    const isProcessing = item.status === 'processing';
    const isFailed = item.status === 'failed';
    const isRegistered = item.status === 'registered';
    const isCompleted = item.status === 'completed';

    const data = item.data;
    const header = data ? data.header : null;
    const items = data ? data.items : [];
    const summary = header ? header.summary : null;

    const supplierName = header ? header.supplier.company_name : (isProcessing ? 'AI 분석 중...' : '공급처 확인 불가');
    const invoiceDate = header ? header.invoice_date : item.created_at.split(' ')[0];
    const totalAmount = summary ? summary.total_amount : 0;
    const receiverName = header && header.buyer ? (header.buyer.receiver_name || item.worker_name) : item.worker_name;

    const origKb = item.original_size_kb || 0;
    const compKb = item.compressed_size_kb || 0;
    const savedPct = origKb > 0 ? Math.round((1 - compKb / origKb) * 100) : 0;

    let statusPill = '';
    if (isProcessing) statusPill = `<span class="status-pill processing">🔄 분석 중</span>`;
    else if (isFailed) statusPill = `<span class="status-pill failed">⚠️ 분석 실패</span>`;
    else if (isRegistered) statusPill = `<span class="status-pill registered">🟢 MES 전표: ${item.mes_inbound_no || '완료'}</span>`;
    else statusPill = `<span class="status-pill completed">📋 분석완료 (검수대기)</span>`;

    // 품목 리스트 정리 테이블
    let itemsTableHtml = '';
    if (items && items.length > 0) {
      itemsTableHtml = `
        <table class="receipt-items-table">
          <thead>
            <tr>
              <th style="width: 25px;">#</th>
              <th>품명 및 규격</th>
              <th style="text-align:center; width: 45px;">수량</th>
              <th class="item-td-right" style="width: 80px;">공급금액</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, idx) => `
              <tr>
                <td style="color: #94a3b8; font-size: 11px;">${idx + 1}</td>
                <td>
                  <div class="item-td-name">${it.item_name}</div>
                  ${it.specification ? `<div class="item-td-spec">${it.specification}</div>` : ''}
                </td>
                <td style="text-align:center;">${it.quantity}</td>
                <td class="item-td-right"><strong>${(it.amount || 0).toLocaleString()}원</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    return `
      <div class="receipt-card ${isRegistered ? 'registered-card' : ''}" data-id="${item.id}">
        <!-- 카드 헤더 -->
        <div class="receipt-card-header">
          <div class="receipt-supplier-info">
            <span class="supplier-name">${supplierName}</span>
            <span class="supplier-date">${invoiceDate}</span>
          </div>
          ${statusPill}
        </div>

        <!-- 카드 본문 -->
        <div class="receipt-card-body">
          <div class="receipt-meta-grid">
            <div class="receipt-thumb-wrap" onclick="viewFullImage('${item.image_url}', '${supplierName} (${invoiceDate})')">
              <img src="${item.thumb_url || item.image_url}" alt="명세서 썸네일">
              <span class="thumb-zoom-badge">🔍 원본</span>
            </div>

            <div class="receipt-meta-details">
              <div>
                <div class="receipt-meta-line">인수자: <strong>${receiverName || '-'}</strong></div>
                ${header && header.supplier.biz_no ? `<div class="receipt-meta-line">사업자: ${header.supplier.biz_no}</div>` : ''}
                <div class="compression-tag">💾 원본 ${origKb}KB → ${compKb}KB (${savedPct}% 절감 압축 보관)</div>
              </div>
              <div class="receipt-total-price">
                ${totalAmount > 0 ? `₩ ${totalAmount.toLocaleString()}원` : ''}
              </div>
            </div>
          </div>

          ${isProcessing ? `
            <div class="processing-skeleton">
              <div class="processing-spinner"></div>
              <p style="font-size: 13px; color: #64748b;">서버에서 수기/품목을 분석하여 정리하는 중입니다...</p>
            </div>
          ` : ''}

          ${isFailed ? `
            <div style="background: #fee2e2; padding: 10px; border-radius: 6px; font-size: 12px; color: #b91c1c;">
              오류: ${item.error_message || '명세서를 인식하지 못했습니다.'}
            </div>
          ` : ''}

          ${itemsTableHtml}
        </div>

        <!-- 카드 액션 푸터 -->
        <div class="receipt-card-footer">
          <button class="btn btn-sm btn-danger-outline" onclick="deleteReceipt('${item.id}')">삭제</button>
          
          ${(isCompleted || isRegistered) ? `
            <button class="btn btn-sm btn-outline" onclick="openEditModal('${item.id}')">✏️ 수정</button>
          ` : ''}

          ${isCompleted ? `
            <button class="btn btn-sm btn-success" onclick="confirmToMes('${item.id}')">✅ MES에 등록</button>
          ` : ''}

          ${isRegistered ? `
            <button class="btn btn-sm btn-primary" onclick="openVoucherModal('${item.id}')">📋 MES 입고 전표 보기/인쇄</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function startPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    fetchReceipts();
  }, 3500);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

btnRefresh.addEventListener('click', () => {
  fetchReceipts();
});

// ==========================================
// [요구사항 2] 공장 표준 MES 입고 전표 보기 & 인쇄
// ==========================================
window.openVoucherModal = function(receiptId) {
  const item = currentReceipts.find(r => r.id === receiptId);
  if (!item || !item.data) return;

  const data = item.data;
  const header = data.header;
  const supplier = header.supplier;
  const buyer = header.buyer;
  const summary = header.summary;
  const items = data.items || [];

  document.getElementById('v-inbound-no').textContent = item.mes_inbound_no || `MES-INB-${item.id}`;
  document.getElementById('v-appr-worker').textContent = (buyer && buyer.receiver_name) || item.worker_name || '심재우';
  document.getElementById('v-invoice-date').textContent = header.invoice_date || '-';
  document.getElementById('v-receiver-name').textContent = (buyer && buyer.receiver_name) || item.worker_name || '심재우';

  document.getElementById('v-supplier-name').textContent = supplier.company_name || '-';
  document.getElementById('v-supplier-bizno').textContent = supplier.biz_no || '-';
  document.getElementById('v-supplier-rep').textContent = supplier.representative || '-';
  document.getElementById('v-supplier-tel').textContent = supplier.tel || '-';

  // 품목 테이블
  let totalQty = 0;
  let supplySum = 0;
  let vatSum = 0;

  document.getElementById('v-items-tbody').innerHTML = items.map((it, idx) => {
    const qty = it.quantity || 1;
    const amount = it.amount || 0;
    const tax = it.tax || Math.round(amount * 0.1);
    totalQty += qty;
    supplySum += amount;
    vatSum += tax;

    return `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td><strong>${it.item_name}</strong></td>
        <td>${it.specification || '-'}</td>
        <td style="text-align:center;">${qty}</td>
        <td style="text-align:right;">${(it.unit_price || 0).toLocaleString()}원</td>
        <td style="text-align:right;"><strong>${amount.toLocaleString()}원</strong></td>
        <td style="text-align:right;">${tax.toLocaleString()}원</td>
      </tr>
    `;
  }).join('');

  document.getElementById('v-total-qty').textContent = totalQty;
  document.getElementById('v-supply-sum').textContent = `${supplySum.toLocaleString()}원`;
  document.getElementById('v-vat-sum').textContent = `${vatSum.toLocaleString()}원`;

  const grandTotal = summary ? summary.total_amount : (supplySum + vatSum);
  document.getElementById('v-total-number').textContent = `₩ ${grandTotal.toLocaleString()}`;
  document.getElementById('v-total-korean').textContent = numberToKorean(grandTotal);

  // 원본 사진 첨부
  document.getElementById('v-receipt-image').src = item.image_url;

  voucherModal.classList.remove('hidden');
};

btnCloseVoucher.addEventListener('click', () => {
  voucherModal.classList.add('hidden');
});

btnPrintVoucher.addEventListener('click', () => {
  window.print();
});

// 한글 금액 변환 함수
function numberToKorean(num) {
  if (!num) return '일금 영 원정';
  const units = ['', '만', '억', '조'];
  const nums = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const smallUnits = ['', '십', '백', '천'];

  let result = '';
  let unitIdx = 0;

  while (num > 0) {
    let part = num % 10000;
    if (part > 0) {
      let partStr = '';
      let smallIdx = 0;
      while (part > 0) {
        let digit = part % 10;
        if (digit > 0) {
          partStr = nums[digit] + smallUnits[smallIdx] + partStr;
        }
        part = Math.floor(part / 10);
        smallIdx++;
      }
      result = partStr + units[unitIdx] + ' ' + result;
    }
    num = Math.floor(num / 10000);
    unitIdx++;
  }

  return `일금 ${result.trim()} 원정`;
}

// ==========================================
// [요구사항 4] MES 등록 & 중복 방지
// ==========================================
window.confirmToMes = async function(receiptId, force = false) {
  try {
    const url = force ? `/api/v1/receipts/${receiptId}/confirm?force=true` : `/api/v1/receipts/${receiptId}/confirm`;
    const res = await fetch(url, { method: 'POST' });
    const result = await res.json();

    // 중복 등록 감지 (409 Conflict)
    if (res.status === 409 && result.duplicate) {
      pendingForceReceiptId = receiptId;
      document.getElementById('dup-inbound-no').textContent = result.existing_inbound_no || '기존 전표';
      document.getElementById('dup-supplier').textContent = result.supplier_name || '-';
      document.getElementById('dup-date').textContent = result.invoice_date || '-';
      document.getElementById('dup-amount').textContent = `${(result.total_amount || 0).toLocaleString()}원`;
      duplicateModal.classList.remove('hidden');
      return;
    }

    if (!res.ok) throw new Error(result.detail || 'MES 등록 실패');

    // MES 가 돌려준 결과 (금형부품 업체면 자동 입고 · 확인 필요 건수 포함)
    alert(`✅ ${result.message || 'MES 입고 등록이 완료되었습니다!'}\n(전표번호: ${result.inbound_no})`);
    fetchReceipts();
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
};

btnCancelDup.addEventListener('click', () => {
  duplicateModal.classList.add('hidden');
  pendingForceReceiptId = null;
});

btnForceDup.addEventListener('click', () => {
  duplicateModal.classList.add('hidden');
  if (pendingForceReceiptId) {
    confirmToMes(pendingForceReceiptId, true);
    pendingForceReceiptId = null;
  }
});

// ==========================================
// 원본 사진 확대 & 삭제 & 수정
// ==========================================
window.viewFullImage = function(imageUrl, title) {
  modalFullImage.src = imageUrl;
  document.getElementById('image-modal-title').textContent = title || '거래명세서 원본';
  imageModal.classList.remove('hidden');
};

btnCloseImage.addEventListener('click', () => {
  imageModal.classList.add('hidden');
});

window.deleteReceipt = async function(receiptId) {
  if (!confirm('이 명세서를 삭제하시겠습니까?')) return;
  try {
    await fetch(`/api/v1/receipts/${receiptId}`, { method: 'DELETE' });
    fetchReceipts();
  } catch (err) {
    alert('삭제 실패');
  }
};

window.openEditModal = function(receiptId) {
  const item = currentReceipts.find(r => r.id === receiptId);
  if (!item || !item.data) return;

  const data = item.data;
  editReceiptId.value = receiptId;
  editDate.value = data.header.invoice_date || '';
  editSupplier.value = data.header.supplier.company_name || '';
  editBizNo.value = data.header.supplier.biz_no || '';
  editReceiver.value = (data.header.buyer && data.header.buyer.receiver_name) || item.worker_name || '';

  renderEditItems(data.items || []);
  recalculateEditTotals();
  editModal.classList.remove('hidden');
};

btnCloseEdit.addEventListener('click', () => {
  editModal.classList.add('hidden');
});

function renderEditItems(items) {
  editItemsList.innerHTML = items.map((it, idx) => `
    <div class="edit-item-row" data-idx="${idx}">
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <strong style="font-size: 12px; color: #1e3a8a;">품목 #${idx + 1}</strong>
        <button type="button" class="btn-text" style="color: #dc2626;" onclick="this.closest('.edit-item-row').remove(); recalculateEditTotals();">삭제</button>
      </div>
      <input type="text" class="form-control item-name" value="${it.item_name || ''}" placeholder="품명" style="margin-bottom: 4px;">
      <input type="text" class="form-control item-spec" value="${it.specification || ''}" placeholder="규격/사양" style="margin-bottom: 4px;">
      <div class="grid-2">
        <input type="number" class="form-control item-qty" value="${it.quantity || 1}" placeholder="수량">
        <input type="number" class="form-control item-price" value="${it.unit_price || 0}" placeholder="단가">
      </div>
      <input type="number" class="form-control item-amount" value="${it.amount || 0}" placeholder="공급가액" style="margin-top: 4px;">
    </div>
  `).join('');

  editItemsList.querySelectorAll('.edit-item-row').forEach(row => bindEditRowEvents(row));
}

function bindEditRowEvents(row) {
  const qty = row.querySelector('.item-qty');
  const price = row.querySelector('.item-price');
  const amount = row.querySelector('.item-amount');

  const update = () => {
    const q = parseFloat(qty.value) || 0;
    const p = parseInt(price.value, 10) || 0;
    if (q > 0 && p > 0) amount.value = Math.round(q * p);
    recalculateEditTotals();
  };

  qty.addEventListener('input', update);
  price.addEventListener('input', update);
  amount.addEventListener('input', recalculateEditTotals);
}

btnAddEditItem.addEventListener('click', () => {
  const div = document.createElement('div');
  div.className = 'edit-item-row';
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <strong style="font-size: 12px; color: #1e3a8a;">새 품목</strong>
      <button type="button" class="btn-text" style="color: #dc2626;" onclick="this.closest('.edit-item-row').remove(); recalculateEditTotals();">삭제</button>
    </div>
    <input type="text" class="form-control item-name" placeholder="품명" style="margin-bottom: 4px;">
    <input type="text" class="form-control item-spec" placeholder="규격/사양" style="margin-bottom: 4px;">
    <div class="grid-2">
      <input type="number" class="form-control item-qty" value="1" placeholder="수량">
      <input type="number" class="form-control item-price" value="0" placeholder="단가">
    </div>
    <input type="number" class="form-control item-amount" value="0" placeholder="공급가액" style="margin-top: 4px;">
  `;
  bindEditRowEvents(div);
  editItemsList.appendChild(div);
  recalculateEditTotals();
});

function recalculateEditTotals() {
  let supplySum = 0;
  editItemsList.querySelectorAll('.item-amount').forEach(inp => {
    supplySum += parseInt(inp.value, 10) || 0;
  });
  const vat = Math.round(supplySum * 0.1);
  const total = supplySum + vat;

  editSumSupply.textContent = `${supplySum.toLocaleString()}원`;
  editSumVat.textContent = `${vat.toLocaleString()}원`;
  editSumTotal.textContent = `${total.toLocaleString()}원`;
}

btnSaveEdit.addEventListener('click', async () => {
  const receiptId = editReceiptId.value;
  const current = currentReceipts.find(r => r.id === receiptId);
  if (!current) return;

  const items = [];
  editItemsList.querySelectorAll('.edit-item-row').forEach((row, idx) => {
    const name = row.querySelector('.item-name').value.trim();
    if (name) {
      const spec = row.querySelector('.item-spec').value.trim();
      const qty = parseFloat(row.querySelector('.item-qty').value) || 1;
      const price = parseInt(row.querySelector('.item-price').value, 10) || 0;
      const amount = parseInt(row.querySelector('.item-amount').value, 10) || 0;
      items.push({
        item_no: idx + 1,
        item_name: name,
        specification: spec,
        quantity: qty,
        unit_price: price,
        amount: amount,
        tax: Math.round(amount * 0.1)
      });
    }
  });

  let supplySum = 0;
  items.forEach(i => supplySum += i.amount);
  const vatSum = Math.round(supplySum * 0.1);
  const totalSum = supplySum + vatSum;

  const updatedData = {
    header: {
      invoice_date: editDate.value,
      supplier: {
        company_name: editSupplier.value,
        biz_no: editBizNo.value
      },
      buyer: {
        company_name: "대흥공업",
        receiver_name: editReceiver.value
      },
      summary: {
        supply_amount: supplySum,
        vat_amount: vatSum,
        total_amount: totalSum
      }
    },
    items: items,
    image_id: current.image_id,
    image_url: current.image_url,
    worker_id: currentWorker ? currentWorker.id : current.worker_id
  };

  try {
    const res = await fetch(`/api/v1/receipts/${receiptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    });
    if (!res.ok) throw new Error('수정 저장 실패');

    editModal.classList.add('hidden');
    fetchReceipts();
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
});

// ==========================================
// 시작 실행
// ==========================================
initWorker();
fetchReceipts();
