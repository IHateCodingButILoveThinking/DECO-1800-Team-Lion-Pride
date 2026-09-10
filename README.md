# Family Finds

Family Finds helps Brisbane families discover affordable activities and connect through local clubs. The project uses plain HTML, CSS and JavaScript, with a Cloudflare Worker and D1 database for shared community data.

## What the website includes

- Live family-suitable activities from the [Brisbane City Council Events dataset](https://data.brisbane.qld.gov.au/explore/dataset/brisbane-city-council-events/).
- Search by activity, category and suburb, with free, weekend and family-suitability filters.
- Account-based saved activities that stay available across devices.
- Local clubs organised by suburb, interests and family age groups.
- Club membership, member profiles, privacy settings, discussions, replies and helpful reactions.
- Optional Facebook or Messenger links set by each club owner. Clubs work fully inside Family Finds without Facebook.
- “I’m interested” event registration. Signed-in members can see when people from one of their clubs are interested in the same council activity.

## Technology

The front end is written in HTML, CSS and vanilla JavaScript. `server/worker.js` is a plain JavaScript Cloudflare Worker API. Cloudflare D1 stores profiles, clubs, memberships, posts, replies, reactions, saved activities and event interest. Drizzle generates versioned database migrations from `db/schema.js`.

Production uses the authenticated user headers supplied by the hosting platform. Local development supplies a test identity only on `localhost` or `127.0.0.1`; the production Worker never trusts a browser-provided identity header.

## Run locally

```bash
npm install
npm run db:local
npm run dev
```

Open `http://127.0.0.1:4173`. Local data is stored by Wrangler under `.wrangler/` and is excluded from Git.

Useful commands:

```bash
npm run check
npm run build
npm run db:generate
```

## Project structure

- `index.html` — shared navigation and page shell.
- `styles.css` — responsive visual system and layouts.
- `script.js` — live council activities, filters, saved activities and event interactions.
- `community.js` — clubs, profiles, registration, settings, posts and replies.
- `events-api.js` — council feed pagination and normalization.
- `icons.js` — inline interface icons.
- `logo.png` — original Family Finds family-and-location logo.
- `server/worker.js` — authenticated API and static asset delivery.
- `db/schema.js` and `drizzle/` — D1 schema and migrations.
- `build.js` — packages browser assets into the Worker build.

## Data and privacy behaviour

The council feed is a rolling extract of published events and does not represent every event in Brisbane. The website keeps source attribution in its footer and links every activity back to the original council listing for final booking and suitability checks.

Event-interest suggestions only include people who share at least one club with the signed-in member. The response includes adult member display names and the shared club name. It does not expose emails, children’s names, private age-group settings or people outside the member’s clubs. Club discussions and member lists require club membership.

Mutating API requests require same-origin submission and authenticated identity. User text is inserted into the interface as escaped text, links require HTTPS, and optional Facebook links are restricted to Facebook or Messenger hosts.

## Hosting

`.openai/hosting.json` declares the D1 binding used by the private Cloudflare-backed Sites deployment. Database migrations are applied during version publishing. The implementation is designed around Cloudflare’s free-tier Worker and D1 services and has no paid API dependency.
