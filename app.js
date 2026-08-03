// ---------- SUPABASE ----------
const supabaseClient = (window.supabase && SUPABASE_CONFIG && SUPABASE_CONFIG.url
  && SUPABASE_CONFIG.url !== "YOUR_SUPABASE_PROJECT_URL")
  ? window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
  : null;

let currentUser = null;
let myReferralCode = null;
let myReferralCount = 0;
let myBonusXP = 0;
let myReferredBy = null;

// ---------- STATE ----------
const STORAGE_KEY = 'lifequest_state_v1';
const EMPTY_STATE = () => ({ experiences: {}, countries: {}, profile: {}, journal: [], timeline: [] });

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  return EMPTY_STATE();
}
function cacheLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let saveTimer = null;
function saveState() {
  cacheLocal();
  if (!supabaseClient || !currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await supabaseClient.from('progress').upsert({
        user_id: currentUser.id,
        display_name: state.profile.name || null,
        data: state,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Cloud save failed (kept locally):', err);
    }
  }, 600);
}

let state = loadLocalState();

const RARITY_XP = { Common: 10, Rare: 50, Epic: 100, Legendary: 250 };

// ---------- DERIVED DATA HELPERS (all accept an optional state object, default = current user) ----------
function isCompletedFor(st, expId) {
  return !!(st.experiences[expId] && st.experiences[expId].completed);
}
function isVisitedFor(st, countryName) {
  return !!(st.countries[countryName] && st.countries[countryName].visited);
}
function isCompleted(expId) { return isCompletedFor(state, expId); }
function isVisited(countryName) { return isVisitedFor(state, countryName); }

function totalXPFor(st) {
  let xp = 0;
  for (const e of LQ_DATA.experiences) {
    if (isCompletedFor(st, e.id)) xp += RARITY_XP[e.rarity] || 0;
  }
  return xp;
}
function totalXP() { return totalXPFor(state) + myBonusXP; }

function currentLevelInfo(xp) {
  let current = LQ_DATA.levels[0];
  for (const lvl of LQ_DATA.levels) {
    if (xp >= lvl.xpRequired) current = lvl; else break;
  }
  const idx = LQ_DATA.levels.findIndex(l => l.level === current.level);
  const next = LQ_DATA.levels[idx + 1] || null;
  return { current, next };
}
function completedCountFor(st) {
  return LQ_DATA.experiences.filter(e => isCompletedFor(st, e.id)).length;
}
function completedCount() { return completedCountFor(state); }
function visitedCountFor(st) {
  return LQ_DATA.countries.filter(c => isVisitedFor(st, c.name)).length;
}
function visitedCount() { return visitedCountFor(state); }
function categoryCompletionCounts() {
  const counts = {};
  for (const cat of LQ_DATA.meta.categories) counts[cat] = 0;
  for (const e of LQ_DATA.experiences) {
    if (isCompleted(e.id)) counts[e.category] = (counts[e.category] || 0) + 1;
  }
  return counts;
}
function continentVisitCounts() {
  const continents = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];
  const counts = {};
  for (const c of continents) counts[c] = 0;
  for (const c of LQ_DATA.countries) {
    if (isVisited(c.name)) counts[c.continent] = (counts[c.continent] || 0) + 1;
  }
  return counts;
}
function favoriteCategory() {
  const counts = categoryCompletionCounts();
  let best = null, bestCount = 0;
  for (const [cat, n] of Object.entries(counts)) {
    if (n > bestCount) { best = cat; bestCount = n; }
  }
  return bestCount > 0 ? best : 'None yet';
}

// ---------- ACHIEVEMENT EVALUATION ----------
function achievementProgress(a) {
  const completedExps = LQ_DATA.experiences.filter(e => isCompleted(e.id));
  switch (a.kind) {
    case 'countryCount':
      return visitedCount();
    case 'everyContinent': {
      const counts = continentVisitCounts();
      return Object.values(counts).filter(n => n > 0).length;
    }
    case 'extremeCount':
      return completedExps.filter(e => e.difficulty === 'Extreme').length;
    case 'nameContains': {
      const kws = a.keywords.map(k => k.toLowerCase());
      return completedExps.filter(e => kws.some(k => e.name.toLowerCase().includes(k))).length;
    }
    case 'categoryCount':
      return completedExps.filter(e => e.category === a.cat).length;
    case 'totalCompleted':
      return completedExps.length;
    case 'totalXP':
      return totalXP();
    case 'extremeDistinctCategories': {
      const cats = new Set(completedExps.filter(e => e.difficulty === 'Extreme').map(e => e.category));
      return cats.size;
    }
    case 'distinctDifficulties': {
      const diffs = new Set(completedExps.map(e => e.difficulty));
      return diffs.size;
    }
    case 'rarityCount':
      return completedExps.filter(e => e.rarity === a.rarity).length;
    case 'costCount':
      return completedExps.filter(e => e.cost === a.cost).length;
    case 'distinctCategoriesAll': {
      const cats = new Set(completedExps.map(e => e.category));
      return cats.size;
    }
    case 'referralCount':
      return myReferralCount;
    default:
      return 0;
  }
}
function achievementsUnlockedList() {
  return LQ_DATA.achievements.map(a => ({
    ...a,
    progress: achievementProgress(a),
    unlocked: achievementProgress(a) >= a.target,
  }));
}

// ---------- RENDER: DASHBOARD ----------
let categoryChart = null, continentChart = null;

