/* Family Finds navigation and live council activities.
   Implementation assistance: OpenAI Codex, https://openai.com/codex/.
   Visible reference: ../references.html#development. */
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const navIcons = { home: 'home', events: 'calendar', saved: 'heart', community: 'people', about: 'book' };
document.querySelectorAll('[data-nav]').forEach(link => {
  link.insertAdjacentHTML('afterbegin', `<span class="nav-icon">${icon(navIcons[link.dataset.nav], 21)}</span>`);
});
let route = 'home';
let events = [];
let detailEvent = null;
let detailRequestVersion = 0;
let eventReturnRoute = 'events';
let feedState = 'loading';
let feedTotal = 0;
let feedOffset = 0;
let feedHasMore = false;
let feedQueryKey = '';
let feedVersion = 0;
let feedController;
let feedTimer;
let feedPromise;
let loading = false;
let eventSuburbs = [];
let suburbsPending = false;
let saved = [];
let eventFilters = emptyEventFilters();
const profileAgeSelection = EventPreferences.createSelection();
let eventForMe = false;
let eventProfileId = '';
let eventDetailsOpen = false;
let userLocation = null;
const EVENT_CHAT_WELCOME = 'Tell me the age, suburb, date, budget and any needs.';
let smartCriteria = null;
let eventChatMessages = [{role: 'assistant', content: EVENT_CHAT_WELCOME}];
let eventChatBusy = false;
let eventChatOpen = false;
let toastTimer;

