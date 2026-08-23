// Team Builder Unleashed
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.

const KEYS = {
  roster: 'tcRosterClipboard',
  uniforms: 'tcUniformClipboard',
  mascot: 'tcMascotClipboard',
  stadium: 'tcStadiumClipboard',
  templates: 'tcSchoolTemplates',
};
const STUDIO_URL = 'https://www.teamcrafters.net/team-builder-unleashed/cfb27';
const HELP_URL = 'https://www.teamcrafters.net/team-builder-unleashed/help';
const updateManager = TeamBuilderUnleashedUpdates;

function formatCheckedAt(timestamp) {
  if (!timestamp) return 'Not checked yet.';
  try {
    return `Checked ${new Date(timestamp).toLocaleString()}.`;
  } catch {
    return 'Checked recently.';
  }
}

function renderUpdate(state) {
  const card = document.getElementById('updateStatus');
  const label = document.getElementById('updateLabel');
  const message = document.getElementById('updateText');
  const link = document.getElementById('updateLink');
  card.dataset.status = state?.status || 'unknown';
  link.hidden = true;

  if (!state || state.status === 'checking') {
    label.textContent = 'Checking…';
    message.textContent = 'Looking for the latest public release.';
    return;
  }

  if (state.status === 'update-available') {
    label.textContent = 'Update available';
    message.textContent = `Version v${state.latestVersion} is ready. You have v${state.installedVersion}.`;
    link.href = state.downloadUrl || state.releaseUrl;
    link.textContent = state.downloadUrl ? 'Download update' : 'View release';
    link.hidden = false;
    return;
  }

  if (state.status === 'ahead') {
    label.textContent = 'Newer build installed';
    message.textContent = `You have v${state.installedVersion}; the latest public release is v${state.latestVersion}. ${formatCheckedAt(state.checkedAt)}`;
    return;
  }

  if (state.status === 'up-to-date') {
    label.textContent = 'Up to date';
    message.textContent = `You have the latest public release (v${state.installedVersion}). ${formatCheckedAt(state.checkedAt)}`;
    return;
  }

  label.textContent = 'Could not check';
  message.textContent = state.lastError || 'No update result is available yet. Check your connection and try again.';
}

async function refreshUpdate(force = false) {
  const button = document.getElementById('checkUpdateBtn');
  button.disabled = true;
  button.textContent = 'Checking…';
  renderUpdate({ status: 'checking' });
  try {
    renderUpdate(await updateManager.checkForUpdates({ force }));
  } finally {
    button.disabled = false;
    button.textContent = 'Check now';
  }
}

function renderMaintenance(stored) {
  const roster = stored[KEYS.roster];
  const uniforms = stored[KEYS.uniforms];
  const mascot = stored[KEYS.mascot];
  const stadium = stored[KEYS.stadium];
  const templates = stored[KEYS.templates];
  document.getElementById('clearRosterBtn').hidden = !roster;
  document.getElementById('clearSaveChangesBtn').hidden = !(
    uniforms || mascot || stadium || (Array.isArray(templates) && templates.length)
  );
}

function openTab(url) {
  chrome.tabs.create({ url });
}

document.getElementById('studioLink').addEventListener('click', (event) => {
  event.preventDefault();
  openTab(STUDIO_URL);
});
document.getElementById('helpLink').addEventListener('click', (event) => {
  event.preventDefault();
  openTab(HELP_URL);
});

document.getElementById('clearRosterBtn').addEventListener('click', async () => {
  if (!confirm('Remove the saved roster? This does not change a team you already saved in EA Team Builder.')) return;
  await chrome.storage.local.remove(KEYS.roster);
});

document.getElementById('clearSaveChangesBtn').addEventListener('click', async () => {
  if (!confirm('Remove saved stadium, mascot, uniform, and school-template changes? This does not change a team you already saved in EA Team Builder.')) return;
  await chrome.storage.local.remove([KEYS.uniforms, KEYS.mascot, KEYS.stadium, KEYS.templates]);
});

chrome.storage.local.get(Object.values(KEYS), renderMaintenance);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (Object.values(KEYS).some((key) => changes[key])) {
    chrome.storage.local.get(Object.values(KEYS), renderMaintenance);
  }
  if (changes[updateManager.UPDATE_STATE_KEY]) {
    renderUpdate(changes[updateManager.UPDATE_STATE_KEY].newValue || null);
  }
});

document.getElementById('checkUpdateBtn').addEventListener('click', () => {
  void refreshUpdate(true);
});

void updateManager.getUpdateState().then(renderUpdate);
void refreshUpdate();
