import {
  hasSave,
  loadCareer,
  newCareer,
  saveCareer,
  currentEvent,
  currentTrack,
  UPGRADES,
  upgradeCost,
  buyUpgrade,
  playerStats,
  applyRaceResult,
  selectedRivalDrivers,
  formatMoney,
  PLAYER,
  RIVALS,
  TRACKS,
  getTrack,
} from "./career.js";
import { RaceSession, formatTime } from "./race3d.js";
import {
  fetchLeaderboard,
  submitScore,
  createH2HRoom,
  joinH2HRoom,
  setH2HReady,
  getH2HRoom,
  finishH2H,
} from "./online.js";

const $ = (id) => document.getElementById(id);

const screens = {
  menu: $("screen-menu"),
  hub: $("screen-hub"),
  garage: $("screen-garage"),
  rivals: $("screen-rivals"),
  tracks: $("screen-tracks"),
  scores: $("screen-scores"),
  h2h: $("screen-h2h"),
  race: $("screen-race"),
  results: $("screen-results"),
};

let career = null;
let raceSession = null;
/** @type {null | { code: string, role: 'host'|'guest', room: object }} */
let h2hSession = null;
let h2hPoll = null;
let raceMode = "career"; // career | h2h

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    el.classList.toggle("active", k === name);
  }
}

function refreshMenu() {
  const saved = hasSave();
  $("btn-continue").disabled = !saved;
  if (saved) {
    const c = loadCareer();
    $("menu-save-info").textContent = c
      ? `${c.driverName} · ${formatMoney(c.cash)} · ${c.points} pts · Round ${c.round + 1}`
      : "";
  } else {
    $("menu-save-info").textContent = "No career yet — start as CJ Permann in the #37.";
  }
}

function openHub() {
  career = loadCareer();
  if (!career) {
    show("menu");
    refreshMenu();
    return;
  }
  const event = currentEvent(career);
  const track = currentTrack(career);
  $("hub-driver").textContent = `${PLAYER.name} · ${PLAYER.carName}`;
  $("hub-cash").textContent = formatMoney(career.cash);
  $("hub-points").textContent = String(career.points);
  $("hub-round").textContent = `${career.round + 1}/${TRACKS.length}`;
  $("hub-car-name").textContent = PLAYER.carName;
  $("hub-car-sponsors").textContent = PLAYER.sponsors;
  $("hub-car-img").src = PLAYER.action;
  $("next-event-name").textContent = event.name;
  $("next-event-desc").textContent = `${track.name} · ${track.location} · ${event.laps} laps`;
  $("next-event-purse").textContent = `Winner purse ${formatMoney(event.purse[0])}`;
  const trackEl = $("next-event-track");
  if (trackEl) trackEl.textContent = `${track.region}: ${track.desc}`;

  const stats = playerStats(career);
  const bars = $("hub-power-bars");
  bars.innerHTML = "";
  const labels = [
    ["Power", stats.power],
    ["Grip", stats.grip],
    ["Handling", stats.handling],
    ["Brakes", stats.brakes],
    ["Aero", stats.aero],
  ];
  for (const [name, val] of labels) {
    const pct = Math.round(clamp01((val - 0.9) / 0.5) * 100);
    const row = document.createElement("div");
    row.className = "power-row";
    row.innerHTML = `<span>${name}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${val.toFixed(2)}</span>`;
    bars.appendChild(row);
  }
  show("hub");
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function openGarage() {
  career = loadCareer();
  $("garage-cash").textContent = formatMoney(career.cash);
  const list = $("upgrade-list");
  list.innerHTML = "";
  for (const u of UPGRADES) {
    const lvl = career.upgrades[u.id] || 0;
    const maxed = lvl >= u.max;
    const cost = upgradeCost(u, lvl);
    const card = document.createElement("div");
    card.className = "upgrade-card";
    card.innerHTML = `
      <div>
        <h4>${u.name} <span class="muted">Lv ${lvl}/${u.max}</span></h4>
        <p>${u.desc}</p>
      </div>
      <button class="btn small primary" type="button" data-id="${u.id}" ${maxed || career.cash < cost ? "disabled" : ""}>
        ${maxed ? "MAX" : formatMoney(cost)}
      </button>
    `;
    list.appendChild(card);
  }
  list.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const res = buyUpgrade(career, btn.dataset.id);
      if (res.ok) openGarage();
      else alert(res.reason);
    });
  });
  show("garage");
}

