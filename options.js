// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// options.js — the options page. It hosts the uniform picker and CSV importer, which both store
// their prepared data so inject.js can serve it as a Team Builder preset or save-time update.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';
  const UNIFORM_KEY = 'tcUniformClipboard';

  // --- tabs ------------------------------------------------------------------------------
  // Two independent tools live on this page — the uniform picker and the CSV importer — and each
  // is a lot of information, so only one panel shows at a time. The popup links here with a
  // #panel-… hash to open the right one; default is uniforms. Keep the state in the URL so popup
  // links can open the appropriate tool and browser back/forward navigation remains intuitive.
  const tabs = [...document.querySelectorAll('.tab')];
  function showTab(panelId) {
    const valid = tabs.some((t) => t.dataset.panel === panelId);
    const target = valid ? panelId : 'panel-uniforms';
    for (const tab of tabs) {
      const on = tab.dataset.panel === target;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.dataset.panel);
      panel.classList.toggle('active', on);
      panel.hidden = !on;
    }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.panel);
      history.pushState(null, '', '#' + tab.dataset.panel);
    });
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1));

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

  // --- team uniforms ---------------------------------------------------------------------
  // Pick a school; its whole uniform set is converted to EA's payload shape here and stored, so
  // the page on ea.com never needs the catalog.
  const uniSearch = document.getElementById('uniformSearch');
  const teamListEl = document.getElementById('teamList');
  const previewEl = document.getElementById('uniformPreview');
  const armBtn = document.getElementById('armUniformsBtn');
  const uniHint = document.getElementById('uniformHint');
  const armedEl = document.getElementById('uniformArmed');
  const pickerEl = document.getElementById('uniformPicker');
  const clearUniBtn = document.getElementById('clearUniformsBtn');

  let catalog = null;
  let selectedTeam = null;

  function renderTeamList(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const names = Object.keys(catalog.teams).filter((n) => {
      if (!q) return true;
      const t = catalog.teams[n];
      return n.toLowerCase().includes(q) || String(t.abbr || '').toLowerCase().includes(q);
    });
    if (!names.length) {
      teamListEl.innerHTML = '<div class="none">No teams match that search.</div>';
      return;
    }
    teamListEl.innerHTML = names
      .map((n) => {
        const t = catalog.teams[n];
        const count = t.uniforms.length;
        return `<div class="team-row${n === selectedTeam ? ' selected' : ''}" data-team="${esc(n)}">
          <span class="nm">${esc(n)}</span>
          <span class="ab">${esc(t.abbr || '')}</span>
          <span class="ct">${count} uniform${count === 1 ? '' : 's'}</span>
        </div>`;
      })
      .join('');
  }

  function renderPreview() {
    if (!selectedTeam) {
      previewEl.innerHTML = '';
      armBtn.disabled = true;
      uniHint.textContent = 'No team selected';
      return;
    }
    const team = catalog.teams[selectedTeam];
    const rows = team.uniforms
      .map((u) => {
        // loadoutType 6 is EA's dark/home slot, 3 is light/away.
        const dark = u.loadoutType === 6;
        return `<div class="uni-row">
          <span class="un">${esc(u.displayName)}</span>
          <span class="chip ${dark ? 'dark' : 'light'}">${dark ? 'DARK' : 'LIGHT'}</span>
          ${u.currentOfficial ? '<span class="chip official">CURRENT</span>' : ''}
        </div>`;
      })
      .join('');
    previewEl.innerHTML =
      `<p class="sub" style="margin-bottom:2px;"><b>${esc(selectedTeam)}</b> — ` +
      `${team.uniforms.length} uniform${team.uniforms.length === 1 ? '' : 's'}</p>${rows}`;
    armBtn.disabled = false;
    uniHint.textContent = '';
  }

  function renderArmed(armed) {
    if (!armed) {
      armedEl.style.display = 'none';
      pickerEl.style.display = '';
      clearUniBtn.style.display = 'none';
      return;
    }
    armedEl.style.display = 'block';
    armedEl.innerHTML =
      `<b>${esc(armed.teamName)}'s ${armed.uniformCount} uniforms are ready.</b><br>` +
      `Save your team in EA Team Builder to apply them — you'll be asked to confirm first.` +
      `<br><span class="muted">If Team Builder is already open, reload the page.</span>`;
    pickerEl.style.display = 'none';
    clearUniBtn.style.display = 'inline-block';
  }

  teamListEl.addEventListener('click', (e) => {
    const row = e.target.closest('.team-row');
    if (!row) return;
    selectedTeam = row.dataset.team;
    renderTeamList(uniSearch.value);
    renderPreview();
  });

  uniSearch.addEventListener('input', () => renderTeamList(uniSearch.value));

  armBtn.addEventListener('click', async () => {
    if (!selectedTeam) return;
    armBtn.disabled = true;
    try {
      const set = window.TCUniformBuild.buildUniformSet(selectedTeam, catalog.teams[selectedTeam]);
      await chrome.storage.local.set({ [UNIFORM_KEY]: set });
      renderArmed(set);
    } catch (err) {
      uniHint.textContent = `Couldn't use those uniforms: ${err.message}`;
      armBtn.disabled = false;
    }
  });

  clearUniBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(UNIFORM_KEY);
    selectedTeam = null;
    renderArmed(null);
    renderTeamList(uniSearch.value);
    renderPreview();
  });

  (async function initUniforms() {
    try {
      const response = await fetch(chrome.runtime.getURL('uniform-catalog.json'));
      if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
      // JSON.parse rejects a UTF-8 BOM. Accept it because catalog exports from Windows tools
      // commonly include one, then normalize the current and legacy catalog schemas.
      const text = await response.text();
      catalog = window.TCUniformBuild.normalizeCatalog(JSON.parse(text.replace(/^\uFEFF/, '')));
      uniSearch.placeholder = `Search ${catalog.teamCount} teams…`;
      renderTeamList('');
      const stored = await chrome.storage.local.get(UNIFORM_KEY);
      renderArmed(stored[UNIFORM_KEY] || null);
    } catch (err) {
      document.getElementById('uniformCard').innerHTML =
        `<h2>Team uniforms</h2><div class="result err">Couldn't load the uniform catalog: ${esc(err.message)}</div>`;
    }
  })();

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
