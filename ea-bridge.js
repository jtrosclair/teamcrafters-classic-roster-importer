// Team Builder Unleashed
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// ea-bridge.js — ISOLATED world content script.
// inject.js (MAIN world) cannot call chrome.storage directly, so this relays what's stored into
// the page on request: the TeamCrafters roster clipboard, plus armed uniform, mascot, and stadium
// choices. It also owns the explicit-copy handoff from an EA Team Builder preview page.
(function () {
  const PREVIEW_COPY_PAYLOAD = 'tc-team-builder-preview-copy-payload';
  const PREVIEW_COPY_RESULT = 'tc-team-builder-preview-copy-result';
  const PREVIEW_CSV_PAYLOAD = 'tc-team-builder-preview-csv-payload';
  const PREVIEW_CSV_RESULT = 'tc-team-builder-preview-csv-result';
  const ROSTER_KEY = 'tcRosterClipboard';
  const UNIFORM_KEY = 'tcUniformClipboard';
  const MASCOT_KEY = 'tcMascotClipboard';
  const STADIUM_KEY = 'tcStadiumClipboard';
  const SCHOOL_TEMPLATE_KEY = 'tcSchoolTemplates';
  const SAVE_SETTINGS_KEY = 'tcUnleashedSaveSettings';
  const MAX_JSON_BYTES = 5 * 1024 * 1024;
  const RELAYS = [
    { key: ROSTER_KEY, request: 'tc-roster-clipboard-request', response: 'tc-roster-clipboard-response' },
    { key: UNIFORM_KEY, request: 'tc-uniform-clipboard-request', response: 'tc-uniform-clipboard-response' },
    { key: MASCOT_KEY, request: 'tc-mascot-clipboard-request', response: 'tc-mascot-clipboard-response' },
    { key: STADIUM_KEY, request: 'tc-stadium-clipboard-request', response: 'tc-stadium-clipboard-response' },
    { key: SCHOOL_TEMPLATE_KEY, request: 'tc-school-templates-request', response: 'tc-school-templates-response' },
    { key: SAVE_SETTINGS_KEY, request: 'tc-unleashed-save-settings-request', response: 'tc-unleashed-save-settings-response' },
  ];

  for (const relay of RELAYS) {
    window.addEventListener(relay.request, () => {
      chrome.storage.local.get(relay.key, (result) => {
        window.dispatchEvent(
          new CustomEvent(relay.response, { detail: result[relay.key] || null })
        );
      });
    });
  }

  // A compact, page-local status bar makes the save-time handoff visible without taking over
  // Team Builder. It only reads extension storage and lets the player enable or disable each
  // armed save change; EA's normal Save button remains the only publish action.
  const STATUS_BAR_ID = 'teamcrafters-unleashed-status-bar';
  let refreshRequired = false;

  function saveSettings(value) {
    return {
      uniforms: value?.uniforms !== false,
      mascot: value?.mascot !== false,
      stadium: value?.stadium !== false,
    };
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function armedChanges(stored) {
    const settings = saveSettings(stored[SAVE_SETTINGS_KEY]);
    const uniform = stored[UNIFORM_KEY];
    const mascot = stored[MASCOT_KEY];
    const stadium = stored[STADIUM_KEY];
    const changes = [];
    if (Array.isArray(uniform?.uniforms) && uniform.uniforms.length) {
      changes.push({ key: 'uniforms', label: `${uniform.uniforms.length} uniform${uniform.uniforms.length === 1 ? '' : 's'}`, enabled: settings.uniforms });
    }
    if (text(mascot?.assetName)) {
      changes.push({ key: 'mascot', label: `Mascot: ${text(mascot?.mascotName) || text(mascot?.teamName) || 'selected'}`, enabled: settings.mascot });
    }
    if (Number.isInteger(stadium?.stadiumId)) {
      changes.push({ key: 'stadium', label: `Stadium: ${text(stadium?.displayName) || 'selected'}`, enabled: settings.stadium });
    }
    return { settings, changes };
  }

  function setSaveChangeEnabled(key, enabled, currentSettings) {
    const next = { ...saveSettings(currentSettings), [key]: enabled };
    chrome.storage.local.set({ [SAVE_SETTINGS_KEY]: next });
  }

  function makeStatusChange(change, settings) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:7px;min-height:30px;padding:3px 4px 3px 9px;border:1px solid ' +
      (change.enabled ? 'rgba(90,156,255,.52)' : 'rgba(255,255,255,.18)') + ';border-radius:999px;background:' +
      (change.enabled ? 'rgba(30,91,185,.27)' : 'rgba(255,255,255,.06)') + ';white-space:nowrap;';

    const label = document.createElement('span');
    label.textContent = change.label;
    label.style.cssText = 'max-width:190px;overflow:hidden;text-overflow:ellipsis;color:#f8fbff;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = change.enabled ? 'On' : 'Off';
    toggle.setAttribute('aria-label', `${change.enabled ? 'Disable' : 'Enable'} ${change.label} on save`);
    toggle.style.cssText = 'min-height:24px;padding:0 8px;border:0;border-radius:999px;background:' +
      (change.enabled ? '#65a9ff' : '#64748b') + ';color:' + (change.enabled ? '#081526' : '#fff') +
      ';font:800 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;';
    toggle.addEventListener('click', () => setSaveChangeEnabled(change.key, !change.enabled, settings));
    item.append(label, toggle);
    return item;
  }

  function renderStatusBar(stored) {
    if (!document.body) return;
    let bar = document.getElementById(STATUS_BAR_ID);
    if (!bar) {
      bar = document.createElement('aside');
      bar.id = STATUS_BAR_ID;
      bar.setAttribute('aria-label', 'Team Builder Unleashed save changes');
      bar.style.cssText = 'position:fixed;top:14px;left:14px;z-index:2147483646;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 28px);padding:7px 9px;border:1px solid rgba(115,170,255,.48);border-radius:12px;background:rgba(9,17,32,.94);box-shadow:0 12px 34px rgba(0,0,0,.32);backdrop-filter:blur(12px);';
      document.body.appendChild(bar);
    }
    bar.replaceChildren();
    const brand = document.createElement('a');
    brand.href = 'https://www.teamcrafters.net/team-builder-unleashed/cfb27';
    brand.target = '_blank';
    brand.rel = 'noopener';
    brand.textContent = 'Team Builder Unleashed';
    brand.title = 'Open Team Builder Unleashed Studio';
    brand.style.cssText = 'color:#8fc0ff;text-decoration:none;font:800 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.01em;white-space:nowrap;';
    bar.appendChild(brand);

    const { settings, changes } = armedChanges(stored);
    if (changes.length) {
      for (const change of changes) bar.appendChild(makeStatusChange(change, settings));
    } else {
      const empty = document.createElement('span');
      empty.textContent = 'No save changes staged';
      empty.style.cssText = 'color:#c8d2e0;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;';
      bar.appendChild(empty);
    }

    if (refreshRequired) {
      const refresh = document.createElement('span');
      refresh.textContent = 'Refresh Team Builder needed';
      refresh.title = 'A roster or school template changed while this Team Builder page was open. Refresh before using it.';
      refresh.style.cssText = 'padding:5px 8px;border:1px solid rgba(255,198,91,.56);border-radius:999px;background:rgba(217,119,6,.17);color:#ffd391;font:800 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;';
      bar.appendChild(refresh);
    }
  }

  function refreshStatusBar() {
    chrome.storage.local.get([ROSTER_KEY, UNIFORM_KEY, MASCOT_KEY, STADIUM_KEY, SCHOOL_TEMPLATE_KEY, SAVE_SETTINGS_KEY], renderStatusBar);
  }

  function mountStatusBar() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', mountStatusBar, { once: true });
      return;
    }
    refreshStatusBar();
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[ROSTER_KEY] || changes[SCHOOL_TEMPLATE_KEY]) refreshRequired = true;
      if ([ROSTER_KEY, UNIFORM_KEY, MASCOT_KEY, STADIUM_KEY, SCHOOL_TEMPLATE_KEY, SAVE_SETTINGS_KEY]
        .some((key) => changes[key])) refreshStatusBar();
    });
  }

  mountStatusBar();

  function isPlayerMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const ids = Object.keys(value);
    return ids.length > 0 && ids.length <= 100 && ids.every((id) => /^\d+$/.test(id) &&
      value[id] && typeof value[id] === 'object' && !Array.isArray(value[id]));
  }

  function emitPreviewResult(detail) {
    window.dispatchEvent(new CustomEvent(PREVIEW_COPY_RESULT, { detail }));
  }

  function emitPreviewCsvResult(detail) {
    window.dispatchEvent(new CustomEvent(PREVIEW_CSV_RESULT, { detail }));
  }

  function readPreviewCapture(payload) {
    if (!payload?.ok) return { error: payload?.error || 'Roster data is unavailable.' };
    const capture = payload.capture;
    if (!capture || typeof capture.rosterJson !== 'string' || typeof capture.visualsJson !== 'string' ||
        capture.rosterJson.length > MAX_JSON_BYTES || capture.visualsJson.length > MAX_JSON_BYTES) {
      return { error: 'The preview roster is too large or invalid.' };
    }
    let roster;
    let visuals;
    try {
      roster = JSON.parse(capture.rosterJson);
      visuals = JSON.parse(capture.visualsJson);
    } catch {
      return { error: 'The preview roster could not be read.' };
    }
    if (!isPlayerMap(roster) || !isPlayerMap(visuals)) {
      return { error: 'The preview is missing rosterData or characterVisuals.' };
    }
    const rosterIds = Object.keys(roster).sort();
    const visualIds = Object.keys(visuals).sort();
    if (rosterIds.length !== visualIds.length || rosterIds.some((id, index) => id !== visualIds[index])) {
      return { error: 'The preview roster and character visuals do not match.' };
    }
    return { capture, roster, playerCount: rosterIds.length };
  }

  function downloadCsv(csv, teamName) {
    const filename = `${String(teamName || 'team-builder-roster')
      .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'team-builder-roster'}.csv`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  window.addEventListener(PREVIEW_COPY_PAYLOAD, (event) => {
    const parsed = readPreviewCapture(event.detail);
    if (parsed.error) {
      emitPreviewResult({ ok: false, error: parsed.error });
      return;
    }
    const { capture, playerCount } = parsed;
    const teamName = typeof capture.teamName === 'string' && capture.teamName.trim()
      ? capture.teamName.trim().slice(0, 120)
      : 'Team Builder team';
    const sourceUrl = typeof capture.sourceUrl === 'string' ? capture.sourceUrl : null;
    chrome.storage.local.set({
      [ROSTER_KEY]: {
        version: 2,
        teamName,
        displayName: `TeamCrafters: ${teamName}`,
        sourceUrl,
        copiedAt: new Date().toISOString(),
        playerCount,
        stats: { copiedFromTeamBuilder: true },
        rosterUrl: 'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-roster.json',
        visualsUrl: 'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-character_visuals.json',
        rosterJson: capture.rosterJson,
        visualsJson: capture.visualsJson,
      },
    }, () => {
      if (chrome.runtime.lastError) {
        emitPreviewResult({ ok: false, error: chrome.runtime.lastError.message || 'Could not save the roster.' });
        return;
      }
      emitPreviewResult({ ok: true, playerCount });
    });
  });

  window.addEventListener(PREVIEW_CSV_PAYLOAD, (event) => {
    const parsed = readPreviewCapture(event.detail);
    if (parsed.error) {
      emitPreviewCsvResult({ ok: false, error: parsed.error });
      return;
    }
    if (typeof window.TCCsvExport?.buildEaRosterCsv !== 'function') {
      emitPreviewCsvResult({ ok: false, error: 'The CSV exporter is unavailable. Reload the preview and try again.' });
      return;
    }
    try {
      const { csv } = window.TCCsvExport.buildEaRosterCsv(parsed.roster);
      downloadCsv(csv, parsed.capture.teamName);
      emitPreviewCsvResult({ ok: true, playerCount: parsed.playerCount });
    } catch (error) {
      emitPreviewCsvResult({ ok: false, error: `Could not create CSV: ${error.message || error}` });
    }
  });
})();
