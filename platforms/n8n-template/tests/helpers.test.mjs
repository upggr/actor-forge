import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { transform } = createRequire(import.meta.url)('../nodes/Starter/helpers.js');

test('transform trims input', () => {
  assert.equal(transform('  x  '), 'x');
});