function renderDashboard() {
  const xp = totalXP();
  const { current, next } = currentLevelInfo(xp);
  const completed = completedCount();
  const total = LQ_DATA.experiences.length;
  const visited = visitedCount();
  const countryTotal = LQ_DATA.countries.length;

  document.getElementById('stat-level').textContent = current.level;
  document.getElementById('stat-rank').textContent = current.rank;
  document.getElementById('stat-xp').textContent = xp.toLocaleString();
  document.getElementById('stat-xp-next').textContent = next
    ? `${(next.xpRequired - xp).toLocaleString()} XP to next level`
    : 'Max level reached';
  document.getElementById('stat-completed').firstChild.textContent = completed;
  document.getElementById('stat-completed-of').textContent = `/${total}`;
  document.getElementById('stat-completion-rate').textContent =
    `${total ? ((completed / total) * 100).toFixed(1) : 0}% complete`;
  document.getElementById('stat-countries').firstChild.textContent = visited;
  document.getElementById('stat-countries-of').textContent = `/${countryTotal}`;
  document.getElementById('stat-fav-category').textContent = `Favorite category: ${favoriteCategory()}`;

  let pct = 0;
  if (next) {
    pct = Math.max(0, Math.min(1, (xp - current.xpRequired) / (next.xpRequired - current.xpRequired)));
  } else {
    pct = 1;
  }
  document.getElementById('progress-fill').style.width = `${(pct * 100).toFixed(1)}%`;
  document.getElementById('progress-pct').textContent = `${(pct * 100).toFixed(0)}%`;

  const catCounts = categoryCompletionCounts();
  const catLabels = Object.keys(catCounts);
  const catValues = Object.values(catCounts);
  const contCounts = continentVisitCounts();

  if (typeof Chart === 'undefined') {
    document.querySelectorAll('.chart-card').forEach(card => {
      const existing = card.querySelector('.chart-fallback-msg');
      if (existing) existing.remove();
      card.insertAdjacentHTML('beforeend', '<p class="sub chart-fallback-msg">Charts unavailable offline — data still tracked below.</p>');
    });
  } else {
    try {
      const ctxCat = document.getElementById('chart-category').getContext('2d');
      if (categoryChart) categoryChart.destroy();
      categoryChart = new Chart(ctxCat, {
        type: 'bar',
        data: { labels: catLabels, datasets: [{ data: catValues, backgroundColor: '#C79B3B', borderRadius: 4 }] },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#9BAE9F' }, grid: { color: 'rgba(237,230,214,0.06)' } },
            y: { ticks: { color: '#EDE6D6', font: { size: 11 } }, grid: { display: false } }
          }
        }
      });

      const ctxCont = document.getElementById('chart-continent').getContext('2d');
      if (continentChart) continentChart.destroy();
      continentChart = new Chart(ctxCont, {
        type: 'bar',
        data: {
          labels: Object.keys(contCounts),
          datasets: [{ data: Object.values(contCounts), backgroundColor: '#3E7C74', borderRadius: 4 }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#9BAE9F', font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: '#9BAE9F' }, grid: { color: 'rgba(237,230,214,0.06)' } }
          }
        }
      });
    } catch (err) {
      console.error('Chart rendering failed:', err);
    }
  }

  const unlocked = achievementsUnlockedList().filter(a => a.unlocked);
  const teaser = document.getElementById('recent-achievements');
  teaser.innerHTML = unlocked.length
    ? unlocked.slice(-5).reverse().map(a => badgeHTML(a)).join('')
    : '<p class="sub">Complete experiences and visit countries to start unlocking achievements.</p>';
}

// ---------- RENDER: EXPERIENCES ----------
function rarityTagClass(r) {
  return 'tag-rarity-' + r.toLowerCase();
}
function experienceCardHTML(e) {
  const completed = isCompleted(e.id);
  const rec = state.experiences[e.id] || {};
  const photoBlock = completed ? (
    rec.photoUrl
      ? `<img src="${rec.photoUrl}" class="item-photo-thumb" alt="Memory photo">`
      : `<label class="item-photo-btn">📷 Add photo<input type="file" accept="image/*" class="photo-input" data-id="${e.id}" style="display:none;"></label>`
  ) : '';
  return `
  <div class="list-item ${completed ? 'completed' : ''}" data-id="${e.id}">
    <input type="checkbox" class="exp-check" data-id="${e.id}" ${completed ? 'checked' : ''}>
    <div>
      <div class="item-name">${e.name}</div>
      <div class="item-tags">
        <span class="tag tag-cat">${e.category}</span>
        <span class="tag tag-diff">${e.difficulty}</span>
        <span class="tag tag-diff">${e.cost}</span>
        <span class="tag tag-diff">${e.season}</span>
        <span class="tag ${rarityTagClass(e.rarity)}">${e.rarity}</span>
      </div>
      ${photoBlock}
    </div>
    <div class="item-xp">+${RARITY_XP[e.rarity]} XP</div>
  </div>`;
}
function populateSelectOnce(id, values, placeholder) {
  const sel = document.getElementById(id);
  if (sel.dataset.populated) return;
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  }
  sel.dataset.populated = '1';
}
function renderExperiences() {
  populateSelectOnce('exp-filter-category', LQ_DATA.meta.categories);
  populateSelectOnce('exp-filter-difficulty', LQ_DATA.meta.difficulties);
  populateSelectOnce('exp-filter-season', LQ_DATA.meta.seasons);

  const search = document.getElementById('exp-search').value.toLowerCase();
  const cat = document.getElementById('exp-filter-category').value;
  const diff = document.getElementById('exp-filter-difficulty').value;
  const status = document.getElementById('exp-filter-status').value;
  const season = document.getElementById('exp-filter-season').value;

  const chip = document.getElementById('track-filter-chip');
  if (activeTrackFilter) {
    chip.style.display = 'flex';
    chip.innerHTML = `Showing track: <strong>${activeTrackFilter.name}</strong> <button class="clear-track-btn">Clear</button>`;
  } else {
    chip.style.display = 'none';
  }

  const filtered = LQ_DATA.experiences.filter(e => {
    if (activeTrackFilter && !activeTrackFilter.ids.includes(e.id)) return false;
    if (search && !e.name.toLowerCase().includes(search)) return false;
    if (cat && e.category !== cat) return false;
    if (diff && e.difficulty !== diff) return false;
    if (season && e.season !== season) return false;
    if (status === 'completed' && !isCompleted(e.id)) return false;
    if (status === 'not-completed' && isCompleted(e.id)) return false;
    return true;
  });

  document.getElementById('experiences-list').innerHTML =
    filtered.map(experienceCardHTML).join('') || '<p class="sub">No experiences match those filters.</p>';
}

