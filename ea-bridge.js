// TeamCrafters Classic Roster Importer
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
// the page on request: the TeamCrafters roster clipboard, and the armed uniform set. It also owns
// the explicit-copy handoff from an EA Team Builder preview page.
(function () {
  const PREVIEW_COPY_PAYLOAD = 'tc-team-builder-preview-copy-payload';
  const PREVIEW_COPY_RESULT = 'tc-team-builder-preview-copy-result';
  const PREVIEW_CSV_PAYLOAD = 'tc-team-builder-preview-csv-payload';
  const PREVIEW_CSV_RESULT = 'tc-team-builder-preview-csv-result';
  const ROSTER_KEY = 'tcRosterClipboard';
  const MAX_JSON_BYTES = 5 * 1024 * 1024;
  const RELAYS = [
    { key: 'tcRosterClipboard', request: 'tc-roster-clipboard-request', response: 'tc-roster-clipboard-response' },
    { key: 'tcUniformClipboard', request: 'tc-uniform-clipboard-request', response: 'tc-uniform-clipboard-response' },
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

  // This event can only carry data that inject.js captured from nonce-primary. Re-parse and
  // validate it here before writing, so a malformed page event cannot replace the saved preset.
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
