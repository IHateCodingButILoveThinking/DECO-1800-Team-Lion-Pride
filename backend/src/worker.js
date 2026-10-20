// Implementation assistance: OpenAI Codex (https://openai.com/codex/); frontend/references.html#development.
/* Family Finds API: Cloudflare Worker + D1.
   Platform references: https://developers.cloudflare.com/workers/ and
   https://developers.cloudflare.com/d1/ (request handlers and prepared SQL).
   Application-specific account, community and moderation logic is maintained here. */
import {verifyGoogleCredential} from './google-auth.js';
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
const PROFILE_AGE_GROUPS = new Set(['0–3 years', '4–7 years', '8–12 years', 'Teens', 'All ages']);
function ageGroups(value) {
  const encoded = list(value, 'age groups');
  if (JSON.parse(encoded).some(group => !PROFILE_AGE_GROUPS.has(group))) fail(400, 'Choose one of the listed age groups.');
  return encoded;
}

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
    ...(own ? {email: row.email, passwordAccount: !!row.password_hash, showSuburb: !!row.show_suburb, showInterests: !!row.show_interests, onboardingComplete: row.onboarding_complete !== 0} : {}),
    createdAt: row.created_at
  };
}
function ownProfile(row, env) { return row ? {...parseProfile(row, true), isModerator: isModerator(row, env)} : null; }

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
async function bodyOf(request) { const raw = await request.text(); if (raw.length > 24000) fail(413, 'This entry is too large.'); try { return JSON.parse(raw); } catch { fail(400, 'Invalid request.'); } }

const EVENT_CHAT_SCHEMA = {
  type: 'object',
  properties: {
    childAges: {type: 'array', items: {type: 'integer', minimum: 0, maximum: 17}, maxItems: 8},
    familySize: {type: 'integer', minimum: 0, maximum: 20},
    petFriendly: {type: 'boolean'},
    freeOnly: {type: 'boolean'},
    date: {type: 'string', enum: ['any', 'today', 'weekend', 'next7', 'next30']},
    suburb: {type: 'string', maxLength: 60},
    interests: {type: 'array', items: {type: 'string', maxLength: 45}, maxItems: 8},
    accessibility: {type: 'array', items: {type: 'string', enum: ['wheelchair', 'stroller', 'sensory friendly']}, maxItems: 3}
  },
  required: ['childAges', 'familySize', 'petFriendly', 'freeOnly', 'date', 'suburb', 'interests', 'accessibility'],
  additionalProperties: false
};

function chatText(messages) {
  return messages.filter(message => message.role === 'user').map(message => message.content).join(' ');
}

export function normaliseEventChatIntent(value = {}) {
  const shortList = (items, limit) => Array.isArray(items)
    ? [...new Set(items.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))].slice(0, limit)
    : [];
  const interests = new Set(['Outdoors', 'Libraries', 'Creative', 'Markets & secondhand', 'Other activities']);
  const accessNeeds = new Set(['wheelchair', 'stroller', 'sensory friendly']);
  return {
    childAges: Array.isArray(value.childAges)
      ? [...new Set(value.childAges.filter(age => Number.isInteger(age) && age >= 0 && age <= 17))].slice(0, 8)
      : [],
    familySize: Number.isInteger(value.familySize) && value.familySize >= 1 && value.familySize <= 20 ? value.familySize : 0,
    petFriendly: value.petFriendly === true,
    freeOnly: value.freeOnly === true,
    date: ['today', 'weekend', 'next7', 'next30'].includes(value.date) ? value.date : 'any',
    suburb: typeof value.suburb === 'string' ? value.suburb.trim().slice(0, 60) : '',
    interests: shortList(value.interests, 8).filter(item => interests.has(item)),
    accessibility: shortList(value.accessibility, 3).filter(item => accessNeeds.has(item.toLowerCase())).map(item => item.toLowerCase())
  };
}

