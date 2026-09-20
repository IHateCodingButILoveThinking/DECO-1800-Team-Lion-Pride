import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeEventChatIntent, normaliseEventChatIntent, parseEventChatFallback} from '../src/worker.js';

test('fallback extracts the main family event requirements', () => {
  const criteria = parseEventChatFallback([{
    role: 'user',
    content: 'We are a family of 4 with a 6-year-old and a dog. Find free outdoor activities this weekend.'
  }]);
  assert.deepEqual(criteria, {
    childAges: [6],
    familySize: 4,
    petFriendly: true,
    freeOnly: true,
    date: 'weekend',
    suburb: '',
    interests: ['Outdoors'],
    accessibility: []
  });
});

test('AI output is restricted to safe supported values', () => {
  const criteria = normaliseEventChatIntent({
    childAges: [6, 6, -1, 99], familySize: 200, petFriendly: 'yes', freeOnly: true,
    date: 'someday', suburb: 'Indooroopilly'.repeat(10), interests: ['Creative', '', 3],
    accessibility: ['wheelchair', 'wheelchair']
  });
  assert.deepEqual(criteria.childAges, [6]);
  assert.equal(criteria.familySize, 0);
  assert.equal(criteria.petFriendly, false);
  assert.equal(criteria.freeOnly, true);
  assert.equal(criteria.date, 'any');
  assert.equal(criteria.suburb.length, 60);
  assert.deepEqual(criteria.interests, ['Creative']);
  assert.deepEqual(criteria.accessibility, ['wheelchair']);
});

test('exact conversation details repair an incomplete AI interpretation', () => {
  const messages = [
    {role: 'user', content: 'Family of 4 with a 6-year-old, free this weekend with our dog.'},
    {role: 'user', content: 'Actually we are not bringing the dog.'}
  ];
  const criteria = mergeEventChatIntent(messages, {
    childAges: [], familySize: 0, petFriendly: true, freeOnly: false, date: 'any',
    suburb: '', interests: [], accessibility: ['petFriendly']
  });
  assert.deepEqual(criteria.childAges, [6]);
  assert.equal(criteria.familySize, 4);
  assert.equal(criteria.petFriendly, false);
  assert.equal(criteria.freeOnly, true);
  assert.equal(criteria.date, 'weekend');
  assert.deepEqual(criteria.accessibility, []);
});
