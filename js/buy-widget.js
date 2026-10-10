/* ==========================================================================
   HH 개인 구매 위젯 (공용 모듈)
   ------------------------------------------------------------------------
   각 상품 페이지에 아래 3가지만 추가하면 휴대폰 본인확인 기반 개인 구매 UI가 삽입됩니다.

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
   동작 (2026-09-30부터: 로그인 → 휴대폰 본인확인으로 전환):
   - 로그인 불필요. group-deposit-widget.js와 동일하게 휴대폰 인증번호(OTP)로
     본인확인 후 바로 구매. 로그인해서 이미 회원 프로필이 있으면 이름/연락처는
     편의상 자동으로 채워주지만, 그래도 인증번호 확인은 항상 해야 결제 버튼이
     열림(휴대폰 번호가 진짜 그 사람 것인지 매 구매마다 다시 확인).
   - 인원수·이용권 선택 → 토스페이먼츠 결제창(V1) 호출 → payment-confirm Edge Function으로 승인
   - 승인 성공 시 ticket.html?pin=... 로 이동 (기존 흐름과 동일)
   - 결제창에서 successUrl/failUrl로 돌아왔을 때(새로고침 후)도 자동으로 이어서 처리
   ========================================================================== */
(function (global) {
  const SB_URL = 'https://xoupacfmkhuuvxebgfqi.supabase.co';
  const SB_KEY = 'sb_publishable_46KQebvC7_S-_JDramvDmA_jk9aSeVc';
  const FN_URL = `${SB_URL}/functions/v1/payment-confirm`;
  // 휴대폰 본인확인(SMS 인증번호) 전용 Edge Function (group-deposit-widget.js와 동일)
  const FN2_URL = `${SB_URL}/functions/v1/phone-verify`;
  // ✅ 라이브(실결제) 키. 실제 카드 청구가 발생합니다. Edge Function Secrets의 TOSS_SECRET_KEY도 live_sk_ 키여야 정상 동작(API 개별연동 키 사용).
  const TOSS_CLIENT_KEY = 'live_ck_BX7zk2yd8yqLlQDyRAXv8x9POLqK';

  let sb = null;
  function getClient() {
    if (!sb) sb = global.supabase.createClient(SB_URL, SB_KEY);
    return sb;
  }

  function money(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function digitsOf(v) { return String(v || '').replace(/[^0-9]/g, ''); }
  function isValidPhoneDigits(d) { return /^01[0-9]{8,9}$/.test(d); }

  // 같은 엘리먼트·이벤트에 리스너를 다시 걸기 전에 이전 것을 지워서, render()가 다시
  // 불려도(이용권 변경 등) 리스너가 계속 쌓이지 않게 함 (group-deposit-widget.js와 동일)
  function bindOnce(el, eventName, handler) {
    if (!el) return;
    const key = '_hhbwListener_' + eventName;
    if (el[key]) el.removeEventListener(eventName, el[key]);
    el.addEventListener(eventName, handler);
    el[key] = handler;
  }

  async function fnFetch(path, body) {
    const res = await fetch(`${FN_URL}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // phone-verify 전용 fetch (본인확인 send/confirm 호출용, group-deposit-widget.js와 동일)
  async function fnFetch2(path, body) {
    const res = await fetch(`${FN2_URL}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // 토스 결제창에서 돌아온 직후 /confirm 호출은 딱 한 번만 나가야 합니다. 한 페이지에
  // 개인구매(HHBuyWidget)와 단체예약금(HHGroupDepositWidget) 위젯이 함께 마운트된 경우
  // (2026-09-02부터 여러 업장 페이지에서 발생) 둘 다 같은 orderId로 동시에 /confirm을
  // 부르면, 토스 결제 서버가 두 번째 요청을 "이미 처리 중인 요청입니다" 같은 에러로
  // 거절합니다 — 실제 결제/문자발송은 정상 처리됐는데도 화면엔 결제 실패로 보이는
  // 문제가 생깁니다. window 전역에 진행 중인 확인 요청을 캐싱해서, 두 위젯이 항상 같은
  // 요청(Promise) 하나만 공유하도록 합니다.
  function confirmOnce(orderId, paymentKey, amount) {
    global.__hhConfirmPromises = global.__hhConfirmPromises || {};
    if (!global.__hhConfirmPromises[orderId]) {
      global.__hhConfirmPromises[orderId] = fnFetch('confirm', { orderId, paymentKey, amount });
    }
    return global.__hhConfirmPromises[orderId];
  }

  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .hhbw-box{font-family:inherit;background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:16px;padding:20px 22px;max-width:480px}
      .hhbw-label{font-size:12px;font-weight:700;color:#5d6b68;letter-spacing:.02em;margin-bottom:6px}
      .hhbw-price{font-size:21px;font-weight:800;color:#17302e;margin-bottom:14px}
      .hhbw-price small{font-size:12px;font-weight:600;color:#5d6b68}
      .hhbw-btn{display:block;width:100%;padding:13px;border:none;border-radius:12px;background:#1d6fe0;color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;text-align:center;text-decoration:none;box-sizing:border-box}
      .hhbw-btn:hover{background:#1d6fe0}
      .hhbw-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhbw-note{font-size:12px;color:#5d6b68;line-height:1.7;margin-top:10px}
      .hhbw-field{margin-bottom:12px}
      .hhbw-field label{display:block;font-size:12px;font-weight:700;color:#17302e;margin-bottom:6px}
      .hhbw-field input{width:100%;padding:11px 12px;border:1px solid #e7f0fd;border-radius:8px;font-size:15px;font-family:inherit;background:#ffffff;box-sizing:border-box}
      .hhbw-field input:focus{outline:none;border-color:#1d6fe0;background:#fff}
      .hhbw-amount-row{display:flex;align-items:center;justify-content:space-between;background:#faf8f4;border-radius:12px;padding:13px 15px;margin-bottom:14px}
      .hhbw-amount-row .l{font-size:12px;color:#5d6b68;font-weight:600}
      .hhbw-amount-row .amt{font-size:18px;font-weight:800;color:#f97316}
      .hhbw-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
      .hhbw-method-btn{width:100%;padding:13px;border:1.5px solid #e7f0fd;border-radius:12px;background:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}
      .hhbw-method-btn:hover{border-color:#1d6fe0;color:#1d6fe0}
      .hhbw-method-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhbw-msg{font-size:12px;color:#dc2626;margin-top:10px;line-height:1.6}
      .hhbw-phone-row{display:flex;gap:8px}
      .hhbw-phone-row input{flex:1;min-width:0}
      .hhbw-otp-btn{white-space:nowrap;padding:0 14px;border:1.5px solid #1d6fe0;border-radius:8px;background:#fff;color:#1d6fe0;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
      .hhbw-otp-btn:hover{background:#e7f0fd}
      .hhbw-otp-btn:disabled{opacity:.5;cursor:not-allowed}
      .hhbw-otp-row{display:flex;gap:8px;margin-top:8px}
      .hhbw-otp-row input{flex:1;min-width:0;padding:11px 12px;border:1px solid #e7f0fd;border-radius:8px;font-size:15px;font-family:inherit;background:#ffffff;box-sizing:border-box}
      .hhbw-otp-row input:focus{outline:none;border-color:#1d6fe0;background:#fff}
      .hhbw-otp-status{font-size:12px;margin-top:6px;line-height:1.6;color:#5d6b68}
      .hhbw-otp-status.ok{color:#1c8a45;font-weight:700}
      .hhbw-otp-status.err{color:#dc2626}
      .hhbw-test-badge{display:inline-block;background:#f97316;color:#233d32;font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;margin-bottom:14px}
      .hhbw-state strong{display:block;font-size:15px;margin-bottom:8px}
      .hhbw-state{font-size:14px;color:#17302e;line-height:1.8}
      .hhbw-state .sub{font-size:12px;color:#5d6b68;margin-top:10px}
      .hhbw-skel{color:#5d6b68;font-size:13px;padding:6px 0}
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
      // 휴대폰 본인확인 상태 (2026-09-30부터 로그인 대신 이걸로 구매를 허용)
      otp: { verified: false, token: null, verifiedPhone: null },
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
      priceResult = await client.from('products').select('id, indiv_price, indiv_sale_enabled, indiv_tickets').eq('id', state.productId).maybeSingle();
    } catch (e) {
      priceResult = { data: null, error: e };
    }
    if (priceResult.error) {
      console.error('[HHBuyWidget] 상품 가격 조회 실패 (productId=' + state.productId + '):', priceResult.error);
    }
    state.session = sessionData?.session || null;
    // 권종(indiv_tickets)이 여러 개 등록된 상품은 그 중 하나를 골라야 가격이 정해지므로,
    // 화면에 선택창을 보여주기 위해 배열 자체를 들고 있는다 (state.price는 "현재 선택된
    // 권종의 가격"으로 취급 — 기본값은 첫 번째 권종). 권종이 없는 상품은 기존처럼
    // indiv_price 하나만 쓰는 단일가 상품으로 동작한다 (다른 업장 전부 이 경로 그대로 유지).
    const tickets = priceResult.data && Array.isArray(priceResult.data.indiv_tickets) ? priceResult.data.indiv_tickets.filter(t => t && t.type && t.price > 0) : [];
    state.indivTickets = tickets.length ? tickets : null;
    state.ticketIndex = 0;
    state.price = state.indivTickets ? state.indivTickets[0].price : (priceResult.data ? priceResult.data.indiv_price : null);
    state.priceError = priceResult.error || null;
    state.saleEnabled = priceResult.data ? priceResult.data.indiv_sale_enabled === true : false;

    // 관리자가 "개인 판매 여부"를 비활성으로 꺼둔 상품은 "준비 중" 안내를 보여주는 대신
    // 개인 구매 탭 자체를 완전히 숨김 (조회 자체가 실패한 경우(priceError)는 설정을 못 읽은 것뿐이므로
    // 탭은 유지하고 기존 오류 메시지를 보여줌 — 실수로 다 숨겨버리는 걸 방지)
    if (!state.priceError && !state.saleEnabled) {
      hideIndivTab(state);
      return;
    }

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

  // 개인 판매가 꺼져있는 상품의 "개인 구매" 탭 버튼/패널을 완전히 숨기고,
  // 단체 예약 탭만 보이는 상태로 되돌림. 두 가지 탭 마크업(rtab-*/tab-*)을 모두 지원.
  function hideIndivTab(state) {
    const { mountEl } = state;
    mountEl.innerHTML = '';
    mountEl.style.display = 'none';

    const indivBtn = document.getElementById('rtab-indiv') || document.getElementById('tab-indiv');
    const groupBtn = document.getElementById('rtab-group') || document.getElementById('tab-group');
    const indivPanel = document.getElementById('rpanel-indiv') || document.getElementById('panel-indiv');
    const groupPanel = document.getElementById('rpanel-group') || document.getElementById('panel-group');

    if (indivBtn) indivBtn.style.display = 'none';
    if (indivPanel) indivPanel.style.display = 'none';
    if (groupPanel) groupPanel.style.display = '';
    if (groupBtn) {
      groupBtn.style.background = '#17302e';
      groupBtn.style.color = '#fff';
    }
  }

  // 권종(indiv_tickets)이 있는 상품의 "이용권 선택" <select> 마크업. 없는 상품(대부분)은 빈 문자열.
  function ticketSelectHtml(state) {
    if (!state.indivTickets) return '';
    return `<div class="hhbw-field"><label>이용권 선택</label>
      <select id="hhbw-ticket-select" style="width:100%;padding:11px 12px;border:1px solid #e7f0fd;border-radius:8px;font-size:15px;font-family:inherit;background:#ffffff;box-sizing:border-box">
        ${state.indivTickets.map((t, i) => `<option value="${i}"${i === state.ticketIndex ? ' selected' : ''}>${escapeAttr(t.type)} — ${money(t.price)}</option>`).join('')}
      </select>
    </div>`;
  }

  // 현재 선택된 권종(또는 단일가)에 맞춰 라벨/가격을 갱신
  function currentTicketLabel(state) {
    if (state.indivTickets) return state.indivTickets[state.ticketIndex].type;
    return state.orderLabel;
  }

  function render(state) {
    const { mountEl, price } = state;

    if (!price) {
      if (state.priceError) {
        // 실제로 상품이 미설정인 게 아니라 조회 자체가 실패한 경우 — 콘솔에 이미 상세 에러를 남겼으니
        // 화면에는 문의 유도 + 개발자용 힌트만 짧게 표시 (F12 콘솔에서 정확한 오류 메시지를 확인할 수 있습니다)
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

    // 로그인 중이면 이름/연락처/이메일을 편의상 미리 채워주지만(회원 프로필), 그래도
    // 구매 전에는 항상 휴대폰 인증번호 확인을 거쳐야 함 — group-deposit-widget.js와
    // 동일하게 로그인 여부와 상관없이 "지금 이 번호가 본인 것"인지 매 구매마다 확인.
    const prefillName = state.profile?.name || '';
    const prefillPhone = state.profile?.phone || '';
    const prefillEmail = state.profile?.email || '';

    mountEl.innerHTML = `
      <div class="hhbw-label">${currentTicketLabel(state)} (1인)</div>
      <div class="hhbw-price" id="hhbw-price">${money(price)}<small> / 1인</small></div>
      ${ticketSelectHtml(state)}
      <div class="hhbw-field"><label>구매자 이름</label><input type="text" id="hhbw-name" value="${escapeAttr(prefillName)}" placeholder="이름을 입력해주세요"></div>
      <div class="hhbw-field">
        <label>연락처 (본인확인 필요)</label>
        <div class="hhbw-phone-row">
          <input type="tel" id="hhbw-phone" value="${escapeAttr(prefillPhone)}" placeholder="010-0000-0000">
          <button type="button" class="hhbw-otp-btn" id="hhbw-otp-send">인증번호 받기</button>
        </div>
        <div class="hhbw-otp-row" id="hhbw-otp-row" style="display:none">
          <input type="text" id="hhbw-otp-code" placeholder="인증번호 6자리" maxlength="6" inputmode="numeric">
          <button type="button" class="hhbw-otp-btn" id="hhbw-otp-confirm">확인</button>
        </div>
        <div class="hhbw-otp-status" id="hhbw-otp-status"></div>
      </div>
      <div class="hhbw-field"><label>이메일 (선택)</label><input type="email" id="hhbw-email" value="${escapeAttr(prefillEmail)}" placeholder="안내 발송용"></div>
      <div class="hhbw-field"><label>인원 수</label><input type="number" id="hhbw-qty" value="1" min="1" max="20"></div>
      <div class="hhbw-amount-row"><span class="l">결제 예정 금액</span><span class="amt" id="hhbw-amount">${money(price)}</span></div>
      <button type="button" class="hhbw-btn" id="hhbw-submit">결제 진행하기</button>
      <div class="hhbw-msg" id="hhbw-msg"></div>
    `;

    const qtyInput = mountEl.querySelector('#hhbw-qty');
    const amountEl = mountEl.querySelector('#hhbw-amount');
    const syncAmount = () => {
      const q = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      amountEl.textContent = money(state.price * q);
    };
    qtyInput.oninput = syncAmount;
    const sel = mountEl.querySelector('#hhbw-ticket-select');
    if (sel) sel.onchange = () => {
      state.ticketIndex = parseInt(sel.value, 10) || 0;
      state.price = state.indivTickets[state.ticketIndex].price;
      mountEl.querySelector('.hhbw-label').textContent = currentTicketLabel(state) + ' (1인)';
      mountEl.querySelector('#hhbw-price').innerHTML = `${money(state.price)}<small> / 1인</small>`;
      syncAmount();
    };

    // ── 휴대폰 본인확인(OTP) ────────────────────────────────────────
    const phoneInput = mountEl.querySelector('#hhbw-phone');
    const otpSendBtn = mountEl.querySelector('#hhbw-otp-send');
    const otpRow = mountEl.querySelector('#hhbw-otp-row');
    const otpCodeInput = mountEl.querySelector('#hhbw-otp-code');
    const otpConfirmBtn = mountEl.querySelector('#hhbw-otp-confirm');
    const otpStatusEl = mountEl.querySelector('#hhbw-otp-status');

    function setOtpStatus(text, kind) {
      otpStatusEl.textContent = text || '';
      otpStatusEl.className = 'hhbw-otp-status' + (kind ? ' ' + kind : '');
    }

    // 인증 완료 후 번호를 바꾸면 그 토큰은 더 이상 이 번호 것이 아니므로 무효화하고
    // 처음부터 다시 인증하도록 되돌림 (프로필에서 자동으로 채워진 번호를 그대로 쓰는
    // 경우에도 최초 1회는 인증을 받아야 함 — 아래에서 이미 인증된 상태로 시작하지 않음)
    function resetOtpIfPhoneChanged() {
      if (!state.otp.verified) return;
      if (digitsOf(phoneInput.value) === state.otp.verifiedPhone) return;
      state.otp = { verified: false, token: null, verifiedPhone: null };
      otpRow.style.display = 'none';
      otpCodeInput.value = '';
      phoneInput.disabled = false;
      otpSendBtn.disabled = false; otpSendBtn.textContent = '인증번호 받기';
      setOtpStatus('번호가 바뀌어서 본인확인을 다시 해주세요.', 'err');
    }
    bindOnce(phoneInput, 'input', resetOtpIfPhoneChanged);

    otpSendBtn.onclick = async () => {
      const phone = digitsOf(phoneInput.value);
      if (!isValidPhoneDigits(phone)) {
        setOtpStatus('휴대폰 번호를 다시 확인해주세요 (010-0000-0000 형식).', 'err');
        phoneInput.focus();
        return;
      }
      otpSendBtn.disabled = true; otpSendBtn.textContent = '발송 중...';
      const r = await fnFetch2('send', { phone: phoneInput.value });
      if (!r.ok) {
        otpSendBtn.disabled = false; otpSendBtn.textContent = '인증번호 받기';
        setOtpStatus(r.data?.message || '인증번호 발송에 실패했습니다.', 'err');
        return;
      }
      otpRow.style.display = 'flex';
      otpSendBtn.disabled = false; otpSendBtn.textContent = '재발송';
      setOtpStatus('인증번호를 보냈어요. 5분 이내에 입력해주세요.');
      otpCodeInput.focus();
    };

    otpConfirmBtn.onclick = async () => {
      const phone = digitsOf(phoneInput.value);
      const code = otpCodeInput.value.trim();
      if (!code) { setOtpStatus('인증번호를 입력해주세요.', 'err'); return; }
      otpConfirmBtn.disabled = true; otpConfirmBtn.textContent = '확인 중...';
      const r = await fnFetch2('confirm', { phone: phoneInput.value, code });
      otpConfirmBtn.disabled = false; otpConfirmBtn.textContent = '확인';
      if (!r.ok) {
        setOtpStatus(r.data?.message || '인증번호가 일치하지 않습니다.', 'err');
        return;
      }
      state.otp.verified = true;
      state.otp.token = r.data?.data?.verificationToken || null;
      state.otp.verifiedPhone = phone;
      otpRow.style.display = 'none';
      phoneInput.disabled = true;
      otpSendBtn.disabled = true; otpSendBtn.textContent = '인증완료';
      setOtpStatus('✅ 본인확인이 완료됐어요.', 'ok');
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
    // 휴대폰 본인확인이 안 끝났거나, 인증 이후 번호를 바꿔서 무효화된 경우
    if (!state.otp.verified || state.otp.verifiedPhone !== digitsOf(phone)) {
      msg.textContent = '휴대폰 본인확인을 완료해주세요 ("인증번호 받기" → 확인).';
      return;
    }
    msg.textContent = '';

    btn.disabled = true; btn.textContent = '신청 접수 중...';
    const created = await fnFetch('create', {
      productId: state.productId, quantity: qty, buyerName: name, buyerPhone: phone,
      buyerEmail: email || undefined,
      // 권종(indiv_tickets)이 있는 상품이면 어떤 권종을 골랐는지 서버에 같이 전달
      // (서버가 그 권종의 가격을 다시 조회해서 금액을 확정 — 클라이언트 price는 참고용일 뿐 신뢰하지 않음)
      ticketType: state.indivTickets ? state.indivTickets[state.ticketIndex].type : undefined,
      // 로그인 대신 휴대폰 본인확인으로 구매 (group-deposit-widget.js와 동일 방식)
      verificationToken: state.otp.token, guestPurchase: true,
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
      ${TOSS_CLIENT_KEY.startsWith('test_') ? '<div class=\"hhbw-test-badge\">테스트 결제 모드 · 실제 청구 없음</div>' : ''}
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
            orderName: currentTicketLabel(state),
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
      const confirmed = await confirmOnce(orderId, paymentKey, Number(amount));
      if (confirmed.ok) {
        if (confirmed.data?.data?.deposit === true) {
          // 이 결제는 단체 예약금 주문(HHGroupDepositWidget 담당) — 개인구매 위젯이 처리할
          // 대상이 아니므로 조용히 넘겨서 boot()가 평소 개인구매 화면을 그리도록 함.
          // (2026-09-01 단체 예약금 결제 기능 추가 시, 같은 페이지에 두 위젯이 함께
          //  마운트되는 경우를 위해 추가)
          return false;
        }
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
