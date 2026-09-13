/* Family Finds API: Cloudflare Worker + D1. */
const SESSION_TTL = 60 * 60 * 24 * 30;
// Cloudflare Workers supports PBKDF2 iteration counts up to 100,000.
const PASSWORD_ITERATIONS = 100000;

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, name, max, required = true) => {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(400, `${name} must be text.`); }
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) fail(400, `${name} must be ${required ? '1' : '0'}–${max} characters.`);
  return clean;
};
const list = (value, name) => {
  if (!Array.isArray(value) || value.length > 12 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 45)) fail(400, `Choose valid ${name}.`);
  return JSON.stringify([...new Set(value.map(item => item.trim()))]);
};

function safeLink(value, facebook = false) {
  const link = text(value, 'Link', 1500, false);
  if (!link) return '';
  let url;
  try { url = new URL(link); } catch { fail(400, 'Enter a complete https:// link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(400, 'Links must use https://.');
  if (facebook && !['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com', 'messenger.com', 'www.messenger.com', 'm.me'].includes(url.hostname)) fail(400, 'Use a Facebook group or Messenger link.');
  return url.href;
}

function parseJsonArray(value) { try { return JSON.parse(value || '[]'); } catch { return []; } }
function parseProfile(row, own = false) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, suburb: own || row.show_suburb ? row.suburb : '', bio: row.bio,
    interests: own || row.show_interests ? parseJsonArray(row.interests) : [], ages: own ? parseJsonArray(row.ages) : [],
    ...(own ? {email: row.email, showSuburb: !!row.show_suburb, showInterests: !!row.show_interests, onboardingComplete: row.onboarding_complete !== 0} : {}),
    createdAt: row.created_at
  };
}

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
async function bodyOf(request) { const raw = await request.text(); if (raw.length > 24000) fail(413, 'This entry is too large.'); try { return JSON.parse(raw); } catch { fail(400, 'Invalid request.'); } }

function base64Url(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function randomToken(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return base64Url(bytes); }
async function hashToken(value) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return base64Url(new Uint8Array(digest)); }
function emailAddress(value) {
  const email = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
}
function passwordText(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail(400, 'Password must be 10–128 characters.');
  return value;
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS}, key, 256);
  return base64Url(new Uint8Array(bits));
}
function sameHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index++) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function configuredOrigins(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean); }
function isAllowedOrigin(value, env) {
  if (!value) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (configuredOrigins(env).includes(url.origin)) return true;
  if (env.ALLOW_VERCEL_PREVIEWS === 'true' && url.protocol === 'https:' && url.hostname.endsWith('.vercel.app')) return true;
  return env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1'].includes(url.hostname);
}
function cors(response, request, env) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, env)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Credentials', 'true'); headers.append('Vary', 'Origin');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
function trustedMutation(request, env) { const origin = request.headers.get('Origin'); return origin === new URL(request.url).origin || isAllowedOrigin(origin, env); }

async function authenticate(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return {auth: null, user: null};
  const user = await first(env.DB, 'SELECT p.* FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?', await hashToken(token), Date.now());
  return user ? {auth: {id: user.auth_id, email: user.email}, user} : {auth: null, user: null};
}

async function createSession(db, userId) {
  const token = randomToken(48);
  const now = Date.now();
  await run(db, 'DELETE FROM sessions WHERE expires_at<?', now);
  await run(db, 'INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)', await hashToken(token), userId, now + SESSION_TTL * 1000, now);
  return token;
}

