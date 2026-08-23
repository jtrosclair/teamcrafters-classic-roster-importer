import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../update-checker.js', import.meta.url), 'utf8');
const storage = {};
let currentVersion = '0.6.0';
let responseMode = 'release';

function makeResponse({ status, body, etag = '' }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: async () => body,
  };
}

const context = {
  chrome: {
    runtime: { getManifest: () => ({ version: currentVersion }) },
    storage: {
      local: {
        get(key, callback) {
          callback({ [key]: storage[key] });
        },
        set(values, callback) {
          Object.assign(storage, values);
          callback?.();
        },
      },
    },
  },
  fetch: async () => {
    if (responseMode === 'release') {
      return makeResponse({
        status: 200,
        etag: '"release-etag"',
        body: [
          { draft: true, tag_name: 'v9.0.0' },
          { prerelease: true, tag_name: 'v8.0.0' },
          {
            tag_name: 'v0.6.1',
            name: 'Team Builder Unleashed v0.6.1',
            html_url: 'https://example.test/releases/v0.6.1',
            published_at: '2026-08-23T00:00:00Z',
            assets: [{ name: 'team-builder-unleashed.zip', browser_download_url: 'https://example.test/tbu.zip' }],
          },
        ],
      });
    }
    if (responseMode === 'not-modified') return makeResponse({ status: 304, body: [] });
    return makeResponse({ status: 503, body: [] });
  },
  Promise,
  Date,
  Error,
  Number,
  String,
  Array,
  Object,
  RegExp,
  console,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'update-checker.js' });

const updates = context.TeamBuilderUnleashedUpdates;
assert.deepEqual(Array.from(updates.parseVersion('v1.2.3')), [1, 2, 3, 0]);
assert.equal(updates.compareVersions('1.2.4', '1.2.3'), 1);
assert.equal(updates.compareVersions('1.2.3', '1.2.3'), 0);
assert.equal(updates.compareVersions('1.2.3', '1.2.4'), -1);

let state = await updates.checkForUpdates({ force: true });
assert.equal(state.status, 'update-available');
assert.equal(state.latestVersion, '0.6.1');
assert.equal(state.downloadUrl, 'https://example.test/tbu.zip');

currentVersion = '0.7.0';
responseMode = 'not-modified';
state = await updates.checkForUpdates({ force: true });
assert.equal(state.status, 'ahead');
assert.equal(state.latestVersion, '0.6.1');

currentVersion = '0.6.0';
responseMode = 'error';
state = await updates.checkForUpdates({ force: true });
assert.equal(state.status, 'update-available');
assert.match(state.lastError, /503/);

console.log('update checker tests passed');
