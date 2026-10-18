import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import worker from '../src/worker.js';

const origin = 'https://deco1800teams-lion-pride.uqcloud.net';
function database() {
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
  return {sqlite, db};
}

test('starter clubs, owner approval, club blocks and account changes', async () => {
  const {sqlite, db} = database();
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
  try {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.features.clubApproval, true);
    const starters = await request('/clubs');
    assert.equal(starters.status, 200);
    assert.equal(starters.data.clubs.filter(club => club.is_starter).length, 3);
    async function register(name, email) {
      const result = await request('/auth/register', 'POST', {name, email, password: 'long-test-password', suburb: 'New Farm'});
      assert.equal(result.status, 201);
      return result.data;
    }
    const owner = await register('Owner', 'owner@example.com');
    const member = await register('Member', 'member@example.com');
    const outsider = await register('Outsider', 'outsider@example.com');
    assert.equal((await request('/clubs/family-weekends/membership', 'POST', {rulesAccepted: true}, outsider.token)).data.club.joined, true);
    const body = {name: 'Family walking group', suburb: 'New Farm', description: 'Families walking together', interests: ['Outdoor play'], ages: ['All ages'], private: true};
    assert.equal((await request('/clubs', 'POST', body, owner.token)).status, 400);
    const created = await request('/clubs', 'POST', {...body, rulesAccepted: true}, owner.token);
    assert.equal(created.status, 201);
    const id = created.data.club.id;
    assert.equal(created.data.club.is_private, true);
    assert.equal((await request(`/clubs/${id}`, 'GET', undefined, owner.token)).data.club.isOwner, true);
    assert.equal((await request('/clubs', 'GET', undefined, member.token)).data.clubs.some(club => club.id === id), true);
    const post = await request('/posts', 'POST', {clubId: id, title: 'Saturday walk', body: 'Meet at the park.', topic: 'Meetups'}, owner.token);
    assert.equal(post.status, 201);
    assert.equal((await request(`/profiles/${owner.profile.id}`, 'GET', undefined, outsider.token)).data.clubs.some(club => club.id === id), false);
    assert.equal((await request(`/clubs/${id}/membership`, 'POST', {}, member.token)).status, 400);
    assert.equal((await request(`/clubs/${id}/membership`, 'POST', {rulesAccepted: true}, member.token)).data.requested, true);
    assert.equal((await request(`/clubs/${id}`, 'GET', undefined, member.token)).data.posts.length, 0);
    assert.equal((await request(`/posts/${post.data.id}`, 'GET', undefined, member.token)).status, 403);
    assert.equal((await request(`/clubs/${id}/members`, 'GET', undefined, member.token)).status, 403);
    assert.equal((await request(`/clubs/${id}/requests`, 'GET', undefined, member.token)).status, 403);
    const pending = await request(`/clubs/${id}/requests`, 'GET', undefined, owner.token);
    assert.deepEqual(pending.data.requests.map(item => item.id), [member.profile.id]);
    assert.equal((await request(`/clubs/${id}/requests/${member.profile.id}`, 'POST', {}, owner.token)).status, 200);
    assert.equal((await request(`/clubs/${id}/members`, 'GET', undefined, member.token)).status, 200);
    assert.equal((await request(`/posts/${post.data.id}`, 'GET', undefined, member.token)).status, 200);
    assert.equal((await request(`/clubs/${id}/blocks/${member.profile.id}`, 'POST', {}, owner.token)).status, 200);
    assert.equal((await request(`/clubs/${id}`, 'GET', undefined, member.token)).status, 403);
    assert.equal((await request(`/posts/${post.data.id}`, 'GET', undefined, member.token)).status, 403);
    assert.equal((await request(`/clubs/${id}/membership`, 'POST', {rulesAccepted: true}, member.token)).status, 403);
    assert.equal((await request(`/clubs/${id}/requests`, 'GET', undefined, outsider.token)).status, 403);
    assert.equal((await request(`/clubs/${id}/blocks/${member.profile.id}`, 'DELETE', undefined, owner.token)).status, 200);
    assert.equal((await request(`/clubs/${id}/membership`, 'POST', {rulesAccepted: true}, member.token)).data.requested, true);

    const wrongPassword = await request('/account/email', 'PATCH', {email: 'newowner@example.com', currentPassword: 'wrong-password'}, owner.token);
    assert.equal(wrongPassword.status, 401);
    const changedEmail = await request('/account/email', 'PATCH', {email: 'newowner@example.com', currentPassword: 'long-test-password'}, owner.token);
    assert.equal(changedEmail.status, 200);
    assert.equal(changedEmail.data.profile.email, 'newowner@example.com');
    assert.equal((await request('/me', 'GET', undefined, owner.token)).data.signedIn, false);
    const changedPassword = await request('/account/password', 'PATCH', {currentPassword: 'long-test-password', newPassword: 'better-new-password'}, changedEmail.data.token);
    assert.equal(changedPassword.status, 200);
    assert.equal((await request('/auth/login', 'POST', {email: 'newowner@example.com', password: 'long-test-password'})).status, 401);
    assert.equal((await request('/auth/login', 'POST', {email: 'newowner@example.com', password: 'better-new-password'})).status, 200);
  } finally { sqlite.close(); }
});
