/**
 * Dirt Track Thunder online API
 * GET/POST scores · H2H rooms (create/join/status/finish)
 * Storage: Netlify Blobs
 */
import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_SCORES = 100;
const ROOM_TTL_HOURS = 6;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function code4() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function cleanName(n) {
  return String(n || "Driver")
    .replace(/[^\w\s.\-#]/g, "")
    .trim()
    .slice(0, 24) || "Driver";
}

function scoreRow(body) {
  const time = Number(body.time);
  if (!isFinite(time) || time <= 0 || time > 3600) return null;
  return {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName(body.name),
    trackId: String(body.trackId || "unknown").slice(0, 32),
    trackName: String(body.trackName || body.trackId || "Track").slice(0, 48),
    time: Math.round(time * 1000) / 1000,
    bestLap: body.bestLap != null && isFinite(Number(body.bestLap))
      ? Math.round(Number(body.bestLap) * 1000) / 1000
      : null,
    place: Math.min(99, Math.max(1, parseInt(body.place, 10) || 99)),
    points: Math.min(9999, Math.max(0, parseInt(body.points, 10) || 0)),
    at: Date.now(),
  };
}

async function getScores(store) {
  try {
    const data = await store.get("leaderboard", { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveScores(store, list) {
  await store.setJSON("leaderboard", list.slice(0, MAX_SCORES));
}

async function getRoom(store, code) {
  const key = `room_${String(code || "").toUpperCase()}`;
  try {
    return await store.get(key, { type: "json" });
  } catch {
    return null;
  }
}

async function saveRoom(store, room) {
  const key = `room_${room.code}`;
  await store.setJSON(key, room);
}

function roomPublic(room) {
  if (!room) return null;
  return {
    code: room.code,
    status: room.status,
    trackId: room.trackId,
    trackName: room.trackName,
    laps: room.laps,
    host: room.host,
    guest: room.guest,
    hostResult: room.hostResult || null,
    guestResult: room.guestResult || null,
    winner: room.winner || null,
    createdAt: room.createdAt,
  };
}

function decideWinner(room) {
  if (!room.hostResult || !room.guestResult) return null;
  const ht = room.hostResult.time;
  const gt = room.guestResult.time;
  if (ht < gt) return { role: "host", name: room.host.name, time: ht };
  if (gt < ht) return { role: "guest", name: room.guest.name, time: gt };
  return { role: "tie", name: "TIE", time: ht };
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: CORS });
  }

  const store = getStore("dtt-online");
  const url = new URL(req.url);
  // Support /api/scores and /.netlify/functions/api?path=scores
  let path = url.searchParams.get("path") || "";
  if (!path) {
    const m = url.pathname.match(/\/api\/(.+)$/) || url.pathname.match(/\/api$/);
    path = m ? (m[1] || "") : url.pathname.replace(/^.*\/api\/?/, "");
  }
  path = path.replace(/^\//, "").replace(/\/$/, "");

  try {
    // -------- SCORES --------
    if (path === "scores" || path === "" || path === "leaderboard") {
      if (req.method === "GET") {
        const trackId = url.searchParams.get("trackId") || "";
        const limit = Math.min(50, Math.max(5, parseInt(url.searchParams.get("limit") || "20", 10)));
        let list = await getScores(store);
        if (trackId) list = list.filter((s) => s.trackId === trackId);
        list.sort((a, b) => a.time - b.time || a.place - b.place);
        return json(200, { ok: true, scores: list.slice(0, limit) });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const row = scoreRow(body);
        if (!row) return json(400, { ok: false, error: "Invalid score" });
        let list = await getScores(store);
        list.push(row);
        list.sort((a, b) => a.time - b.time || a.place - b.place);
        // keep best per name+track optionally? keep all, cap size
        list = list.slice(0, MAX_SCORES);
        await saveScores(store, list);
        const rank =
          list
            .filter((s) => !body.trackId || s.trackId === row.trackId)
            .findIndex((s) => s.id === row.id) + 1;
        return json(200, { ok: true, score: row, rank });
      }
    }

    // -------- H2H --------
    if (path === "h2h" || path.startsWith("h2h/")) {
      const action = path === "h2h" ? url.searchParams.get("action") || "" : path.slice(4);

      if (req.method === "GET") {
        const code = (url.searchParams.get("code") || "").toUpperCase();
        const room = await getRoom(store, code);
        if (!room) return json(404, { ok: false, error: "Room not found" });
        // expire old rooms
        if (Date.now() - room.createdAt > ROOM_TTL_HOURS * 3600 * 1000) {
          return json(410, { ok: false, error: "Room expired" });
        }
        return json(200, { ok: true, room: roomPublic(room) });
      }

      if (req.method === "POST") {
        const body = await req.json();
        const act = body.action || action;

        if (act === "create") {
          let code = code4();
          for (let i = 0; i < 8; i++) {
            const existing = await getRoom(store, code);
            if (!existing) break;
            code = code4();
          }
          const room = {
            code,
            status: "waiting", // waiting | ready | racing | done
            trackId: String(body.trackId || "unoh").slice(0, 32),
            trackName: String(body.trackName || "Track").slice(0, 48),
            laps: Math.min(20, Math.max(3, parseInt(body.laps, 10) || 8)),
            host: { name: cleanName(body.hostName || body.name), ready: false },
            guest: null,
            hostResult: null,
            guestResult: null,
            winner: null,
            createdAt: Date.now(),
          };
          await saveRoom(store, room);
          return json(200, { ok: true, room: roomPublic(room), role: "host" });
        }

        if (act === "join") {
          const code = String(body.code || "").toUpperCase();
          const room = await getRoom(store, code);
          if (!room) return json(404, { ok: false, error: "Room not found" });
          if (room.guest) return json(409, { ok: false, error: "Room full" });
          if (room.status !== "waiting" && room.status !== "ready") {
            return json(409, { ok: false, error: "Race already started" });
          }
          room.guest = { name: cleanName(body.guestName || body.name), ready: false };
          room.status = "ready";
          await saveRoom(store, room);
          return json(200, { ok: true, room: roomPublic(room), role: "guest" });
        }

        if (act === "ready") {
          const code = String(body.code || "").toUpperCase();
          const role = body.role === "guest" ? "guest" : "host";
          const room = await getRoom(store, code);
          if (!room) return json(404, { ok: false, error: "Room not found" });
          if (role === "host" && room.host) room.host.ready = !!body.ready;
          if (role === "guest" && room.guest) room.guest.ready = !!body.ready;
          // both ready → racing
          if (room.host?.ready && room.guest?.ready) {
            room.status = "racing";
            room.raceStartedAt = Date.now();
          }
          await saveRoom(store, room);
          return json(200, { ok: true, room: roomPublic(room) });
        }

        if (act === "finish") {
          const code = String(body.code || "").toUpperCase();
          const role = body.role === "guest" ? "guest" : "host";
          const room = await getRoom(store, code);
          if (!room) return json(404, { ok: false, error: "Room not found" });
          const time = Number(body.time);
          if (!isFinite(time) || time <= 0) return json(400, { ok: false, error: "Invalid time" });
          const result = {
            time: Math.round(time * 1000) / 1000,
            bestLap:
              body.bestLap != null && isFinite(Number(body.bestLap))
                ? Math.round(Number(body.bestLap) * 1000) / 1000
                : null,
            place: parseInt(body.place, 10) || null,
            at: Date.now(),
          };
          if (role === "host") room.hostResult = result;
          else room.guestResult = result;

          if (room.hostResult && room.guestResult) {
            room.status = "done";
            room.winner = decideWinner(room);
          } else {
            room.status = "racing";
          }
          await saveRoom(store, room);

          // Also post to leaderboard
          try {
            const name = role === "host" ? room.host.name : room.guest?.name;
            const row = scoreRow({
              name,
              trackId: room.trackId,
              trackName: room.trackName,
              time: result.time,
              bestLap: result.bestLap,
              place: result.place || 1,
              points: 0,
            });
            if (row) {
              let list = await getScores(store);
              list.push(row);
              list.sort((a, b) => a.time - b.time);
              await saveScores(store, list.slice(0, MAX_SCORES));
            }
          } catch (_) {}

          return json(200, { ok: true, room: roomPublic(room) });
        }

        return json(400, { ok: false, error: "Unknown H2H action" });
      }
    }

    return json(404, { ok: false, error: "Not found", path });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || "Server error" });
  }
};

export const config = {
  path: ["/api/*", "/api"],
};
