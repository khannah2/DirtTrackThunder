/**
 * Online leaderboard + head-to-head client
 * Uses Netlify Functions when available; falls back to localStorage.
 */

const LOCAL_SCORES_KEY = "dtt_local_scores_v1";
/** Netlify function entry (also works via /api/* redirect) */
const API_FN = "/.netlify/functions/api";

function formatTime(t) {
  if (t == null || !isFinite(t)) return "--:--.--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * @param {string} path  e.g. "scores", "scores?trackId=unoh", "h2h?code=AB12"
 */
async function api(path, opts = {}) {
  const [base, qs] = path.split("?");
  const params = new URLSearchParams(qs || "");
  params.set("path", base.replace(/^\//, ""));
  const url = `${API_FN}?${params.toString()}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- Local scores fallback ----------
function loadLocalScores() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SCORES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalScores(list) {
  localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(list.slice(0, 100)));
}

function addLocalScore(entry) {
  const list = loadLocalScores();
  list.push({
    ...entry,
    id: entry.id || `local_${Date.now()}`,
    at: entry.at || Date.now(),
    local: true,
  });
  list.sort((a, b) => a.time - b.time);
  saveLocalScores(list);
  return list;
}

// ---------- Public API ----------
export async function fetchLeaderboard({ trackId = "", limit = 20 } = {}) {
  try {
    const q = new URLSearchParams();
    if (trackId) q.set("trackId", trackId);
    q.set("limit", String(limit));
    const data = await api(`scores?${q}`);
    return { ok: true, online: true, scores: data.scores || [] };
  } catch (err) {
    let list = loadLocalScores();
    if (trackId) list = list.filter((s) => s.trackId === trackId);
    list.sort((a, b) => a.time - b.time);
    return {
      ok: true,
      online: false,
      scores: list.slice(0, limit),
      error: err.message,
    };
  }
}

export async function submitScore(entry) {
  // Always keep a local copy
  addLocalScore(entry);
  try {
    const data = await api("scores", { method: "POST", body: entry });
    return { ok: true, online: true, rank: data.rank, score: data.score };
  } catch (err) {
    const list = loadLocalScores()
      .filter((s) => !entry.trackId || s.trackId === entry.trackId)
      .sort((a, b) => a.time - b.time);
    const rank = list.findIndex((s) => s.time === entry.time && s.name === entry.name) + 1;
    return { ok: true, online: false, rank: rank || list.length, error: err.message };
  }
}

export async function createH2HRoom({ hostName, trackId, trackName, laps }) {
  return api("h2h", {
    method: "POST",
    body: { action: "create", hostName, trackId, trackName, laps },
  });
}

export async function joinH2HRoom({ code, guestName }) {
  return api("h2h", {
    method: "POST",
    body: { action: "join", code, guestName },
  });
}

export async function setH2HReady({ code, role, ready = true }) {
  return api("h2h", {
    method: "POST",
    body: { action: "ready", code, role, ready },
  });
}

export async function getH2HRoom(code) {
  return api(`h2h?code=${encodeURIComponent(code)}`);
}

export async function finishH2H({ code, role, time, bestLap, place }) {
  return api("h2h", {
    method: "POST",
    body: { action: "finish", code, role, time, bestLap, place },
  });
}

export { formatTime, loadLocalScores };