function openRivals() {
  career = loadCareer();
  const selected = new Set(career.selectedRivals || []);
  const list = $("rival-list");
  list.innerHTML = "";

  function syncCount() {
    $("rival-count").textContent = String(selected.size);
  }

  for (const r of RIVALS) {
    const card = document.createElement("div");
    card.className = "rival-card" + (selected.has(r.id) ? " selected" : "");
    const thumb = r.portrait
      ? `<img class="rival-thumb" src="${r.portrait}" alt="#${r.number}" />`
      : `<div class="rival-swatch" style="background:linear-gradient(135deg,${r.body},${r.accent});border-color:${r.trim}"></div>`;
    card.innerHTML = `
      <div class="left">
        ${thumb}
        <div>
          <h4>#${r.number} ${r.name}</h4>
          <p>${r.bio} · skill ${Math.round(r.skill * 100)}</p>
        </div>
      </div>
      <button class="btn small" type="button">${selected.has(r.id) ? "IN" : "OUT"}</button>
    `;
    const btn = card.querySelector("button");
    btn.addEventListener("click", () => {
      if (selected.has(r.id)) {
        if (selected.size <= 3) {
          alert("Need at least 3 rivals in the field.");
          return;
        }
        selected.delete(r.id);
      } else {
        if (selected.size >= 5) {
          alert("Field is full (5 rivals). Deselect someone first.");
          return;
        }
        selected.add(r.id);
      }
      career.selectedRivals = [...selected];
      saveCareer(career);
      openRivals();
    });
    list.appendChild(card);
  }
  syncCount();
  show("rivals");
}

function openTracks() {
  const list = $("track-list");
  if (!list) return;
  list.innerHTML = "";
  const careerRound = career ? career.round : 0;
  for (let i = 0; i < TRACKS.length; i++) {
    const t = TRACKS[i];
    const card = document.createElement("div");
    card.className = "track-card" + (i === careerRound % TRACKS.length ? " next" : "");
    card.innerHTML = `
      <div class="track-num">${i + 1}</div>
      <div>
        <h4>${t.name}</h4>
        <p class="muted">${t.location} · ${t.region}</p>
        <p>${t.desc}</p>
      </div>
      <span class="track-badge">${i === careerRound % TRACKS.length ? "NEXT" : t.region}</span>
    `;
    list.appendChild(card);
  }
  show("tracks");
}

function startRaceSession({ laps, track, rivals, stats, title, msg, purseDisplay, onDone, onQuit }) {
  show("race");
  $("race-overlay").classList.remove("hidden");
  $("countdown").classList.add("hidden");
  $("race-flash").classList.add("hidden");
  $("race-title").textContent = title;
  $("race-msg").textContent = msg;
  $("hud-purse").textContent = purseDisplay;

  if (raceSession) {
    try {
      raceSession.destroy();
    } catch (e) {
      console.warn(e);
    }
    raceSession = null;
  }

  const canvas = $("game");
  if (!canvas) {
    alert("Race canvas missing. Refresh the page.");
    openHub();
    return;
  }

  raceSession = new RaceSession(canvas, {
    laps,
    rivals,
    playerStats: stats,
    track,
    hud: {
      pos: $("hud-pos"),
      lap: $("hud-lap"),
      speed: $("hud-speed"),
      best: $("hud-best"),
      tach: $("hud-tach-fill"),
    },
    onCountdown: (v) => {
      const el = $("countdown");
      if (v == null) {
        el.classList.add("hidden");
        return;
      }
      el.classList.remove("hidden");
      el.textContent = String(v);
      if (v === "GO") setTimeout(() => el.classList.add("hidden"), 700);
    },
    onFlash: (text) => {
      const el = $("race-flash");
      if (!text) {
        el.classList.add("hidden");
        return;
      }
      el.textContent = text;
      el.classList.remove("hidden");
    },
    onFinish: (result) => onDone(result),
    onQuit: () => {
      raceSession = null;
      onQuit();
    },
  });
  raceSession.start().catch((err) => {
    console.error("Race start failed:", err);
    raceSession = null;
    alert(
      "Could not start WebGL race.\n\n" +
        (err && err.message ? err.message + "\n\n" : "") +
        "Tips: hard-refresh, use Chrome/Edge, open the Netlify https link."
    );
    openHub();
  });
}

function enterRace() {
  career = loadCareer();
  if (!career) return;
  raceMode = "career";
  const event = currentEvent(career);
  const track = currentTrack(career);
  const rivals = selectedRivalDrivers(career);
  const stats = playerStats(career);

  startRaceSession({
    laps: event.laps,
    track,
    rivals,
    stats,
    title: event.name.toUpperCase(),
    msg: `${track.name} · ${track.location} · ${event.laps} laps · ${formatMoney(event.purse[0])} to win`,
    purseDisplay: event.purse[0],
    onDone: (result) => onRaceFinished(result),
    onQuit: () => openHub(),
  });
}

