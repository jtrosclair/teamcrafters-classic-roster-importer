import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const BRIDGE_SOURCE = fs.readFileSync(new URL('../equipment-web-bridge.js', import.meta.url), 'utf8');
const NAMESPACE = 'teamcrafters.cfb27.equipment';
const PAGE_SOURCE = 'teamcrafters-page';
const ORIGIN = 'https://www.teamcrafters.net';
const PATH = '/cfb27/team-builder-unleashed';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fixtureClipboard() {
  const roster = {
    '100': { PLYR_FIRSTNAME: 'Ada', PLYR_LASTNAME: 'Lovelace', PLYR_POSITION: '0' },
    '101': { PLYR_FIRSTNAME: 'Grace', PLYR_LASTNAME: 'Hopper', PLYR_POSITION: '16' },
  };
  const visuals = {
    '100': {
      firstName: 'Ada',
      lastName: 'Lovelace',
      containerId: 100,
      loadouts: [
        {
          loadoutType: 1,
          loadoutCategory: 0,
          loadoutElements: [
            { slotType: 106, itemAssetName: 'GearHelmet_Speed_Flex', itemDisplayName: '' },
          ],
        },
        {
          loadoutType: 0,
          loadoutCategory: 5,
          loadoutElements: [{ slotType: 129, itemAssetName: 'Standard_BodyType' }],
        },
      ],
    },
    '101': {
      firstName: 'Grace',
      lastName: 'Hopper',
      containerId: 101,
      loadouts: [
        {
          loadoutType: 1,
          loadoutCategory: 0,
          loadoutElements: [
            { slotType: 110, itemAssetName: 'ArmSleeve_None' },
          ],
        },
        {
          loadoutType: 0,
          loadoutCategory: 5,
          loadoutElements: [
            { slotType: 129, itemAssetName: 'Thin_BodyType' },
            { slotType: 43, itemAssetName: '' },
          ],
        },
      ],
    },
  };
  return {
    version: 2,
    teamName: 'Bridge Testers',
    copiedAt: '2026-08-03T12:00:00.000Z',
    playerCount: 2,
    rosterJson: JSON.stringify(roster),
    visualsJson: JSON.stringify(visuals),
    rosterUrl: 'private-roster-url',
    visualsUrl: 'private-visuals-url',
    unknownFutureField: { preserve: true },
  };
}

