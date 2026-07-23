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

  // === Uniform replacement on save =======================================================
  // Saving a team PUTs the whole team payload to a pre-signed S3 URL. When a uniform set is armed
  // (picked on the options page, stored by uniform-build.js) we hold that request, append the
  // armed set to the team's uniforms (see applyUniformSet for why we append rather than replace),
  // and ask before letting it go.
  //
  // This is the one write path in the extension, so it is gated on an explicit confirmation every
  // time — nothing modified is ever uploaded without the user clicking the button. The countdown
  // below defaults to sending the payload UNCHANGED, never to applying our edit. With nothing
  // armed the request isn't touched at all.
  const UPLOAD_HOST = 'mcr-prod-268.s3.us-west-2.amazonaws.com';
  const UPLOAD_PATTERN = /nonce-primary\.json/;

  // The initial nonce-primary GET is the team's persisted save. Clean it once per page load so a
  // newly armed import starts from the original team parts rather than accumulating prior imports.
  let initialNonceCleanupPending = true;

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

  function claimInitialNonceCleanup(url, method) {
    if (!initialNonceCleanupPending || String(method).toUpperCase() !== 'GET') return false;
    try {
      const u = new URL(url, location.href);
      if (!UPLOAD_PATTERN.test(u.pathname)) return false;
      initialNonceCleanupPending = false;
      return true;
    } catch {
      return false;
    }
  }

  // Imported editable parts deliberately have a readable display name; EA's original part
  // bindings have displayName == ''. Delete every named binding plus its linked part and every
  // uniform that points at one. Removing all three prevents stale, unresolved uniforms from
  // surviving into the next import. This is intentionally broad at the user's request: every
  // non-empty characterUniformItems displayName is treated as an inserted uniform part.
  function removeInsertedUniforms(payload) {
    const frostbiteData = payload && payload.teamData && payload.teamData.frostbiteData;
    const items = frostbiteData && frostbiteData.characterUniformItems;
    const parts = frostbiteData && frostbiteData.uniformParts;
    const visuals = frostbiteData && frostbiteData.teamVisuals;
    if (!items || typeof items !== 'object') return { items: 0, parts: 0, uniforms: 0 };

    const assetNames = new Set();
    const linkedParts = [];
    for (const [assetName, item] of Object.entries(items)) {
      if (!item || !String(item.displayName || '').trim()) continue;
      assetNames.add(assetName);
      const category = UNIFORM_PARTS_CATEGORY[item.primarySlot];
      if (category && item.partItem) linkedParts.push([category, item.partItem]);
      delete items[assetName];
    }

    let partCount = 0;
    for (const [category, partKey] of linkedParts) {
      const table = parts && parts[category];
      if (table && Object.prototype.hasOwnProperty.call(table, partKey)) {
        delete table[partKey];
        partCount++;
      }
    }

    let uniformCount = 0;
    if (assetNames.size && visuals && Array.isArray(visuals.uniforms)) {
      const before = visuals.uniforms.length;
      visuals.uniforms = visuals.uniforms.filter((uniform) => {
        const elements = uniform && uniform.uniform && uniform.uniform.loadoutElements;
        return !Array.isArray(elements) || !elements.some((el) => assetNames.has(el.itemAssetName));
      });
      uniformCount = before - visuals.uniforms.length;
    }

    return { items: assetNames.size, parts: partCount, uniforms: uniformCount };
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

  // In EA's own payload, exactly these four slots are reached through a characterUniformItems
  // entry binding the name to a team-authored part in uniformParts. The shoes (95/96) are always
  // referenced directly with no entry — there is no shoes category in uniformParts to bind to —
  // so we register the same four EA does and leave shoes alone.
  //
  // Registering shoes is not merely unnecessary, it's unrepresentable: the same shoe asset fills
  // both 95 and 96, and one entry cannot carry a correct primarySlot for two slots. EA's own data
  // sidesteps that by never registering them.
  const REGISTERED_SLOTS = new Set([93, 98, 97, 94]);

  // uniform slot -> uniformParts category / recipe key. Categories follow the save's plural
  // names; uniform.parts uses the singular key from uniform-build.js.
  const UNIFORM_PARTS_CATEGORY = { 93: 'helmets', 98: 'jerseys', 97: 'pants', 94: 'socks' };
  const PART_KIND_BY_SLOT = { 93: 'helmet', 98: 'jersey', 97: 'pants', 94: 'socks' };

  // The recipe decode zeroes some transforms (UV scale 0, clampUv 0, transformRange null). On a
  // base-fabric MATERIAL a zero UV scale maps the weave wrong — that's the gator-scale render. The
  // data isn't in the recipe to recover, but a material's UV transform is a property of the mesh,
  // not the color, so we restore it from a donor part of the same kind already in the save.
  //
  // Only broken material transforms are touched. Materials the decode got right keep theirs, and
  // OVERLAYS are left entirely alone: overlays are per-part decals (logos, patches) whose size and
  // placement are specific to that part, so a donor's overlay transform is the wrong size — copying
  // it is what made the pants patches wildly oversized. A recipe overlay with a missing transform just
  // renders as its own decode left it (a decal may be absent), which is far better than resized.
  function isBrokenTransform(t) {
    return !t || (t.scale && t.scale.u === 0 && t.scale.v === 0) || t.transformRange == null;
  }
  function restoreMaterialTransforms(target, donor) {
    const dm = donor && donor.layerCompTexture && donor.layerCompTexture.materials;
    const tm = target && target.materials;
    if (!Array.isArray(tm) || !Array.isArray(dm)) return;
    for (let i = 0; i < tm.length; i++) {
      if (tm[i] && isBrokenTransform(tm[i].transform) && dm[i] && dm[i].transform) {
        tm[i].transform = structuredClone(dm[i].transform);
      }
    }
  }

  // The decoded helmet recipe has its own shell/facemask/accessory and layer composition, but
  // does not include the save-only number and material-settings objects. Reuse those structural
  // settings from the team's original helmet; do not replace any visual recipe data.
  function restoreHelmetSettings(target, donor) {
    if (!target || !donor) return;
    for (const key of ['number', 'helmetMaterialSettings', 'facemaskMaterialSettings']) {
      if (target[key] === undefined && donor[key] !== undefined) {
        target[key] = structuredClone(donor[key]);
      }
    }
  }

  // Sock recipes carry their own layer composition and material preset, but the save also stores
  // these three part-level settings. They are structural rather than cosmetic, so retain the
  // values from the team's original socks when the decoded recipe omits them.
  function restoreSockSettings(target, donor) {
    if (!target || !donor) return;
    for (const key of ['outerSock', 'sockAdjust', 'underSockColor']) {
      if (target[key] === undefined && donor[key] !== undefined) {
        target[key] = structuredClone(donor[key]);
      }
    }
  }

  // Wire one appended uniform into the save. Two kinds of slot:
  //
  //  - A slot we have a part recipe for (uniform.parts[kind]) becomes an EDITABLE team part: we
  //    mint a team-local item name and part key from the save's own asset prefix, point the
  //    loadoutElement at it, add a characterUniformItems entry with secondarySlot == primarySlot
  //    (how EA marks a user-authored part, vs 254 for a stock one), and drop the recipe into
  //    uniformParts under that key. This is what makes the piece swappable in the editor.
  //
  //  - Any other bound slot keeps its prebuilt-asset reference and just gets a minimal
  //    characterUniformItems entry so the name resolves. Shared assets (shoes) already resolve
  //    directly and are left alone.
  //
  // `index` makes the minted names unique across the appended uniforms.
  function wireUniform(frostbiteData, visuals, uniform, index, donors) {
    const items = frostbiteData.characterUniformItems;
    const parts = frostbiteData.uniformParts;
    if (!items || typeof items !== 'object') return { registered: [], editable: [] };
    const prefix = visuals.assetName || visuals.prefixName || 'tcimport';
    const registered = [];
    const editable = [];

    for (const el of uniform.uniform.loadoutElements) {
      if (!REGISTERED_SLOTS.has(el.slotType)) continue;
      if (String(el.itemAssetName).startsWith('ContentShared/')) continue;

      const kind = PART_KIND_BY_SLOT[el.slotType];
      const recipe = kind && uniform.parts && uniform.parts[kind];
      const category = UNIFORM_PARTS_CATEGORY[el.slotType];

      if (recipe && category && parts && parts[category]) {
        // Editable team part. Label it from the recipe's own name so each piece is distinct in
        // the editor (they otherwise all show the generic slot name, e.g. "Pants"). Underscores
        // read poorly in-game, so space them out: "COLO_PANTS_2023_WHITE" -> "COLO PANTS 2023 WHITE".
        // Label from the recipe's own name so each piece is distinct in the editor (they
        // otherwise all read the generic slot name, e.g. "Pants"). Underscores read poorly
        // in-game: "COLO_PANTS_2023_WHITE" -> "COLO PANTS 2023 WHITE".
        const label = String(recipe.name || `${kind} ${index + 1}`).replace(/_/g, ' ');

        if (kind === 'helmet') restoreHelmetSettings(recipe, donors && donors[category]);
        if (kind === 'socks') restoreSockSettings(recipe, donors && donors[category]);

        // Restore the base-fabric material transforms the decode zeroed, from a working donor part
        // already in the save, so the fabric maps correctly (no gator scale). Overlays untouched.
        restoreMaterialTransforms(recipe.layerCompTexture, donors && donors[category]);

        const localName = `U_${prefix}_${kind.toUpperCase()}_imp${index}`;
        const partKey = `${prefix}-imp${index}-${kind}`;
        el.itemAssetName = localName;
        el.itemDisplayName = label;
        items[localName] = {
          assetName: localName,
          displayName: label,
          primarySlot: el.slotType,
          secondarySlot: el.slotType,
          partItem: partKey,
        };
        parts[category][partKey] = recipe;
        editable.push(localName);
      } else if (!items[el.itemAssetName]) {
        // Prebuilt-asset reference: just make the name resolve.
        items[el.itemAssetName] = {
          assetName: el.itemAssetName,
          displayName: '',
          primarySlot: el.slotType,
          secondarySlot: SECONDARY_SLOT,
          partItem: '',
        };
        registered.push(el.itemAssetName);
      }
    }
    // parts is our own metadata; it must not survive into the saved uniform.
    delete uniform.parts;
    return { registered, editable };
  }

  // Append the armed set to the team's uniforms rather than replacing them.
  //
  // Replacing the whole array outright breaks Team Builder's loader: the team's original uniforms
  // are the only ones whose parts resolve from the team's own game files, and with them gone the
  // site can't render the uniform screen. So we keep the first original uniform as an anchor,
  // rename it "UNUSED", demote it to an alternate slot, and append the imported school uniforms
  // after it. The kept anchor keeps the loader happy; the appended set is what the user picks.
  const ALTERNATE_LOADOUT_TYPE = 8; // loadoutType/displayOrder pair EA uses for a selectable extra
  const ALTERNATE_DISPLAY_ORDER = 0;

  function applyUniformSet(payload, armed) {
    const frostbiteData = payload && payload.teamData && payload.teamData.frostbiteData;
    const visuals = frostbiteData && frostbiteData.teamVisuals;
    if (!visuals) {
      throw new Error('Could not find teamData.frostbiteData.teamVisuals in this save.');
    }
    if (!Array.isArray(visuals.uniforms) || !visuals.uniforms.length) {
      throw new Error('This save has no uniforms to anchor the import to.');
    }
    if (!armed || !Array.isArray(armed.uniforms) || !armed.uniforms.length) {
      throw new Error('The saved uniform selection is empty — pick a team again.');
    }

    // Keep the first original uniform as the loadable anchor, marked UNUSED and demoted to an
    // alternate slot. Its own loadoutElements/characterUniformItems/uniformParts are untouched, so
    // it still resolves from the team's game files.
    const anchor = structuredClone(visuals.uniforms[0]);
    anchor.displayName = 'UNUSED';
    anchor.currentOfficial = false;
    if (anchor.uniform) {
      anchor.uniform.loadoutType = ALTERNATE_LOADOUT_TYPE;
      anchor.uniform.displayOrder = ALTERNATE_DISPLAY_ORDER;
    }

    const appended = structuredClone(armed.uniforms);
    visuals.uniforms = [anchor, ...appended];

    // A donor part per category, captured from the save's ORIGINAL uniformParts before we add any
    // of ours — used to restore material transforms the recipe decode dropped.
    const donors = {};
    for (const category of Object.values(UNIFORM_PARTS_CATEGORY)) {
      const table = frostbiteData.uniformParts && frostbiteData.uniformParts[category];
      const first = table && Object.values(table)[0];
      if (first) donors[category] = first;
    }

    // Wire only the appended uniforms; the anchor's parts already exist from the original save.
    // Existing entries are left in place — removing definitions is how the player-appearance
    // experiments broke the game.
    const registered = [];
    const editable = [];
    appended.forEach((u, i) => {
      const r = wireUniform(frostbiteData, visuals, u, i, donors);
      registered.push(...r.registered);
      editable.push(...r.editable);
    });

    return {
      appendedCount: appended.length,
      uniformCount: visuals.uniforms.length,
      registered,
      editable,
    };
  }

  // Ask before anything modified goes up. Resolves to the text to actually send — either our
  // edited payload or the original, untouched.
  function promptUniformSwap(originalText, armed) {
    let modifiedText = null;
    let info = null;
    let error = null;
    try {
      const payload = JSON.parse(originalText);
      info = applyUniformSet(payload, armed);
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
      heading.textContent = 'Add these uniforms before saving?';
      heading.style.cssText = 'font-weight:700;font-size:16px;color:#111;';

      const detail = document.createElement('div');
      detail.style.cssText = 'font-size:13px;color:#444;line-height:1.45;';
      if (error) {
        detail.textContent = `Couldn't apply the uniforms: ${error.message} Your team will save exactly as it is now.`;
        detail.style.color = '#b00020';
      } else {
        const editableNote = info.editable.length
          ? ` ${info.editable.length} part(s) are added as editable team pieces.` : '';
        detail.textContent =
          `This adds ${armed.teamName}'s ${info.appendedCount} uniforms to your team and keeps your ` +
          `first uniform as "UNUSED" (Team Builder needs one of your own to load the screen). ` +
          `Registers ${info.registered.length} new uniform item(s);${editableNote} your roster, ` +
          `logos, and stadium are untouched.`;
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
      applyBtn.textContent = `Yes, use ${armed.teamName}'s uniforms`;
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

  // The armed uniform set, picked on the options page. Same relay, separate key.
  function getArmedUniforms() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-uniform-clipboard-response', onResponse);
        resolve(e.detail);
      }
      window.addEventListener('tc-uniform-clipboard-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-uniform-clipboard-request'));
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

    // First load of the persisted team save: return a cleaned copy before Team Builder reads it.
    // If this response cannot be parsed, pass the original through and allow a later GET to retry.
    if (claimInitialNonceCleanup(url, method)) {
      const real = await nativeFetch(input, init);
      try {
        const payload = await real.clone().json();
        const removed = removeInsertedUniforms(payload);
        if (removed.items) console.info('[TeamCrafters] removed prior imported uniform parts:', removed);
        return jsonResponse(JSON.stringify(payload));
      } catch {
        initialNonceCleanupPending = true;
        return real;
      }
    }

    // Save upload — with a uniform set armed, hold it, offer the swap, then send what was chosen.
    // Nothing armed means the save is never touched.
    if (shouldInterceptUpload(url, method)) {
      const armed = await getArmedUniforms();
      if (armed && Array.isArray(armed.uniforms) && armed.uniforms.length) {
        const originalBody = init && init.body;
        const text = await bodyToText(originalBody);
        const chosen = await promptUniformSwap(text, armed);
        return nativeFetch(input, { ...init, body: textToOriginalType(chosen, originalBody) });
      }
      return nativeFetch(input, init);
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

    // Primary XHR path for the initial team save. Refetch and synthesize its cleaned JSON; on a
    // network/parse failure, send the original request untouched and retry cleanup on a later GET.
    if (info && claimInitialNonceCleanup(info.url, info.method)) {
      nativeFetch(info.url)
        .then((response) => response.json())
        .then((payload) => {
          const removed = removeInsertedUniforms(payload);
          if (removed.items) console.info('[TeamCrafters] removed prior imported uniform parts:', removed);
          synthesize(xhr, info.url, JSON.stringify(payload));
        })
        .catch(() => {
          initialNonceCleanupPending = true;
          origSend.call(xhr, body);
        });
      return;
    }

    // Save upload (this is the path EA actually uses). With a uniform set armed, hold the
    // synchronous send, ask, then send the chosen body. Nothing armed means the save goes through
    // untouched. On any failure send the original rather than dropping the save.
    if (info && shouldInterceptUpload(info.url, info.method)) {
      getArmedUniforms()
        .then((armed) => {
          if (!armed || !Array.isArray(armed.uniforms) || !armed.uniforms.length) {
            return origSend.call(xhr, body);
          }
          return bodyToText(body)
            .then((text) => promptUniformSwap(text, armed))
            .then((chosen) => origSend.call(xhr, textToOriginalType(chosen, body)));
        })
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
