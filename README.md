# Family Finds — Team Lion Pride

Week 7 clickable wireframe using **HTML, CSS and vanilla JavaScript**. No framework, runtime packages, API keys or backend are required.

## Preview

Open `index.html` in a browser, or run `python3 -m http.server 4173` and visit `http://localhost:4173`. The Community page is `http://localhost:4173/#community`. A local server is recommended for consistent browser storage and API behaviour.

## Files

- `index.html`: shared navigation, page container and accessible dialog.
- `styles.css`: responsive grayscale wireframe, including mobile layouts.
- `script.js`: Home, Events, Saved and Community views; search, filters, event details and demo discussions.
- `events-api.js`: live council pagination, text normalization and activity classification.
- `data.js`: explicitly fictional community posts and meetup examples.
- `build.js`: copies the five website files into `dist/` for static hosting.

The HTML in each view is kept in named functions in `script.js`; `communityPage()` and `renderPosts()` are the main Community editing points. The navigation uses URL hashes so all pages work on a static host without server routing.

## What works

- Live Home/Events listings, search, category and suburb filters, free activities and this-weekend shortcuts.
- A family suitability filter based on council age labels, enabled by default. Uncheck it to browse all loaded council activities.
- Event details with cost, age suitability, booking information and a link to the original council listing.
- Saved events stored on this device through localStorage; nothing is sent to a server.
- Community topic filtering, search, sorting, helpful reactions, reply dialogs and a demo post form. Posts and replies remain in memory and reset on refresh.

## Council data and limits

Source: [Brisbane City Council Events](https://data.brisbane.qld.gov.au/explore/dataset/brisbane-city-council-events/).

Public endpoint: `https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/brisbane-city-council-events/records`.

The application fetches future-starting listings in chronological pages of 100, progressively rendering results. The council describes this dataset as an extract of its next 2,000 published events; it does not cover every Brisbane event or every future date. Past-starting multi-day events are currently excluded. Source attribution appears in the footer. API failures show a retry state, and partially loaded results are labelled; sample events never replace failed live results.

Dates use Australia/Brisbane. Suburbs fall back to the final component of the council venue address when the suburb field is empty. Categories and family suitability are derived from council text, so users must confirm suitability and bookings on the original listing. Markets are council event listings, not a secondhand marketplace API. There are no grocery or discount integrations.

## Prototype scope

The supplied home-page screenshot guides the grayscale navigation, quick-browse boxes and crossed image placeholders. The Canva short link was inaccessible during implementation. Community is an exploratory wireframe with invented example posts, not a researched or populated social network. No accounts, public posting, private messaging, moderation backend or marketplace transactions are implemented.

The optional `search_family_activities` WebMCP tool reuses the visible event search when a browser supports it. No supported WebMCP browser context was available for end-to-end verification; ordinary browser use does not depend on it.

## Checks and publishing

`npm run check` checks JavaScript syntax. `npm run build` copies static assets without installing dependencies. `.openai/hosting.json` identifies the private Sites preview and its `dist/` output. The original team GitHub remote is retained.
