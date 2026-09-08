// ====== FILL THESE IN AFTER YOU DEPLOY THE WORKER (see README step 4) ======
const WORKER_URL = "https://REPLACE-ME.your-subdomain.workers.dev";
const VAPID_PUBLIC_KEY = "REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY";
const APP_SECRET = "REPLACE_WITH_A_PASSWORD_YOU_MAKE_UP"; // must match AUTH_TOKEN secret on the Worker
// =============================================================================

// Edit this list to add/remove the teams that show up in the "Teams" tab.
// The "id" is only used locally to remember your picks — it doesn't need to
// match any API's internal ID. Note: Champions League isn't a pickable
// group here on purpose — you get notified for every CL match regardless
// of team picks (see scripts/check-fixtures.mjs), so there's nothing to
// choose. If a team you pick never shows a match, open fixtures.json after
// a run and check the exact spelling Highlightly uses for that team.
const LEAGUES = [
  {
    name: "Premier League",
    teams: [
      "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
      "Chelsea", "Crystal Palace", "Everton", "Fulham", "Ipswich Town",
      "Leicester City", "Liverpool", "Manchester City", "Manchester United",
      "Newcastle United", "Nottingham Forest", "Southampton", "Tottenham Hotspur",
      "West Ham United", "Wolverhampton Wanderers",
    ],
  },
  {
    name: "La Liga",
    teams: [
      "Real Madrid", "Barcelona", "Atletico Madrid", "Real Sociedad", "Real Betis",
      "Villarreal", "Athletic Club", "Sevilla", "Valencia", "Girona", "Celta Vigo",
    ],
  },
  {
    name: "Serie A",
    teams: [
      "Inter", "AC Milan", "Juventus", "Napoli", "Roma", "Lazio",
      "Atalanta", "Fiorentina", "Bologna", "Torino",
    ],
  },
  {
    name: "Bundesliga",
    teams: [
      "Bayern Munich", "Borussia Dortmund", "RB Leipzig", "Bayer Leverkusen",
      "Eintracht Frankfurt", "VfB Stuttgart", "Wolfsburg", "Borussia Monchengladbach",
    ],
  },
  {
    name: "Ligue 1",
    teams: [
      "Paris Saint-Germain", "Marseille", "Monaco", "Lyon", "Lille", "Lens", "Nice", "Rennes",
    ],
  },
  {
    name: "NBA",
    teams: [
      "Toronto Raptors", "Boston Celtics", "Los Angeles Lakers", "Golden State Warriors",
      "Milwaukee Bucks", "Denver Nuggets", "Phoenix Suns", "Miami Heat",
      "Philadelphia 76ers", "New York Knicks", "Dallas Mavericks", "Oklahoma City Thunder",
    ],
  },
];

const state = {
  selectedTeams: JSON.parse(localStorage.getItem("matchday.teams") || "[]"),
  fixtures: [],
};

// ---------- Tab switching ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.view).classList.add("active");
  });
});