// ---------- RENDER: COUNTRIES ----------
function countryCardHTML(c) {
  const visited = isVisited(c.name);
  return `
  <div class="list-item ${visited ? 'completed' : ''}" data-name="${c.name}">
    <input type="checkbox" class="country-check" data-name="${c.name}" ${visited ? 'checked' : ''}>
    <div>
      <div class="item-name">${c.name}</div>
      <div class="item-tags"><span class="tag tag-cat">${c.continent}</span></div>
    </div>
    <div></div>
  </div>`;
}
function renderCountries() {
  const continents = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];
  populateSelectOnce('country-filter-continent', continents);

  const search = document.getElementById('country-search').value.toLowerCase();
  const cont = document.getElementById('country-filter-continent').value;
  const status = document.getElementById('country-filter-status').value;

  const filtered = LQ_DATA.countries.filter(c => {
    if (search && !c.name.toLowerCase().includes(search)) return false;
    if (cont && c.continent !== cont) return false;
    if (status === 'visited' && !isVisited(c.name)) return false;
    if (status === 'not-visited' && isVisited(c.name)) return false;
    return true;
  });

  document.getElementById('countries-list').innerHTML =
    filtered.map(countryCardHTML).join('') || '<p class="sub">No countries match those filters.</p>';
}

// ---------- RENDER: ACHIEVEMENTS ----------
function badgeHTML(a) {
  return `
  <div class="badge ${a.unlocked ? 'unlocked' : ''}">
    <div class="badge-seal">${a.unlocked ? '🏆' : '🔒'}</div>
    <div class="badge-name">${a.name}</div>
    <div class="badge-req">${a.req}</div>
    <div class="badge-progress">${Math.min(a.progress, a.target)} / ${a.target} — +${a.xp} XP</div>
  </div>`;
}
function renderAchievements() {
  const list = achievementsUnlockedList();
  document.getElementById('achievements-grid').innerHTML = list.map(badgeHTML).join('');
}

// ---------- RENDER: STATISTICS ----------
function renderStatistics() {
  const catCounts = categoryCompletionCounts();
  const contCounts = continentVisitCounts();
  const completedExps = LQ_DATA.experiences.filter(e => isCompleted(e.id));
  const ratings = completedExps.map(e => (state.experiences[e.id] || {}).rating).filter(r => r);
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + Number(b), 0) / ratings.length).toFixed(1) : '—';
  let topRated = null, topRatedVal = 0;
  for (const e of completedExps) {
    const r = Number((state.experiences[e.id] || {}).rating || 0);
    if (r > topRatedVal) { topRatedVal = r; topRated = e.name; }
  }

  const catRows = Object.entries(catCounts).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  const contRows = Object.entries(contCounts).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  document.getElementById('stats-content').innerHTML = `
    <table class="stats-table">
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Experiences Logged</td><td>${LQ_DATA.experiences.length}</td></tr>
      <tr><td>Completed Experiences</td><td>${completedExps.length}</td></tr>
      <tr><td>Total XP Earned</td><td>${totalXP().toLocaleString()}</td></tr>
      <tr><td>Average Rating (Completed)</td><td>${avgRating}</td></tr>
      <tr><td>Countries Visited</td><td>${visitedCount()} / ${LQ_DATA.countries.length}</td></tr>
      <tr><td>Achievements Unlocked</td><td>${achievementsUnlockedList().filter(a => a.unlocked).length} / ${LQ_DATA.achievements.length}</td></tr>
      <tr><td>Favorite Category</td><td>${favoriteCategory()}</td></tr>
      <tr><td>Highest-Rated Experience</td><td>${topRated || 'None yet'}</td></tr>
    </table>
    <h3>Completed by Category</h3>
    <table class="stats-table"><tr><th>Category</th><th>Completed</th></tr>${catRows}</table>
    <h3>Countries Visited by Continent</h3>
    <table class="stats-table"><tr><th>Continent</th><th>Visited</th></tr>${contRows}</table>
  `;
}

// ---------- RENDER: JOURNAL / TIMELINE ----------
function renderJournal() {
  const entries = [...state.journal].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  document.getElementById('journal-list').innerHTML = entries.map(e => `
    <div class="entry-card">
      <div class="entry-meta">${e.date || ''} ${e.location ? '· ' + e.location : ''} ${e.rating ? '· ' + '★'.repeat(Number(e.rating)) : ''}</div>
      <div class="entry-title">${e.experience}</div>
      <div class="entry-story">${e.story || ''}</div>
    </div>`).join('') || '<p class="sub">No journal entries yet.</p>';
}
function renderTimeline() {
  const entries = [...state.timeline].sort((a, b) => Number(a.year) - Number(b.year));
  document.getElementById('timeline-list').innerHTML = entries.map(e => `
    <div class="entry-card">
      <div class="entry-meta">${e.year} ${e.location ? '· ' + e.location : ''}</div>
      <div class="entry-title">${e.experience}</div>
      <div class="entry-story">${e.memory || ''}</div>
    </div>`).join('') || '<p class="sub">No milestones logged yet.</p>';
}

