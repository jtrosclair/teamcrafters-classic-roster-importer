import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../copy-error-messages.js', import.meta.url), 'utf8');
const context = { Error, String, RegExp, Set, console };
context.window = context;
vm.runInNewContext(source, context, { filename: 'copy-error-messages.js' });

const messages = context.TeamBuilderUnleashedCopyErrors;
const ps1Route = { kind: 'classic', gameSlug: 'ncaa-00', teamSlug: 'alabama' };
const modernRoute = { kind: 'classic', gameSlug: 'ncaa-14', teamSlug: 'alabama' };

assert.match(messages.blockedCopyMessage(ps1Route), /Ratings conversion has incomplete data for older PS1-era games/);
assert.match(messages.blockedCopyMessage(ps1Route), /Support for these games is coming soon/);
assert.equal(messages.blockedCopyMessage(modernRoute), null);
assert.match(messages.copyErrorMessage(new Error('Request failed (404)'), modernRoute), /not available to copy/);
assert.match(messages.copyErrorMessage(new Error('Player 1 has an invalid SPD rating.'), modernRoute), /cannot be safely converted/);
assert.match(messages.copyErrorMessage(new Error('Failed to fetch'), modernRoute), /Check your connection/);
assert.match(messages.copyErrorMessage(new Error('mystery error'), modernRoute), /Refresh the page and try again/);

console.log('copy error message tests passed');
