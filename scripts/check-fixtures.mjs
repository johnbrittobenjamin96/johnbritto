// Runs on a GitHub Actions schedule (see .github/workflows/check-fixtures.yml).
//
// Tracks two independent sports, each its OWN Highlightly product with its
// OWN API key and its OWN separate 100/day free quota — so a busy NBA night
// can't eat into football's budget, or vice versa:
//   - football: soccer.highlightly.net   (PL, La Liga, Serie A, Bundesliga,
//                                          Ligue 1, Champions League)
//   - basketball: nba.highlightly.net    (NBA)
//
// Notification rules (per your spec):
//   - Domestic leagues + NBA: only notify for teams you've picked.
//   - Champions League: notify for EVERY match, regardless of team picks.
//
// Two-stage push, because that's how the underlying data actually becomes
// available:
//   1. "Kickoff in ~1 hour"  — always fires, ~60 min before kickoff.
//   2. "Lineups are in"      — a follow-up once Highlightly actually has
//      them. Football: queryable from 40 min before kickoff. Basketball:
//      Highlightly's own docs just say "up to a few hours before" — no
//      precise window — so that check runs over a wider range and simply
//      stops once a lineup is found.

import webpush from "web-push";
import fs from "node:fs/promises";

const {
  WORKER_URL,
  WORKER_SECRET,
  HIGHLIGHTLY_FOOTBALL_KEY,
  HIGHLIGHTLY_NBA_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
} = process.env;

const LOOKAHEAD_DAYS = 4; // how far ahead to pull the schedule
const SCHEDULE_REFRESH_HOURS = 8; // don't re-pull the full schedule more often than this (saves quota)
const KICKOFF_WINDOW_MIN = [50, 70]; // "kickoff in ~1h" fires in this range, for every sport

webpush.setVapidDetails(VAPID_SUBJECT || "mailto:you@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ---------------------------------------------------------------------------
// Sport definitions. Add a league by adding to a sport's `leagues` array.
// Add a whole new sport by copying one of these blocks.
// ---------------------------------------------------------------------------

const SPORTS = [
  {
    id: "football",
    base: "https://soccer.highlightly.net",
    apiKey: HIGHLIGHTLY_FOOTBALL_KEY,
    resolveLeague: true, // /matches needs a numeric leagueId — resolved + cached from leagueName
    lineupWindowMin: [-10, 40], // Highlightly: lineups queryable from 40 min before kickoff
    leagues: [
      { key: "PL", leagueName: "Premier League", countryName: "England", notifyMode: "selected" },
      { key: "LALIGA", leagueName: "La Liga", countryName: "Spain", notifyMode: "selected" },
      { key: "SERIEA", leagueName: "Serie A", countryName: "Italy", notifyMode: "selected" },
      { key: "BUNDESLIGA", leagueName: "Bundesliga", countryName: "Germany", notifyMode: "selected" },
      { key: "LIGUE1", leagueName: "Ligue 1", countryName: "France", notifyMode: "selected" },
      { key: "CL", leagueName: "UEFA Champions League", notifyMode: "all" },
    ],
    parseMatch: (m) => ({
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      utcKickoff: m.date,
      competition: m.league?.name,
    }),
    parseLineup: (data) => {
      const flat = (t) => (t?.initialLineup || []).flat().map((p) => p.name);
      const home = flat(data.homeTeam);
      const away = flat(data.awayTeam);
      if (home.length === 0 && away.length === 0) return null;
      return {
        home: { name: data.homeTeam?.name, formation: data.homeTeam?.formation, players: home },
        away: { name: data.awayTeam?.name, formation: data.awayTeam?.formation, players: away },
      };
    },
  },
  {
    id: "basketball",
    base: "https://nba.highlightly.net",
    apiKey: HIGHLIGHTLY_NBA_KEY,
    resolveLeague: false, // takes a plain league=NBA string, no id lookup needed
    lineupWindowMin: [-10, 90], // no documented precise window — check a wider range, stop once found
    leagues: [{ key: "NBA", league: "NBA", notifyMode: "selected" }],
    parseMatch: (m) => ({
      home: m.homeTeam?.displayName,
      away: m.awayTeam?.displayName,
      utcKickoff: m.date,
      competition: m.league,
    }),
    parseLineup: (data) => {
      const starters = (side) => (side?.lineup || []).filter((p) => p.isStarter).map((p) => p.player);
      const home = starters(data.home);
      const away = starters(data.away);
      if (home.length === 0 && away.length === 0) return null;
      return {
        home: { name: data.home?.team?.displayName, players: home },
        away: { name: data.away?.team?.displayName, players: away },
      };
    },
  },
].filter((sport) => !!sport.apiKey); // skip a sport entirely if you haven't set up its key yet

// ---------------------------------------------------------------------------

async function hlGet(sport, path, params) {
  const url = new URL(sport.base + path);
  Object.entries(params || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { "x-rapidapi-key": sport.apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[${sport.id}] ${path} failed: ${res.status} ${text.slice(0, 150)}`);
  }
  return res.json();
}

async function loadJsonSafe(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function getState() {
  const res = await fetch(`${WORKER_URL}/state`, { headers: { "X-App-Secret": WORKER_SECRET } });
  if (!res.ok) throw new Error(`worker /state failed: ${res.status}`);
  return res.json();
}

async function getNotifiedIds() {
  const res = await fetch(`${WORKER_URL}/notified`, { headers: { "X-App-Secret": WORKER_SECRET } });
  if (!res.ok) return [];
  return (await res.json()).ids || [];
}

async function markNotified(tag) {
  await fetch(`${WORKER_URL}/mark-notified`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Secret": WORKER_SECRET },
    body: JSON.stringify({ matchId: tag }),
  });
}

async function resolveLeagueIds(sport, cache) {
  cache[sport.id] = cache[sport.id] || {};
  for (const league of sport.leagues) {
    if (!sport.resolveLeague || cache[sport.id][league.key]?.id) continue;
    try {
      const resp = await hlGet(sport, "/leagues", { leagueName: league.leagueName, countryName: league.countryName });
      const found = (resp.data || [])[0];
      if (!found) {
        console.warn(`Could not resolve league "${league.leagueName}" (${sport.id}) — check the name/country spelling against Highlightly's /leagues list.`);
        continue;
      }
      cache[sport.id][league.key] = { id: found.id, name: found.name };
    } catch (err) {
      console.warn(`League resolve failed for ${league.leagueName}: ${err.message}`);
    }
  }
  return cache;
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchScheduleForSport(sport, leagueCache) {
  const all = [];
  for (const league of sport.leagues) {
    const primaryParam = sport.resolveLeague
      ? { leagueId: leagueCache[sport.id]?.[league.key]?.id }
      : { league: league.league };
    if (sport.resolveLeague && !primaryParam.leagueId) continue;

    for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
      const d = new Date(Date.now() + i * 86400000);
      let resp;
      try {
        resp = await hlGet(sport, "/matches", { ...primaryParam, date: dateStr(d) });
      } catch (err) {
        console.warn(err.message);
        continue;
      }
      for (const m of resp.data || []) {
        const parsed = sport.parseMatch(m);
        all.push({
          id: `${sport.id}-${m.id}`,
          sport: sport.id,
          rawId: m.id,
          utcKickoff: parsed.utcKickoff,
          competition: parsed.competition,
          home: parsed.home,
          away: parsed.away,
          allNotify: league.notifyMode === "all",
        });
      }
    }
  }
  return all;
}

