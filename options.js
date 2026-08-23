// Team Builder Unleashed
// Copyright (C) 2026 TeamCrafters
//
// The web studio owns creator-facing editing. This page intentionally only offers
// shortcuts, a plain-language connection status, and safe recovery controls for
// changes that were already staged in the extension.
(function () {
  const KEYS = {
    roster: 'tcRosterClipboard',
    uniforms: 'tcUniformClipboard',
    mascot: 'tcMascotClipboard',
    stadium: 'tcStadiumClipboard',
    templates: 'tcSchoolTemplates',
  };

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function makeRow(label, detail, ready, action) {
    const row = document.createElement('li');
    row.className = 'status-row';
    const dot = document.createElement('span');
    dot.className = `status-dot${ready ? ' ready' : ''}`;
    dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const heading = document.createElement('span');
    heading.className = 'status-title';
    heading.textContent = label;
    copy.appendChild(heading);
    if (detail) {
      const subheading = document.createElement('span');
      subheading.className = 'status-detail';
      subheading.textContent = detail;
      copy.appendChild(subheading);
    }
    row.append(dot, copy);
    if (action) {
      const link = document.createElement('a');
      link.className = 'status-action';
      link.href = action.href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = action.label;
      row.appendChild(link);
    }
    return row;
  }

  function renderStatus(stored) {
    const list = document.getElementById('statusList');
    const roster = stored[KEYS.roster];
    const uniforms = stored[KEYS.uniforms];
    const mascot = stored[KEYS.mascot];
    const stadium = stored[KEYS.stadium];
    const templates = stored[KEYS.templates];
    const rows = [];

    if (roster?.rosterJson && roster?.visualsJson) {
      const count = Number.isInteger(roster.playerCount) ? `${roster.playerCount} players` : 'Roster ready';
      rows.push(makeRow('Roster ready', `${text(roster.teamName) || 'Your roster'} · ${count}`, true, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/cfb27', label: 'Open studio',
      }));
    }
    if (Array.isArray(uniforms?.uniforms) && uniforms.uniforms.length) {
      rows.push(makeRow('Uniforms ready', `${uniforms.uniforms.length} selected for your next save`, true, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/help/cfb27/uniforms', label: 'View guide',
      }));
    }
    if (text(mascot?.assetName)) {
      rows.push(makeRow('Mascot ready', text(mascot.mascotName) || text(mascot.teamName) || 'Selected mascot', true, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/cfb27', label: 'Open studio',
      }));
    }
    if (Number.isInteger(stadium?.stadiumId)) {
      rows.push(makeRow('Stadium ready', text(stadium.displayName) || 'Selected stadium', true, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/cfb27', label: 'Open studio',
      }));
    }
    if (Array.isArray(templates) && templates.length) {
      rows.push(makeRow('School templates ready', `${templates.length} saved template${templates.length === 1 ? '' : 's'} available in Team Builder`, true, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/cfb27', label: 'Open studio',
      }));
    }
    if (!rows.length) {
      rows.push(makeRow('Nothing is staged yet', 'Open the CFB 27 studio, choose a change, then return to Team Builder when you are ready to save.', false, {
        href: 'https://www.teamcrafters.net/team-builder-unleashed/cfb27', label: 'Open studio',
      }));
    }
    list.replaceChildren(...rows);

    document.getElementById('clearRosterBtn').hidden = !roster;
    document.getElementById('clearSaveChangesBtn').hidden = !(
      uniforms || mascot || stadium || (Array.isArray(templates) && templates.length)
    );
  }

  document.getElementById('clearRosterBtn').addEventListener('click', async () => {
    if (!confirm('Remove the saved roster? This does not change a team you already saved in EA Team Builder.')) return;
    await chrome.storage.local.remove(KEYS.roster);
  });

  document.getElementById('clearSaveChangesBtn').addEventListener('click', async () => {
    if (!confirm('Remove saved stadium, mascot, uniform, and school-template changes? This does not change a team you already saved in EA Team Builder.')) return;
    await chrome.storage.local.remove([KEYS.uniforms, KEYS.mascot, KEYS.stadium, KEYS.templates]);
  });

  chrome.storage.local.get(Object.values(KEYS), renderStatus);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !Object.values(KEYS).some((key) => changes[key])) return;
    chrome.storage.local.get(Object.values(KEYS), renderStatus);
  });
})();
