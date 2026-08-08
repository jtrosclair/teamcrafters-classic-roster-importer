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
  const MASCOT_KEY = 'tcMascotClipboard';
  const STADIUM_KEY = 'tcStadiumClipboard';
  const SCHOOL_TEMPLATE_KEY = 'tcSchoolTemplates';

  // --- tabs ------------------------------------------------------------------------------
  // Independent tools live on this page — the uniform picker, CSV importer and equipment launcher — and each
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

  // --- Team Builder Unleashed launcher ---------------------------------------------------
  // The full visual editor is a TeamCrafters web page. This options tab only confirms which
  // clipboard the bridge will expose and offers a convenient path back to CSV import.
  const equipmentLaunchStatus = document.getElementById('equipmentLaunchStatus');
  function renderEquipmentLaunchStatus(stored) {
    if (!stored?.rosterJson || !stored?.visualsJson) {
      equipmentLaunchStatus.innerHTML =
        '<strong>No roster is ready yet.</strong>Copy a classic team or import a CSV, then open Team Builder Unleashed.';
      return;
    }
    const edited = stored.equipmentEditedAt
      ? ` · Equipment saved ${new Date(stored.equipmentEditedAt).toLocaleString()}`
      : '';
    equipmentLaunchStatus.innerHTML =
      `<strong>${esc(stored.teamName || 'Imported roster')} is ready.</strong>` +
      `${esc(stored.playerCount ?? '?')} players are available to the web editor${esc(edited)}.`;
  }

  chrome.storage.local.get(STORAGE_KEY).then((result) => {
    renderEquipmentLaunchStatus(result[STORAGE_KEY]);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      renderEquipmentLaunchStatus(changes[STORAGE_KEY].newValue);
    }
  });
  document.getElementById('equipmentGoToImport').addEventListener('click', () => {
    document.getElementById('tab-csv').click();
  });

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

  // --- custom school templates -----------------------------------------------------------
  // EA represents grades as ranks: 0 is A+, 12 is F. A normal grade has matching min/max
  // values; the game only supports a real range for Pro Potential, where the lower grade is the
  // larger numeric rank (for example F (12) through C+ (6)).
  const GRADE_LABELS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
  const SCHOOL_FIXED_GRADES = [
    {
      id: 'CHAMPIONSHIP_CONTENDER_GRADE', displayName: 'Championship Contender',
      description: 'Championship contender will change depending on your final roster composition and the team you replace in Dynasty',
    },
    { id: 'PROGRAM_TRADITION_GRADE', displayName: 'Program Tradition', description: '' },
    { id: 'CAMPUS_LIFESTYLE_GRADE', displayName: 'Campus Lifestyle', description: '' },
    {
      id: 'STADIUM_ATMOSTPHERE_GRADE', displayName: 'Stadium Atmosphere',
      description: 'Your final stadium atmosphere grade will change based on the stadium you select for your team',
    },
    { id: 'BRAND_EXPOSURE_GRADE', displayName: 'Brand Exposure', description: '' },
    { id: 'ACADEMIC_PRESTIGE', displayName: 'Academic Prestige', description: '' },
    {
      id: 'ATHLETIC_FACILITIES_GRADE', displayName: 'Athletic Facilities',
      description: 'Your athletic facilities grade may change based on your final team prestige grade',
    },
  ];
  const PRO_POTENTIAL_GRADE = {
    id: 'PRO_POTENTIAL_GRADE', displayName: 'Pro Potential',
    description: 'Pro potential will change depending on your final roster composition and the team you replace in dynasty',
  };
  const AUTOMATIC_COACH_GRADES = [
    {
      id: 'COACH_STABILITY_GRADE', displayName: 'Coach Stability',
      description: 'Coach stability will be impacted by the team you replace in Dynasty mode',
    },
    {
      id: 'COACH_PRESTIGE_GRADE', displayName: 'Coach Prestige',
      description: 'Coach prestige will be impacted by the team you replace in Dynasty mode',
    },
    {
      id: 'CONFERENCE_PRESTIGE_GRADE', displayName: 'Conference Prestige',
      description: 'Conference prestige will be impacted by the team you replace in Dynasty mode',
    },
  ];
  const schoolTemplateForm = document.getElementById('schoolTemplateForm');
  const schoolTemplateName = document.getElementById('schoolTemplateName');
  const schoolTemplatePrestige = document.getElementById('schoolTemplatePrestige');
  const fixedGradeFields = document.getElementById('fixedGradeFields');
  const proPotentialMin = document.getElementById('proPotentialMin');
  const proPotentialMax = document.getElementById('proPotentialMax');
  const schoolTemplateResult = document.getElementById('schoolTemplateResult');
  const schoolTemplateList = document.getElementById('schoolTemplateList');

  function gradeOptions(selected = 6) {
    // Present grades in the natural user-facing order (F through A+), even though EA encodes
    // them in the opposite numeric direction (12 through 0).
    return GRADE_LABELS.map((label, value) => ({ label, value })).reverse().map(({ label, value }) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
    ).join('');
  }

  function gradeSummary(min, max) {
    return min === max ? GRADE_LABELS[min] : `${GRADE_LABELS[min]} to ${GRADE_LABELS[max]}`;
  }

  function renderSchoolTemplateForm() {
    fixedGradeFields.innerHTML = SCHOOL_FIXED_GRADES.map((grade) =>
      `<label>${esc(grade.displayName)}<select data-school-grade="${grade.id}" required>${gradeOptions()}</select></label>`
    ).join('');
    proPotentialMin.innerHTML = gradeOptions(12);
    proPotentialMax.innerHTML = gradeOptions(6);
  }

  function isSchoolTemplate(template) {
    if (!template || !Number.isInteger(template.id) || typeof template.displayName !== 'string') return false;
    if (!Number.isInteger(template.prestige) || template.prestige < 0 || template.prestige > 10) return false;
    return Array.isArray(template.grades) && template.grades.length === 11;
  }

  function renderSchoolTemplateList(templates) {
    const validTemplates = Array.isArray(templates) ? templates.filter(isSchoolTemplate) : [];
    if (!validTemplates.length) {
      schoolTemplateList.innerHTML = '<p class="muted">No custom school templates yet.</p>';
      return;
    }
    schoolTemplateList.innerHTML = `<table><tr><th>Name</th><th>Prestige</th><th>Pro Potential</th><th></th></tr>${validTemplates
      .map((template) => {
        const pro = template.grades.find((grade) => grade?.id === PRO_POTENTIAL_GRADE.id);
        const range = pro && Number.isInteger(pro.min) && Number.isInteger(pro.max)
          ? gradeSummary(pro.min, pro.max) : 'Invalid';
        return `<tr><td><b>${esc(template.displayName)}</b></td><td>${template.prestige}</td>` +
          `<td>${esc(range)}</td><td><button type="button" data-delete-school-template="${template.id}">Delete</button></td></tr>`;
      }).join('')}</table>`;
  }

  function nextSchoolTemplateId(templates) {
    const used = new Set((Array.isArray(templates) ? templates : [])
      .filter((template) => Number.isInteger(template?.id)).map((template) => template.id));
    let id = 13; // The supplied EA list uses the built-in IDs 0–12.
    while (used.has(id)) id++;
    return id;
  }

  function showSchoolTemplateResult(kind, message) {
    schoolTemplateResult.innerHTML = `<div class="result ${kind}">${message}</div>`;
  }

  function buildSchoolTemplate(existing) {
    const displayName = schoolTemplateName.value.trim();
    const prestige = Number(schoolTemplatePrestige.value);
    const proMin = Number(proPotentialMin.value);
    const proMax = Number(proPotentialMax.value);
    if (!displayName) throw new Error('Enter a template name.');
    if (displayName.length > 60) throw new Error('Template names can be at most 60 characters.');
    if (!Number.isInteger(prestige) || prestige < 0 || prestige > 10) {
      throw new Error('Prestige must be a whole number from 0 to 10.');
    }
    if (!Number.isInteger(proMin) || !Number.isInteger(proMax) || proMin < proMax) {
      throw new Error('Pro Potential must run from the lower grade to the higher grade (for example F to C+).');
    }
    const grades = SCHOOL_FIXED_GRADES.map((grade) => {
      const select = fixedGradeFields.querySelector(`[data-school-grade="${grade.id}"]`);
      const value = Number(select?.value);
      if (!Number.isInteger(value) || value < 0 || value > 12) {
        throw new Error(`Choose a valid grade for ${grade.displayName}.`);
      }
      return { ...grade, min: value, max: value, ratingSummary: gradeSummary(value, value) };
    });
    grades.splice(4, 0, {
      ...PRO_POTENTIAL_GRADE,
      min: proMin,
      max: proMax,
      ratingSummary: gradeSummary(proMin, proMax),
    });
    grades.push(...AUTOMATIC_COACH_GRADES.map((grade) => ({
      ...grade, min: -1, max: -1, ratingSummary: '',
    })));
    return { id: nextSchoolTemplateId(existing), displayName, prestige, grades };
  }

  schoolTemplateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const stored = await chrome.storage.local.get(SCHOOL_TEMPLATE_KEY);
      const templates = Array.isArray(stored[SCHOOL_TEMPLATE_KEY]) ? stored[SCHOOL_TEMPLATE_KEY] : [];
      const template = buildSchoolTemplate(templates);
      await chrome.storage.local.set({ [SCHOOL_TEMPLATE_KEY]: [...templates, template] });
      renderSchoolTemplateList([...templates, template]);
      schoolTemplateForm.reset();
      schoolTemplatePrestige.value = '5';
      renderSchoolTemplateForm();
      showSchoolTemplateResult('ok', `<b>${esc(template.displayName)} was added.</b><br>Reload Team Builder to see it in the school-template picker.`);
    } catch (error) {
      showSchoolTemplateResult('err', esc(error.message || 'Could not add that school template.'));
    }
  });

  schoolTemplateList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-school-template]');
    if (!button) return;
    const id = Number(button.dataset.deleteSchoolTemplate);
    const stored = await chrome.storage.local.get(SCHOOL_TEMPLATE_KEY);
    const templates = Array.isArray(stored[SCHOOL_TEMPLATE_KEY]) ? stored[SCHOOL_TEMPLATE_KEY] : [];
    const remaining = templates.filter((template) => template?.id !== id);
    await chrome.storage.local.set({ [SCHOOL_TEMPLATE_KEY]: remaining });
    renderSchoolTemplateList(remaining);
    showSchoolTemplateResult('ok', 'School template removed. Reload Team Builder to update its picker.');
  });

  (async function initSchoolTemplates() {
    renderSchoolTemplateForm();
    const stored = await chrome.storage.local.get(SCHOOL_TEMPLATE_KEY);
    renderSchoolTemplateList(stored[SCHOOL_TEMPLATE_KEY]);
  })();

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
  // { helmet: {...}, pants: {...}, jersey: {...}, socks: {...} } — bundled part recipes, loaded
  // lazily alongside the catalog.
  // Missing/failed loads are non-fatal: uniforms still import, just without editable parts.
  let partRecipes = {};

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
      const set = window.TCUniformBuild.buildUniformSet(
        selectedTeam, catalog.teams[selectedTeam], partRecipes
      );
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
      loadPartRecipes(); // non-blocking; the picker works with or without it
    } catch (err) {
      document.getElementById('uniformCard').innerHTML =
        `<h2>Team uniforms</h2><div class="result err">Couldn't load the uniform catalog: ${esc(err.message)}</div>`;
    }
  })();

  // --- team mascot -----------------------------------------------------------------------
  // The mascot table's TMAN value is the exact asset name Team Builder stores in teamInfos.
  const mascotSearch = document.getElementById('mascotSearch');
  const mascotListEl = document.getElementById('mascotList');
  const mascotPreviewEl = document.getElementById('mascotPreview');
  const armMascotBtn = document.getElementById('armMascotBtn');
  const mascotHint = document.getElementById('mascotHint');
  const mascotArmedEl = document.getElementById('mascotArmed');
  const mascotPickerEl = document.getElementById('mascotPicker');
  const clearMascotBtn = document.getElementById('clearMascotBtn');
  let mascots = [];
  let selectedMascot = null;

  function renderMascotList(filter) {
    const query = String(filter || '').trim().toLowerCase();
    const matches = mascots.filter((mascot) => !query ||
      [mascot.teamName, mascot.mascotName, mascot.assetName]
        .some((value) => value.toLowerCase().includes(query))
    );
    if (!matches.length) {
      mascotListEl.innerHTML = '<div class="none">No mascots match that search.</div>';
      return;
    }
    mascotListEl.innerHTML = matches.map((mascot) =>
      `<div class="team-row${mascot.assetName === selectedMascot ? ' selected' : ''}" ` +
      `data-mascot="${esc(mascot.assetName)}">` +
      `<span class="nm">${esc(mascot.teamName)}</span>` +
      `<span class="ct">${esc(mascot.mascotName)}</span>` +
      `<span class="ab">${esc(mascot.assetName)}</span>` +
      '</div>'
    ).join('');
  }

  function renderMascotPreview() {
    const mascot = mascots.find((entry) => entry.assetName === selectedMascot);
    if (!mascot) {
      mascotPreviewEl.innerHTML = '';
      armMascotBtn.disabled = true;
      mascotHint.textContent = 'No mascot selected';
      return;
    }
    mascotPreviewEl.innerHTML =
      `<p class="sub" style="margin-bottom:2px;"><b>${esc(mascot.teamName)}</b> — ` +
      `${esc(mascot.mascotName)} <code>${esc(mascot.assetName)}</code></p>`;
    armMascotBtn.disabled = false;
    mascotHint.textContent = '';
  }

  function renderArmedMascot(armed) {
    if (!armed?.assetName) {
      mascotArmedEl.style.display = 'none';
      mascotPickerEl.style.display = '';
      clearMascotBtn.style.display = 'none';
      return;
    }
    mascotArmedEl.style.display = 'block';
    mascotArmedEl.innerHTML =
      `<b>${esc(armed.teamName || 'Selected team')} — ${esc(armed.mascotName || 'mascot')} is ready.</b><br>` +
      `The next Team Builder save writes <code>${esc(armed.assetName)}</code> as the mascot asset.` +
      `<br><span class="muted">It stays armed until you clear it.</span>`;
    mascotPickerEl.style.display = 'none';
    clearMascotBtn.style.display = 'inline-block';
  }

  mascotListEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-mascot]');
    if (!row) return;
    selectedMascot = row.dataset.mascot;
    renderMascotList(mascotSearch.value);
    renderMascotPreview();
  });
  mascotSearch.addEventListener('input', () => renderMascotList(mascotSearch.value));

  armMascotBtn.addEventListener('click', async () => {
    const mascot = mascots.find((entry) => entry.assetName === selectedMascot);
    if (!mascot) return;
    armMascotBtn.disabled = true;
    const armed = { ...mascot };
    await chrome.storage.local.set({ [MASCOT_KEY]: armed });
    renderArmedMascot(armed);
  });

  clearMascotBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(MASCOT_KEY);
    selectedMascot = null;
    renderArmedMascot(null);
    renderMascotList(mascotSearch.value);
    renderMascotPreview();
  });

  (async function initMascots() {
    try {
      const response = await fetch(chrome.runtime.getURL('reference/mascots.json'));
      if (!response.ok) throw new Error(`Mascot catalog request failed (${response.status}).`);
      const rows = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
      if (!Array.isArray(rows)) throw new Error('Mascot catalog is not a list.');
      mascots = rows
        .filter((row) => row && typeof row.TMAN === 'string' && typeof row.TeamName === 'string' &&
          typeof row.MascotName === 'string')
        .map((row) => ({
          assetName: row.TMAN.trim(),
          teamName: row.TeamName.trim(),
          mascotName: row.MascotName.trim(),
        }))
        .filter((mascot) => mascot.assetName && mascot.teamName && mascot.mascotName)
        .sort((a, b) => a.teamName.localeCompare(b.teamName));
      if (!mascots.length) throw new Error('Mascot catalog has no valid entries.');
      mascotSearch.placeholder = `Search ${mascots.length} teams or mascots…`;
      renderMascotList('');
      const stored = await chrome.storage.local.get(MASCOT_KEY);
      renderArmedMascot(stored[MASCOT_KEY] || null);
    } catch (err) {
      document.getElementById('mascotCard').innerHTML =
        `<h2>Team mascot</h2><div class="result err">Couldn't load the mascot catalog: ${esc(err.message)}</div>`;
    }
  })();

  // --- stadium ---------------------------------------------------------------------------
  // Stadium ids are stored as strings in Team Builder's teamInfos payload, but remain numbers in
  // this picker so the reference catalog can be validated without coercion.
  const stadiumSearch = document.getElementById('stadiumSearch');
  const stadiumListEl = document.getElementById('stadiumList');
  const stadiumPreviewEl = document.getElementById('stadiumPreview');
  const armStadiumBtn = document.getElementById('armStadiumBtn');
  const stadiumHint = document.getElementById('stadiumHint');
  const stadiumArmedEl = document.getElementById('stadiumArmed');
  const stadiumPickerEl = document.getElementById('stadiumPicker');
  const clearStadiumBtn = document.getElementById('clearStadiumBtn');
  let stadiums = [];
  let selectedStadium = null;

  function renderStadiumList(filter) {
    const query = String(filter || '').trim().toLowerCase();
    const matches = stadiums.filter((stadium) => !query ||
      stadium.displayName.toLowerCase().includes(query) || String(stadium.stadiumId).includes(query)
    );
    if (!matches.length) {
      stadiumListEl.innerHTML = '<div class="none">No stadiums match that search.</div>';
      return;
    }
    stadiumListEl.innerHTML = matches.map((stadium) =>
      `<div class="team-row${stadium.stadiumId === selectedStadium ? ' selected' : ''}" ` +
      `data-stadium="${stadium.stadiumId}">` +
      `<span class="nm">${esc(stadium.displayName)}</span>` +
      `<span class="ab">${stadium.stadiumId}</span>` +
      '</div>'
    ).join('');
  }

  function renderStadiumPreview() {
    const stadium = stadiums.find((entry) => entry.stadiumId === selectedStadium);
    if (!stadium) {
      stadiumPreviewEl.innerHTML = '';
      armStadiumBtn.disabled = true;
      stadiumHint.textContent = 'No stadium selected';
      return;
    }
    stadiumPreviewEl.innerHTML =
      `<p class="sub" style="margin-bottom:2px;"><b>${esc(stadium.displayName)}</b> ` +
      `<code>${stadium.stadiumId}</code></p>`;
    armStadiumBtn.disabled = false;
    stadiumHint.textContent = '';
  }

  function renderArmedStadium(armed) {
    if (!Number.isInteger(armed?.stadiumId)) {
      stadiumArmedEl.style.display = 'none';
      stadiumPickerEl.style.display = '';
      clearStadiumBtn.style.display = 'none';
      return;
    }
    stadiumArmedEl.style.display = 'block';
    stadiumArmedEl.innerHTML =
      `<b>${esc(armed.displayName || 'Selected stadium')} is ready.</b><br>` +
      `The next Team Builder save writes <code>${armed.stadiumId}</code> as the stadium ID.` +
      `<br><span class="muted">It stays armed until you clear it.</span>`;
    stadiumPickerEl.style.display = 'none';
    clearStadiumBtn.style.display = 'inline-block';
  }

  stadiumListEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-stadium]');
    if (!row) return;
    selectedStadium = Number(row.dataset.stadium);
    renderStadiumList(stadiumSearch.value);
    renderStadiumPreview();
  });
  stadiumSearch.addEventListener('input', () => renderStadiumList(stadiumSearch.value));

  armStadiumBtn.addEventListener('click', async () => {
    const stadium = stadiums.find((entry) => entry.stadiumId === selectedStadium);
    if (!stadium) return;
    armStadiumBtn.disabled = true;
    const armed = { ...stadium };
    await chrome.storage.local.set({ [STADIUM_KEY]: armed });
    renderArmedStadium(armed);
  });

  clearStadiumBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(STADIUM_KEY);
    selectedStadium = null;
    renderArmedStadium(null);
    renderStadiumList(stadiumSearch.value);
    renderStadiumPreview();
  });

  (async function initStadiums() {
    try {
      const response = await fetch(chrome.runtime.getURL('reference/stadiums.json'));
      if (!response.ok) throw new Error(`Stadium catalog request failed (${response.status}).`);
      const rows = JSON.parse((await response.text()).replace(/^\uFEFF/, ''));
      if (!Array.isArray(rows)) throw new Error('Stadium catalog is not a list.');
      stadiums = rows
        .filter((row) => row && Number.isInteger(row.id) && typeof row.displayName === 'string')
        .map((row) => ({ stadiumId: row.id, displayName: row.displayName.trim() }))
        .filter((stadium) => stadium.stadiumId >= 0 && stadium.displayName)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      if (!stadiums.length) throw new Error('Stadium catalog has no valid entries.');
      stadiumSearch.placeholder = `Search ${stadiums.length} stadiums…`;
      renderStadiumList('');
      const stored = await chrome.storage.local.get(STADIUM_KEY);
      renderArmedStadium(stored[STADIUM_KEY] || null);
    } catch (err) {
      document.getElementById('stadiumCard').innerHTML =
        `<h2>Stadium</h2><div class="result err">Couldn't load the stadium catalog: ${esc(err.message)}</div>`;
    }
  })();

  // Load bundled part recipes. Best-effort: if a bundle is missing or malformed, imports still
  // work — that part simply won't be editable in-game. The jersey asset folder/bundle is named
  // "jerseys", while a uniform's slot and uniform-build.js use the singular key "jersey".
  async function loadPartRecipes() {
    for (const { kind, fileKind } of [
      { kind: 'helmet', fileKind: 'helmets' },
      { kind: 'pants', fileKind: 'pants' },
      { kind: 'jersey', fileKind: 'jerseys' },
      { kind: 'socks', fileKind: 'socks' },
    ]) {
      try {
        const res = await fetch(chrome.runtime.getURL(`uniform-recipes-${fileKind}.json`));
        if (!res.ok) continue;
        const doc = JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
        if (doc && doc.recipes) partRecipes[kind] = doc.recipes;
      } catch { /* leave this kind out; non-fatal */ }
    }
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
      const portraitCatalog = await window.TCRosterMerge.loadPortraitCatalog();
      const { errors, warnings, clipboard } = window.TCCsvImport.buildClipboardFromCsv(
        text, teamName, portraitCatalog
      );

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
        clipboard, baseRoster, baseVisuals, portraitCatalog
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
