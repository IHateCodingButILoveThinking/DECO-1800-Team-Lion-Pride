# Family Finds

Family Finds is a real community website for Brisbane families. It combines live Brisbane City Council activities with suburb and interest based clubs, internal discussions, optional Facebook links, saved events, member profiles and privacy settings.

The project uses only free services:

- The UQ Team Zone hosts the static HTML, CSS, JavaScript and image files.
- A Cloudflare Worker provides the API on the Workers Free plan.
- Cloudflare D1 stores accounts and community data on the D1 Free plan.
- Built-in email and password accounts provide login and registration.
- Brisbane City Council Open Data supplies current event listings.

If a Cloudflare daily free limit is reached, requests fail until the limit resets; the project is not configured to upgrade or create usage charges automatically.

## Project structure

```text
.
├── frontend/
│   ├── index.html          # Website homepage and page shell
│   ├── assets/logo.png     # Family Finds logo
│   ├── css/styles.css      # Responsive Apple-style visual system
│   └── js/
│       ├── config.js       # Cloudflare API address
│       ├── events-api.js   # Brisbane City Council data client
│       ├── icons.js        # Interface icons
│       ├── community.js    # Login, clubs, posts, profiles and settings
│       └── script.js       # Navigation, events, saving and event interest
├── backend/
│   ├── src/worker.js       # Cloudflare API and account authentication
│   ├── migrations/         # Versioned D1 database schema
│   └── wrangler.config.jsonc
└── package.json
```

`frontend/index.html` is copied to `/var/www/htdocs/index.html`, so the public homepage remains:

```text
https://deco1800teams-lion-pride.uqcloud.net/index.html
```

Home links use `index.html` with no `#home` suffix. Inner views use hashes so Events, Saved and Community continue to work on the static UQ server without rewrite rules.

## Current Cloudflare resources

- Worker: `family-finds-api`
- API: `https://family-finds-api.zeyi-yang.workers.dev`
- D1 database: `family-finds-db`

The API accepts browser requests from the UQ Team Zone origin. Session tokens are stored only in the user's browser and D1 stores only a SHA-256 hash of each token. Passwords are salted and derived with PBKDF2-SHA-256 before storage; plain passwords are never saved.

## Run locally

Install the one development dependency and create the local database:

```bash
npm install
npm run db:local
```

Start the backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open `http://127.0.0.1:3000/index.html`. Create a local test account through the normal registration page.

Run the source checks with:

```bash
npm run check
```

## Deploy the frontend to UQ

The instructions supplied with this project say the Team Zone must be accessed from the UQ network, Eduroam or UQ VPN. On the Team Zone:

```bash
ssh YOUR_UQ_USERNAME@deco1800teams-lion-pride.zones.eait.uq.edu.au
cd ~/DECO-1800-Team-Lion-Pride
git pull
cp -R frontend/. /var/www/htdocs/
```

Copy the contents of `frontend/`, rather than the whole repository. The deployed directory should contain `index.html`, `assets/`, `css/` and `js/`. Backend source, migrations and secret examples must stay outside `/var/www/htdocs/`.

## Deploy backend changes

Apply new migrations before deploying code that depends on them:

```bash
npm run db:remote
npm run deploy:backend
```

## Data and privacy behaviour

The website saves accounts, profiles, clubs, memberships, posts, replies, reactions, saved activities and event interest in D1. Password derivation happens inside the Worker and login responses use revocable session tokens.

Event cards show interested adults only when they share at least one club with the signed-in member. The API does not expose emails, children's names, private age settings or people outside the member's clubs. Club discussions and member lists require membership. User-entered text is escaped in the interface, links require HTTPS, and optional Facebook links are restricted to Facebook or Messenger hosts.

The council feed is a rolling extract of published events. Each activity links back to its official listing so families can check availability, suitability and booking requirements.