async function registerAccount(request, env) {
  const body = await bodyOf(request);
  const email = emailAddress(body.email);
  const password = passwordText(body.password);
  if (await first(env.DB, 'SELECT id FROM profiles WHERE lower(email)=?', email)) fail(409, 'An account already uses this email. Try logging in.');
  const salt = randomToken(24);
  const id = crypto.randomUUID();
  try {
    await run(env.DB, 'INSERT INTO profiles (id,auth_id,email,password_hash,password_salt,name,suburb,bio,interests,ages,onboarding_complete,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, `email:${email}`, email, await passwordHash(password, salt), salt, text(body.name, 'Name', 60), text(body.suburb, 'Suburb', 60), text(body.bio, 'Bio', 500, false), list(body.interests || [], 'interests'), list(body.ages || [], 'age groups'), 1, Date.now());
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) fail(409, 'An account already uses this email. Try logging in.');
    throw error;
  }
  const user = await first(env.DB, 'SELECT * FROM profiles WHERE id=?', id);
  return json({token: await createSession(env.DB, id), expiresIn: SESSION_TTL, profile: parseProfile(user, true)}, 201);
}

async function loginAccount(request, env) {
  const body = await bodyOf(request);
  const email = emailAddress(body.email);
  const password = passwordText(body.password);
  const user = await first(env.DB, 'SELECT * FROM profiles WHERE lower(email)=?', email);
  const salt = user?.password_salt || randomToken(24);
  const matches = sameHash(await passwordHash(password, salt), user?.password_hash || 'invalid-password-hash');
  if (!user || !user.password_hash || !matches) fail(401, 'Email or password is incorrect.');
  return json({token: await createSession(env.DB, user.id), expiresIn: SESSION_TTL, profile: parseProfile(user, true)});
}

async function logout(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token) await run(env.DB, 'DELETE FROM sessions WHERE id_hash=?', await hashToken(token));
  return json({signedOut: true});
}

