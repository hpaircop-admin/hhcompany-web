/* ==========================================================================
   HH 단체 예약금(deposit) 결제 위젯 (공용 모듈)
   ------------------------------------------------------------------------
   각 시설 페이지의 "단체 예약" 패널 안, 기존 "단체 예약 문의하기" 버튼 옆에
   아래 3가지만 추가하면 로그인 없이 바로 결제 가능한 단체 예약금 UI가 삽입됩니다.
   (buy-widget.js의 개인구매 위젯과 동일한 백엔드/토스 연동 구조를 그대로 재사용)

   1) <head> 또는 </body> 직전에 스크립트 추가 (group-deposit-widget.js는 반드시 마지막):
      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <script src="https://js.tosspayments.com/v1/payment"></script>
      <script src="js/group-deposit-widget.js"></script>
      (buy-widget.js와 같은 페이지에 있다면 supabase-js/tosspayments는 한 번만 로드하면 됨)

   2) 단체 패널(#panel-group 또는 #rpanel-group) 안, 기존 문의하기 버튼 아래에
      마운트 엘리먼트 추가:
      <div class="hhgd-mount" id="group-deposit"></div>

   3) 아무 <script> 안에서 초기화 호출 (기존 인원수 입력창 id를 countInputId로 지정):
      <script>
        HHGroupDepositWidget.init({
          mount: '#group-deposit',
          productId: 'p14_dep',
          venueName: VENUE_NAME,
          countInputId: 'group-count',   // Template B는 'rv-group-count'
        });
      </script>

   ------------------------------------------------------------------------
   동작:
   - 로그인 불필요. 기존 "예상 인원" 입력창(countInputId) 값을 그대로 공유해서 사용.
   - 인원 10명 미만이면 결제 버튼 비활성화 + 안내 문구 표시 (기존 문의하기 버튼의
     최소인원 규칙과 동일하게 10명 기준)
   - 결제 금액 = 상품(productId)의 indiv_price(1인당 예약금) × 예상 인원 (실시간 계산 표시)
     ⚠ 실제 청구 금액은 결제 직전 서버(payment-confirm)가 인원수 기준으로 다시 계산하며,
       클라이언트가 보낸 금액을 신뢰하지 않음 (buy-widget.js와 동일한 서버 검증 방식)
   - 담당자 이름/연락처 입력 → 토스페이먼츠 결제창(V1) 호출 → payment-confirm Edge Function 승인
   - 승인 성공 시 발권(바코드 배정) 없이 "예약금 결제 완료" 안내만 표시
     (실제 발권/재고 소모는 payment-confirm이 productId가 "_dep"로 끝나는 주문에 대해
      자동으로 건너뜀 — finalizePaidOrder()의 단체 예약금 분기 참고)
   - 결제창에서 successUrl/failUrl로 돌아왔을 때(새로고침 후)도 자동으로 이어서 처리.
     단, 같은 페이지에 개인구매 위젯(HHBuyWidget)도 함께 있는 경우, 돌아온 주문이
     "내 것"(단체 예약금)이 아니면 조용히 넘겨서 개인구매 위젯 쪽이 처리하도록 함
     (payment-confirm의 confirm 응답에 담긴 deposit:true/false 플래그로 구분).
   ========================================================================== */