function enterH2HRace() {
  if (!h2hSession?.room) return;
  raceMode = "h2h";
  stopH2HPoll();
  const room = h2hSession.room;
  const track = getTrack(room.trackId) || TRACKS[0];
  career = loadCareer();
  const stats = career ? playerStats(career) : { power: 1, grip: 1, handling: 1, brakes: 1, aero: 1 };
  // Light AI field so it's still a race, times decide H2H
  const rivals = selectedRivalDrivers(career || { selectedRivals: [] }).slice(0, 3);

  startRaceSession({
    laps: room.laps || 8,
    track,
    rivals,
    stats,
    title: `H2H · ${room.code}`,
    msg: `${room.trackName} · ${room.laps} laps · Beat your opponent's time`,
    purseDisplay: "H2H",
    onDone: (result) => onH2HRaceFinished(result),
    onQuit: () => {
      openH2H();
      if (h2hSession) startH2HPoll();
    },
  });
}

async function onRaceFinished(result) {
  raceSession = null;
  career = loadCareer();
  const event = currentEvent(career);
  const track = currentTrack(career);
  const applied = applyRaceResult(career, result.placeIndex, result.standings.length);
  career = loadCareer();

  // Submit high score (best effort)
  const driverName = career?.driverName || PLAYER.name;
  submitScore({
    name: driverName,
    trackId: track.id,
    trackName: track.name,
    time: result.raceTime,
    bestLap: result.bestLap,
    place: result.place,
    points: applied.pts,
  }).then((r) => {
    if (r.rank) {
      const note = $("results-place");
      if (note && r.online) note.textContent += ` · Global #${r.rank} on board`;
      else if (note && !r.online) note.textContent += ` · Local #${r.rank}`;
    }
  }).catch(() => {});

  $("results-title").textContent = result.place === 1 ? "CHECKERED — WINNER" : "CHECKERED FLAG";
  $("results-place").textContent = `${result.place}${ord(result.place)} place · ${applied.event.name}`;
  $("results-purse").textContent = formatMoney(applied.cash);
  $("results-points").textContent = `+${applied.pts}`;
  $("results-time").textContent = formatTime(result.raceTime);
  $("results-best").textContent = formatTime(result.bestLap);

  const ol = $("results-standings");
  ol.innerHTML = "";
  for (const s of result.standings) {
    const li = document.createElement("li");
    if (s.isPlayer) li.className = "you";
    li.innerHTML = `<span>${s.place}. #${s.number} ${s.name}</span><span>${s.finished ? formatTime(s.time) : "DNF"}</span>`;
    ol.appendChild(li);
  }
  show("results");
}

async function onH2HRaceFinished(result) {
  raceSession = null;
  if (!h2hSession) {
    openHub();
    return;
  }

  $("results-title").textContent = "H2H RESULT SUBMITTED";
  $("results-place").textContent = "Waiting for opponent…";
  $("results-purse").textContent = "—";
  $("results-points").textContent = "—";
  $("results-time").textContent = formatTime(result.raceTime);
  $("results-best").textContent = formatTime(result.bestLap);
  $("results-standings").innerHTML = "";
  show("results");

  try {
    const data = await finishH2H({
      code: h2hSession.code,
      role: h2hSession.role,
      time: result.raceTime,
      bestLap: result.bestLap,
      place: result.place,
    });
    h2hSession.room = data.room;
    renderH2HResults(data.room);
  } catch (err) {
    $("results-place").textContent = err.message || "Could not submit result";
  }

  // Also post personal score
  const name =
    h2hSession.role === "host"
      ? h2hSession.room?.host?.name
      : h2hSession.room?.guest?.name;
  submitScore({
    name: name || PLAYER.name,
    trackId: h2hSession.room?.trackId,
    trackName: h2hSession.room?.trackName,
    time: result.raceTime,
    bestLap: result.bestLap,
    place: result.place,
    points: 0,
  }).catch(() => {});
}

