// dashboard.js - BioAuth Dashboard

let refreshTimer = null;
let scoreHistory = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadDashboard();
  refreshTimer = setInterval(loadDashboard, 5000);
});

async function loadDashboard() {
  try {
    const [status, analytics] = await Promise.all([
      msg({ type: 'GET_STATUS' }),
      msg({ type: 'GET_ANALYTICS' })
    ]);
    renderDashboard(status, analytics);
  } catch (e) {
    document.getElementById('dashContent').innerHTML = `
      <div style="text-align:center; padding:48px; color:#ef4444;">
        Error loading dashboard: ${e.message}
      </div>
    `;
  }
}

function renderDashboard(status, analytics) {
  const enrolled = status && status.enrolled;
  const badge = document.getElementById('navBadge');

  if (enrolled) {
    badge.className = 'nav-badge active';
    badge.textContent = '● ACTIVE';
  } else {
    badge.className = 'nav-badge inactive';
    badge.textContent = status?.state === 'enrolling' ? '◎ ENROLLING' : '○ NOT ENROLLED';
  }

  if (!status || status.state === 'no_profile') {
    renderNotEnrolled();
    return;
  }

  if (status.state === 'enrolling') {
    renderEnrolling(status);
    return;
  }

  renderActive(status, analytics);
}

// ─── Not Enrolled View ────────────────────────────────────────────────────────
function renderNotEnrolled() {
  document.getElementById('dashContent').innerHTML = `
    <h1 class="page-title">Welcome to BioAuth</h1>
    <p class="page-subtitle">Passwordless authentication using your unique behavioral patterns</p>

    <div class="enroll-steps">
      <div class="enroll-step active">
        <span class="step-icon">⌨️</span>
        <div class="step-num">STEP 1</div>
        <div class="step-name">Start Enrollment</div>
      </div>
      <div class="enroll-step">
        <span class="step-icon">🧠</span>
        <div class="step-num">STEP 2</div>
        <div class="step-name">Learn Patterns</div>
      </div>
      <div class="enroll-step">
        <span class="step-icon">🔐</span>
        <div class="step-num">STEP 3</div>
        <div class="step-name">Auto-Protect</div>
      </div>
      <div class="enroll-step">
        <span class="step-icon">🚨</span>
        <div class="step-num">STEP 4</div>
        <div class="step-name">Alert on Mismatch</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          What BioAuth Tracks
        </div>
        <div class="card-subtitle">Behavioral signals captured in real-time</div>
        <div class="stat-row">
          <span class="stat-row-label">⌨️ Key dwell time</span>
          <span class="stat-row-value" style="color:#38bdf8">Typing</span>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">⌨️ Key flight time</span>
          <span class="stat-row-value" style="color:#38bdf8">Typing</span>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">⌨️ Typing speed (CPS)</span>
          <span class="stat-row-value" style="color:#38bdf8">Typing</span>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">🖱️ Mouse movement speed</span>
          <span class="stat-row-value" style="color:#10b981">Mouse</span>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">🖱️ Path curvature</span>
          <span class="stat-row-value" style="color:#10b981">Mouse</span>
        </div>
        <div class="stat-row">
          <span class="stat-row-label">🖱️ Click dwell time</span>
          <span class="stat-row-value" style="color:#10b981">Mouse</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          How Verification Works
        </div>
        <div class="card-subtitle">Gaussian similarity matching</div>
        <div style="margin-top: 8px;">
          <div class="stat-row">
            <span class="stat-row-label">Typing weight</span>
            <span class="stat-row-value">65<span class="stat-row-unit">%</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Mouse weight</span>
            <span class="stat-row-value">35<span class="stat-row-unit">%</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Pass threshold</span>
            <span class="stat-row-value" style="color:#10b981">72<span class="stat-row-unit">%</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Warning threshold</span>
            <span class="stat-row-value" style="color:#f59e0b">55<span class="stat-row-unit">%</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Below warning</span>
            <span class="stat-row-value" style="color:#ef4444">Screen Blur</span>
          </div>
        </div>
      </div>
    </div>

    <div style="text-align:center; margin-top: 16px;">
      <button class="btn btn-primary" onclick="startEnroll()">
        Start Enrollment Now
      </button>
    </div>
  `;
}