// ---------- RENDER: PROFILE ----------
let leaderboardOptIn = false;
function renderProfile() {
  document.getElementById('profile-name').value = state.profile.name || '';
  document.getElementById('profile-motto').value = state.profile.motto || '';
  document.getElementById('profile-since').value = state.profile.since || '';
  document.getElementById('profile-leaderboard-optin').checked = leaderboardOptIn;
  const xp = totalXP();
  const { current } = currentLevelInfo(xp);
  document.getElementById('profile-stats').innerHTML = `
    Rank: ${current.rank} (Level ${current.level})<br>
    Total XP: ${xp.toLocaleString()}${myBonusXP ? ` (includes ${myBonusXP} referral bonus)` : ''}<br>
    Favorite Category: ${favoriteCategory()}<br>
    Countries Visited: ${visitedCount()} / ${LQ_DATA.countries.length}<br>
    Achievements Earned: ${achievementsUnlockedList().filter(a => a.unlocked).length} / ${LQ_DATA.achievements.length}
  `;

  const linkInput = document.getElementById('referral-link');
  const countText = document.getElementById('referral-count-text');
  if (myReferralCode) {
    linkInput.value = `${window.location.origin}${window.location.pathname}?ref=${myReferralCode}`;
    countText.textContent = myReferralCount > 0
      ? `${myReferralCount} friend${myReferralCount === 1 ? '' : 's'} joined using your link (+${myReferralCount * 25} bonus XP earned)`
      : 'Share this link — you both get +25 XP when a friend joins.';
  } else {
    linkInput.value = '';
    countText.textContent = supabaseClient ? 'Log in to get your referral link.' : 'Referral links need cloud sync set up.';
  }
}

// ---------- RENDER ALL ----------
function safeRender(fn) {
  try { fn(); } catch (err) { console.error('Render error in ' + fn.name + ':', err); }
}
function renderAll() {
  safeRender(renderDashboard);
  safeRender(renderExperiences);
  safeRender(renderCountries);
  safeRender(renderWorldMap);
  safeRender(renderAchievements);
  safeRender(renderTracks);
  safeRender(renderStatistics);
  safeRender(renderJournal);
  safeRender(renderTimeline);
  safeRender(renderProfile);
}

// ---------- EVENTS ----------
document.getElementById('tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'leaderboard') loadLeaderboard();
  if (btn.dataset.tab === 'groups') loadGroups();
  if (btn.dataset.tab === 'suggest') loadSuggestions();
});

document.getElementById('experiences-list').addEventListener('change', (ev) => {
  if (ev.target.classList.contains('photo-input')) {
    handlePhotoUpload(ev.target.dataset.id, ev.target.files[0]);
    return;
  }
  if (!ev.target.classList.contains('exp-check')) return;
  const id = ev.target.dataset.id;
  if (!state.experiences[id]) state.experiences[id] = {};
  state.experiences[id].completed = ev.target.checked;
  if (ev.target.checked && !state.experiences[id].dateCompleted) {
    state.experiences[id].dateCompleted = new Date().toISOString().slice(0, 10);
  }
  saveState();
  renderAll();
  checkForNewUnlocks();
});