function renderH2HResults(room) {
  if (!room) return;
  const ol = $("results-standings");
  ol.innerHTML = "";
  const rows = [
    { role: "host", name: room.host?.name, res: room.hostResult },
    { role: "guest", name: room.guest?.name, res: room.guestResult },
  ];
  rows.sort((a, b) => {
    if (!a.res) return 1;
    if (!b.res) return -1;
    return a.res.time - b.res.time;
  });
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (h2hSession && r.role === h2hSession.role) li.className = "you";
    const t = r.res ? formatTime(r.res.time) : "Racing…";
    li.innerHTML = `<span>${i + 1}. ${r.name || "—"}</span><span class="rank-time">${t}</span>`;
    ol.appendChild(li);
  });

  if (room.status === "done" && room.winner) {
    if (room.winner.role === "tie") {
      $("results-title").textContent = "IT'S A TIE!";
      $("results-place").textContent = `Both ${formatTime(room.winner.time)}`;
    } else {
      const youWin = h2hSession && room.winner.role === h2hSession.role;
      $("results-title").textContent = youWin ? "YOU WIN H2H!" : "H2H COMPLETE";
      $("results-place").textContent = `${room.winner.name} · ${formatTime(room.winner.time)}`;
    }
  } else {
    $("results-place").textContent = "Opponent still racing — hang tight";
    // keep polling until done
    startH2HResultPoll();
  }
}

function startH2HResultPoll() {
  stopH2HPoll();
  h2hPoll = setInterval(async () => {
    if (!h2hSession) return stopH2HPoll();
    try {
      const data = await getH2HRoom(h2hSession.code);
      h2hSession.room = data.room;
      renderH2HResults(data.room);
      if (data.room.status === "done") stopH2HPoll();
    } catch (_) {}
  }, 2000);
}

// ---------- High scores UI ----------
async function openScores() {
  const sel = $("scores-track-filter");
  if (sel && !sel.options.length) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All tracks";
    sel.appendChild(all);
    for (const t of TRACKS) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.shortName;
      sel.appendChild(o);
    }
    sel.onchange = () => refreshScores();
  }
  show("scores");
  await refreshScores();
}

