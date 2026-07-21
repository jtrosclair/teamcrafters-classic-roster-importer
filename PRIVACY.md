# Privacy

This extension is built by TeamCrafters. It does not collect, transmit, or sell any data to
anyone.

## Where it runs

It only loads on two specific places — nowhere else on the web:

- `https://www.teamcrafters.net/app/classic-rosters/*` (classic roster pages)
- `https://www.ea.com/games/ea-sports-college-football/team-builder/*` (EA Team Builder)

## What it accesses

- **TeamCrafters classic-roster pages**: when you click "Copy roster", it requests that team's
  roster export with a normal same-origin request in your own browser session. No TeamCrafters
  login, cookies, or credentials are read or transmitted by the extension.
- **EA Team Builder**: it watches the page's own network calls and responds to exactly three of
  them — the roster-presets list (to add the copied roster as a preset), the two asset URLs
  belonging to that injected preset (answered locally from your copied roster), and the
  name-generator pool (emptied while a roster is copied, so imported names aren't overwritten).
  It does not read or modify any other request, page content, cookie, or EA credential.

## What it stores

- The most recently copied roster is kept in `chrome.storage.local`, on your device only. It is
  overwritten the next time you copy a different roster, or removed with the popup's "Clear
  copied roster" button.

## What it does NOT do

- No analytics, telemetry, or crash reporting.
- No network requests to any server other than teamcrafters.net, to fetch the export you asked
  for. The injected preset's asset URLs are answered locally and never leave your machine.
- It never uploads anything to EA, and never modifies what EA saves. Loading a preset only
  changes the roster in the editor; persisting it is entirely EA's own **Save** button, which
  you press yourself.
- No reading of other tabs, browsing history, passwords, or autofill data.
