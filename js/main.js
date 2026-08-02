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
} from "./career.js";
import { RaceSession, formatTime } from "./race3d.js";

const $ = (id) => document.getElementById(id);

const screens = {
  menu: $("screen-menu"),
  hub: $("screen-hub"),
  garage: $("screen-garage"),
  rivals: $("screen-rivals"),
  tracks: $("screen-tracks"),
  race: $("screen-race"),
  results: $("screen-results"),
};

let career = null;
let raceSession = null;

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

function enterRace() {
  career = loadCareer();
  if (!career) return;
  const event = currentEvent(career);
  const track = currentTrack(career);
  const rivals = selectedRivalDrivers(career);
  const stats = playerStats(career);

  show("race");
  $("race-overlay").classList.remove("hidden");
  $("countdown").classList.add("hidden");
  $("race-flash").classList.add("hidden");
  $("race-title").textContent = event.name.toUpperCase();
  $("race-msg").textContent = `${track.name} · ${track.location} · ${event.laps} laps · ${formatMoney(event.purse[0])} to win`;
  $("hud-purse").textContent = event.purse[0];

  if (raceSession) {
    try {
      raceSession.destroy();
    } catch (e) {
      console.warn(e);
    }
    raceSession = null;
  }

  // Always grab current canvas (destroy() may have replaced the node)
  const canvas = $("game");
  if (!canvas) {
    alert("Race canvas missing. Refresh the page.");
    openHub();
    return;
  }

  raceSession = new RaceSession(canvas, {
    laps: event.laps,
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
    onFinish: (result) => onRaceFinished(result),
    onQuit: () => {
      raceSession = null;
      openHub();
    },
  });
  raceSession.start().catch((err) => {
    console.error("Race start failed:", err);
    raceSession = null;
    alert(
      "Could not start WebGL race.\n\n" +
        (err && err.message ? err.message + "\n\n" : "") +
        "Tips: hard-refresh (Ctrl+F5), use Chrome/Edge, open via http://localhost:8765 (not a file:// path)."
    );
    openHub();
  });
}

function onRaceFinished(result) {
  raceSession = null;
  career = loadCareer();
  const applied = applyRaceResult(career, result.placeIndex, result.standings.length);
  career = loadCareer();

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
$("btn-menu").addEventListener("click", () => {
  show("menu");
  refreshMenu();
});
$("btn-garage-back").addEventListener("click", () => openHub());
$("btn-rivals-back").addEventListener("click", () => openHub());
$("btn-tracks-back")?.addEventListener("click", () => openHub());
$("btn-results-hub").addEventListener("click", () => openHub());
$("btn-start-race").addEventListener("click", async () => {
  $("race-overlay").classList.add("hidden");
  if (raceSession) await raceSession.greenFlag();
});

// Boot
refreshMenu();
show("menu");