(function (global) {
  const SB_URL = 'https://xoupacfmkhuuvxebgfqi.supabase.co';
  const SB_KEY = 'sb_publishable_46KQebvC7_S-_JDramvDmA_jk9aSeVc';
  const FN_URL = `${SB_URL}/functions/v1/payment-confirm`;
  // ⚠️ 테스트 키. 정식 오픈 시 live_ck_ 키로 교체 + Edge Function Secrets의 TOSS_SECRET_KEY도 함께 교체.
  // (buy-widget.js의 TOSS_CLIENT_KEY와 반드시 같은 값으로 유지)
  const TOSS_CLIENT_KEY = 'test_ck_mBZ1gQ4YVXjkO0AlJW968l2KPoqN';
  const MIN_GROUP_SIZE = 10;

  let sb = null;
  function getClient() {
    if (!sb) sb = global.supabase.createClient(SB_URL, SB_KEY);
    return sb;
  }

  function money(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }

  async function fnFetch(path, body) {
    const res = await fetch(`${FN_URL}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .hhgd-box{font-family:inherit;background:#f5f8fc;border:1px solid rgba(15,23,42,.1);border-radius:14px;padding:18px 20px;margin-top:14px;box-sizing:border-box}
      .hhgd-label{font-size:11.5px;font-weight:700;color:#64748b;letter-spacing:.02em;margin-bottom:6px}
      .hhgd-amount-row{display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:10px;padding:13px 15px;margin-bottom:12px;border:1px solid #e2e9f2}
      .hhgd-amount-row .l{font-size:12px;color:#64748b;font-weight:600}
      .hhgd-amount-row .amt{font-size:18px;font-weight:800;color:#ff6b5c}
      .hhgd-field{margin-bottom:10px}
      .hhgd-field label{display:block;font-size:12px;font-weight:700;color:#16202e;margin-bottom:6px}
      .hhgd-field input{width:100%;padding:11px 12px;border:1px solid #e2e9f2;border-radius:8px;font-size:14.5px;font-family:inherit;background:#fff;box-sizing:border-box}
      .hhgd-field input:focus{outline:none;border-color:#1d6fe0}
      .hhgd-btn{display:block;width:100%;padding:13px;border:none;border-radius:10px;background:#ff6b5c;color:#fff;font-size:14.5px;font-weight:800;cursor:pointer;font-family:inherit;text-align:center;box-sizing:border-box}
      .hhgd-btn:hover{background:#ea5647}
      .hhgd-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhgd-note{font-size:12px;color:#64748b;line-height:1.7;margin-top:10px}
      .hhgd-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
      .hhgd-method-btn{width:100%;padding:13px;border:1.5px solid #e2e9f2;border-radius:10px;background:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}
      .hhgd-method-btn:hover{border-color:#ff6b5c;color:#ff6b5c}
      .hhgd-method-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhgd-msg{font-size:12px;color:#dc2626;margin-top:10px;line-height:1.6}
      .hhgd-test-badge{display:inline-block;background:#ffb648;color:#4a2e00;font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;margin-bottom:14px}
      .hhgd-state strong{display:block;font-size:15px;margin-bottom:8px;color:#16202e}
      .hhgd-state{font-size:13.5px;color:#16202e;line-height:1.8}
      .hhgd-state .sub{font-size:12px;color:#64748b;margin-top:10px}
      .hhgd-skel{color:#64748b;font-size:13px;padding:6px 0}
    `;
    document.head.appendChild(style);
  }

  function init(opts) {
    injectCss();
    const mountEl = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!mountEl) { console.error('[HHGroupDepositWidget] mount element not found:', opts.mount); return; }
    const countInput = document.getElementById(opts.countInputId);
    if (!countInput) { console.error('[HHGroupDepositWidget] countInputId element not found:', opts.countInputId); return; }

    const state = {
      mountEl,
      countInput,
      productId: opts.productId,
      venueName: opts.venueName || '',
      orderLabel: opts.orderLabel || (opts.venueName ? `${opts.venueName} 단체 예약금` : '단체 예약금'),
      minCount: opts.minCount || MIN_GROUP_SIZE,
      price: null,
    };

    mountEl.classList.add('hhgd-box');
    mountEl.innerHTML = `<div class="hhgd-skel">불러오는 중...</div>`;

    handleTossRedirectReturn(state).then((handled) => {
      if (handled) return;
      boot(state);
    });
  }

  async function boot(state) {
    const client = getClient();
    let priceResult = { data: null, error: null };
    try {
      priceResult = await client.from('products').select('id, indiv_price, indiv_sale_enabled').eq('id', state.productId).maybeSingle();
    } catch (e) {
      priceResult = { data: null, error: e };
    }
    if (priceResult.error) {
      console.error('[HHGroupDepositWidget] 상품 가격 조회 실패 (productId=' + state.productId + '):', priceResult.error);
    }
    state.price = priceResult.data ? priceResult.data.indiv_price : null;
    state.priceError = priceResult.error || null;
    state.saleEnabled = priceResult.data ? priceResult.data.indiv_sale_enabled === true : false;

    // 예약금 상품이 아직 준비되지 않았거나(가격 미설정) 판매 비활성 상태면
    // 위젯을 완전히 숨김 — 기존 "문의하기" 버튼만 그대로 노출됨.
    if (!state.price || (!state.priceError && !state.saleEnabled)) {
      state.mountEl.style.display = 'none';
      return;
    }

    render(state);
  }

  function render(state) {
    const { mountEl, price } = state;

    mountEl.innerHTML = `
      <div class="hhgd-label">온라인으로 바로 예약금 결제</div>
      <div class="hhgd-amount-row"><span class="l">1인 ${money(price)} × <span id="hhgd-count-display">${state.countInput.value || 0}</span>명</span><span class="amt" id="hhgd-amount">${money(price * (parseInt(state.countInput.value, 10) || 0))}</span></div>
      <div class="hhgd-field"><label>담당자 이름</label><input type="text" id="hhgd-name" placeholder="이름을 입력해주세요"></div>
      <div class="hhgd-field"><label>연락처</label><input type="tel" id="hhgd-phone" placeholder="010-0000-0000"></div>
      <div class="hhgd-field"><label>이메일 (선택)</label><input type="email" id="hhgd-email" placeholder="안내 발송용"></div>
      <button type="button" class="hhgd-btn" id="hhgd-submit">예약금 결제하기 →</button>
      <div class="hhgd-msg" id="hhgd-msg"></div>
      <p class="hhgd-note">예상 인원은 위 "예상 인원" 입력창과 함께 계산돼요. 결제 후 담당자가 곧 연락드려 세부 일정을 확정 안내해드립니다. (최소 ${state.minCount}명부터 결제 가능)</p>
    `;

    const amountEl = mountEl.querySelector('#hhgd-amount');
    const countDisplayEl = mountEl.querySelector('#hhgd-count-display');
    const syncAmount = () => {
      const c = Math.max(0, parseInt(state.countInput.value, 10) || 0);
      countDisplayEl.textContent = c;
      amountEl.textContent = money(price * c);
    };
    // 기존 "예상 인원" 입력창(문의하기 버튼과 공유)이 바뀔 때마다 금액을 실시간으로 다시 계산
    state.countInput.addEventListener('input', syncAmount);

    mountEl.querySelector('#hhgd-submit').onclick = () => submitDeposit(state);
  }

  async function submitDeposit(state) {
    const { mountEl, countInput } = state;
    const name = mountEl.querySelector('#hhgd-name').value.trim();
    const phone = mountEl.querySelector('#hhgd-phone').value.trim();
    const email = mountEl.querySelector('#hhgd-email').value.trim();
    const count = parseInt(countInput.value, 10);
    const msg = mountEl.querySelector('#hhgd-msg');
    const btn = mountEl.querySelector('#hhgd-submit');

    if (!count || count < state.minCount) {
      msg.textContent = `단체 예약금 결제는 최소 ${state.minCount}명부터 가능합니다. 예상 인원을 확인해주세요.`;
      countInput.focus();
      return;
    }
    if (!name) { msg.textContent = '담당자 이름을 입력해주세요.'; return; }
    if (!phone) { msg.textContent = '연락처를 입력해주세요.'; return; }
    msg.textContent = '';

    btn.disabled = true; btn.textContent = '신청 접수 중...';
    const created = await fnFetch('create', {
      productId: state.productId, quantity: count, buyerName: name, buyerPhone: phone,
      buyerEmail: email || undefined,
    });

    if (!created.ok) {
      btn.disabled = false; btn.textContent = '예약금 결제하기 →';
      msg.textContent = created.data?.message || '신청 처리에 실패했습니다.';
      return;
    }

    const orderId = created.data.data.orderId;
    const amount = created.data.data.amount;
    renderPaymentStep(state, orderId, amount, name, email);
  }

  function renderPaymentStep(state, orderId, amount, buyerName, buyerEmail) {
    const { mountEl } = state;
    mountEl.innerHTML = `
      <div class="hhgd-test-badge">테스트 결제 모드 · 실제 청구 없음</div>
      <div class="hhgd-amount-row"><span class="l">예약금 결제 금액</span><span class="amt">${money(amount)}</span></div>
      <div class="hhgd-methods" id="hhgd-method-grid">
        <button type="button" class="hhgd-method-btn" data-method="카드">💳 카드로 결제</button>
        <button type="button" class="hhgd-method-btn" data-method="계좌이체">🏦 계좌이체로 결제</button>
        <button type="button" class="hhgd-method-btn" data-method="토스페이">🅣 토스페이로 결제</button>
      </div>
      <div class="hhgd-msg" id="hhgd-msg"></div>
    `;

    if (location.protocol === 'file:') {
      mountEl.querySelector('#hhgd-msg').innerHTML =
        '⚠️ file://로 직접 열면 결제창이 정상 동작하지 않을 수 있습니다.<br>실제 배포 주소(https://)로 열어서 테스트해주세요.';
    }

    let tossPayments;
    try {
      tossPayments = global.TossPayments(TOSS_CLIENT_KEY);
    } catch (e) {
      console.error('토스페이먼츠 SDK 초기화 실패:', e);
      mountEl.querySelector('#hhgd-msg').textContent = '결제 모듈을 불러오지 못했습니다: ' + (e?.message || e);
      return;
    }

    mountEl.querySelectorAll('.hhgd-method-btn').forEach(btn => {
      btn.onclick = async () => {
        const msg = mountEl.querySelector('#hhgd-msg');
        msg.textContent = '';
        mountEl.querySelectorAll('.hhgd-method-btn').forEach(b => b.disabled = true);
        try {
          await tossPayments.requestPayment(btn.dataset.method, {
            amount,
            orderId,
            orderName: state.orderLabel,
            customerName: buyerName,
            customerEmail: buyerEmail || undefined,
            successUrl: location.origin + location.pathname,
            failUrl: location.origin + location.pathname,
          });
        } catch (e) {
          console.error('토스 결제 요청 실패:', e);
          mountEl.querySelectorAll('.hhgd-method-btn').forEach(b => b.disabled = false);
          if (e?.code === 'USER_CANCEL') { msg.textContent = '결제가 취소되었습니다.'; return; }
          msg.textContent = '결제창을 여는 데 실패했습니다: ' + (e?.message || e || '알 수 없는 오류');
        }
      };
    });
  }

  function showConfirmingState(state) {
    state.mountEl.innerHTML = `<div class="hhgd-state"><strong>결제 확인 중입니다...</strong>잠시만 기다려주세요.</div>`;
  }
  function showConfirmFailedState(state, message) {
    state.mountEl.innerHTML = `
      <div class="hhgd-state">
        <strong>결제 확인에 실패했습니다</strong>
        ${message || '결제 승인 중 문제가 발생했습니다.'}
        <div class="sub">문의: 031-339-2999</div>
      </div>`;
  }
  function showDepositDoneState(state, amount) {
    state.mountEl.innerHTML = `
      <div class="hhgd-state">
        <strong>✅ 예약금 결제가 완료됐어요</strong>
        ${money(amount)} 결제가 확인됐습니다. 담당자가 곧 연락드려 세부 일정을 확정 안내해드립니다.
        <div class="sub">문의: 031-339-2999</div>
      </div>`;
  }

  // 토스 결제창에서 successUrl/failUrl로 돌아왔을 때(페이지 전체가 새로고침된 상태) 처리.
  // true를 반환하면 이미 mountEl에 결과 상태를 그려놓은 것이므로 boot()로 이어서 진행하지 않음.
  // false를 반환하면 "내가 처리할 주문이 아니다"(또는 결제 리다이렉트 자체가 아니다)라는 뜻이므로
  // 평소처럼 boot()가 이어서 실행됨.
  async function handleTossRedirectReturn(state) {
    const params = new URLSearchParams(location.search);
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    const failCode = params.get('code');

    if (paymentKey && orderId && amount) {
      showConfirmingState(state);
      const confirmed = await fnFetch('confirm', { orderId, paymentKey, amount: Number(amount) });
      if (confirmed.ok) {
        if (confirmed.data?.data?.deposit !== true) {
          // 이 결제는 단체 예약금 주문이 아님(개인 구매 등) — 이 위젯이 처리할 대상이 아니므로
          // 조용히 넘겨서 boot()가 평소 화면을 그리도록 함.
          return false;
        }
        showDepositDoneState(state, Number(amount));
        history.replaceState(null, '', location.pathname);
        return true;
      }
      showConfirmFailedState(state, confirmed.data?.message);
      history.replaceState(null, '', location.pathname);
      return true;
    } else if (failCode) {
      // 실패 리다이렉트에는 상품 구분 정보가 없어 개인구매 위젯과 동시에 뜰 수 있음(허용 가능한 수준의 중복 안내).
      const orderIdFromFail = params.get('orderId') || '';
      state.mountEl.innerHTML = `
        <div class="hhgd-state">
          <strong>결제가 취소됐어요</strong>
          ${params.get('message') || '결제가 완료되지 않았습니다.'}
          <div class="sub">${orderIdFromFail ? '접수번호 ' + orderIdFromFail + ' · ' : ''}다시 시도하시려면 아래에서 다시 결제를 진행해주세요.</div>
        </div>`;
      history.replaceState(null, '', location.pathname);
      return true;
    }
    return false;
  }

  global.HHGroupDepositWidget = { init };
})(window);
