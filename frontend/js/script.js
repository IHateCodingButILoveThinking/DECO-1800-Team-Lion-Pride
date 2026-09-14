/* Family Finds navigation and live council activities. */
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const navIcons = { home: 'home', events: 'calendar', saved: 'heart', community: 'people' };
document.querySelectorAll('[data-nav]').forEach(link => {
  link.insertAdjacentHTML('afterbegin', `<span class="nav-icon">${icon(navIcons[link.dataset.nav], 21)}</span>`);
});
let route = 'home';
let events = [];
let feedState = 'loading';
let feedTotal = 0;
let saved = [];
let familyOnly = true;
let eventFilters = emptyEventFilters();
let toastTimer;

// Keep every filter reset consistent across the Events page and home shortcuts.
function emptyEventFilters() {
  return {
    search: '',
    category: 'All activities',
    suburb: 'All suburbs',
    date: 'all',
    quick: ''
  };
}

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}
function updateCount() { document.querySelector('#saved-count').textContent = saved.length; }
function isSaved(id) { return saved.some(event => event.id === id); }
function findEvent(id) { return [...events, ...saved].find(event => event.id === id); }
async function toggleSave(id) {
  if (!Social.requireProfile()) return;
  const event = findEvent(id);
  if (!event) return;
  const removing = isSaved(id);
  try {
    await Social.api('/saved', { method: removing ? 'DELETE' : 'POST', body: JSON.stringify(removing ? { id } : { event }) });
    saved = removing ? saved.filter(item => item.id !== id) : [...saved, event];
    updateCount(); refreshSaveButtons();
    notify(removing ? 'Removed from saved activities.' : 'Saved to your account.');
  } catch (error) { notify(error.message); }
}
function refreshSaveButtons() {
  if (route === 'saved') renderEventResults();
  document.querySelectorAll('[data-save]').forEach(button => {
    const active = isSaved(button.dataset.save);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${active ? 'Unsave' : 'Save'} ${findEvent(button.dataset.save)?.title || 'activity'}`);
    button.textContent = active ? '♥' : '♡';
  });
}
function navigate(next) {
  if (next === 'home') {
    history.pushState({}, '', location.pathname);
    render();
    window.scrollTo(0,0);
  } else if (location.hash === `#${next}`) render();
  else location.hash = next;
}
function render() {
  const requested = location.hash.slice(1).split('/')[0];
  route = ['home', 'events', 'saved', 'community', 'club', 'post', 'member', 'profile', 'settings', 'login', 'register'].includes(requested) ? requested : 'home';
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === route || (link.dataset.nav === 'community' && ['club','post','member'].includes(route))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${route === 'home' ? 'Home' : route[0].toUpperCase() + route.slice(1)} · Family Finds`;
  // Scope larger type to Events without changing the other site pages.
  document.body.classList.toggle('events-route', route === 'events');
  if (Social.handles(route)) { Social.show(route); updateCount(); return; }
  main.innerHTML = activitiesPage();
  renderEventResults();
  updateCount();
}
function options(values, selected) { return values.map(value => `<option ${value === selected ? 'selected' : ''}>${escapeHTML(value)}</option>`).join(''); }

// Build the suburb list from live events, without prioritising any location.
function suburbOptions() {
  const suburbs = [...new Set(events.map(event => event.suburb).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return ['All suburbs', ...suburbs];
}

const dateLabels = {
  all: 'Date',
  today: 'Today',
  weekend: 'This weekend',
  next7: 'Next 7 days',
  next30: 'Next 30 days'
};

function dateFilterLabel(value) {
  if (dateLabels[value]) return dateLabels[value];
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Render quick and detailed event filters.
function eventFilterControls() {
  const categories = [
    'All activities',
    'Outdoors',
    'Libraries',
    'Creative',
    'Markets & secondhand',
    'Other activities'
  ];
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(eventFilters.date) ? eventFilters.date : '';
  const quickFilters = [
    ['free', 'Free', eventFilters.quick === 'free'],
    ['weekend', 'This weekend', eventFilters.date === 'weekend'],
    ['markets', 'Markets', eventFilters.category === 'Markets & secondhand'],
    ['near', 'Near me', eventFilters.suburb !== 'All suburbs']
  ];

  return `
    <div class="search-row event-filter-row">
      <label class="search-field">
        <span aria-hidden="true">${icon('search', 18)}</span>
        <input type="search" id="event-search" aria-label="Search activities"
          placeholder="Search activities or places" value="${escapeHTML(eventFilters.search)}">
      </label>
    </div>
    ${route === 'events' ? `
      <div class="event-filter-section">
        <span class="event-filter-label">Quick filters</span>
        <div class="event-quick-filters" role="group" aria-label="Quick filters">
          ${quickFilters.map(([id, label, active]) => `
            <button type="button" class="event-quick-filter${active ? ' active' : ''}"
              data-event-quick="${id}" aria-pressed="${active}">${quickIcon(id)} ${label}</button>`).join('')}
        </div>
      </div>
      <span class="event-filter-label">More filters</span>` : ''}
    <div class="search-row event-filter-row event-more-filters">
      <label class="event-date-picker">
        <input type="date" id="event-date" aria-label="Activity date" value="${selectedDate}">
      </label>
      <select id="event-category" aria-label="Activity category">
        ${options(categories, eventFilters.category)}
      </select>
      <select id="event-suburb" aria-label="Suburb">
        ${options(suburbOptions(), eventFilters.suburb)}
      </select>
    </div>
    <label class="family-filter"><input type="checkbox" id="family-only" ${familyOnly ? 'checked' : ''}> Family-suitable activities only</label>
    <div id="active-filter" role="group" aria-label="Active filters"></div>`;
}

function activitiesPage() {
  const home = route === 'home';
  const savedPage = route === 'saved';
  const titles = { home: 'Little adventures.<br>Closer connections.', events: 'Find A Family Activity', saved: 'Saved for later.' };
  return `${home ? '<div class="hero-shell">' : ''}<section class="home-intro"><div class="eyebrow">${savedPage ? 'SAVED' : 'BRISBANE FAMILY ACTIVITIES'}</div><h1>${titles[route]}</h1><p class="intro">${savedPage ? 'Activities you want to try.' : 'Find free family activities, nearby markets and local clubs.'}</p>${home ? '<div class="hero-actions"><a class="button primary" href="#events">Find an activity</a><a class="button" href="#community">Find a club</a></div>' : ''}</section>${home ? '<div class="hero-picture" id="home-hero-image"><span class="image-fallback">' + icon('leaf',45) + '</span></div></div>' : ''}
    ${home ? `<div class="section-heading"><h2>Quick browse</h2><span class="subtle">A good place to start</span></div><div class="quick-grid">
      ${[['free', '', 'Free activities', 'No-cost ideas'], ['weekend', '', 'This weekend', 'Saturday and Sunday'], ['markets', '', 'Markets & secondhand', 'Markets and swaps'], ['near', '', 'Near me', 'Choose your suburb']].map(([id, icon, title, subtitle]) => `<button class="quick-card" data-quick="${id}"><span class="quick-icon" aria-hidden="true">${quickIcon(id)}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>` : ''}
    <div class="section-heading"><h2>${savedPage ? 'Saved activities' : home ? 'Explore activities' : 'Find your next activity'}</h2>${home ? '<a class="text-link" href="#events">View all events ↗</a>' : ''}</div>
    ${!savedPage ? eventFilterControls() : ''}
    <div id="feed-status" class="result-meta" role="status"></div><div class="event-grid" id="event-results"></div><div id="load-more" class="section-heading"></div>
    ${home ? `<section class="community-callout"><div><div class="eyebrow">LOCAL CLUBS</div><h2>Share a local find.</h2><p>Plan an activity or meet nearby families.</p></div><a class="button" href="#community">Visit community <span aria-hidden="true">↗</span></a></section>` : ''}`;
}
let visibleLimit = 12;

// Event filter matching uses Brisbane calendar dates, so "Next 7 days" includes today.
function filteredEvents() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
  const startOfToday = Date.parse(`${today}T00:00:00Z`);
  const addDays = days => new Date(startOfToday + days * 86400000).toISOString().slice(0, 10);
  const day = new Date(startOfToday).getUTCDay();
  const saturday = addDays(day === 0 ? -1 : (6 - day + 7) % 7);
  const sunday = addDays(day === 0 ? 0 : (7 - day) % 7);
  const query = eventFilters.search.toLowerCase().trim();
  const selectedSuburb = eventFilters.suburb.toLowerCase();

  return events.filter(event => {
    const searchableText = [
      event.title,
      event.venue,
      event.suburb,
      event.category,
      event.description
    ].join(' ').toLowerCase();
    const matchesDate = eventFilters.date === 'all' ||
      (eventFilters.date === 'today' && event.dateKey === today) ||
      (eventFilters.date === 'weekend' && event.dateKey >= saturday && event.dateKey <= sunday) ||
      (eventFilters.date === 'next7' && event.dateKey >= today && event.dateKey <= addDays(6)) ||
      (eventFilters.date === 'next30' && event.dateKey >= today && event.dateKey <= addDays(29)) ||
      event.dateKey === eventFilters.date;
    const matchesSuburb = eventFilters.suburb === 'All suburbs' ||
      event.suburb.toLowerCase() === selectedSuburb;
    const matchesCategory = eventFilters.category === 'All activities' ||
      event.category === eventFilters.category;
    const matchesFree = eventFilters.quick !== 'free' || event.cost === 0;

    return (!familyOnly || event.family) &&
      searchableText.includes(query) &&
      matchesDate &&
      matchesSuburb &&
      matchesCategory &&
      matchesFree;
  });
}

// Active-filter chips show every applied condition and expose one remove button per condition.
function renderActiveFilters() {
  const active = document.querySelector('#active-filter');
  if (!active) return;

  const filters = [];
  if (eventFilters.search.trim()) filters.push(['search', `Search: ${eventFilters.search.trim()}`]);
  if (eventFilters.category !== 'All activities') filters.push(['category', `Category: ${eventFilters.category}`]);
  if (eventFilters.suburb !== 'All suburbs') filters.push(['suburb', `Suburb: ${eventFilters.suburb}`]);
  if (eventFilters.date !== 'all') filters.push(['date', `Date: ${dateFilterLabel(eventFilters.date)}`]);
  if (eventFilters.quick === 'free') filters.push(['quick', 'Free activities']);
  if (familyOnly) filters.push(['family', 'Family-suitable']);

  const chips = filters.map(([key, label]) => `
    <span class="active-filter-chip">
      ${escapeHTML(label)}
      <button type="button" data-remove-filter="${key}"
        aria-label="Remove ${escapeHTML(label)} filter">×</button>
    </span>`
  ).join('');
  active.innerHTML = filters.length ? `
    <div class="active-filter-list">
      ${chips}
      <button class="active-filter-clear" type="button" data-reset>Clear all</button>
    </div>` : '';
}
function eventCard(event) {
  const active = isSaved(event.id);
  return `<article class="event-card"><div class="event-visual">${event.image ? `<img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.title)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="image-fallback">${icon(event.category === 'Libraries' ? 'book' : event.category === 'Outdoors' ? 'leaf' : 'calendar',38)}</span>`}<span class="price-label">${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free' : `$${event.cost}`))}</span><button class="save-button" data-save="${escapeHTML(event.id)}" aria-label="${active ? 'Unsave' : 'Save'} ${escapeHTML(event.title)}" aria-pressed="${active}">${active ? '♥' : '♡'}</button></div><div class="event-content"><p class="event-category">${escapeHTML(event.category)}</p><h3>${escapeHTML(event.title)}</h3><div class="event-meta">${escapeHTML(event.date || event.day)} · ${escapeHTML(event.suburb)}<br>${escapeHTML(event.venue)}</div><div class="card-bottom"><span>${escapeHTML(event.ages)}</span><button data-event="${escapeHTML(event.id)}">View activity ↗</button></div>${Social.eventInterestCard(event.id)}</div></article>`;
}
function renderEventResults() {
  if (!document.querySelector('#event-results')) return;
  const hero = document.querySelector('#home-hero-image');
  const heroEvent = events.find(event => event.family && event.image && event.category === 'Outdoors') || events.find(event => event.family && event.image);
  if (hero && heroEvent && hero.dataset.event !== heroEvent.id) { hero.dataset.event = heroEvent.id; hero.innerHTML = `<img src="${escapeHTML(heroEvent.image)}" alt="${escapeHTML(heroEvent.title)}" referrerpolicy="no-referrer"><div class="hero-caption"><strong>${escapeHTML(heroEvent.title)}</strong>${escapeHTML(heroEvent.suburb)} · ${escapeHTML(heroEvent.costLabel)}</div>`; }
  const list = route === 'saved' ? saved : filteredEvents();
  const limit = route === 'home' ? 6 : visibleLimit;
  document.querySelector('#event-results').innerHTML = list.length ? list.slice(0, limit).map(eventCard).join('') : `<div class="empty-state"><h3>${route === 'saved' ? 'Your next family day starts here.' : feedState === 'loading' ? 'Finding activities around Brisbane…' : feedState === 'error' ? 'Council events are unavailable right now.' : 'No activities match just yet.'}</h3><p>${route === 'saved' ? (Social.profile() ? 'Tap the heart on an activity to keep it here.' : 'Log in to save activities and find them on any device.') : feedState === 'loading' ? 'Loading the latest published council listings.' : feedState === 'error' ? 'Please try again in a moment. We haven’t replaced live results with sample events.' : 'Try another suburb, category or search.'}</p>${route === 'saved' ? `<a class="button" href="${Social.profile() ? '#events' : '#login'}">${Social.profile() ? 'Explore activities' : 'Log in to save activities'}</a>` : feedState === 'error' ? '<button class="button" data-retry>Try again</button>' : feedState !== 'loading' ? '<button class="button" data-reset>Clear filters</button>' : ''}</div>`;
  // Show the filtered match count separately from the live feed loading state.
  const feedSummary = feedState === 'loading'
    ? `Loading council listings (${events.length}${feedTotal ? ` of ${feedTotal}` : ''})…`
    : feedState === 'error'
      ? `Live feed interrupted; ${events.length} listings loaded.`
      : `${events.length} live council activities`;
  const status = route === 'saved'
    ? `${list.length} saved ${list.length === 1 ? 'activity' : 'activities'}`
    : `${list.length} matches · ${feedSummary}`;
  document.querySelector('#feed-status').textContent = status;
  if (feedState === 'error' && events.length && route !== 'saved') document.querySelector('#feed-status').insertAdjacentHTML('beforeend',' <button class="button small" data-retry>Retry</button>');
  const more = document.querySelector('#load-more');
  more.innerHTML = route !== 'home' && list.length > limit ? `<button class="button" data-more>Show more activities (${list.length - limit} remaining)</button>` : '';
  renderActiveFilters();
}
function showDialog(html) { content.innerHTML = html; modal.removeAttribute('data-event-id'); if (!modal.open) modal.showModal(); }
function showEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  showDialog(`<div class="eyebrow">COUNCIL ACTIVITY</div><h2 id="modal-title">${escapeHTML(event.title)}</h2><p>${escapeHTML(event.description)}</p><dl class="detail-list"><dt>When</dt><dd>${escapeHTML(event.time)}</dd><dt>Where</dt><dd>${escapeHTML(event.venue)}</dd><dt>Cost</dt><dd>${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free entry' : `$${event.cost} per participant`))}</dd><dt>Suitable for</dt><dd>${escapeHTML(event.ages)}</dd>${event.bookings ? `<dt>Bookings</dt><dd>${escapeHTML(event.bookings)}</dd>` : ''}${event.requirements ? `<dt>Bring along</dt><dd>${escapeHTML(event.requirements)}</dd>` : ''}</dl><p class="subtle">Check the council listing for current availability, cancellations and booking requirements.</p>${Social.eventInterestDetail(event.id)}<div class="form-actions"><button class="button" data-share-event="${escapeHTML(event.id)}">Share with a club</button>${event.live && /^https:\/\//i.test(event.url || '') ? `<a class="button primary" href="${escapeHTML(event.url)}" target="_blank" rel="noopener noreferrer">Council listing ↗</a>` : '<a class="button" href="#events" data-close>Browse live events</a>'}</div>`);
  modal.dataset.eventId=id;
}

