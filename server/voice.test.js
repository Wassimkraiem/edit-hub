import test from 'node:test';
import assert from 'node:assert/strict';
import { LANG } from './voice.js';

test('the mic transcribes in English unless asked otherwise ("auto" lets Whisper guess)', () => {
  assert.equal(LANG(null), 'en');
  assert.equal(LANG('fr'), 'fr');
  assert.equal(LANG('AUTO'), null);
});