// ─── Enrolling View ───────────────────────────────────────────────────────────
function renderEnrolling(status) {
  const pct = status.progress || 0;
  document.getElementById('dashContent').innerHTML = `
    <h1 class="page-title">Building Your Profile</h1>
    <p class="page-subtitle">BioAuth is learning your unique behavioral patterns</p>

    <div class="alert-box info">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink:0; margin-top:1px;">
        <circle cx="12" cy="12" r="10" stroke="#38bdf8" stroke-width="2"/>
        <path d="M12 8v4m0 4h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <div>
        <div class="alert-title">Enrollment in Progress</div>
        <div class="alert-text">
          Just use your browser normally — search Google, browse websites, type in forms.
          BioAuth silently captures your patterns in the background. No special action needed.
        </div>
      </div>
    </div>

    <div class="metrics-row">
      <div class="metric-card blue">
        <div class="metric-label">Progress</div>
        <div class="metric-value">${pct}<span style="font-size:18px;">%</span></div>
        <div class="metric-sub">Enrollment completion</div>
      </div>
      <div class="metric-card green">
        <div class="metric-label">Keystrokes</div>
        <div class="metric-value">${status.enrollmentCount || 0}</div>
        <div class="metric-sub">Captured so far</div>
      </div>
      <div class="metric-card yellow">
        <div class="metric-label">Required</div>
        <div class="metric-value">30+</div>
        <div class="metric-sub">Keystrokes needed</div>
      </div>
      <div class="metric-card purple">
        <div class="metric-label">Status</div>
        <div class="metric-value" style="font-size: 20px; color: #38bdf8;">Learning</div>
        <div class="metric-sub">Actively capturing</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Enrollment Progress</div>
      <div class="card-subtitle">Progress updates as you type on any website</div>
      <div style="background: #111827; border-radius: 8px; height: 12px; overflow: hidden; margin-bottom: 8px;">
        <div style="height: 100%; width: ${pct}%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius: 8px; transition: width 0.5s ease;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #475569; font-family: monospace;">
        <span>0%</span>
        <span style="color: #38bdf8; font-weight: 600;">${pct}% complete</span>
        <span>100%</span>
      </div>
    </div>

    <div style="text-align:center; margin-top: 20px;">
      <button class="btn btn-danger" onclick="resetProfile()">Cancel Enrollment</button>
    </div>
  `;
}