// Removing a chip changes only its own filter and keeps the other selections.
function removeEventFilter(filter) {
  if (filter === 'family') {
    familyOnly = false;
  } else if (Object.prototype.hasOwnProperty.call(eventFilters, filter)) {
    eventFilters[filter] = emptyEventFilters()[filter];
  } else {
    return;
  }

  visibleLimit = 12;
  render();
}

// "Clear all" also turns off the default family-suitable checkbox.
function clearEventFilters() {
  eventFilters = emptyEventFilters();
  familyOnly = false;
  visibleLimit = 12;
  render();
}

// Home shortcuts open Events with the matching category, date or price filter.
function openQuickFilter(quick) {
  eventFilters = emptyEventFilters();
  if (quick === 'markets') eventFilters.category = 'Markets & secondhand';
  if (quick === 'weekend') eventFilters.date = 'weekend';
  if (quick === 'free') eventFilters.quick = 'free';

  navigate('events');
  if (quick === 'near') {
    setTimeout(() => document.querySelector('#event-suburb')?.focus(), 50);
    notify('Choose your suburb to find nearby activities.');
  }
}

// Toggle quick filters without clearing other choices.
function toggleEventQuickFilter(quick) {
  if (quick === 'free') eventFilters.quick = eventFilters.quick === 'free' ? '' : 'free';
  else if (quick === 'weekend') eventFilters.date = eventFilters.date === 'weekend' ? 'all' : 'weekend';
  else if (quick === 'markets') eventFilters.category = eventFilters.category === 'Markets & secondhand' ? 'All activities' : 'Markets & secondhand';
  else if (quick !== 'near') return;

  visibleLimit = 12;
  render();
  if (quick === 'near') {
    setTimeout(() => document.querySelector('#event-suburb')?.focus(), 50);
    notify('Choose your suburb to find nearby activities.');
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, [data-close]');
  if (!button) return;
  if (button.matches('[data-close], .close-button')) modal.close();
  if (button.hasAttribute('data-save')) toggleSave(button.dataset.save);
  if (button.hasAttribute('data-event')) showEvent(button.dataset.event);
  if (button.hasAttribute('data-share-event')) { const event = findEvent(button.dataset.shareEvent); if (event) { modal.close(); Social.compose({title:event.title,body:'Anyone interested in going together?',link:event.url}); } }
  if (button.hasAttribute('data-event-interest')) Social.toggleEventInterest(button.dataset.eventInterest);
  if (button.hasAttribute('data-more')) { visibleLimit += 12; renderEventResults(); }
  if (button.hasAttribute('data-reset')) { clearEventFilters(); return; }
  if (button.hasAttribute('data-remove-filter')) {
    removeEventFilter(button.dataset.removeFilter);
    return;
  }
  if (button.hasAttribute('data-retry')) loadEvents();
  if (button.hasAttribute('data-event-quick')) {
    toggleEventQuickFilter(button.dataset.eventQuick);
    return;
  }
  if (button.hasAttribute('data-quick')) openQuickFilter(button.dataset.quick);
});

