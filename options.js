// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// options.js — the CSV import page. Parses the user's CSV into the same normalized shape the
// TeamCrafters export returns, runs it through the identical merge, and stores the result so
// inject.js can serve it as a Team Builder preset.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';

  const fileInput = document.getElementById('csvFile');
  const teamInput = document.getElementById('teamName');
  const importBtn = document.getElementById('importBtn');
  const fileHint = document.getElementById('fileHint');
  const resultEl = document.getElementById('result');

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function show(kind, html) {
    resultEl.innerHTML = `<div class="result ${kind}">${html}</div>`;
  }
  function list(items, max = 12) {
    const shown = items.slice(0, max).map((m) => `<li>${esc(m)}</li>`).join('');
    const more = items.length > max ? `<li>…and ${items.length - max} more</li>` : '';
    return `<ul>${shown}${more}</ul>`;
  }

  // --- download the bundled sample ---
  document.getElementById('downloadSample').addEventListener('click', async () => {
    const res = await fetch(chrome.runtime.getURL('sample-roster.csv'));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample-roster.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileHint.textContent = f ? f.name : 'No file chosen';
    importBtn.disabled = !f;
    resultEl.innerHTML = '';
    // default the roster name to the file name, if the user hasn't typed one
    if (f && !teamInput.value.trim()) {
      teamInput.value = f.name.replace(/\.csv$/i, '').replace(/[-_]+/g, ' ').trim();
    }
  });

  importBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importBtn.disabled = true;
    show('warn', 'Importing…');

    try {
      const text = await file.text();
      const teamName = teamInput.value.trim() || 'Imported roster';
      const { errors, warnings, clipboard } = window.TCCsvImport.buildClipboardFromCsv(text, teamName);

      if (errors.length) {
        show('err', `<b>Couldn't import that file.</b>${list(errors)}`);
        importBtn.disabled = false;
        return;
      }

      const [baseRoster, baseVisuals] = await Promise.all([
        fetch(chrome.runtime.getURL('base-template/roster.json')).then((r) => r.json()),
        fetch(chrome.runtime.getURL('base-template/character_visuals.json')).then((r) => r.json()),
      ]);

      const { roster, visuals, stats } = window.TCRosterMerge.buildPresetPayload(
        clipboard, baseRoster, baseVisuals
      );

      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          version: 2,
          teamName,
          displayName: `TeamCrafters: ${teamName}`,
          sourceUrl: null,
          copiedAt: new Date().toISOString(),
          playerCount: clipboard.playerCount,
          stats,
          rosterUrl: window.TCRosterMerge.ROSTER_URL,
          visualsUrl: window.TCRosterMerge.VISUALS_URL,
          rosterJson: JSON.stringify(roster),
          visualsJson: JSON.stringify(visuals),
        },
      });

      const extras = [];
      if (stats.removedFiller) extras.push(`${stats.removedFiller} unused template slots removed`);
      if (stats.unplacedPlayers) extras.push(`${stats.unplacedPlayers} players had no open slot and were skipped`);

      show('ok',
        `<b>Imported ${clipboard.playerCount} players.</b><br>` +
        `Open EA College Football Team Builder, go to the roster presets, and pick ` +
        `<b>“TeamCrafters: ${esc(teamName)}”</b> (it takes Cupcake's spot).` +
        (extras.length ? `<br><span class="muted">${esc(extras.join(' · '))}</span>` : '') +
        `<br><span class="muted">If Team Builder is already open, reload the page first.</span>`
      );
      if (warnings.length) {
        resultEl.innerHTML += `<div class="result warn"><b>${warnings.length} note${warnings.length > 1 ? 's' : ''}:</b>${list(warnings)}</div>`;
      }
    } catch (err) {
      show('err', `<b>Import failed.</b><br>${esc(err.message)}`);
    } finally {
      importBtn.disabled = false;
    }
  });
})();