// This keeps the core search usable when the Workers AI free allowance is busy.
export function parseEventChatFallback(messages) {
  const interestMap = [
    [/\b(?:park|outdoor|nature|garden|walk|playground)\b/i, 'Outdoors'],
    [/\b(?:library|book|reading|story)\b/i, 'Libraries'],
    [/\b(?:art|craft|paint|creative|making)\b/i, 'Creative'],
    [/\b(?:market|swap|second.?hand|garage sale)\b/i, 'Markets & secondhand'],
    [/\b(?:sport|dance|music|animal|science|workshop)\b/i, 'Other activities']
  ];
  const accessMap = [
    [/\bwheelchair\b/i, 'wheelchair'],
    [/\bstroller|pram\b/i, 'stroller'],
    [/\bquiet|sensory\b/i, 'sensory friendly']
  ];
  const criteria = normaliseEventChatIntent();
  for (const message of messages.filter(item => item.role === 'user')) {
    const input = message.content;
    const lower = input.toLowerCase();
    const ages = [];
    for (const pattern of [/(\d{1,2})\s*(?:-|\s)?year(?:s)?(?:-|\s)?old\b/gi, /\bage(?:d)?\s+(\d{1,2})\b/gi, /\b(\d{1,2})\s*(?:yo|y\/o|yrs?)\b/gi]) {
      for (const match of input.matchAll(pattern)) {
        const age = Number(match[1]);
        if (age <= 17) ages.push(age);
      }
    }
    if (ages.length) criteria.childAges = [...new Set(ages)];
    const family = lower.match(/\b(?:family|group)\s+of\s+(\d{1,2})\b/);
    if (family) criteria.familySize = Number(family[1]);
    if (/\b(?:dog|puppy|pet)\b/.test(lower)) criteria.petFriendly = !/\b(?:no|without|not bringing|leave)(?:\s+\w+){0,3}\s+(?:dog|puppy|pet)\b/.test(lower);
    if (/\b(?:free|no.?cost|zero.?cost|without paying)\b/.test(lower)) criteria.freeOnly = true;
    if (/\b(?:paid|not free|any price|doesn'?t need to be free)\b/.test(lower)) criteria.freeOnly = false;
    if (/\btoday\b/.test(lower)) criteria.date = 'today';
    else if (/\b(?:this )?weekend\b/.test(lower)) criteria.date = 'weekend';
    else if (/\b(?:next|coming) (?:7 days|week)\b/.test(lower)) criteria.date = 'next7';
    else if (/\b(?:next|coming) (?:30 days|month)\b/.test(lower)) criteria.date = 'next30';
    const suburb = input.match(/\b(?:near|around|in)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})(?=\s*(?:,|\.|$|this\b|on\b|with\b|for\b))/);
    if (suburb) criteria.suburb = suburb[1];
    criteria.interests = [...new Set([...criteria.interests, ...interestMap.filter(([pattern]) => pattern.test(input)).map(([, interest]) => interest)])];
    criteria.accessibility = [...new Set([...criteria.accessibility, ...accessMap.filter(([pattern]) => pattern.test(input)).map(([, need]) => need)])];
  }
  return normaliseEventChatIntent(criteria);
}

export function mergeEventChatIntent(messages, aiValue) {
  const ai = normaliseEventChatIntent(aiValue);
  const exact = parseEventChatFallback(messages);
  const input = chatText(messages);
  return normaliseEventChatIntent({
    childAges: /\b(?:age|aged|years?(?:-|\s)old|yo|y\/o|yrs?)\b/i.test(input) ? exact.childAges : ai.childAges,
    familySize: /\b(?:family|group)\s+of\s+\d/i.test(input) ? exact.familySize : ai.familySize,
    petFriendly: /\b(?:dog|puppy|pet)\b/i.test(input) ? exact.petFriendly : ai.petFriendly,
    freeOnly: /\b(?:free|cost|paid|price|paying)\b/i.test(input) ? exact.freeOnly : ai.freeOnly,
    date: /\b(?:today|weekend|next week|coming week|7 days|30 days|month)\b/i.test(input) ? exact.date : ai.date,
    suburb: exact.suburb || ai.suburb,
    interests: [...new Set([...ai.interests, ...exact.interests])],
    accessibility: [...new Set([...ai.accessibility, ...exact.accessibility])]
  });
}