// Text search updates results immediately without rebuilding the focused input.
document.addEventListener('input', event => {
  if (event.target.id !== 'event-search') return;
  eventFilters.search = event.target.value;
  visibleLimit = 12;
  renderEventResults();
});

// Filter changes preserve all other active filters.
document.addEventListener('change', event => {
  const field = event.target;
  if (field.id === 'family-only') familyOnly = field.checked;
  else if (field.id === 'event-date') eventFilters.date = field.value || 'all';
  else if (field.id === 'event-category') eventFilters.category = field.value;
  else if (field.id === 'event-suburb') eventFilters.suburb = field.value;
  else return;

  visibleLimit = 12;
  renderEventResults();
});
modal.addEventListener('click', event => { if (event.target === modal) { const bounds = modal.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close(); } });
window.addEventListener('hashchange', () => { if (modal.open) modal.close(); visibleLimit = 12; render(); main.focus(); window.scrollTo(0,0); });
window.addEventListener('popstate', () => { if (!location.hash) { visibleLimit = 12; render(); main.focus(); window.scrollTo(0,0); } });
let loading = false;
async function loadEvents() {
  if (loading) return;
  loading = true; feedState = 'loading'; renderEventResults();
  try {
    await CouncilEvents.load((loaded, total) => {
      events = loaded; feedTotal = total;
      renderEventResults();
      const suburbs = document.querySelector('#event-suburb');
      // Add newly discovered suburbs while preserving the current selection.
      if (suburbs) suburbs.innerHTML = options(suburbOptions(), eventFilters.suburb);
    });
    feedState = 'ready';
  } catch (error) { feedState = 'error'; console.warn('Council events could not finish loading:', error.message); }
  finally { loading = false; renderEventResults(); }
}
render();
loadEvents();
Social.init();

// Progressive enhancement; ordinary browsers do not need WebMCP support.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'search_family_activities',
      description: 'Search loaded council activities and show the matching results on the Events page.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 } }, required: ['query'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input.query !== 'string' || input.query.length > 200 || Object.keys(input).some(key => key !== 'query')) throw new Error('Provide a search query of up to 200 characters.');
        eventFilters.search = input.query;
        if (location.hash !== '#events') {
          await new Promise(resolve => { window.addEventListener('hashchange', resolve, { once: true }); navigate('events'); });
        } else render();
        return { feedState, matches: filteredEvents().length, activities: filteredEvents().slice(0,12).map(({id,title,date,suburb,costLabel}) => ({id,title,date,suburb,costLabel})) };
      }
    }, { signal: lifecycle.signal })).catch(() => {});
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  } catch { /* Unsupported experimental API must not affect normal browser use. */ }
}

function quickIcon(id) { return icon({free:'heart',weekend:'calendar',markets:'swap',near:'pin'}[id],21); }
