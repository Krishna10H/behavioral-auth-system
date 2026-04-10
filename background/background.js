// background.js - BioAuth Service Worker
// Handles profile storage, verification logic, session management

const STORAGE_KEY = 'bioauth_profile';
const SESSION_KEY = 'bioauth_session';
const CONFIG_KEY = 'bioauth_config';

// Default config
const DEFAULT_CONFIG = {
  enrollmentSamples: 30,       // keystrokes needed to build profile
  verifyThreshold: 0.72,       // similarity score to pass (0-1)
  warningThreshold: 0.55,      // below this = warning
  sessionTimeout: 30 * 60,     // 30 min in seconds
  continuousCheckInterval: 60, // check every 60s of activity
  mouseWeight: 0.35,
  typingWeight: 0.65
};

let config = { ...DEFAULT_CONFIG };

// Load config on startup
chrome.storage.local.get([CONFIG_KEY], (res) => {
  if (res[CONFIG_KEY]) config = { ...DEFAULT_CONFIG, ...res[CONFIG_KEY] };
});

// ─── Message Router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'GET_STATUS':
        sendResponse(await getStatus());
        break;

      case 'GET_CONFIG':
        sendResponse(config);
        break;

      case 'SAVE_CONFIG':
        config = { ...DEFAULT_CONFIG, ...msg.data };
        await chrome.storage.local.set({ [CONFIG_KEY]: config });
        sendResponse({ ok: true });
        break;

      case 'BIOMETRIC_SAMPLE': {
        const result = await processSample(msg.data);
        sendResponse(result);
        break;
      }

      case 'START_ENROLLMENT':
        await startEnrollment();
        sendResponse({ ok: true });
        break;

      case 'RESET_PROFILE':
        await resetProfile();
        sendResponse({ ok: true });
        break;

      case 'GET_PROFILE':
        sendResponse(await getProfile());
        break;

      case 'VERIFY_NOW': {
        const r = await verifyNow(msg.data);
        sendResponse(r);
        break;
      }

      case 'SESSION_ACTIVE':
        await updateSession();
        sendResponse({ ok: true });
        break;

      case 'GET_ANALYTICS':
        sendResponse(await getAnalytics());
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();
  return true; // async
});

// ─── Profile Management ────────────────────────────────────────────────────────
async function getProfile() {
  return new Promise((res) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      res(data[STORAGE_KEY] || null);
    });
  });
}

async function saveProfile(profile) {
  return new Promise((res) => {
    chrome.storage.local.set({ [STORAGE_KEY]: profile }, res);
  });
}

async function resetProfile() {
  return new Promise((res) => {
    chrome.storage.local.remove([STORAGE_KEY, SESSION_KEY], res);
  });
}

async function startEnrollment() {
  const profile = {
    state: 'enrolling',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    enrollmentCount: 0,
    // Typing biometrics
    typing: {
      dwellTimes: [],       // how long key is held
      flightTimes: [],      // time between keys
      digraphTimes: {},     // specific key pairs timing
      typingSpeed: [],      // chars per second
      errorRate: [],        // backspace ratio
      burstPatterns: []     // pause/burst rhythm
    },
    // Mouse biometrics
    mouse: {
      speeds: [],           // pixels/ms
      accelerations: [],
      curvatures: [],       // path straightness
      clickDwells: [],      // how long button held
      scrollPatterns: [],
      idleTimes: []
    },
    // Derived stats (set after enrollment)
    stats: null
  };
  await saveProfile(profile);
}

// ─── Sample Processing ─────────────────────────────────────────────────────────
async function processSample(data) {
  let profile = await getProfile();

  if (!profile) {
    return { state: 'no_profile', action: 'none' };
  }

  if (profile.state === 'enrolling') {
    return await processEnrollmentSample(profile, data);
  }

  if (profile.state === 'active') {
    return await processContinuousSample(profile, data);
  }

  return { state: profile.state, action: 'none' };
}

