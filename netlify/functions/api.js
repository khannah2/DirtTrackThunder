/**
 * Dirt Track Thunder online API (Netlify Function)
 * GET/POST ?path=scores  ·  POST ?path=h2h  ·  GET ?path=h2h&code=
 */
const { getStore, connectLambda } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_SCORES = 100;
const ROOM_TTL_HOURS = 6;

function ok(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

function code4() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function cleanName(n) {
  return (
    String(n || "Driver")
      .replace(/[^\w\s.\-#]/g, "")
      .trim()
      .slice(0, 24) || "Driver"
  );
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
    bestLap:
      body.bestLap != null && isFinite(Number(body.bestLap))
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
  try {
    return await store.get(`room_${String(code || "").toUpperCase()}`, { type: "json" });
  } catch {
    return null;
  }
}

async function saveRoom(store, room) {
  await store.setJSON(`room_${room.code}`, room);
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

exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Required for Netlify Blobs inside classic Lambda-style functions
  try {
    connectLambda(event);
  } catch (err) {
    console.warn("connectLambda:", err.message);
  }

  let store;
  try {
    store = getStore("dtt-online");
  } catch (err) {
    // Fallback with explicit site credentials when available
    try {
      store = getStore({
        name: "dtt-online",
        siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID || context?.site?.id,
        token: process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN,
      });
    } catch (err2) {
      return ok(500, {
        ok: false,
        error: "Blob store unavailable: " + (err2.message || err.message),
      });
    }
  }

  const qs = event.queryStringParameters || {};
  let path = (qs.path || "").replace(/^\//, "").replace(/\/$/, "");
  if (!path) path = "scores";

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return ok(400, { ok: false, error: "Invalid JSON" });
    }
  }

  try {
    // ---- SCORES ----
    if (path === "scores" || path === "leaderboard") {
      if (event.httpMethod === "GET") {
        const trackId = qs.trackId || "";
        const limit = Math.min(50, Math.max(5, parseInt(qs.limit || "20", 10)));
        let list = await getScores(store);
        if (trackId) list = list.filter((s) => s.trackId === trackId);
        list.sort((a, b) => a.time - b.time || a.place - b.place);
        return ok(200, { ok: true, scores: list.slice(0, limit) });
      }
      if (event.httpMethod === "POST") {
        const row = scoreRow(body);
        if (!row) return ok(400, { ok: false, error: "Invalid score" });
        let list = await getScores(store);
        list.push(row);
        list.sort((a, b) => a.time - b.time || a.place - b.place);
        list = list.slice(0, MAX_SCORES);
        await saveScores(store, list);
        const rank =
          list
            .filter((s) => !body.trackId || s.trackId === row.trackId)
            .findIndex((s) => s.id === row.id) + 1;
        return ok(200, { ok: true, score: row, rank });
      }
    }

    // ---- H2H ----
    if (path === "h2h") {
      if (event.httpMethod === "GET") {
        const code = (qs.code || "").toUpperCase();
        const room = await getRoom(store, code);
        if (!room) return ok(404, { ok: false, error: "Room not found" });
        if (Date.now() - room.createdAt > ROOM_TTL_HOURS * 3600 * 1000) {
          return ok(410, { ok: false, error: "Room expired" });
        }
        return ok(200, { ok: true, room: roomPublic(room) });
      }

      if (event.httpMethod === "POST") {
        const act = body.action || qs.action || "";

        if (act === "create") {
          let code = code4();
          for (let i = 0; i < 8; i++) {
            if (!(await getRoom(store, code))) break;
            code = code4();
          }
          const room = {
            code,
            status: "waiting",
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
          return ok(200, { ok: true, room: roomPublic(room), role: "host" });
        }

        if (act === "join") {
          const code = String(body.code || "").toUpperCase();
          const room = await getRoom(store, code);
          if (!room) return ok(404, { ok: false, error: "Room not found" });
          if (room.guest) return ok(409, { ok: false, error: "Room full" });
          if (room.status !== "waiting" && room.status !== "ready") {
            return ok(409, { ok: false, error: "Race already started" });
          }
          room.guest = { name: cleanName(body.guestName || body.name), ready: false };
          room.status = "ready";
          await saveRoom(store, room);
          return ok(200, { ok: true, room: roomPublic(room), role: "guest" });
        }

        if (act === "ready") {
          const code = String(body.code || "").toUpperCase();
          const role = body.role === "guest" ? "guest" : "host";
          const room = await getRoom(store, code);
          if (!room) return ok(404, { ok: false, error: "Room not found" });
          if (role === "host" && room.host) room.host.ready = !!body.ready;
          if (role === "guest" && room.guest) room.guest.ready = !!body.ready;
          if (room.host?.ready && room.guest?.ready) {
            room.status = "racing";
            room.raceStartedAt = Date.now();
          }
          await saveRoom(store, room);
          return ok(200, { ok: true, room: roomPublic(room) });
        }

        if (act === "finish") {
          const code = String(body.code || "").toUpperCase();
          const role = body.role === "guest" ? "guest" : "host";
          const room = await getRoom(store, code);
          if (!room) return ok(404, { ok: false, error: "Room not found" });
          const time = Number(body.time);
          if (!isFinite(time) || time <= 0) return ok(400, { ok: false, error: "Invalid time" });
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
          }
          await saveRoom(store, room);

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

          return ok(200, { ok: true, room: roomPublic(room) });
        }

        return ok(400, { ok: false, error: "Unknown H2H action: " + act });
      }
    }

    return ok(404, { ok: false, error: "Not found", path });
  } catch (err) {
    console.error(err);
    return ok(500, { ok: false, error: err.message || "Server error" });
  }
};
