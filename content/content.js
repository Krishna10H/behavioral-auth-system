// content.js - BioAuth Content Script
// Captures behavioral biometrics on every page visited

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────
  const state = {
    active: false,
    enrolled: false,
    lastKey: null,
    lastKeyTime: 0,
    keyDownTime: {},
    mousePos: { x: 0, y: 0 },
    mouseHistory: [],
    lastMouseTime: 0,
    clickDownTime: 0,
    charCount: 0,
    backspaceCount: 0,
    sessionStart: Date.now(),
    overlay: null,
    blurActive: false,
    warningCount: 0,
    lastVerification: 0,
    typingBuffer: [],
    mouseBuffer: [],
    sendTimer: null,
    checkTimer: null
  };

  // ─── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    const status = await sendMsg({ type: 'GET_STATUS' });
    if (!status) return;

    state.enrolled = status.enrolled;
    state.active = true;

    if (status.state === 'enrolling' || status.state === 'active') {
      attachListeners();
      startPeriodicCheck();
    }

    // Listen for messages from background/popup
    chrome.runtime.onMessage.addListener(handleExtMsg);
  }

  function handleExtMsg(msg) {
    if (msg.type === 'STATUS_UPDATE') {
      state.enrolled = msg.enrolled;
    }
    if (msg.type === 'FORCE_LOCK') {
      showBlurScreen('Security alert: behavior mismatch', 0);
    }
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────
  function attachListeners() {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  }

  // ─── Keyboard Tracking ───────────────────────────────────────────────────────
  function onKeyDown(e) {
    const now = performance.now();
    const key = e.key;

    state.keyDownTime[key] = now;

    // Track backspace for error rate
    if (key === 'Backspace') {
      state.backspaceCount++;
    } else if (key.length === 1) {
      state.charCount++;
    }

    // Flight time = time between consecutive keydowns
    if (state.lastKeyTime > 0) {
      const flightTime = now - state.lastKeyTime;
      const digraph = (state.lastKey || '') + key;

      if (flightTime > 10 && flightTime < 3000) {
        state.typingBuffer.push({
          type: 'flight',
          flightTime: Math.round(flightTime),
          digraph: digraph.length <= 4 ? digraph : null,
          digraphTime: Math.round(flightTime)
        });
      }
    }

    state.lastKey = key;
    state.lastKeyTime = now;
    scheduleSend();
    pingSession();
  }

  function onKeyUp(e) {
    const now = performance.now();
    const key = e.key;

    if (state.keyDownTime[key]) {
      const dwell = now - state.keyDownTime[key];
      delete state.keyDownTime[key];

      // Typing speed: chars per second over last N chars
      const elapsed = (now - state.sessionStart) / 1000;
      const speed = elapsed > 0 ? state.charCount / elapsed : 0;

      // Error rate: backspace / total chars
      const total = state.charCount + state.backspaceCount;
      const errorRate = total > 0 ? state.backspaceCount / total : 0;

      if (dwell > 10 && dwell < 800) {
        state.typingBuffer.push({
          type: 'dwell',
          dwellTime: Math.round(dwell),
          typingSpeed: Math.round(speed * 10) / 10,
          errorRate: Math.round(errorRate * 100) / 100
        });
      }
    }
  }

  // ─── Mouse Tracking ───────────────────────────────────────────────────────────
  function onMouseMove(e) {
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;

    if (state.lastMouseTime > 0) {
      const dt = now - state.lastMouseTime;
      if (dt > 5 && dt < 200) {
        const dx = x - state.mousePos.x;
        const dy = y - state.mousePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = dist / dt; // px/ms

        // Track history for curvature
        state.mouseHistory.push({ x, y, t: now });
        if (state.mouseHistory.length > 10) state.mouseHistory.shift();

        const curvature = computeCurvature(state.mouseHistory);

        if (speed > 0 && speed < 10) {
          state.mouseBuffer.push({
            type: 'move',
            speed: Math.round(speed * 1000) / 1000,
            curvature: Math.round(curvature * 1000) / 1000
          });
        }
      }
    }

    state.mousePos = { x, y };
    state.lastMouseTime = now;
    pingSession();
  }

  function onMouseDown(e) {
    state.clickDownTime = performance.now();
  }

  function onMouseUp(e) {
    if (state.clickDownTime > 0) {
      const dwell = performance.now() - state.clickDownTime;
      state.clickDownTime = 0;
      if (dwell > 10 && dwell < 2000) {
        state.mouseBuffer.push({ type: 'click', clickDwell: Math.round(dwell) });
      }
    }
  }

  function onScroll() {
    pingSession();
  }

  function onVisibility() {
    if (document.hidden) {
      // user switched tab - log as potential anomaly
    }
  }

  // Compute path curvature from mouse history
  function computeCurvature(history) {
    if (history.length < 3) return 0;
    const first = history[0];
    const last = history[history.length - 1];
    const straightDist = Math.sqrt(
      (last.x - first.x) ** 2 + (last.y - first.y) ** 2
    );
    let pathDist = 0;
    for (let i = 1; i < history.length; i++) {
      const dx = history[i].x - history[i - 1].x;
      const dy = history[i].y - history[i - 1].y;
      pathDist += Math.sqrt(dx * dx + dy * dy);
    }
    if (pathDist === 0) return 0;
    return straightDist / pathDist; // 1 = perfectly straight, <1 = curved
  }

  // ─── Send Samples ─────────────────────────────────────────────────────────────
  function scheduleSend() {
    if (state.sendTimer) return;
    state.sendTimer = setTimeout(flushBuffers, 500);
  }

  async function flushBuffers() {
    state.sendTimer = null;

    if (state.typingBuffer.length === 0 && state.mouseBuffer.length === 0) return;

    // Aggregate typing samples
    let typingData = null;
    const typingSamples = state.typingBuffer.splice(0);
    if (typingSamples.length > 0) {
      const flights = typingSamples.filter(s => s.type === 'flight');
      const dwells = typingSamples.filter(s => s.type === 'dwell');

      if (flights.length > 0) {
        const avgFlight = flights.reduce((s, v) => s + v.flightTime, 0) / flights.length;
        const lastDig = flights[flights.length - 1];
        typingData = {
          flightTime: Math.round(avgFlight),
          digraph: lastDig ? lastDig.digraph : null,
          digraphTime: lastDig ? lastDig.digraphTime : 0
        };
      }

      if (dwells.length > 0) {
        const avgDwell = dwells.reduce((s, v) => s + v.dwellTime, 0) / dwells.length;
        const lastDwell = dwells[dwells.length - 1];
        typingData = {
          ...(typingData || {}),
          dwellTime: Math.round(avgDwell),
          typingSpeed: lastDwell ? lastDwell.typingSpeed : 0,
          errorRate: lastDwell ? lastDwell.errorRate : 0
        };
      }
    }

    // Aggregate mouse samples
    let mouseData = null;
    const mouseSamples = state.mouseBuffer.splice(0);
    if (mouseSamples.length > 0) {
      const moves = mouseSamples.filter(s => s.type === 'move');
      const clicks = mouseSamples.filter(s => s.type === 'click');

      if (moves.length > 0) {
        const avgSpeed = moves.reduce((s, v) => s + v.speed, 0) / moves.length;
        const avgCurv = moves.reduce((s, v) => s + v.curvature, 0) / moves.length;
        mouseData = {
          speed: Math.round(avgSpeed * 1000) / 1000,
          curvature: Math.round(avgCurv * 1000) / 1000
        };
      }

      if (clicks.length > 0) {
        const avgDwell = clicks.reduce((s, v) => s + v.clickDwell, 0) / clicks.length;
        mouseData = { ...(mouseData || {}), clickDwell: Math.round(avgDwell) };
      }
    }

    if (!typingData && !mouseData) return;

    try {
      const result = await sendMsg({
        type: 'BIOMETRIC_SAMPLE',
        data: { typing: typingData, mouse: mouseData }
      });
      handleVerificationResult(result);
    } catch (e) {
      // extension might be reloading
    }
  }

  // ─── Verification Result Handler ──────────────────────────────────────────────
  function handleVerificationResult(result) {
    if (!result) return;

    if (result.state === 'enrolled' && result.action === 'enrolled') {
      showEnrollmentComplete();
      return;
    }

    if (result.action === 'warn') {
      state.warningCount++;
      if (state.warningCount >= 2) {
        showBlurScreen('Behavior mismatch detected', result.score);
      } else {
        showWarningBanner(result.score);
      }
    } else if (result.action === 'lockout') {
      showBlurScreen('Authentication failed - behavior not recognized', result.score);
    } else if (result.action === 'none' && result.verified) {
      // Passed - remove any warnings
      if (state.blurActive && result.score >= 0.72) {
        removeBlur();
      }
      state.warningCount = Math.max(0, state.warningCount - 1);
    }

    if (result.state === 'enrolling') {
      updateEnrollmentProgress(result.progress || 0);
    }
  }

  // ─── Periodic Verification ────────────────────────────────────────────────────
  function startPeriodicCheck() {
    state.checkTimer = setInterval(async () => {
      if (document.hidden) return;
      await flushBuffers();
    }, 2000);
  }

  // ─── UI: Blur Screen ──────────────────────────────────────────────────────────
  function showBlurScreen(message, score) {
    if (state.blurActive) return;
    state.blurActive = true;

    // Blur entire page content
    document.documentElement.style.filter = 'blur(8px)';
    document.documentElement.style.userSelect = 'none';
    document.documentElement.style.pointerEvents = 'none';

    const overlay = document.createElement('div');
    overlay.id = '__bioauth_overlay';
    overlay.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      background: rgba(10, 14, 26, 0.92) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      backdrop-filter: blur(0px) !important;
      pointer-events: all !important;
    `;

    const pct = score > 0 ? Math.round(score * 100) : '?';
    const scoreColor = score < 0.55 ? '#ef4444' : '#f59e0b';

    overlay.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border: 1px solid #334155;
        border-radius: 20px;
        padding: 48px 56px;
        max-width: 480px;
        width: 90%;
        text-align: center;
        box-shadow: 0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(56,189,248,0.1);
        position: relative;
      ">
        <div style="
          width: 72px; height: 72px;
          background: rgba(239,68,68,0.15);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 24px;
          border: 2px solid rgba(239,68,68,0.4);
        ">
          <svg width="36" height="36" fill="none" viewBox="0 0 24 24">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <h2 style="color: #f1f5f9; font-size: 22px; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.3px;">
          Identity Verification Failed
        </h2>

        <p style="color: #94a3b8; font-size: 14px; margin: 0 0 28px; line-height: 1.6;">
          ${message}
        </p>

        <div style="
          background: rgba(15,23,42,0.8);
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span style="color: #64748b; font-size: 13px;">Similarity Score</span>
          <span style="color: ${scoreColor}; font-size: 24px; font-weight: 700;">${pct}%</span>
        </div>

        <p style="color: #64748b; font-size: 13px; margin: 0 0 24px;">
          Your current behavior doesn't match your enrolled profile.<br>
          Continue using the page to re-authenticate.
        </p>

        <button id="__bioauth_dismiss_btn" style="
          background: linear-gradient(135deg, #0ea5e9, #38bdf8);
          color: #0f172a;
          border: none;
          padding: 12px 32px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: opacity 0.2s;
        ">
          I'm the authorized user - Continue
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    state.overlay = overlay;

    document.getElementById('__bioauth_dismiss_btn').addEventListener('click', () => {
      removeBlur();
    });
  }

  function removeBlur() {
    state.blurActive = false;
    state.warningCount = 0;
    document.documentElement.style.filter = '';
    document.documentElement.style.userSelect = '';
    document.documentElement.style.pointerEvents = '';
    const overlay = document.getElementById('__bioauth_overlay');
    if (overlay) overlay.remove();
    const banner = document.getElementById('__bioauth_warning_banner');
    if (banner) banner.remove();
    state.overlay = null;
  }

  // ─── UI: Warning Banner ───────────────────────────────────────────────────────
  function showWarningBanner(score) {
    let banner = document.getElementById('__bioauth_warning_banner');
    if (banner) {
      banner.querySelector('.__bioauth_score').textContent = Math.round(score * 100) + '%';
      return;
    }

    banner = document.createElement('div');
    banner.id = '__bioauth_warning_banner';
    banner.style.cssText = `
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 2147483646 !important;
      background: linear-gradient(135deg, #1e293b, #0f172a) !important;
      border: 1px solid #f59e0b !important;
      border-radius: 12px !important;
      padding: 14px 18px !important;
      max-width: 320px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      animation: __bioauth_slideIn 0.3s ease !important;
    `;

    banner.innerHTML = `
      <style>
        @keyframes __bioauth_slideIn {
          from { transform: translateX(110%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      </style>
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="
          width: 36px; height: 36px; flex-shrink: 0;
          background: rgba(245,158,11,0.15);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid rgba(245,158,11,0.3);
        ">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div style="flex: 1;">
          <div style="color: #fbbf24; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
            Behavior Anomaly Detected
          </div>
          <div style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
            Match score: <span class="__bioauth_score" style="color: #f59e0b; font-weight: 600;">${Math.round(score * 100)}%</span>
            — Keep typing to re-verify
          </div>
        </div>
        <button id="__bioauth_close_banner" style="
          background: none; border: none; color: #475569;
          cursor: pointer; padding: 0; line-height: 1; font-size: 18px;
        ">×</button>
      </div>
    `;

    document.body.appendChild(banner);
    document.getElementById('__bioauth_close_banner').addEventListener('click', () => {
      banner.remove();
    });

    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (document.getElementById('__bioauth_warning_banner')) banner.remove();
    }, 8000);
  }

  // ─── UI: Enrollment Complete ──────────────────────────────────────────────────
  function showEnrollmentComplete() {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 2147483646 !important;
      background: linear-gradient(135deg, #064e3b, #065f46) !important;
      border: 1px solid #10b981 !important;
      border-radius: 12px !important;
      padding: 14px 20px !important;
      max-width: 300px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,185,129,0.2) !important;
      display: flex; gap: 12px; align-items: center !important;
    `;

    toast.innerHTML = `
      <div style="
        width: 36px; height: 36px; flex-shrink: 0;
        background: rgba(16,185,129,0.2);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
      ">
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M20 6L9 17l-5-5" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <div style="color: #6ee7b7; font-size: 13px; font-weight: 600; margin-bottom: 2px;">
          Profile Enrolled!
        </div>
        <div style="color: #a7f3d0; font-size: 12px;">
          BioAuth is now protecting your sessions
        </div>
      </div>
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // ─── Enrollment Progress Indicator ───────────────────────────────────────────
  let progressBadge = null;
  function updateEnrollmentProgress(pct) {
    if (pct >= 100) {
      if (progressBadge) { progressBadge.remove(); progressBadge = null; }
      return;
    }

    if (!progressBadge) {
      progressBadge = document.createElement('div');
      progressBadge.id = '__bioauth_progress';
      progressBadge.style.cssText = `
        position: fixed !important;
        bottom: 24px !important;
        left: 24px !important;
        z-index: 2147483645 !important;
        background: linear-gradient(135deg, #0f172a, #1e293b) !important;
        border: 1px solid #334155 !important;
        border-radius: 12px !important;
        padding: 12px 16px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
        min-width: 200px !important;
      `;
      document.body.appendChild(progressBadge);
    }

    progressBadge.innerHTML = `
      <div style="color: #38bdf8; font-size: 12px; font-weight: 600; margin-bottom: 8px;">
        🔐 Learning your behavior... ${pct}%
      </div>
      <div style="background: #1e293b; border-radius: 4px; height: 4px; overflow: hidden;">
        <div style="
          height: 100%;
          width: ${pct}%;
          background: linear-gradient(90deg, #0ea5e9, #38bdf8);
          border-radius: 4px;
          transition: width 0.4s ease;
        "></div>
      </div>
      <div style="color: #64748b; font-size: 11px; margin-top: 6px;">
        Keep typing normally to enroll
      </div>
    `;
  }

  // ─── Session Ping ─────────────────────────────────────────────────────────────
  let lastPing = 0;
  function pingSession() {
    const now = Date.now();
    if (now - lastPing > 10000) {
      lastPing = now;
      sendMsg({ type: 'SESSION_ACTIVE' }).catch(() => {});
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────────
  function sendMsg(msg) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            res(null);
          } else {
            res(response);
          }
        });
      } catch (e) {
        res(null);
      }
    });
  }

  // ─── Start ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
