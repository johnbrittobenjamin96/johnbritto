// ====== FILL THESE IN AFTER YOU DEPLOY THE WORKER (see README step 4) ======
const WORKER_URL = "https://matchday-backend.johnbrittobenjamin96.workers.dev";
const VAPID_PUBLIC_KEY = "BFA9qq9hC0g07k8skBjEkOUJpvd8fVzHwlRaxnXOmFIZfd5n5BsGv10Gd1ibosrr-sUhFTpuiTpIZ2zkWgJeqbI";
const APP_SECRET = "7HDP3kqOfxyQFw7fYNJRk636lkRhn404";
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

// These two are always tracked for notifications, no matter what's picked
// in the Teams tab, and get their own dedicated toggle in the My Team tab.
const PINNED_TEAMS = ["Manchester United", "Real Madrid"];

const state = {
  selectedTeams: JSON.parse(localStorage.getItem("matchday.teams") || "[]"),
  myTeamView: localStorage.getItem("matchday.myTeamView") || PINNED_TEAMS[0],
  detailTeam: null, // whichever team was tapped into for the drill-in view
  fixtures: [],
};

// Make sure the pinned teams are always part of the saved selection, once.
PINNED_TEAMS.forEach((t) => {
  if (!state.selectedTeams.includes(t)) state.selectedTeams.push(t);
});
localStorage.setItem("matchday.teams", JSON.stringify(state.selectedTeams));

// ---------- View switching ----------
// showView also handles the drill-in team-detail screen, which isn't one of
// the bottom tabs — it just gets shown on top and "Back" returns to Teams.
function showView(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.getElementById("teamdetail-back").addEventListener("click", () => showView("view-teams"));

// Tapping any team name anywhere in the app (fixture rows, hero, lineup
// headers) opens that team's own fixture list. Event delegation means this
// works for team-link spans added anywhere, including ones inserted later.
document.body.addEventListener("click", (e) => {
  const link = e.target.closest(".team-link");
  if (link) openTeamDetail(link.dataset.team);
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
      const pinned = PINNED_TEAMS.includes(team);
      const chip = document.createElement("button");
      chip.className = "chip" + (state.selectedTeams.includes(team) || pinned ? " selected" : "");
      chip.textContent = pinned ? `${team} ★` : team;
      chip.addEventListener("click", () => openTeamDetail(team));
      grid.appendChild(chip);
    });
    group.appendChild(grid);
    root.appendChild(group);
  });
}

// chipEl is optional now — the notify toggle inside Team Detail calls this
// with no chip element, since it's not rendered from the Teams tab grid.
function toggleTeam(team, chipEl) {
  if (PINNED_TEAMS.includes(team)) return; // always on — see My Team tab
  const idx = state.selectedTeams.indexOf(team);
  if (idx >= 0) {
    state.selectedTeams.splice(idx, 1);
    if (chipEl) chipEl.classList.remove("selected");
  } else {
    state.selectedTeams.push(team);
    if (chipEl) chipEl.classList.add("selected");
  }
  localStorage.setItem("matchday.teams", JSON.stringify(state.selectedTeams));
  syncSubscription(); // keep the backend's team list in sync so reminders match your picks
  renderFixtures();
}

// ---------- Shared row/lineup rendering ----------
// A clickable team name. Used everywhere a team shows up so tapping it
// opens that team's own fixture list.
function teamLink(name) {
  return `<span class="team-link" data-team="${name}">${name}</span>`;
}

// focusTeam is optional: pass it when showing a single team's own list (so
// each row reads "vs Opponent (H)/(A)"); omit it for the mixed Fixtures tab
// (so each row reads "Team A (H) vs Team B (A)").
function fixtureRowHtml(m, focusTeam) {
  if (focusTeam) {
    const isHome = m.home === focusTeam;
    const opponent = isHome ? m.away : m.home;
    const tag = isHome ? "H" : "A";
    return `
      <div class="fixture-row">
        <div class="time-col">${formatDayTime(m.utcKickoff)}</div>
        <div class="match-col">vs ${teamLink(opponent)} <span class="side-tag">${tag}</span></div>
        <div class="comp-col">${m.competition}</div>
      </div>`;
  }
  return `
    <div class="fixture-row">
      <div class="time-col">${formatDayTime(m.utcKickoff)}</div>
      <div class="match-col">${teamLink(m.home)} <span class="side-tag">H</span> vs ${teamLink(m.away)} <span class="side-tag">A</span></div>
      <div class="comp-col">${m.competition}</div>
    </div>`;
}

