import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import options from "../remote-config.js";

const clone = value => structuredClone(value);
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function memoryStore() {
  const values = new Map();
  return { read: async key => clone(values.get(key)), write: async (key, value) => values.set(key, clone(value)) };
}
const nextConfig = () => ({ ...clone(options.DEFAULTS), revision: "test.2" });

test("only known data options and trusted CDN locations are accepted", () => {
  assert.deepEqual(options.validate(options.DEFAULTS), options.DEFAULTS);
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("../config/options-v1.json", import.meta.url))), options.DEFAULTS);
  const invalid = [
    v => { v.schemaVersion = 2; },
    v => { v.script = "alert(1)"; },
    v => { v.equipment.commands = []; },
    v => { v.revision = "<script>"; },
    v => { v.catalogs.mascotsUrl = "https://evil.test/mascots.json"; },
    v => { v.catalogs.stadiumsUrl += "?code=1"; },
    v => { v.catalogs.stadiumsUrl = "javascript:alert(1)"; },
    v => { v.equipment.catalogBaseUrl = "https://tc-cdn.trosclair.dev/other"; },
    ...[97, 112, 113, 129, -1, 255, 1.5, "150"].map(id => v => v.equipment.editableSlotIds.push(id)),
    v => { v.equipment.editableSlotIds.push(0); },
  ];
  for (const mutate of invalid) {
    const value = nextConfig(); mutate(value);
    assert.equal(options.validate(value), null, JSON.stringify(value));
  }
  const newSlot = nextConfig(); newSlot.equipment.editableSlotIds.push(150);
  assert.ok(options.validate(newSlot));
});

test("refreshes after five minutes and retains the last valid config offline", async () => {
  let time = 10000, calls = 0, fail = false;
  const store = memoryStore();
  const client = options.createClient({ store, now: () => time, fetcher: async (_, init) => {
    calls++; assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    if (fail) throw new Error("offline");
    return json(nextConfig());
  } });
  const values = await Promise.all([client.get(), client.get(), client.get()]);
  assert.equal(calls, 1); assert.equal(values[0].revision, "test.2");
  values[0].equipment.editableSlotIds.push(129);
  assert.ok(!(await client.get()).equipment.editableSlotIds.includes(129));
  fail = true; time += 300001;
  assert.equal((await client.get()).revision, "test.2");
  assert.equal(calls, 2);
  const restarted = options.createClient({ store, now: () => time, fetcher: async () => { throw new Error("offline"); } });
  assert.equal((await restarted.get()).revision, "test.2");
});

test("a fresh client preserves the original cache expiration", async () => {
  const store = memoryStore(); let time = 10000, calls = 0;
  const fetcher = async () => { calls++; return json(nextConfig()); };
  await options.createClient({ store, now: () => time, fetcher }).get();
  time += 299000;
  const restarted = options.createClient({ store, now: () => time, fetcher });
  await restarted.get(); assert.equal(calls, 1);
  time += 1001;
  await restarted.get(); assert.equal(calls, 2);
});

test("the packaged content-script client shares one singleton and uses Chrome storage", async () => {
  const stored = { tcRosterClipboard: { keep: true } };
  const window = {};
  const context = vm.createContext({ window, URL, TextEncoder, AbortController, setTimeout, clearTimeout,
    fetch: async () => json(nextConfig()), chrome: { storage: { local: {
      get: async key => ({ [key]: stored[key] }),
      set: async values => Object.assign(stored, clone(values)),
    } } } });
  const source = fs.readFileSync(new URL("../remote-config.js", import.meta.url), "utf8");
  vm.runInContext(source, context); const first = window.TBURemoteOptions;
  vm.runInContext(source, context); assert.equal(window.TBURemoteOptions, first);
  assert.equal((await first.get()).revision, "test.2");
  assert.equal(stored.tcRemoteOptionsV1.value.revision, "test.2");
  assert.deepEqual(stored.tcRosterClipboard, { keep: true });
});

test("malformed, oversized, or unavailable responses use bundled defaults", async () => {
  for (const fetcher of [
    async () => json({ ...nextConfig(), commands: [] }),
    async () => new Response("{"),
    async () => new Response(" ".repeat(16385)),
    async () => new Response("{}", { status: 503 }),
    async () => { throw new Error("offline"); },
  ]) {
    const client = options.createClient({ store: memoryStore(), fetcher });
    assert.deepEqual(await client.get(), options.DEFAULTS);
  }
});

test("bad cached config cannot bypass protected slots", async () => {
  const store = memoryStore(); const bad = nextConfig(); bad.equipment.editableSlotIds.push(129);
  await store.write("tcRemoteOptionsV1", { value: bad, fetchedAt: Date.now() });
  const client = options.createClient({ store, fetcher: async () => { throw new Error("offline"); } });
  assert.deepEqual(await client.get(), options.DEFAULTS);
});

test("catalog rows are validated, cached, and fall back to bundled resources", async () => {
  const rows = [{ TMAN: "TEST", TeamName: "Test", MascotName: "Tester" }];
  let offline = false, time = 10000;
  const client = options.createClient({ store: memoryStore(), now: () => time, fetcher: async url => {
    if (url === options.CONFIG_URL) return json(options.DEFAULTS);
    if (offline) throw new Error("offline");
    return json(rows);
  } });
  assert.deepEqual(await client.loadCatalog("mascots", "chrome-extension://test/mascots.json"), rows);
  offline = true; time += 300001;
  assert.deepEqual(await client.loadCatalog("mascots", "chrome-extension://test/mascots.json"), rows);
  const fallback = options.createClient({ store: memoryStore(), fetcher: async url => {
    if (url.startsWith("chrome-extension://")) return json(rows);
    return json({ invalid: true });
  } });
  assert.deepEqual(await fallback.loadCatalog("mascots", "chrome-extension://test/mascots.json"), rows);
  for (const kind of ["mascots", "stadiums"]) {
    const bundled = JSON.parse(fs.readFileSync(new URL(`../reference/${kind}.json`, import.meta.url)));
    assert.ok(options.validCatalog(kind, bundled), kind);
  }
});

test("equipment catalog switches remotely, filters slots, and falls back on a broken URL", async () => {
  const config = nextConfig(); config.equipment.catalogBaseUrl += "-test"; config.equipment.editableSlotIds.push(150);
  let broken = false;
  const client = options.createClient({ store: memoryStore(), fetcher: async url => {
    if (url === options.CONFIG_URL) return json(config);
    if (broken && url.includes("-test")) throw new Error("missing catalog");
    const base = url.replace(/\/manifest.json$/, "");
    return json({ schemaVersion: 1, catalogVersion: "v1", slots: [0, 150, 129, 112].map(slotId => ({ slotId, catalogUrl: `${base}/slots/${slotId}.json` })) });
  } });
  assert.deepEqual((await client.loadEquipmentManifest()).slots.map(s => s.slotId), [0, 150]);
  broken = true;
  assert.ok((await client.loadEquipmentManifest()).slots.every(s => s.catalogUrl.startsWith(options.DEFAULTS.equipment.catalogBaseUrl)));
});

test("every bridge loads the bundled config client first", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url)));
  assert.equal(manifest.host_permissions, undefined);
  for (const entry of manifest.content_scripts) {
    for (const bridge of ["studio-web-bridge.js", "equipment-web-bridge.js"]) {
      if (entry.js.includes(bridge)) assert.ok(entry.js.indexOf("remote-config.js") >= 0 && entry.js.indexOf("remote-config.js") < entry.js.indexOf(bridge));
    }
  }
});
