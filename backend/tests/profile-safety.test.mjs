import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import worker from '../src/worker.js';

const origin = 'https://deco1800teams-lion-pride.uqcloud.net';
const answers = ['Meet families for local activities.', 'Be welcoming and share useful local ideas.'];

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  const db = {
    prepare(sql) {
      return {bind(...args) {
        const stmt = sqlite.prepare(sql);
        return {first: async () => stmt.get(...args) || null, all: async () => ({results: stmt.all(...args)}), run: async () => stmt.run(...args)};
      }};
    },
    async batch(statements) { return Promise.all(statements.map(stmt => stmt.run())); }
  };
  const env = {DB: db, ALLOWED_ORIGINS: origin};
  async function request(path, method = 'GET', body, token) {
    const headers = {Origin: origin};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await worker.fetch(new Request('https://api.example/api' + path, {
      method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})
    }), env);
    return {status: response.status, data: await response.json()};
  }
  async function account(name) {
    const result = await request('/auth/register', 'POST', {name, email: `${name.toLowerCase()}@example.com`, password: 'long-test-password', suburb: 'New Farm'});
    assert.equal(result.status, 201);
    return result.data;
  }
  async function club(owner, privateClub = false) {
    const result = await request('/clubs', 'POST', {name: `${owner.profile.name}'s club`, suburb: 'New Farm', description: 'Families meeting locally.', private: privateClub, rulesAccepted: true}, owner.token);
    assert.equal(result.status, 201);
    return result.data.club;
  }
  return {sqlite, env, request, account, club};
}

test('age groups stay private and personal blocks hide account interactions both ways', async () => {
  const {sqlite, request, account, club} = fixture();
  try {
    const parent = await account('Parent');
    const neighbour = await account('Neighbour');
    const host = await account('Host');
    const saved = await request('/profile', 'PATCH', {ages: ['4–7 years', '8–12 years']}, parent.token);
    assert.deepEqual(saved.data.profile.ages, ['4–7 years', '8–12 years']);
    assert.deepEqual((await request(`/profiles/${parent.profile.id}`, 'GET', undefined, neighbour.token)).data.profile.ages, []);
    assert.equal((await request('/profile', 'PATCH', {ages: ['Age 6']}, parent.token)).status, 400);
    const sharedClub = await club(host);
    for (const person of [parent, neighbour]) {
      assert.equal((await request(`/clubs/${sharedClub.id}/membership`, 'POST', {rulesAccepted: true}, person.token)).status, 200);
    }
    const post = (author, title) => request('/posts', 'POST', {title, body: 'Hello neighbours.', topic: 'Meetups'}, author.token);
    const parentPost = await post(parent, 'Parent post');
    const neighbourPost = await post(neighbour, 'Neighbour post');
    const hostPost = await post(host, 'Host post');
    assert.equal((await request(`/posts/${hostPost.data.id}/replies`, 'POST', {body: 'A neighbour reply.'}, neighbour.token)).status, 201);
    assert.equal((await request(`/posts/${hostPost.data.id}/helpful`, 'POST', {}, neighbour.token)).status, 200);
    const event = {id: 'bcc-safety-test-event', title: 'A local activity'};
    await request('/event-interest', 'POST', {event}, neighbour.token);
    assert.equal((await request('/event-interest', 'GET', undefined, parent.token)).data.events[event.id].people[0].id, neighbour.profile.id);

    assert.equal((await request('/blocks', 'POST', {profileId: neighbour.profile.id})).status, 401);
    assert.equal((await request('/blocks', 'POST', {profileId: parent.profile.id}, parent.token)).status, 400);
    assert.equal((await request('/blocks', 'POST', {profileId: neighbour.profile.id}, parent.token)).status, 200);
    assert.equal((await request('/blocks', 'GET', undefined, parent.token)).data.members[0].id, neighbour.profile.id);
    assert.deepEqual((await request('/blocks', 'GET', undefined, neighbour.token)).data.members, []);
    for (const [viewer, hidden] of [[parent, neighbour], [neighbour, parent]]) {
      assert.equal((await request(`/profiles/${hidden.profile.id}`, 'GET', undefined, viewer.token)).status, 404);
      assert.equal((await request('/posts', 'GET', undefined, viewer.token)).data.posts.some(post => post.author_id === hidden.profile.id), false);
      assert.equal((await request(`/clubs/${sharedClub.id}/members`, 'GET', undefined, viewer.token)).data.members.some(member => member.id === hidden.profile.id), false);
    }
    for (const [viewer, hiddenPost] of [[parent, neighbourPost], [neighbour, parentPost]]) {
      assert.equal((await request(`/posts/${hiddenPost.data.id}`, 'GET', undefined, viewer.token)).status, 404);
      assert.equal((await request(`/posts/${hiddenPost.data.id}/replies`, 'POST', {body: 'Should be hidden.'}, viewer.token)).status, 404);
      assert.equal((await request(`/posts/${hiddenPost.data.id}/helpful`, 'POST', {}, viewer.token)).status, 404);
    }
    assert.deepEqual((await request(`/posts/${hostPost.data.id}`, 'GET', undefined, parent.token)).data.replies, []);
    const visibleHost = (await request('/posts', 'GET', undefined, parent.token)).data.posts.find(post => post.id === hostPost.data.id);
    assert.equal(visibleHost.reply_count, 0);
    assert.equal(visibleHost.helpful_count, 0);
    assert.equal((await request('/event-interest', 'GET', undefined, parent.token)).data.events[event.id], undefined);
    // A different account cannot remove the block created by Parent.
    await request(`/blocks/${neighbour.profile.id}`, 'DELETE', undefined, host.token);
    assert.equal((await request(`/profiles/${neighbour.profile.id}`, 'GET', undefined, parent.token)).status, 404);
    assert.equal((await request(`/blocks/${neighbour.profile.id}`, 'DELETE', undefined, parent.token)).status, 200);
    assert.equal((await request(`/profiles/${neighbour.profile.id}`, 'GET', undefined, parent.token)).status, 200);
    assert.equal((await request(`/posts/${hostPost.data.id}`, 'GET', undefined, parent.token)).data.replies.length, 1);
  } finally { sqlite.close(); }
});