async function handlePhotoUpload(expId, file) {
  if (!file) return;
  if (!supabaseClient || !currentUser) {
    alert('Photo memories need cloud sync set up — see the setup instructions.');
    return;
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${currentUser.id}/${expId}-${Date.now()}.${ext}`;
  try {
    const { error: upErr } = await supabaseClient.storage.from('experience-photos').upload(path, file);
    if (upErr) throw upErr;
    const { data } = supabaseClient.storage.from('experience-photos').getPublicUrl(path);
    if (!state.experiences[expId]) state.experiences[expId] = {};
    state.experiences[expId].photoUrl = data.publicUrl;
    saveState();
    renderExperiences();
  } catch (err) {
    alert('Photo upload failed: ' + err.message);
  }
}

document.getElementById('countries-list').addEventListener('change', (ev) => {
  if (!ev.target.classList.contains('country-check')) return;
  const name = ev.target.dataset.name;
  if (!state.countries[name]) state.countries[name] = {};
  state.countries[name].visited = ev.target.checked;
  if (ev.target.checked && !state.countries[name].dateVisited) {
    state.countries[name].dateVisited = new Date().toISOString().slice(0, 10);
  }
  saveState();
  renderAll();
  checkForNewUnlocks();
});

['exp-search', 'exp-filter-category', 'exp-filter-difficulty', 'exp-filter-status', 'exp-filter-season']
  .forEach(id => document.getElementById(id).addEventListener('input', renderExperiences));
['country-search', 'country-filter-continent', 'country-filter-status']
  .forEach(id => document.getElementById(id).addEventListener('input', renderCountries));

document.getElementById('journal-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.journal.push({
    date: document.getElementById('journal-date').value,
    experience: document.getElementById('journal-experience').value,
    location: document.getElementById('journal-location').value,
    rating: document.getElementById('journal-rating').value,
    story: document.getElementById('journal-story').value,
  });
  saveState();
  ev.target.reset();
  renderJournal();
});

document.getElementById('timeline-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.timeline.push({
    year: document.getElementById('timeline-year').value,
    experience: document.getElementById('timeline-experience').value,
    location: document.getElementById('timeline-location').value,
    memory: document.getElementById('timeline-memory').value,
  });
  saveState();
  ev.target.reset();
  renderTimeline();
});

['profile-name', 'profile-motto', 'profile-since'].forEach(id => {
  document.getElementById(id).addEventListener('input', (ev) => {
    const key = id.replace('profile-', '');
    state.profile[key] = ev.target.value;
    saveState();
  });
});

document.getElementById('profile-leaderboard-optin').addEventListener('change', async (ev) => {
  leaderboardOptIn = ev.target.checked;
  if (!supabaseClient || !currentUser) return;
  try {
    await supabaseClient.from('progress')
      .update({ leaderboard_opt_in: leaderboardOptIn })
      .eq('user_id', currentUser.id);
    loadLeaderboard();
  } catch (err) {
    console.error('Failed to update leaderboard opt-in:', err);
  }
});

document.getElementById('referral-copy').addEventListener('click', async () => {
  const input = document.getElementById('referral-link');
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('referral-copy');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    input.select();
  }
});

document.getElementById('reset-data').addEventListener('click', () => {
  if (confirm('This will erase all your LifeQuest progress. Are you sure?')) {
    state = EMPTY_STATE();
    saveState();
    renderAll();
    // Also reset the achievement/level "what's new" tracker, otherwise
    // re-unlocking something you'd already unlocked before the reset
    // won't pop a share card (it'd look like nothing changed).
    knownUnlockedIds = null;
    knownLevel = null;
    checkForNewUnlocks();
  }
});

// ---------- AUTH ----------
document.getElementById('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!supabaseClient) return;
  const email = document.getElementById('login-email').value;
  const statusEl = document.getElementById('auth-status');
  statusEl.classList.remove('error');
  statusEl.textContent = 'Sending magic link…';
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    statusEl.textContent = 'Check your email for a sign-in link!';
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.classList.add('error');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-gate').style.display = 'flex';
});

async function onLoggedIn(user) {
  currentUser = user;
  document.getElementById('account-email').textContent = user.email;
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app').style.display = '';
  await loadRemoteState();
  renderAll();
  checkForNewUnlocks();
  loadGroups();
  loadSuggestions();
  loadLeaderboard();
  initReferral();
  maybeShowOnboarding();
}

async function loadRemoteState() {
  try {
    const { data, error } = await supabaseClient
      .from('progress').select('data, leaderboard_opt_in, referred_by, bonus_xp')
      .eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    if (data && data.data && Object.keys(data.data).length) {
      state = { ...EMPTY_STATE(), ...data.data };
      leaderboardOptIn = !!data.leaderboard_opt_in;
      myReferredBy = data.referred_by || null;
      myBonusXP = data.bonus_xp || 0;
      cacheLocal();
    } else {
      // First login: push whatever local/guest progress exists up to the cloud.
      await supabaseClient.from('progress').upsert({
        user_id: currentUser.id,
        display_name: state.profile.name || null,
        data: state,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Failed to load cloud progress, using local cache instead:', err);
  }
}

async function initReferral() {
  if (!supabaseClient) return;
  try {
    const { data: codeData, error: codeErr } = await supabaseClient.rpc('get_or_create_referral_code');
    if (codeErr) throw codeErr;
    myReferralCode = codeData;
    const { data: countData, error: countErr } = await supabaseClient.rpc('my_referral_count');
    if (!countErr) myReferralCount = countData || 0;
    renderProfile();

    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    if (refCode && !myReferredBy) {
      try {
        const { data: bonus, error: redeemErr } = await supabaseClient.rpc('redeem_referral', { p_code: refCode });
        if (redeemErr) throw redeemErr;
        myReferredBy = refCode.toUpperCase();
        myBonusXP += bonus || 0;
        renderAll();
        alert(`Welcome! You and your friend each got +${bonus} XP for the referral.`);
      } catch (err) {
        console.error('Referral redeem failed:', err.message);
      } finally {
        params.delete('ref');
        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', newUrl);
      }
    }
  } catch (err) {
    console.error('Referral init failed:', err);
  }
}

async function initAuth() {
  if (!supabaseClient) {
    // No Supabase configured yet — run in local-only (single browser) mode.
    document.getElementById('auth-gate').style.display = 'none';
    document.getElementById('app').style.display = '';
    document.getElementById('account-email').textContent = 'Local mode (not synced)';
    document.getElementById('logout-btn').style.display = 'none';
    renderAll();
    checkForNewUnlocks();
    loadSuggestions();
    loadLeaderboard();
    maybeShowOnboarding();
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await onLoggedIn(session.user);
  } else {
    document.getElementById('auth-gate').style.display = 'flex';
  }
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session && (!currentUser || currentUser.id !== session.user.id)) {
      await onLoggedIn(session.user);
    } else if (!session && currentUser) {
      currentUser = null;
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-gate').style.display = 'flex';
    }
  });
}

// ---------- GROUPS ----------
async function loadGroups() {
  if (!supabaseClient) {
    document.getElementById('groups-list').innerHTML =
      '<p class="sub">Groups need cloud sync set up — see the setup instructions.</p>';
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('my_groups');
    if (error) throw error;
    renderGroupsList(data || []);
  } catch (err) {
    document.getElementById('groups-status').textContent = 'Error loading groups: ' + err.message;
  }
}
function renderGroupsList(groups) {
  document.getElementById('groups-list').innerHTML = groups.length
    ? groups.map(g => `
      <div class="group-card" data-group-id="${g.id}" data-group-name="${g.name}">
        <div>
          <div class="group-name">${g.name}</div>
          <div class="group-meta">${g.member_count} member${g.member_count === 1 ? '' : 's'} · code <span class="group-code">${g.code}</span></div>
        </div>
        <button class="view-summary-btn" data-group-id="${g.id}" data-group-name="${g.name}">View Summary</button>
      </div>`).join('')
    : '<p class="sub">You\'re not in any groups yet — create one or join with a code.</p>';
}

document.getElementById('create-group-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!supabaseClient) return;
  const name = document.getElementById('create-group-name').value;
  const statusEl = document.getElementById('groups-status');
  try {
    const { data, error } = await supabaseClient.rpc('create_group', { p_name: name });
    if (error) throw error;
    const row = data[0];
    statusEl.textContent = `Group created! Share this code: ${row.code}`;
    ev.target.reset();
    loadGroups();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

document.getElementById('join-group-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!supabaseClient) return;
  const code = document.getElementById('join-group-code').value;
  const statusEl = document.getElementById('groups-status');
  try {
    const { data, error } = await supabaseClient.rpc('join_group', { p_code: code });
    if (error) throw error;
    statusEl.textContent = `Joined "${data[0].name}"!`;
    ev.target.reset();
    loadGroups();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

document.getElementById('groups-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.view-summary-btn');
  if (!btn) return;
  const groupId = btn.dataset.groupId;
  const groupName = btn.dataset.groupName;
  const wrap = document.getElementById('group-summary-wrap');
  const title = document.getElementById('group-summary-title');
  const container = document.getElementById('group-summary');
  wrap.style.display = 'block';
  title.textContent = `Group Summary — ${groupName}`;
  container.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const { data, error } = await supabaseClient.rpc('group_summary', { p_group_id: groupId });
    if (error) throw error;
    const rows = (data || []).map(m => {
      const st = { ...EMPTY_STATE(), ...(m.data || {}) };
      const xp = totalXPFor(st);
      const { current } = currentLevelInfo(xp);
      return {
        name: m.display_name || 'Explorer',
        xp, level: current.level, rank: current.rank,
        completed: completedCountFor(st), countries: visitedCountFor(st),
      };
    }).sort((a, b) => b.xp - a.xp);
    container.innerHTML = rows.map((r, i) => `
      <div class="summary-row">
        <span class="rank-num">#${i + 1}</span>
        <span class="name-cell">${r.name}<br><span class="badge-req">${r.rank} · Lvl ${r.level}</span></span>
        <span class="metric">${r.xp} XP</span>
        <span class="metric">${r.completed} exp.</span>
        <span class="metric">${r.countries} countries</span>
      </div>`).join('') || '<p class="sub">No members found.</p>';
  } catch (err) {
    container.innerHTML = `<p class="sub">Error loading summary: ${err.message}</p>`;
  }
});

// ---------- SUGGEST EXPERIENCE ----------
function populateSuggestSelectsOnce() {
  populateSelectOnce('suggest-category', LQ_DATA.meta.categories);
  populateSelectOnce('suggest-difficulty', LQ_DATA.meta.difficulties);
  populateSelectOnce('suggest-cost', LQ_DATA.meta.costs);
  populateSelectOnce('suggest-season', LQ_DATA.meta.seasons);
}

async function loadSuggestions() {
  populateSuggestSelectsOnce();
  if (!supabaseClient || !currentUser) {
    document.getElementById('suggest-list').innerHTML =
      '<p class="sub">Suggestions need cloud sync set up — see the setup instructions.</p>';
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from('experience_suggestions').select('*').eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    document.getElementById('suggest-list').innerHTML = (data || []).map(s => `
      <div class="entry-card">
        <div class="entry-meta">${new Date(s.created_at).toLocaleDateString()} · ${s.status}</div>
        <div class="entry-title">${s.name}</div>
        <div class="entry-story">${[s.category, s.difficulty, s.cost, s.season].filter(Boolean).join(' · ')}</div>
      </div>`).join('') || '<p class="sub">You haven\'t submitted any suggestions yet.</p>';
  } catch (err) {
    document.getElementById('suggest-list').innerHTML = `<p class="sub">Error: ${err.message}</p>`;
  }
}

document.getElementById('suggest-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const statusEl = document.getElementById('suggest-status');
  if (!supabaseClient || !currentUser) {
    statusEl.textContent = 'Cloud sync isn\'t set up yet, so suggestions can\'t be submitted.';
    return;
  }
  try {
    const { error } = await supabaseClient.from('experience_suggestions').insert({
      user_id: currentUser.id,
      name: document.getElementById('suggest-name').value,
      category: document.getElementById('suggest-category').value || null,
      difficulty: document.getElementById('suggest-difficulty').value || null,
      cost: document.getElementById('suggest-cost').value || null,
      season: document.getElementById('suggest-season').value || null,
      notes: document.getElementById('suggest-notes').value || null,
    });
    if (error) throw error;
    statusEl.textContent = 'Thanks! Your suggestion was submitted.';
    ev.target.reset();
    loadSuggestions();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

// ---------- WORLD MAP ----------
const MAP_NAME_ALIASES = {
  "United States": ["United States of America"],
  "Russia": ["Russian Federation"],
  "South Korea": ["Republic of Korea", "Korea, Rep."],
  "North Korea": ["Dem. Rep. Korea", "Korea, Dem. People's Rep."],
  "Congo, Democratic Republic of the": ["Dem. Rep. Congo", "Democratic Republic of the Congo"],
  "Congo, Republic of the": ["Congo", "Republic of Congo"],
  "Cote d'Ivoire": ["Côte d'Ivoire", "Ivory Coast"],
  "Czechia": ["Czech Rep."],
  "Eswatini": ["Swaziland"],
  "Cabo Verde": ["Cape Verde"],
  "Timor-Leste": ["East Timor"],
  "Myanmar": ["Burma"],
  "Tanzania": ["United Republic of Tanzania"],
  "Bosnia and Herzegovina": ["Bosnia and Herz."],
  "Central African Republic": ["Central African Rep."],
  "Dominican Republic": ["Dominican Rep."],
  "Equatorial Guinea": ["Eq. Guinea"],
  "South Sudan": ["S. Sudan"],
  "Solomon Islands": ["Solomon Is."],
  "Saint Kitts and Nevis": ["St. Kitts and Nevis"],
  "Saint Lucia": ["St. Lucia"],
  "Saint Vincent and the Grenadines": ["St. Vin. and Gren."],
  "Antigua and Barbuda": ["Antigua and Barb."],
};
function buildVisitedMapNameSet() {
  const set = new Set();
  for (const c of LQ_DATA.countries) {
    if (!isVisited(c.name)) continue;
    set.add(c.name);
    (MAP_NAME_ALIASES[c.name] || []).forEach(alias => set.add(alias));
  }
  return set;
}
async function renderWorldMap() {
  const container = document.getElementById('world-map-container');
  if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
    container.innerHTML = '<p class="sub">Map library unavailable right now — check your connection and reload. Your country list and stats are unaffected.</p>';
    return;
  }
  try {
    if (!window.__worldTopoCache) {
      window.__worldTopoCache = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    }
    const topo = window.__worldTopoCache;
    const countries = topojson.feature(topo, topo.objects.countries).features;
    const visitedSet = buildVisitedMapNameSet();

    const width = container.clientWidth || 600;
    const height = Math.round(width * 0.52);
    container.innerHTML = '';
    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${width} ${height}`);
    const projection = d3.geoNaturalEarth1().fitSize([width, height], { type: 'Sphere' });
    const pathGen = d3.geoPath(projection);

    svg.selectAll('path')
      .data(countries)
      .join('path')
      .attr('d', pathGen)
      .attr('fill', d => visitedSet.has(d.properties.name) ? '#C79B3B' : 'rgba(237,230,214,0.12)')
      .attr('stroke', '#131C17')
      .attr('stroke-width', 0.4);

    container.insertAdjacentHTML('beforeend', `
      <div class="map-legend">
        <span><span class="swatch" style="background:#C79B3B"></span>Visited</span>
        <span><span class="swatch" style="background:rgba(237,230,214,0.12)"></span>Not yet</span>
      </div>
      <p class="sub" style="margin-top:8px;">A few very small nations (e.g. Vatican City, Monaco) are too small to render at this map scale — they still count correctly in your Countries list and stats.</p>
    `);
  } catch (err) {
    container.innerHTML = `<p class="sub">Couldn't load the map: ${err.message}</p>`;
  }
}

