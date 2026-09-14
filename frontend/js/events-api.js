/* Public BCC Open Data API. No key or framework required.
   Dates are interpreted in Brisbane; HTML from the feed is reduced to text. */
const CouncilEvents = (() => {
  const endpoint = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/brisbane-city-council-events/records';
  const locationsEndpoint = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/brisbane-city-council-events-locations/records';
  const zone = 'Australia/Brisbane';
  let locationsByVenue = new Map();
  function plain(value) {
    const document = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
    return document.body.textContent.replace(/\s+/g, ' ').trim();
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
    const rawLink = String(row.web_link || '');
    const url = /^https:\/\//i.test(rawLink) ? rawLink : '';
    const venue = plain(row.venue || row.location) || 'Venue to be confirmed';
    const coordinates = locationsByVenue.get(venue.toLowerCase());
    return {
      id: `bcc-${rawLink || row.subject}-${row.start_datetime}`,
      image: /^https:\/\//i.test(String(row.eventimage || '')) ? String(row.eventimage) : '',
      title: plain(row.subject) || 'Council activity', category, suburb,
      venue,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      day, date: start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: zone }),
      dateKey: start.toLocaleDateString('en-CA', { timeZone: zone }), start: start.toISOString(),
      time: plain(row.formatteddatetime) || start.toLocaleString('en-AU', { timeZone: zone }),
      cost: /^(?:free\b|\$?0(?:\.00)?(?:\s|$))/i.test(costLabel) ? 0 : null, costLabel,
      ages: plain(row.age) || (row.agerange || []).join(', ') || 'Check age suitability',
      ageRanges: row.agerange || [], description: plain(row.description),
      family: /all ages|famil|child|kid|preschool|bab|toddler|teen/i.test(`${plain(row.age)} ${(row.agerange || []).join(' ')}`),
      bookings: plain(row.bookings), requirements: plain(row.requirements),
      weekend: day === 'Saturday' || day === 'Sunday', url, live: true
    };
  }
  async function page(offset, now) {
    const params = new URLSearchParams({ limit: '100', offset: String(offset), order_by: 'start_datetime ASC', where: `start_datetime >= date'${now}'` });
    const response = await fetch(`${endpoint}?${params}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Council feed returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.results) || !Number.isFinite(data.total_count)) throw new Error('Unexpected council response');
    return data;
  }
  async function loadLocations() {
    const requestPage = async offset => {
      const params = new URLSearchParams({ limit: '100', offset: String(offset) });
      const response = await fetch(`${locationsEndpoint}?${params}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Locations feed returned ${response.status}`);
      return response.json();
    };
    const first = await requestPage(0);
    const offsets = [];
    for (let offset = 100; offset < Math.min(first.total_count, 10000); offset += 100) offsets.push(offset);
    const remaining = await Promise.all(offsets.map(requestPage));
    const rows = first.results.concat(remaining.flatMap(result => result.results));
    return new Map(rows
      .filter(row => row.venue_name && Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
      .map(row => [plain(row.venue_name).toLowerCase(), { latitude: row.latitude, longitude: row.longitude }]));
  }
  async function load(onProgress) {
    const now = new Date().toISOString();
    const [first, locations] = await Promise.all([
      page(0, now),
      loadLocations().catch(() => new Map())
    ]);
    locationsByVenue = locations;
    let rows = first.results;
    const total = first.total_count;
    onProgress(rows.map(normalize), total);
    // The BCC dataset currently holds the next 2,000 published events.
    // Fetch every available page, in small batches to avoid a request burst.
    for (let offset = 100; offset < Math.min(total, 10000); offset += 300) {
      const offsets = [offset, offset + 100, offset + 200].filter(value => value < Math.min(total, 10000));
      const pages = await Promise.all(offsets.map(value => page(value, now)));
      rows = rows.concat(pages.flatMap(result => result.results));
      onProgress([...new Map(rows.map(row => { const event = normalize(row); return [event.id, event]; })).values()], total);
    }
    return total;
  }
  return { load, normalize };
})();
