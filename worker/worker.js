// Matchday backend — a single Cloudflare Worker.
// Stores exactly one user's push subscription + chosen teams (this whole
// project is built for one person, so there's no login system — just a
// shared secret header instead of real auth).
//
// Routes:
//   GET  /vapid-public-key         -> public, no auth needed
//   POST /subscribe                -> body: { subscription, teams }   (from the PWA)
//   GET  /state                    -> returns { subscription, teams } (used by GitHub Actions)
//   POST /mark-notified            -> body: { matchId }               (used by GitHub Actions)
//   GET  /notified                 -> returns already-notified match ids in the last 48h

function checkAuth(request, env) {
  return request.headers.get("X-App-Secret") === env.AUTH_TOKEN;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
        },
      });
    }

    if (url.pathname === "/vapid-public-key" && request.method === "GET") {
      return json({ publicKey: env.VAPID_PUBLIC_KEY });
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
      const body = await request.json();
      await env.MATCHDAY_KV.put(
        "state",
        JSON.stringify({ subscription: body.subscription, teams: body.teams || [] })
      );
      return json({ ok: true });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
      const raw = await env.MATCHDAY_KV.get("state");
      return json(raw ? JSON.parse(raw) : { subscription: null, teams: [] });
    }

    if (url.pathname === "/mark-notified" && request.method === "POST") {
      if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
      const body = await request.json();
      const raw = await env.MATCHDAY_KV.get("notified");
      const list = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const pruned = list.filter((n) => now - n.at < 48 * 60 * 60 * 1000);
      pruned.push({ id: body.matchId, at: now });
      await env.MATCHDAY_KV.put("notified", JSON.stringify(pruned));
      return json({ ok: true });
    }

    if (url.pathname === "/notified" && request.method === "GET") {
      if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
      const raw = await env.MATCHDAY_KV.get("notified");
      const list = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const pruned = list.filter((n) => now - n.at < 48 * 60 * 60 * 1000);
      return json({ ids: pruned.map((n) => n.id) });
    }

    return json({ error: "not found" }, 404);
  },
};
