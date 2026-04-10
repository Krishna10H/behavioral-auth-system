// popup.js - BioAuth Popup Controller

let currentStatus = null;
let currentConfig = null;
let refreshTimer = null;

// ─── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  refreshTimer = setInterval(loadStatus, 3000);

  document.getElementById('dashboardLink').addEventListener('click', openDashboard);
});

window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

async function loadAll() {
  try {
    currentConfig = await msg({ type: 'GET_CONFIG' });
    await loadStatus();
  } catch (e) {
    renderError(e.message);
  }
}

async function loadStatus() {
  try {
    currentStatus = await msg({ type: 'GET_STATUS' });
    render(currentStatus);
  } catch (e) {
    renderError(e.message);
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────────
function render(status) {
  const content = document.getElementById('mainContent');
  const dot = document.getElementById('statusDot');

  dot.className = 'status-dot';

  if (!status || status.state === 'no_profile') {
    dot.className = 'status-dot';
    content.innerHTML = renderNoProfile();
  } else if (status.state === 'enrolling') {
    dot.className = 'status-dot warning';
    content.innerHTML = renderEnrolling(status);
  } else if (status.state === 'active') {
    dot.className = 'status-dot active';
    content.innerHTML = renderActive(status);
  }

  attachHandlers();
}

function renderError(msg) {
  document.getElementById('mainContent').innerHTML = `
    <div style="padding: 20px; color: #ef4444; font-size: 12px; text-align: center;">
      Error: ${msg}
    </div>
  `;
}

// ─── No Profile State ────────────────────────────────────────────────────────────
function renderNoProfile() {
  return `
    <div class="alert alert-info">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#38bdf8" stroke-width="2"/>
        <path d="M12 8v4m0 4h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>No behavioral profile found. Start enrollment to enable passwordless authentication.</span>
    </div>

    <div class="state-card">
      <div class="state-label">
        <div class="state-icon gray">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="state-title">Not Enrolled</div>
          <div class="state-desc">Click below to start learning your behavior</div>
        </div>
      </div>
    </div>

    <div class="section-label">How it works</div>
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-cell-label">Step 1</div>
        <div class="stat-cell-value" style="font-size: 12px; font-family: var(--sans); color: #94a3b8;">Enroll</div>
        <div style="font-size: 10px; color: #475569; margin-top: 4px;">Type normally on any site for ~30 keystrokes</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Step 2</div>
        <div class="stat-cell-value" style="font-size: 12px; font-family: var(--sans); color: #94a3b8;">Learn</div>
        <div style="font-size: 10px; color: #475569; margin-top: 4px;">AI learns your typing speed & mouse movement</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Step 3</div>
        <div class="stat-cell-value" style="font-size: 12px; font-family: var(--sans); color: #94a3b8;">Protect</div>
        <div style="font-size: 10px; color: #475569; margin-top: 4px;">Continuous background verification</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Step 4</div>
        <div class="stat-cell-value" style="font-size: 12px; font-family: var(--sans); color: #94a3b8;">Alert</div>
        <div style="font-size: 10px; color: #475569; margin-top: 4px;">Blurs screen if someone else is detected</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="btnEnroll">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v16m8-8H4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        Start Enrollment
      </button>
    </div>
  `;
}

// ─── Enrolling State ─────────────────────────────────────────────────────────────
function renderEnrolling(status) {
  const pct = status.progress || 0;
  return `
    <div class="state-card enrolling">
      <div class="state-label">
        <div class="state-icon blue">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <div class="state-title">Learning Your Behavior</div>
          <div class="state-desc">Type naturally on any website to build your profile</div>
        </div>
      </div>

      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="progress-labels">
          <span class="progress-label">Progress</span>
          <span class="progress-label" style="color: #38bdf8;">${pct}%</span>
        </div>
      </div>
    </div>

    <div class="alert alert-info">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#38bdf8" stroke-width="2"/>
        <path d="M12 8v4m0 4h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>Just use your browser normally — search, browse, type. BioAuth will learn your unique patterns automatically.</span>
    </div>

    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-cell-label">Keystrokes</div>
        <div class="stat-cell-value">${status.enrollmentCount || 0}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Required</div>
        <div class="stat-cell-value">30+</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-danger" id="btnReset">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Cancel Enrollment
      </button>
    </div>
  `;
}

// ─── Active State ─────────────────────────────────────────────────────────────────
function renderActive(status) {
  const session = status.session;
  const score = session?.lastScore;
  const scoreDisplay = score !== undefined ? Math.round(score * 100) : '—';
  const scoreColor = score === undefined ? '#94a3b8' : score >= 0.72 ? '#10b981' : score >= 0.55 ? '#f59e0b' : '#ef4444';

  const lastVerified = session?.lastVerified
    ? timeAgo(session.lastVerified)
    : 'Not yet';

  const stats = status.stats;

  // Tab content - main + settings
  return `
    <div class="state-card enrolled">
      <div class="state-label">
        <div class="state-icon green">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div style="flex:1">
          <div class="state-title">Profile Active</div>
          <div class="state-desc">Continuous verification running</div>
        </div>
      </div>

      <div class="score-meter">
        <div class="score-header">
          <span class="score-label">Match Score</span>
          <span class="score-value" style="color: ${scoreColor};">${scoreDisplay}${score !== undefined ? '%' : ''}</span>
        </div>
        <div class="score-bar">
          <div class="score-fill" style="width: ${score !== undefined ? Math.round(score * 100) : 50}%; background: linear-gradient(90deg, ${scoreColor}99, ${scoreColor});"></div>
        </div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="stats">Stats</button>
      <button class="tab" data-tab="settings">Settings</button>
    </div>

    <!-- Overview Tab -->
    <div class="tab-panel active" id="tab-overview">
      <div class="stats-grid">
        <div class="stat-cell">
          <div class="stat-cell-label">Last Check</div>
          <div class="stat-cell-value" style="font-size: 13px; font-family: var(--sans);">${lastVerified}</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell-label">Status</div>
          <div class="stat-cell-value" style="font-size: 13px; font-family: var(--sans); color: ${scoreColor};">
            ${score === undefined ? 'Learning' : score >= 0.72 ? '✓ Verified' : score >= 0.55 ? '⚠ Warning' : '✗ Failed'}
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-secondary" id="btnReEnroll">
          <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Re-Enroll Profile
        </button>
        <button class="btn btn-danger" id="btnReset">
          <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6m4-6v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Delete Profile
        </button>
      </div>
    </div>

    <!-- Stats Tab -->
    <div class="tab-panel" id="tab-stats">
      ${stats ? renderStats(stats) : '<div style="color: #475569; font-size: 12px; text-align: center; padding: 16px;">Stats loading...</div>'}
    </div>

    <!-- Settings Tab -->
    <div class="tab-panel" id="tab-settings">
      ${renderSettings()}
    </div>
  `;
}

function renderStats(stats) {
  const t = stats.typing;
  const m = stats.mouse;
  return `
    <div class="section-label">Typing Profile</div>
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-cell-label">Avg Flight</div>
        <div class="stat-cell-value">${t.flightTime.mean}<span class="stat-cell-unit">ms</span></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Avg Dwell</div>
        <div class="stat-cell-value">${t.dwellTime.mean}<span class="stat-cell-unit">ms</span></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Typing Speed</div>
        <div class="stat-cell-value">${t.speed.mean}<span class="stat-cell-unit">cps</span></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Error Rate</div>
        <div class="stat-cell-value">${Math.round((t.errorRate.mean || 0) * 100)}<span class="stat-cell-unit">%</span></div>
      </div>
    </div>
    <div class="section-label">Mouse Profile</div>
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-cell-label">Avg Speed</div>
        <div class="stat-cell-value">${m.speed.mean}<span class="stat-cell-unit">px/ms</span></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">Click Dwell</div>
        <div class="stat-cell-value">${m.clickDwell.mean || '—'}<span class="stat-cell-unit">${m.clickDwell.mean ? 'ms' : ''}</span></div>
      </div>
    </div>
  `;
}

function renderSettings() {
  const c = currentConfig || {};
  return `
    <div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Verify Threshold</div>
          <div class="setting-desc">Minimum score to pass (0.5-0.99)</div>
        </div>
        <input class="setting-input" type="number" id="setVerify" min="0.5" max="0.99" step="0.01"
          value="${c.verifyThreshold || 0.72}"/>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Warning Threshold</div>
          <div class="setting-desc">Below this shows warning banner</div>
        </div>
        <input class="setting-input" type="number" id="setWarn" min="0.3" max="0.9" step="0.01"
          value="${c.warningThreshold || 0.55}"/>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Typing Weight</div>
          <div class="setting-desc">Importance of typing vs mouse</div>
        </div>
        <input class="setting-input" type="number" id="setTypingW" min="0.1" max="0.9" step="0.05"
          value="${c.typingWeight || 0.65}"/>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Enrollment Samples</div>
          <div class="setting-desc">Keystrokes needed to build profile</div>
        </div>
        <input class="setting-input" type="number" id="setEnroll" min="15" max="100" step="5"
          value="${c.enrollmentSamples || 30}"/>
      </div>
    </div>
    <div class="actions" style="margin-top: 14px;">
      <button class="btn btn-primary" id="btnSaveSettings">
        Save Settings
      </button>
    </div>
    <div id="settingsSaved" style="display:none; text-align:center; color:#10b981; font-size:12px; margin-top: 8px;">
      ✓ Settings saved
    </div>
  `;
}

// ─── Event Handlers ──────────────────────────────────────────────────────────────
function attachHandlers() {
  // Enroll
  const btnEnroll = document.getElementById('btnEnroll');
  if (btnEnroll) {
    btnEnroll.addEventListener('click', async () => {
      btnEnroll.disabled = true;
      btnEnroll.textContent = 'Starting...';
      await msg({ type: 'START_ENROLLMENT' });
      await loadStatus();
    });
  }

  // Re-enroll
  const btnReEnroll = document.getElementById('btnReEnroll');
  if (btnReEnroll) {
    btnReEnroll.addEventListener('click', async () => {
      if (confirm('Re-enroll? Your current profile will be cleared.')) {
        await msg({ type: 'RESET_PROFILE' });
        await msg({ type: 'START_ENROLLMENT' });
        await loadStatus();
      }
    });
  }

  // Reset
  const btnReset = document.getElementById('btnReset');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      if (confirm('Delete your behavioral profile? You will need to re-enroll.')) {
        await msg({ type: 'RESET_PROFILE' });
        await loadStatus();
      }
    });
  }

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('tab-' + tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });

  // Save settings
  const btnSave = document.getElementById('btnSaveSettings');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const newConfig = {
        verifyThreshold: parseFloat(document.getElementById('setVerify').value),
        warningThreshold: parseFloat(document.getElementById('setWarn').value),
        typingWeight: parseFloat(document.getElementById('setTypingW').value),
        mouseWeight: 1 - parseFloat(document.getElementById('setTypingW').value),
        enrollmentSamples: parseInt(document.getElementById('setEnroll').value)
      };
      await msg({ type: 'SAVE_CONFIG', data: newConfig });
      currentConfig = { ...currentConfig, ...newConfig };
      const saved = document.getElementById('settingsSaved');
      if (saved) {
        saved.style.display = 'block';
        setTimeout(() => saved.style.display = 'none', 2000);
      }
    });
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────────
function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
}

// ─── Utilities ────────────────────────────────────────────────────────────────────
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
  return Math.round(diff / 3600) + 'h ago';
}
