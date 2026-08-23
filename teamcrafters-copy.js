// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// teamcrafters-copy.js — ISOLATED world, TeamCrafters roster and Team Builder directory pages.
// Adds two buttons to a classic team page:
//
//   "Copy For Team Builder" — fetches the normalized roster export, merges it onto the bundled EA base
//   template (see roster-merge.js) to produce a complete roster.json + character_visuals.json
//   pair, and stores that in chrome.storage.local. On EA's Team Builder, the extension then
//   offers it as an "Import from TeamCrafters" preset.
//
//   "Download CSV" — writes the same roster out as a spreadsheet (see csv-export.js) so it can be
//   edited and brought back in through the CSV importer.
//
// Custom-team and Team Builder directory pages get "Copy team for Team Builder" and "Download
// CSV" buttons. TeamCrafters exposes each original nonce-primary payload through purpose-built
// extension APIs, so roster records and player equipment stay paired. Older custom entries with no
// asset retain the public roster-row fallback, merged onto the stable base appearance map.
//
// Runs at document_start and re-checks the route on every client-side navigation (TeamCrafters is
// a Next.js SPA), so the buttons only show on a supported team page and always target the team
// currently on screen.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';
  const POLL_INTERVAL_MS = 400;
  const copyErrors = window.TeamBuilderUnleashedCopyErrors || {
    blockedCopyMessage: () => null,
    copyErrorMessage: () => 'We could not copy this roster. Refresh the page and try again.',
  };

  // Sentinel asset URLs live in roster-merge.js so the CSV importer shares them.
  const { ROSTER_URL, VISUALS_URL } = window.TCRosterMerge;

  function parseRouteParams() {
    const classicMatch = location.pathname.match(/^\/app\/classic-rosters\/([^/]+)\/([^/]+)/);
    if (classicMatch) {
      const [, gameSlug, teamSlug] = classicMatch;
      return { kind: 'classic', gameSlug, teamSlug };
    }
    const customMatch = location.pathname.match(/^\/app\/customTeams\/(\d+)\/?$/);
    if (customMatch) return { kind: 'custom', customTeamId: customMatch[1] };
    // Directory teams are published under both the legacy CFB27 namespace and the current CFB
    // namespace. Preserve the namespace in `game`, because the extension API uses it to locate
    // the matching published Team Builder payload.
    const teamBuilderMatch = location.pathname.match(/^\/app\/teambuilder\/(CFB(?:27)?)\/([A-Za-z0-9_-]{6,128})\/?$/i);
    return teamBuilderMatch
      ? { kind: 'team-builder', game: teamBuilderMatch[1].toUpperCase(), teamBuilderId: teamBuilderMatch[2] }
      : null;
  }

  // One fixed panel holding a shared status line and both buttons. Status lives above the row
  // rather than inside a button's label, so both labels stay readable while either action runs.
  const BTN_BASE =
    'padding:10px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;' +
    'font-weight:600;cursor:pointer;border:none;';

  function createPanel(route) {
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;' +
      'flex-direction:column;align-items:flex-end;gap:8px;max-width:min(380px,calc(100vw - 32px));';

    const status = document.createElement('div');
    status.style.cssText =
      'display:none;background:#fff;color:#1b1f24;border:1px solid #d7dbe0;border-radius:6px;' +
      'padding:8px 10px;font-family:sans-serif;font-size:12px;line-height:1.5;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = route.kind === 'classic' ? 'Copy For Team Builder' : 'Copy team for Team Builder';
    copyBtn.style.cssText = BTN_BASE + 'background:#1a73e8;color:#fff;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3);';

    const csvBtn = document.createElement('button');
    csvBtn.textContent = 'Download CSV';
    csvBtn.style.cssText = BTN_BASE + 'background:#fff;color:#1b1f24;border:1px solid #d7dbe0;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);';

    row.append(copyBtn, csvBtn);
    panel.append(status, row);
    return { panel, status, copyBtn, csvBtn, kind: route.kind };
  }

  function setStatus(ui, text, isError) {
    if (!text) {
      ui.status.style.display = 'none';
      ui.status.textContent = '';
      return;
    }
    ui.status.style.display = 'block';
    ui.status.textContent = text;
    ui.status.style.borderColor = isError ? '#f3c2c2' : '#d7dbe0';
    ui.status.style.background = isError ? '#fdecec' : '#fff';
    ui.status.style.color = isError ? '#8c1d1d' : '#1b1f24';
  }

  function setBusy(ui, busy) {
    for (const button of [ui.copyBtn, ui.csvBtn]) {
      if (!button) continue;
      button.disabled = busy;
      button.style.opacity = busy ? '0.6' : '1';
    }
  }

  // Auto-clear a transient message, unless something newer replaced it in the meantime.
  let statusToken = 0;
  function flashStatus(ui, text, isError, ms) {
    const token = ++statusToken;
    setStatus(ui, text, isError);
    setTimeout(() => { if (statusToken === token) setStatus(ui, '', false); }, ms);
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status}) for ${url}`);
    }
    return res.json();
  }

  // Build a short preset label from the URL slugs (safer than parsing the full game/team names,
  // which include mascots and "Football"). e.g. teamSlug "alabama" + gameSlug "ncaa-11"
  // -> "TeamCrafters: Alabama (NCAA 11)".
  function titleCase(slug) {
    return String(slug)
      .split('-')
      .map((w) => (w.toLowerCase() === 'ncaa' ? 'NCAA' : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }
  function presetName(route) {
    return `TeamCrafters: ${titleCase(route.teamSlug)} (${titleCase(route.gameSlug)})`;
  }

  function rosterApiUrl(route) {
    return `/api/extension/v1/classic-rosters/${route.gameSlug}/${route.teamSlug}`;
  }

  async function copyRoster(ui, route) {
    const blockedMessage = copyErrors.blockedCopyMessage(route);
    if (blockedMessage) {
      flashStatus(ui, blockedMessage, true, 20000);
      return;
    }
    setBusy(ui, true);
    setStatus(ui, 'Copying roster…', false);
    try {
      const [clipboard, baseRoster, baseVisuals, portraitCatalog] = await Promise.all([
        fetchJson(rosterApiUrl(route)),
        fetchJson(chrome.runtime.getURL('base-template/roster.json')),
        fetchJson(chrome.runtime.getURL('base-template/character_visuals.json')),
        window.TCRosterMerge.loadPortraitCatalog(),
      ]);

      const { roster, visuals, stats } = window.TCRosterMerge.buildPresetPayload(
        clipboard,
        baseRoster,
        baseVisuals,
        portraitCatalog
      );

      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          version: 2,
          teamName: clipboard.source.teamName,
          displayName: presetName(route),
          sourceUrl: clipboard.source.sourceUrl,
          copiedAt: new Date().toISOString(),
          playerCount: clipboard.playerCount,
          stats,
          rosterUrl: ROSTER_URL,
          visualsUrl: VISUALS_URL,
          rosterJson: JSON.stringify(roster),
          visualsJson: JSON.stringify(visuals),
        },
      });

      flashStatus(ui, `Copied ${clipboard.source.teamName} — pick it in EA Team Builder presets`, false, 6000);
    } catch (err) {
      console.warn('[Team Builder Unleashed] Classic roster copy failed.', err);
      flashStatus(ui, copyErrors.copyErrorMessage(err, route), true, 16000);
    } finally {
      setBusy(ui, false);
    }
  }

  function nextFlightPayloads() {
    const prefix = 'self.__next_f.push(';
    const payloads = [];
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      const start = text.indexOf(prefix);
      if (start < 0) continue;
      const end = text.lastIndexOf(')');
      if (end <= start + prefix.length) continue;
      try {
        const entry = JSON.parse(text.slice(start + prefix.length, end));
        if (typeof entry?.[1] === 'string') payloads.push(entry[1]);
      } catch {
        // Unrelated inline scripts are never allowed to block a copy action.
      }
    }
    return payloads;
  }

  function jsonValueEnd(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '[' || char === '{') {
        depth++;
      } else if (char === ']' || char === '}') {
        if (--depth === 0) return index + 1;
      }
    }
    return -1;
  }

  // The custom-team page's roster is an SSR prop for its interactive table. Reading that public
  // prop avoids depending on a private, mutable API endpoint and works before or after hydration.
  function customTeamRosterFromPage() {
    const marker = '"defaultRoster":';
    for (const payload of nextFlightPayloads()) {
      const markerIndex = payload.indexOf(marker);
      if (markerIndex < 0) continue;
      const start = markerIndex + marker.length;
      const end = jsonValueEnd(payload, start);
      if (end < 0) continue;
      try {
        const roster = JSON.parse(payload.slice(start, end));
        if (Array.isArray(roster) && roster.length) return roster;
      } catch {
        // Keep looking in case Next split the page into multiple flight payloads.
      }
    }
    throw new Error('The team roster is still loading. Wait a moment, then try again.');
  }

  function customTeamName() {
    return document.querySelector('h1')?.textContent?.trim() || 'TeamCrafters custom team';
  }

  function objectRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  // TeamCrafters' extension APIs return the exact published nonce-primary payload, preserving the
  // player records and matching equipment map as one validated capture.
  function extractTeamBuilderCapture(payload) {
    const root = objectRecord(payload);
    const teamData = objectRecord(root?.teamData) || root;
    const roster = objectRecord(teamData?.roster) || objectRecord(teamData?.rosterData);
    const playerData = objectRecord(roster?.playerData) || objectRecord(teamData?.playerData);
    const characterVisuals =
      objectRecord(teamData?.frostbiteData?.characterVisuals) ||
      objectRecord(teamData?.characterVisuals);
    if (!playerData || !characterVisuals) return null;

    const playerIds = Object.keys(playerData);
    const visualIds = Object.keys(characterVisuals);
    if (!playerIds.length || playerIds.length !== visualIds.length) return null;
    if (playerIds.some((id) => !Object.hasOwn(characterVisuals, id))) return null;

    const info = objectRecord(teamData?.teamInfos);
    const teamName = [info?.TEAM_NAME, info?.TEAM_NICKNAME].filter(Boolean).join(' ').trim();
    return {
      teamName: teamName || customTeamName(),
      playerCount: playerIds.length,
      rosterJson: JSON.stringify(playerData),
      visualsJson: JSON.stringify(characterVisuals),
    };
  }

  async function teamBuilderCaptureFromTeamCrafters(customTeamId) {
    const url = `/api/extension/v1/custom-teams/${encodeURIComponent(customTeamId)}/team-builder`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${response.status}) for ${url}`);
    }
    const payload = await response.json();
    const capture = extractTeamBuilderCapture(payload);
    if (!capture) throw new Error('The original Team Builder file is missing matching roster or character visuals.');
    return capture;
  }

  async function teamBuilderDirectoryCaptureFromTeamCrafters(route) {
    const url = `/api/extension/v1/team-builder/${encodeURIComponent(route.game)}/${encodeURIComponent(route.teamBuilderId)}`;
    const payload = await fetchJson(url);
    const capture = extractTeamBuilderCapture(payload);
    if (!capture) throw new Error('The original Team Builder file is missing matching roster or character visuals.');
    return capture;
  }

  async function saveTeamBuilderCapture(capture, sourceKind) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        version: 2,
        teamName: capture.teamName,
        displayName: `TeamCrafters: ${capture.teamName}`,
        sourceUrl: location.href,
        copiedAt: new Date().toISOString(),
        playerCount: capture.playerCount,
        stats: {
          copiedFromCustomTeam: sourceKind === 'custom',
          copiedFromTeamBuilderDirectory: sourceKind === 'team-builder',
        },
        rosterUrl: ROSTER_URL,
        visualsUrl: VISUALS_URL,
        rosterJson: capture.rosterJson,
        visualsJson: capture.visualsJson,
      },
    });
  }

  async function copyCustomTeam(ui, route) {
    setBusy(ui, true);
    setStatus(ui, 'Copying team…', false);
    try {
      const primaryCapture = await teamBuilderCaptureFromTeamCrafters(route.customTeamId);
      if (primaryCapture) {
        await saveTeamBuilderCapture(primaryCapture, 'custom');
        flashStatus(
          ui,
          `Copied ${primaryCapture.teamName} with its original equipment — pick it in EA Team Builder presets`,
          false,
          7000
        );
        return;
      }

      // Legacy custom-team records do not have an EA asset link. Their public roster table is
      // still useful, but it cannot contain the private character-visual map from nonce-primary.
      const rawRoster = customTeamRosterFromPage();
      const teamName = customTeamName();
      const [baseRoster, baseVisuals, portraitCatalog] = await Promise.all([
        fetchJson(chrome.runtime.getURL('base-template/roster.json')),
        fetchJson(chrome.runtime.getURL('base-template/character_visuals.json')),
        window.TCRosterMerge.loadPortraitCatalog(),
      ]);
      const clipboard = window.TCRosterMerge.buildClipboardFromEaRoster(rawRoster, {
        teamName,
        sourceUrl: location.href,
      });
      const { roster, visuals, stats } = window.TCRosterMerge.buildPresetPayload(
        clipboard,
        baseRoster,
        baseVisuals,
        portraitCatalog
      );

      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          version: 2,
          teamName: clipboard.source.teamName,
          displayName: `TeamCrafters: ${clipboard.source.teamName}`,
          sourceUrl: clipboard.source.sourceUrl,
          copiedAt: new Date().toISOString(),
          playerCount: clipboard.playerCount,
          stats: { ...stats, copiedFromCustomTeam: true },
          rosterUrl: ROSTER_URL,
          visualsUrl: VISUALS_URL,
          rosterJson: JSON.stringify(roster),
          visualsJson: JSON.stringify(visuals),
        },
      });

      flashStatus(ui, `Copied ${clipboard.source.teamName} — pick it in EA Team Builder presets`, false, 6000);
    } catch (err) {
      console.warn('[Team Builder Unleashed] Custom team copy failed.', err);
      flashStatus(ui, copyErrors.copyErrorMessage(err, route), true, 16000);
    } finally {
      setBusy(ui, false);
    }
  }

  async function copyTeamBuilderDirectory(ui, route) {
    setBusy(ui, true);
    setStatus(ui, 'Copying team…', false);
    try {
      const capture = await teamBuilderDirectoryCaptureFromTeamCrafters(route);
      await saveTeamBuilderCapture(capture, 'team-builder');
      flashStatus(
        ui,
        `Copied ${capture.teamName} with its original equipment — pick it in EA Team Builder presets`,
        false,
        7000
      );
    } catch (err) {
      console.warn('[Team Builder Unleashed] Team Builder directory copy failed.', err);
      flashStatus(ui, copyErrors.copyErrorMessage(err, route), true, 16000);
    } finally {
      setBusy(ui, false);
    }
  }

  // Turn the export summary into one sentence naming what has to be fixed before the file can be
  // imported again. Blanks and short rosters are legitimate — classic games didn't track every
  // modern rating, and real teams carry one kicker — so we report rather than invent values.
  function describeGaps(summary) {
    const parts = [];
    if (summary.blankCells) {
      const cols = summary.blankColumns.slice(0, 6).join(', ');
      const more = summary.blankColumns.length > 6 ? `, +${summary.blankColumns.length - 6} more` : '';
      parts.push(`${summary.blankCells} blank rating cell${summary.blankCells > 1 ? 's' : ''} (${cols}${more})`);
    }
    if (summary.tooFewPlayers) {
      parts.push(`only ${summary.playerCount} players (needs ${summary.tooFewPlayers})`);
    }
    if (summary.tooManyPlayers) {
      parts.push(`${summary.playerCount} players (max ${summary.tooManyPlayers})`);
    }
    for (const s of summary.shortPositions) parts.push(`${s.position}: ${s.has} of ${s.needs}`);
    return parts.join(' · ');
  }

  function triggerDownload(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvFilename(teamName) {
    const stem = String(teamName || 'teamcrafters-custom-team')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return `${stem || 'teamcrafters-custom-team'}.csv`;
  }

  async function downloadCustomTeamCsv(ui, route) {
    setBusy(ui, true);
    setStatus(ui, 'Building CSV…', false);
    try {
      const capture = await teamBuilderCaptureFromTeamCrafters(route.customTeamId);
      const teamName = capture?.teamName || customTeamName();
      const playerData = capture
        ? JSON.parse(capture.rosterJson)
        : customTeamRosterFromPage();
      const { csv } = window.TCCsvExport.buildEaRosterCsv(playerData);
      const filename = csvFilename(teamName);
      triggerDownload(csv, filename);
      flashStatus(ui, `Downloaded ${filename} — ${Array.isArray(playerData) ? playerData.length : Object.keys(playerData).length} players.`, false, 6000);
    } catch (err) {
      flashStatus(ui, `Download failed: ${err.message}`, true, 8000);
    } finally {
      setBusy(ui, false);
    }
  }

  async function downloadTeamBuilderDirectoryCsv(ui, route) {
    setBusy(ui, true);
    setStatus(ui, 'Building CSV…', false);
    try {
      const capture = await teamBuilderDirectoryCaptureFromTeamCrafters(route);
      const playerData = JSON.parse(capture.rosterJson);
      const { csv } = window.TCCsvExport.buildEaRosterCsv(playerData);
      const filename = csvFilename(capture.teamName);
      triggerDownload(csv, filename);
      flashStatus(ui, `Downloaded ${filename} — ${capture.playerCount} players.`, false, 6000);
    } catch (err) {
      flashStatus(ui, `Download failed: ${err.message}`, true, 8000);
    } finally {
      setBusy(ui, false);
    }
  }

  async function downloadCsv(ui, route) {
    setBusy(ui, true);
    setStatus(ui, 'Building CSV…', false);
    try {
      const clipboard = await fetchJson(rosterApiUrl(route));
      const { csv, summary } = window.TCCsvExport.buildRosterCsv(clipboard);
      const filename = `${route.teamSlug}-${route.gameSlug}.csv`;
      triggerDownload(csv, filename);

      if (summary.importable) {
        flashStatus(ui, `Downloaded ${filename} — ${summary.playerCount} players.`, false, 6000);
      } else {
        // The file still downloads; it just needs edits first.
        flashStatus(ui,
          `Downloaded ${filename}, but it won't import as-is — ${describeGaps(summary)}. ` +
          `Fill these in before importing it back.`, true, 20000);
      }
    } catch (err) {
      flashStatus(ui, `Download failed: ${err.message}`, true, 8000);
    } finally {
      setBusy(ui, false);
    }
  }

  let ui = null;
  let currentRouteKey = null;

  function sync() {
    if (!document.body) return;
    const route = parseRouteParams();
    const routeKey = route?.kind === 'classic'
      ? `classic/${route.gameSlug}/${route.teamSlug}`
      : route?.kind === 'custom'
        ? `custom/${route.customTeamId}`
        : route?.kind === 'team-builder'
          ? `team-builder/${route.game}/${route.teamBuilderId}`
          : null;
    if (routeKey === currentRouteKey) return;
    currentRouteKey = routeKey;

    if (!route) {
      if (ui) { ui.panel.remove(); ui = null; }
      return;
    }
    if (!ui || ui.kind !== route.kind) {
      ui?.panel.remove();
      ui = createPanel(route);
      document.body.appendChild(ui.panel);
    }
    // New team on screen — drop any message left over from the previous one.
    statusToken++;
    setStatus(ui, '', false);
    setBusy(ui, false);
    ui.copyBtn.onclick = route.kind === 'classic'
      ? () => copyRoster(ui, route)
      : route.kind === 'custom'
        ? () => copyCustomTeam(ui, route)
        : () => copyTeamBuilderDirectory(ui, route);
    ui.csvBtn.onclick = route.kind === 'classic'
      ? () => downloadCsv(ui, route)
      : route.kind === 'custom'
        ? () => downloadCustomTeamCsv(ui, route)
        : () => downloadTeamBuilderDirectoryCsv(ui, route);
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      sync();
      return result;
    };
  }
  window.addEventListener('popstate', sync);
  setInterval(sync, POLL_INTERVAL_MS);

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync, { once: true });
})();
