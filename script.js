/* Shared wireframe interactions. All community actions stay in this browser tab. */
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
let route = 'home';
let posts = structuredClone(initialPosts);
let events = [];
let feedState = 'loading';
let feedTotal = 0;
let saved = readSaved();
let helpful = new Set();
let topic = 'All discussions';
let discussionSearch = '';
let sortPosts = 'newest';
let familyOnly = true;
let eventFilters = { search: '', category: 'All activities', suburb: 'All suburbs', quick: '' };
let toastTimer;

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem('family-finds-saved') || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string') : [];
  } catch { return []; }
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
function findEvent(id) { return [...events, ...saved, ...activities].find(event => event.id === id); }
function toggleSave(id) {
  const event = findEvent(id);
  if (!event) return;
  const removing = isSaved(id);
  saved = removing ? saved.filter(item => item.id !== id) : [...saved, event];
  try { localStorage.setItem('family-finds-saved', JSON.stringify(saved)); }
  catch { notify('Saved for this visit. Browser storage is unavailable.'); updateCount(); refreshSaveButtons(); return; }
  updateCount(); refreshSaveButtons();
  notify(removing ? 'Removed from saved activities.' : 'Activity saved on this device.');
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
  if (location.hash === `#${next}`) render();
  else location.hash = next;
}
function render() {
  route = ['home', 'events', 'saved', 'community'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${route === 'home' ? 'Home' : route[0].toUpperCase() + route.slice(1)} · Family Finds`;
  main.innerHTML = route === 'community' ? communityPage() : activitiesPage();
  if (route === 'community') renderPosts(); else renderEventResults();
  updateCount();
}
function options(values, selected) { return values.map(value => `<option ${value === selected ? 'selected' : ''}>${escapeHTML(value)}</option>`).join(''); }
function activitiesPage() {
  const home = route === 'home';
  const savedPage = route === 'saved';
  const titles = { home: 'Find fun activities in Brisbane.', events: 'A little plan. A great day out.', saved: 'Good finds, kept for later.' };
  return `<section class="home-intro"><div class="eyebrow">${savedPage ? 'YOUR COLLECTION' : 'BRISBANE / FAMILY ACTIVITIES'}</div><h1>${titles[route]}</h1><p class="intro">${savedPage ? 'Your saved activities live on this device, ready for your next family day out.' : 'Discover free activities, local markets and things to do together — with a little less spending.'}</p></section>
    ${home ? `<div class="section-heading"><h2>Quick browse</h2><span class="subtle">A good place to start</span></div><div class="quick-grid">
      ${[['free', '♡', 'Free activities', 'Fun without the spend'], ['weekend', '▦', 'This weekend', 'Make a little plan'], ['markets', '↔', 'Markets & secondhand', 'Find a little treasure'], ['near', '⌖', 'Near me', 'Browse by suburb']].map(([id, icon, title, subtitle]) => `<button class="quick-card" data-quick="${id}"><span class="quick-icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('')}</div>` : ''}
    <div class="section-heading"><h2>${savedPage ? 'Saved activities' : home ? 'Explore activities' : 'Find your next activity'}</h2>${home ? '<a class="text-link" href="#events">View all events ↗</a>' : ''}</div>
    ${!savedPage ? `<div class="search-row"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="event-search" aria-label="Search activities" placeholder="Search activities, places or interests" value="${escapeHTML(eventFilters.search)}"></label><select id="event-category" aria-label="Activity category">${options(['All activities', 'Outdoors', 'Libraries', 'Creative', 'Markets & secondhand', 'Other activities'], eventFilters.category)}</select><select id="event-suburb" aria-label="Suburb">${options(['All suburbs', ...new Set(events.map(event => event.suburb))].sort((a,b)=>a === 'All suburbs' ? -1 : b === 'All suburbs' ? 1 : a.localeCompare(b)),eventFilters.suburb)}</select></div><div id="active-filter"></div>` : ''}
    ${!savedPage ? `<label class="family-filter"><input type="checkbox" id="family-only" ${familyOnly ? 'checked' : ''}> Activities listed for children, teens or all ages</label>` : ''}
    <div id="feed-status" class="result-meta" role="status"></div><div class="event-grid" id="event-results"></div><div id="load-more" class="section-heading"></div>
    ${home ? `<section class="community-callout"><div><div class="eyebrow">BETTER TOGETHER</div><h2>A local find is better when it’s shared.</h2><p>Swap ideas, ask a question or meet other Brisbane families.</p></div><a class="button" href="#community">Explore the community <span aria-hidden="true">↗</span></a></section>` : ''}`;
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
    return (!familyOnly || event.family) && text.includes(eventFilters.search.toLowerCase()) && (eventFilters.category === 'All activities' || event.category === eventFilters.category) && (eventFilters.suburb === 'All suburbs' || event.suburb === eventFilters.suburb) && (eventFilters.quick !== 'free' || event.cost === 0) && (eventFilters.quick !== 'weekend' || event.dateKey === saturday || event.dateKey === sunday);
  });
}
function eventCard(event) {
  const active = isSaved(event.id);
  return `<article class="event-card"><div class="placeholder"><span class="placeholder-label">ACTIVITY IMAGE</span><span class="price-label">${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free' : `$${event.cost}`))}</span><button class="save-button" data-save="${escapeHTML(event.id)}" aria-label="${active ? 'Unsave' : 'Save'} ${escapeHTML(event.title)}" aria-pressed="${active}">${active ? '♥' : '♡'}</button></div><div class="event-content"><p class="event-category">${escapeHTML(event.category)}</p><h3>${escapeHTML(event.title)}</h3><div class="event-meta">${escapeHTML(event.date || event.day)} · ${escapeHTML(event.suburb)}<br>${escapeHTML(event.venue)}</div><div class="card-bottom"><span>${escapeHTML(event.ages)}</span><button data-event="${escapeHTML(event.id)}">Details ↗</button></div></div></article>`;
}
function renderEventResults() {
  if (!document.querySelector('#event-results')) return;
  const list = route === 'saved' ? saved : filteredEvents();
  const limit = route === 'home' ? 6 : visibleLimit;
  document.querySelector('#event-results').innerHTML = list.length ? list.slice(0, limit).map(eventCard).join('') : `<div class="empty-state"><h3>${route === 'saved' ? 'Your next family day starts here.' : feedState === 'loading' ? 'Finding activities around Brisbane…' : feedState === 'error' ? 'Council events are unavailable right now.' : 'No activities match just yet.'}</h3><p>${route === 'saved' ? 'Tap the heart on an activity to keep it here.' : feedState === 'loading' ? 'Loading the latest published council listings.' : feedState === 'error' ? 'Please try again in a moment. We haven’t replaced live results with sample events.' : 'Try another suburb, category or search.'}</p>${route === 'saved' ? '<a class="button" href="#events">Explore activities</a>' : feedState === 'error' ? '<button class="button" data-retry>Try again</button>' : feedState !== 'loading' ? '<button class="button" data-reset>Clear filters</button>' : ''}</div>`;
  const status = route === 'saved' ? `${list.length} saved ${list.length === 1 ? 'activity' : 'activities'} · Stored on this device` : `${list.length} matching activities · ${feedState === 'loading' ? `Loading council listings (${events.length}${feedTotal ? ` of ${feedTotal}` : ''})…` : feedState === 'error' ? `Live feed interrupted; ${events.length} listings loaded. Retry to load the full feed.` : `${events.length} live council listings · Check age suitability and booking details`}`;
  document.querySelector('#feed-status').textContent = status;
  if (feedState === 'error' && events.length && route !== 'saved') document.querySelector('#feed-status').insertAdjacentHTML('beforeend',' <button class="button small" data-retry>Retry</button>');
  const more = document.querySelector('#load-more');
  more.innerHTML = route !== 'home' && list.length > limit ? `<button class="button" data-more>Show more activities (${list.length - limit} remaining)</button>` : '';
  const active = document.querySelector('#active-filter');
  if (active) active.innerHTML = eventFilters.quick || eventFilters.category !== 'All activities' || eventFilters.suburb !== 'All suburbs' || eventFilters.search ? `<p class="subtle">${eventFilters.quick === 'free' ? 'Showing free activities. ' : eventFilters.quick === 'weekend' ? 'Showing this weekend. ' : ''}<button class="button small" data-reset>Clear filters ×</button></p>` : '';
}
function communityPage() {
  return `<section class="page-heading"><div><div class="eyebrow">YOUR LOCAL CIRCLE</div><h1>A little help. A lot of community.</h1><p class="intro">Connect with Brisbane families. Share a good find, make a plan, or simply ask.</p></div><button class="button primary" data-compose><span aria-hidden="true">＋</span> Start a discussion</button></section>
    <div class="community-layout"><section aria-label="Community discussions"><div class="topic-tabs" role="group" aria-label="Filter discussions">${['All discussions', 'Meetups', 'Local tips', 'Swap & share'].map(item => `<button class="topic-tab ${topic === item ? 'active' : ''}" data-topic="${item}" aria-pressed="${topic === item}">${item}</button>`).join('')}</div>
    <div class="search-row community-search"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="discussion-search" placeholder="Search conversations in your community" aria-label="Search community discussions" value="${escapeHTML(discussionSearch)}"></label></div>
    <div class="feed-heading"><p id="post-count" role="status"></p><select id="post-sort" aria-label="Sort discussions"><option value="newest" ${sortPosts === 'newest' ? 'selected' : ''}>Most recent</option><option value="helpful" ${sortPosts === 'helpful' ? 'selected' : ''}>Most helpful</option></select></div><div id="post-results"></div></section>
    <aside class="community-sidebar"><section class="sidebar-panel shaded"><span class="sidebar-kicker">A SPACE FOR EVERY FAMILY</span><h2>Good things start with a hello.</h2><p>New to the neighbourhood? Looking for a low-cost day out? There’s room for you here.</p><button class="button" data-compose>Introduce yourself <span aria-hidden="true">↗</span></button></section>
    <section class="sidebar-panel"><h2>Make a plan together</h2><p>Ideas for your next family meetup.</p>${[activities[0], activities[1]].map(event => `<button class="meetup" data-event="${event.id}"><span class="date-block">${event.day.slice(0,3).toUpperCase()}<strong>—</strong></span><span><strong class="meetup-title">${escapeHTML(event.title)}</strong><small>${event.suburb} · Sample idea</small></span></button>`).join('')}<a class="text-link" href="#events">Find a live council activity ↗</a></section>
    <section class="sidebar-panel"><h2>A kind community</h2><ol class="guidelines"><li>Be welcoming and respectful.</li><li>Share useful, affordable local finds.</li><li>Keep personal details private.</li><li>Choose public places for meetups.</li></ol><p class="sample-note">Demo community. Names, discussions and meetup ideas are fictional. New posts and replies are visible only in this tab and reset on refresh.</p></section></aside></div>`;
}
function renderPosts() {
  let list = posts.filter(post => (topic === 'All discussions' || post.category === topic) && `${post.title} ${post.body} ${post.suburb}`.toLowerCase().includes(discussionSearch.toLowerCase()));
  if (sortPosts === 'helpful') list = [...list].sort((a,b) => (b.helpful + Number(helpful.has(b.id))) - (a.helpful + Number(helpful.has(a.id))));
  document.querySelector('#post-count').textContent = `${list.length} ${list.length === 1 ? 'conversation' : 'conversations'} · Demo community`;
  document.querySelector('#post-results').innerHTML = list.map(post => `<article class="post-card"><div class="post-top"><div class="avatar" aria-hidden="true">${escapeHTML(post.initials)}</div><div><div class="author">${escapeHTML(post.author)}</div><div class="post-time">${escapeHTML(post.suburb)} · ${escapeHTML(post.time)}</div></div><span class="topic-badge">${escapeHTML(post.category)}</span></div><h3>${escapeHTML(post.title)}</h3><p class="post-body">${escapeHTML(post.body)}</p>${post.eventId ? `<button class="linked-event" data-event="${post.eventId}"><span class="event-symbol" aria-hidden="true">▦</span><span><strong>${escapeHTML(findEvent(post.eventId).title)}</strong><small>Sample meetup idea · ${escapeHTML(findEvent(post.eventId).suburb)}</small></span><span class="arrow" aria-hidden="true">↗</span></button>` : ''}<div class="post-actions"><button data-helpful="${post.id}" aria-pressed="${helpful.has(post.id)}">♡ Helpful · ${post.helpful + Number(helpful.has(post.id))}</button><button data-replies="${post.id}">☏ ${post.replies.length} ${post.replies.length === 1 ? 'reply' : 'replies'}</button></div></article>`).join('') || '<div class="empty-state"><h3>No conversations found.</h3><p>Try another search, or start a discussion of your own.</p><button class="button" data-compose>Start a discussion</button></div>';
}
function showDialog(html) { content.innerHTML = html; if (!modal.open) modal.showModal(); }
function showEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  showDialog(`<div class="eyebrow">${event.live ? 'COUNCIL ACTIVITY' : 'SAMPLE MEETUP IDEA'}</div><h2 id="modal-title">${escapeHTML(event.title)}</h2><p>${escapeHTML(event.description)}</p><dl class="detail-list"><dt>When</dt><dd>${escapeHTML(event.time)}</dd><dt>Where</dt><dd>${escapeHTML(event.venue)}</dd><dt>Cost</dt><dd>${escapeHTML(event.costLabel || (event.cost === 0 ? 'Free entry' : `$${event.cost} per participant`))}</dd><dt>Suitable for</dt><dd>${escapeHTML(event.ages)}</dd>${event.bookings ? `<dt>Bookings</dt><dd>${escapeHTML(event.bookings)}</dd>` : ''}${event.requirements ? `<dt>Bring along</dt><dd>${escapeHTML(event.requirements)}</dd>` : ''}</dl>${!event.live ? '<p class="subtle">Fictional example for the wireframe, not a confirmed event.</p>' : '<p class="subtle">Check the council listing for current availability, cancellations and booking requirements.</p>'}<div class="form-actions">${event.live && /^https:\/\//i.test(event.url || '') ? `<a class="button primary" href="${escapeHTML(event.url)}" target="_blank" rel="noopener noreferrer">Council listing ↗</a>` : '<a class="button" href="#events" data-close>Browse live events</a>'}</div>`);
}
function showComposer() {
  showDialog(`<div class="eyebrow">START A CONVERSATION</div><h2 id="modal-title">What would you like to share?</h2><p class="subtle">Try the Community flow. Your post stays in this tab only.</p><form id="post-form"><label for="post-category">Topic</label><select id="post-category" name="category">${options(['Meetups', 'Local tips', 'Swap & share'], topic)}</select><label for="post-suburb">Suburb</label><input id="post-suburb" name="suburb" placeholder="e.g. New Farm" required maxlength="60"><label for="post-title">Discussion title</label><input id="post-title" name="title" placeholder="Give your neighbours a little context" required maxlength="100"><label for="post-body">Your message</label><textarea id="post-body" name="body" placeholder="Share an idea, ask a question or suggest a meetup…" required maxlength="1500"></textarea><div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary" type="submit">Add demo post</button></div></form>`);
}
function showReplies(id) {
  const post = posts.find(item => item.id === id);
  showDialog(`<div class="eyebrow">COMMUNITY CONVERSATION</div><h2 id="modal-title">${escapeHTML(post.title)}</h2><p>${escapeHTML(post.body)}</p><div>${post.replies.map(reply => `<div class="reply"><strong>${escapeHTML(reply.author)}</strong><p>${escapeHTML(reply.text)}</p></div>`).join('') || '<p class="subtle">Be the first to reply.</p>'}</div><form id="reply-form" data-post="${post.id}"><label for="reply-body">Add a reply</label><textarea id="reply-body" name="body" required maxlength="1000" placeholder="Join the conversation…"></textarea><p class="subtle">Demo only. Replies stay in this tab.</p><div class="form-actions"><button class="button primary" type="submit">Add demo reply</button></div></form>`);
}
document.addEventListener('click', event => {
  const button = event.target.closest('button, [data-close]');
  if (!button) return;
  if (button.matches('[data-close], .close-button')) modal.close();
  if (button.hasAttribute('data-save')) toggleSave(button.dataset.save);
  if (button.hasAttribute('data-event')) showEvent(button.dataset.event);
  if (button.hasAttribute('data-compose')) showComposer();
  if (button.hasAttribute('data-topic')) { topic = button.dataset.topic; render(); }
  if (button.hasAttribute('data-helpful')) { const id = button.dataset.helpful; helpful.has(id) ? helpful.delete(id) : helpful.add(id); renderPosts(); }
  if (button.hasAttribute('data-replies')) showReplies(button.dataset.replies);
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
  if (event.target.id === 'discussion-search') { discussionSearch = event.target.value; renderPosts(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'family-only') { familyOnly = event.target.checked; visibleLimit = 12; renderEventResults(); }
  if (event.target.id === 'event-category') { eventFilters.category = event.target.value; visibleLimit = 12; renderEventResults(); }
  if (event.target.id === 'event-suburb') { eventFilters.suburb = event.target.value; visibleLimit = 12; renderEventResults(); }
  if (event.target.id === 'post-sort') { sortPosts = event.target.value; renderPosts(); }
});
document.addEventListener('submit', event => {
  if (!['post-form', 'reply-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const blank = [...form.querySelectorAll('input[required],textarea[required]')].find(field => !field.value.trim());
  if (blank) { blank.setCustomValidity('Please enter more than spaces.'); blank.reportValidity(); blank.addEventListener('input', () => blank.setCustomValidity(''), { once: true }); return; }
  if (form.id === 'post-form') {
    posts.unshift({ id: `post-${Date.now()}`, author: 'You', initials: 'YO', suburb: data.get('suburb').trim(), time: 'Just now', category: data.get('category'), title: data.get('title').trim(), body: data.get('body').trim(), helpful: 0, replies: [] });
    topic = 'All discussions'; discussionSearch = ''; sortPosts = 'newest'; modal.close(); render(); notify('Demo post added. Only visible in this tab.');
  } else {
    const post = posts.find(item => item.id === form.dataset.post);
    post.replies.push({ author: 'You', text: data.get('body').trim() });
    renderPosts(); showReplies(post.id); notify('Demo reply added. Only visible in this tab.');
  }
});
modal.addEventListener('click', event => { if (event.target === modal) { const bounds = modal.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close(); } });
window.addEventListener('hashchange', () => { if (modal.open) modal.close(); visibleLimit = 12; render(); main.focus(); window.scrollTo(0,0); });
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
  } catch { /* Unsupported experimental API must not affect the wireframe. */ }
}
