/* Public BCC Open Data API. No key or framework required.
   Dates are interpreted in Brisbane; HTML from the feed is reduced to text. */
const CouncilEvents = (() => {
  const endpoint = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/brisbane-city-council-events/records';
  const zone = 'Australia/Brisbane';
  const pageSize = 24;
  const snapshotTime = new Date().toISOString();
  const cache = new Map();
  const cacheLifetime = 5 * 60 * 1000;
  const fields = 'subject,web_link,location,start_datetime,formatteddatetime,description,event_type,eventimage,venue,venueaddress,cost,age,agerange,activitytype,bookings,bookingsrequired,requirements,geolocation';
  let suburbsRequest;
  function plain(value) {
    const document = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
    return document.body.textContent.replace(/\s+/g, ' ').trim();
  }
  function bookingLink(value) {
    const document = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
    const href = document.querySelector('a[href]')?.getAttribute('href') || '';
    const text = document.body.textContent.replace(/\s+/g, ' ').trim();
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    const raw = href || text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,;)]*$/, '') || (email ? `mailto:${email}` : '');
    try {
      const url = new URL(raw);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return '';
      return url.href;
    } catch {
      return '';
    }
  }
  function bookingPhone(value) {
    const text = plain(value);
    if (!/\b(?:phone|call|telephone|tel|to book|book by)\b/i.test(text)) return null;
    const match = text.match(/(?:^|[^\d])((?:\+61[\s-]?[23478][\s-]?\d{4}[\s-]?\d{4}|0[2378][\s-]?\d{4}[\s-]?\d{4}|04\d{2}[\s-]?\d{3}[\s-]?\d{3}|1[38]00[\s-]?\d{3}[\s-]?\d{3}|\d{4}[\s-]\d{4}))(?!\d)/);
    if (!match) return null;
    const display = match[1];
    const digits = display.replace(/\D/g, '');
    const dial = digits.startsWith('61') ? `+${digits}` : digits.length === 8 ? `+617${digits}`
      : digits.startsWith('0') ? `+61${digits.slice(1)}` : digits;
    return { display, dial: `tel:${dial}` };
  }
  // These labels describe activities, not the Council's broader event types.
  // Include the description so a search for "music" can find a music activity
  // even when its title does not contain that word.
  const tagRules = [
    ['Outdoor', /\b(?:outdoor|outdoors|park|playground|open.air|bushwalk|walking trail)\b/i],
    ['Creative', /\b(?:art|arts|craft|crafts|painting|drawing|sculpture|creative)\b/i],
    ['Sport', /\b(?:sport|sports|soccer|football|basketball|tennis|swimming|martial arts|karate|fitness|yoga|skating)\b/i],
    ['Nature', /\b(?:nature|wildlife|garden|gardening|birds?|bushwalk|conservation)\b/i],
    ['Music', /\b(?:music|musical|concert|singing|choir|instrument|rhythm)\b/i],
    ['Library', /\b(?:library|libraries|storytime|reading|books?)\b/i],
    ['Indoor', /\b(?:indoor|indoors|museum|gallery|community hall|library|libraries)\b/i],
    ['Markets', /\b(?:market|markets|garage sale|swap meet|second.hand)\b/i]
  ];
  function activityTags(row) {
    const text = [row.subject, row.venue, ...(row.event_type || []), ...(row.activitytype || []), plain(row.description)].join(' ');
    return tagRules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  }
  function familyRelevant(row) {
    const suitability = [plain(row.age), ...(row.agerange || [])].join(' ');
    const title = plain(row.subject);
    if (/not (?:recommended|suitable|appropriate) for (?:children|kids|families)|adults? only|18\s*(?:\+|years? and over)/i.test(suitability)) return false;
    if (/\b(?:adult|ladies|women.only|men.only)\b/i.test(title) && !/\b(?:child|children|kid|kids|family|families|teen)\b/i.test(title)) return false;
    return /all ages|famil|child|kid|preschool|bab|toddler|teen|youth|young people/i.test(suitability) ||
      /(?:ages?|aged)\s*(?:0?[0-9]|1[0-7])\s*(?:-|–|—|to|\+)/i.test(suitability) ||
      /\b(?:family|families|children|kids|preschool|toddler|baby|babies|teen)\b/i.test(title);
  }
  function normalize(row) {
    const start = new Date(row.start_datetime);
    const types = [...(row.event_type || []), ...(row.activitytype || [])].join(' ');
    const text = `${row.subject} ${types}`;
    const category = /market|garage sale|swap|second.?hand/i.test(text) ? 'Markets & secondhand' : /librar|storytime|reading/i.test(`${text} ${row.venue}`) ? 'Libraries' : /craft|art|creative/i.test(text) ? 'Creative' : /park|outdoor|garden|nature/i.test(`${text} ${row.venue}`) ? 'Outdoors' : 'Other activities';
    const costLabel = plain(row.cost) || 'Check cost';
    const address = plain(row.venueaddress || row.location);
    const suburb = plain(row.suburb) || (address.includes(',') ? address.split(',').slice(-1)[0].trim() : 'Brisbane');
    const day = start.toLocaleDateString('en-AU', { weekday: 'long', timeZone: zone });
    const formattedTime = plain(row.formatteddatetime);
    const timePart = formattedTime.split(',').slice(2).join(',').trim();
    const timeLabel = /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|all day)\b/i.test(timePart)
      ? timePart
      : /\d{4}\s*[-–—]\s*[A-Za-z]+,?\s*\d{1,2}/.test(formattedTime)
        ? 'Multiple days'
        : formattedTime ? 'Check time' : start.getUTCHours() === 0 && start.getUTCMinutes() === 0
          ? 'Check time'
          : start.toLocaleTimeString('en-AU', {hour: 'numeric', minute: '2-digit', timeZone: zone});
    const rawLink = String(row.web_link || '');
    const url = /^https:\/\//i.test(rawLink) ? rawLink : '';
    const venue = plain(row.venue || row.location) || 'Venue to be confirmed';
    const coordinates = row.geolocation;
    const bookings = plain(row.bookings);
    const bookingUrl = bookingLink(row.bookings);
    const phone = bookingPhone(row.bookings);
    const bookingRequired = /\b(?:no bookings? (?:are )?required|bookings? (?:are )?not required|no reservation (?:is )?required)\b/i.test(bookings)
      ? false
      : bookingUrl || /\b(?:bookings? (?:are )?(?:required|essential)|registration (?:is )?required)\b/i.test(bookings) ||
        /^yes$/i.test(plain(row.bookingsrequired))
        ? true
        : /^(?:no|not required|none)$/i.test(plain(row.bookingsrequired)) ? false : null;
    return {
      id: `bcc-${rawLink || row.subject}-${row.start_datetime}`,
      image: /^https:\/\//i.test(String(row.eventimage || '')) ? String(row.eventimage) : '',
      title: plain(row.subject) || 'Council activity', category, suburb,
      venue, address,
      latitude: Number.isFinite(coordinates?.lat) ? coordinates.lat : null,
      longitude: Number.isFinite(coordinates?.lon) ? coordinates.lon : null,
      day, date: start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: zone }),
      dateKey: start.toLocaleDateString('en-CA', { timeZone: zone }), start: start.toISOString(),
      time: formattedTime || start.toLocaleString('en-AU', { timeZone: zone }), timeLabel,
      cost: /^(?:free\b|\$?0(?:\.00)?(?:\s|$))/i.test(costLabel) ? 0 : null, costLabel,
      ages: plain(row.age) || (row.agerange || []).join(', ') || 'Check age suitability',
      ageRanges: row.agerange || [], description: plain(row.description),
      tags: activityTags(row), family: familyRelevant(row),
      bookings, bookingUrl, bookingRequired,
      bookingPhone: phone?.display || '', bookingPhoneUrl: phone?.dial || '',
      bookingPhoneCanBook: /\b(?:to book|book(?:ing|ings)? (?:by|via|through|on) phone|phone (?:to|for) book(?:ing)?|call (?:to|for) book(?:ing)?)\b/i.test(bookings),
      requirements: plain(row.requirements),
      weekend: day === 'Saturday' || day === 'Sunday', url, live: true
    };
  }
  // ODSQL quoted literals: user text stays inside one string, never an operator.
  const literal = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' ')}"`;
  const search = (columns, value) => `search(${columns},${literal(value)})`;
  const anyTerm = (columns, terms) => `(${terms.map(term => search(columns, term)).join(' OR ')})`;
  function categoryQuery(category) {
    const terms = {
      'Markets & secondhand': ['market', 'garage sale', 'swap', 'secondhand', 'second hand'],
      Libraries: ['librar', 'storytime', 'reading'],
      Creative: ['craft', 'art', 'creative'],
      Outdoors: ['park', 'outdoor', 'garden', 'nature']
    }[category];
    return terms ? anyTerm('subject,event_type,activitytype,venue', terms) : '';
  }
  const tagSearchTerms = {
    Outdoor: ['outdoor', 'park', 'playground', 'bushwalk'],
    Creative: ['art', 'craft', 'painting', 'drawing'],
    Sport: ['sport', 'soccer', 'football', 'swimming', 'karate', 'fitness', 'yoga'],
    Nature: ['nature', 'wildlife', 'garden', 'bird', 'bushwalk'],
    Music: ['music', 'concert', 'singing', 'choir'],
    Library: ['library', 'storytime', 'reading', 'book'],
    Indoor: ['indoor', 'museum', 'gallery', 'hall', 'library'],
    Markets: ['market', 'garage sale', 'swap', 'secondhand']
  };
  function searchQuery(value) {
    const term = value.trim();
    const matchingTag = Object.keys(tagSearchTerms).find(tag => tag.toLowerCase() === term.toLowerCase());
    const columns = 'subject,event_type,activitytype,venue,description';
    return matchingTag
      ? anyTerm(columns, tagSearchTerms[matchingTag])
      : search('subject,venue,venueaddress,location,description', term);
  }
  function where(filters) {
    const clauses = [`start_datetime >= date'${snapshotTime}'`];
    for (const range of filters.dateRanges || []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(range.start) && /^\d{4}-\d{2}-\d{2}$/.test(range.end)) {
        clauses.push(`start_datetime >= date'${range.start}T00:00:00+10:00' AND start_datetime <= date'${range.end}T23:59:59.999+10:00'`);
      }
    }
    if (filters.search) clauses.push(searchQuery(filters.search));
    if (filters.category) {
      const category = categoryQuery(filters.category);
      if (category) clauses.push(category);
    }
    if (tagSearchTerms[filters.tag]) clauses.push(anyTerm('subject,event_type,activitytype,venue,description', tagSearchTerms[filters.tag]));
    for (const suburb of filters.suburbs || []) clauses.push(search('venueaddress,location', suburb));
    if (filters.freeOnly) clauses.push(`(${search('cost', 'free')} OR startswith(cost,"$0") OR startswith(cost,"0"))`);
    if (filters.familyOnly) clauses.push(anyTerm('age,agerange,subject', ['all ages', 'famil', 'child', 'kid', 'preschool', 'bab', 'toddler', 'teen', 'youth', 'ages 5', 'ages 6', 'ages 7', 'ages 8', 'ages 9']));
    if (filters.petFriendly) clauses.push(anyTerm('subject,description,requirements', ['dog', 'pet', 'puppy', 'leash']));
    for (const need of filters.accessibility || []) {
      const terms = {wheelchair: ['wheelchair', 'accessible'], stroller: ['stroller', 'pram', 'accessible'], pram: ['stroller', 'pram', 'accessible'], 'sensory friendly': ['sensory', 'quiet']}[need];
      if (terms) clauses.push(anyTerm('subject,description,requirements', terms));
    }
    return clauses.map(clause => `(${clause})`).join(' AND ');
  }
  async function request(params, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, 20000);
    try {
      const response = await fetch(`${endpoint}?${params}`, {signal: controller.signal});
      if (!response.ok) throw new Error(`Council feed returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.results) || !Number.isFinite(data.total_count)) throw new Error('Unexpected council response');
      return data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  // One small page per request; revisiting a recent query reuses normalized data.
  async function loadPage(filters = {}, offset = 0, signal) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= 10000) throw new Error('Invalid event page');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const limit = Math.min(pageSize, 10000 - offset);
    const params = new URLSearchParams({limit: String(limit), offset: String(offset), select: fields,
      order_by: 'start_datetime ASC,subject ASC,web_link ASC', where: where(filters)});
    const key = params.toString();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.data;
    }
    const response = await request(params, signal);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const nextOffset = offset + response.results.length;
    const data = {
      events: response.results.map(normalize), total: response.total_count, nextOffset,
      hasMore: response.results.length > 0 && nextOffset < Math.min(response.total_count, 10000)
    };
    cache.delete(key);
    cache.set(key, {data, expires: Date.now() + cacheLifetime});
    while (cache.size > 12) cache.delete(cache.keys().next().value);
    return data;
  }
  // Fetch only distinct place names, so the suburb picker is not limited to page one.
  function loadSuburbs() {
    if (!suburbsRequest) {
      const params = new URLSearchParams({limit: '1000', select: 'venueaddress,location,count(*) as event_count',
        group_by: 'venueaddress,location', where: `start_datetime >= date'${snapshotTime}'`});
      suburbsRequest = request(params).then(data => [...new Set(data.results.map(row => {
        const address = plain(row.venueaddress || row.location);
        return address.includes(',') ? address.split(',').pop().trim() : 'Brisbane';
      }).filter(Boolean))].sort((a, b) => a.localeCompare(b))).catch(error => {
        suburbsRequest = null;
        throw error;
      });
    }
    return suburbsRequest;
  }
  return { loadPage, loadSuburbs, normalize, pageSize, tagSearchTerms };
})();
