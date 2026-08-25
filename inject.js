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
// The roster/visuals data itself is built at copy time on teamcrafters.net (or copied from an EA
// Team Builder preview) and lives in chrome.storage.local; ea-bridge.js (ISOLATED world) relays
// it here, since MAIN world has no chrome.* APIs.
//
// It ALSO intercepts one upload (see "uniform replacement" below) — the only place this extension
// changes what gets written to EA rather than what gets read from it.
(function () {
  // The Cupcake preset — its id becomes the loaded roster's templateId, and our bundled base
  // template IS Cupcake, so this is the id our roster is valid against.
  const CUPCAKE_PRESET_ID = 1238;

  // === Advanced uniform-placement range extension =========================================
  // The uniform editor renders its placement controls inside this Angular component. Four of
  // those native ranges have a max of 2 (with min values of 1 or .01); changing their DOM max is
  // enough for the component's normal input binding to emit values through 3. Angular can replace
  // or re-bind the inputs while editing, so keep the patch scoped to this component and reapply it
  // whenever its subtree changes.
  const ADVANCED_PLACEMENT_SELECTOR = 'app-advanced-placement-api';
  const ADVANCED_PLACEMENT_RANGE_MAX = '3';

  function isExtendedPlacementRange(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'range') return false;
    if (!input.closest(ADVANCED_PLACEMENT_SELECTOR)) return false;

    const min = Number(input.min);
    const max = Number(input.max);
    return max === 2 && (min === 1 || min === 0.01);
  }

  function extendAdvancedPlacementRange(input) {
    if (!isExtendedPlacementRange(input)) return false;
    input.max = ADVANCED_PLACEMENT_RANGE_MAX;
    return true;
  }

  function extendAdvancedPlacementRanges(root = document) {
    if (!(root instanceof Document || root instanceof Element || root instanceof DocumentFragment)) {
      return;
    }

    if (root instanceof HTMLInputElement) extendAdvancedPlacementRange(root);
    root.querySelectorAll?.(`${ADVANCED_PLACEMENT_SELECTOR} input[type="range"]`).forEach(
      extendAdvancedPlacementRange
    );
  }

  function observeAdvancedPlacementRanges() {
    extendAdvancedPlacementRanges();

    // Capture phase makes sure a freshly re-bound range is fixed before the editor processes its
    // input/change event. This stays limited to the placement component.
    document.addEventListener(
      'input',
      (event) => extendAdvancedPlacementRange(event.target),
      true
    );
    document.addEventListener(
      'change',
      (event) => extendAdvancedPlacementRange(event.target),
      true
    );

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          extendAdvancedPlacementRange(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) extendAdvancedPlacementRanges(node);
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['min', 'max', 'type'],
    });
  }

  observeAdvancedPlacementRanges();

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

  const TEAM_BUILDER_PREVIEW_PATH = /^\/games\/ea-sports-college-football\/team-builder\/preview\/[^/]+\/?$/;
  const PREVIEW_COPY_CONTROL = 'data-teamcrafters-preview-copy';
  const PREVIEW_CSV_REQUEST = 'tc-team-builder-preview-csv-request';
  const PREVIEW_CSV_PAYLOAD = 'tc-team-builder-preview-csv-payload';
  let previewRosterCapture = null;

  // The initial nonce-primary GET is the team's persisted save. Clean it once per page load so a
  // newly armed import starts from the original team parts rather than accumulating prior imports.
  let initialNonceCleanupPending = true;

  const AUTO_CONTINUE_SECONDS = 20;

  const configuredUniformLimit = window.TeamCraftersUniformConfig?.maxUniforms;
  const MAX_UNIFORMS =
    Number.isInteger(configuredUniformLimit) && configuredUniformLimit > 0
      ? configuredUniformLimit
      : 10;

  const UNIFORM_CREATE_BUTTON_SELECTOR =
    'app-uniforms-selection button[aria-label="Create new team"]';
  const TEAMCRAFTERS_CREATE_TILE = 'data-teamcrafters-create-uniform';
  const TEAMCRAFTERS_CREATE_DIALOG = 'data-teamcrafters-create-uniform-dialog';
  const TEAMCRAFTERS_UNIFORM_SCROLL_STYLE = 'teamcrafters-uniform-scroll-style';
  const UNIFORM_ROW_SELECTOR =
    'app-uniforms-selection .canvas-container > div.flex.w-100.justify-center';
  const uniformSelectionCandidates = [];

  function trackUniformSelectionCandidate(candidate) {
    if (candidate && !uniformSelectionCandidates.includes(candidate)) {
      uniformSelectionCandidates.push(candidate);
    }
  }

  function captureComponentField(field) {
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, field);
    if (inherited && !inherited.set?.__teamcraftersUniformComponentCapture) return;

    const get = inherited?.get;
    const set = inherited?.set;
    const capture = function (value) {
      trackUniformSelectionCandidate(this);
      if (set) {
        set.call(this, value);
        return;
      }
      Object.defineProperty(this, field, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    };
    Object.defineProperty(capture, '__teamcraftersUniformComponentCapture', { value: true });
    Object.defineProperty(Object.prototype, field, {
      configurable: true,
      enumerable: inherited?.enumerable ?? false,
      get,
      set: capture,
    });
  }

  try {
    captureComponentField('teamBuilderService');
    captureComponentField('isBottomPopup');
  } catch {
    // The regular captured native listener remains available on browsers that prevent this hook.
  }

  try {
    const nativeDefineProperty = Object.defineProperty;
    if (!nativeDefineProperty.__teamcraftersUniformComponentCapture) {
      const wrappedDefineProperty = function (target, property, descriptor) {
        if (property === 'teamBuilderService' && descriptor && 'value' in descriptor) {
          trackUniformSelectionCandidate(target);
        }
        return nativeDefineProperty.call(Object, target, property, descriptor);
      };
      Object.defineProperty(wrappedDefineProperty, '__teamcraftersUniformComponentCapture', {
        value: true,
      });
      Object.defineProperty = wrappedDefineProperty;
    }
  } catch {
    // The assignment capture above covers the normal Angular output.
  }

  function getUniformSelectionComponent() {
    for (let index = uniformSelectionCandidates.length - 1; index >= 0; index--) {
      const component = uniformSelectionCandidates[index];
      if (
        component &&
        component.teamBuilderService &&
        component.route &&
        component.router &&
        component.popupService &&
        component.dataStoreService &&
        Array.isArray(component.uniforms) &&
        Array.isArray(component.duplicateLoadOutOptions) &&
        typeof component.createClicked === 'function'
      ) {
        return component;
      }
    }
    return null;
  }

  function getUniformCount(component = getUniformSelectionComponent()) {
    const uniformDataService =
      component?.teamBuilderService?.teamBuilderService?.getTeamUniformDataService?.();
    const loadOutOptions = uniformDataService?.getLoadOutOptions?.();
    if (Array.isArray(loadOutOptions)) return loadOutOptions.length;
    if (Array.isArray(component?.uniforms)) return component.uniforms.length;
    return document.querySelectorAll(
      'app-uniforms-selection .uniform-item:not([data-teamcrafters-create-uniform])'
    ).length;
  }

  function ensureUniformListScrollStyles() {
    if (document.getElementById(TEAMCRAFTERS_UNIFORM_SCROLL_STYLE)) return;
    const style = document.createElement('style');
    style.id = TEAMCRAFTERS_UNIFORM_SCROLL_STYLE;
    style.textContent = `
      ${UNIFORM_ROW_SELECTOR} {
        justify-content: flex-start !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding-bottom: 14px !important;
      }
      ${UNIFORM_ROW_SELECTOR} > .uniform-item {
        flex: 0 0 auto !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function requestFallbackUniformCreate() {
    if (document.querySelector(`[${TEAMCRAFTERS_CREATE_DIALOG}]`)) return;
    if (getUniformCount() >= MAX_UNIFORMS) return;

    const overlay = document.createElement('div');
    overlay.setAttribute(TEAMCRAFTERS_CREATE_DIALOG, '');
    overlay.setAttribute('role', 'presentation');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
      background: 'rgba(0, 0, 0, 0.72)',
    });

    const dialog = document.createElement('form');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'teamcrafters-uniform-title');
    Object.assign(dialog.style, {
      width: 'min(100%, 430px)',
      padding: '28px',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderRadius: '6px',
      color: '#fff',
      background: '#1c1c1c',
      boxShadow: '0 24px 72px rgba(0, 0, 0, 0.55)',
      fontFamily: 'inherit',
    });
    const title = document.createElement('h2');
    title.id = 'teamcrafters-uniform-title';
    title.textContent = 'Name your new uniform';
    Object.assign(title.style, { margin: '0 0 10px', fontSize: '24px', lineHeight: '1.2' });
    const detail = document.createElement('p');
    detail.textContent = 'You can change its parts in EA’s uniform editor next.';
    Object.assign(detail.style, { margin: '0 0 20px', color: '#c7c7c7', lineHeight: '1.45' });
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'uniformName';
    input.maxLength = 30;
    input.required = true;
    input.autocomplete = 'off';
    input.placeholder = 'Uniform name';
    input.setAttribute('aria-label', 'Uniform name');
    Object.assign(input.style, {
      boxSizing: 'border-box',
      width: '100%',
      minHeight: '46px',
      padding: '10px 12px',
      border: '1px solid #777',
      borderRadius: '3px',
      color: '#fff',
      background: '#303030',
      font: 'inherit',
    });
    const error = document.createElement('div');
    error.setAttribute('role', 'alert');
    Object.assign(error.style, {
      minHeight: '20px',
      marginTop: '7px',
      color: '#ff8f8f',
      fontSize: '13px',
    });
    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      marginTop: '24px',
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    Object.assign(cancel.style, {
      minHeight: '40px',
      padding: '0 17px',
      border: '0',
      color: '#fff',
      background: 'transparent',
      font: 'inherit',
      cursor: 'pointer',
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Create uniform';
    Object.assign(submit.style, {
      minHeight: '40px',
      padding: '0 17px',
      border: '0',
      borderRadius: '3px',
      color: '#111',
      background: '#ffde00',
      font: '600 14px inherit',
      cursor: 'pointer',
    });

    cancel.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        error.textContent = 'Enter a name for the uniform.';
        input.focus();
        return;
      }
      const component = getUniformSelectionComponent();
      const uniformDataService =
        component?.teamBuilderService?.teamBuilderService?.getTeamUniformDataService?.();
      if (!component || !uniformDataService || typeof uniformDataService.createLoadout !== 'function') {
        error.textContent = 'Team Builder is still loading. Close this dialog, wait a moment, and try again.';
        return;
      }
      try {
        const beforeCount = uniformDataService.getLoadOutOptions?.().length ?? component.uniforms.length;
        if (beforeCount >= MAX_UNIFORMS) {
          error.textContent = `This extension is limited to ${MAX_UNIFORMS} uniforms.`;
          return;
        }
        const accepted = uniformDataService.createLoadout(name, 'Blank');
        const afterCount = uniformDataService.getLoadOutOptions?.().length ?? beforeCount;
        if (accepted === false || afterCount <= beforeCount) {
          throw new Error('Team Builder rejected the new uniform.');
        }
        if (typeof component.getUniforms === 'function') {
          component.getUniforms();
        } else {
          component.uniforms = uniformDataService.getLoadOutOptions?.() ?? component.uniforms;
        }
        overlay.remove();
        queueUnlimitedUniformCreateSync();
      } catch {
        error.textContent = 'Team Builder could not create that uniform. Please refresh and try again.';
      }
    });
    actions.append(cancel, submit);
    dialog.append(title, detail, input, error, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    queueMicrotask(() => input.focus());
  }

  function makeUniformCreateTile() {
    const tile = document.createElement('div');
    tile.className = 'uniform-item w-100 lg-row-gap-6 row-gap-4 flex flex-col justify-center align-center';
    tile.setAttribute(TEAMCRAFTERS_CREATE_TILE, '');

    const media = document.createElement('div');
    media.className = 'uniform-media flex flex-col justify-center align-center relative';
    const image = document.createElement('img');
    image.src = 'assets/images/PlayerModelBlank.png';
    image.alt = 'new uniform';
    image.className = 'media-img aspect-auto';
    const createMark = document.createElement('div');
    createMark.className = 'uniform-create relative';
    media.append(image, createMark);

    const actions = document.createElement('div');
    actions.className = 'flex justify-center align-center';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button relative';
    button.setAttribute('aria-label', 'Create new uniform');
    const icon = document.createElement('span');
    icon.className = 'eaicon eaiconadd c-text-4';
    button.appendChild(icon);
    button.addEventListener('click', requestFallbackUniformCreate);
    actions.appendChild(button);
    tile.append(media, actions);
    return tile;
  }

  function syncUnlimitedUniformCreateControl() {
    ensureUniformListScrollStyles();
    const nativeButton = document.querySelector(UNIFORM_CREATE_BUTTON_SELECTOR);
    const replacement = document.querySelector(`[${TEAMCRAFTERS_CREATE_TILE}]`);
    const nativeTile = nativeButton?.closest('.uniform-item');

    if (getUniformCount() >= MAX_UNIFORMS) {
      replacement?.remove();
      nativeTile?.style.setProperty('display', 'none', 'important');
      return;
    }
    nativeTile?.style.removeProperty('display');
    if (nativeButton) {
      replacement?.remove();
      return;
    }
    if (replacement) return;

    const uniformList = document.querySelector(UNIFORM_ROW_SELECTOR);
    if (!uniformList) return;
    uniformList.insertBefore(makeUniformCreateTile(), uniformList.firstChild);
  }

  let uniformCreateSyncQueued = false;
  function queueUnlimitedUniformCreateSync() {
    if (uniformCreateSyncQueued) return;
    uniformCreateSyncQueued = true;
    queueMicrotask(() => {
      uniformCreateSyncQueued = false;
      syncUnlimitedUniformCreateControl();
    });
  }

  new MutationObserver(queueUnlimitedUniformCreateSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  queueUnlimitedUniformCreateSync();

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

  function isTeamBuilderPreview() {
    return TEAM_BUILDER_PREVIEW_PATH.test(location.pathname);
  }

  function objectRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function extractPreviewRoster(payload) {
    const root = objectRecord(payload);
    const teamData = objectRecord(root?.teamData) || root;
    const rosterContainer =
      objectRecord(teamData?.roster) || objectRecord(teamData?.rosterData) ||
      objectRecord(root?.roster) || objectRecord(root?.rosterData);
    const rosterData =
      objectRecord(rosterContainer?.playerData) || objectRecord(rosterContainer?.rosterData) ||
      objectRecord(teamData?.playerData) || objectRecord(teamData?.rosterData) ||
      objectRecord(root?.rosterData) || objectRecord(root?.playerData);
    const characterVisuals =
      objectRecord(teamData?.frostbiteData?.characterVisuals) ||
      objectRecord(teamData?.characterVisuals) || objectRecord(root?.characterVisuals);
    if (!rosterData || !characterVisuals) return null;

    const rosterIds = Object.keys(rosterData);
    const visualIds = Object.keys(characterVisuals);
    if (!rosterIds.length || rosterIds.length !== visualIds.length) return null;
    if (rosterIds.some((id) => !Object.hasOwn(characterVisuals, id))) return null;

    const teamInfo = objectRecord(teamData?.teamInfos) || {};
    const teamName = [teamInfo.TEAM_NAME, teamInfo.TEAM_NICKNAME].filter(Boolean).join(' ').trim();
    return {
      teamName: teamName || 'Team Builder team',
      sourceUrl: location.href,
      playerCount: rosterIds.length,
      rosterJson: JSON.stringify(rosterData),
      visualsJson: JSON.stringify(characterVisuals),
    };
  }

  function previewCopyControl() {
    return document.querySelector(`[${PREVIEW_COPY_CONTROL}]`);
  }

  function requestPreviewAction(button, detail, request, resultEvent, pendingText, successText) {
    button.disabled = true;
    button.style.opacity = '0.65';
    detail.textContent = pendingText;
    const onResult = (event) => {
      window.removeEventListener(resultEvent, onResult);
      const result = event.detail || {};
      if (result.ok) {
        detail.textContent = successText(result);
        return;
      }
      detail.textContent = result.error || 'Could not copy this roster. Reload the preview and try again.';
      button.disabled = false;
      button.style.opacity = '1';
    };
    window.addEventListener(resultEvent, onResult);
    window.dispatchEvent(new CustomEvent(request));
  }

  function renderPreviewCopyControl() {
    const existing = previewCopyControl();
    if (!isTeamBuilderPreview()) {
      existing?.remove();
      return;
    }
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', renderPreviewCopyControl, { once: true });
      return;
    }
    if (existing) {
      updatePreviewCopyControl(existing);
      return;
    }

    const control = document.createElement('div');
    control.setAttribute(PREVIEW_COPY_CONTROL, '');
    Object.assign(control.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', width: 'min(340px, calc(100vw - 32px))',
      padding: '12px', border: '1px solid #d7dbe0', borderRadius: '8px', background: '#fff',
      color: '#1b1f24', boxShadow: '0 4px 16px rgba(0, 0, 0, .28)', fontFamily: 'system-ui, sans-serif',
    });
    const detail = document.createElement('div');
    Object.assign(detail.style, { marginBottom: '9px', fontSize: '12px', lineHeight: '1.4' });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy roster for Team Builder';
    Object.assign(button.style, {
      width: '100%', padding: '9px 12px', border: '0', borderRadius: '5px', background: '#1a73e8',
      color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
    });
    button.addEventListener('click', () => requestPreviewAction(
      button, detail, 'tc-team-builder-preview-copy-request', 'tc-team-builder-preview-copy-result', 'Copying roster…',
      (result) => {
        button.textContent = 'Copied';
        return `Copied ${result.playerCount} players. Open a team and choose the TeamCrafters preset.`;
      }
    ));
    const csvButton = document.createElement('button');
    csvButton.type = 'button';
    csvButton.textContent = 'Download CSV';
    Object.assign(csvButton.style, {
      width: '100%', marginTop: '8px', padding: '9px 12px', border: '1px solid #1a73e8', borderRadius: '5px',
      background: '#fff', color: '#1a73e8', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
    });
    csvButton.addEventListener('click', () => requestPreviewAction(
      csvButton, detail, PREVIEW_CSV_REQUEST, 'tc-team-builder-preview-csv-result', 'Preparing CSV…',
      (result) => `Downloaded ${result.playerCount}-player CSV. You can edit and import it from the extension.`
    ));
    control._teamcraftersPreview = { detail, button, csvButton };
    control.append(detail, button, csvButton);
    document.body.appendChild(control);
    updatePreviewCopyControl(control);
  }

  function updatePreviewCopyControl(control = previewCopyControl()) {
    const ui = control?._teamcraftersPreview;
    if (!ui) return;
    const ready = Boolean(previewRosterCapture);
    ui.detail.textContent = ready ? `${previewRosterCapture.playerCount} players ready to copy` : 'Reading roster data…';
    for (const button of [ui.button, ui.csvButton]) {
      button.disabled = !ready;
      button.style.opacity = ready ? '1' : '0.55';
      button.style.cursor = ready ? 'pointer' : 'wait';
    }
  }

  function capturePreviewRoster(payload) {
    const capture = extractPreviewRoster(payload);
    if (!capture) return;
    previewRosterCapture = capture;
    renderPreviewCopyControl();
  }

  function syncPreviewCopyControlSoon() {
    queueMicrotask(renderPreviewCopyControl);
  }

  for (const method of ['pushState', 'replaceState']) {
    const native = history[method];
    if (typeof native !== 'function' || native.__teamcraftersPreviewRouteSync) continue;
    const wrapped = function (...args) {
      const result = native.apply(this, args);
      syncPreviewCopyControlSoon();
      return result;
    };
    Object.defineProperty(wrapped, '__teamcraftersPreviewRouteSync', { value: true });
    history[method] = wrapped;
  }
  window.addEventListener('popstate', syncPreviewCopyControlSoon);
  window.addEventListener('hashchange', syncPreviewCopyControlSoon);
  syncPreviewCopyControlSoon();

  window.addEventListener('tc-team-builder-preview-copy-request', () => {
    const detail = isTeamBuilderPreview() && previewRosterCapture
      ? { ok: true, capture: { ...previewRosterCapture, sourceUrl: location.href } }
      : { ok: false, error: 'Roster data is still loading. Reload the preview and wait a moment.' };
    window.dispatchEvent(new CustomEvent('tc-team-builder-preview-copy-payload', { detail }));
  });

  window.addEventListener(PREVIEW_CSV_REQUEST, () => {
    const detail = isTeamBuilderPreview() && previewRosterCapture
      ? { ok: true, capture: { ...previewRosterCapture, sourceUrl: location.href } }
      : { ok: false, error: 'Roster data is still loading. Reload the preview and wait a moment.' };
    window.dispatchEvent(new CustomEvent(PREVIEW_CSV_PAYLOAD, { detail }));
  });

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
          `Registers ${info.registered.length} new uniform item(s);${editableNote} your roster and ` +
          `logos are untouched.`;
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

  function applyArmedMascot(originalText, mascot) {
    const assetName = typeof mascot?.assetName === 'string' ? mascot.assetName.trim() : '';

    const payload = JSON.parse(originalText);
    const teamInfos = payload?.teamData?.teamInfos;
    if (!teamInfos || typeof teamInfos !== 'object' || Array.isArray(teamInfos)) {
      throw new Error('Could not find teamData.teamInfos in this save.');
    }
    teamInfos.TEAM_MASCOT_ASSETNAME = assetName;
    return JSON.stringify(payload);
  }

  function applyArmedStadium(originalText, stadium) {
    const stadiumId = Number.isInteger(stadium?.stadiumId) ? String(stadium.stadiumId) : '';
    if (!stadiumId) throw new Error('The armed stadium has no valid ID.');

    const payload = JSON.parse(originalText);
    const teamInfos = payload?.teamData?.teamInfos;
    if (!teamInfos || typeof teamInfos !== 'object' || Array.isArray(teamInfos)) {
      throw new Error('Could not find teamData.teamInfos in this save.');
    }
    const stadiumRecipe = payload?.teamData?.frostbiteData?.stadiumRecipe;
    if (!stadiumRecipe || typeof stadiumRecipe !== 'object' || Array.isArray(stadiumRecipe)) {
      throw new Error('Could not find teamData.frostbiteData.stadiumRecipe in this save.');
    }
    teamInfos.STADIUM_ID = stadiumId;
    stadiumRecipe.assetName = `${stadiumId}_stadium_recipe`;
    return JSON.stringify(payload);
  }

  // Stadium selections are deliberately confirmed at save time. Besides making the write
  // explicit, the current value in the dialog gives us a quick way to verify the request is the
  // expected Team Builder payload while troubleshooting a stadium that does not appear in-game.
  function promptStadiumSwap(originalText, stadium) {
    let modifiedText = null;
    let currentStadiumId = null;
    let stadiumId = '';
    let error = null;
    try {
      stadiumId = Number.isInteger(stadium?.stadiumId) ? String(stadium.stadiumId) : '';
      if (!stadiumId) throw new Error('The armed stadium has no valid ID.');
      const payload = JSON.parse(originalText);
      const teamInfos = payload?.teamData?.teamInfos;
      if (!teamInfos || typeof teamInfos !== 'object' || Array.isArray(teamInfos)) {
        throw new Error('Could not find teamData.teamInfos in this save.');
      }
      currentStadiumId = teamInfos.STADIUM_ID ?? '(not set)';
      modifiedText = applyArmedStadium(originalText, stadium);
    } catch (err) {
      error = err;
    }

    return new Promise((resolve) => {
      let settled = false;
      let remaining = AUTO_CONTINUE_SECONDS;
      let timerId = null;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearInterval(timerId);
        try { overlay.remove(); } catch {}
        resolve(value);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:2147483647;display:grid;' +
        'place-items:center;padding:24px;';

      const box = document.createElement('div');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', 'teamcrafters-stadium-save-title');
      box.style.cssText =
        'width:min(100%,440px);padding:24px;border:1px solid rgba(255,255,255,.18);border-radius:8px;' +
        'background:#1c1c1c;color:#fff;box-shadow:0 24px 72px rgba(0,0,0,.55);font-family:inherit;';

      const heading = document.createElement('h2');
      heading.id = 'teamcrafters-stadium-save-title';
      heading.textContent = 'Apply this stadium before saving?';
      heading.style.cssText = 'margin:0 0 10px;font-size:22px;line-height:1.2;';

      const detail = document.createElement('p');
      detail.style.cssText = 'margin:0;color:#c7c7c7;font-size:14px;line-height:1.5;';
      if (error) {
        detail.textContent = `This stadium update cannot be applied: ${error.message} Your save will remain unchanged.`;
      } else {
        const name = typeof stadium?.displayName === 'string' && stadium.displayName.trim()
          ? stadium.displayName.trim()
          : 'Selected stadium';
        detail.textContent = `${name} will set STADIUM_ID from "${currentStadiumId}" to "${stadiumId}" and stadiumRecipe.assetName to "${stadiumId}_stadium_recipe" in this save request.`;
      }

      const countdown = document.createElement('div');
      countdown.style.cssText = 'margin-top:10px;color:#999;font-size:12px;';
      const renderCountdown = () => {
        countdown.textContent = `Saving unchanged in ${remaining}s if you don't choose…`;
      };
      renderCountdown();

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:22px;';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = error ? 'Continue unchanged' : 'No, save unchanged';
      cancel.style.cssText =
        'min-height:40px;padding:0 15px;border:1px solid #777;border-radius:4px;background:transparent;' +
        'color:#fff;font:600 14px inherit;cursor:pointer;';
      cancel.onclick = () => settle(originalText);

      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = 'Yes, apply stadium';
      accept.disabled = modifiedText === null;
      accept.style.cssText =
        'min-height:40px;padding:0 15px;border:0;border-radius:4px;font:600 14px inherit;' +
        (accept.disabled
          ? 'background:#666;color:#bbb;cursor:not-allowed;'
          : 'background:#ffde00;color:#111;cursor:pointer;');
      accept.onclick = () => settle(modifiedText);

      actions.append(cancel, accept);
      box.append(heading, detail, countdown, actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      queueMicrotask(() => (modifiedText === null ? cancel : accept).focus());

      // Default to the safe option when the dialog is left open.
      timerId = setInterval(() => {
        if (--remaining <= 0) return settle(originalText);
        renderCountdown();
      }, 1000);
    });
  }

  // Get all user-armed save changes before reading the body. Returning null lets the caller send
  // the original request unchanged when neither uniforms, a mascot, nor a stadium are selected.
  async function chooseSaveUploadText(originalBody) {
    const [armed, mascot, stadium, settings] = await Promise.all([
      getArmedUniforms(),
      getArmedMascot(),
      getArmedStadium(),
      getUnleashedSaveSettings(),
    ]);
    const uniformArmed = settings.uniforms !== false && armed && Array.isArray(armed.uniforms) && armed.uniforms.length;
    // An empty asset name is the explicit “None / Remove mascot” choice.
    // It must remain armed so the native save receives a blank mascot ID.
    const mascotArmed = settings.mascot !== false && typeof mascot?.assetName === 'string';
    const stadiumArmed = settings.stadium !== false && Number.isInteger(stadium?.stadiumId);
    if (!uniformArmed && !mascotArmed && !stadiumArmed) {
      return null;
    }

    const originalText = await bodyToText(originalBody);
    let uniformChoice = originalText;
    if (uniformArmed) {
      const payload = JSON.parse(originalText);
      applyUniformSet(payload, armed);
      uniformChoice = JSON.stringify(payload);
    }
    const mascotChoice = mascotArmed ? applyArmedMascot(uniformChoice, mascot) : uniformChoice;
    return stadiumArmed ? applyArmedStadium(mascotChoice, stadium) : mascotChoice;
  }

  // === end save upload modifications ======================================================

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

  // The armed mascot, picked from the bundled reference list on the options page.
  function getArmedMascot() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-mascot-clipboard-response', onResponse);
        resolve(e.detail);
      }
      window.addEventListener('tc-mascot-clipboard-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-mascot-clipboard-request'));
    });
  }

  // The armed stadium, picked from the bundled reference list on the options page.
  function getArmedStadium() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-stadium-clipboard-response', onResponse);
        resolve(e.detail);
      }
      window.addEventListener('tc-stadium-clipboard-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-stadium-clipboard-request'));
    });
  }

  // The top-left Team Builder Unleashed bar controls which armed save-time
  // updates are active. Missing settings retain the original safe defaults.
  function getUnleashedSaveSettings() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-unleashed-save-settings-response', onResponse);
        const value = e.detail;
        resolve(value && typeof value === 'object' ? value : {});
      }
      window.addEventListener('tc-unleashed-save-settings-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-unleashed-save-settings-request'));
    });
  }

  // User-created school templates live in extension storage. They are deliberately separate from
  // the roster preset clipboard: EA reads school templates while setting up a team's identity,
  // whether or not a roster import is armed.
  function getSchoolTemplates() {
    return new Promise((resolve) => {
      function onResponse(e) {
        window.removeEventListener('tc-school-templates-response', onResponse);
        resolve(e.detail);
      }
      window.addEventListener('tc-school-templates-response', onResponse);
      window.dispatchEvent(new CustomEvent('tc-school-templates-request'));
    });
  }

  // classify a URL: which of our interception points (if any) it is
  function classify(url) {
    if (!url) return null;
    if (url.includes('template_rosters')) return 'template';
    if (url.includes('my_school_templates.json')) return 'school-templates';
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

  // The response is EA-owned, so never replace or mutate its built-in entries. Only well-formed
  // locally-created records are appended. This also makes an outdated or manually edited storage
  // entry harmless instead of risking the Team Builder setup UI.
  function appendSchoolTemplates(list, templates) {
    if (!Array.isArray(list) || !Array.isArray(templates)) return list;
    const existingIds = new Set(list.map((entry) => entry?.id));
    const fixedGradeIds = new Set([
      'CHAMPIONSHIP_CONTENDER_GRADE', 'PROGRAM_TRADITION_GRADE', 'CAMPUS_LIFESTYLE_GRADE',
      'STADIUM_ATMOSTPHERE_GRADE', 'BRAND_EXPOSURE_GRADE', 'ACADEMIC_PRESTIGE',
      'ATHLETIC_FACILITIES_GRADE',
    ]);
    const automaticGradeIds = new Set([
      'COACH_STABILITY_GRADE', 'COACH_PRESTIGE_GRADE', 'CONFERENCE_PRESTIGE_GRADE',
    ]);
    const valid = templates.filter((template) => {
      if (!template || !Number.isInteger(template.id) || existingIds.has(template.id)) return false;
      if (typeof template.displayName !== 'string' || !template.displayName.trim()) return false;
      if (!Number.isInteger(template.prestige) || template.prestige < 0 || template.prestige > 10) return false;
      if (!Array.isArray(template.grades) || template.grades.length !== 11) return false;
      const gradeById = new Map(template.grades.map((grade) => [grade?.id, grade]));
      if (gradeById.size !== 11) return false;
      const expectedIds = [...fixedGradeIds, 'PRO_POTENTIAL_GRADE', ...automaticGradeIds];
      if (expectedIds.some((id) => !gradeById.has(id))) return false;
      const isValid = template.grades.every((grade) =>
        grade && typeof grade.id === 'string' && typeof grade.displayName === 'string' &&
        typeof grade.description === 'string' && Number.isInteger(grade.min) && Number.isInteger(grade.max) &&
        grade.min >= -1 && grade.min <= 12 && grade.max >= -1 && grade.max <= 12 &&
        typeof grade.ratingSummary === 'string' &&
        (fixedGradeIds.has(grade.id) ? grade.min === grade.max && grade.min >= 0 : true) &&
        (grade.id === 'PRO_POTENTIAL_GRADE' ? grade.min >= grade.max && grade.max >= 0 : true) &&
        (automaticGradeIds.has(grade.id) ? grade.min === -1 && grade.max === -1 : true)
      );
      if (isValid) existingIds.add(template.id);
      return isValid;
    });
    return list.concat(valid);
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
        capturePreviewRoster(payload);
        const removed = removeInsertedUniforms(payload);
        if (removed.items) console.info('[TeamCrafters] removed prior imported uniform parts:', removed);
        return jsonResponse(JSON.stringify(payload));
      } catch {
        initialNonceCleanupPending = true;
        return real;
      }
    }

    // Save upload — apply any armed uniform set, mascot, and stadium selection before sending.
    if (shouldInterceptUpload(url, method)) {
      const hasInitBody = Object.prototype.hasOwnProperty.call(init || {}, 'body');
      const originalBody = hasInitBody
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : null;
      const chosen = await chooseSaveUploadText(originalBody);
      if (chosen === null) return nativeFetch(input, init);
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

    if (kind === 'school-templates') {
      const real = await nativeFetch(input, init);
      try {
        const list = await real.clone().json();
        const templates = await getSchoolTemplates();
        return jsonResponse(JSON.stringify(appendSchoolTemplates(list, templates)));
      } catch { /* keep EA's original response if either source cannot be read */ }
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
          capturePreviewRoster(payload);
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

    // Save upload (this is the path EA actually uses). Apply any armed uniform set, mascot, and
    // stadium selection, then send the chosen body. On any failure send the original rather than
    // dropping the save.
    if (info && shouldInterceptUpload(info.url, info.method)) {
      chooseSaveUploadText(body)
        .then((chosen) => origSend.call(xhr, chosen === null ? body : textToOriginalType(chosen, body)))
        .catch((err) => {
          console.error('[TeamCrafters] save update failed, saving unchanged:', err);
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
        if (kind === 'school-templates') {
          // Preserve the CDN result exactly, with only valid user templates appended.
          return nativeFetch(info.url)
            .then((r) => r.json())
            .then(async (list) => {
              const templates = await getSchoolTemplates();
              synthesize(xhr, info.url, JSON.stringify(appendSchoolTemplates(list, templates)));
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