async function eventChat(request, env) {
  const body = await bodyOf(request);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 8) fail(400, 'Send between 1 and 8 chat messages.');
  const messages = body.messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role)) fail(400, 'Chat messages must have a valid role.');
    return {role: message.role, content: text(message.content, 'Chat message', 500)};
  });
  if (!messages.some(message => message.role === 'user')) fail(400, 'Write what your family needs first.');

  let withinFreeAppLimit = false;
  if (env.AI && env.DB && env.LOCAL_DEV !== 'true') {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const limit = Math.min(50, Math.max(1, Number(env.AI_DAILY_REQUEST_LIMIT) || 30));
      const usage = await first(env.DB, `INSERT INTO ai_daily_usage (day,requests) VALUES (?,1)
        ON CONFLICT(day) DO UPDATE SET requests=requests+1 RETURNING requests`, day);
      withinFreeAppLimit = Number(usage?.requests) <= limit;
    } catch (error) {
      // A missing usage table or database problem must never become a paid or broken dependency.
      console.warn('Workers AI daily limit unavailable:', error?.message || error);
    }
  }
  if (env.AI && withinFreeAppLimit) {
    try {
      // Cloudflare Workers AI binding and Meta Llama model reference:
      // https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
      const result = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          {
            role: 'system',
            content: 'Extract one combined family-event search from the conversation. Later user messages refine or replace earlier preferences. Use familySize 0 when absent and date any when absent. The words today, weekend, next week, next 7 days, next month, and next 30 days map to their exact date enum. Only put Brisbane suburb names in suburb. Map interests to Outdoors, Libraries, Creative, Markets & secondhand, or Other activities. Accessibility may only be wheelchair, stroller, or sensory friendly. Pets belong only in petFriendly, never accessibility. Return only the requested JSON object.'
          },
          ...messages
        ],
        response_format: {type: 'json_schema', json_schema: EVENT_CHAT_SCHEMA},
        temperature: 0.1,
        max_tokens: 320
      });
      const raw = typeof result?.response === 'string' ? JSON.parse(result.response) : result?.response;
      return json({criteria: mergeEventChatIntent(messages, raw), source: 'ai'});
    } catch (error) {
      console.warn('Workers AI event chat fallback:', error?.message || error);
    }
  }
  return json({criteria: parseEventChatFallback(messages), source: 'rules'});
}

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
async function requireCurrentPassword(user, value) {
  if (!user.password_hash) fail(409, 'This account uses Google sign-in. Manage its email and password with Google.');
  const password = passwordText(value);
  if (!sameHash(await passwordHash(password, user.password_salt), user.password_hash)) fail(401, 'Current password is incorrect.');
}
function sameHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index++) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function configuredOrigins(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean); }
function isModerator(user, env) {
  return !!user && String(env.MODERATOR_PROFILE_IDS || '').split(',').map(value => value.trim()).filter(Boolean).includes(user.id);
}
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
    await run(env.DB, 'INSERT INTO profiles (id,auth_id,email,password_hash,password_salt,name,suburb,bio,interests,ages,onboarding_complete,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, `email:${email}`, email, await passwordHash(password, salt), salt, text(body.name, 'Name', 60), text(body.suburb, 'Suburb', 60), text(body.bio, 'Bio', 500, false), list(body.interests || [], 'interests'), ageGroups(body.ages || []), 1, Date.now());
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) fail(409, 'An account already uses this email. Try logging in.');
    throw error;
  }
  const user = await first(env.DB, 'SELECT * FROM profiles WHERE id=?', id);
  return json({token: await createSession(env.DB, id), expiresIn: SESSION_TTL, profile: ownProfile(user, env)}, 201);
}

async function loginAccount(request, env) {
  const body = await bodyOf(request);
  const email = emailAddress(body.email);
  const password = passwordText(body.password);
  const user = await first(env.DB, 'SELECT * FROM profiles WHERE lower(email)=?', email);
  const salt = user?.password_salt || randomToken(24);
  const matches = sameHash(await passwordHash(password, salt), user?.password_hash || 'invalid-password-hash');
  if (!user || !user.password_hash || !matches) fail(401, 'Email or password is incorrect.');
  return json({token: await createSession(env.DB, user.id), expiresIn: SESSION_TTL, profile: ownProfile(user, env)});
}

async function logout(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token) await run(env.DB, 'DELETE FROM sessions WHERE id_hash=?', await hashToken(token));
  return json({signedOut: true});
}

async function googleAccount(request, env) {
  if (!env.GOOGLE_CLIENT_ID) fail(503, 'Google sign-in is not configured yet. Please use email and password.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Send a JSON request.');
  const body = await bodyOf(request);
  const credential = text(body.credential, 'Google credential', 16000);
  let identity;
  try { identity = await verifyGoogleCredential(credential, env.GOOGLE_CLIENT_ID); }
  catch { fail(401, 'Google sign-in could not be verified. Please try again.'); }
  const authId = `google:${identity.sub}`;
  let user = await first(env.DB, 'SELECT * FROM profiles WHERE auth_id=?', authId);
  let created = false;
  if (!user) {
    const email = emailAddress(identity.email);
    const existing = await first(env.DB, 'SELECT * FROM profiles WHERE lower(email)=?', email);
    // Google is authoritative for Gmail and verified Workspace identities, so
    // those identities can safely connect to the matching password profile.
    if (existing) {
      const googleOwnsEmail = email.endsWith('@gmail.com') || (identity.email_verified === true && typeof identity.hd === 'string' && identity.hd);
      if (!googleOwnsEmail) fail(409, 'This email already has a password account. Please log in with your password.');
      try { await run(env.DB, 'UPDATE profiles SET auth_id=? WHERE id=?', authId, existing.id); }
      catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) fail(409, 'This Google account is already connected to another profile.');
        throw error;
      }
      user = await first(env.DB, 'SELECT * FROM profiles WHERE id=?', existing.id);
    }
    if (!user) {
      const id = crypto.randomUUID();
      const name = (typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim() : 'Neighbour').slice(0, 60);
      try {
        await run(env.DB, 'INSERT INTO profiles (id,auth_id,email,name,suburb,onboarding_complete,created_at) VALUES (?,?,?,?,?,?,?)', id, authId, email, name, '', 1, Date.now());
        created = true;
      } catch (error) {
        if (!String(error?.message || '').includes('UNIQUE')) throw error;
        // A concurrent sign-in for the same Google identity may have created it.
        if (!await first(env.DB, 'SELECT id FROM profiles WHERE auth_id=?', authId)) fail(409, 'An account already uses this email. Please log in with your existing password.');
      }
      user = await first(env.DB, 'SELECT * FROM profiles WHERE auth_id=?', authId);
    }
  }
  return json({token: await createSession(env.DB, user.id), expiresIn: SESSION_TTL, profile: ownProfile(user, env), created}, created ? 201 : 200);
}

