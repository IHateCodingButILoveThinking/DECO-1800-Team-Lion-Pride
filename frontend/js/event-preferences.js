/* Family Finds' profile-to-event matching rules. Age groups stay private to the account.
   Implementation assistance: OpenAI Codex, https://openai.com/codex/.
   Visible reference: ../references.html#development. */
const EventPreferences = (() => {
  const groups = {
    '0–3 years': [0, 1, 2, 3],
    '4–7 years': [4, 5, 6, 7],
    '8–12 years': [8, 9, 10, 11, 12],
    '13–17 years': [13, 14, 15, 16, 17]
  };
  const interestWords = {
    'Outdoor play': ['outdoor', 'park', 'playground', 'walk'],
    'Arts & crafts': ['art', 'craft', 'creative', 'paint', 'draw', 'making', 'sculpt', 'collage', 'pottery'],
    'Books & stories': ['library', 'libraries', 'book', 'story', 'stories', 'storytime', 'read', 'author'],
    'Sports & movement': ['sport', 'fitness', 'swim', 'yoga', 'dance', 'skating', 'tennis', 'soccer', 'karate', 'martial arts'],
    'Nature & gardening': ['nature', 'garden', 'gardening', 'wildlife', 'bird', 'bushwalk', 'conservation'],
    'Markets & swaps': ['market', 'swap', 'secondhand', 'second hand', 'garage sale'],
    'Weekend adventures': ['adventure', 'festival', 'outdoor', 'park', 'walk'],
    'Parent support': ['parent', 'carer', 'caregiver', 'playgroup', 'support']
  };
  // Match activity words explicitly: "booking" is not a book or reading activity.
  const interestPatterns = {
    'Outdoor play': /\b(?:outdoors?|parks?|playgrounds?|walks?|walking)\b/i,
    'Arts & crafts': /\b(?:arts?|crafts?|crafting|creative|paints?|painting|paintings|draws?|drawing|drawings|making|sculpture|sculpting|collage|pottery)\b/i,
    'Books & stories': /\b(?:libraries|library|books?|stories|story|storytime|reading|reads?|author|authors)\b/i,
    'Sports & movement': /\b(?:sports?|fitness|swimming|swim|yoga|dance|dancing|skating|tennis|soccer|karate|martial arts?)\b/i,
    'Nature & gardening': /\b(?:nature|gardens?|gardening|wildlife|birds?|bushwalks?|bushwalking|conservation)\b/i,
    'Markets & swaps': /\b(?:markets?|swaps?|swapping|secondhand|second[ -]hand|garage sales?)\b/i,
    'Weekend adventures': /\b(?:adventures?|festivals?|outdoors?|parks?|walks?|walking)\b/i,
    'Parent support': /\b(?:parents?|parenting|carers?|caregivers?|playgroups?|support)\b/i
  };
  function normaliseGroups(values) {
    if (!Array.isArray(values) || values.includes('All ages')) return [];
    return Object.keys(groups).filter(group => values.some(value => (value === 'Teens' ? '13–17 years' : value) === group));
  }
  function ageValue(values) { return values.length > 1 ? 'My child ages' : values[0] || 'All ages'; }
  function agesFor(values) { return [...new Set(normaliseGroups(values).flatMap(group => groups[group]))]; }
  function matchesAges(event, ages) {
    if (!ages?.length) return true;
    const primary = String(event.ages || '').toLowerCase();
    const fallback = (event.ageRanges || []).join(' ').toLowerCase();
    // A specific organiser age limit takes precedence over a broad metadata tag.
    const wording = /\d|all ages|everyone|adults? only|not suitable/.test(primary)
      ? primary : /check age|not specified|unknown/.test(primary) ? fallback : `${primary} ${fallback}`;
    if (!wording.trim() || /check age|not specified|unknown/.test(wording)) return false;
    if (/adults? only|18\s*\+|not suitable for children/.test(wording)) return false;
    if (/all ages|everyone/.test(wording)) return true;
    const candidates = /months?/.test(wording) && !/years?/.test(wording)
      ? ages.flatMap(age => Array.from({length: 12}, (_, month) => age * 12 + month)) : ages;
    const ranges = [...wording.matchAll(/(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/g)].map(match => [Number(match[1]), Number(match[2])]);
    const minimums = [...wording.matchAll(/(?:ages?|aged)\s*(\d{1,2})\s*\+|(\d{1,2})\s*(?:years?\s*)?(?:and over|and above|and older|and up|\+)/g)].map(match => Number(match[1] || match[2]));
    const over = [...wording.matchAll(/(?:over|above)\s*(\d{1,2})/g)].map(match => Number(match[1]));
    const under = [...wording.matchAll(/under\s*(\d{1,2})/g)].map(match => Number(match[1]));
    const maximums = [...wording.matchAll(/up to\s*(\d{1,2})|(\d{1,2})\s*(?:years?\s*)?and under/g)].map(match => Number(match[1] || match[2]));
    if (ranges.length || minimums.length || over.length || under.length || maximums.length) {
      return candidates.some(age => ranges.some(([min, max]) => age >= min && age <= max) || minimums.some(min => age >= min) || over.some(min => age > min) || under.some(max => age < max) || maximums.some(max => age <= max));
    }
    const single = [...wording.matchAll(/(?:ages?|aged)\s+(\d{1,2})(?!\d)/g)].map(match => Number(match[1]));
    if (single.length) return candidates.some(age => single.includes(age));
    if (/famil/.test(wording)) return true;
    return ages.some(age =>
      (age <= 1 && /bab|infant/.test(wording)) ||
      (age >= 1 && age <= 3 && /toddler/.test(wording)) ||
      (age <= 5 && /preschool|early childhood/.test(wording)) ||
      (age >= 4 && age <= 12 && /child|kid|primary|school.age/.test(wording)) ||
      (age >= 13 && /teen|young people|youth/.test(wording)));
  }
  function interestTerms(interests) {
    return [...new Set((interests || []).flatMap(interest => interestWords[interest] || []))];
  }
  function matchesInterests(event, interests) {
    const selected = (interests || []).filter(interest => interestPatterns[interest]);
    if (!selected.length) return true;
    // Venue-derived tags/categories are useful browsing aids, but a clinic held
    // at a library should not become a Books & stories recommendation.
    const wording = [event.title, event.description].join(' ').toLowerCase();
    return selected.some(interest => {
      let activity = wording;
      if (interest === 'Arts & crafts') activity = activity.replace(/\bmartial arts?\b/g, '');
      if (interest === 'Books & stories') activity = activity.replace(/\bbook\s+(?:now|online|your|a|an|the|this|in|by|via|on|at)\b/g, '');
      return interestPatterns[interest].test(activity);
    });
  }
  // A settings save with unchanged ages must not overwrite a parent's manual filter choice.
  function createSelection() {
    let key = null, selected = [];
    return {
      get groups() { return [...selected]; },
      sync(profile) {
        const next = JSON.stringify([profile?.id || '', normaliseGroups(profile?.ages)]);
        if (next === key) return false;
        key = next;
        selected = normaliseGroups(profile?.ages);
        return true;
      },
      restore(profile) { selected = normaliseGroups(profile?.ages); },
      select(values) { selected = normaliseGroups(values); },
      clear() { selected = []; }
    };
  }
  return {groups, normaliseGroups, ageValue, agesFor, matchesAges, interestTerms, matchesInterests, createSelection};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = EventPreferences;