// ---------- Clock ----------
function tickClock() {
  const el = document.getElementById("clock");
  el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
setInterval(tickClock, 1000 * 15);
tickClock();

// ---------- Team picker ----------
function renderTeamPicker() {
  const root = document.getElementById("league-groups");
  root.innerHTML = "";
  LEAGUES.forEach((league) => {
    const group = document.createElement("div");
    group.className = "league-group";
    const h3 = document.createElement("h3");
    h3.textContent = league.name;
    group.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "chip-grid";
    league.teams.forEach((team) => {
      const chip = document.createElement("button");
      chip.className = "chip" + (state.selectedTeams.includes(team) ? " selected" : "");
      chip.textContent = team;
      chip.addEventListener("click", () => toggleTeam(team, chip));
      grid.appendChild(chip);
    });
    group.appendChild(grid);
    root.appendChild(group);
  });
}

function toggleTeam(team, chipEl) {
  const idx = state.selectedTeams.indexOf(team);
  if (idx >= 0) {
    state.selectedTeams.splice(idx, 1);
    chipEl.classList.remove("selected");
  } else {
    state.selectedTeams.push(team);
    chipEl.classList.add("selected");
  }
  localStorage.setItem("matchday.teams", JSON.stringify(state.selectedTeams));
  syncSubscription(); // keep the backend's team list in sync so reminders match your picks
  renderFixtures();
}

// ---------- Fixtures ----------
async function loadFixtures() {
  try {
    const res = await fetch(`fixtures.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("no fixtures.json yet");
    const data = await res.json();
    state.fixtures = data.matches || [];
  } catch (e) {
    state.fixtures = [];
  }
  renderFixtures();
}

function renderFixtures() {
  const hero = document.getElementById("hero");
  const list = document.getElementById("fixture-list");

  const mine = state.fixtures
    .filter((m) => m.allNotify || state.selectedTeams.includes(m.home) || state.selectedTeams.includes(m.away))
    .filter((m) => new Date(m.utcKickoff).getTime() > Date.now())
    .sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));

  if (state.selectedTeams.length === 0) {
    hero.innerHTML = `<div class="empty hero">No teams picked yet. Head to the Teams tab to choose who you follow.</div>`;
    list.innerHTML = `<div class="empty-state">Nothing here yet — pick some teams in the Teams tab.</div>`;
    return;
  }

  if (mine.length === 0) {
    hero.innerHTML = `<div class="empty hero">No upcoming matches found for your teams right now.</div>`;
    list.innerHTML = `<div class="empty-state">Check back closer to matchday, or add more teams.</div>`;
    return;
  }

  const next = mine[0];
  hero.innerHTML = renderHero(next);
  list.innerHTML = mine
    .slice(1, 15)
    .map(
      (m) => `
      <div class="fixture-row">
        <div class="time-col">${formatDayTime(m.utcKickoff)}</div>
        <div class="match-col">${m.home} vs ${m.away}</div>
        <div class="comp-col">${m.competition}</div>
      </div>`
    )
    .join("") || `<div class="empty-state">That's everything on the schedule for now.</div>`;
}

function renderHero(m) {
  const mins = Math.round((new Date(m.utcKickoff).getTime() - Date.now()) / 60000);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  const countdown = hrs > 0 ? `${hrs}h ${remMins}m` : `${mins}m`;
  const lineupBit = m.lineupsAvailable
    ? `<div class="lineup-pill">Lineups are in — open to view</div>`
    : "";
  return `
    <div class="eyebrow">Next up · ${m.competition}</div>
    <div class="teams">
      <span>${m.home}</span>
      <span class="vs">vs</span>
      <span>${m.away}</span>
    </div>
    <div class="countdown">
      <span class="num">${countdown}</span>
      <span class="label">until kickoff</span>
    </div>
    <div class="meta">${new Date(m.utcKickoff).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>
    ${lineupBit}
  `;
}

function formatDayTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------- Push notifications ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function isSubscribed() {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

async function enableNotifications() {
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("Notifications were blocked — you can turn them back on in iPhone Settings > Notifications > Matchday.");
    return;
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await syncSubscription(sub);
  document.getElementById("enable-banner").style.display = "none";
}

async function syncSubscription(explicitSub) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = explicitSub || (reg && (await reg.pushManager.getSubscription()));
    if (!sub) return; // nothing to sync yet — that's fine
    await fetch(`${WORKER_URL}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Secret": APP_SECRET },
      body: JSON.stringify({ subscription: sub, teams: state.selectedTeams }),
    });
  } catch (e) {
    console.warn("Could not sync with worker yet:", e);
  }
}

// ---------- Boot ----------
async function boot() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("sw.js");
  }
  renderTeamPicker();
  await loadFixtures();
  setInterval(loadFixtures, 60 * 1000);
  setInterval(renderFixtures, 30 * 1000); // keep the countdown ticking

  const subscribed = await isSubscribed();
  document.getElementById("enable-banner").style.display = subscribed ? "none" : "flex";
}

document.getElementById("enable-btn").addEventListener("click", enableNotifications);

boot();
