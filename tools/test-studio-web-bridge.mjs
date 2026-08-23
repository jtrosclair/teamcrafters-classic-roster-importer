import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../studio-web-bridge.js", import.meta.url),
  "utf8",
);
const origin = "https://www.teamcrafters.net";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clipboard() {
  return {
    teamName: "Bridge Testers",
    playerCount: 2,
    rosterJson: JSON.stringify({
      100: {
        PLYR_HEIGHT: "72",
        PLYR_WEIGHT: "40",
        PLYR_HOME_TOWN: "Test City",
        PLYR_HOME_STATE: "0",
        PLYR_SKINTONE: "4",
      },
      101: {
        PLYR_HEIGHT: "72",
        PLYR_WEIGHT: "40",
        PLYR_HOME_TOWN: "Test City",
        PLYR_HOME_STATE: "0",
        PLYR_SKINTONE: "4",
      },
    }),
    visualsJson: JSON.stringify({
      100: {
        heightInches: 72,
        weightPounds: 200,
        skinTone: 4,
        loadouts: [
          {
            loadoutType: 1,
            loadoutCategory: 0,
            loadoutElements: [
              { slotType: 106, itemAssetName: "GearHelmet_Speed_Flex" },
            ],
          },
          {
            loadoutType: 0,
            loadoutCategory: 5,
            displayOrder: 9999,
            loadoutElements: [
              {
                slotType: 129,
                itemAssetName: "Standard_BodyType",
                itemDisplayName: "",
              },
              { slotType: 43, itemAssetName: "" },
            ],
          },
          {
            loadoutType: 4,
            loadoutCategory: 3,
            loadoutElements: [
              { slotType: 160, itemAssetName: "ProtectedAppearanceEntry" },
            ],
          },
        ],
      },
      101: {
        heightInches: 72,
        weightPounds: 200,
        skinTone: 4,
        loadouts: [
          {
            loadoutType: 1,
            loadoutCategory: 0,
            loadoutElements: [
              { slotType: 106, itemAssetName: "GearHelmet_Speed_Flex" },
            ],
          },
        ],
      },
    }),
  };
}

const uniformCatalog = {
  teams: {
    "Bridge University": {
      abbr: "BRDG",
      uniforms: [
        {
          displayName: "Home",
          loadoutType: 6,
          loadoutCategory: 1,
          currentOfficial: true,
          paths: {
            helmet: "content/helmet",
            jersey: "content/jersey",
            pants: "content/pants",
            socks: "content/socks",
            shoes: "content/shoes",
          },
        },
        {
          displayName: "Throwback",
          loadoutType: 6,
          loadoutCategory: 1,
          currentOfficial: false,
          paths: {
            helmet: "content/throwback-helmet",
            jersey: "content/throwback-jersey",
            pants: "content/throwback-pants",
            socks: "content/throwback-socks",
            shoes: "content/throwback-shoes",
          },
        },
      ],
    },
  },
};

