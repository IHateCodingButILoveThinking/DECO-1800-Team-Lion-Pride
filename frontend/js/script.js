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
let eventFilters = { search: '', category: 'All activities', suburb: 'All suburbs', quick: '' };
let toastTimer;

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
  if (Social.handles(route)) { Social.show(route); updateCount(); return; }
  main.innerHTML = activitiesPage();
  renderEventResults();
  updateCount();
}
function options(values, selected) { return values.map(value => `<option ${value === selected ? 'selected' : ''}>${escapeHTML(value)}</option>`).join(''); }
function activitiesPage() {
  const home = route === 'home';
  const savedPage = route === 'saved';
  const titles = { home: 'Little adventures.<br>Closer connections.', events: 'Find a family activity.', saved: 'Saved for later.' };
  return `${home ? '<div class="hero-shell">' : ''}<section class="home-intro"><div class="eyebrow">${savedPage ? 'SAVED' : 'BRISBANE FAMILY ACTIVITIES'}</div><h1>${titles[route]}</h1><p class="intro">${savedPage ? 'Activities you want to try.' : 'Find free family activities, nearby markets and local clubs.'}</p>${home ? '<div class="hero-actions"><a class="button primary" href="#events">Find an activity</a><a class="button" href="#community">Find a club</a></div>' : ''}</section>${home ? '<div class="hero-picture" id="home-hero-image"><span class="image-fallback">' + icon('leaf',45) + '</span></div></div>' : ''}
    ${home ? `<div class="section-heading"><h2>Quick browse</h2><span class="subtle">A good place to start</span></div><div class="quick-grid">
      ${[['free', '', 'Free activities', 'No-cost ideas'], ['weekend', '', 'This weekend', 'Saturday and Sunday'], ['markets', '', 'Markets & secondhand', 'Markets and swaps'], ['near', '', 'Near me', 'Choose your suburb']].map(([id, icon, title, subtitle]) => `<button class="quick-card" data-quick="${id}"><span class="quick-icon" aria-hidden="true">${quickIcon(id)}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>` : ''}
    <div class="section-heading"><h2>${savedPage ? 'Saved activities' : home ? 'Explore activities' : 'Find your next activity'}</h2>${home ? '<a class="text-link" href="#events">View all events ↗</a>' : ''}</div>
    ${!savedPage ? `<div class="search-row"><label class="search-field"><span aria-hidden="true">${icon('search',18)}</span><input type="search" id="event-search" aria-label="Search activities" placeholder="Search activities or places" value="${escapeHTML(eventFilters.search)}"></label><select id="event-category" aria-label="Activity category">${options(['All activities', 'Outdoors', 'Libraries', 'Creative', 'Markets & secondhand', 'Other activities'], eventFilters.category)}</select><select id="event-suburb" aria-label="Suburb">${options(['All suburbs', ...new Set(events.map(event => event.suburb))].sort((a,b)=>a === 'All suburbs' ? -1 : b === 'All suburbs' ? 1 : a.localeCompare(b)),eventFilters.suburb)}</select></div><div id="active-filter"></div>` : ''}
    ${!savedPage ? `<label class="family-filter"><input type="checkbox" id="family-only" ${familyOnly ? 'checked' : ''}> Family-suitable activities only</label>` : ''}
    <div id="feed-status" class="result-meta" role="status"></div><div class="event-grid" id="event-results"></div><div id="load-more" class="section-heading"></div>
    ${home ? `<section class="community-callout"><div><div class="eyebrow">LOCAL CLUBS</div><h2>Share a local find.</h2><p>Plan an activity or meet nearby families.</p></div><a class="button" href="#community">Visit community <span aria-hidden="true">↗</span></a></section>` : ''}`;
}
let visibleLimit = 12;
function filteredEvents() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
  const localDate = new Date(`${today}T12:00:00+10:00`);
  const dayIndex = (localDate.getUTCDay() + 6) % 7;
  const saturday = new Date(localDate.getTime() + (5 - dayIndex) * 86400000).toLocaleDateString('en-CA', {timeZone:'Australia/Brisbane'});
  const sunday = new Date(localDate.getTime() + (6 - dayIndex) * 86400000).toLocaleDateString('en-CA', {timeZone:'Australia/Brisbane'});
  return events.filter(event => {
    const text = `${event.title} ${event.suburb} ${event.category} ${event.description}`.toLowerCase();
    return (!familyOnly || event.family) && text.includes(eventFilters.search.toLowerCase().trim()) && (eventFilters.category === 'All activities' || event.category === eventFilters.category) && (eventFilters.suburb === 'All suburbs' || event.suburb === eventFilters.suburb) && (eventFilters.quick !== 'free' || event.cost === 0) && (eventFilters.quick !== 'weekend' || event.dateKey === saturday || event.dateKey === sunday);
  });
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
  const status = route === 'saved' ? `${list.length} saved ${list.length === 1 ? 'activity' : 'activities'}` : `${list.length} family matches · ${feedState === 'loading' ? `Loading council listings (${events.length}${feedTotal ? ` of ${feedTotal}` : ''})…` : feedState === 'error' ? `Live feed interrupted; ${events.length} listings loaded.` : `${events.length} live council activities`}`;
  document.querySelector('#feed-status').textContent = status;
  if (feedState === 'error' && events.length && route !== 'saved') document.querySelector('#feed-status').insertAdjacentHTML('beforeend',' <button class="button small" data-retry>Retry</button>');
  const more = document.querySelector('#load-more');
  more.innerHTML = route !== 'home' && list.length > limit ? `<button class="button" data-more>Show more activities (${list.length - limit} remaining)</button>` : '';
  const active = document.querySelector('#active-filter');
  if (active) active.innerHTML = eventFilters.quick || eventFilters.category !== 'All activities' || eventFilters.suburb !== 'All suburbs' || eventFilters.search ? `<p class="subtle">${eventFilters.quick === 'free' ? 'Showing free activities. ' : eventFilters.quick === 'weekend' ? 'Showing this weekend. ' : ''}<button class="button small" data-reset>Clear filters ×</button></p>` : '';
}
function showDialog(html) { content.innerHTML = html; modal.removeAttribute('data-event-id'); if (!modal.open) modal.showModal(); }
function showEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  showDialog(`<div class="eyebrow">COUNCIL ACTIVITY</div><h2 id="modal-title">${escapeHTML(event.title)}</h2><p>${escapeHTML(event.description)}</p><dl class="detail-list"><dt>When</dt><dd>${escapeHTML(event.time)}</dd><dt>Where</dt><dd>${escapeHTML(event.venue)}</dd><dt>Cost</dt><dd>${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free entry' : `$${event.cost} per participant`))}</dd><dt>Suitable for</dt><dd>${escapeHTML(event.ages)}</dd>${event.bookings ? `<dt>Bookings</dt><dd>${escapeHTML(event.bookings)}</dd>` : ''}${event.requirements ? `<dt>Bring along</dt><dd>${escapeHTML(event.requirements)}</dd>` : ''}</dl><p class="subtle">Check the council listing for current availability, cancellations and booking requirements.</p>${Social.eventInterestDetail(event.id)}<div class="form-actions"><button class="button" data-share-event="${escapeHTML(event.id)}">Share with a club</button>${event.live && /^https:\/\//i.test(event.url || '') ? `<a class="button primary" href="${escapeHTML(event.url)}" target="_blank" rel="noopener noreferrer">Council listing ↗</a>` : '<a class="button" href="#events" data-close>Browse live events</a>'}</div>`);
  modal.dataset.eventId=id;
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
  if (button.hasAttribute('data-reset')) { eventFilters = { search: '', category: 'All activities', suburb: 'All suburbs', quick: '' }; visibleLimit = 12; render(); }
  if (button.hasAttribute('data-retry')) loadEvents();
  if (button.hasAttribute('data-quick')) {
    const quick = button.dataset.quick;
    eventFilters = { search: '', category: quick === 'markets' ? 'Markets & secondhand' : 'All activities', suburb: 'All suburbs', quick: ['free', 'weekend'].includes(quick) ? quick : '' };
    navigate('events');
    if (quick === 'near') { setTimeout(() => document.querySelector('#event-suburb')?.focus(), 50); notify('Choose your suburb to find nearby activities.'); }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'event-search') { eventFilters.search = event.target.value; visibleLimit = 12; renderEventResults(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'family-only') { familyOnly = event.target.checked; visibleLimit = 12; renderEventResults(); }
  if (event.target.id === 'event-category') { eventFilters.category = event.target.value; visibleLimit = 12; renderEventResults(); }
  if (event.target.id === 'event-suburb') { eventFilters.suburb = event.target.value; visibleLimit = 12; renderEventResults(); }
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
      if (suburbs) suburbs.innerHTML = options(['All suburbs', ...[...new Set(events.map(event => event.suburb))].sort()], eventFilters.suburb);
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
