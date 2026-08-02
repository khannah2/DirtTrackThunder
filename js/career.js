import { PLAYER, RIVALS, defaultSelectedRivals } from "./characters.js";
import { TRACKS, trackForRound, getTrack } from "./tracks.js";

const SAVE_KEY = "dirtTrackThunder_career_v2";

export const UPGRADES = [
  {
    id: "engine",
    name: "Engine Package",
    desc: "More horsepower and top end on the straights.",
    max: 5,
    baseCost: 800,
    stat: "power",
    perLevel: 0.07,
  },
  {
    id: "tires",
    name: "Hoosier Compound",
    desc: "Better bite off the corner. Less free spin.",
    max: 5,
    baseCost: 600,
    stat: "grip",
    perLevel: 0.06,
  },
  {
    id: "suspension",
    name: "Suspension / Setup",
    desc: "Tighter chassis. Hold the bottom or ride the cushion.",
    max: 5,
    baseCost: 700,
    stat: "handling",
    perLevel: 0.07,
  },
  {
    id: "brakes",
    name: "Brake Package",
    desc: "Later braking into the corners.",
    max: 5,
    baseCost: 500,
    stat: "brakes",
    perLevel: 0.08,
  },
  {
    id: "aero",
    name: "Body / Aero",
    desc: "Stability at speed and in dirty air.",
    max: 5,
    baseCost: 650,
    stat: "aero",
    perLevel: 0.05,
  },
];

/** Race formats cycled with tracks */
const FORMATS = [
  {
    id: "heat",
    nameSuffix: "Heat",
    desc: "8-lap heat. Get a feel for the clay.",
    laps: 8,
    purse: [400, 250, 150, 100, 75, 50],
    points: [12, 10, 8, 6, 4, 2],
  },
  {
    id: "showdown",
    nameSuffix: "Showdown",
    desc: "10 laps under the lights. Purse bumps up.",
    laps: 10,
    purse: [700, 450, 300, 180, 120, 80],
    points: [18, 15, 12, 9, 6, 3],
  },
  {
    id: "feature",
    nameSuffix: "Feature",
    desc: "12-lap feature. Full grandstands.",
    laps: 12,
    purse: [1200, 800, 500, 300, 180, 100],
    points: [25, 20, 16, 12, 8, 5],
  },
  {
    id: "championship",
    nameSuffix: "Championship",
    desc: "15-lap title race. Everything on the line.",
    laps: 15,
    purse: [2500, 1500, 900, 500, 300, 150],
    points: [40, 32, 26, 20, 14, 8],
  },
];

/** Build full season: each stop is a track + format */
export const EVENTS = TRACKS.map((track, i) => {
  const fmt = FORMATS[i % FORMATS.length];
  return {
    id: `${track.id}_${fmt.id}`,
    name: `${track.shortName} ${fmt.nameSuffix}`,
    desc: `${track.desc} ${fmt.desc}`,
    laps: fmt.laps,
    purse: fmt.purse,
    points: fmt.points,
    trackId: track.id,
  };
});

function blankCareer() {
  const levels = {};
  for (const u of UPGRADES) levels[u.id] = 0;
  return {
    version: 1,
    driverName: "CJ Permann",
    cash: 1500,
    points: 0,
    round: 0,
    upgrades: levels,
    selectedRivals: defaultSelectedRivals(),
    racesRun: 0,
    wins: 0,
    podiums: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

export function loadCareer() {
  try {
    const raw =
      localStorage.getItem(SAVE_KEY) ||
      localStorage.getItem("dirtTrackThunder_career_v1");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const base = blankCareer();
    return {
      ...base,
      ...data,
      upgrades: { ...base.upgrades, ...(data.upgrades || {}) },
      selectedRivals: Array.isArray(data.selectedRivals)
        ? data.selectedRivals.slice(0, 5)
        : defaultSelectedRivals(),
    };
  } catch {
    return null;
  }
}

export function saveCareer(career) {
  career.updatedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(career));
  return career;
}

export function newCareer(driverName = "CJ Permann") {
  const c = blankCareer();
  c.driverName = (driverName || "CJ Permann").slice(0, 24);
  return saveCareer(c);
}

export function currentEvent(career) {
  const i = Math.min(career.round, EVENTS.length - 1);
  return EVENTS[i];
}

export function currentTrack(career) {
  const ev = currentEvent(career);
  return getTrack(ev.trackId) || trackForRound(career.round);
}

export { TRACKS, trackForRound, getTrack };

export function upgradeCost(upgrade, level) {
  return Math.round(upgrade.baseCost * Math.pow(1.45, level));
}

export function canBuyUpgrade(career, upgradeId) {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u) return false;
  const lvl = career.upgrades[upgradeId] || 0;
  if (lvl >= u.max) return false;
  return career.cash >= upgradeCost(u, lvl);
}

export function buyUpgrade(career, upgradeId) {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u) return { ok: false, reason: "Unknown upgrade" };
  const lvl = career.upgrades[upgradeId] || 0;
  if (lvl >= u.max) return { ok: false, reason: "Maxed out" };
  const cost = upgradeCost(u, lvl);
  if (career.cash < cost) return { ok: false, reason: "Not enough cash" };
  career.cash -= cost;
  career.upgrades[upgradeId] = lvl + 1;
  saveCareer(career);
  return { ok: true, cost, level: lvl + 1 };
}

/** Stats multipliers for race physics (1.0 baseline) */
export function playerStats(career) {
  const s = { power: 1, grip: 1, handling: 1, brakes: 1, aero: 1 };
  for (const u of UPGRADES) {
    const lvl = career.upgrades[u.id] || 0;
    s[u.stat] += lvl * u.perLevel;
  }
  return s;
}

export function applyRaceResult(career, placeIndex, fieldSize) {
  const event = currentEvent(career);
  const place = Math.min(placeIndex, event.purse.length - 1);
  const cash = event.purse[place] ?? 50;
  const pts = event.points[place] ?? 1;
  career.cash += cash;
  career.points += pts;
  career.racesRun += 1;
  if (place === 0) career.wins += 1;
  if (place <= 2) career.podiums += 1;
  // Advance through track list; loop season after last stop
  career.round = (career.round + 1) % EVENTS.length;
  saveCareer(career);
  return { cash, pts, event };
}

export function selectedRivalDrivers(career) {
  const ids = career.selectedRivals || defaultSelectedRivals();
  const list = [];
  for (const id of ids) {
    const r = RIVALS.find((x) => x.id === id);
    if (r) list.push(r);
  }
  while (list.length < 5) {
    const fill = RIVALS.find((r) => !list.some((x) => x.id === r.id));
    if (!fill) break;
    list.push(fill);
  }
  return list.slice(0, 5);
}

export function formatMoney(n) {
  return "$" + Math.round(n).toLocaleString();
}

export { PLAYER, RIVALS };