function harness(initialClipboard) {
  let storage = { tcRosterClipboard: clone(initialClipboard) };
  let messageListener = null;
  let storageListener = null;
  const posted = [];
  const windowObject = {
    location: { origin, pathname: "/team-builder-unleashed/cfb27" },
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    postMessage(message, targetOrigin) {
      posted.push({ message: clone(message), targetOrigin });
    },
    TCUniformBuild: {
      normalizeCatalog(catalog) {
        return catalog;
      },
      buildUniformSet(teamName, team) {
        return {
          teamName,
          uniformCount: team.uniforms.length,
          uniforms: clone(team.uniforms),
        };
      },
    },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "9.8.7" }),
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            requested.flatMap((key) =>
              Object.hasOwn(storage, key) ? [[key, clone(storage[key])]] : [],
            ),
          );
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = {
              oldValue: clone(storage[key]),
              newValue: clone(value),
            };
            storage[key] = clone(value);
          }
          storageListener?.(changes, "local");
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete storage[key];
        },
      },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
  };
  vm.runInNewContext(
    source,
    {
      chrome,
      crypto: webcrypto,
      fetch: async (url) => {
        if (String(url).endsWith("uniform-catalog.json")) {
          return {
            ok: true,
            async text() {
              return JSON.stringify(uniformCatalog);
            },
          };
        }
        throw new Error(`Unexpected catalog request: ${url}`);
      },
      TextEncoder,
      Uint8Array,
      window: windowObject,
    },
    { filename: "studio-web-bridge.js" },
  );

  function dispatch(type, payload, requestId) {
    messageListener({
      source: windowObject,
      origin,
      data: {
        namespace: "teamcrafters.studio",
        bridgeVersion: 1,
        source: "teamcrafters-page",
        type,
        payload,
        requestId,
      },
    });
  }

  async function waitFor(type, requestId) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = posted.find(
        ({ message }) =>
          message.type === type &&
          (requestId === undefined || message.requestId === requestId),
      );
      if (found) return found.message;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${type}`);
  }

  return {
    dispatch,
    waitFor,
    get clipboard() {
      return clone(storage.tcRosterClipboard);
    },
    get uniformOverride() {
      return clone(storage.tcUniformClipboard);
    },
  };
}

const test = harness(clipboard());
test.dispatch("TC_STUDIO_HELLO", {}, "hello");
const ready = await test.waitFor("TC_STUDIO_READY");
assert.ok(
  ready.payload.capabilities.includes("player.appearance.bodyType.write"),
  "the studio advertises body-type appearance support",
);
assert.ok(
  ready.payload.capabilities.includes("uniforms.override"),
  "the studio advertises uniform override support",
);

test.dispatch("TC_STUDIO_GET_UNIFORM_OVERRIDE", {}, "uniform-read");
const uniforms = await test.waitFor("TC_STUDIO_UNIFORM_OVERRIDE", "uniform-read");
assert.equal(uniforms.payload.selection, null);
assert.equal(
  uniforms.payload.catalog,
  undefined,
  "the web catalog is loaded from R2 rather than the extension",
);

test.dispatch(
  "TC_STUDIO_SAVE_UNIFORM_OVERRIDE",
  {
    expectedRevision: uniforms.payload.revision,
    teamName: "Bridge University",
  },
  "uniform-save",
);
const savedUniforms = await test.waitFor(
  "TC_STUDIO_UNIFORM_OVERRIDE",
  "uniform-save",
);
assert.deepEqual(savedUniforms.payload.selection, {
  teamName: "Bridge University",
  uniformCount: 2,
});
assert.equal(test.uniformOverride.teamName, "Bridge University");

test.dispatch("TC_STUDIO_GET_WORKSPACE", {}, "workspace");
const workspace = await test.waitFor("TC_STUDIO_WORKSPACE", "workspace");
test.dispatch(
  "TC_STUDIO_SAVE_PLAYER_APPEARANCE",
  {
    expectedRevision: workspace.payload.revision,
    patch: {
      playerId: "100",
      heightInches: 72,
      weightLbs: 200,
      homeTown: "Test City",
      homeTownState: 0,
      skinTone: 4,
      bodyTypeAssetName: "Muscular_BodyType",
      faceScan: null,
    },
  },
  "appearance",
);
await test.waitFor("TC_STUDIO_WORKSPACE", "appearance");
const visuals = JSON.parse(test.clipboard.visualsJson);
const bodyLoadout = visuals["100"].loadouts.find(
  (loadout) => loadout.loadoutCategory === 5,
);
assert.equal(bodyLoadout.loadoutType, 0);
assert.equal(
  bodyLoadout.displayOrder,
  9999,
  "body loadout details stay intact",
);
assert.equal(bodyLoadout.loadoutElements[0].itemAssetName, "Muscular_BodyType");

test.dispatch("TC_STUDIO_GET_WORKSPACE", {}, "body-workspace");
const bodyWorkspace = await test.waitFor(
  "TC_STUDIO_WORKSPACE",
  "body-workspace",
);
test.dispatch(
  "TC_STUDIO_SAVE_PLAYER_APPEARANCE",
  {
    expectedRevision: bodyWorkspace.payload.revision,
    patch: {
      playerId: "101",
      heightInches: 72,
      weightLbs: 200,
      homeTown: "Test City",
      homeTownState: 0,
      skinTone: 4,
      bodyTypeAssetName: "Heavy_BodyType",
      faceScan: null,
    },
  },
  "new-body-loadout",
);
await test.waitFor("TC_STUDIO_WORKSPACE", "new-body-loadout");
const createdBodyLoadout = JSON.parse(test.clipboard.visualsJson)[
  "101"
].loadouts.find((loadout) => loadout.loadoutCategory === 5);
assert.deepEqual(createdBodyLoadout, {
  loadoutType: 0,
  loadoutCategory: 5,
  loadoutElements: [
    {
      slotType: 129,
      itemAssetName: "Heavy_BodyType",
      itemDisplayName: "",
    },
  ],
  displayOrder: 9999,
});

test.dispatch("TC_STUDIO_GET_WORKSPACE", {}, "workspace-2");
const equipmentWorkspace = await test.waitFor(
  "TC_STUDIO_WORKSPACE",
  "workspace-2",
);
const mismatchedCleats = clone(visuals["100"].loadouts);
const gearLoadout = mismatchedCleats.find(
  (loadout) => loadout.loadoutCategory === 0,
);
gearLoadout.loadoutElements[0].itemAssetName = "GearHelmet_Axiom";
gearLoadout.loadoutElements.push(
  { slotType: 10, itemAssetName: "GearFootwear_NikeAlphaMenacePro3" },
  { slotType: 11, itemAssetName: "GearFootwear_NikeVaporEdgePro3602" },
);
test.dispatch(
  "TC_STUDIO_SAVE_PLAYER_EQUIPMENT",
  {
    expectedRevision: equipmentWorkspace.payload.revision,
    patch: { playerId: "100", loadouts: mismatchedCleats },
  },
  "cleats",
);
await test.waitFor("TC_STUDIO_WORKSPACE", "cleats");
const visualsWithCleats = JSON.parse(test.clipboard.visualsJson);
const matchingGearLoadout = visualsWithCleats["100"].loadouts.find(
  (loadout) => loadout.loadoutCategory === 0,
);
const leftCleat = matchingGearLoadout.loadoutElements.find(
  (element) => element.slotType === 10,
);
const rightCleat = matchingGearLoadout.loadoutElements.find(
  (element) => element.slotType === 11,
);
assert.equal(leftCleat.itemAssetName, rightCleat.itemAssetName);
assert.equal(leftCleat.itemAssetName, "GearFootwear_NikeAlphaMenacePro3");
assert.equal(
  matchingGearLoadout.loadoutElements.find(
    (element) => element.slotType === 106,
  ).itemAssetName,
  "GearHelmet_Axiom",
  "equipment saves preserve body entries that are not gear choices",
);

test.dispatch("TC_STUDIO_GET_WORKSPACE", {}, "workspace-3");
const current = await test.waitFor("TC_STUDIO_WORKSPACE", "workspace-3");
const attemptedEquipment = clone(visualsWithCleats["100"].loadouts);
attemptedEquipment[1].loadoutElements[0].itemAssetName = "Thin_BodyType";
test.dispatch(
  "TC_STUDIO_SAVE_PLAYER_EQUIPMENT",
  {
    expectedRevision: current.payload.revision,
    patch: { playerId: "100", loadouts: attemptedEquipment },
  },
  "equipment",
);
const rejected = await test.waitFor("TC_STUDIO_ERROR", "equipment");
assert.equal(rejected.payload.code, "INVALID_PAYLOAD");
assert.match(rejected.payload.message, /Appearance, not Equipment/);

const productionPayload = JSON.parse(
  fs.readFileSync(new URL("../test-5-uniforms.json", import.meta.url), "utf8"),
);
const productionVisuals =
  productionPayload.teamData.frostbiteData.characterVisuals;
const productionPlayerId = Object.keys(productionVisuals).find(
  (id) =>
    productionVisuals[id].loadouts?.some((loadout) =>
      loadout.loadoutElements?.some((element) => element.slotType === 106),
    ) &&
    productionVisuals[id].loadouts?.some((loadout) =>
      loadout.loadoutElements?.some(
        (element) =>
          element.slotType === 43 && element.itemAssetName === undefined,
      ),
    ),
);
assert.ok(
  productionPlayerId,
  "the CFB 27 payload includes a helmet and protected body entries",
);
const production = harness({
  teamName: "Production-shaped roster",
  playerCount: 1,
  rosterJson: JSON.stringify({ [productionPlayerId]: {} }),
  visualsJson: JSON.stringify({
    [productionPlayerId]: productionVisuals[productionPlayerId],
  }),
});
production.dispatch("TC_STUDIO_GET_WORKSPACE", {}, "production-workspace");
const productionWorkspace = await production.waitFor(
  "TC_STUDIO_WORKSPACE",
  "production-workspace",
);
const productionLoadouts = clone(
  productionVisuals[productionPlayerId].loadouts,
);
const productionGear = productionLoadouts.find(
  (loadout) => loadout.loadoutCategory === 0,
);
productionGear.loadoutElements.find(
  (element) => element.slotType === 106,
).itemAssetName = "GearHelmet_Axiom";
production.dispatch(
  "TC_STUDIO_SAVE_PLAYER_EQUIPMENT",
  {
    expectedRevision: productionWorkspace.payload.revision,
    patch: { playerId: productionPlayerId, loadouts: productionLoadouts },
  },
  "production-helmet",
);
await production.waitFor("TC_STUDIO_WORKSPACE", "production-helmet");
assert.equal(
  JSON.parse(production.clipboard.visualsJson)
    [productionPlayerId].loadouts.find(
      (loadout) => loadout.loadoutCategory === 0,
    )
    .loadoutElements.find((element) => element.slotType === 106).itemAssetName,
  "GearHelmet_Axiom",
  "helmet saves work with protected CFB 27 body entries",
);

console.log("studio web bridge player appearance and cleat tests passed");
