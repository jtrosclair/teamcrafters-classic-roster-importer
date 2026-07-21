# Privacy

This extension is built by TeamCrafters. It does not collect, transmit, or sell any data to
anyone.

## What it accesses

- **teamcrafters.net**: reads the roster export for whatever classic team page you're currently
  on, using a normal same-origin request in your own browser session. No TeamCrafters login,
  cookies, or credentials are read or transmitted by the extension itself.
- **www.ea.com**: reads and can modify the body of the one specific upload request EA's Team
  Builder Save action makes, immediately before it's sent. No other requests, page content,
  cookies, or EA credentials are read or transmitted.

## What it stores

- The most recently copied roster is kept in `chrome.storage.local`, on your device only. It is
  overwritten the next time you copy a different roster, or removed with the popup's "Clear
  copied roster" button.

## What it does NOT do

- No analytics, telemetry, or crash reporting.
- No network requests to any server other than teamcrafters.net (to fetch the export you asked
  for) and whatever EA's own Save action already contacts.
- No reading of other tabs, browsing history, passwords, or autofill data.
- No automatic Save/Publish — every upload still requires you to explicitly choose to send the
  modified payload in the on-page dialog, and to press EA's own Save button.
