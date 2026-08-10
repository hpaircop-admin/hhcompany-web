/* ==========================================================================
   HH 개인 구매 위젯 (공용 모듈)
   ------------------------------------------------------------------------
   각 상품 페이지에 아래 3가지만 추가하면 로그인 기반 개인 구매 UI가 삽입됩니다.

   1) <head> 또는 </body> 직전에 스크립트 3개 추가 (buy-widget.js는 반드시 마지막):
      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <script src="https://js.tosspayments.com/v1/payment"></script>
      <script src="js/buy-widget.js"></script>

   2) 위젯을 넣을 자리에 마운트 엘리먼트 추가:
      <div class="hhbw-mount" id="buy"></div>

   3) 아무 <script> 안에서 초기화 호출:
      <script>
        HHBuyWidget.init({ mount: '#buy', productId: 'p2', venueName: '오션월드' });
      </script>

   ------------------------------------------------------------------------
   동작:
   - 로그인 안 돼있으면 "로그인하고 구매하기" 버튼 → login.html?redirect=현재페이지%23buy
   - 로그인 돼있으면 회원 정보(이름/연락처)를 자동으로 채운 구매 폼 표시
   - 인원수 입력 → 토스페이먼츠 결제창(V1) 호출 → payment-confirm Edge Function으로 승인
   - 승인 성공 시 ticket.html?pin=... 로 이동 (기존 흐름과 동일)
   - 결제창에서 successUrl/failUrl로 돌아왔을 때(새로고침 후)도 자동으로 이어서 처리
   ========================================================================== */