async function refreshScores() {
  const trackId = $("scores-track-filter")?.value || "";
  $("scores-status").textContent = "Loading…";
  const data = await fetchLeaderboard({ trackId, limit: 25 });
  $("scores-status").textContent = data.online
    ? "Global board (fastest race times)"
    : `Local board only${data.error ? " — " + data.error : ""}`;
  const ol = $("scores-list");
  ol.innerHTML = "";
  if (!data.scores.length) {
    ol.innerHTML = "<li><span>No scores yet — finish a race!</span><span></span></li>";
    return;
  }
  data.scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}. ${s.name} · ${s.trackName || s.trackId}</span><span class="rank-time">${formatTime(s.time)}</span>`;
    ol.appendChild(li);
  });
}

// ---------- H2H lobby ----------
function openH2H() {
  career = loadCareer();
  const hostIn = $("h2h-host-name");
  const guestIn = $("h2h-guest-name");
  if (hostIn && !hostIn.value) hostIn.value = career?.driverName || PLAYER.name;
  if (guestIn && !guestIn.value) guestIn.value = "Challenger";

  const sel = $("h2h-track");
  if (sel && !sel.options.length) {
    for (const t of TRACKS) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = `${t.shortName} — ${t.location}`;
      sel.appendChild(o);
    }
  }

  $("h2h-error").textContent = "";
  if (!h2hSession) {
    $("h2h-lobby").classList.add("hidden");
  } else {
    $("h2h-lobby").classList.remove("hidden");
    paintLobby(h2hSession.room);
  }
  show("h2h");
}

function paintLobby(room) {
  if (!room) return;
  $("h2h-lobby-code").textContent = room.code;
  $("h2h-lobby-track").textContent = `${room.trackName} · ${room.laps} laps`;
  $("h2h-host-label").textContent = room.host?.name || "—";
  $("h2h-guest-label").textContent = room.guest?.name || "Waiting for challenger…";
  $("h2h-host-ready").textContent = room.host?.ready ? "READY" : "NOT READY";
  $("h2h-host-ready").className = "badge " + (room.host?.ready ? "ready" : "wait");
  $("h2h-guest-ready").textContent = !room.guest ? "—" : room.guest.ready ? "READY" : "NOT READY";
  $("h2h-guest-ready").className = "badge " + (room.guest?.ready ? "ready" : "wait");

  if (room.status === "waiting") {
    $("h2h-lobby-status").textContent = "Share this code with your opponent";
  } else if (room.status === "ready") {
    $("h2h-lobby-status").textContent = "Both in lobby — hit I'M READY";
  } else if (room.status === "racing") {
    $("h2h-lobby-status").textContent = "Both ready — starting race!";
  } else if (room.status === "done") {
    $("h2h-lobby-status").textContent = room.winner
      ? room.winner.role === "tie"
        ? "Tie match!"
        : `Winner: ${room.winner.name}`
      : "Match complete";
  }
}

function startH2HPoll() {
  stopH2HPoll();
  h2hPoll = setInterval(async () => {
    if (!h2hSession) return stopH2HPoll();
    try {
      const data = await getH2HRoom(h2hSession.code);
      const prev = h2hSession.room?.status;
      h2hSession.room = data.room;
      paintLobby(data.room);
      // Transition to race when server marks racing
      if (data.room.status === "racing" && prev !== "racing" && raceMode !== "h2h") {
        // only auto-start if we're on h2h screen
        if ($("screen-h2h")?.classList.contains("active")) {
          enterH2HRace();
        }
      }
    } catch (err) {
      $("h2h-error").textContent = err.message || "Lobby connection lost";
    }
  }, 1500);
}

function stopH2HPoll() {
  if (h2hPoll) {
    clearInterval(h2hPoll);
    h2hPoll = null;
  }
}

function leaveH2H() {
  stopH2HPoll();
  h2hSession = null;
  raceMode = "career";
  $("h2h-lobby").classList.add("hidden");
  $("h2h-error").textContent = "";
}

function ord(n) {
  if (n === 1) return "st";
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}

// --- Wire buttons ---
$("btn-continue").addEventListener("click", () => openHub());
$("btn-new-career").addEventListener("click", () => {
  const name = prompt("Driver name on the seat:", "CJ Permann") || "CJ Permann";
  if (hasSave() && !confirm("Overwrite existing career?")) return;
  newCareer(name);
  openHub();
});
$("btn-race").addEventListener("click", () => enterRace());
$("btn-garage").addEventListener("click", () => openGarage());
$("btn-rivals").addEventListener("click", () => openRivals());
$("btn-tracks")?.addEventListener("click", () => openTracks());
$("btn-scores")?.addEventListener("click", () => openScores());
$("btn-h2h")?.addEventListener("click", () => openH2H());
$("btn-menu").addEventListener("click", () => {
  leaveH2H();
  show("menu");
  refreshMenu();
});
$("btn-garage-back").addEventListener("click", () => openHub());
$("btn-rivals-back").addEventListener("click", () => openHub());
$("btn-tracks-back")?.addEventListener("click", () => openHub());
$("btn-scores-back")?.addEventListener("click", () => openHub());
$("btn-h2h-back")?.addEventListener("click", () => {
  leaveH2H();
  openHub();
});
$("btn-results-hub").addEventListener("click", () => {
  if (raceMode === "h2h") {
    openH2H();
    if (h2hSession) startH2HPoll();
  } else openHub();
});
$("btn-start-race").addEventListener("click", async () => {
  $("race-overlay").classList.add("hidden");
  if (raceSession) await raceSession.greenFlag();
});

$("btn-h2h-create")?.addEventListener("click", async () => {
  $("h2h-error").textContent = "";
  try {
    const trackId = $("h2h-track").value;
    const track = getTrack(trackId) || TRACKS[0];
    const data = await createH2HRoom({
      hostName: $("h2h-host-name").value || PLAYER.name,
      trackId: track.id,
      trackName: track.name,
      laps: parseInt($("h2h-laps").value, 10) || 8,
    });
    h2hSession = { code: data.room.code, role: "host", room: data.room };
    $("h2h-lobby").classList.remove("hidden");
    paintLobby(data.room);
    startH2HPoll();
  } catch (err) {
    $("h2h-error").textContent =
      err.message || "Could not create room (need Netlify online API)";
  }
});

$("btn-h2h-join")?.addEventListener("click", async () => {
  $("h2h-error").textContent = "";
  try {
    const code = ($("h2h-code").value || "").trim().toUpperCase();
    if (code.length < 4) {
      $("h2h-error").textContent = "Enter a 4-character room code";
      return;
    }
    const data = await joinH2HRoom({
      code,
      guestName: $("h2h-guest-name").value || "Challenger",
    });
    h2hSession = { code: data.room.code, role: "guest", room: data.room };
    $("h2h-lobby").classList.remove("hidden");
    paintLobby(data.room);
    startH2HPoll();
  } catch (err) {
    $("h2h-error").textContent = err.message || "Could not join room";
  }
});

$("btn-h2h-ready")?.addEventListener("click", async () => {
  if (!h2hSession) return;
  $("h2h-error").textContent = "";
  try {
    const data = await setH2HReady({
      code: h2hSession.code,
      role: h2hSession.role,
      ready: true,
    });
    h2hSession.room = data.room;
    paintLobby(data.room);
    if (data.room.status === "racing") {
      enterH2HRace();
    }
  } catch (err) {
    $("h2h-error").textContent = err.message || "Ready failed";
  }
});

$("btn-h2h-leave")?.addEventListener("click", () => {
  leaveH2H();
  openH2H();
});

// Boot
refreshMenu();
show("menu");