async function processEnrollmentSample(profile, data) {
  // Accumulate typing samples
  if (data.typing) {
    const t = data.typing;
    if (t.dwellTime > 0 && t.dwellTime < 800)
      profile.typing.dwellTimes.push(t.dwellTime);
    if (t.flightTime > 0 && t.flightTime < 2000)
      profile.typing.flightTimes.push(t.flightTime);
    if (t.typingSpeed > 0)
      profile.typing.typingSpeed.push(t.typingSpeed);
    if (t.errorRate !== undefined)
      profile.typing.errorRate.push(t.errorRate);
    if (t.digraph && t.digraphTime > 0 && t.digraphTime < 1500) {
      if (!profile.typing.digraphTimes[t.digraph])
        profile.typing.digraphTimes[t.digraph] = [];
      profile.typing.digraphTimes[t.digraph].push(t.digraphTime);
    }
    profile.enrollmentCount++;
  }

  // Accumulate mouse samples
  if (data.mouse) {
    const m = data.mouse;
    if (m.speed > 0 && m.speed < 5000)
      profile.mouse.speeds.push(m.speed);
    if (m.acceleration !== undefined)
      profile.mouse.accelerations.push(m.acceleration);
    if (m.curvature !== undefined)
      profile.mouse.curvatures.push(m.curvature);
    if (m.clickDwell > 0)
      profile.mouse.clickDwells.push(m.clickDwell);
  }

  profile.updatedAt = Date.now();

  // Check if enrollment is complete
  const typingReady = profile.typing.flightTimes.length >= config.enrollmentSamples;
  const mouseReady = profile.mouse.speeds.length >= 20;

  if (typingReady && mouseReady) {
    profile.state = 'active';
    profile.stats = computeStats(profile);
    await saveProfile(profile);
    await updateSession();
    await logEvent('enrollment_complete', { enrollmentCount: profile.enrollmentCount });
    return { state: 'enrolled', action: 'enrolled', progress: 100 };
  }

  const progress = Math.min(100, Math.round(
    (profile.typing.flightTimes.length / config.enrollmentSamples) * 100
  ));

  await saveProfile(profile);
  return { state: 'enrolling', action: 'enrolling', progress };
}

async function processContinuousSample(profile, data) {
  const session = await getSession();
  if (!session) {
    await updateSession();
    return { state: 'active', action: 'none' };
  }

  // Only run verification periodically and when enough new data
  session.sampleCount = (session.sampleCount || 0) + 1;
  await saveSession(session);

  if (session.sampleCount % 15 !== 0) {
    return { state: 'active', action: 'none', score: session.lastScore || 1.0 };
  }

  return await verifyNow(data);
}

// ─── Verification Engine ───────────────────────────────────────────────────────
async function verifyNow(data) {
  const profile = await getProfile();
  if (!profile || profile.state !== 'active') {
    return { state: 'no_profile', action: 'none', score: 0 };
  }

  const score = computeSimilarityScore(profile, data);
  const session = await getSession() || {};
  session.lastScore = score;
  session.lastVerified = Date.now();
  await saveSession(session);

  await logEvent('verification', { score, passed: score >= config.verifyThreshold });

  if (score >= config.verifyThreshold) {
    return { state: 'active', action: 'none', score, verified: true };
  } else if (score >= config.warningThreshold) {
    return { state: 'active', action: 'warn', score, verified: false };
  } else {
    return { state: 'active', action: 'lockout', score, verified: false };
  }
}

function computeSimilarityScore(profile, data) {
  const stats = profile.stats;
  if (!stats) return 0.5;

  let typingScore = 0.5;
  let mouseScore = 0.5;
  let typingWeight = 0;
  let mouseWeight = 0;

  // ── Typing Score ──
  if (data.typing) {
    const t = data.typing;
    const scores = [];

    if (t.flightTime > 0 && stats.typing.flightTime.mean > 0) {
      const s = gaussianSimilarity(t.flightTime, stats.typing.flightTime.mean, stats.typing.flightTime.std);
      scores.push(s * 0.4);
    }
    if (t.dwellTime > 0 && stats.typing.dwellTime.mean > 0) {
      const s = gaussianSimilarity(t.dwellTime, stats.typing.dwellTime.mean, stats.typing.dwellTime.std);
      scores.push(s * 0.3);
    }
    if (t.typingSpeed > 0 && stats.typing.speed.mean > 0) {
      const s = gaussianSimilarity(t.typingSpeed, stats.typing.speed.mean, stats.typing.speed.std);
      scores.push(s * 0.3);
    }

    if (scores.length > 0) {
      typingScore = scores.reduce((a, b) => a + b, 0);
      typingWeight = config.typingWeight;
    }
  }

  // ── Mouse Score ──
  if (data.mouse && stats.mouse.speed.mean > 0) {
    const m = data.mouse;
    const scores = [];

    if (m.speed > 0) {
      const s = gaussianSimilarity(m.speed, stats.mouse.speed.mean, stats.mouse.speed.std);
      scores.push(s * 0.5);
    }
    if (m.curvature !== undefined && stats.mouse.curvature.mean !== undefined) {
      const s = gaussianSimilarity(m.curvature, stats.mouse.curvature.mean, stats.mouse.curvature.std);
      scores.push(s * 0.3);
    }
    if (m.clickDwell > 0 && stats.mouse.clickDwell.mean > 0) {
      const s = gaussianSimilarity(m.clickDwell, stats.mouse.clickDwell.mean, stats.mouse.clickDwell.std);
      scores.push(s * 0.2);
    }

    if (scores.length > 0) {
      mouseScore = scores.reduce((a, b) => a + b, 0);
      mouseWeight = config.mouseWeight;
    }
  }

  // Weighted combination
  const totalWeight = typingWeight + mouseWeight;
  if (totalWeight === 0) return 0.5;

  const combined = (typingScore * typingWeight + mouseScore * mouseWeight) / totalWeight;
  return Math.max(0, Math.min(1, combined));
}

