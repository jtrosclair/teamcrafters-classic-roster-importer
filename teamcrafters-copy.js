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
// Adds a "Copy roster for EA Team Builder" button. On click it fetches the normalized roster
// export, merges it onto the bundled EA base template (see roster-merge.js) to produce a complete
// roster.json + character_visuals.json pair, and stores that in chrome.storage.local. On EA's
// Team Builder, the extension then offers it as an "Import from TeamCrafters" preset.
//
// Runs at document_start and re-checks the route on every client-side navigation (TeamCrafters is
// a Next.js SPA), so the button only shows on an actual classic team page and always targets the
// team currently on screen.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';
  const DEFAULT_LABEL = 'Copy roster for EA Team Builder';
  const POLL_INTERVAL_MS = 400;

  // Sentinel asset URLs the injected EA preset points at. They look like real EA CDN asset URLs
  // (so EA's loader fetches them normally) but carry a "_teamcrafters.json" marker that inject.js
  // recognizes and answers with our stored roster/visuals instead of hitting the network.
  const ROSTER_URL =
    'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-roster.json';
  const VISUALS_URL =
    'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-character_visuals.json';

  function parseRouteParams() {
    const match = location.pathname.match(/^\/app\/classic-rosters\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const [, gameSlug, teamSlug] = match;
    return { gameSlug, teamSlug };
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.textContent = DEFAULT_LABEL;
    btn.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:10px 14px;' +
      'background:#1a73e8;color:#fff;border:none;border-radius:6px;font-family:sans-serif;' +
      'font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    return btn;
  }

  function setStatus(btn, text, isError) {
    btn.textContent = text;
    btn.style.background = isError ? '#b00020' : '#1a73e8';
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

  async function copyRoster(btn, route) {
    setStatus(btn, 'Copying roster…', false);
    try {
      const [clipboard, baseRoster, baseVisuals] = await Promise.all([
        fetchJson(`/api/extension/v1/classic-rosters/${route.gameSlug}/${route.teamSlug}`),
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

      setStatus(btn, `Copied ${clipboard.source.teamName} — pick it in EA Team Builder presets`, false);
      setTimeout(() => setStatus(btn, DEFAULT_LABEL, false), 4000);
    } catch (err) {
      setStatus(btn, `Copy failed: ${err.message}`, true);
      setTimeout(() => setStatus(btn, DEFAULT_LABEL, false), 5000);
    }
  }

  let btn = null;
  let currentRouteKey = null;

  function sync() {
    if (!document.body) return;
    const route = parseRouteParams();
    const routeKey = route ? `${route.gameSlug}/${route.teamSlug}` : null;
    if (routeKey === currentRouteKey) return;
    currentRouteKey = routeKey;

    if (!route) {
      if (btn) { btn.remove(); btn = null; }
      return;
    }
    if (!btn) {
      btn = createButton();
      document.body.appendChild(btn);
    }
    setStatus(btn, DEFAULT_LABEL, false);
    btn.onclick = () => copyRoster(btn, route);
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
