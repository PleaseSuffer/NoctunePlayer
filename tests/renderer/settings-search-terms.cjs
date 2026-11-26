const assert = require('node:assert/strict');
const { normalize, tokenize, alternateLayout, wordsFor } = require('../../src/shared/settings-search-terms');
assert.equal(normalize('  ЁЖ   Night '), 'еж night');
assert.deepEqual(tokenize('Mini-player 60 FPS'), ['mini', 'player', '60', 'fps']);
for (const [query, expected] of [['NTVF', 'тема'], ['ghjphfxyjcnm', 'прозрачность'], ['еруьу', 'theme'], ['днкшсы', 'lyrics'], [';ehyfk', 'журнал'], ['ж', ';'], ['`', '']]) {
    assert.equal(alternateLayout(query), expected);
}
assert.equal(alternateLayout('123'), '');
assert.deepEqual(tokenize(alternateLayout(';ehyfk')), ['журнал']);
for (const phrase of ['одинаковая громкость', 'equal loudness']) {
    assert(tokenize(phrase).every(token => normalize(wordsFor('setting-normalize')).includes(token)));
}
assert.equal(wordsFor('setting-not-a-control'), '');
console.log('PASS search terms');