async function fetchLineupSummary(sport, rawId) {
  try {
    const data = await hlGet(sport, `/lineups/${rawId}`);
    return sport.parseLineup(data);
  } catch (err) {
    console.warn(err.message);
    return null;
  }
}

function minutesUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 60000;
}

async function sendPush(subscription, title, body, tag) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, tag, url: "./" }));
    await markNotified(tag);
    console.log(`Sent: ${title} — ${body}`);
  } catch (err) {
    console.error(`Push failed for ${tag}:`, err.message);
    // A 410 Gone usually means the subscription expired — reopen the app
    // and tap "Enable" again to resubscribe.
  }
}

async function main() {
  if (SPORTS.length === 0) {
    console.log("No sport API keys configured yet — nothing to do.");
    return;
  }

  const state = await getState();
  const teams = state.teams || [];
  const subscription = state.subscription;

  let leagueCache = await loadJsonSafe("scripts/leagues-cache.json", {});
  let lastRefresh = await loadJsonSafe("scripts/last-refresh.json", {});
  let fixturesBySport = await loadJsonSafe("scripts/fixtures-by-sport.json", {});

  for (const sport of SPORTS) {
    leagueCache = await resolveLeagueIds(sport, leagueCache);

    const lastAt = lastRefresh[sport.id];
    const hoursSince = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 3600000 : Infinity;

    if (hoursSince >= SCHEDULE_REFRESH_HOURS) {
      console.log(`[${sport.id}] refreshing schedule...`);
      fixturesBySport[sport.id] = await fetchScheduleForSport(sport, leagueCache);
      lastRefresh[sport.id] = new Date().toISOString();
    } else {
      console.log(`[${sport.id}] refreshed ${hoursSince.toFixed(1)}h ago — using cache.`);
    }
  }

  await fs.writeFile("scripts/leagues-cache.json", JSON.stringify(leagueCache, null, 2));
  await fs.writeFile("scripts/last-refresh.json", JSON.stringify(lastRefresh, null, 2));
  await fs.writeFile("scripts/fixtures-by-sport.json", JSON.stringify(fixturesBySport, null, 2));

  const allFixtures = Object.values(fixturesBySport).flat();
  await fs.writeFile(
    "docs/fixtures.json",
    JSON.stringify(
      { generatedAt: new Date().toISOString(), matches: allFixtures.sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff)) },
      null,
      2
    )
  );

  if (!subscription) {
    console.log("No push subscription yet — schedule refreshed, skipping notification check.");
    return;
  }

  const mine = allFixtures.filter((m) => m.allNotify || teams.includes(m.home) || teams.includes(m.away));
  const alreadyNotified = await getNotifiedIds();
  const sportById = Object.fromEntries(SPORTS.map((s) => [s.id, s]));

  for (const match of mine) {
    const mins = minutesUntil(match.utcKickoff);
    const sport = sportById[match.sport];
    if (!sport) continue;

    const kickoffTag = `${match.id}-kickoff`;
    if (mins >= KICKOFF_WINDOW_MIN[0] && mins <= KICKOFF_WINDOW_MIN[1] && !alreadyNotified.includes(kickoffTag)) {
      await sendPush(subscription, "Kickoff in ~1 hour", `${match.home} vs ${match.away} kicks off in about an hour.`, kickoffTag);
    }

    const lineupTag = `${match.id}-lineup`;
    const [lo, hi] = sport.lineupWindowMin;
    if (mins >= lo && mins <= hi && !alreadyNotified.includes(lineupTag)) {
      const lineup = await fetchLineupSummary(sport, match.rawId);
      if (lineup) {
        const body = `${lineup.home.name} vs ${lineup.away.name} — starting lineups are out. Open the app for the full list.`;
        await sendPush(subscription, "Lineups are in", body, lineupTag);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