// ---------- GLOBAL LEADERBOARD ----------
async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-list');
  if (!supabaseClient) {
    container.innerHTML = '<p class="sub">The leaderboard needs cloud sync set up — see the setup instructions.</p>';
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('global_leaderboard');
    if (error) throw error;
    const rows = (data || []).map(m => {
      const st = { ...EMPTY_STATE(), ...(m.data || {}) };
      const xp = totalXPFor(st);
      const { current } = currentLevelInfo(xp);
      return {
        name: m.display_name || 'Explorer', xp, level: current.level, rank: current.rank,
        completed: completedCountFor(st), countries: visitedCountFor(st),
      };
    }).sort((a, b) => b.xp - a.xp);
    container.innerHTML = rows.map((r, i) => `
      <div class="summary-row">
        <span class="rank-num">#${i + 1}</span>
        <span class="name-cell">${r.name}<br><span class="badge-req">${r.rank} · Lvl ${r.level}</span></span>
        <span class="metric">${r.xp} XP</span>
        <span class="metric">${r.completed} exp.</span>
        <span class="metric">${r.countries} countries</span>
      </div>`).join('') || '<p class="sub">No one has opted in yet — be the first, in your Profile tab!</p>';
  } catch (err) {
    container.innerHTML = `<p class="sub">Error loading leaderboard: ${err.message}</p>`;
  }
}

