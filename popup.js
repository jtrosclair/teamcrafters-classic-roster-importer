// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

const STORAGE_KEY = 'tcRosterClipboard';

function formatCopiedAt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function render(stored) {
  const statusEl = document.getElementById('status');
  const clearBtn = document.getElementById('clearBtn');

  if (!stored) {
    statusEl.className = 'status-card empty';
    statusEl.innerHTML = `
      <div>No roster copied yet.</div>
      <div class="meta"><a href="https://www.teamcrafters.net/app/classic-rosters" target="_blank" rel="noopener">View all classic rosters &rarr;</a></div>
    `;
    clearBtn.style.display = 'none';
    return;
  }

  const stats = stored.stats || {};
  const extra = [];
  if (stats.removedFiller) extra.push(`${stats.removedFiller} filler slots removed`);
  if (stats.unplacedPlayers) extra.push(`${stats.unplacedPlayers} players didn’t fit`);

  statusEl.className = 'status-card';
  statusEl.innerHTML = `
    <div class="team-name">${stored.teamName ?? 'Unknown team'}</div>
    <div class="meta">${stored.playerCount ?? '?'} players copied</div>
    <div class="meta">Copied ${stored.copiedAt ? formatCopiedAt(stored.copiedAt) : 'unknown time'}</div>
    ${extra.length ? `<div class="meta">${extra.join(' · ')}</div>` : ''}
    ${stored.sourceUrl ? `<div class="meta"><a href="${stored.sourceUrl}" target="_blank" rel="noopener">Preview roster on TeamCrafters &rarr;</a></div>` : ''}
  `;
  clearBtn.style.display = 'block';
}

chrome.storage.local.get(STORAGE_KEY, (result) => {
  render(result[STORAGE_KEY] || null);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.local.remove(STORAGE_KEY, () => render(null));
});