async function member(db, clubId, userId) { return userId ? first(db, 'SELECT user_id FROM memberships WHERE club_id=? AND user_id=?', clubId, userId) : null; }
async function clubById(db, id, userId) {
  const club = await first(db, 'SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count FROM clubs c JOIN profiles p ON p.id=c.owner_id WHERE c.id=?', id);
  if (!club) fail(404, 'This club could not be found.');
  return {...club, interests: parseJsonArray(club.interests), ages: parseJsonArray(club.ages), joined: !!await member(db, id, userId), isOwner: club.owner_id === userId};
}
async function requirePost(db, id, user) {
  const post = await first(db, 'SELECT * FROM posts WHERE id=?', id);
  if (!post) fail(404, 'This discussion could not be found.');
  if (post.club_id && !await member(db, post.club_id, user?.id)) fail(403, 'Join this club to read and reply to its discussions.');
  return post;
}
async function postRows(db, clubId, userId) {
  return all(db, `SELECT p.*,u.name AS author,u.show_suburb,u.suburb,c.name AS club_name,(SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count,(SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) AS helpful_count,EXISTS(SELECT 1 FROM reactions r WHERE r.post_id=p.id AND r.user_id=?) AS liked FROM posts p JOIN profiles u ON u.id=p.author_id LEFT JOIN clubs c ON c.id=p.club_id WHERE ${clubId ? 'p.club_id=?' : 'p.club_id IS NULL'} ORDER BY p.created_at DESC LIMIT 100`, ...(clubId ? [userId || '', clubId] : [userId || '']));
}
function publicPosts(rows) { return rows.map(row => ({...row, suburb: row.show_suburb ? row.suburb : '', show_suburb: undefined})); }

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json({error: 'Family Finds API'}, 404);
  const db = env.DB;
  if (!db) fail(503, 'Community is temporarily unavailable. Please try again shortly.');
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/health' && method === 'GET') return json({ok: true, service: 'family-finds-api'});
  if (path === '/api/auth/register' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return registerAccount(request, env); }
  if (path === '/api/auth/login' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return loginAccount(request, env); }
  if (path === '/api/auth/logout' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return logout(request, env); }

  const {auth, user} = await authenticate(request, env);
  if (!['GET', 'HEAD'].includes(method) && !trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.');
  const requireUser = () => {
    if (!auth) fail(401, 'Sign in to continue.');
    if (!user || user.onboarding_complete === 0) fail(409, 'Create your Family Finds profile first.');
    return user;
  };

  if (path === '/api/me' && method === 'GET') return json({signedIn: !!auth, email: auth?.email || '', profile: parseProfile(user, true)});
  if (path === '/api/profile' && method === 'PATCH') {
    requireUser(); const body = await bodyOf(request);
    await run(db, 'UPDATE profiles SET name=?,suburb=?,bio=?,interests=?,ages=?,show_suburb=?,show_interests=? WHERE id=?', text(body.name ?? user.name, 'Name', 60), text(body.suburb ?? user.suburb, 'Suburb', 60), text(body.bio ?? user.bio, 'Bio', 500, false), list(body.interests ?? parseJsonArray(user.interests), 'interests'), list(body.ages ?? parseJsonArray(user.ages), 'age groups'), body.showSuburb === undefined ? user.show_suburb : Number(body.showSuburb === true), body.showInterests === undefined ? user.show_interests : Number(body.showInterests === true), user.id);
    return json({profile: parseProfile(await first(db, 'SELECT * FROM profiles WHERE id=?', user.id), true)});
  }
  if (path.startsWith('/api/profiles/') && method === 'GET') {
    requireUser(); const id = decodeURIComponent(path.slice('/api/profiles/'.length)); const profile = await first(db, 'SELECT * FROM profiles WHERE id=? AND onboarding_complete=1', id); if (!profile) fail(404, 'Member not found.');
    return json({profile: parseProfile(profile, id === user.id), clubs: await all(db, 'SELECT c.id,c.name,c.suburb,c.color FROM clubs c JOIN memberships m ON m.club_id=c.id WHERE m.user_id=? ORDER BY c.name', id)});
  }
  if (path === '/api/clubs' && method === 'GET') {
    const clubs = await all(db, 'SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count,EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=c.id AND m.user_id=?) AS joined FROM clubs c JOIN profiles p ON p.id=c.owner_id ORDER BY c.created_at DESC LIMIT 200', user?.id || '');
    return json({clubs: clubs.map(club => ({...club, interests: parseJsonArray(club.interests), ages: parseJsonArray(club.ages), joined: !!club.joined, isOwner: club.owner_id === user?.id}))});
  }
  if (path === '/api/clubs' && method === 'POST') {
    requireUser(); const body = await bodyOf(request); const id = crypto.randomUUID(); const color = ['blue', 'green', 'purple', 'orange'].includes(body.color) ? body.color : 'blue';
    await db.batch([
      db.prepare('INSERT INTO clubs (id,owner_id,name,suburb,description,interests,ages,facebook_url,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, user.id, text(body.name, 'Club name', 80), text(body.suburb, 'Suburb', 60), text(body.description, 'Description', 1000), list(body.interests || [], 'interests'), list(body.ages || [], 'age groups'), safeLink(body.facebookUrl, true), color, Date.now()),
      db.prepare('INSERT INTO memberships (club_id,user_id,created_at) VALUES (?,?,?)').bind(id, user.id, Date.now())
    ]);
    return json({club: await clubById(db, id, user.id)}, 201);
  }
  const clubMatch = path.match(/^\/api\/clubs\/([^/]+)(?:\/(members|membership))?$/);
  if (clubMatch) {
    const id = clubMatch[1]; const action = clubMatch[2]; const club = await clubById(db, id, user?.id);
    if (!action && method === 'GET') return json({club, posts: club.joined ? publicPosts(await postRows(db, id, user.id)) : []});
    if (!action && method === 'PATCH') { requireUser(); if (!club.isOwner) fail(403, 'Only the club owner can edit this club.'); const body = await bodyOf(request); await run(db, 'UPDATE clubs SET name=?,suburb=?,description=?,interests=?,ages=?,facebook_url=?,color=? WHERE id=?', text(body.name, 'Club name', 80), text(body.suburb, 'Suburb', 60), text(body.description, 'Description', 1000), list(body.interests || [], 'interests'), list(body.ages || [], 'age groups'), safeLink(body.facebookUrl, true), ['blue', 'green', 'purple', 'orange'].includes(body.color) ? body.color : 'blue', id); return json({club: await clubById(db, id, user.id)}); }
    if (action === 'membership' && method === 'POST') { requireUser(); await run(db, 'INSERT OR IGNORE INTO memberships (club_id,user_id,created_at) VALUES (?,?,?)', id, user.id, Date.now()); return json({club: await clubById(db, id, user.id)}); }
    if (action === 'membership' && method === 'DELETE') { requireUser(); if (club.isOwner) fail(409, 'Club owners must stay in their club.'); await run(db, 'DELETE FROM memberships WHERE club_id=? AND user_id=?', id, user.id); return json({club: await clubById(db, id, user.id)}); }
    if (action === 'members' && method === 'GET') { requireUser(); if (!club.joined) fail(403, 'Join this club to see its members.'); const rows = await all(db, 'SELECT p.* FROM profiles p JOIN memberships m ON m.user_id=p.id WHERE m.club_id=? ORDER BY m.created_at', id); return json({members: rows.map(profile => ({...parseProfile(profile), isOwner: profile.id === club.owner_id}))}); }
  }
  if (path === '/api/posts' && method === 'GET') return json({posts: publicPosts(await postRows(db, null, user?.id))});
  if (path === '/api/posts' && method === 'POST') {
    requireUser(); const body = await bodyOf(request); const clubId = body.clubId ? text(body.clubId, 'Club', 80) : null;
    if (clubId && !await member(db, clubId, user.id)) fail(403, 'Join this club before posting.');
    const topics = ['Meetups', 'Local tips', 'Swap & share', 'Ask for help']; if (!topics.includes(body.topic)) fail(400, 'Choose a discussion topic.');
    const id = crypto.randomUUID(); await run(db, 'INSERT INTO posts (id,author_id,club_id,title,body,topic,link,created_at) VALUES (?,?,?,?,?,?,?,?)', id, user.id, clubId, text(body.title, 'Title', 120), text(body.body, 'Message', 4000), body.topic, safeLink(body.link), Date.now()); return json({id}, 201);
  }
  const postMatch = path.match(/^\/api\/posts\/([^/]+)(?:\/(replies|helpful))?$/);
  if (postMatch) {
    const id = postMatch[1]; const action = postMatch[2]; const post = await requirePost(db, id, user);
    if (!action && method === 'GET') { const author = await first(db, 'SELECT * FROM profiles WHERE id=?', post.author_id); const replies = await all(db, 'SELECT r.*,p.name AS author FROM replies r JOIN profiles p ON p.id=r.author_id WHERE r.post_id=? ORDER BY r.created_at ASC', id); return json({post: {...post, author: author.name}, replies}); }
    if (!action && method === 'DELETE') { requireUser(); const owner = post.club_id ? await first(db, 'SELECT owner_id FROM clubs WHERE id=?', post.club_id) : null; if (post.author_id !== user.id && owner?.owner_id !== user.id) fail(403, 'Only the author or club owner can remove this discussion.'); await run(db, 'DELETE FROM posts WHERE id=?', id); return json({deleted: true}); }
    if (action === 'replies' && method === 'POST') { requireUser(); const body = await bodyOf(request); await run(db, 'INSERT INTO replies (id,post_id,author_id,body,created_at) VALUES (?,?,?,?,?)', crypto.randomUUID(), id, user.id, text(body.body, 'Reply', 2000), Date.now()); return json({created: true}, 201); }
    if (action === 'helpful' && method === 'POST') { requireUser(); await run(db, 'INSERT OR IGNORE INTO reactions (post_id,user_id) VALUES (?,?)', id, user.id); return json({helpful: true}); }
    if (action === 'helpful' && method === 'DELETE') { requireUser(); await run(db, 'DELETE FROM reactions WHERE post_id=? AND user_id=?', id, user.id); return json({helpful: false}); }
  }
  if (path === '/api/saved' && method === 'GET') { requireUser(); const rows = await all(db, 'SELECT event_json FROM saved WHERE user_id=? ORDER BY created_at DESC', user.id); return json({events: rows.map(row => JSON.parse(row.event_json))}); }
  if (path === '/api/saved' && method === 'POST') { requireUser(); const body = await bodyOf(request); if (!body.event || typeof body.event !== 'object') fail(400, 'Choose an activity.'); const id = text(body.event.id, 'Event', 2000); text(body.event.title, 'Event title', 300); if (JSON.stringify(body.event).length > 14000) fail(400, 'Event details are too long.'); await run(db, 'INSERT INTO saved (user_id,event_id,event_json,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET event_json=excluded.event_json', user.id, id, JSON.stringify(body.event), Date.now()); return json({saved: true}); }
  if (path === '/api/saved' && method === 'DELETE') { requireUser(); const body = await bodyOf(request); await run(db, 'DELETE FROM saved WHERE user_id=? AND event_id=?', user.id, text(body.id, 'Event', 2000)); return json({saved: false}); }
  if (path === '/api/event-interest' && method === 'GET') {
    if (!user || user.onboarding_complete === 0) return json({events: {}});
    const own = await all(db, 'SELECT event_id FROM event_interest WHERE user_id=?', user.id);
    const shared = await all(db, `SELECT ei.event_id,p.id AS user_id,p.name,c.id AS club_id,c.name AS club_name
      FROM event_interest ei JOIN profiles p ON p.id=ei.user_id JOIN memberships theirs ON theirs.user_id=ei.user_id
      JOIN memberships mine ON mine.club_id=theirs.club_id AND mine.user_id=? JOIN clubs c ON c.id=mine.club_id
      WHERE ei.user_id<>? ORDER BY ei.created_at DESC LIMIT 2000`, user.id, user.id);
    const events = {};
    for (const row of own) events[row.event_id] = {interested: true, people: [], count: 0, clubs: []};
    for (const row of shared) {
      const entry = events[row.event_id] || (events[row.event_id] = {interested: false, people: [], count: 0, clubs: []});
      if (!entry.people.some(person => person.id === row.user_id)) { entry.people.push({id: row.user_id, name: row.name}); entry.count++; }
      if (!entry.clubs.some(item => item.id === row.club_id)) entry.clubs.push({id: row.club_id, name: row.club_name});
    }
    for (const entry of Object.values(events)) entry.people = entry.people.slice(0, 3);
    return json({events});
  }
  if (path === '/api/event-interest' && method === 'POST') { requireUser(); const body = await bodyOf(request); if (!body.event || typeof body.event !== 'object') fail(400, 'Choose an activity.'); const id = text(body.event.id, 'Event', 2000); text(body.event.title, 'Event title', 300); if (JSON.stringify(body.event).length > 14000) fail(400, 'Event details are too long.'); await run(db, 'INSERT INTO event_interest (user_id,event_id,event_json,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET event_json=excluded.event_json,created_at=excluded.created_at', user.id, id, JSON.stringify(body.event), Date.now()); return json({interested: true}); }
  if (path === '/api/event-interest' && method === 'DELETE') { requireUser(); const body = await bodyOf(request); await run(db, 'DELETE FROM event_interest WHERE user_id=? AND event_id=?', user.id, text(body.id, 'Event', 2000)); return json({interested: false}); }
  return json({error: 'This endpoint was not found.'}, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!isAllowedOrigin(origin, env)) return json({error: 'Origin not allowed.'}, 403);
      return cors(new Response(null, {status: 204, headers: {'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400'}}), request, env);
    }
    try { return cors(await handleRequest(request, env), request, env); }
    catch (error) {
      if (!(error instanceof HttpError)) console.error('Family Finds API error:', error?.stack || error?.message || error);
      return cors(json({error: error instanceof HttpError ? error.message : 'Something went wrong. Please try again.'}, error.status || 500), request, env);
    }
  }
};