// ─── Active View ──────────────────────────────────────────────────────────────
function renderActive(status, analytics) {
  const session = status.session || {};
  const score = session.lastScore;
  const scoreDisplay = score !== undefined ? Math.round(score * 100) : '—';
  const scoreColor = score === undefined ? '#94a3b8' : score >= 0.72 ? '#10b981' : score >= 0.55 ? '#f59e0b' : '#ef4444';
  const stats = status.stats;

  // Track score history for mini chart
  if (score !== undefined) {
    scoreHistory.push({ score, time: Date.now() });
    if (scoreHistory.length > 20) scoreHistory.shift();
  }

  // Events for table
  const events = analytics?.recentEvents || [];
  const verifications = events.filter(e => e.type === 'verification').slice(0, 8);

  const enrolled = new Date(status.createdAt || Date.now()).toLocaleDateString();
  const lastUpdated = timeAgo(status.updatedAt || Date.now());

  document.getElementById('dashContent').innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="page-title">Security Dashboard</h1>
        <p class="page-subtitle">Real-time behavioral biometrics monitoring
          <span class="live-indicator">
            <span class="live-dot"></span>
            LIVE
          </span>
        </p>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" onclick="loadDashboard()">↻ Refresh</button>
        <button class="btn btn-danger" onclick="resetProfile()">Reset Profile</button>
      </div>
    </div>

    <!-- Metrics -->
    <div class="metrics-row">
      <div class="metric-card blue">
        <div class="metric-label">Current Score</div>
        <div class="metric-value" style="color: ${scoreColor};">${scoreDisplay}${score !== undefined ? '%' : ''}</div>
        <div class="metric-sub">${score === undefined ? 'No checks yet' : score >= 0.72 ? '✓ Verified' : score >= 0.55 ? '⚠ Warning' : '✗ Anomaly'}</div>
      </div>
      <div class="metric-card green">
        <div class="metric-label">Avg Score</div>
        <div class="metric-value">${analytics?.averageScore !== undefined ? Math.round(analytics.averageScore * 100) : '—'}${analytics?.averageScore !== undefined ? '%' : ''}</div>
        <div class="metric-sub">Over all sessions</div>
      </div>
      <div class="metric-card yellow">
        <div class="metric-label">Total Checks</div>
        <div class="metric-value">${analytics?.totalVerifications || 0}</div>
        <div class="metric-sub">Verifications run</div>
      </div>
      <div class="metric-card purple">
        <div class="metric-label">Anomalies</div>
        <div class="metric-value" style="${(analytics?.failedVerifications || 0) > 0 ? 'color:#ef4444' : ''}">${analytics?.failedVerifications || 0}</div>
        <div class="metric-sub">Failed checks</div>
      </div>
    </div>

    <div class="two-col">
      <!-- Score Gauge -->
      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Authentication Status
        </div>
        <div class="card-subtitle">Current session verification</div>

        <div class="gauge-wrap">
          ${renderGaugeSVG(score)}
          <div class="gauge-value" style="color: ${scoreColor};">${scoreDisplay}${score !== undefined ? '%' : ''}</div>
          <div class="gauge-label">${score === undefined ? 'Collecting data...' : score >= 0.72 ? 'IDENTITY VERIFIED' : score >= 0.55 ? 'ANOMALY WARNING' : 'IDENTITY MISMATCH'}</div>
        </div>

        <div style="display: flex; justify-content: space-around; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border);">
          <div style="text-align: center;">
            <div style="font-size: 10px; color: var(--text3); font-family: monospace; margin-bottom: 4px;">PASS</div>
            <div style="font-size: 15px; font-weight: 700; color: #10b981; font-family: monospace;">≥72%</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 10px; color: var(--text3); font-family: monospace; margin-bottom: 4px;">WARN</div>
            <div style="font-size: 15px; font-weight: 700; color: #f59e0b; font-family: monospace;">55-71%</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 10px; color: var(--text3); font-family: monospace; margin-bottom: 4px;">FAIL</div>
            <div style="font-size: 15px; font-weight: 700; color: #ef4444; font-family: monospace;">&lt;55%</div>
          </div>
        </div>
      </div>

      <!-- Profile Stats -->
      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Your Behavioral Profile
        </div>
        <div class="card-subtitle">Enrolled: ${enrolled} · Updated: ${lastUpdated}</div>

        ${stats ? `
        <div style="margin-bottom: 14px;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text3); font-family: monospace; margin-bottom: 8px;">⌨️ TYPING</div>
          <div class="stat-row">
            <span class="stat-row-label">Key flight time (mean)</span>
            <span class="stat-row-value">${stats.typing.flightTime.mean}<span class="stat-row-unit">ms ±${stats.typing.flightTime.std}</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Key dwell time (mean)</span>
            <span class="stat-row-value">${stats.typing.dwellTime.mean}<span class="stat-row-unit">ms ±${stats.typing.dwellTime.std}</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Typing speed</span>
            <span class="stat-row-value">${stats.typing.speed.mean}<span class="stat-row-unit">cps</span></span>
          </div>
        </div>
        <div>
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text3); font-family: monospace; margin-bottom: 8px;">🖱️ MOUSE</div>
          <div class="stat-row">
            <span class="stat-row-label">Movement speed (mean)</span>
            <span class="stat-row-value">${stats.mouse.speed.mean}<span class="stat-row-unit">px/ms</span></span>
          </div>
          <div class="stat-row">
            <span class="stat-row-label">Click dwell time</span>
            <span class="stat-row-value">${stats.mouse.clickDwell.mean || '—'}<span class="stat-row-unit">${stats.mouse.clickDwell.mean ? 'ms' : ''}</span></span>
          </div>
        </div>
        ` : '<div style="color: var(--text3); font-size: 13px; text-align: center; padding: 20px;">No profile stats yet</div>'}
      </div>
    </div>

    <!-- Score History Chart -->
    ${scoreHistory.length > 1 ? `
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-title">Score History</div>
      <div class="card-subtitle">Recent verification scores (last ${scoreHistory.length} checks)</div>
      <div class="chart-wrap" id="scoreChart">
        ${renderScoreChart()}
      </div>
    </div>
    ` : ''}

    <!-- Event Log -->
    <div class="card">
      <div class="card-title">
        <svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Verification Log
      </div>
      <div class="card-subtitle">Recent authentication checks</div>

      ${verifications.length > 0 ? `
      <table class="event-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Score</th>
            <th>Result</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${verifications.map(e => {
            const s = e.data.score;
            const pct = Math.round(s * 100);
            const passed = e.data.passed;
            const warn = s >= 0.55 && !passed;
            const fail = s < 0.55;
            return `
              <tr>
                <td style="color: #475569; font-family: monospace;">${timeAgo(e.timestamp)}</td>
                <td>
                  <span class="score-pill ${passed ? 'pass' : warn ? 'warn' : 'fail'}">${pct}%</span>
                </td>
                <td style="color: ${passed ? '#10b981' : warn ? '#f59e0b' : '#ef4444'}">
                  ${passed ? '✓ Pass' : warn ? '⚠ Warning' : '✗ Failed'}
                </td>
                <td style="color: #475569; font-size: 11px; font-family: monospace;">
                  ${passed ? 'none' : fail ? 'screen blur' : 'banner shown'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ` : `
        <div style="text-align: center; padding: 32px; color: #475569; font-size: 13px;">
          No verifications yet — start typing on any website
        </div>
      `}
    </div>
  `;
}

// ─── Gauge SVG ────────────────────────────────────────────────────────────────
function renderGaugeSVG(score) {
  const pct = score !== undefined ? score : 0;
  const angle = pct * 180 - 90; // -90 to +90 degrees
  const rad = (angle * Math.PI) / 180;
  const cx = 100, cy = 100, r = 75;
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);

  const color = score === undefined ? '#475569' : score >= 0.72 ? '#10b981' : score >= 0.55 ? '#f59e0b' : '#ef4444';

  return `
    <svg class="gauge-svg" viewBox="0 0 200 110">
      <!-- Background arc -->
      <path d="M 25 100 A 75 75 0 0 1 175 100" fill="none" stroke="#1e293b" stroke-width="12" stroke-linecap="round"/>
      <!-- Red zone -->
      <path d="M 25 100 A 75 75 0 0 1 72 34" fill="none" stroke="rgba(239,68,68,0.3)" stroke-width="12" stroke-linecap="round"/>
      <!-- Yellow zone -->
      <path d="M 72 34 A 75 75 0 0 1 127 34" fill="none" stroke="rgba(245,158,11,0.3)" stroke-width="12" stroke-linecap="round"/>
      <!-- Green zone -->
      <path d="M 127 34 A 75 75 0 0 1 175 100" fill="none" stroke="rgba(16,185,129,0.3)" stroke-width="12" stroke-linecap="round"/>
      <!-- Fill arc -->
      ${pct > 0 ? `<path d="M 25 100 A 75 75 0 0 1 ${nx} ${ny}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>` : ''}
      <!-- Needle -->
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="#060a14"/>
    </svg>
  `;
}

// ─── Score Chart ──────────────────────────────────────────────────────────────
function renderScoreChart() {
  if (scoreHistory.length === 0) return '';

  const maxScore = 1.0;
  return scoreHistory.map((entry, i) => {
    const heightPct = Math.max(4, Math.round(entry.score * 100));
    const color = entry.score >= 0.72 ? '#10b981' : entry.score >= 0.55 ? '#f59e0b' : '#ef4444';
    const t = new Date(entry.time);
    const label = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="height: ${heightPct}%; background: ${color}; opacity: ${0.4 + (i / scoreHistory.length) * 0.6};"
          title="${Math.round(entry.score * 100)}% at ${label}"></div>
        <div class="chart-bar-label">${label}</div>
      </div>
    `;
  }).join('');
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function startEnroll() {
  await msg({ type: 'START_ENROLLMENT' });
  await loadDashboard();
}

async function resetProfile() {
  if (confirm('Are you sure? This will delete your behavioral profile and you will need to re-enroll.')) {
    await msg({ type: 'RESET_PROFILE' });
    scoreHistory = [];
    await loadDashboard();
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function msg(message) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        rej(new Error(chrome.runtime.lastError.message));
      } else {
        res(response);
      }
    });
  });
}

function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return Math.round(diff) + 's ago';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  return Math.round(diff / 86400) + 'd ago';
}