// Gaussian similarity: returns 0-1 how close val is to mean given std deviation
function gaussianSimilarity(val, mean, std) {
  if (std < 1) std = mean * 0.2 || 50; // fallback std
  const z = (val - mean) / std;
  return Math.exp(-0.5 * z * z);
}

// ─── Stats Computation ─────────────────────────────────────────────────────────
function computeStats(profile) {
  return {
    typing: {
      flightTime: computeDistribution(profile.typing.flightTimes),
      dwellTime: computeDistribution(profile.typing.dwellTimes),
      speed: computeDistribution(profile.typing.typingSpeed),
      errorRate: computeDistribution(profile.typing.errorRate)
    },
    mouse: {
      speed: computeDistribution(profile.mouse.speeds),
      acceleration: computeDistribution(profile.mouse.accelerations),
      curvature: computeDistribution(profile.mouse.curvatures),
      clickDwell: computeDistribution(profile.mouse.clickDwells)
    }
  };
}

function computeDistribution(arr) {
  if (!arr || arr.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  // Remove outliers (keep within 2 std)
  const sorted = [...arr].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const filtered = sorted.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);

  const mean = filtered.reduce((s, v) => s + v, 0) / filtered.length;
  const variance = filtered.reduce((s, v) => s + (v - mean) ** 2, 0) / filtered.length;
  const std = Math.sqrt(variance);
  return { mean: Math.round(mean), std: Math.round(std), min: filtered[0], max: filtered[filtered.length - 1] };
}

// ─── Session Management ────────────────────────────────────────────────────────
async function getSession() {
  return new Promise((res) => {
    chrome.storage.session.get([SESSION_KEY], (data) => {
      res(data[SESSION_KEY] || null);
    });
  });
}

async function saveSession(session) {
  return new Promise((res) => {
    chrome.storage.session.set({ [SESSION_KEY]: session }, res);
  });
}

async function updateSession() {
  const existing = await getSession() || {};
  await saveSession({
    ...existing,
    lastActivity: Date.now(),
    active: true,
    sampleCount: existing.sampleCount || 0
  });
}

async function getStatus() {
  const profile = await getProfile();
  const session = await getSession();

  if (!profile) {
    return { state: 'no_profile', enrolled: false, session: null };
  }

  let progress = 0;
  if (profile.state === 'enrolling') {
    const fp = await getProfile();
    progress = Math.min(100, Math.round(
      ((fp.typing.flightTimes.length || 0) / config.enrollmentSamples) * 100
    ));
  }

  return {
    state: profile.state,
    enrolled: profile.state === 'active',
    enrollmentCount: profile.enrollmentCount || 0,
    progress,
    stats: profile.stats,
    session: session ? {
      active: session.active,
      lastScore: session.lastScore,
      lastVerified: session.lastVerified,
      lastActivity: session.lastActivity
    } : null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

// ─── Analytics / Event Log ────────────────────────────────────────────────────
async function logEvent(type, data) {
  return new Promise((res) => {
    chrome.storage.local.get(['bioauth_events'], (stored) => {
      const events = stored['bioauth_events'] || [];
      events.push({ type, data, timestamp: Date.now() });
      // keep last 500 events
      const trimmed = events.slice(-500);
      chrome.storage.local.set({ bioauth_events: trimmed }, res);
    });
  });
}

async function getAnalytics() {
  return new Promise((res) => {
    chrome.storage.local.get(['bioauth_events'], (stored) => {
      const events = stored['bioauth_events'] || [];
      const verifications = events.filter(e => e.type === 'verification');
      const scores = verifications.map(e => e.data.score);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const failed = verifications.filter(e => !e.data.passed).length;
      res({
        totalVerifications: verifications.length,
        averageScore: Math.round(avg * 100) / 100,
        failedVerifications: failed,
        recentEvents: events.slice(-20).reverse()
      });
    });
  });
}

// ─── Alarm for session timeout ─────────────────────────────────────────────────
chrome.alarms.create('sessionCheck', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sessionCheck') {
    const session = await getSession();
    if (session && session.lastActivity) {
      const elapsed = (Date.now() - session.lastActivity) / 1000;
      if (elapsed > config.sessionTimeout) {
        await saveSession({ active: false, expired: true, lastActivity: session.lastActivity });
      }
    }
  }
});
