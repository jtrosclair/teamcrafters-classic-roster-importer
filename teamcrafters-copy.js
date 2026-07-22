// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// teamcrafters-copy.js — ISOLATED world, teamcrafters.net classic-roster team pages ONLY.
// Adds two buttons to a classic team page:
//
//   "Copy team as-is" — fetches the normalized roster export, merges it onto the bundled EA base
//   template (see roster-merge.js) to produce a complete roster.json + character_visuals.json
//   pair, and stores that in chrome.storage.local. On EA's Team Builder, the extension then
//   offers it as an "Import from TeamCrafters" preset.
//
//   "Download CSV" — writes the same roster out as a spreadsheet (see csv-export.js) so it can be
//   edited and brought back in through the CSV importer.
//
// Runs at document_start and re-checks the route on every client-side navigation (TeamCrafters is
// a Next.js SPA), so the buttons only show on an actual classic team page and always target the
// team currently on screen.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';
  const POLL_INTERVAL_MS = 400;

  // Sentinel asset URLs live in roster-merge.js so the CSV importer shares them.
  const { ROSTER_URL, VISUALS_URL } = window.TCRosterMerge;

  function parseRouteParams() {
    const match = location.pathname.match(/^\/app\/classic-rosters\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const [, gameSlug, teamSlug] = match;
    return { gameSlug, teamSlug };
  }

  // One fixed panel holding a shared status line and both buttons. Status lives above the row
  // rather than inside a button's label, so both labels stay readable while either action runs.
  const BTN_BASE =
    'padding:10px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;' +
    'font-weight:600;cursor:pointer;border:none;';

  function createPanel() {
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
    copyBtn.textContent = 'Copy team as-is';
    copyBtn.style.cssText = BTN_BASE + 'background:#1a73e8;color:#fff;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3);';

    const csvBtn = document.createElement('button');
    csvBtn.textContent = 'Download CSV';
    csvBtn.style.cssText = BTN_BASE + 'background:#fff;color:#1b1f24;border:1px solid #d7dbe0;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);';

    row.append(copyBtn, csvBtn);
    panel.append(status, row);
    return { panel, status, copyBtn, csvBtn };
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
    ui.copyBtn.disabled = busy;
    ui.csvBtn.disabled = busy;
    ui.copyBtn.style.opacity = busy ? '0.6' : '1';
    ui.csvBtn.style.opacity = busy ? '0.6' : '1';
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
    setBusy(ui, true);
    setStatus(ui, 'Copying roster…', false);
    try {
      const [clipboard, baseRoster, baseVisuals] = await Promise.all([
        fetchJson(rosterApiUrl(route)),
        fetchJson(chrome.runtime.getURL('base-template/roster.json')),
        fetchJson(chrome.runtime.getURL('base-template/character_visuals.json')),
      ]);

      const { roster, visuals, stats } = window.TCRosterMerge.buildPresetPayload(
        clipboard,
        baseRoster,
        baseVisuals
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
      flashStatus(ui, `Copy failed: ${err.message}`, true, 8000);
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
    const routeKey = route ? `${route.gameSlug}/${route.teamSlug}` : null;
    if (routeKey === currentRouteKey) return;
    currentRouteKey = routeKey;

    if (!route) {
      if (ui) { ui.panel.remove(); ui = null; }
      return;
    }
    if (!ui) {
      ui = createPanel();
      document.body.appendChild(ui.panel);
    }
    // New team on screen — drop any message left over from the previous one.
    statusToken++;
    setStatus(ui, '', false);
    setBusy(ui, false);
    ui.copyBtn.onclick = () => copyRoster(ui, route);
    ui.csvBtn.onclick = () => downloadCsv(ui, route);
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
