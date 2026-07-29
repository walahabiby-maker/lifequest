// ---------- STATE ----------
const STORAGE_KEY = 'lifequest_state_v1';

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  return { experiences: {}, countries: {}, profile: {}, journal: [], timeline: [] };
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

const RARITY_XP = { Common: 10, Rare: 50, Epic: 100, Legendary: 250 };

// ---------- DERIVED DATA HELPERS ----------
function isCompleted(expId) {
  return !!(state.experiences[expId] && state.experiences[expId].completed);
}
function isVisited(countryName) {
  return !!(state.countries[countryName] && state.countries[countryName].visited);
}
function totalXP() {
  let xp = 0;
  for (const e of LQ_DATA.experiences) {
    if (isCompleted(e.id)) xp += RARITY_XP[e.rarity] || 0;
  }
  return xp;
}
function currentLevelInfo(xp) {
  let current = LQ_DATA.levels[0];
  for (const lvl of LQ_DATA.levels) {
    if (xp >= lvl.xpRequired) current = lvl; else break;
  }
  const idx = LQ_DATA.levels.findIndex(l => l.level === current.level);
  const next = LQ_DATA.levels[idx + 1] || null;
  return { current, next };
}
function completedCount() {
  return LQ_DATA.experiences.filter(e => isCompleted(e.id)).length;
}
function visitedCount() {
  return LQ_DATA.countries.filter(c => isVisited(c.name)).length;
}
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
    document.querySelectorAll('.chart-card canvas').forEach(c => {
      c.insertAdjacentHTML('afterend', '<p class="sub">Charts unavailable offline — data still tracked below.</p>');
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

  const filtered = LQ_DATA.experiences.filter(e => {
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
function renderProfile() {
  document.getElementById('profile-name').value = state.profile.name || '';
  document.getElementById('profile-motto').value = state.profile.motto || '';
  document.getElementById('profile-since').value = state.profile.since || '';
  const xp = totalXP();
  const { current } = currentLevelInfo(xp);
  document.getElementById('profile-stats').innerHTML = `
    Rank: ${current.rank} (Level ${current.level})<br>
    Total XP: ${xp.toLocaleString()}<br>
    Favorite Category: ${favoriteCategory()}<br>
    Countries Visited: ${visitedCount()} / ${LQ_DATA.countries.length}<br>
    Achievements Earned: ${achievementsUnlockedList().filter(a => a.unlocked).length} / ${LQ_DATA.achievements.length}
  `;
}

// ---------- RENDER ALL ----------
function safeRender(fn) {
  try { fn(); } catch (err) { console.error('Render error in ' + fn.name + ':', err); }
}
function renderAll() {
  safeRender(renderDashboard);
  safeRender(renderExperiences);
  safeRender(renderCountries);
  safeRender(renderAchievements);
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
});

document.getElementById('experiences-list').addEventListener('change', (ev) => {
  if (!ev.target.classList.contains('exp-check')) return;
  const id = ev.target.dataset.id;
  if (!state.experiences[id]) state.experiences[id] = {};
  state.experiences[id].completed = ev.target.checked;
  if (ev.target.checked && !state.experiences[id].dateCompleted) {
    state.experiences[id].dateCompleted = new Date().toISOString().slice(0, 10);
  }
  saveState();
  renderAll();
});

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

document.getElementById('reset-data').addEventListener('click', () => {
  if (confirm('This will erase all your LifeQuest progress in this browser. Are you sure?')) {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    renderAll();
  }
});

// ---------- INIT ----------
renderAll();