// Keep every filter reset consistent across the Events page and home shortcuts.
function emptyEventFilters() {
  return {
    search: '',
    category: 'All activities',
    suburb: 'All suburbs',
    date: 'all',
    age: 'All ages',
    tag: 'All types',
    quick: '',
    maxPrice: 100,
    near: false
  };
}
function activeEventFilters() { return route === 'home' ? emptyEventFilters() : eventFilters; }
function syncEventProfile(profile = Social.profile()) {
  if (eventProfileId !== (profile?.id || '')) eventForMe = false;
  eventProfileId = profile?.id || '';
  if (profileAgeSelection.sync(profile)) eventFilters.age = EventPreferences.ageValue(profileAgeSelection.groups);
  if (!EventPreferences.interestTerms(profile?.interests).length) eventForMe = false;
}
function selectedEventAges() {
  return eventFilters.age === 'My child ages' ? EventPreferences.agesFor(profileAgeSelection.groups)
    : EventPreferences.groups[eventFilters.age] || [];
}
function eventPreferencesBar() {
  const profile = Social.profile();
  if (!profile) return '';
  const stored = EventPreferences.normaliseGroups(profile.ages);
  const selected = profileAgeSelection.groups;
  const usesSaved = stored.length && JSON.stringify(stored) === JSON.stringify(selected);
  const interestsAvailable = EventPreferences.interestTerms(profile.interests).length > 0;
  return `<div class="event-preferences-bar" aria-label="Your event preferences"><div class="event-preferences-actions">
    ${interestsAvailable ? `<button class="event-preference-button${eventForMe ? ' active' : ''}" type="button" data-events-for-me aria-pressed="${eventForMe}">${icon('user', 16)} For me${eventForMe ? icon('check',14) : ''}</button>` : '<a class="event-preference-link" href="#edit-profile">Add interests</a>'}
    ${stored.length && !usesSaved ? '<button class="event-preference-link" type="button" data-profile-ages>Use saved ages</button>' : ''}
    ${selected.length ? '<button class="event-preference-link" type="button" data-show-all-ages>Show all ages</button>' : ''}
    </div><p>${usesSaved ? `Child ages: ${escapeHTML(stored.map(group => group.replace(' years', '')).join(', '))}. ` : ''}${eventForMe ? 'Matching your saved interests. ' : ''}<a href="#edit-profile">Edit preferences</a></p></div>`;
}
function eventIdentity(event) {
  const normalise = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-AU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const start = Number.isFinite(Date.parse(event.start)) ? new Date(event.start).toISOString().slice(0, 16) : event.dateKey || event.date;
  return `${normalise(event.title)}|${start}|${normalise(event.venue || event.address || event.suburb)}`;
}
function uniqueEvents(items) {
  const seen = new Set();
  return items.filter(event => {
    const key = eventIdentity(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
function findEvent(id) { return [detailEvent, ...events, ...saved].find(event => event?.id === id); }
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
  syncEventProfile();
  const requested = location.hash.slice(1).split('/')[0];
  route = ['home', 'about', 'events', 'event', 'saved', 'community', 'club', 'post', 'member', 'profile', 'settings', 'edit-profile', 'login', 'register'].includes(requested) ? requested : 'home';
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === route || (route === 'event' && link.dataset.nav === 'events') || (link.dataset.nav === 'community' && ['club','post','member'].includes(route))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${route === 'home' ? 'Home' : route[0].toUpperCase() + route.slice(1)} · Family Finds`;
  // Scope larger type to Events without changing the other site pages.
  document.body.classList.toggle('events-route', route === 'events');
  document.body.classList.toggle('event-detail-route', route === 'event');
  document.body.classList.toggle('home-route', route === 'home');
  document.body.classList.toggle('community-route', ['community','club','post','member'].includes(route));
  document.body.classList.toggle('event-filters-expanded', route === 'events' && eventDetailsOpen);
  if (route === 'about') { main.innerHTML = aboutPage(); updateCount(); return; }
  if (Social.handles(route)) { Social.show(route); updateCount(); return; }
  if (route === 'event') { renderEventDetail(); updateCount(); return; }
  main.innerHTML = activitiesPage();
  ensureEventSearch();
  if (route === 'home' || (route === 'events' && (eventDetailsOpen || matchMedia('(min-width: 761px)').matches))) ensureSuburbOptions();
  renderEventResults();
  updateCount();
}
function aboutPage() {
  return `<article class="about-page">
    <header class="about-intro">
      <div class="eyebrow">ABOUT FAMILY FINDS</div>
      <h1>Good days start<br>close to home.</h1>
      <p class="intro">Find something the kids will enjoy, check what it costs, and make a plan with other families nearby.</p>
    </header>
    <div class="about-overview">
      <section class="about-section" aria-labelledby="about-purpose">
        <h2 id="about-purpose">Who we built it for</h2>
        <p>Family Finds is for Brisbane parents and caregivers planning free or low-cost outings with children. Cost, age suitability and location all matter when choosing a day out.</p>
        <p>We bring activities and local family clubs together so you can compare ideas, save favourites and find people to go with.</p>
      </section>
      <section class="about-section" aria-labelledby="about-dataset-choice">
        <h2 id="about-dataset-choice">Why we chose Council events</h2>
        <p>Brisbane City Council's Events dataset brings local activities, dates, venues, costs and age information together. Those details help parents judge whether an activity fits their family and budget.</p>
        <p>It also includes different kinds of outings, from library sessions to outdoor activities. Using this public dataset lets us focus on helping families find and compare them. <a href="references.html#council-events">Council dataset and source details</a>.</p>
      </section>
    </div>
    <section class="about-team" aria-labelledby="about-team-title">
      <div class="section-heading"><h2 id="about-team-title">Meet Team Lion Pride</h2><span class="subtle">DECO1800 · The University of Queensland</span></div>
      <p class="about-description">We are the four teammates behind Family Finds, created as part of our DECO1800 project.</p>
      <!-- Photo supplied by the team. Display crops follow the supplied left-to-right names. -->
      <ul class="about-team-grid">${[
        ['Jintian', 'jintian', 'UI Designer', ''],
        ['Ben', 'ben', 'UI Designer', ''],
        ['Pana', 'pana', 'UI Designer', ''],
        ['Zeyi', 'zeyi', 'Backend & Cloud Developer', 'Frontend design guidance']
      ].map(([name, portrait, role, contribution]) => `<li class="about-person"><span class="about-portrait about-portrait-${portrait}"><img src="assets/team-tradeshow.png" alt="${name}" width="1134" height="2016" loading="lazy" decoding="async"></span><h3>${name}</h3><p class="about-person-role">${role}</p>${contribution ? `<p class="about-person-contribution">${contribution}</p>` : ''}</li>`).join('')}</ul>
      <p class="about-photo-credit">Portraits from our tradeshow photo. <a href="references.html#team-photo">Photo credit</a></p>
    </section>
    <section class="about-section about-listing-notes" aria-labelledby="about-listings-title">
      <h2 id="about-listings-title">How we use the listings</h2>
      <dl class="about-listing-facts">
        <div><dt>What's included</dt><dd>We show upcoming entries from the Council feed and use Brisbane time. The feed is a daily extract, so changes may take time to appear. Activities outside the feed or already in progress may be missing.</dd></div>
        <div><dt>Filters are a starting point</dt><dd>Categories, tags and interest matches use words in the listings. Age filters look for listings that include ages in your chosen group. Parents still need to judge whether an activity suits their child and check pet or accessibility requirements with the organiser.</dd></div>
        <div><dt>When details are missing</dt><dd>If a price or age is missing, we ask you to check it. An unknown price is not treated as free. Listings without age information are excluded while an age filter is active. Suburbs may be taken from venue addresses.</dd></div>
      </dl>
      <p class="about-description">Saved child age groups stay private to your account. They help select events without asking for children's names or birth dates. Clubs and discussions are contributed by members and are separate from the Council listings.</p>
    </section>
    <aside class="about-disclaimer" aria-labelledby="about-disclaimer-title">
      <h2 id="about-disclaimer-title">Before you go</h2>
      <p>Family Finds is a student prototype, not an event organiser or booking service. We are not affiliated with or endorsed by Brisbane City Council, and we do not independently verify listings or member contributions.</p>
      <p>Saving an activity or showing interest does not reserve a place. Confirm the latest details and book directly with the organiser when required.</p>
      <p><a href="references.html">Sources &amp; credits</a> lists our dataset, event image sources, libraries and development tools.</p>
    </aside>
  </article>`;
}

function options(values, selected) { return values.map(value => `<option ${value === selected ? 'selected' : ''}>${escapeHTML(value)}</option>`).join(''); }

// Build the suburb list from live events, without prioritising any location.
function suburbOptions() {
  const suburbs = [...new Set([...eventSuburbs, ...events.map(event => event.suburb), eventFilters.suburb === 'All suburbs' ? '' : eventFilters.suburb].filter(Boolean))]
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

function eventPrice(event) {
  if (event.cost === 0) return 0;
  const match = String(event.costLabel || '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function eventDistance(event) {
  if (!userLocation || !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)) return null;
  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(event.latitude - userLocation.latitude);
  const longitudeDelta = toRadians(event.longitude - userLocation.longitude);
  const startLatitude = toRadians(userLocation.latitude);
  const endLatitude = toRadians(event.latitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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
    ['weekend', 'Weekend', eventFilters.date === 'weekend'],
    ['near', 'Near me', eventFilters.near]
  ];

  return `
    <div class="search-row event-filter-row event-filter-search-row">
      <label class="search-field">
        <span aria-hidden="true">${icon('search', 18)}</span>
        <input type="search" id="event-search" aria-label="Search activities"
          placeholder="Search events" value="${escapeHTML(eventFilters.search)}">
      </label>
      <button type="button" class="event-filter-toggle" data-filter-toggle aria-label="Filters"
        aria-expanded="${eventDetailsOpen}" aria-controls="event-filter-details">
        ${icon('filters', 18)} <span>More filters</span><span class="event-filter-count" data-filter-count hidden></span>
        <span class="event-filter-chevron" aria-hidden="true"></span>
      </button>
    </div>
    ${eventPreferencesBar()}
    <div class="event-quick-filters" role="group" aria-label="Quick filters">
      ${quickFilters.map(([id, label, active]) => `
        <button type="button" class="event-quick-filter${active ? ' active' : ''}"
          data-event-quick="${id}" aria-pressed="${active}">${quickIcon(id)} ${label}</button>`).join('')}
    </div>
    <div id="event-filter-details" class="event-filter-details${eventDetailsOpen ? ' is-open' : ''}">
      <div class="event-filter-details-heading"><strong>Make it your kind of day</strong><button type="button" data-reset>Clear filters</button></div>
    <div class="search-row event-filter-row event-more-filters">
      <label class="event-date-picker event-filter-field">
        <span class="event-field-label">Date</span>
        <input type="date" id="event-date" aria-label="Activity date" value="${selectedDate}">
      </label>
      <label class="event-filter-field"><span class="event-field-label">Activity</span><select id="event-category" aria-label="Activity category">${options(categories, eventFilters.category)}</select></label>
      <label class="event-filter-field event-age-field"><span class="event-field-label">Child age</span><select id="event-age" aria-label="Child age range">${options(['All ages', ...(profileAgeSelection.groups.length > 1 ? ['My child ages'] : []), '0–3 years', '4–7 years', '8–12 years', '13–17 years'], eventFilters.age)}</select></label>
      <label class="event-filter-field event-suburb-field">
        <span class="event-field-label">Suburb</span>
        <select id="event-suburb" aria-label="Suburb">
          ${options(suburbOptions(), eventFilters.suburb)}
        </select>
      </label>
      <div class="event-filter-field event-price-field">
        <span class="event-field-label">Budget</span>
        <details class="event-price-filter">
          <summary class="${eventFilters.quick === 'free' || eventFilters.maxPrice < 100 ? 'active' : ''}">Price</summary>
          <div class="event-price-panel">
            <strong>Budget</strong>
            <div class="event-price-options" role="radiogroup" aria-label="Price type">
              <label><input type="radio" name="price-mode" value="any" ${eventFilters.quick !== 'free' ? 'checked' : ''}> Any price</label>
              <label><input type="radio" name="price-mode" value="free" ${eventFilters.quick === 'free' ? 'checked' : ''}> Free only</label>
            </div>
            <label class="event-price-maximum" for="event-price-range">
              Maximum price: <strong id="event-price-value">${eventFilters.maxPrice >= 100 ? '$100+' : `$${eventFilters.maxPrice}`}</strong>
            </label>
            <input type="range" id="event-price-range" min="0" max="100" step="5"
              value="${eventFilters.maxPrice}" ${eventFilters.quick === 'free' ? 'disabled' : ''}>
            <div class="event-price-scale"><span>$0</span><span>$100+</span></div>
            <button type="button" class="button primary event-price-apply" data-price-apply
              aria-label="Apply price filter">Apply</button>
          </div>
        </details>
      </div>
    </div>
    <button type="button" class="button primary event-filter-done" data-filter-close>Show activities</button></div>
    <div id="active-filter" role="group" aria-label="Active filters"></div>`;
}

// Update the mobile disclosure without rebuilding inputs or losing focus.
function setEventDetailsOpen(open) {
  eventDetailsOpen = open;
  document.body.classList.toggle('event-filters-expanded', open);
  const toggle = document.querySelector('[data-filter-toggle]');
  toggle?.setAttribute('aria-expanded', String(open));
  document.querySelector('#event-filter-details')?.classList.toggle('is-open', open);
  if (open) ensureSuburbOptions();
  if (!open) toggle?.focus();
}

function eventChatPanel() {
  const examples = [
    'We are a family of 4 with a 6-year-old and a dog. Find something free this weekend.',
    'Show me creative activities for an 8-year-old near Indooroopilly.',
    'We need a wheelchair-friendly activity in the next 7 days.'
  ];
  return `<div class="event-chat-shell">
    <button type="button" class="event-chat-launcher${eventChatOpen ? ' open' : ''}" data-ai-toggle aria-expanded="${eventChatOpen}" aria-controls="event-chat-panel">
      ${icon('message', 20)} <span>${eventChatOpen ? 'Close chat' : 'Ask AI'}</span>
    </button>
    ${eventChatOpen ? `<section class="event-chat" id="event-chat-panel" aria-labelledby="event-chat-title">
    <div class="event-chat-heading">
      <span class="event-chat-icon">${icon('message', 22)}</span>
      <div><span class="eyebrow">AI EVENT FINDER</span><h2 id="event-chat-title">Ask AI</h2></div>
      ${eventChatMessages.length > 1 ? '<button type="button" class="plain-button event-chat-reset" data-ai-reset>Start over</button>' : ''}
      <button type="button" class="plain-button event-chat-close" data-ai-toggle aria-label="Close AI chat">×</button>
    </div>
    <div class="event-chat-log" id="event-chat-log" aria-live="polite" aria-busy="${eventChatBusy}">
      ${eventChatMessages.map(message => `<div class="event-chat-message ${message.role}">${escapeHTML(message.content)}</div>`).join('')}
      ${eventChatBusy ? '<div class="event-chat-message assistant typing"><span></span><span></span><span></span><span class="chat-thinking">Understanding your request…</span></div>' : ''}
    </div>
    ${eventChatMessages.length === 1 ? `<div class="event-chat-examples" aria-label="Example questions">${examples.map((example, index) => `<button type="button" data-ai-prompt="${escapeHTML(example)}">${index === 0 ? 'Family + dog' : index === 1 ? 'Age + suburb' : 'Accessibility'}</button>`).join('')}</div>` : ''}
    <form class="event-chat-form" id="event-chat-form">
      <textarea id="event-chat-input" name="message" maxlength="500" rows="2" required aria-label="Describe the activity your family needs" placeholder="e.g. Free this weekend for a 6-year-old with our dog" ${eventChatBusy ? 'disabled' : ''}></textarea>
      <button class="button primary" type="submit" ${eventChatBusy ? 'disabled' : ''}>${eventChatBusy ? 'Thinking…' : `Ask ${icon('arrow', 16)}`}</button>
    </form>
    <p class="event-chat-note">Don’t share private details. <a href="references.html#event-finder">How this works</a></p>
  </section>` : ''}</div>`;
}

function activitiesPage() {
  const home = route === 'home';
  const savedPage = route === 'saved';
  const titles = { home: 'Out the door.<br>Into Brisbane.', events: '<span class="events-desktop-title">Find A Family Activity</span><span class="events-mobile-title">Events</span>', saved: 'Saved for later.' };
  return `${home ? '<div class="hero-shell">' : ''}<section class="home-intro"><div class="eyebrow">${savedPage ? 'SAVED' : home ? 'GOOD DAYS, CLOSE TO HOME' : 'BRISBANE FAMILY ACTIVITIES'}</div><h1>${titles[route]}</h1><p class="intro">${savedPage ? 'Activities you want to try.' : home ? 'Pick a park, market or storytime. Find what suits your family, then make a plan with people nearby.' : 'Find free family activities, nearby markets and local clubs.'}</p>${home ? '<div class="hero-actions"><a class="button primary" href="#events">Explore activities</a><a class="button" href="#community">Meet local clubs</a></div><p class="hero-small-note">Local ideas for ordinary afternoons and big weekends.</p>' : ''}</section>${home ? '<div class="hero-picture" id="home-hero-image"><span class="image-fallback">' + icon('leaf',45) + '</span></div></div>' : ''}
    ${home ? `<div class="section-heading"><h2>Quick browse</h2><span class="subtle">A good place to start</span></div><div class="quick-grid">
      ${[['free', '', 'Free activities', 'No-cost ideas'], ['weekend', '', 'This weekend', 'Saturday and Sunday'], ['markets', '', 'Markets & secondhand', 'Markets and swaps'], ['near', '', 'Near me', 'Choose your suburb']].map(([id, icon, title, subtitle]) => `<button class="quick-card" data-quick="${id}"><span class="quick-icon" aria-hidden="true">${quickIcon(id)}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>` : ''}
    ${route === 'events' ? eventChatPanel() : ''}
    ${home ? '<section class="home-picks-section" aria-label="Family activity highlights">' : ''}
    <div class="section-heading event-results-heading${home ? ' home-featured-heading' : ''}"><div>${home ? '<span class="eyebrow">A FEW IDEAS TO START</span>' : ''}<h2>${savedPage ? 'Saved activities' : home ? 'Activities worth planning' : 'Find your next activity'}</h2>${home ? '<p>Ideas from Brisbane City Council.</p>' : ''}</div></div>
    ${route === 'events' ? `<section class="event-filter-panel" aria-label="Filter activities">${eventFilterControls()}</section>` : ''}
    <div id="feed-status" class="result-meta" role="status"></div><div class="event-grid" id="event-results"></div><div id="load-more" class="section-heading"></div>
    ${home ? '<div class="home-all-events"><a class="button primary" href="#events">View all events</a></div></section>' : ''}
    ${home ? `<section class="community-callout"><div><div class="eyebrow">AROUND THE CORNER</div><h2>Good plans are better shared.</h2><p>Pass an activity on to your club or start a conversation with nearby families.</p></div><a class="button" href="#community">Explore the community <span aria-hidden="true">↗</span></a></section>` : ''}`;
}
let visibleLimit = 12;

function dateContext() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
  const startOfToday = Date.parse(`${today}T00:00:00Z`);
  const addDays = days => new Date(startOfToday + days * 86400000).toISOString().slice(0, 10);
  const day = new Date(startOfToday).getUTCDay();
  return {
    today,
    addDays,
    saturday: addDays(day === 0 ? -1 : (6 - day + 7) % 7),
    sunday: addDays(day === 0 ? 0 : (7 - day) % 7)
  };
}

function matchesEventDate(event, preference, dates) {
  return preference === 'all' || preference === 'any' ||
    (preference === 'today' && event.dateKey === dates.today) ||
    (preference === 'weekend' && event.dateKey >= dates.saturday && event.dateKey <= dates.sunday) ||
    (preference === 'next7' && event.dateKey >= dates.today && event.dateKey <= dates.addDays(6)) ||
    (preference === 'next30' && event.dateKey >= dates.today && event.dateKey <= dates.addDays(29)) ||
    event.dateKey === preference;
}

function eventAgeMatches(event, childAges) {
  return EventPreferences.matchesAges(event, childAges);
}

function eventMatchesSmartCriteria(event, dates) {
  if (route === 'home' || !smartCriteria) return true;
  const searchable = `${event.title} ${event.category} ${event.suburb} ${event.venue} ${event.description} ${event.requirements} ${event.ages}`.toLowerCase();
  const suburb = smartCriteria.suburb?.toLowerCase().trim();
  const matchesSuburb = !suburb || event.suburb.toLowerCase().includes(suburb) || suburb.includes(event.suburb.toLowerCase());
  const matchesInterests = !smartCriteria.interests?.length || smartCriteria.interests.includes(event.category) ||
    smartCriteria.interests.some(interest => searchable.includes(interest.toLowerCase()));
  const petTerms = /\b(?:dog|dogs|dog-friendly|pet|pets|pet-friendly|puppy|on-leash|off-leash)\b/i;
  const matchesPet = !smartCriteria.petFriendly || petTerms.test(searchable);
  const accessTerms = {wheelchair: /wheelchair|accessible/i, stroller: /stroller|pram|accessible/i, pram: /stroller|pram|accessible/i, 'sensory friendly': /sensory|quiet|low.?sensory/i};
  const matchesAccess = !(smartCriteria.accessibility?.length) || smartCriteria.accessibility.every(need => (accessTerms[need.toLowerCase()] || new RegExp(need.replace(/[^a-z0-9 ]/gi, ''), 'i')).test(searchable));
  return matchesSuburb && matchesInterests && matchesPet && matchesAccess &&
    (!smartCriteria.freeOnly || event.cost === 0) &&
    matchesEventDate(event, smartCriteria.date, dates) &&
    eventAgeMatches(event, smartCriteria.childAges);
}

// Event filter matching uses Brisbane calendar dates, so "Next 7 days" includes today.
function filteredEvents() {
  const dates = dateContext();
  const filters = activeEventFilters();
  const selectedSuburb = filters.suburb.toLowerCase();

  const matches = events.filter(event => {
    const matchesDate = matchesEventDate(event, filters.date, dates);
    const matchesSuburb = filters.suburb === 'All suburbs' ||
      event.suburb.toLowerCase() === selectedSuburb;
    const matchesCategory = filters.category === 'All activities' ||
      event.category === filters.category;
    const matchesAge = route !== 'events' || filters.age === 'All ages' ||
      eventAgeMatches(event, selectedEventAges());
    const matchesInterests = route !== 'events' || !eventForMe ||
      EventPreferences.matchesInterests(event, Social.profile()?.interests);
    const matchesTag = filters.tag === 'All types' ||
      (event.tags || []).includes(filters.tag);
    const matchesFree = filters.quick !== 'free' || event.cost === 0;
    const price = eventPrice(event);
    const matchesPrice = filters.maxPrice >= 100 ||
      (price !== null && price <= filters.maxPrice);
    const distance = eventDistance(event);
    const matchesNear = !filters.near || (distance !== null && distance <= 10);

    return matchesDate &&
      matchesSuburb &&
      matchesCategory &&
      matchesAge &&
      matchesInterests &&
      matchesTag &&
      matchesFree &&
      matchesPrice &&
      matchesNear &&
      eventMatchesSmartCriteria(event, dates);
  });
  return filters.near
    ? matches.sort((first, second) => eventDistance(first) - eventDistance(second))
    : matches;
}

// Active-filter chips show every applied condition and expose one remove button per condition.
function renderActiveFilters() {
  const active = document.querySelector('#active-filter');
  if (!active) return;

  const filters = [];
  if (eventFilters.search.trim()) filters.push(['search', `Search: ${eventFilters.search.trim()}`]);
  if (eventFilters.category !== 'All activities') filters.push(['category', `Category: ${eventFilters.category}`]);
  if (eventFilters.age !== 'All ages') filters.push(['age', `Age: ${eventFilters.age === 'My child ages' ? profileAgeSelection.groups.join(', ') : eventFilters.age}`]);
  if (eventForMe) filters.push(['for-me', 'Based on my interests']);
  if (eventFilters.tag !== 'All types') filters.push(['tag', `Activity: ${eventFilters.tag}`]);
  if (eventFilters.suburb !== 'All suburbs') filters.push(['suburb', `Suburb: ${eventFilters.suburb}`]);
  if (eventFilters.date !== 'all') filters.push(['date', `Date: ${dateFilterLabel(eventFilters.date)}`]);
  if (eventFilters.quick === 'free') filters.push(['quick', 'Free activities']);
  if (eventFilters.maxPrice < 100) filters.push(['maxPrice', `Up to $${eventFilters.maxPrice}`]);
  if (eventFilters.near) filters.push(['near', 'Within 10 km']);
  if (smartCriteria) filters.push(['smart-all', 'AI recommendations']);

  const quickStates = {
    free: eventFilters.quick === 'free',
    weekend: eventFilters.date === 'weekend',
    markets: eventFilters.category === 'Markets & secondhand',
    near: eventFilters.near
  };
  document.querySelectorAll('[data-event-quick]').forEach(button => {
    const selected = quickStates[button.dataset.eventQuick];
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  const count = document.querySelector('[data-filter-count]');
  if (count) {
    count.textContent = filters.length;
    count.hidden = filters.length === 0;
    count.setAttribute('aria-label', `${filters.length} active ${filters.length === 1 ? 'filter' : 'filters'}`);
  }

  const chips = filters.map(([key, label]) => `
    <span class="active-filter-chip">
      <span class="active-filter-name">${escapeHTML(label)}</span>
      <button type="button" data-remove-filter="${key}"
        aria-label="Remove ${escapeHTML(label)} filter">×</button>
    </span>`
  ).join('');
  active.innerHTML = filters.length ? `
    <div class="active-filter-list">
      <div class="active-filter-chips">${chips}</div>
      <button class="active-filter-clear" type="button" data-reset>Clear all</button>
    </div>` : '';
}
function bookingContact(event) {
  // Saved activities may contain a copy normalized before the feed wording was fixed.
  const mixedBooking = /\bbookings?\s+(?:are\s+)?required\b/i.test(event.bookings || '') && /\bno bookings?\s+(?:are\s+)?required\b/i.test(event.bookings || '');
  const plainNoBooking = /^(?:not required|no (?:pre-?)?bookings? (?:are |is )?(?:required|needed|necessary)|bookings? (?:are |is )?not (?:required|needed|necessary))\.?$/i.test((event.bookings || '').trim());
  if (!mixedBooking && (event.bookingRequired === false || plainNoBooking)) return { type: 'none' };
  const url = /^(?:https?:\/\/|mailto:)/i.test(event.bookingUrl || '') ? event.bookingUrl : '';
  if (url.startsWith('mailto:')) return { type: 'email', href: url };
  if (url) return { type: 'website', href: url };
  const phone = /^tel:\+?\d+$/i.test(event.bookingPhoneUrl || '') ? event.bookingPhoneUrl : '';
  if (phone && event.bookingPhone) return { type: 'phone', href: phone, label: event.bookingPhone, canBook: event.bookingPhoneCanBook };
  return { type: 'details' };
}
function bookingStatus(event, contact = bookingContact(event)) {
  if (contact.type === 'none') return 'No booking required';
  if (event.bookingRequired === true) return 'Booking required';
  return contact.type === 'details' ? 'Booking not specified' : 'Check booking details';
}
function bookingLinkLabel(event) {
  return /bookings?\s+(?:are\s+)?required\s+for\s+players/i.test(event.bookings || '') && /no bookings?\s+(?:are\s+)?required\s+for\s+spectators/i.test(event.bookings || '')
    ? 'Players: book online' : 'Book with organiser';
}
function eventCard(event) {
  const active = isSaved(event.id);
  const distance = eventDistance(event);
  const distanceLabel = route === 'events' && eventFilters.near && distance !== null ? ` · ${distance.toFixed(1)} km away` : '';
  const tags = (event.tags || []).slice(0, 2).map(tag => `<span class="activity-tag">${escapeHTML(tag)}</span>`).join('');
  const contact = bookingContact(event);
  const bookingAction = contact.type === 'none'
    ? '<span class="booking-note no-registration">No booking required</span>'
    : contact.type === 'details'
      ? `<span class="booking-note ${event.bookingRequired === true ? 'booking-required' : 'booking-unspecified'}">${bookingStatus(event, contact)}</span>`
      : `<a class="card-booking-link" href="${escapeHTML(contact.href)}" ${contact.type === 'website' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${contact.type === 'email' ? 'Email to book' : contact.type === 'phone' ? `Call ${escapeHTML(contact.label)} ${contact.canBook ? 'to book' : 'for details'}` : bookingLinkLabel(event)} ↗</a>`;
  return `<article class="event-card" data-event-card="${escapeHTML(event.id)}"><button class="event-card-open" type="button" data-event="${escapeHTML(event.id)}" aria-label="Open page for ${escapeHTML(event.title)}"></button><div class="event-visual">${event.image ? `<img src="${escapeHTML(event.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="image-fallback">${icon(event.category === 'Libraries' ? 'book' : event.category === 'Outdoors' ? 'leaf' : 'calendar',38)}</span>`}<span class="price-label">${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free' : 'Check cost'))}</span><button class="save-button" data-save="${escapeHTML(event.id)}" aria-label="${active ? 'Unsave' : 'Save'} ${escapeHTML(event.title)}" aria-pressed="${active}">${active ? '♥' : '♡'}</button></div><div class="event-content"><h3>${escapeHTML(event.title)}</h3><div class="event-meta"><span>${escapeHTML(event.date || event.day)} · ${escapeHTML(event.timeLabel || event.time || '')}</span><span>${escapeHTML(event.suburb)}${escapeHTML(distanceLabel)}</span><span>${escapeHTML(event.ages)}</span></div>${tags ? `<div class="activity-tags" aria-label="Activity tags">${tags}</div>` : ''}<div class="card-bottom">${bookingAction}</div></div></article>`;
}
function homeFeaturedEvents(list) {
  const ranked = list.map((event, index) => ({event, index, score: (event.image ? 3 : 0) + (event.cost === 0 ? 2 : 0) + (['Outdoors', 'Libraries', 'Creative'].includes(event.category) ? 1 : 0)}))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.event);
  const chosen = [];
  const categories = new Set();
  for (const event of ranked) {
    if (categories.has(event.category)) continue;
    chosen.push(event);
    categories.add(event.category);
    if (chosen.length === 6) return chosen;
  }
  return [...chosen, ...ranked.filter(event => !chosen.includes(event))].slice(0, 6);
}
function renderEventResults() {
  if (!document.querySelector('#event-results')) return;
  const hero = document.querySelector('#home-hero-image');
  const heroEvent = events.find(event => event.family && event.image && event.category === 'Outdoors') || events.find(event => event.family && event.image);
  if (hero && heroEvent && hero.dataset.event !== heroEvent.id) { hero.dataset.event = heroEvent.id; hero.innerHTML = `<img src="${escapeHTML(heroEvent.image)}" alt="${escapeHTML(heroEvent.title)}" referrerpolicy="no-referrer"><div class="hero-caption"><strong>${escapeHTML(heroEvent.title)}</strong>${escapeHTML(heroEvent.suburb)} · ${escapeHTML(heroEvent.costLabel)}</div>`; }
  const list = route === 'saved' ? saved : route === 'home' ? homeFeaturedEvents(filteredEvents()) : filteredEvents();
  const limit = route === 'home' ? 6 : visibleLimit;
  document.querySelector('#event-results').innerHTML = list.length ? list.slice(0, limit).map(eventCard).join('') : `<div class="empty-state"><h3>${route === 'saved' ? 'Your next family day starts here.' : feedState === 'loading' ? 'Finding activities around Brisbane…' : feedState === 'error' ? 'Council events are unavailable right now.' : feedHasMore ? 'No matches in this batch.' : 'No activities match just yet.'}</h3><p>${route === 'saved' ? (Social.profile() ? 'Tap the heart on an activity to keep it here.' : 'Log in to save activities and find them on any device.') : feedState === 'loading' ? 'Looking for activities that match your choices.' : feedState === 'error' ? 'Please try again in a moment.' : feedHasMore ? 'Load more to check further activities, or change your filters.' : 'Try another suburb, category or search.'}</p>${route === 'saved' ? `<a class="button" href="${Social.profile() ? '#events' : '#login'}">${Social.profile() ? 'Explore activities' : 'Log in to save activities'}</a>` : feedState === 'error' ? '<button class="button" data-retry>Try again</button>' : feedState !== 'loading' && !feedHasMore ? '<button class="button" data-reset>Clear filters</button>' : ''}</div>`;
  const hasMore = list.length > limit || feedHasMore;
  const shown = Math.min(list.length, limit);
  const feedSummary = feedState === 'loading' ? 'Loading activities…'
    : feedState === 'error' ? 'Couldn’t finish loading.'
    : `${shown} ${shown === 1 ? 'activity' : 'activities'}`;
  const status = route === 'saved'
    ? `${list.length} saved ${list.length === 1 ? 'activity' : 'activities'}`
    : route === 'home' && feedState === 'ready' ? `${shown} ${shown === 1 ? 'idea' : 'ideas'} to explore` : feedSummary;
  document.querySelector('#feed-status').textContent = status;
  if (feedState === 'error' && events.length && route !== 'saved') document.querySelector('#feed-status').insertAdjacentHTML('beforeend',' <button class="button small" data-retry>Retry</button>');
  const more = document.querySelector('#load-more');
  more.innerHTML = route === 'saved'
    ? (list.length > limit ? '<button class="button" data-more>Show more activities</button>' : '')
    : route !== 'home' && hasMore && feedState !== 'error'
      ? `<button class="button" data-more ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Load more activities'}</button>` : '';
  renderActiveFilters();
}
function showDialog(html) { content.innerHTML = html; modal.classList.remove('event-detail-modal'); modal.removeAttribute('data-event-id'); if (!modal.open) modal.showModal(); }
function openEvent(id) {
  eventReturnRoute = ['home', 'saved'].includes(route) ? route : 'events';
  navigate(`event/${encodeURIComponent(id)}`);
}
function eventDetailPage(event) {
  const contact = bookingContact(event);
  const status = bookingStatus(event, contact);
  const sourceUrl = event.live && /^https:\/\//i.test(event.url || '') ? event.url : '';
  const sourceNote = sourceUrl
    ? `<p class="event-source-note"><a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">Original Council listing ↗</a></p>` : '';
  const bookingAction = contact.href
    ? `<a class="button primary" href="${escapeHTML(contact.href)}" ${contact.type === 'website' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${contact.type === 'email' ? 'Email organiser' : contact.type === 'phone' ? `Call ${escapeHTML(contact.label)} ${contact.canBook ? 'to book' : 'for details'}` : bookingLinkLabel(event)} ↗</a>`
    : contact.type !== 'none' && sourceUrl
      ? `<a class="button primary" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">Check Council listing ↗</a>` : '';
  const genericNoBooking = /^(?:not required|no bookings? (?:are )?(?:required|needed))\.?$/i.test(event.bookings || '');
  const bookingCopy = contact.type === 'none' && genericNoBooking ? '' : event.bookings || (contact.type === 'none' ? ''
    : event.bookingRequired === true ? 'Booking is required. Check the Council listing for instructions.'
      : 'The Council listing does not specify whether booking is needed.');
  const tags = (event.tags || []).map(tag => `<span class="activity-tag">${escapeHTML(tag)}</span>`).join('');
  const active = isSaved(event.id);
  const back = eventReturnRoute === 'home' ? ['home', 'Home'] : eventReturnRoute === 'saved' ? ['saved', 'Saved activities'] : ['events', 'All events'];
  return `<div class="event-detail-page"><div class="event-detail-topbar"><a class="back-link" href="#${back[0]}">${icon('back',16)} ${back[1]}</a><button class="save-button event-page-save" type="button" data-save="${escapeHTML(event.id)}" aria-pressed="${active}" aria-label="${active ? 'Unsave' : 'Save'} ${escapeHTML(event.title)}">${active ? '♥' : '♡'}</button></div><section class="event-page-hero"><div class="event-page-intro"><div class="eyebrow">${escapeHTML(event.category || 'FAMILY ACTIVITY')}</div><h1>${escapeHTML(event.title)}</h1><div class="event-page-facts"><div><span>${icon('calendar',18)} Date & time</span><strong>${escapeHTML(event.time || event.date || 'Check date and time')}</strong></div><div><span>${icon('pin',18)} Location</span><strong>${escapeHTML(event.venue || event.suburb)}${event.address ? `<small>${escapeHTML(event.address)}</small>` : ''}</strong></div><div><span>${icon('people',18)} Suitable for</span><strong>${escapeHTML(event.ages || 'Check age suitability')}</strong></div><div><span>Cost</span><strong>${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free entry' : 'Check cost'))}</strong></div></div>${tags ? `<div class="activity-tags event-page-tags" aria-label="Activity tags">${tags}</div>` : ''}</div><div class="event-page-visual">${event.image ? `<img src="${escapeHTML(event.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="image-fallback">${icon(event.category === 'Libraries' ? 'book' : event.category === 'Outdoors' ? 'leaf' : 'calendar',64)}</span>`}</div></section><div class="event-page-layout"><aside class="event-booking-panel" aria-labelledby="event-booking-heading"><span class="event-booking-status ${contact.type === 'none' ? 'not-required' : event.bookingRequired === true ? 'required' : ''}">${status}</span><h2 id="event-booking-heading">Booking</h2>${bookingCopy ? `<p>${escapeHTML(bookingCopy)}</p>` : ''}${bookingAction}${sourceNote}</aside><div class="event-page-content"><section><h2>About this activity</h2><p>${escapeHTML(event.description || 'The organiser has not added a description.')}</p></section><section><h2>Before you go</h2><p>${escapeHTML(event.requirements || 'No extra requirements listed.')}</p></section>${Social.eventInterestDetail(event.id)}</div></div></div>`;
}
async function renderEventDetail() {
  const version = ++detailRequestVersion;
  let id;
  try { id = decodeURIComponent(location.hash.slice('#event/'.length)); } catch { id = ''; }
  if (!location.hash.startsWith('#event/') || !id) {
    main.innerHTML = '<div class="empty-state"><h1>Event link not found</h1><a class="button" href="#events">Browse events</a></div>';
    return;
  }
  const cached = findEvent(id);
  if (cached) { detailEvent = cached; main.innerHTML = eventDetailPage(cached); document.title = `${cached.title} · Family Finds`; return; }
  main.innerHTML = '<div class="loading-panel">Loading event details…</div>';
  try {
    const event = await CouncilEvents.loadById(id);
    if (version !== detailRequestVersion || route !== 'event') return;
    if (!event) throw new Error('This event is no longer listed.');
    detailEvent = event;
    main.innerHTML = eventDetailPage(event);
    document.title = `${event.title} · Family Finds`;
  } catch (error) {
    if (version === detailRequestVersion && route === 'event') main.innerHTML = `<div class="empty-state"><h1>Event unavailable</h1><p>${escapeHTML(error.message)}</p><a class="button" href="#events">Browse events</a></div>`;
  }
}

function showLocationConsent() {
  showDialog(`<div class="eyebrow">NEAR ME</div><h2 id="modal-title">Use your current location?</h2><p>Family Finds will use your location to show activities within 10 km and sort them by distance. Your coordinates are not saved by this site.</p><div class="form-actions"><button type="button" class="button" data-close>Not now</button><button type="button" class="button primary" data-allow-location>Allow location</button></div>`);
}

function enableNearMe(button) {
  if (!navigator.geolocation) {
    modal.close();
    notify('Location is not available in this browser.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(position => {
    userLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    eventFilters.near = true;
    eventFilters.suburb = 'All suburbs';
    visibleLimit = 12;
    modal.close();
    render();
    notify('Showing activities within 10 km, nearest first.');
  }, error => {
    modal.close();
    notify(error.code === error.PERMISSION_DENIED
      ? 'Location permission was not allowed.'
      : 'Your location could not be found. Please try again.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

// Removing a chip changes only its own filter and keeps the other selections.
function removeEventFilter(filter) {
  if (filter === 'smart-all' && smartCriteria) {
    smartCriteria = null;
  } else if (filter === 'for-me') {
    eventForMe = false;
  } else if (Object.prototype.hasOwnProperty.call(eventFilters, filter)) {
    eventFilters[filter] = emptyEventFilters()[filter];
    if (filter === 'age') profileAgeSelection.clear();
  } else {
    return;
  }

  visibleLimit = 12;
  render();
}

// Start over with every filter off.
function clearEventFilters() {
  eventFilters = emptyEventFilters();
  profileAgeSelection.clear();
  eventForMe = false;
  userLocation = null;
  smartCriteria = null;
  eventChatMessages = [{role: 'assistant', content: EVENT_CHAT_WELCOME}];
  visibleLimit = 12;
  render();
}

function resetEventChat() {
  smartCriteria = null;
  eventChatMessages = [{role: 'assistant', content: EVENT_CHAT_WELCOME}];
  visibleLimit = 12;
  render();
}

function criteriaSummary(criteria) {
  const parts = [];
  if (criteria.childAges?.length) parts.push(`age ${criteria.childAges.join(' + ')}`);
  if (criteria.familySize) parts.push(`group of ${criteria.familySize}`);
  if (criteria.petFriendly) parts.push('pet friendly');
  if (criteria.freeOnly) parts.push('free');
  if (criteria.date && criteria.date !== 'any') parts.push(dateFilterLabel(criteria.date).toLowerCase());
  if (criteria.suburb) parts.push(`around ${criteria.suburb}`);
  if (criteria.interests?.length) parts.push(criteria.interests.join(' or '));
  if (criteria.accessibility?.length) parts.push(criteria.accessibility.join(' and '));
  return parts;
}

function eventChatReply(criteria, matchCount) {
  const summary = criteriaSummary(criteria);
  if (!summary.length) return 'Add an age, suburb, date, budget or interest.';
  if (!matchCount) return feedHasMore ? 'No matches in this batch. Tap Load more activities, or try fewer details.' : 'No exact matches yet. Remove one detail or try a nearby suburb.';
  const shown = summary.slice(0, 4).join(' · ');
  const extra = summary.length > 4 ? ` · +${summary.length - 4} more` : '';
  return `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}${feedHasMore ? ' so far' : ''} · ${shown}${extra}${criteria.petFriendly || criteria.accessibility?.length ? '. Check pet and access rules with the organiser.' : ''}`;
}

async function submitEventChat(message) {
  const clean = String(message || '').trim();
  if (!clean || eventChatBusy) return;
  eventChatMessages.push({role: 'user', content: clean});
  eventChatOpen = true;
  eventChatBusy = true;
  render();
  try {
    const userMessages = eventChatMessages.filter(item => item.role === 'user').slice(-8);
    const result = await Social.api('/ai/events', {method: 'POST', body: JSON.stringify({messages: userMessages})});
    smartCriteria = result.criteria;
    visibleLimit = 12;
    await ensureEventSearch();
    if (feedState === 'error') throw new Error('Council events could not be loaded. Please try again.');
    const matches = filteredEvents().length;
    eventChatMessages.push({role: 'assistant', content: eventChatReply(smartCriteria, matches)});
  } catch (error) {
    eventChatMessages.push({role: 'assistant', content: `I couldn’t update the recommendations just now. ${error.message}`});
  } finally {
    eventChatBusy = false;
    render();
    document.querySelector('#event-chat-log')?.scrollTo({top: 9999, behavior: 'smooth'});
  }
}

// Home shortcuts open Events with the matching category, date or price filter.
function openQuickFilter(quick) {
  eventFilters = emptyEventFilters();
  eventFilters.age = EventPreferences.ageValue(profileAgeSelection.groups);
  if (quick === 'markets') eventFilters.category = 'Markets & secondhand';
  if (quick === 'weekend') eventFilters.date = 'weekend';
  if (quick === 'free') eventFilters.quick = 'free';

  navigate('events');
  if (quick === 'near') {
    setTimeout(showLocationConsent, 50);
  }
}

// Toggle quick filters without clearing other choices.
function toggleEventQuickFilter(quick) {
  if (quick === 'free') {
    eventFilters.quick = eventFilters.quick === 'free' ? '' : 'free';
    if (eventFilters.quick === 'free') eventFilters.maxPrice = 100;
  }
  else if (quick === 'weekend') eventFilters.date = eventFilters.date === 'weekend' ? 'all' : 'weekend';
  else if (quick === 'markets') eventFilters.category = eventFilters.category === 'Markets & secondhand' ? 'All activities' : 'Markets & secondhand';
  else if (quick === 'near') {
    if (eventFilters.near) {
      eventFilters.near = false;
      userLocation = null;
      visibleLimit = 12;
      render();
    } else {
      showLocationConsent();
    }
    return;
  } else return;

  visibleLimit = 12;
  render();
}

document.addEventListener('click', event => {
  const card = event.target.closest('[data-event-card]');
  if (card && !event.target.closest('button, a, input, select, textarea, summary')) {
    openEvent(card.dataset.eventCard);
    return;
  }
  const button = event.target.closest('button, [data-close]');
  if (!button) return;
  if (button.hasAttribute('data-events-for-me')) {
    eventForMe = !eventForMe;
    visibleLimit = 12;
    render();
    return;
  }
  if (button.hasAttribute('data-profile-ages') || button.hasAttribute('data-show-all-ages')) {
    if (button.hasAttribute('data-profile-ages')) profileAgeSelection.restore(Social.profile());
    else profileAgeSelection.clear();
    eventFilters.age = EventPreferences.ageValue(profileAgeSelection.groups);
    visibleLimit = 12;
    render();
    return;
  }
  if (button.hasAttribute('data-filter-toggle')) { setEventDetailsOpen(!eventDetailsOpen); return; }
  if (button.hasAttribute('data-filter-close')) { setEventDetailsOpen(false); return; }
  if (button.hasAttribute('data-ai-toggle')) {
    eventChatOpen = !eventChatOpen;
    render();
    if (eventChatOpen) setTimeout(() => document.querySelector('#event-chat-input')?.focus(), 0);
    return;
  }
  if (button.hasAttribute('data-ai-reset')) { resetEventChat(); return; }
  if (button.hasAttribute('data-ai-prompt')) { submitEventChat(button.dataset.aiPrompt); return; }
  if (button.matches('[data-close], .close-button')) modal.close();
  if (button.hasAttribute('data-save')) toggleSave(button.dataset.save);
  if (button.hasAttribute('data-event')) openEvent(button.dataset.event);
  if (button.hasAttribute('data-event-interest')) Social.toggleEventInterest(button.dataset.eventInterest);
  if (button.hasAttribute('data-more')) {
    if (loading && route !== 'saved') return;
    visibleLimit += 12;
    if (route !== 'saved' && filteredEvents().length < visibleLimit && feedHasMore) loadEvents();
    else renderEventResults();
  }
  if (button.hasAttribute('data-reset')) { clearEventFilters(); return; }
  if (button.hasAttribute('data-remove-filter')) {
    removeEventFilter(button.dataset.removeFilter);
    return;
  }
  if (button.hasAttribute('data-retry')) loadEvents();
  if (button.hasAttribute('data-allow-location')) {
    enableNearMe(button);
    return;
  }
  if (button.hasAttribute('data-price-apply')) {
    const panel = button.closest('.event-price-panel');
    const freeOnly = panel.querySelector('[name="price-mode"]:checked').value === 'free';
    eventFilters.quick = freeOnly ? 'free' : '';
    eventFilters.maxPrice = freeOnly ? 100 : Number(panel.querySelector('#event-price-range').value);
    visibleLimit = 12;
    render();
    return;
  }
  if (button.hasAttribute('data-event-quick')) {
    toggleEventQuickFilter(button.dataset.eventQuick);
    return;
  }
  if (button.hasAttribute('data-quick')) openQuickFilter(button.dataset.quick);
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'event-chat-form') return;
  event.preventDefault();
  const input = event.target.elements.message;
  submitEventChat(input.value);
});

// Text search updates results immediately without rebuilding the focused input.
document.addEventListener('input', event => {
  if (event.target.id === 'event-search') {
    eventFilters.search = event.target.value;
    visibleLimit = 12;
    ensureEventSearch(350);
    renderEventResults();
  } else if (event.target.id === 'event-price-range') {
    document.querySelector('#event-price-value').textContent = event.target.value === '100' ? '$100+' : `$${event.target.value}`;
  }
});

// Filter changes preserve all other active filters.
document.addEventListener('change', event => {
  const field = event.target;
  if (field.id === 'event-date') eventFilters.date = field.value || 'all';
  else if (field.id === 'event-category') eventFilters.category = field.value;
  else if (field.id === 'event-age') {
    eventFilters.age = field.value;
    if (field.value !== 'My child ages') profileAgeSelection.select([field.value]);
  }
  else if (field.id === 'event-tag') eventFilters.tag = field.value;
  else if (field.id === 'event-suburb') eventFilters.suburb = field.value;
  else if (field.name === 'price-mode') {
    const range = document.querySelector('#event-price-range');
    range.disabled = field.value === 'free';
    return;
  }
  else return;

  visibleLimit = 12;
  if (field.id === 'event-age') { render(); return; }
  ensureEventSearch();
  renderEventResults();
});
document.addEventListener('focusin', event => { if (event.target.id === 'event-suburb') ensureSuburbOptions(); });
modal.addEventListener('click', event => { if (event.target === modal) { const bounds = modal.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close(); } });
window.addEventListener('hashchange', () => { if (modal.open) modal.close(); visibleLimit = 12; render(); main.focus(); window.scrollTo(0,0); });
window.addEventListener('popstate', () => { if (!location.hash) { visibleLimit = 12; render(); main.focus(); window.scrollTo(0,0); } });
function eventRequestFilters() {
  const dates = dateContext();
  const filters = activeEventFilters();
  const criteria = route === 'home' ? null : smartCriteria;
  const dateRanges = [filters.date, criteria?.date].map(value => {
    if (value === 'today') return {start: dates.today, end: dates.today};
    if (value === 'weekend') return {start: dates.saturday, end: dates.sunday};
    if (value === 'next7') return {start: dates.today, end: dates.addDays(6)};
    if (value === 'next30') return {start: dates.today, end: dates.addDays(29)};
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? {start: value, end: value} : null;
  }).filter(Boolean);
  return {
    search: filters.search.trim(), category: filters.category, tag: filters.tag, dateRanges,
    suburbs: [filters.suburb === 'All suburbs' ? '' : filters.suburb, criteria?.suburb].filter(Boolean),
    freeOnly: filters.quick === 'free' || criteria?.freeOnly,
    familyOnly: false,
    ageFilter: route === 'events' && (selectedEventAges().length > 0 || !!criteria?.childAges?.length),
    interestTerms: route === 'events' && eventForMe ? EventPreferences.interestTerms(Social.profile()?.interests) : [],
    petFriendly: criteria?.petFriendly, accessibility: criteria?.accessibility
  };
}

// Cancel superseded searches; rerendering or changing routes reuses the current query.
function ensureEventSearch(delay = 0) {
  if (!['home', 'events'].includes(route)) return Promise.resolve();
  const key = JSON.stringify([route, activeEventFilters(), route === 'home' ? null : smartCriteria, route === 'home' ? null : userLocation, route === 'events' ? [profileAgeSelection.groups, eventForMe, eventForMe ? Social.profile()?.interests : []] : null]);
  if (key === feedQueryKey) return feedPromise || Promise.resolve();
  feedQueryKey = key;
  feedVersion += 1;
  feedController?.abort();
  clearTimeout(feedTimer);
  loading = false;
  feedOffset = 0;
  feedHasMore = false;
  feedTotal = 0;
  events = [];
  feedState = 'loading';
  if (delay) {
    feedPromise = null;
    feedTimer = setTimeout(() => { feedPromise = loadEvents(); }, delay);
    return Promise.resolve();
  }
  feedPromise = loadEvents();
  return feedPromise;
}

async function loadEvents() {
  if (loading) return;
  const version = feedVersion;
  const filters = eventRequestFilters();
  const controller = new AbortController();
  feedController = controller;
  loading = true;
  feedState = 'loading';
  renderEventResults();
  try {
    // Filters may need a few candidate pages, but never scan the whole feed automatically.
    for (let pages = 0; pages < 3; pages += 1) {
      const page = await CouncilEvents.loadPage(filters, feedOffset, controller.signal);
      if (version !== feedVersion) return;
      events = uniqueEvents([...events, ...page.events]);
      feedTotal = page.total;
      feedOffset = page.nextOffset;
      feedHasMore = page.hasMore;
      if (!feedHasMore || filteredEvents().length >= visibleLimit) break;
    }
    feedState = 'ready';
  } catch (error) {
    if (version !== feedVersion || controller.signal.aborted) return;
    feedState = 'error';
    console.warn('Council events could not finish loading:', error.message);
  } finally {
    if (version === feedVersion) {
      loading = false;
      const suburbs = document.querySelector('#event-suburb');
      if (suburbs) suburbs.innerHTML = options(suburbOptions(), eventFilters.suburb);
      renderEventResults();
    }
  }
}

async function ensureSuburbOptions() {
  if (suburbsPending || eventSuburbs.length) return;
  suburbsPending = true;
  try {
    eventSuburbs = await CouncilEvents.loadSuburbs();
    const select = document.querySelector('#event-suburb');
    if (select) select.innerHTML = options(suburbOptions(), eventFilters.suburb);
  } catch (error) { console.warn('Suburb options could not be loaded:', error.message); }
  finally { suburbsPending = false; }
}
window.addEventListener('family-finds-profile-updated', event => {
  syncEventProfile(event.detail?.profile || null);
  if (route === 'events') { visibleLimit = 12; render(); }
});
render();
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
        await ensureEventSearch();
        return { feedState, matches: filteredEvents().length, activities: filteredEvents().slice(0,12).map(({id,title,date,suburb,costLabel}) => ({id,title,date,suburb,costLabel})) };
      }
    }, { signal: lifecycle.signal })).catch(() => {});
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  } catch { /* Unsupported experimental API must not affect normal browser use. */ }
}

function quickIcon(id) { return icon({free:'heart',weekend:'calendar',markets:'swap',near:'pin'}[id],21); }