// ---------- ONBOARDING ----------
const ONBOARD_KEY = 'lifequest_onboarded_v1';
const ONBOARD_SLIDES = [
  { icon: '🧭', title: 'Welcome to LifeQuest', text: 'Track real experiences, earn XP, and level up your Explorer rank.' },
  { icon: '✅', title: 'Check things off', text: 'Mark experiences and countries complete in their tabs — XP and achievements update automatically.' },
  { icon: '👥', title: 'Groups & Leaderboard', text: 'Create a group to compare with friends, or opt in to the public Leaderboard from your Profile.' },
  { icon: '🗺️', title: 'Explore at your pace', text: 'Try a guided Explorer Path on the Dashboard if you\'re not sure where to start.' },
];
let onboardIndex = 0;

function maybeShowOnboarding() {
  if (localStorage.getItem(ONBOARD_KEY)) return;
  onboardIndex = 0;
  renderOnboardSlide();
  document.getElementById('onboard-modal').style.display = 'flex';
}
function renderOnboardSlide() {
  const slide = ONBOARD_SLIDES[onboardIndex];
  document.getElementById('onboard-slide-content').innerHTML = `
    <div class="onboard-slide">
      <div class="onboard-icon">${slide.icon}</div>
      <h3>${slide.title}</h3>
      <p>${slide.text}</p>
    </div>`;
  document.getElementById('onboard-dots').innerHTML = ONBOARD_SLIDES
    .map((_, i) => `<span class="${i === onboardIndex ? 'active' : ''}"></span>`).join('');
  document.getElementById('onboard-next').textContent =
    onboardIndex === ONBOARD_SLIDES.length - 1 ? 'Get Started' : 'Next';
}
function closeOnboarding() {
  document.getElementById('onboard-modal').style.display = 'none';
  localStorage.setItem(ONBOARD_KEY, '1');
}
document.getElementById('onboard-skip').addEventListener('click', closeOnboarding);
document.getElementById('onboard-next').addEventListener('click', () => {
  if (onboardIndex >= ONBOARD_SLIDES.length - 1) { closeOnboarding(); return; }
  onboardIndex++;
  renderOnboardSlide();
});