(function (global) {
  const SB_URL = 'https://xoupacfmkhuuvxebgfqi.supabase.co';
  const SB_KEY = 'sb_publishable_46KQebvC7_S-_JDramvDmA_jk9aSeVc';
  const FN_URL = `${SB_URL}/functions/v1/payment-confirm`;
  // ⚠️ 테스트 키. 정식 오픈 시 live_ck_ 키로 교체 + Edge Function Secrets의 TOSS_SECRET_KEY도 함께 교체.
  const TOSS_CLIENT_KEY = 'test_ck_mBZ1gQ4YVXjkO0AlJW968l2KPoqN';

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
      .hhbw-box{font-family:inherit;background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:14px;padding:20px 22px;max-width:480px}
      .hhbw-label{font-size:11.5px;font-weight:700;color:#64748b;letter-spacing:.02em;margin-bottom:6px}
      .hhbw-price{font-size:22px;font-weight:900;color:#16202e;margin-bottom:14px}
      .hhbw-price small{font-size:12px;font-weight:600;color:#64748b}
      .hhbw-btn{display:block;width:100%;padding:13px;border:none;border-radius:10px;background:#1d6fe0;color:#fff;font-size:14.5px;font-weight:800;cursor:pointer;font-family:inherit;text-align:center;text-decoration:none;box-sizing:border-box}
      .hhbw-btn:hover{background:#1558b8}
      .hhbw-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhbw-note{font-size:12px;color:#64748b;line-height:1.7;margin-top:10px}
      .hhbw-field{margin-bottom:12px}
      .hhbw-field label{display:block;font-size:12px;font-weight:700;color:#16202e;margin-bottom:6px}
      .hhbw-field input{width:100%;padding:11px 12px;border:1px solid #e2e9f2;border-radius:8px;font-size:14.5px;font-family:inherit;background:#fafbfd;box-sizing:border-box}
      .hhbw-field input:focus{outline:none;border-color:#1d6fe0;background:#fff}
      .hhbw-amount-row{display:flex;align-items:center;justify-content:space-between;background:#f5f8fc;border-radius:10px;padding:13px 15px;margin-bottom:14px}
      .hhbw-amount-row .l{font-size:12px;color:#64748b;font-weight:600}
      .hhbw-amount-row .amt{font-size:18px;font-weight:800;color:#ff6b5c}
      .hhbw-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
      .hhbw-method-btn{width:100%;padding:13px;border:1.5px solid #e2e9f2;border-radius:10px;background:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}
      .hhbw-method-btn:hover{border-color:#1d6fe0;color:#1d6fe0}
      .hhbw-method-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhbw-msg{font-size:12px;color:#dc2626;margin-top:10px;line-height:1.6}
      .hhbw-test-badge{display:inline-block;background:#ffb648;color:#4a2e00;font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;margin-bottom:14px}
      .hhbw-state strong{display:block;font-size:15px;margin-bottom:8px}
      .hhbw-state{font-size:13.5px;color:#16202e;line-height:1.8}
      .hhbw-state .sub{font-size:12px;color:#64748b;margin-top:10px}
      .hhbw-skel{color:#64748b;font-size:13px;padding:6px 0}
    `;
    document.head.appendChild(style);
  }

  function init(opts) {
    injectCss();
    const mountEl = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!mountEl) { console.error('[HHBuyWidget] mount element not found:', opts.mount); return; }
    const state = {
      mountEl,
      productId: opts.productId,
      venueName: opts.venueName || '',
      orderLabel: opts.orderLabel || (opts.venueName ? `${opts.venueName} 개인 입장권` : '개인 입장권'),
      price: null,
      session: null,
      profile: null,
    };

    mountEl.classList.add('hhbw-box');
    mountEl.innerHTML = `<div class="hhbw-skel">불러오는 중...</div>`;

    handleTossRedirectReturn(state).then((handled) => {
      if (handled) return;
      boot(state);
    });
  }

  async function boot(state) {
    const client = getClient();
    let sessionData = null, priceResult = { data: null, error: null };
    try {
      const sessRes = await client.auth.getSession();
      sessionData = sessRes?.data || null;
    } catch (e) {
      console.error('[HHBuyWidget] getSession() 실패:', e);
    }
    try {
      priceResult = await client.from('products').select('id, indiv_price').eq('id', state.productId).maybeSingle();
    } catch (e) {
      priceResult = { data: null, error: e };
    }
    if (priceResult.error) {
      console.error('[HHBuyWidget] 상품 가격 조회 실패 (productId=' + state.productId + '):', priceResult.error);
    }
    state.session = sessionData?.session || null;
    state.price = priceResult.data ? priceResult.data.indiv_price : null;
    state.priceError = priceResult.error || null;

    if (state.session) {
      try {
        const { data: profile } = await client.from('profiles')
          .select('name, phone, email').eq('id', state.session.user.id).maybeSingle();
        state.profile = profile || null;
      } catch (e) { state.profile = null; }
    }

    render(state);

    // 자체적으로 #buy 앵커로 넘어온 경우 스크롤 위치 보정 (로그인 후 돌아왔을 때)
    if (location.hash === '#' + (state.mountEl.id || '')) {
      state.mountEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function render(state) {
    const { mountEl, price } = state;

    if (!price) {
      if (state.priceError) {
        // 실제로 상품이 미설정인 게 아니라 조회 자체가 실패한 경우 — 콘솔에 이미 상세 에러를 남겼으니
        // 화면에는 문의 유도 + 개발자용 힌트만 짧게 표시 (F12 콘솔에서 정확한 원인 확인 가능)
        mountEl.innerHTML = `
          <div class="hhbw-label">개인 구매</div>
          <div class="hhbw-price">가격 정보를 불러오지 못했습니다</div>
          <div class="hhbw-note">전화 또는 카카오톡으로 문의해주세요. (관리자: 브라우저 콘솔(F12)에서 정확한 오류 메시지를 확인할 수 있습니다)</div>
        `;
      } else {
        mountEl.innerHTML = `
          <div class="hhbw-label">개인 구매</div>
          <div class="hhbw-price">현재 온라인 판매 준비 중입니다</div>
          <div class="hhbw-note">전화 또는 카카오톡 문의로 개인(10인 미만) 예약을 도와드릴게요.</div>
        `;
      }
      return;
    }

    if (!state.session) {
      const redirectTo = encodeURIComponent(location.pathname + location.search + '#' + (mountEl.id || 'buy'));
      mountEl.innerHTML = `
        <div class="hhbw-label">${state.orderLabel} (1인)</div>
        <div class="hhbw-price">${money(price)}<small> / 1인</small></div>
        <a class="hhbw-btn" href="login.html?redirect=${redirectTo}">로그인하고 구매하기 →</a>
        <div class="hhbw-note">회원가입/로그인 후 온라인으로 바로 결제하실 수 있어요. 처음이시면 로그인 화면에서 바로 가입도 가능합니다.</div>
      `;
      return;
    }

    const prefillName = state.profile?.name || '';
    const prefillPhone = state.profile?.phone || '';
    const prefillEmail = state.profile?.email || '';

    mountEl.innerHTML = `
      <div class="hhbw-label">${state.orderLabel} (1인)</div>
      <div class="hhbw-price">${money(price)}<small> / 1인</small></div>
      <div class="hhbw-field"><label>구매자 이름</label><input type="text" id="hhbw-name" value="${escapeAttr(prefillName)}" placeholder="이름을 입력해주세요"></div>
      <div class="hhbw-field"><label>연락처</label><input type="tel" id="hhbw-phone" value="${escapeAttr(prefillPhone)}" placeholder="010-0000-0000"></div>
      <div class="hhbw-field"><label>이메일 (선택)</label><input type="email" id="hhbw-email" value="${escapeAttr(prefillEmail)}" placeholder="안내 발송용"></div>
      <div class="hhbw-field"><label>인원 수</label><input type="number" id="hhbw-qty" value="1" min="1" max="20"></div>
      <div class="hhbw-amount-row"><span class="l">결제 예정 금액</span><span class="amt" id="hhbw-amount">${money(price)}</span></div>
      <button type="button" class="hhbw-btn" id="hhbw-submit">결제 진행하기</button>
      <div class="hhbw-msg" id="hhbw-msg"></div>
    `;

    const qtyInput = mountEl.querySelector('#hhbw-qty');
    const amountEl = mountEl.querySelector('#hhbw-amount');
    qtyInput.oninput = () => {
      const q = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      amountEl.textContent = money(price * q);
    };
    mountEl.querySelector('#hhbw-submit').onclick = () => submitTicket(state);
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  async function submitTicket(state) {
    const { mountEl } = state;
    const name = mountEl.querySelector('#hhbw-name').value.trim();
    const phone = mountEl.querySelector('#hhbw-phone').value.trim();
    const email = mountEl.querySelector('#hhbw-email').value.trim();
    const qty = Math.max(1, parseInt(mountEl.querySelector('#hhbw-qty').value, 10) || 1);
    const msg = mountEl.querySelector('#hhbw-msg');
    const btn = mountEl.querySelector('#hhbw-submit');

    if (!name) { msg.textContent = '이름을 입력해주세요.'; return; }
    if (!phone) { msg.textContent = '연락처를 입력해주세요.'; return; }
    msg.textContent = '';

    btn.disabled = true; btn.textContent = '신청 접수 중...';
    const created = await fnFetch('create', {
      productId: state.productId, quantity: qty, buyerName: name, buyerPhone: phone,
      buyerEmail: email || undefined,
    });

    if (!created.ok) {
      btn.disabled = false; btn.textContent = '결제 진행하기';
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
      <div class="hhbw-test-badge">테스트 결제 모드 · 실제 청구 없음</div>
      <div class="hhbw-amount-row"><span class="l">결제 금액</span><span class="amt">${money(amount)}</span></div>
      <div class="hhbw-methods" id="hhbw-method-grid">
        <button type="button" class="hhbw-method-btn" data-method="카드">💳 카드로 결제</button>
        <button type="button" class="hhbw-method-btn" data-method="계좌이체">🏦 계좌이체로 결제</button>
        <button type="button" class="hhbw-method-btn" data-method="토스페이">🅣 토스페이로 결제</button>
      </div>
      <div class="hhbw-msg" id="hhbw-msg"></div>
    `;

    if (location.protocol === 'file:') {
      mountEl.querySelector('#hhbw-msg').innerHTML =
        '⚠️ file://로 직접 열면 결제창이 정상 동작하지 않을 수 있습니다.<br>실제 배포 주소(https://)로 열어서 테스트해주세요.';
    }

    let tossPayments;
    try {
      tossPayments = global.TossPayments(TOSS_CLIENT_KEY);
    } catch (e) {
      console.error('토스페이먼츠 SDK 초기화 실패:', e);
      mountEl.querySelector('#hhbw-msg').textContent = '결제 모듈을 불러오지 못했습니다: ' + (e?.message || e);
      return;
    }

    mountEl.querySelectorAll('.hhbw-method-btn').forEach(btn => {
      btn.onclick = async () => {
        const msg = mountEl.querySelector('#hhbw-msg');
        msg.textContent = '';
        mountEl.querySelectorAll('.hhbw-method-btn').forEach(b => b.disabled = true);
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
          mountEl.querySelectorAll('.hhbw-method-btn').forEach(b => b.disabled = false);
          if (e?.code === 'USER_CANCEL') { msg.textContent = '결제가 취소되었습니다.'; return; }
          msg.textContent = '결제창을 여는 데 실패했습니다: ' + (e?.message || e || '알 수 없는 오류');
        }
      };
    });
  }

  function showConfirmingState(state) {
    state.mountEl.innerHTML = `<div class="hhbw-state"><strong>결제 확인 중입니다...</strong>잠시만 기다려주세요.</div>`;
  }
  function showConfirmFailedState(state, message) {
    state.mountEl.innerHTML = `
      <div class="hhbw-state">
        <strong>결제 확인에 실패했습니다</strong>
        ${message || '결제 승인 중 문제가 발생했습니다.'}
        <div class="sub">문의: 031-339-2999</div>
      </div>`;
  }

  // 토스 결제창에서 successUrl/failUrl로 돌아왔을 때(페이지 전체가 새로고침된 상태) 처리.
  // true를 반환하면 이미 mountEl에 결과 상태를 그려놓은 것이므로 boot()로 이어서 진행하지 않음.
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
        const pins = confirmed.data.data.pins || [];
        location.href = 'ticket.html?pin=' + encodeURIComponent(pins[0] || '');
        return true;
      }
      showConfirmFailedState(state, confirmed.data?.message);
      history.replaceState(null, '', location.pathname);
      return true;
    } else if (failCode) {
      const orderIdFromFail = params.get('orderId') || '';
      state.mountEl.innerHTML = `
        <div class="hhbw-state">
          <strong>결제가 취소됐어요</strong>
          ${params.get('message') || '결제가 완료되지 않았습니다.'}
          <div class="sub">${orderIdFromFail ? '접수번호 ' + orderIdFromFail + ' · ' : ''}다시 시도하시려면 아래에서 다시 구매를 진행해주세요.</div>
        </div>`;
      history.replaceState(null, '', location.pathname);
      return true;
    }
    return false;
  }

  global.HHBuyWidget = { init };
})(window);
