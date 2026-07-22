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
// inject.js (MAIN world) cannot call chrome.storage directly, so this relays what's stored into
// the page on request: the TeamCrafters roster clipboard, and the armed uniform set.
(function () {
  const RELAYS = [
    { key: 'tcRosterClipboard', request: 'tc-roster-clipboard-request', response: 'tc-roster-clipboard-response' },
    { key: 'tcUniformClipboard', request: 'tc-uniform-clipboard-request', response: 'tc-uniform-clipboard-response' },
  ];

  for (const relay of RELAYS) {
    window.addEventListener(relay.request, () => {
      chrome.storage.local.get(relay.key, (result) => {
        window.dispatchEvent(
          new CustomEvent(relay.response, { detail: result[relay.key] || null })
        );
      });
    });
  }
})();