async function member(db, clubId, userId) { return userId ? first(db, 'SELECT user_id FROM memberships WHERE club_id=? AND user_id=?', clubId, userId) : null; }
async function blockedBetween(db, viewerId, otherId) {
  return !!(viewerId && otherId && viewerId !== otherId && await first(db,
    'SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)', viewerId, otherId, otherId, viewerId));
}
// The SQL column names below are fixed application strings, never request values.
const visibleAuthor = column => `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id=? AND ub.blocked_id=${column}) OR (ub.blocker_id=${column} AND ub.blocked_id=?))`;
async function clubById(db, id, userId) {
  const club = await first(db, 'SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count FROM clubs c JOIN profiles p ON p.id=c.owner_id WHERE c.id=?', id);
  if (!club) fail(404, 'This club could not be found.');
  if (userId && await first(db, 'SELECT 1 FROM club_blocks WHERE club_id=? AND user_id=?', id, userId)) fail(403, 'You cannot access this club.');
  const joined = !!await member(db, id, userId);
  const pending = userId ? await first(db, 'SELECT requested_at FROM club_join_requests WHERE club_id=? AND user_id=?', id, userId) : null;
  return {...club, interests: parseJsonArray(club.interests), ages: parseJsonArray(club.ages), is_private: !!club.is_private, is_starter: !!club.is_starter,
    facebook_url: club.is_private && !joined ? '' : club.facebook_url,
    joined, requested: !!pending, requested_at: pending?.requested_at ?? null,
    isOwner: club.owner_id === userId,
    requestCount: club.owner_id === userId ? (await first(db, 'SELECT COUNT(*) AS count FROM club_join_requests WHERE club_id=?', id)).count : 0};
}
async function requirePost(db, id, user) {
  const post = await first(db, 'SELECT * FROM posts WHERE id=?', id);
  if (!post) fail(404, 'This discussion could not be found.');
  if (await blockedBetween(db, user?.id, post.author_id)) fail(404, 'This discussion is unavailable.');
  if (post.club_id && !await member(db, post.club_id, user?.id)) fail(403, 'Join this club to read and reply to its discussions.');
  return post;
}
async function postRows(db, clubId, userId) {
  const viewer = userId || '';
  return all(db, `SELECT p.*,u.name AS author,u.show_suburb,u.suburb,c.name AS club_name,
    (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id AND ${visibleAuthor('r.author_id')}) AS reply_count,
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id AND ${visibleAuthor('r.user_id')}) AS helpful_count,
    EXISTS(SELECT 1 FROM reactions r WHERE r.post_id=p.id AND r.user_id=?) AS liked
    FROM posts p JOIN profiles u ON u.id=p.author_id LEFT JOIN clubs c ON c.id=p.club_id
    WHERE ${clubId ? 'p.club_id=?' : 'p.club_id IS NULL'} AND ${visibleAuthor('p.author_id')}
    ORDER BY p.created_at DESC LIMIT 100`, viewer, viewer, viewer, viewer, viewer, ...(clubId ? [clubId] : []), viewer, viewer);
}
function publicPosts(rows) { return rows.map(row => ({...row, suburb: row.show_suburb ? row.suburb : '', show_suburb: undefined})); }

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json({error: 'Family Finds API'}, 404);
  const db = env.DB;
  if (!db) fail(503, 'Community is temporarily unavailable. Please try again shortly.');
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/health' && method === 'GET') {
    const approvalTable = await first(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='club_join_requests'");
    const safetyTable = await first(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='user_blocks'");
    return json({ok: true, service: 'family-finds-api', features: {clubApproval: !!approvalTable, profileSafety: !!safetyTable, joinQuestions: !!safetyTable}});
  }
  if (path === '/api/auth/google' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return googleAccount(request, env); }
  if (path === '/api/auth/register' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return registerAccount(request, env); }
  if (path === '/api/auth/login' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return loginAccount(request, env); }
  if (path === '/api/auth/logout' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return logout(request, env); }
  if (path === '/api/ai/events' && method === 'POST') { if (!trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.'); return eventChat(request, env); }

  const {auth, user} = await authenticate(request, env);
  if (!['GET', 'HEAD'].includes(method) && !trustedMutation(request, env)) fail(403, 'Please submit this request from Family Finds.');
  const requireUser = () => {
    if (!auth) fail(401, 'Sign in to continue.');
    if (!user || user.onboarding_complete === 0) fail(409, 'Create your Family Finds profile first.');
    return user;
  };

  if (path === '/api/me' && method === 'GET') return json({signedIn: !!auth, email: auth?.email || '', profile: ownProfile(user, env)});
  if (path === '/api/profile' && method === 'PATCH') {
    requireUser(); const body = await bodyOf(request);
    await run(db, 'UPDATE profiles SET name=?,suburb=?,bio=?,interests=?,ages=?,show_suburb=?,show_interests=? WHERE id=?', text(body.name ?? user.name, 'Name', 60), text(body.suburb ?? user.suburb, 'Suburb', 60), text(body.bio ?? user.bio, 'Bio', 500, false), list(body.interests ?? parseJsonArray(user.interests), 'interests'), ageGroups(body.ages ?? parseJsonArray(user.ages)), body.showSuburb === undefined ? user.show_suburb : Number(body.showSuburb === true), body.showInterests === undefined ? user.show_interests : Number(body.showInterests === true), user.id);
    return json({profile: ownProfile(await first(db, 'SELECT * FROM profiles WHERE id=?', user.id), env)});
  }
  if (path === '/api/account/email' && method === 'PATCH') {
    requireUser(); const body = await bodyOf(request);
    await requireCurrentPassword(user, body.currentPassword);
    const email = emailAddress(body.email);
    if (email !== user.email) {
      try {
        await run(db, 'UPDATE profiles SET email=?,auth_id=CASE WHEN auth_id LIKE ? THEN ? ELSE auth_id END WHERE id=?', email, 'email:%', `email:${email}`, user.id);
      } catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) fail(409, 'An account already uses this email.');
        throw error;
      }
    }
    await run(db, 'DELETE FROM sessions WHERE user_id=?', user.id);
    return json({token: await createSession(db, user.id), profile: ownProfile(await first(db, 'SELECT * FROM profiles WHERE id=?', user.id), env)});
  }
  if (path === '/api/account/password' && method === 'PATCH') {
    requireUser(); const body = await bodyOf(request);
    await requireCurrentPassword(user, body.currentPassword);
    const password = passwordText(body.newPassword);
    if (sameHash(await passwordHash(password, user.password_salt), user.password_hash)) fail(400, 'Choose a different password.');
    const salt = randomToken(24);
    await run(db, 'UPDATE profiles SET password_hash=?,password_salt=? WHERE id=?', await passwordHash(password, salt), salt, user.id);
    await run(db, 'DELETE FROM sessions WHERE user_id=?', user.id);
    return json({token: await createSession(db, user.id), profile: ownProfile(await first(db, 'SELECT * FROM profiles WHERE id=?', user.id), env)});
  }
  if (path === '/api/blocks' && method === 'GET') {
    requireUser();
    return json({members: await all(db, 'SELECT p.id,p.name,b.created_at AS blocked_at FROM user_blocks b JOIN profiles p ON p.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC', user.id)});
  }
  if (path === '/api/blocks' && method === 'POST') {
    requireUser(); const body = await bodyOf(request); const targetId = text(body.profileId, 'Member', 80);
    if (targetId === user.id) fail(400, 'You cannot block your own account.');
    if (!await first(db, 'SELECT id FROM profiles WHERE id=? AND onboarding_complete=1', targetId)) fail(404, 'Member not found.');
    await run(db, 'INSERT OR IGNORE INTO user_blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)', user.id, targetId, Date.now());
    return json({blocked: true});
  }
  const personalBlockMatch = path.match(/^\/api\/blocks\/([^/]+)$/);
  if (personalBlockMatch && method === 'DELETE') {
    requireUser();
    await run(db, 'DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?', user.id, decodeURIComponent(personalBlockMatch[1]));
    return json({blocked: false});
  }
  if (path === '/api/reports' && method === 'GET') {
    requireUser();
    return json({reports: await all(db, `SELECT r.id,r.reported_id,p.name AS reported_name,r.reason,r.details,r.club_id,c.name AS club_name,r.status,r.created_at,r.reviewed_at
      FROM user_reports r JOIN profiles p ON p.id=r.reported_id LEFT JOIN clubs c ON c.id=r.club_id
      WHERE r.reporter_id=? ORDER BY r.created_at DESC LIMIT 100`, user.id)});
  }
  if (path === '/api/reports' && method === 'POST') {
    requireUser(); const body = await bodyOf(request); const targetId = text(body.profileId, 'Member', 80);
    if (targetId === user.id) fail(400, 'You cannot report your own account.');
    if (!await first(db, 'SELECT id FROM profiles WHERE id=? AND onboarding_complete=1', targetId)) fail(404, 'Member not found.');
    const reasons = ['harassment', 'spam', 'unsafe', 'inappropriate', 'privacy', 'other'];
    if (!reasons.includes(body.reason)) fail(400, 'Choose a reason for your report.');
    const details = text(body.details, 'Report details', 1500, body.reason === 'other');
    const clubId = body.clubId ? text(body.clubId, 'Club', 80) : null;
    if (clubId) {
      const reportClub = await clubById(db, clubId, user.id);
      if (!reportClub.joined) fail(403, 'Join this club before submitting a club report.');
      if (reportClub.owner_id === targetId) fail(400, 'Report this account without a club selected so it is not sent to the person being reported.');
      if (!await member(db, clubId, targetId) && !await first(db, 'SELECT id FROM posts WHERE club_id=? AND author_id=?', clubId, targetId)) fail(400, 'Choose a member of this club.');
    }
    const existing = await first(db, 'SELECT id,status,created_at FROM user_reports WHERE reporter_id=? AND reported_id=? AND reason=? AND club_id IS ? AND status=?', user.id, targetId, body.reason, clubId, 'pending');
    if (existing) return json({report: existing, submitted: true});
    const id = crypto.randomUUID(); const now = Date.now();
    await run(db, 'INSERT INTO user_reports (id,reporter_id,reported_id,reason,details,club_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)', id, user.id, targetId, body.reason, details, clubId, 'pending', now);
    return json({report: {id, status: 'pending', created_at: now}, submitted: true}, 201);
  }
  const moderatorReportsMatch = path.match(/^\/api\/reports\/moderation(?:\/([^/]+))?$/);
  if (moderatorReportsMatch) {
    requireUser();
    if (!isModerator(user, env)) fail(403, 'Only an assigned moderator can review these reports.');
    const reportId = moderatorReportsMatch[1];
    if (!reportId && method === 'GET') return json({reports: await all(db, `SELECT r.id,r.reported_id,p.name AS reported_name,r.reporter_id,reporter.name AS reporter_name,r.reason,r.details,r.club_id,c.name AS club_name,r.status,r.created_at,r.reviewed_at
      FROM user_reports r JOIN profiles p ON p.id=r.reported_id JOIN profiles reporter ON reporter.id=r.reporter_id LEFT JOIN clubs c ON c.id=r.club_id
      WHERE r.reported_id<>? ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100`, user.id)});
    if (reportId && method === 'PATCH') {
      const body = await bodyOf(request);
      if (!['resolved', 'dismissed'].includes(body.status)) fail(400, 'Choose a report review outcome.');
      const report = await first(db, 'SELECT reported_id FROM user_reports WHERE id=?', reportId);
      if (!report) fail(404, 'Report not found.');
      if (report.reported_id === user.id) fail(403, 'Another moderator must review a report about your account.');
      await run(db, 'UPDATE user_reports SET status=?,reviewed_at=? WHERE id=?', body.status, Date.now(), reportId);
      return json({reviewed: true, status: body.status});
    }
  }
  const clubReportsMatch = path.match(/^\/api\/clubs\/([^/]+)\/reports(?:\/([^/]+))?$/);
  if (clubReportsMatch) {
    requireUser(); const [, clubId, reportId] = clubReportsMatch;
    const reportClub = await clubById(db, clubId, user.id);
    if (!reportClub.isOwner) fail(403, 'Only the club owner can review club reports.');
    if (!reportId && method === 'GET') return json({reports: await all(db, `SELECT r.id,r.reported_id,p.name AS reported_name,r.reporter_id,reporter.name AS reporter_name,r.reason,r.details,r.club_id,c.name AS club_name,r.status,r.created_at,r.reviewed_at
      FROM user_reports r JOIN profiles p ON p.id=r.reported_id JOIN profiles reporter ON reporter.id=r.reporter_id JOIN clubs c ON c.id=r.club_id
      WHERE r.club_id=? ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100`, clubId)});
    if (reportId && method === 'PATCH') {
      const body = await bodyOf(request);
      if (!['resolved', 'dismissed'].includes(body.status)) fail(400, 'Choose a report review outcome.');
      const report = await first(db, 'SELECT id FROM user_reports WHERE id=? AND club_id=?', reportId, clubId);
      if (!report) fail(404, 'Report not found.');
      await run(db, 'UPDATE user_reports SET status=?,reviewed_at=? WHERE id=? AND club_id=?', body.status, Date.now(), reportId, clubId);
      return json({reviewed: true, status: body.status});
    }
  }
  if (path.startsWith('/api/profiles/') && method === 'GET') {
    requireUser(); const id = decodeURIComponent(path.slice('/api/profiles/'.length)); const profile = await first(db, 'SELECT * FROM profiles WHERE id=? AND onboarding_complete=1', id); if (!profile) fail(404, 'Member not found.');
    if (await blockedBetween(db, user.id, id)) fail(404, 'This member is unavailable.');
    return json({profile: id === user.id ? ownProfile(profile, env) : parseProfile(profile), clubs: await all(db, `SELECT c.id,c.name,c.suburb,c.color FROM clubs c JOIN memberships m ON m.club_id=c.id
      WHERE m.user_id=? AND (c.is_private=0 OR EXISTS(SELECT 1 FROM memberships viewer WHERE viewer.club_id=c.id AND viewer.user_id=?))
      AND NOT EXISTS(SELECT 1 FROM club_blocks b WHERE b.club_id=c.id AND b.user_id=?) ORDER BY c.name`, id, user.id, user.id)});
  }
  if (path === '/api/clubs' && method === 'GET') {
    const clubs = await all(db, `SELECT c.*,p.name AS owner_name,(SELECT COUNT(*) FROM memberships m WHERE m.club_id=c.id) AS member_count,
      EXISTS(SELECT 1 FROM memberships m WHERE m.club_id=c.id AND m.user_id=?) AS joined,
      EXISTS(SELECT 1 FROM club_join_requests r WHERE r.club_id=c.id AND r.user_id=?) AS requested,
      (SELECT r.requested_at FROM club_join_requests r WHERE r.club_id=c.id AND r.user_id=?) AS requested_at
      FROM clubs c JOIN profiles p ON p.id=c.owner_id
      WHERE NOT EXISTS(SELECT 1 FROM club_blocks b WHERE b.club_id=c.id AND b.user_id=?)
      ORDER BY c.is_starter DESC,c.created_at DESC LIMIT 200`, user?.id || '', user?.id || '', user?.id || '', user?.id || '');
    return json({clubs: clubs.map(club => ({...club, facebook_url: club.is_private && !club.joined ? '' : club.facebook_url, interests: parseJsonArray(club.interests), ages: parseJsonArray(club.ages), joined: !!club.joined, requested: !!club.requested, is_private: !!club.is_private, is_starter: !!club.is_starter, isOwner: club.owner_id === user?.id}))});
  }
  if (path === '/api/clubs' && method === 'POST') {
    requireUser(); const body = await bodyOf(request); const id = crypto.randomUUID(); const color = ['blue', 'green', 'purple', 'orange'].includes(body.color) ? body.color : 'blue';
    if (body.rulesAccepted !== true) fail(400, 'Agree to the community rules before creating a club.');
    const now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO clubs (id,owner_id,name,suburb,description,interests,ages,facebook_url,color,is_private,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id, user.id, text(body.name, 'Club name', 80), text(body.suburb, 'Suburb', 60), text(body.description, 'Description', 1000), list(body.interests || [], 'interests'), list(body.ages || [], 'age groups'), safeLink(body.facebookUrl, true), color, Number(body.private === true), now),
      db.prepare('INSERT INTO memberships (club_id,user_id,created_at,rules_accepted_at) VALUES (?,?,?,?)').bind(id, user.id, now, now)
    ]);
    return json({club: await clubById(db, id, user.id)}, 201);
  }
  const moderationMatch = path.match(/^\/api\/clubs\/([^/]+)\/(requests|blocks)(?:\/([^/]+))?$/);
  if (moderationMatch) {
    requireUser();
    const [, id, action, targetId] = moderationMatch;
    const club = await clubById(db, id, user.id);
    if (!club.isOwner) fail(403, 'Only the club owner can manage members.');
    if (action === 'requests' && !targetId && method === 'GET') {
      const requests = await all(db, `SELECT p.id,p.name,CASE WHEN p.show_suburb=1 THEN p.suburb ELSE '' END AS suburb,r.requested_at,r.join_answers
        FROM club_join_requests r JOIN profiles p ON p.id=r.user_id WHERE r.club_id=? ORDER BY r.requested_at`, id);
      return json({requests: requests.map(({join_answers, ...pending}) => ({...pending, answers: parseJsonArray(join_answers)}))});
    }
    if (action === 'requests' && targetId && method === 'POST') {
      const pending = await first(db, 'SELECT * FROM club_join_requests WHERE club_id=? AND user_id=?', id, targetId);
      if (!pending) fail(404, 'This join request is no longer pending.');
      if (await first(db, 'SELECT 1 FROM club_blocks WHERE club_id=? AND user_id=?', id, targetId)) fail(409, 'Unblock this member before approving.');
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO memberships (club_id,user_id,created_at,rules_accepted_at) VALUES (?,?,?,?)').bind(id, targetId, Date.now(), pending.rules_accepted_at),
        db.prepare('DELETE FROM club_join_requests WHERE club_id=? AND user_id=?').bind(id, targetId)
      ]);
      return json({approved: true});
    }
    if (action === 'requests' && targetId && method === 'DELETE') {
      await run(db, 'DELETE FROM club_join_requests WHERE club_id=? AND user_id=?', id, targetId);
      return json({declined: true});
    }
    if (action === 'blocks' && !targetId && method === 'GET') {
      return json({members: await all(db, 'SELECT p.id,p.name FROM club_blocks b JOIN profiles p ON p.id=b.user_id WHERE b.club_id=? ORDER BY b.blocked_at DESC', id)});
    }
    if (action === 'blocks' && targetId && method === 'POST') {
      if (targetId === club.owner_id) fail(409, 'Club owners cannot block themselves.');
      if (!await first(db, 'SELECT id FROM profiles WHERE id=?', targetId)) fail(404, 'Member not found.');
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO club_blocks (club_id,user_id,blocked_at) VALUES (?,?,?)').bind(id, targetId, Date.now()),
        db.prepare('DELETE FROM memberships WHERE club_id=? AND user_id=?').bind(id, targetId),
        db.prepare('DELETE FROM club_join_requests WHERE club_id=? AND user_id=?').bind(id, targetId)
      ]);
      return json({blocked: true});
    }
    if (action === 'blocks' && targetId && method === 'DELETE') {
      await run(db, 'DELETE FROM club_blocks WHERE club_id=? AND user_id=?', id, targetId);
      return json({blocked: false});
    }
  }
  const clubMatch = path.match(/^\/api\/clubs\/([^/]+)(?:\/(members|membership))?$/);
  if (clubMatch) {
    const id = clubMatch[1]; const action = clubMatch[2]; const club = await clubById(db, id, user?.id);
    if (!action && method === 'GET') return json({club, posts: club.joined ? publicPosts(await postRows(db, id, user.id)) : []});
    if (!action && method === 'PATCH') { requireUser(); if (!club.isOwner) fail(403, 'Only the club owner can edit this club.'); const body = await bodyOf(request); await run(db, 'UPDATE clubs SET name=?,suburb=?,description=?,interests=?,ages=?,facebook_url=?,color=?,is_private=? WHERE id=?', text(body.name, 'Club name', 80), text(body.suburb, 'Suburb', 60), text(body.description, 'Description', 1000), list(body.interests || [], 'interests'), list(body.ages || [], 'age groups'), safeLink(body.facebookUrl, true), ['blue', 'green', 'purple', 'orange'].includes(body.color) ? body.color : 'blue', Number(body.private === true), id); return json({club: await clubById(db, id, user.id)}); }
    if (action === 'membership' && method === 'POST') {
      requireUser();
      if (club.joined) return json({club});
      if (club.is_private && club.requested) return json({club, requested: true});
      const body = await bodyOf(request);
      if (body.rulesAccepted !== true) fail(400, 'Agree to the community rules before joining a club.');
      const now = Date.now();
      if (club.is_private) {
        if (!Array.isArray(body.answers) || body.answers.length !== 2) fail(400, 'Answer both questions before requesting to join.');
        const answers = body.answers.map((answer, index) => text(answer, `Answer ${index + 1}`, 500));
        await run(db, 'INSERT OR IGNORE INTO club_join_requests (club_id,user_id,requested_at,rules_accepted_at,join_answers) VALUES (?,?,?,?,?)', id, user.id, now, now, JSON.stringify(answers));
        return json({club: await clubById(db, id, user.id), requested: true});
      }
      await run(db, 'INSERT OR IGNORE INTO memberships (club_id,user_id,created_at,rules_accepted_at) VALUES (?,?,?,?)', id, user.id, now, now);
      return json({club: await clubById(db, id, user.id)});
    }
    if (action === 'membership' && method === 'DELETE') {
      requireUser(); if (club.isOwner) fail(409, 'Club owners must stay in their club.');
      await db.batch([
        db.prepare('DELETE FROM memberships WHERE club_id=? AND user_id=?').bind(id, user.id),
        db.prepare('DELETE FROM club_join_requests WHERE club_id=? AND user_id=?').bind(id, user.id)
      ]);
      return json({club: await clubById(db, id, user.id)});
    }
    if (action === 'members' && method === 'GET') { requireUser(); if (!club.joined) fail(403, 'Join this club to see its members.'); const rows = await all(db, `SELECT p.* FROM profiles p JOIN memberships m ON m.user_id=p.id WHERE m.club_id=? AND ${visibleAuthor('p.id')} ORDER BY m.created_at`, id, user.id, user.id); return json({members: rows.map(profile => ({...parseProfile(profile), isOwner: profile.id === club.owner_id}))}); }
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
    if (!action && method === 'GET') { const author = await first(db, 'SELECT * FROM profiles WHERE id=?', post.author_id); const replies = await all(db, `SELECT r.*,p.name AS author FROM replies r JOIN profiles p ON p.id=r.author_id WHERE r.post_id=? AND ${visibleAuthor('r.author_id')} ORDER BY r.created_at ASC`, id, user?.id || '', user?.id || ''); return json({post: {...post, author: author.name}, replies}); }
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
      WHERE ei.user_id<>? AND ${visibleAuthor('ei.user_id')} ORDER BY ei.created_at DESC LIMIT 2000`, user.id, user.id, user.id, user.id);
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