// ---------- SHAREABLE CARDS ----------
function drawShareCard({ eyebrow, title, subtitle }) {
  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.fillStyle = '#131C17';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w * 0.15, h * 0.1, 10, w * 0.15, h * 0.1, w * 0.7);
  grad.addColorStop(0, 'rgba(199,155,59,0.15)');
  grad.addColorStop(1, 'rgba(199,155,59,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#C79B3B';
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // compass motif
  const cx = w / 2, cy = h * 0.32, r = 70;
  ctx.strokeStyle = '#C79B3B';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#C79B3B';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.85); ctx.lineTo(cx + r * 0.22, cy); ctx.lineTo(cx, cy + r * 0.85); ctx.lineTo(cx - r * 0.22, cy);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3E7C74';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.85, cy); ctx.lineTo(cx, cy - r * 0.22); ctx.lineTo(cx + r * 0.85, cy); ctx.lineTo(cx, cy + r * 0.22);
  ctx.closePath(); ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#9BAE9F';
  ctx.font = '600 20px Inter, sans-serif';
  ctx.fillText(eyebrow.toUpperCase(), w / 2, h * 0.52);

  ctx.fillStyle = '#EDE6D6';
  ctx.font = '700 34px Georgia, serif';
  wrapCanvasText(ctx, title, w / 2, h * 0.62, w - 100, 40);

  ctx.fillStyle = '#C79B3B';
  ctx.font = '600 18px Inter, sans-serif';
  ctx.fillText(subtitle, w / 2, h * 0.82);

  ctx.fillStyle = '#9BAE9F';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillText('LIFEQUEST · EXPLORER\'S LOG', w / 2, h * 0.92);
}
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '', lines = [];
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
function showShareCard(opts) {
  drawShareCard(opts);
  document.getElementById('share-modal').style.display = 'flex';
}
document.getElementById('share-close').addEventListener('click', () => {
  document.getElementById('share-modal').style.display = 'none';
});
document.getElementById('share-download').addEventListener('click', () => {
  const canvas = document.getElementById('share-canvas');
  const link = document.createElement('a');
  link.download = 'lifequest-share.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// Detect new achievement unlocks / level-ups after any progress change.
let knownUnlockedIds = null;
let knownLevel = null;
function checkForNewUnlocks() {
  const list = achievementsUnlockedList();
  const nowUnlocked = new Set(list.filter(a => a.unlocked).map(a => a.name));
  const xp = totalXP();
  const { current } = currentLevelInfo(xp);

  if (knownUnlockedIds === null) {
    // first run this session — just record baseline, don't pop a card
    knownUnlockedIds = nowUnlocked;
    knownLevel = current.level;
    return;
  }
  const newlyUnlocked = [...nowUnlocked].filter(name => !knownUnlockedIds.has(name));
  if (newlyUnlocked.length > 0) {
    const a = list.find(x => x.name === newlyUnlocked[0]);
    showShareCard({ eyebrow: 'Achievement Unlocked', title: a.name, subtitle: `+${a.xp} XP` });
  } else if (current.level > knownLevel) {
    showShareCard({ eyebrow: 'Level Up', title: `Level ${current.level}`, subtitle: current.rank });
  }
  knownUnlockedIds = nowUnlocked;
  knownLevel = current.level;
}

// ---------- EXPLORER PATHS ----------
let activeTrackFilter = null;
function renderTracks() {
  const container = document.getElementById('tracks-list');
  if (!LQ_DATA.tracks || !LQ_DATA.tracks.length) { container.innerHTML = ''; return; }
  container.innerHTML = LQ_DATA.tracks.map(t => {
    const completed = t.ids.filter(id => isCompleted(id)).length;
    return `
    <div class="track-card">
      <h4>${t.name}</h4>
      <p>${t.description}</p>
      <div class="track-progress">${completed} / ${t.ids.length} complete</div>
      <button class="view-track-btn" data-track-id="${t.id}">View Track</button>
    </div>`;
  }).join('');
}
document.getElementById('tracks-list').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.view-track-btn');
  if (!btn) return;
  const track = LQ_DATA.tracks.find(t => t.id === btn.dataset.trackId);
  if (!track) return;
  activeTrackFilter = track;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab=experiences]').classList.add('active');
  document.getElementById('tab-experiences').classList.add('active');
  renderExperiences();
});
document.getElementById('track-filter-chip').addEventListener('click', (ev) => {
  if (!ev.target.closest('.clear-track-btn')) return;
  activeTrackFilter = null;
  renderExperiences();
});

// ---------- INIT ----------
initAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}