function createHarness(initialClipboard, { origin = ORIGIN, pathname = PATH } = {}) {
  let clipboard = clone(initialClipboard);
  let messageListener = null;
  let storageListener = null;
  let setCount = 0;
  const posted = [];

  const windowObject = {
    location: { origin, pathname },
    addEventListener(type, listener) {
      if (type === 'message') messageListener = listener;
    },
    postMessage(message, targetOrigin) {
      posted.push({ message: clone(message), targetOrigin });
    },
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay);
      timer.unref?.();
      return timer;
    },
  };

  const chrome = {
    runtime: { getManifest: () => ({ version: '9.8.7' }) },
    storage: {
      local: {
        async get(key) {
          assert.equal(key, 'tcRosterClipboard');
          return clipboard === undefined ? {} : { tcRosterClipboard: clone(clipboard) };
        },
        async set(value) {
          const oldValue = clone(clipboard);
          clipboard = clone(value.tcRosterClipboard);
          setCount += 1;
          storageListener?.(
            { tcRosterClipboard: { oldValue, newValue: clone(clipboard) } },
            'local',
          );
        },
      },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
  };

  vm.runInNewContext(BRIDGE_SOURCE, {
    chrome,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    window: windowObject,
    setTimeout,
  }, { filename: 'equipment-web-bridge.js' });

  function envelope(type, payload, requestId = undefined) {
    return {
      namespace: NAMESPACE,
      bridgeVersion: 1,
      source: PAGE_SOURCE,
      type,
      requestId,
      payload,
    };
  }

  function dispatch(message, eventOverrides = {}) {
    if (!messageListener) return;
    messageListener({
      source: windowObject,
      origin,
      data: message,
      ...eventOverrides,
    });
  }

  async function waitFor(type, requestId, startIndex = 0) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const match = posted.slice(startIndex).find(({ message }) =>
        message.type === type && (requestId === undefined || message.requestId === requestId));
      if (match) return match.message;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${type}${requestId ? ` (${requestId})` : ''}`);
  }

  async function externalSet(nextClipboard) {
    const oldValue = clone(clipboard);
    clipboard = clone(nextClipboard);
    storageListener?.(
      { tcRosterClipboard: { oldValue, newValue: clone(clipboard) } },
      'local',
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return {
    dispatch,
    envelope,
    externalSet,
    get clipboard() { return clone(clipboard); },
    get posted() { return posted; },
    get setCount() { return setCount; },
    waitFor,
  };
}

async function run() {
  const harness = createHarness(fixtureClipboard());

  harness.dispatch(harness.envelope('TC_UNLEASHED_HELLO', {
    supportedBridgeVersions: [1],
    payloadVersion: 1,
    catalogVersion: 'v1',
    route: PATH,
  }));
  const ready = await harness.waitFor('TC_UNLEASHED_READY');
  assert.equal(ready.payload.extensionVersion, '9.8.7');
  assert.deepEqual([...ready.payload.catalogVersions], ['v1']);
  assert.deepEqual([...ready.payload.capabilities], [
    'clipboard.read',
    'clipboard.write.visuals',
    'clipboard.revision',
    'clipboard.subscribe',
  ]);

  harness.dispatch(harness.envelope('TC_UNLEASHED_GET_CLIPBOARD', {}, 'get-1'));
  const read = await harness.waitFor('TC_UNLEASHED_CLIPBOARD', 'get-1');
  assert.match(read.payload.revision, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(read.payload.clipboard).sort(), [
    'copiedAt', 'rosterJson', 'teamName', 'visualsJson',
  ]);
  assert.equal(read.payload.clipboard.rosterUrl, undefined);
  assert.equal(read.payload.clipboard.unknownFutureField, undefined);

  const editedVisuals = JSON.parse(read.payload.clipboard.visualsJson);
  editedVisuals['100'].loadouts[0].loadoutElements[0].itemAssetName = 'GearHelmet_SchuttF7';
  editedVisuals['101'].loadouts[0].loadoutElements.push({
    slotType: 2,
    itemAssetName: 'GearVisor_visorClear',
  });
  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: read.payload.revision,
    patch: {
      visualsJson: JSON.stringify(editedVisuals),
      equipmentEditedAt: '2026-08-03T13:00:00.000Z',
    },
  }, 'put-1'));
  const write = await harness.waitFor('TC_UNLEASHED_WRITE_RESULT', 'put-1');
  assert.notEqual(write.payload.revision, read.payload.revision);
  assert.equal(harness.setCount, 1);
  assert.deepEqual(harness.clipboard.unknownFutureField, { preserve: true });
  assert.equal(harness.clipboard.rosterUrl, 'private-roster-url');
  assert.equal(harness.clipboard.equipmentEditedAt, '2026-08-03T13:00:00.000Z');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(harness.posted.some(({ message }) => message.type === 'TC_UNLEASHED_CLIPBOARD_CHANGED'), false,
    'the bridge should suppress its own storage-change notification');

  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: read.payload.revision,
    patch: {
      visualsJson: JSON.stringify(editedVisuals),
      equipmentEditedAt: '2026-08-03T13:01:00.000Z',
    },
  }, 'put-stale'));
  const stale = await harness.waitFor('TC_UNLEASHED_ERROR', 'put-stale');
  assert.equal(stale.payload.code, 'REVISION_CONFLICT');
  assert.equal(harness.setCount, 1);

  harness.dispatch(harness.envelope('TC_UNLEASHED_GET_CLIPBOARD', {}, 'get-2'));
  const current = await harness.waitFor('TC_UNLEASHED_CLIPBOARD', 'get-2');

  const wrongPlayers = JSON.parse(current.payload.clipboard.visualsJson);
  delete wrongPlayers['101'];
  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: current.payload.revision,
    patch: {
      visualsJson: JSON.stringify(wrongPlayers),
      equipmentEditedAt: '2026-08-03T13:02:00.000Z',
    },
  }, 'put-ids'));
  const ids = await harness.waitFor('TC_UNLEASHED_ERROR', 'put-ids');
  assert.equal(ids.payload.code, 'PLAYER_ID_MISMATCH');

  const identityChange = JSON.parse(current.payload.clipboard.visualsJson);
  identityChange['100'].firstName = 'Mallory';
  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: current.payload.revision,
    patch: {
      visualsJson: JSON.stringify(identityChange),
      equipmentEditedAt: '2026-08-03T13:03:00.000Z',
    },
  }, 'put-protected'));
  const protectedError = await harness.waitFor('TC_UNLEASHED_ERROR', 'put-protected');
  assert.equal(protectedError.payload.code, 'INVALID_PAYLOAD');
  assert.match(protectedError.payload.message, /protected character visual fields/i);

  const removedEditableEquipment = JSON.parse(current.payload.clipboard.visualsJson);
  removedEditableEquipment['100'].loadouts[0].loadoutElements = [];
  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: current.payload.revision,
    patch: {
      visualsJson: JSON.stringify(removedEditableEquipment),
      equipmentEditedAt: '2026-08-03T13:04:00.000Z',
    },
  }, 'put-remove-editable'));
  const removedEditableWrite = await harness.waitFor('TC_UNLEASHED_WRITE_RESULT', 'put-remove-editable');
  assert.deepEqual(
    JSON.parse(removedEditableWrite.payload.clipboard.visualsJson)['100'].loadouts[0].loadoutElements,
    [],
  );

  const removedHiddenEquipment = JSON.parse(removedEditableWrite.payload.clipboard.visualsJson);
  removedHiddenEquipment['101'].loadouts[1].loadoutElements = [];
  harness.dispatch(harness.envelope('TC_UNLEASHED_PUT_CLIPBOARD', {
    expectedRevision: removedEditableWrite.payload.revision,
    patch: {
      visualsJson: JSON.stringify(removedHiddenEquipment),
      equipmentEditedAt: '2026-08-03T13:05:00.000Z',
    },
  }, 'put-remove-hidden'));
  const hiddenRemoval = await harness.waitFor('TC_UNLEASHED_ERROR', 'put-remove-hidden');
  assert.equal(hiddenRemoval.payload.code, 'INVALID_PAYLOAD');
  assert.match(hiddenRemoval.payload.message, /hidden or incompatible equipment slot/i);

  const beforeWrongOrigin = harness.posted.length;
  harness.dispatch(harness.envelope('TC_UNLEASHED_GET_CLIPBOARD', {}, 'wrong-origin'), {
    origin: 'https://evil.example',
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.posted.length, beforeWrongOrigin);

  const external = harness.clipboard;
  external.teamName = 'Externally Replaced Team';
  const externalStart = harness.posted.length;
  await harness.externalSet(external);
  const changed = await harness.waitFor('TC_UNLEASHED_CLIPBOARD_CHANGED', undefined, externalStart);
  assert.match(changed.payload.revision, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(changed.payload.revision, current.payload.revision);

  const emptyHarness = createHarness(undefined);
  emptyHarness.dispatch(emptyHarness.envelope('TC_UNLEASHED_GET_CLIPBOARD', {}, 'get-empty'));
  const empty = await emptyHarness.waitFor('TC_UNLEASHED_ERROR', 'get-empty');
  assert.equal(empty.payload.code, 'CLIPBOARD_EMPTY');

  const inactiveHarness = createHarness(fixtureClipboard(), { pathname: '/cfb27/another-page' });
  inactiveHarness.dispatch(inactiveHarness.envelope('TC_UNLEASHED_GET_CLIPBOARD', {}, 'inactive'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(inactiveHarness.posted.length, 0);

  const studioHarness = createHarness(fixtureClipboard(), { pathname: '/team-builder-unleashed/cfb27' });
  studioHarness.dispatch(studioHarness.envelope('TC_UNLEASHED_HELLO', {
    supportedBridgeVersions: [1],
    payloadVersion: 1,
    catalogVersion: 'v1',
    route: '/team-builder-unleashed/cfb27',
  }));
  const studioReady = await studioHarness.waitFor('TC_UNLEASHED_READY');
  assert.equal(studioReady.payload.extensionVersion, '9.8.7');

  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const bridgeEntry = manifest.content_scripts.find((entry) => entry.js.includes('equipment-web-bridge.js'));
  assert.ok(bridgeEntry, 'manifest must register the equipment web bridge');
  assert.deepEqual(bridgeEntry.matches, [
    'https://www.teamcrafters.net/cfb27/team-builder-unleashed',
    'https://www.teamcrafters.net/cfb27/team-builder-unleashed/',
    'https://www.teamcrafters.net/team-builder-unleashed/cfb27',
    'https://www.teamcrafters.net/team-builder-unleashed/cfb27/',
    'http://localhost/cfb27/team-builder-unleashed',
    'http://localhost/cfb27/team-builder-unleashed/',
    'http://localhost:3000/team-builder-unleashed/cfb27',
    'http://localhost:3000/team-builder-unleashed/cfb27/',
    'http://localhost:3001/team-builder-unleashed/cfb27',
    'http://localhost:3001/team-builder-unleashed/cfb27/',
  ]);

  console.log('equipment web bridge tests passed');
}

await run();
