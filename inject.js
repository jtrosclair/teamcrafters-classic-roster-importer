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
// It intercepts three GET responses:
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
//
// It ALSO intercepts one upload (see "uniform replacement" below) — the only place this extension
// changes what gets written to EA rather than what gets read from it.
(function () {
  // The Cupcake preset — its id becomes the loaded roster's templateId, and our bundled base
  // template IS Cupcake, so this is the id our roster is valid against.
  const CUPCAKE_PRESET_ID = 1238;

  // === EXPERIMENTAL: uniform replacement on save =========================================
  // Saving a team PUTs the whole team payload to a pre-signed S3 URL. We hold that request,
  // swap a uniform into the payload, and ask before letting it go.
  //
  // This is the one write path in the extension, so it is gated on an explicit confirmation
  // every time — nothing modified is ever uploaded without the user clicking the button. The
  // countdown below defaults to sending the payload UNCHANGED, never to applying our edit.
  //
  // First cut: a single hardcoded uniform replacing slot 0, to prove the path end to end.
  const UPLOAD_HOST = 'mcr-prod-268.s3.us-west-2.amazonaws.com';
  const UPLOAD_PATTERN = /nonce-primary\.json/;

  const TEST_UNIFORM = {
    displayName: 'CRAZY',
    currentOfficial: true,
    isCustom: false,
    uniform: {
      loadoutType: 6,
      loadoutCategory: 1,
      loadoutElements: [
        // School-specific assets resolve under plain "content/..."; only the generic shared items
        // (the shoes below) carry the "ContentShared/" root — matching how EA's own saved payload
        // splits them.
        {
          slotType: 93,
          itemAssetName: 'content/FootballCharacter/Items/Uniform/Helmet/U_LSU_HELMET_2021_GOLD',
          itemDisplayName: 'HOME HELMET',
        },
        {
          slotType: 98,
          itemAssetName: 'content/FootballCharacter/Items/Uniform/Jersey/U_ORE_JERSEY_2023_WHITE',
          itemDisplayName: 'HOME JERSEY',
        },
        {
          slotType: 97,
          itemAssetName: 'content/FootballCharacter/Items/Uniform/Pants/U_ORST_PANTS_2024_GRAY',
          itemDisplayName: 'HOME PANTS',
        },
        {
          slotType: 94,
          itemAssetName: 'content/FootballCharacter/Items/Uniform/Socks/U_ORST_SOCKS_2023_WHITE',
          itemDisplayName: 'HOME SOCKS',
        },
        {
          slotType: 95,
          itemAssetName: 'ContentShared/content/FootballCharacter/Items/Uniform/Shoes/U_GENERIC_SHOESX_WHIPRI',
          itemDisplayName: 'HOME SHOES',
        },
        {
          slotType: 96,
          itemAssetName: 'ContentShared/content/FootballCharacter/Items/Uniform/Shoes/U_GENERIC_SHOESX_WHIPRI',
          itemDisplayName: 'HOME SHOES',
        },
      ],
      displayOrder: 9999,
    },
  };

  // The signed upload URL expires, so we can't hold the save open forever waiting on a choice.
  const AUTO_CONTINUE_SECONDS = 20;

  function shouldInterceptUpload(url, method) {
    try {
      const u = new URL(url, location.href);
      return (
        String(method).toUpperCase() === 'PUT' &&
        u.hostname === UPLOAD_HOST &&
        UPLOAD_PATTERN.test(u.pathname)
      );
    } catch {
      return false;
    }
  }

  // --- body normalization: EA may hand us a string, Blob, ArrayBuffer, or a typed-array view,
  // and whatever we send back has to be the same kind of thing.
  async function bodyToText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof Blob) return await body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(body);
    if (ArrayBuffer.isView(body)) return new TextDecoder('utf-8').decode(body.buffer);
    if (body instanceof URLSearchParams) return body.toString();
    return String(body);
  }

  function textToOriginalType(text, original) {
    if (original instanceof ArrayBuffer) return new TextEncoder().encode(text).buffer;
    if (ArrayBuffer.isView(original)) return new TextEncoder().encode(text);
    if (original instanceof Blob) return new Blob([text], { type: original.type || 'application/json' });
    return text;
  }

  // Every real characterUniformItems entry carries this, across all four slot types.
  const SECONDARY_SLOT = 254;

  // In EA's own payload, slots 93/94/97/98 are always reached through a characterUniformItems
  // entry that binds the name to a team-authored part in uniformParts, while the shoes (95/96)
  // are referenced directly and have no entry at all — there is no shoes category in uniformParts
  // to bind to. Our replacements are prebuilt school assets, so they have no authorable part
  // either; we register them anyway, in case the loader resolves those slots by lookup and simply
  // fails on a name it can't find.
  //
  // partItem is left empty because there is genuinely nothing to point at — matching displayName,
  // which EA also leaves as "". If the save fails, this is the first thing to suspect: the shoes
  // prove a direct reference needs no entry, so dropping registerUniformItems entirely is the
  // other half of the experiment.
  function registerUniformItems(frostbiteData, uniform) {
    const items = frostbiteData.characterUniformItems;
    if (!items || typeof items !== 'object') return [];
    const added = [];
    for (const el of uniform.uniform.loadoutElements) {
      // Shared assets already work as direct references — don't touch what's proven.
      if (String(el.itemAssetName).startsWith('ContentShared/')) continue;
      if (items[el.itemAssetName]) continue;
      items[el.itemAssetName] = {
        assetName: el.itemAssetName,
        displayName: '',
        primarySlot: el.slotType,
        secondarySlot: SECONDARY_SLOT,
        partItem: '',
      };
      added.push(el.itemAssetName);
    }
    return added;
  }

  // Swap TEST_UNIFORM into uniforms[0]. Returns what was replaced so the modal can name it.
  // Throws with a readable message if the payload isn't shaped the way we expect, so a shifting
  // EA schema surfaces as "couldn't apply" rather than a silently corrupted upload.
  function applyUniform(payload) {
    const frostbiteData = payload && payload.teamData && payload.teamData.frostbiteData;
    const visuals = frostbiteData && frostbiteData.teamVisuals;
    if (!visuals) {
      throw new Error('Could not find teamData.frostbiteData.teamVisuals in this save.');
    }
    if (!Array.isArray(visuals.uniforms) || !visuals.uniforms.length) {
      throw new Error('This team has no uniforms array to replace.');
    }
    const previous = visuals.uniforms[0];
    const replacement = structuredClone(TEST_UNIFORM);
    visuals.uniforms[0] = replacement;
    // The team's own HOME entries stay in characterUniformItems even though uniforms[0] no longer
    // points at them. Leaving them is the conservative choice — they're inert, and the AWAY ones
    // are still live for uniforms[1].
    const registered = registerUniformItems(frostbiteData, replacement);
    return {
      previousName: (previous && previous.displayName) || 'uniform 1',
      uniformCount: visuals.uniforms.length,
      registered,
    };
  }

  // Ask before anything modified goes up. Resolves to the text to actually send — either our
  // edited payload or the original, untouched.
  function promptUniformSwap(originalText) {
    let modifiedText = null;
    let info = null;
    let error = null;
    try {
      const payload = JSON.parse(originalText);
      info = applyUniform(payload);
      modifiedText = JSON.stringify(payload);
    } catch (err) {
      error = err;
    }

    return new Promise((resolve) => {
      let settled = false;
      let remaining = AUTO_CONTINUE_SECONDS;
      let timerId = null;

      function settle(value) {
        if (settled) return;
        settled = true;
        clearInterval(timerId);
        try { overlay.remove(); } catch {}
        resolve(value);
      }

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;' +
        'align-items:center;justify-content:center;';

      const box = document.createElement('div');
      box.style.cssText =
        'background:#fff;padding:20px;border-radius:10px;width:440px;max-width:90vw;display:flex;' +
        'flex-direction:column;gap:14px;font-family:sans-serif;';

      const heading = document.createElement('div');
      heading.textContent = 'Replace a uniform before saving?';
      heading.style.cssText = 'font-weight:700;font-size:16px;color:#111;';

      const detail = document.createElement('div');
      detail.style.cssText = 'font-size:13px;color:#444;line-height:1.45;';
      if (error) {
        detail.textContent = `Couldn't apply the uniform: ${error.message} Your team will save exactly as it is now.`;
        detail.style.color = '#b00020';
      } else {
        detail.textContent =
          `This replaces your first uniform ("${info.previousName}") with the test uniform ` +
          `"${TEST_UNIFORM.displayName}", and registers ${info.registered.length} new uniform ` +
          `item(s). Your other ${info.uniformCount - 1} uniform(s), roster, logos, and stadium ` +
          `are untouched.`;
      }

      const countdownEl = document.createElement('div');
      countdownEl.style.cssText = 'font-size:12px;color:#888;';
      const renderCountdown = () => {
        countdownEl.textContent = `Saving unchanged in ${remaining}s if you don't choose…`;
      };
      renderCountdown();

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px;';

      const applyBtn = document.createElement('button');
      applyBtn.textContent = `Yes, use the "${TEST_UNIFORM.displayName}" uniform`;
      applyBtn.disabled = modifiedText === null;
      applyBtn.style.cssText =
        'padding:10px 12px;border-radius:6px;border:none;font-weight:600;font-size:13px;' +
        (applyBtn.disabled
          ? 'background:#c7c7c7;color:#fff;cursor:not-allowed;'
          : 'background:#1a73e8;color:#fff;cursor:pointer;');
      applyBtn.onclick = () => settle(modifiedText);

      const keepBtn = document.createElement('button');
      keepBtn.textContent = error ? 'Continue' : 'No, save my uniforms unchanged';
      keepBtn.style.cssText =
        'padding:10px 12px;border-radius:6px;border:1px solid #ccc;background:#fff;color:#333;' +
        'font-weight:600;font-size:13px;cursor:pointer;';
      keepBtn.onclick = () => settle(originalText);

      btnRow.append(applyBtn, keepBtn);
      box.append(heading, detail, btnRow, countdownEl);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // Default to the SAFE option — send what EA built, unmodified.
      timerId = setInterval(() => {
        if (--remaining <= 0) return settle(originalText);
        renderCountdown();
      }, 1000);
    });
  }
  // === end uniform replacement ===========================================================

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

    // Save upload — hold it, offer the swap, then send whatever the user chose.
    if (shouldInterceptUpload(url, method)) {
      const originalBody = init && init.body;
      const text = await bodyToText(originalBody);
      const chosen = await promptUniformSwap(text);
      return nativeFetch(input, { ...init, body: textToOriginalType(chosen, originalBody) });
    }

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

    // Save upload (this is the path EA actually uses). Hold the synchronous send, ask, then send
    // the chosen body. On any failure send the original untouched rather than dropping the save.
    if (info && shouldInterceptUpload(info.url, info.method)) {
      bodyToText(body)
        .then((text) => promptUniformSwap(text))
        .then((chosen) => origSend.call(xhr, textToOriginalType(chosen, body)))
        .catch((err) => {
          console.error('[TeamCrafters] uniform swap failed, saving unchanged:', err);
          origSend.call(xhr, body);
        });
      return;
    }

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
