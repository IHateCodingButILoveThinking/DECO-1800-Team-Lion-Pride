const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../js/event-preferences.js');

test('specific organiser age limits take precedence over broad metadata', () => {
  const ages = preferences.agesFor(['4–7 years']);
  assert.equal(preferences.matchesAges({ages:'Ages 12–16 years',ageRanges:['All ages']},ages),false);
  assert.equal(preferences.matchesAges({ages:'Ages 6–9 years',ageRanges:['Adults']},ages),true);
  assert.equal(preferences.matchesAges({ages:'Check age suitability',ageRanges:['Ages 5–8 years']},ages),true);
  assert.equal(preferences.matchesAges({ages:'Adults only',ageRanges:['All ages']},ages),false);
});

test('saved age groups match numeric ranges and keep unknown suitability out', () => {
  const ages = preferences.agesFor(['4–7 years']);
  assert.equal(preferences.matchesAges({ages: 'For children aged 5–8 years'}, ages), true);
  assert.equal(preferences.matchesAges({ages: 'Ages 10–12 years'}, ages), false);
  assert.equal(preferences.matchesAges({ages: 'All ages'}, ages), true);
  assert.equal(preferences.matchesAges({ages: 'Adults only, 18+'}, ages), false);
  assert.equal(preferences.matchesAges({ages: 'Check age suitability'}, ages), false);
  assert.equal(preferences.matchesAges({ages: 'No age information provided'}, ages), false);
  assert.equal(preferences.matchesAges({ages: 'Families with children aged 10–12'}, ages), false);
  assert.equal(preferences.matchesAges({ages: 'under 4'}, [4]), false);
  assert.equal(preferences.matchesAges({ages: 'ages 6+'}, [6]), true);
  assert.equal(preferences.matchesAges({ages: '6–18 months'}, [0]), true);
  assert.equal(preferences.matchesAges({ages: '6–18 months'}, [6]), false);
  assert.equal(preferences.matchesAges({ages: '6 years and older'}, [6]), true);
  assert.equal(preferences.matchesAges({ages: 'over 6'}, [6]), false);
});

test('several saved child groups match either group and Teens is normalised', () => {
  const groups = preferences.normaliseGroups(['Teens', '4–7 years', '4–7 years']);
  assert.deepEqual(groups, ['4–7 years', '13–17 years']);
  assert.equal(preferences.ageValue(groups), 'My child ages');
  assert.equal(preferences.matchesAges({ages: 'For teens aged 13–16'}, preferences.agesFor(groups)), true);
  assert.equal(preferences.matchesAges({ages: 'Babies under 1'}, preferences.agesFor(groups)), false);
  assert.deepEqual(preferences.normaliseGroups(['All ages', '4–7 years']), []);
  assert.equal(preferences.matchesAges({ages: 'Adults only'}, []), true);
});

test('same-profile rerenders preserve manual ages; changed settings apply once', () => {
  const selected = preferences.createSelection();
  const profile = {id: 'parent-one', ages: ['4–7 years'], interests: ['Arts & crafts']};
  assert.equal(selected.sync(profile), true);
  assert.deepEqual(selected.groups, ['4–7 years']);
  selected.clear();
  assert.equal(selected.sync({...profile, interests: ['Outdoor play']}), false);
  assert.deepEqual(selected.groups, []);
  selected.restore(profile);
  assert.deepEqual(selected.groups, ['4–7 years']);
  selected.select(['8–12 years']);
  assert.equal(selected.sync(profile), false);
  assert.deepEqual(selected.groups, ['8–12 years']);
  assert.equal(selected.sync({...profile, ages: ['Teens']}), true);
  assert.deepEqual(selected.groups, ['13–17 years']);
  assert.equal(selected.sync(null), true);
  assert.deepEqual(selected.groups, []);
});

test('For me matches selected interests without treating every family event as a match', () => {
  assert.equal(preferences.matchesInterests({title: 'Painting at the library', category: 'Creative'}, ['Arts & crafts']), true);
  assert.equal(preferences.matchesInterests({title: 'Park play', category: 'Outdoors'}, ['Arts & crafts']), false);
  assert.equal(preferences.matchesInterests({title: 'Birthday party'}, ['Arts & crafts']), false);
  assert.equal(preferences.matchesInterests({title: 'Quiet storytime'}, ['Books & stories']), true);
  assert.equal(preferences.matchesInterests({title: 'Park play'}, []), true);
});

test('bookings, library venues and martial arts do not imply reading or creative interests', () => {
  const creativeAndReading = ['Arts & crafts', 'Books & stories'];
  assert.equal(preferences.matchesInterests({title: 'Community Immunisation Clinic', description: 'Bookings required for clinic.', venue: 'Chermside Library', category: 'Libraries', tags: ['Library', 'Indoor']}, creativeAndReading), false);
  assert.equal(preferences.matchesInterests({title: 'Community Immunisation Clinic', description: 'Book your appointment online.'}, creativeAndReading), false);
  assert.equal(preferences.matchesInterests({title: 'Martial arts karate', description: 'Learn martial arts with an instructor.', category: 'Creative', tags: ['Creative', 'Sport']}, ['Arts & crafts']), false);
  assert.equal(preferences.matchesInterests({title: 'Martial arts karate'}, ['Sports & movement']), true);
  assert.equal(preferences.matchesInterests({title: 'Martial arts and craft day', description: 'Try painting and paper crafts.'}, ['Arts & crafts']), true);
  assert.equal(preferences.matchesInterests({title: 'A book of stories', description: 'Read books with local authors.'}, ['Books & stories']), true);
  assert.equal(preferences.matchesInterests({title: 'Walking through the park'}, ['Outdoor play']), true);
});
