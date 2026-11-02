// Data-only options shared by the extension and TeamCrafters Studio.
// Remote values never contain functions, scripts, expressions, or save instructions.
(function (factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (!window.TBURemoteOptions) Object.defineProperty(window, "TBURemoteOptions", { value: api });
})(function () {
  "use strict";
  const CDN = "https://tc-cdn.trosclair.dev";
  const CONFIG_URL = `${CDN}/team-builder-assets/cfb27/config/options-v1.json`;
  const TTL = 5 * 60 * 1000;
  const PROTECTED_SLOTS = new Set([97, 112, 113, 129]);
  const DEFAULTS = {
    schemaVersion: 1,
    revision: "2026-11-01.1",
    equipment: {
      catalogBaseUrl: `${CDN}/team-builder-assets/cfb27/equipment/v2/2026-10-29`,
      editableSlotIds: [0, 2, 9, 10, 11, 12, 25, 26, 29, 30, 51, 54, 71, 72, 95, 96, 101,
        106, 107, 108, 109, 110, 111, 114, 115, 116, 117, 118, 120, 121, 122,
        124, 125, 127, 128, 135, 140, 142, 143],
    },
    catalogs: {
      mascotsUrl: `${CDN}/team-builder-assets/cfb27/catalogs/2026-11-01/mascots.json`,
      stadiumsUrl: `${CDN}/team-builder-assets/cfb27/catalogs/2026-11-01/stadiums.json`,
    },
  };
  function keys(value, expected) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
  }
  function validUrl(value, prefix, jsonFile) {
    if (typeof value !== "string" || value.length > 512 || !/^https:\/\/[a-z0-9./_-]+$/i.test(value)) return false;
    try {
      const url = new URL(value);
      return url.origin === CDN && url.pathname.startsWith(prefix) &&
        !url.pathname.includes("//") && (jsonFile ? url.pathname.endsWith(".json") : !url.pathname.endsWith("/"));
    } catch { return false; }
  }
  function validate(value) {
    if (!keys(value, ["schemaVersion", "revision", "equipment", "catalogs"]) || value.schemaVersion !== 1 ||
      typeof value.revision !== "string" || !/^[a-z0-9._-]{1,64}$/i.test(value.revision) ||
      !keys(value.equipment, ["catalogBaseUrl", "editableSlotIds"]) ||
      !keys(value.catalogs, ["mascotsUrl", "stadiumsUrl"]) ||
      !validUrl(value.equipment.catalogBaseUrl, "/team-builder-assets/cfb27/equipment/", false) ||
      !validUrl(value.catalogs.mascotsUrl, "/team-builder-assets/cfb27/catalogs/", true) ||
      !validUrl(value.catalogs.stadiumsUrl, "/team-builder-assets/cfb27/catalogs/", true)) return null;
    const ids = value.equipment.editableSlotIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 128 || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isInteger(id) || id < 0 || id > 254 || PROTECTED_SLOTS.has(id))) return null;
    return JSON.parse(JSON.stringify(value));
  }
  function storage() {
    return {
      async read(key) {
        if (typeof chrome !== "undefined" && chrome.storage?.local) return (await chrome.storage.local.get(key))[key];
        return JSON.parse(localStorage.getItem(key) || "null");
      },
      async write(key, value) {
        if (typeof chrome !== "undefined" && chrome.storage?.local) await chrome.storage.local.set({ [key]: value });
        else localStorage.setItem(key, JSON.stringify(value));
      },
    };
  }
  function validCatalog(kind, rows) {
    const text = v => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
    return Array.isArray(rows) && rows.length > 0 && rows.length <= 2000 && rows.every(row =>
      row && typeof row === "object" && (kind === "mascots"
        ? text(row.TMAN) && /^[a-z0-9_-]+$/i.test(row.TMAN) && text(row.TeamName) && text(row.MascotName)
        : Number.isInteger(row.id) && row.id >= 0 && row.id <= 100000000 && text(row.displayName)));
  }
  function createClient({ fetcher = (...args) => fetch(...args), store = storage(), now = Date.now } = {}) {
    const pending = new Map();
    const memory = new Map();
    async function fetchJson(url, maxBytes, { signal, immutable = false } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 2000);
      try {
        const response = await fetcher(url, { signal: controller.signal, credentials: "omit",
          redirect: "error", cache: immutable ? "force-cache" : "no-cache" });
        if (!response.ok || Number(response.headers?.get("content-length")) > maxBytes) throw new Error("Options could not load.");
        const raw = await response.text();
        if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("Options are too large.");
        return JSON.parse(raw);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
    async function cached(key, validator, load, fallback) {
      const current = memory.get(key);
      if (current && current.until > now()) return JSON.parse(JSON.stringify(current.value));
      if (!pending.has(key)) pending.set(key, (async () => {
        let previous;
        try {
          const saved = await store.read(key);
          if (saved && Number.isFinite(saved.fetchedAt) && saved.fetchedAt <= now() && validator(saved.value)) previous = saved;
        } catch { /* Storage can be unavailable; bundled defaults still work. */ }
        let value = previous?.value;
        let until = previous && now() - previous.fetchedAt < TTL ? previous.fetchedAt + TTL : now() + TTL;
        if (!previous || now() - previous.fetchedAt >= TTL) {
          try {
            const next = await load();
            if (!validator(next)) throw new Error("Invalid remote options.");
            value = next;
            try { await store.write(key, { value, fetchedAt: now() }); } catch { /* Cache is optional. */ }
          } catch { /* Retain the last valid response, then use the bundled fallback. */ }
        }
        if (value === undefined) value = await fallback();
        memory.set(key, { value, until });
        return value;
      })().finally(() => pending.delete(key)));
      return JSON.parse(JSON.stringify(await pending.get(key)));
    }
    async function get() {
      return cached("tcRemoteOptionsV1", validate, () => fetchJson(CONFIG_URL, 16384), () => DEFAULTS);
    }
    async function loadCatalog(kind, bundledUrl) {
      if (!["mascots", "stadiums"].includes(kind)) throw new Error("Unknown catalog.");
      const config = await get();
      const url = config.catalogs[`${kind}Url`];
      return cached(`tcRemoteCatalogV1:${url}`, value => validCatalog(kind, value),
        () => fetchJson(url, 2 * 1024 * 1024, { immutable: true }), async () => {
          const rows = await fetchJson(bundledUrl, 2 * 1024 * 1024, { immutable: true });
          if (!validCatalog(kind, rows)) throw new Error("Invalid bundled catalog.");
          return rows;
        });
    }
    async function loadEquipmentManifest({ signal } = {}) {
      const config = await get();
      async function load(base) {
        const value = await fetchJson(`${base}/manifest.json`, 128 * 1024, { signal, immutable: true });
        if (value?.schemaVersion !== 1 || value.catalogVersion !== "v1" || !Array.isArray(value.slots) ||
          !value.slots.length || value.slots.length > 255 || value.slots.some(slot =>
            !Number.isInteger(slot.slotId) || slot.catalogUrl !== `${base}/slots/${slot.slotId}.json`)) throw new Error("Invalid equipment catalog.");
        const allowed = new Set(config.equipment.editableSlotIds);
        return { ...value, slots: value.slots.filter(slot => allowed.has(slot.slotId)) };
      }
      try { return await load(config.equipment.catalogBaseUrl); }
      catch (error) {
        if (signal?.aborted || config.equipment.catalogBaseUrl === DEFAULTS.equipment.catalogBaseUrl) throw error;
        return load(DEFAULTS.equipment.catalogBaseUrl);
      }
    }
    return { get, loadCatalog, loadEquipmentManifest };
  }
  const client = createClient();
  return { CONFIG_URL, DEFAULTS, validate, validCatalog, createClient, ...client };
});