function lineupBlockHtml(match) {
  if (!match.lineup) {
    return `<div class="empty-state">Lineups aren't out yet for this one — check back closer to kickoff.</div>`;
  }
  return `
    <div class="lineup-block">
      <div class="section-label">Starting lineups</div>
      <div class="lineup-sides">
        <div class="lineup-side">
          <h4>${teamLink(match.lineup.home.name)}</h4>
          ${match.lineup.home.formation ? `<div class="formation">${match.lineup.home.formation}</div>` : ""}
          <ol>${match.lineup.home.players.map((p) => `<li>${p}</li>`).join("")}</ol>
        </div>
        <div class="lineup-side">
          <h4>${teamLink(match.lineup.away.name)}</h4>
          ${match.lineup.away.formation ? `<div class="formation">${match.lineup.away.formation}</div>` : ""}
          <ol>${match.lineup.away.players.map((p) => `<li>${p}</li>`).join("")}</ol>
        </div>
      </div>
    </div>`;
}

// The full panel for "here's one team's world": next match + lineup +
// upcoming list. Shared by the My Team tab and the tap-any-team drill-in,
// so the two stay visually and behaviorally consistent.
function buildTeamPanelHtml(team, { showNotifyToggle }) {
  const upcoming = state.fixtures
    .filter((m) => m.home === team || m.away === team)
    .filter((m) => new Date(m.utcKickoff).getTime() > Date.now())
    .sort((a, b) => new Date(a.utcKickoff) - new Date(b.utcKickoff));

  const pinned = PINNED_TEAMS.includes(team);
  let header = `<div class="team-panel-header"><h2>${team}</h2>`;
  if (showNotifyToggle) {
    header += pinned
      ? `<span class="notify-badge">★ Always notified</span>`
      : `<button class="notify-toggle${state.selectedTeams.includes(team) ? " on" : ""}" id="notify-toggle-btn">${
          state.selectedTeams.includes(team) ? "Notifying ✓" : "Notify me"
        }</button>`;
  }
  header += `</div>`;

  if (upcoming.length === 0) {
    return `${header}<div class="hero empty">No upcoming ${team} matches on the schedule right now.</div>`;
  }

  const next = upcoming[0];
  let html = header + `<div class="hero">${renderHero(next)}</div>`;
  html += lineupBlockHtml(next);

  if (upcoming.length > 1) {
    html += `<div class="section-label">Also coming up</div><div class="fixture-list">`;
    html += upcoming.slice(1, 8).map((m) => fixtureRowHtml(m, team)).join("");
    html += `</div>`;
  }
  return html;
}

// ---------- Fixtures tab ----------
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
  renderMyTeam();
  if (state.detailTeam) renderTeamDetail();
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
  list.innerHTML = mine.slice(1, 15).map((m) => fixtureRowHtml(m)).join("") ||
    `<div class="empty-state">That's everything on the schedule for now.</div>`;
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
      <span>${teamLink(m.home)} <span class="side-tag">H</span></span>
      <span class="vs">vs</span>
      <span>${teamLink(m.away)} <span class="side-tag">A</span></span>
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

// ---------- My Team tab (pinned toggle) ----------
function renderMyTeamToggle() {
  const root = document.getElementById("myteam-toggle");
  root.innerHTML = "";
  PINNED_TEAMS.forEach((team) => {
    const btn = document.createElement("button");
    btn.textContent = team;
    btn.className = team === state.myTeamView ? "active" : "";
    btn.addEventListener("click", () => {
      state.myTeamView = team;
      localStorage.setItem("matchday.myTeamView", team);
      renderMyTeam();
    });
    root.appendChild(btn);
  });
}

function renderMyTeam() {
  renderMyTeamToggle();
  document.getElementById("myteam-content").innerHTML = buildTeamPanelHtml(state.myTeamView, { showNotifyToggle: false });
}

// ---------- Team Detail (tap any team, anywhere) ----------
function openTeamDetail(team) {
  state.detailTeam = team;
  renderTeamDetail();
  showView("view-teamdetail");
}

function renderTeamDetail() {
  const team = state.detailTeam;
  const content = document.getElementById("teamdetail-content");
  content.innerHTML = buildTeamPanelHtml(team, { showNotifyToggle: true });

  const notifyBtn = document.getElementById("notify-toggle-btn");
  if (notifyBtn) {
    notifyBtn.addEventListener("click", () => {
      toggleTeam(team);
      renderTeamPicker(); // keep the Teams tab chip grid in sync for when you go back
      renderTeamDetail();
    });
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
  setInterval(() => {
    renderFixtures();
    renderMyTeam();
    if (state.detailTeam) renderTeamDetail();
  }, 30 * 1000); // keep the countdown ticking

  const subscribed = await isSubscribed();
  document.getElementById("enable-banner").style.display = subscribed ? "none" : "flex";
  if (subscribed) await syncSubscription(); // push the (possibly updated) team list, e.g. newly pinned teams
}

document.getElementById("enable-btn").addEventListener("click", enableNotifications);

boot();