test('private join requests validate answers, preserve pending time, and keep answers owner-only', async () => {
  const {sqlite, request, account, club} = fixture();
  try {
    const owner = await account('Owner');
    const parent = await account('Parent');
    const outsider = await account('Outsider');
    const privateClub = await club(owner, true);
    const path = `/clubs/${privateClub.id}/membership`;
    for (const body of [{rulesAccepted: true}, {rulesAccepted: true, answers: ['One answer']}, {rulesAccepted: true, answers: ['', 'Okay']}, {rulesAccepted: true, answers: ['x'.repeat(501), 'Okay']}, {rulesAccepted: false, answers}]) {
      assert.equal((await request(path, 'POST', body, parent.token)).status, 400);
    }
    const pending = await request(path, 'POST', {rulesAccepted: true, answers}, parent.token);
    assert.equal(pending.status, 200);
    assert.equal(pending.data.club.requested, true);
    assert.equal(pending.data.club.joined, false);
    assert.ok(pending.data.club.requested_at > 0);
    const repeated = await request(path, 'POST', {}, parent.token);
    assert.equal(repeated.data.club.requested_at, pending.data.club.requested_at);
    const listClub = (await request('/clubs', 'GET', undefined, parent.token)).data.clubs.find(item => item.id === privateClub.id);
    assert.equal(listClub.requested_at, pending.data.club.requested_at);
    assert.equal(Object.hasOwn(listClub, 'answers'), false);
    const requests = await request(`/clubs/${privateClub.id}/requests`, 'GET', undefined, owner.token);
    assert.deepEqual(requests.data.requests[0].answers, answers);
    assert.equal((await request(`/clubs/${privateClub.id}/requests`, 'GET', undefined, parent.token)).status, 403);
    assert.equal((await request(`/clubs/${privateClub.id}/requests`, 'GET', undefined, outsider.token)).status, 403);
    await request(path, 'DELETE', undefined, parent.token);
    assert.equal((await request(`/clubs/${privateClub.id}`, 'GET', undefined, parent.token)).data.club.requested_at, null);
    // Requests created before this migration remain visible and can be approved.
    sqlite.prepare('INSERT INTO club_join_requests (club_id,user_id,requested_at,rules_accepted_at) VALUES (?,?,?,?)').run(privateClub.id, parent.profile.id, 1000, 1000);
    assert.deepEqual((await request(`/clubs/${privateClub.id}/requests`, 'GET', undefined, owner.token)).data.requests[0].answers, []);
    assert.equal((await request(`/clubs/${privateClub.id}/requests/${parent.profile.id}`, 'POST', {}, owner.token)).status, 200);
    assert.equal((await request(`/clubs/${privateClub.id}`, 'GET', undefined, parent.token)).data.club.joined, true);
  } finally { sqlite.close(); }
});

