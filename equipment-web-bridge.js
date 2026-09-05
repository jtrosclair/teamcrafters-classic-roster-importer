// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// equipment-web-bridge.js — ISOLATED world, exact Team Builder Unleashed editor route only.
// Relays a deliberately small, versioned window.postMessage protocol between the trusted
// TeamCrafters page and chrome.storage.local.tcRosterClipboard. The page can read a whitelisted
// snapshot and replace only visualsJson + equipmentEditedAt with revision-safe writes.
(function () {
  'use strict';

  const STORAGE_KEY = 'tcRosterClipboard';
  const NAMESPACE = 'teamcrafters.cfb27.equipment';
  const BRIDGE_VERSION = 1;
  const PAYLOAD_VERSION = 1;
  const CATALOG_VERSIONS = ['v1'];
  const PAGE_SOURCE = 'teamcrafters-page';
  const EXTENSION_SOURCE = 'teamcrafters-extension';
  const EDITOR_PATHS = new Set([
    '/cfb27/team-builder-unleashed',
    '/team-builder-unleashed/cfb27',
  ]);
  const ALLOWED_ORIGINS = new Set([
    'https://www.teamcrafters.net',
    'http://localhost:3000',
    'http://localhost:3001',
  ]);
  const PAGE_MESSAGE_TYPES = new Set([
    'TC_UNLEASHED_HELLO',
    'TC_UNLEASHED_GET_CLIPBOARD',
    'TC_UNLEASHED_PUT_CLIPBOARD',
  ]);
  const CAPABILITIES = [
    'clipboard.read',
    'clipboard.write.visuals',
    'clipboard.revision',
    'clipboard.subscribe',
  ];

  // The current roster pair is well under 1 MiB minified. Leave headroom for future visual fields
  // while preventing a trusted-page regression from exhausting extension storage or memory.
  const MAX_ROSTER_JSON_BYTES = 5 * 1024 * 1024;
  const MAX_VISUALS_JSON_BYTES = 5 * 1024 * 1024;
  const MAX_PLAYER_COUNT = 100;
  const MAX_ASSET_NAME_LENGTH = 512;
  const MAX_REQUEST_ID_LENGTH = 128;

  // Slots exposed by the v1 web editor. Hidden calf placeholders 112/113 and body type are deliberately absent.
  const EDITABLE_SLOT_IDS = new Set([
    0, 2, 9, 10, 11, 12, 25, 26, 29, 30, 51, 54, 71, 72, 95, 96, 101,
    106, 107, 108, 109, 110, 111, 114, 115, 116, 117, 118, 120, 121, 122,
    124, 125, 127, 128, 135, 140, 142, 143,
  ]);

  const suppressedChangeRevisions = new Set();
  const textEncoder = new TextEncoder();

  class BridgeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'BridgeError';
      this.code = code;
    }
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOnlyKeys(record, allowed) {
    const keys = Object.keys(record).sort();
    return keys.length === allowed.length && keys.every((key, index) => key === allowed[index]);
  }

  function isAllowedLocation() {
    return ALLOWED_ORIGINS.has(window.location.origin) &&
      [...EDITOR_PATHS].some((path) => window.location.pathname === path || window.location.pathname === `${path}/`);
  }

  // Defense in depth for client-side navigation: a content script injected at the editor route
  // becomes inert immediately if the Next.js app navigates elsewhere without a document reload.
  if (!isAllowedLocation()) return;

  function post(type, payload, requestId) {
    if (!isAllowedLocation()) return;
    const envelope = {
      namespace: NAMESPACE,
      bridgeVersion: BRIDGE_VERSION,
      source: EXTENSION_SOURCE,
      type,
      payload,
    };
    if (requestId) envelope.requestId = requestId;
    window.postMessage(envelope, window.location.origin);
  }

  function postError(code, message, requestId) {
    post('TC_UNLEASHED_ERROR', { code, message }, requestId);
  }

  function byteLength(value) {
    return textEncoder.encode(value).byteLength;
  }

  function assertStringSize(value, maxBytes, label) {
    if (typeof value !== 'string') {
      throw new BridgeError('INVALID_PAYLOAD', `${label} must be a JSON string.`);
    }
    if (byteLength(value) > maxBytes) {
      throw new BridgeError('PAYLOAD_TOO_LARGE', `${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB bridge limit.`);
    }
  }

  function parsePlayerMap(value, label, maxBytes) {
    assertStringSize(value, maxBytes, label);
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BridgeError('INVALID_PAYLOAD', `${label} is not valid JSON.`);
    }
    if (!isRecord(parsed)) {
      throw new BridgeError('INVALID_PAYLOAD', `${label} must be a player map object.`);
    }
    const ids = Object.keys(parsed);
    if (!ids.length || ids.length > MAX_PLAYER_COUNT) {
      throw new BridgeError('INVALID_PAYLOAD', `${label} must contain between 1 and ${MAX_PLAYER_COUNT} player records.`);
    }
    for (const id of ids) {
      if (!/^\d+$/.test(id) || !isRecord(parsed[id])) {
        throw new BridgeError('INVALID_PAYLOAD', `${label} contains an invalid player record.`);
      }
    }
    return parsed;
  }

  function assertSamePlayerIds(roster, currentVisuals, nextVisuals) {
    const rosterIds = Object.keys(roster).sort();
    const currentIds = Object.keys(currentVisuals).sort();
    const nextIds = Object.keys(nextVisuals).sort();
    const same = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
    if (!same(rosterIds, currentIds) || !same(currentIds, nextIds)) {
      throw new BridgeError(
        'PLAYER_ID_MISMATCH',
        'Character visuals must contain exactly the same player IDs as the current roster.',
      );
    }
  }

  function assertValidAssetName(value, label) {
    if (typeof value !== 'string' || !value || value.length > MAX_ASSET_NAME_LENGTH) {
      throw new BridgeError('INVALID_PAYLOAD', `${label} has an invalid itemAssetName.`);
    }
  }

  function assertAssetNameField(value, label) {
    if (typeof value !== 'string' || value.length > MAX_ASSET_NAME_LENGTH) {
      throw new BridgeError('INVALID_PAYLOAD', `${label} has an invalid itemAssetName field.`);
    }
  }

  function assertVisualMapShape(visuals, label) {
    for (const [playerId, visual] of Object.entries(visuals)) {
      if (visual.loadouts === undefined) continue;
      if (!Array.isArray(visual.loadouts)) {
        throw new BridgeError('INVALID_PAYLOAD', `${label} player ${playerId} has invalid loadouts.`);
      }
      for (const loadout of visual.loadouts) {
        if (!isRecord(loadout)) {
          throw new BridgeError('INVALID_PAYLOAD', `${label} player ${playerId} has an invalid loadout record.`);
        }
        if (loadout.loadoutCategory !== undefined && !Number.isInteger(Number(loadout.loadoutCategory))) {
          throw new BridgeError('INVALID_PAYLOAD', `${label} player ${playerId} has an invalid loadout category.`);
        }
        if (loadout.loadoutElements === undefined) continue;
        if (!Array.isArray(loadout.loadoutElements)) {
          throw new BridgeError('INVALID_PAYLOAD', `${label} player ${playerId} has invalid loadout elements.`);
        }
        for (const element of loadout.loadoutElements) {
          if (!isRecord(element) || !Number.isInteger(Number(element.slotType))) {
            throw new BridgeError('INVALID_PAYLOAD', `${label} player ${playerId} has an invalid equipment element.`);
          }
          if (element.itemAssetName !== undefined) {
            assertAssetNameField(element.itemAssetName, `${label} player ${playerId}`);
          }
        }
      }
    }
  }

  function deepEqual(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((value, index) => deepEqual(value, right[index]));
    }
    if (isRecord(left) || isRecord(right)) {
      if (!isRecord(left) || !isRecord(right)) return false;
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      return leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
    }
    return false;
  }

  function withoutKey(record, omittedKey) {
    const copy = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== omittedKey) copy[key] = value;
    }
    return copy;
  }

  function expectedCategoryForSlot(slotId) {
    return 0;
  }

  function assertEditableSlot(slotId, category, label) {
    if (!EDITABLE_SLOT_IDS.has(slotId) || expectedCategoryForSlot(slotId) !== category) {
      throw new BridgeError('INVALID_PAYLOAD', `${label} attempted to change a hidden or incompatible equipment slot.`);
    }
  }

  function assertExistingLoadoutPreserved(current, next, playerId) {
    if (!isRecord(next) || !deepEqual(withoutKey(current, 'loadoutElements'), withoutKey(next, 'loadoutElements'))) {
      throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} changed non-equipment loadout fields.`);
    }
    const category = Number(current.loadoutCategory);
    const currentElements = Array.isArray(current.loadoutElements) ? current.loadoutElements : [];
    const nextElements = Array.isArray(next.loadoutElements) ? next.loadoutElements : [];
    const seenSlots = new Set();
    const currentSlots = new Set();
    let nextIndex = 0;
    for (const before of currentElements) {
      if (!isRecord(before)) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} has an invalid existing equipment element.`);
      }
      const slotId = Number(before.slotType);
      currentSlots.add(slotId);
      const after = nextElements[nextIndex];

      // Stock Team Builder represents absent equipment and disabled render overrides by
      // omitting their elements. Permit that only for slots this editor exposes.
      if (!isRecord(after) || Number(after.slotType) !== slotId) {
        assertEditableSlot(slotId, category, `Player ${playerId}`);
        continue;
      }
      if (!deepEqual(withoutKey(before, 'itemAssetName'), withoutKey(after, 'itemAssetName'))) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} changed protected equipment element fields.`);
      }
      seenSlots.add(slotId);
      if (before.itemAssetName !== after.itemAssetName) {
        assertEditableSlot(slotId, category, `Player ${playerId}`);
        assertValidAssetName(after.itemAssetName, `Player ${playerId} slot ${slotId}`);
      }
      nextIndex += 1;
    }

    for (const element of nextElements.slice(nextIndex)) {
      if (!isRecord(element) || !hasOnlyKeys(element, ['itemAssetName', 'slotType'])) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added an equipment element with unsupported fields.`);
      }
      const slotId = Number(element.slotType);
      if (seenSlots.has(slotId) || currentSlots.has(slotId)) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added a duplicate equipment slot.`);
      }
      assertEditableSlot(slotId, category, `Player ${playerId}`);
      assertValidAssetName(element.itemAssetName, `Player ${playerId} slot ${slotId}`);
      seenSlots.add(slotId);
    }
  }

  function assertNewLoadoutValid(loadout, existingCategories, playerId) {
    if (!isRecord(loadout) || !hasOnlyKeys(loadout, ['loadoutCategory', 'loadoutElements', 'loadoutType'])) {
      throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added an invalid loadout.`);
    }
    const category = Number(loadout.loadoutCategory);
    const expectedType = category === 5 ? 0 : 1;
    if ((category !== 0 && category !== 5) || Number(loadout.loadoutType) !== expectedType ||
        existingCategories.has(category) || !Array.isArray(loadout.loadoutElements) || !loadout.loadoutElements.length) {
      throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added an incompatible loadout.`);
    }
    const seenSlots = new Set();
    for (const element of loadout.loadoutElements) {
      if (!isRecord(element) || !hasOnlyKeys(element, ['itemAssetName', 'slotType'])) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added an invalid equipment element.`);
      }
      const slotId = Number(element.slotType);
      if (seenSlots.has(slotId)) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} added a duplicate equipment slot.`);
      }
      assertEditableSlot(slotId, category, `Player ${playerId}`);
      assertValidAssetName(element.itemAssetName, `Player ${playerId} slot ${slotId}`);
      seenSlots.add(slotId);
    }
    existingCategories.add(category);
  }

  // Enforce the contract's visual-preservation rule at the storage boundary. This turns a page
  // bug into a rejected save instead of silently changing player identity or appearance metadata.
  function assertOnlyEquipmentChanged(currentVisuals, nextVisuals) {
    for (const playerId of Object.keys(currentVisuals)) {
      const current = currentVisuals[playerId];
      const next = nextVisuals[playerId];
      if (!deepEqual(withoutKey(current, 'loadouts'), withoutKey(next, 'loadouts'))) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} changed protected character visual fields.`);
      }
      const currentLoadouts = Array.isArray(current.loadouts) ? current.loadouts : [];
      const nextLoadouts = Array.isArray(next.loadouts) ? next.loadouts : [];
      if (nextLoadouts.length < currentLoadouts.length) {
        throw new BridgeError('INVALID_PAYLOAD', `Player ${playerId} removed existing loadouts.`);
      }
      for (let index = 0; index < currentLoadouts.length; index++) {
        assertExistingLoadoutPreserved(currentLoadouts[index], nextLoadouts[index], playerId);
      }
      const categories = new Set(currentLoadouts.map((loadout) => Number(loadout.loadoutCategory)));
      for (const loadout of nextLoadouts.slice(currentLoadouts.length)) {
        assertNewLoadoutValid(loadout, categories, playerId);
      }
    }
  }

  function protectedClipboardState(clipboard) {
    const stringOrNull = (value) => typeof value === 'string' ? value : null;
    return {
      rosterJson: stringOrNull(clipboard?.rosterJson),
      visualsJson: stringOrNull(clipboard?.visualsJson),
      teamName: stringOrNull(clipboard?.teamName),
      copiedAt: stringOrNull(clipboard?.copiedAt),
      equipmentEditedAt: stringOrNull(clipboard?.equipmentEditedAt),
    };
  }

  async function revisionFor(clipboard) {
    const bytes = textEncoder.encode(JSON.stringify(protectedClipboardState(clipboard)));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }

  function publicClipboard(clipboard) {
    const snapshot = {
      rosterJson: clipboard.rosterJson,
      visualsJson: clipboard.visualsJson,
    };
    for (const field of ['teamName', 'copiedAt', 'equipmentEditedAt']) {
      if (typeof clipboard[field] === 'string') snapshot[field] = clipboard[field];
    }
    return snapshot;
  }

  function assertCurrentClipboard(clipboard) {
    if (!isRecord(clipboard) || typeof clipboard.rosterJson !== 'string' || typeof clipboard.visualsJson !== 'string') {
      throw new BridgeError('CLIPBOARD_EMPTY', 'Copy or import a roster in the extension first.');
    }
    const roster = parsePlayerMap(clipboard.rosterJson, 'Roster data', MAX_ROSTER_JSON_BYTES);
    const visuals = parsePlayerMap(clipboard.visualsJson, 'Character visuals', MAX_VISUALS_JSON_BYTES);
    assertVisualMapShape(visuals, 'Character visuals');
    assertSamePlayerIds(roster, visuals, visuals);
    return { roster, visuals };
  }

  async function snapshotFor(clipboard) {
    assertCurrentClipboard(clipboard);
    return {
      revision: await revisionFor(clipboard),
      clipboard: publicClipboard(clipboard),
    };
  }

  async function readStoredClipboard() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY];
  }

  function assertRequestId(message) {
    if (typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > MAX_REQUEST_ID_LENGTH) {
      throw new BridgeError('INVALID_PAYLOAD', 'Bridge requests require a valid request ID.');
    }
  }

  function assertHelloPayload(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.supportedBridgeVersions) ||
        !payload.supportedBridgeVersions.includes(BRIDGE_VERSION) || payload.payloadVersion !== PAYLOAD_VERSION ||
        payload.catalogVersion !== 'v1' || payload.route !== window.location.pathname) {
      throw new BridgeError('UNSUPPORTED_VERSION', 'The page and extension do not support the same equipment bridge version.');
    }
  }

  function assertPutPayload(payload) {
    if (!isRecord(payload) || !hasOnlyKeys(payload, ['expectedRevision', 'patch']) ||
        typeof payload.expectedRevision !== 'string' || !payload.expectedRevision || !isRecord(payload.patch) ||
        !hasOnlyKeys(payload.patch, ['equipmentEditedAt', 'visualsJson'])) {
      throw new BridgeError('INVALID_PAYLOAD', 'The clipboard update has an invalid shape.');
    }
    assertStringSize(payload.patch.visualsJson, MAX_VISUALS_JSON_BYTES, 'Character visuals');
    if (typeof payload.patch.equipmentEditedAt !== 'string' || payload.patch.equipmentEditedAt.length > 64) {
      throw new BridgeError('INVALID_PAYLOAD', 'equipmentEditedAt must be an ISO timestamp.');
    }
    try {
      if (new Date(payload.patch.equipmentEditedAt).toISOString() !== payload.patch.equipmentEditedAt) throw new Error();
    } catch {
      throw new BridgeError('INVALID_PAYLOAD', 'equipmentEditedAt must be an ISO timestamp.');
    }
  }

  async function handleGet(message) {
    assertRequestId(message);
    const clipboard = await readStoredClipboard();
    post('TC_UNLEASHED_CLIPBOARD', await snapshotFor(clipboard), message.requestId);
  }

  async function handlePut(message) {
    assertRequestId(message);
    assertPutPayload(message.payload);

    // Re-read immediately before validation/write. Never merge against the earlier GET snapshot.
    const current = await readStoredClipboard();
    const { roster, visuals: currentVisuals } = assertCurrentClipboard(current);
    const currentRevision = await revisionFor(current);
    if (currentRevision !== message.payload.expectedRevision) {
      throw new BridgeError(
        'REVISION_CONFLICT',
        'The extension clipboard changed after this editor loaded. Reload it before saving.',
      );
    }

    const nextVisuals = parsePlayerMap(
      message.payload.patch.visualsJson,
      'Character visuals',
      MAX_VISUALS_JSON_BYTES,
    );
    assertVisualMapShape(nextVisuals, 'Character visuals');
    assertSamePlayerIds(roster, currentVisuals, nextVisuals);
    assertOnlyEquipmentChanged(currentVisuals, nextVisuals);

    const next = {
      ...current,
      visualsJson: message.payload.patch.visualsJson,
      equipmentEditedAt: message.payload.patch.equipmentEditedAt,
    };
    const nextRevision = await revisionFor(next);
    suppressedChangeRevisions.add(nextRevision);
    window.setTimeout(() => suppressedChangeRevisions.delete(nextRevision), 5000);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
    } catch (error) {
      suppressedChangeRevisions.delete(nextRevision);
      throw error;
    }
    post('TC_UNLEASHED_WRITE_RESULT', await snapshotFor(next), message.requestId);
  }

  async function handlePageMessage(event) {
    if (!isAllowedLocation() || event.source !== window || event.origin !== window.location.origin || !isRecord(event.data)) return;
    const message = event.data;
    if (message.namespace !== NAMESPACE || message.source !== PAGE_SOURCE || typeof message.type !== 'string') return;
    if (message.bridgeVersion !== BRIDGE_VERSION) {
      postError('UNSUPPORTED_VERSION', 'This extension supports equipment bridge v1.', message.requestId);
      return;
    }
    if (!PAGE_MESSAGE_TYPES.has(message.type)) return;

    try {
      if (message.type === 'TC_UNLEASHED_HELLO') {
        assertHelloPayload(message.payload);
        post('TC_UNLEASHED_READY', {
          extensionVersion: chrome.runtime.getManifest().version,
          payloadVersion: PAYLOAD_VERSION,
          catalogVersions: CATALOG_VERSIONS,
          capabilities: CAPABILITIES,
        });
      } else if (message.type === 'TC_UNLEASHED_GET_CLIPBOARD') {
        await handleGet(message);
      } else if (message.type === 'TC_UNLEASHED_PUT_CLIPBOARD') {
        await handlePut(message);
      }
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : 'STORAGE_ERROR';
      const messageText = error instanceof BridgeError
        ? error.message
        : 'The extension could not access its local roster clipboard.';
      postError(code, messageText, message.requestId);
    }
  }

  window.addEventListener('message', handlePageMessage);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!isAllowedLocation() || areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const change = changes[STORAGE_KEY];
    Promise.all([revisionFor(change.oldValue), revisionFor(change.newValue)])
      .then(([oldRevision, newRevision]) => {
        if (oldRevision === newRevision) return;
        if (suppressedChangeRevisions.delete(newRevision)) return;
        post('TC_UNLEASHED_CLIPBOARD_CHANGED', { revision: newRevision });
      })
      .catch(() => {
        // A revision notification is advisory; read/write requests still perform full validation.
      });
  });
})();
