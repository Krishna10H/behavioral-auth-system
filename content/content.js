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

    if (key === 'Backspace') {
      state.backspaceCount++;
    } else if (key.length === 1) {
      state.charCount++;
    }

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

      const elapsed = (now - state.sessionStart) / 1000;
      const speed = elapsed > 0 ? state.charCount / elapsed : 0;

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
        const speed = dist / dt;

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
      // anomaly handling could go here
    }
  }

  function computeCurvature(history) {
    if (history.length < 3) return 0;
    const first = history[0];
    const last = history[history.length - 1];
    const straightDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
    let pathDist = 0;
    for (let i = 1; i < history.length; i++) {
      const dx = history[i].x - history[i - 1].x;
      const dy = history[i].y - history[i - 1].y;
      pathDist += Math.sqrt(dx * dx + dy * dy);
    }
    if (pathDist === 0) return 0;
    return straightDist / pathDist;
  }

  // ─── Send Samples & Learning System ───────────────────────────────────────────
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

      let allTimings = [];

      if (flights.length > 0) {
        const avgFlight = flights.reduce((s, v) => s + v.flightTime, 0) / flights.length;
        const lastDig = flights[flights.length - 1];

        allTimings.push(...flights.map(f => f.flightTime));

        typingData = {
          flightTime: Math.round(avgFlight),
          digraph: lastDig ? lastDig.digraph : null,
          digraphTime: lastDig ? lastDig.digraphTime : 0
        };
      }

      if (dwells.length > 0) {
        const avgDwell = dwells.reduce((s, v) => s + v.dwellTime, 0) / dwells.length;
        const lastDwell = dwells[dwells.length - 1];

        allTimings.push(...dwells.map(d => d.dwellTime));

        typingData = {
          ...(typingData || {}),
          dwellTime: Math.round(avgDwell),
          typingSpeed: lastDwell ? lastDwell.typingSpeed : 0,
          errorRate: lastDwell ? lastDwell.errorRate : 0
        };
      }

      // 🔥 NEW: LEARNING + AUTH SYSTEM
      if (allTimings.length >= 15) {
        chrome.storage.local.get(["userPattern", "loginLogs"], (res) => {
          let saved = res.userPattern;

          // 🧠 TRAIN FIRST TIME
          if (!saved) {
            chrome.storage.local.set({ userPattern: allTimings });
            console.log("✅ Learning complete");
          } else {
            // 🧠 COMPARE
            let diff = 0;
            for (let i = 0; i < Math.min(saved.length, allTimings.length); i++) {
              diff += Math.abs(saved[i] - allTimings[i]);
            }

            let score = diff / saved.length;
            let result = score < 80 ? "Accepted" : "Rejected";

            console.log("Auth:", result, "Score:", score);

            let logs = res.loginLogs || [];
            logs.push({
              score: score.toFixed(2),
              result: result,
              time: new Date().toLocaleTimeString()
            });

            chrome.storage.local.set({ loginLogs: logs });
          }
        });
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
      // catch potential runtime errors
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
      if (state.blurActive && result.score >= 0.72) removeBlur();
      state.warningCount = Math.max(0, state.warningCount - 1);
    }
    if (result.state === 'enrolling') updateEnrollmentProgress(result.progress || 0);
  }

  // ─── Periodic Verification ────────────────────────────────────────────────────
  function startPeriodicCheck() {
    state.checkTimer = setInterval(async () => {
      if (document.hidden) return;
      await flushBuffers();
    }, 2000);
  }

  // ─── UI Components ────────────────────────────────────────────────────────────
  function showBlurScreen(message, score) {
    if (state.blurActive) return;
    state.blurActive = true;
    document.documentElement.style.filter = 'blur(8px)';
    document.documentElement.style.userSelect = 'none';
    document.documentElement.style.pointerEvents = 'none';

    const overlay = document.createElement('div');
    overlay.id = '__bioauth_overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: rgba(10, 14, 26, 0.92); display: flex; align-items: center; justify-content: center; font-family: sans-serif; pointer-events: all;`;
    
    const pct = score > 0 ? Math.round(score * 100) : '?';
    overlay.innerHTML = `<div style="background: #1e293b; padding: 40px; border-radius: 20px; text-align: center; color: white;">
      <h2>Identity Verification Failed</h2>
      <p>${message}</p>
      <div style="font-size: 24px; margin: 20px 0;">Score: ${pct}%</div>
      <button id="__bioauth_dismiss_btn" style="padding: 10px 20px; cursor: pointer;">Continue</button>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById('__bioauth_dismiss_btn').onclick = removeBlur;
  }

  function removeBlur() {
    state.blurActive = false;
    state.warningCount = 0;
    document.documentElement.style.filter = '';
    document.documentElement.style.userSelect = '';
    document.documentElement.style.pointerEvents = '';
    const o = document.getElementById('__bioauth_overlay');
    if (o) o.remove();
  }

  function showWarningBanner(score) {
    let banner = document.createElement('div');
    banner.id = '__bioauth_warning_banner';
    banner.style.cssText = `position: fixed; top: 16px; right: 16px; z-index: 2147483646; background: #1e293b; color: #fbbf24; padding: 15px; border-radius: 8px; border: 1px solid #f59e0b;`;
    banner.innerHTML = `Anomaly Detected (${Math.round(score * 100)}%) - Keep typing.`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }

  function showEnrollmentComplete() {
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; bottom: 24px; right: 24px; background: #065f46; color: white; padding: 15px; border-radius: 8px;`;
    toast.innerText = "Profile Enrolled Successfully!";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function updateEnrollmentProgress(pct) {
    let pb = document.getElementById('__bioauth_progress');
    if (!pb) {
      pb = document.createElement('div');
      pb.id = '__bioauth_progress';
      pb.style.cssText = `position: fixed; bottom: 24px; left: 24px; background: #1e293b; color: #38bdf8; padding: 10px; border-radius: 8px;`;
      document.body.appendChild(pb);
    }
    pb.innerText = `Learning behavior... ${pct}%`;
    if (pct >= 100) pb.remove();
  }

  function pingSession() {
    const now = Date.now();
    if (now - (state.lastPing || 0) > 10000) {
      state.lastPing = now;
      sendMsg({ type: 'SESSION_ACTIVE' }).catch(() => {});
    }
  }

  function sendMsg(msg) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? null : r));
      } catch (e) { res(null); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