test('reports require a reason, stay private, and can only be reviewed by the relevant club owner', async () => {
  const {sqlite, request, account, club} = fixture();
  try {
    const owner = await account('Owner');
    const parent = await account('Parent');
    const reported = await account('Reported');
    const outsider = await account('Outsider');
    const sharedClub = await club(owner);
    const otherClub = await club(outsider);
    for (const person of [parent, reported]) await request(`/clubs/${sharedClub.id}/membership`, 'POST', {rulesAccepted: true}, person.token);
    const base = {profileId: reported.profile.id, reason: 'harassment', details: 'Repeated insults in the club discussion.', clubId: sharedClub.id};
    assert.equal((await request('/reports', 'POST', base)).status, 401);
    assert.equal((await request('/reports', 'POST', {...base, reason: 'made-up'}, parent.token)).status, 400);
    assert.equal((await request('/reports', 'POST', {...base, profileId: parent.profile.id}, parent.token)).status, 400);
    assert.equal((await request('/reports', 'POST', {...base, reason: 'other', details: ''}, parent.token)).status, 400);
    assert.equal((await request('/reports', 'POST', base, outsider.token)).status, 403);
    assert.equal((await request('/reports', 'POST', {...base, profileId: outsider.profile.id}, parent.token)).status, 400);
    assert.equal((await request('/reports', 'POST', {...base, profileId: owner.profile.id}, parent.token)).status, 400);
    const submitted = await request('/reports', 'POST', base, parent.token);
    assert.equal(submitted.status, 201);
    assert.equal(submitted.data.report.status, 'pending');
    const reportId = submitted.data.report.id;
    assert.equal((await request('/reports', 'POST', base, parent.token)).data.report.id, reportId);
    assert.equal((await request('/reports', 'GET', undefined, parent.token)).data.reports[0].reported_name, 'Reported');
    assert.deepEqual((await request('/reports', 'GET', undefined, reported.token)).data.reports, []);
    assert.deepEqual((await request('/reports', 'GET', undefined, outsider.token)).data.reports, []);
    assert.equal((await request(`/clubs/${sharedClub.id}/reports`, 'GET', undefined, reported.token)).status, 403);
    const review = await request(`/clubs/${sharedClub.id}/reports`, 'GET', undefined, owner.token);
    assert.equal(review.data.reports[0].id, reportId);
    assert.equal(review.data.reports[0].details, base.details);
    assert.equal((await request(`/clubs/${sharedClub.id}/reports/${reportId}`, 'PATCH', {status: 'resolved'}, parent.token)).status, 403);
    assert.equal((await request(`/clubs/${otherClub.id}/reports/${reportId}`, 'PATCH', {status: 'resolved'}, outsider.token)).status, 404);
    assert.equal((await request(`/clubs/${sharedClub.id}/reports/${reportId}`, 'PATCH', {status: 'unexpected'}, owner.token)).status, 400);
    assert.equal((await request(`/clubs/${sharedClub.id}/reports/${reportId}`, 'PATCH', {status: 'resolved'}, owner.token)).status, 200);
    const receipt = (await request('/reports', 'GET', undefined, parent.token)).data.reports[0];
    assert.equal(receipt.status, 'resolved');
    assert.ok(receipt.reviewed_at >= receipt.created_at);
    const unscoped = await request('/reports', 'POST', {profileId: owner.profile.id, reason: 'privacy', details: 'An account privacy concern.'}, parent.token);
    assert.equal(unscoped.status, 201);
    assert.equal((await request(`/clubs/${sharedClub.id}/reports`, 'GET', undefined, owner.token)).data.reports.length, 1);
    assert.deepEqual((await request('/reports', 'GET', undefined, owner.token)).data.reports, []);
  } finally { sqlite.close(); }
});

test('global report review needs an explicitly configured moderator and prevents self-review', async () => {
  const {sqlite, env, request, account} = fixture();
  try {
    const moderator = await account('Moderator');
    const parent = await account('Parent');
    const reported = await account('Reported');
    const report = await request('/reports', 'POST', {profileId: reported.profile.id, reason: 'spam', details: 'Repeated unwanted advertisements.'}, parent.token);
    const aboutModerator = await request('/reports', 'POST', {profileId: moderator.profile.id, reason: 'privacy', details: 'Shared account information.'}, parent.token);
    assert.equal((await request('/me', 'GET', undefined, moderator.token)).data.profile.isModerator, false);
    assert.equal((await request('/reports/moderation', 'GET', undefined, moderator.token)).status, 403);
    env.MODERATOR_PROFILE_IDS = ` ${moderator.profile.id} `;
    assert.equal((await request('/me', 'GET', undefined, moderator.token)).data.profile.isModerator, true);
    assert.equal((await request(`/profiles/${moderator.profile.id}`, 'GET', undefined, moderator.token)).data.profile.isModerator, true);
    assert.equal((await request('/profile', 'PATCH', {bio: 'Helping the local community.'}, moderator.token)).data.profile.isModerator, true);
    assert.equal((await request('/me', 'GET', undefined, parent.token)).data.profile.isModerator, false);
    assert.equal(Object.hasOwn((await request(`/profiles/${moderator.profile.id}`, 'GET', undefined, parent.token)).data.profile, 'isModerator'), false);
    const queue = await request('/reports/moderation', 'GET', undefined, moderator.token);
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.data.reports.map(item => item.id), [report.data.report.id]);
    assert.equal((await request(`/reports/moderation/${report.data.report.id}`, 'PATCH', {status: 'dismissed'}, parent.token)).status, 403);
    assert.equal((await request(`/reports/moderation/${aboutModerator.data.report.id}`, 'PATCH', {status: 'resolved'}, moderator.token)).status, 403);
    assert.equal((await request(`/reports/moderation/${report.data.report.id}`, 'PATCH', {status: 'dismissed'}, moderator.token)).status, 200);
    assert.equal((await request('/reports', 'GET', undefined, parent.token)).data.reports.find(item => item.id === report.data.report.id).status, 'dismissed');
    // Comma-separated configuration uses exact IDs, not prefix or substring matches.
    env.MODERATOR_PROFILE_IDS = `${moderator.profile.id}-suffix`;
    assert.equal((await request('/reports/moderation', 'GET', undefined, moderator.token)).status, 403);
  } finally { sqlite.close(); }
});
