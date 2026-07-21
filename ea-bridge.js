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
// inject.js (MAIN world) cannot call chrome.storage directly, so this relays the
// TeamCrafters roster clipboard from extension storage into the page on request.
(function () {
  const STORAGE_KEY = 'tcRosterClipboard';

  window.addEventListener('tc-roster-clipboard-request', () => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      window.dispatchEvent(
        new CustomEvent('tc-roster-clipboard-response', {
          detail: result[STORAGE_KEY] || null,
        })
      );
    });
  });
})();
