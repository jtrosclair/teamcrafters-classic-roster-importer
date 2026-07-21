// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// inject.js — MAIN world, ea.com. Makes a copied TeamCrafters roster show up in EA College
// Football Team Builder as an "Import from TeamCrafters" preset, then feeds EA's own preset
// loader our roster + visuals when it's selected. EA's loader does the actual roster replacement,
// so we never touch its internal state.
//
// It intercepts exactly three GET responses:
//   1. template_rosters.json  — the preset list. While a roster is armed we REPLACE the Cupcake
//      preset entry (keeping its real id) with our "Import from TeamCrafters" one. Reusing the
//      Cupcake preset's id is important: EA copies the chosen preset's id into the loaded roster's
//      templateId, and only a real template id (1238 = Cupcake) is valid — a made-up id crashes
//      the game. Our merged roster is built on the Cupcake template, so 1238 is the correct id.
//   2. our sentinel -roster.json            — we answer with the merged roster.json.
//   3. our sentinel -character_visuals.json — we answer with the merged character_visuals.json.
// The sentinel URLs are fake EA-CDN-looking URLs (carrying a "_teamcrafters.json" marker) that
// only exist in our injected preset, so we answer them locally instead of hitting the network.
//
// The roster/visuals data itself is built at copy time on teamcrafters.net and lives in
// chrome.storage.local; ea-bridge.js (ISOLATED world) relays it here, since MAIN world has no
// chrome.* APIs.
(function () {
  // The Cupcake preset — its id becomes the loaded roster's templateId, and our bundled base
  // template IS Cupcake, so this is the id our roster is valid against.
  const CUPCAKE_PRESET_ID = 1238;

  // --- get the stored preset payload from ea-bridge.js via a CustomEvent round trip ---
  function getStored() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-roster-clipboard-response', onResponse);
        resolve(e.detail);
      }
      window.addEventListener('tc-roster-clipboard-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-roster-clipboard-request'));
    });
  }

  // classify a URL: which of our interception points (if any) it is
  function classify(url) {
    if (!url) return null;
    if (url.includes('template_rosters')) return 'template';
    if (url.includes('plyr-gen-names')) return 'namepool';
    if (url.includes('_teamcrafters.json')) {
      if (url.includes('-character_visuals.json')) return 'visuals';
      if (url.includes('-roster.json')) return 'roster';
    }
    return null;
  }

  // Replace the Cupcake preset in the list with our import, in place, keeping its id so the loaded
  // roster gets a valid templateId. Returns the (possibly modified) list. Falls back to matching
  // by display name if the id ever changes; if neither is found, appends as a last resort.
  function applyPreset(list, stored) {
    if (!Array.isArray(list)) return list;
    const idx = list.findIndex(
      (p) => p && (p.id === CUPCAKE_PRESET_ID || String(p.displayName).toLowerCase() === 'cupcake')
    );
    const entry = {
      id: idx >= 0 ? list[idx].id : CUPCAKE_PRESET_ID,
      displayName: stored.displayName,
      assetName: stored.rosterUrl,
      characterVisualsAssetName: stored.visualsUrl,
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    return list;
  }

  function jsonResponse(bodyString) {
    return new Response(bodyString, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
  }

  const nativeFetch = window.fetch.bind(window);

  // --- fetch() path (defensive; the app uses XHR, but this covers any fetch-based request) ---
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
    const kind = String(method).toUpperCase() === 'GET' ? classify(url) : null;
    if (!kind) return nativeFetch(input, init);

    const stored = await getStored();
    const armed = !!(stored && stored.rosterUrl);

    if (kind === 'template') {
      // Fetch the real preset list and swap our import in for Cupcake. On any failure, fall back
      // to the real response so we never break the presets UI.
      const real = await nativeFetch(input, init);
      try {
        const list = await real.clone().json();
        if (Array.isArray(list) && armed) {
          applyPreset(list, stored);
          return jsonResponse(JSON.stringify(list));
        }
      } catch { /* fall through */ }
      return real;
    }

    // Name pool: EA regenerates player names from this on load. While a roster is armed, hand
    // back an empty pool so our imported names aren't overwritten. Only while armed, so normal
    // EA name generation is untouched otherwise.
    if (kind === 'namepool') return armed ? jsonResponse('{}') : nativeFetch(input, init);

    // sentinel roster/visuals — answer locally (these URLs don't really exist)
    const body = kind === 'roster' ? stored && stored.rosterJson : stored && stored.visualsJson;
    return body != null ? jsonResponse(body) : nativeFetch(input, init);
  };

  // --- XMLHttpRequest path (primary — this is what EA's asset loads use) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._tcInfo = { method: method || 'GET', url: String(url) };
    return origOpen.call(this, method, url, ...rest);
  };

  function define(xhr, prop, getter) {
    Object.defineProperty(xhr, prop, { configurable: true, get: getter });
  }

  // Make the XHR instance report a synthetic successful JSON response, then fire the events
  // Angular's XHR backend listens for. Getters are defined on the instance, shadowing the native
  // prototype accessors.
  function synthesize(xhr, url, bodyString) {
    define(xhr, 'readyState', () => 4);
    define(xhr, 'status', () => 200);
    define(xhr, 'statusText', () => 'OK');
    define(xhr, 'responseURL', () => url);
    define(xhr, 'responseText', () => bodyString);
    define(xhr, 'response', () => (xhr.responseType === 'json' ? JSON.parse(bodyString) : bodyString));
    xhr.getAllResponseHeaders = () => 'content-type: application/json\r\n';
    xhr.getResponseHeader = (name) =>
      String(name).toLowerCase() === 'content-type' ? 'application/json' : null;

    // dispatch asynchronously, matching normal XHR timing
    setTimeout(() => {
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch {}
      try { xhr.dispatchEvent(new ProgressEvent('load')); } catch {}
      try { xhr.dispatchEvent(new ProgressEvent('loadend')); } catch {}
    }, 0);
  }

  function synthesizeError(xhr, url) {
    define(xhr, 'readyState', () => 4);
    define(xhr, 'status', () => 404);
    define(xhr, 'statusText', () => 'Not Found');
    define(xhr, 'responseURL', () => url);
    setTimeout(() => {
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch {}
      try { xhr.dispatchEvent(new ProgressEvent('error')); } catch {}
      try { xhr.dispatchEvent(new ProgressEvent('loadend')); } catch {}
    }, 0);
  }

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;
    const info = xhr._tcInfo;
    const kind = info && String(info.method).toUpperCase() === 'GET' ? classify(info.url) : null;
    if (!kind) return origSend.call(xhr, body);

    getStored()
      .then((stored) => {
        const armed = !!(stored && stored.rosterUrl);
        if (kind === 'template') {
          // Refetch the real list, swap our import in for Cupcake, answer synthetically. If the
          // refetch fails, fall back to the real request so the presets UI still works.
          return nativeFetch(info.url)
            .then((r) => r.json())
            .then((list) => {
              if (Array.isArray(list) && armed) applyPreset(list, stored);
              synthesize(xhr, info.url, JSON.stringify(list));
            })
            .catch(() => origSend.call(xhr, body));
        }
        if (kind === 'namepool') {
          // Empty the name pool while armed so EA can't regenerate over our imported names.
          if (armed) synthesize(xhr, info.url, '{}');
          else origSend.call(xhr, body);
          return;
        }
        const bodyString = kind === 'roster' ? stored && stored.rosterJson : stored && stored.visualsJson;
        if (bodyString != null) synthesize(xhr, info.url, bodyString);
        else synthesizeError(xhr, info.url); // sentinel requested with nothing stored
      })
      .catch((err) => {
        console.error('[TeamCrafters] intercept failed for', info.url, err);
        if (kind === 'template') origSend.call(xhr, body);
        else synthesizeError(xhr, info.url);
      });
    // hold the native send; we complete the request synthetically once the body is ready
  };
})();
