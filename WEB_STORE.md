# Chrome Web Store submission

Version 0.7.3 was submitted for review on November 1, 2026 under extension ID
`eijdlhodkkagjhdidffldhbimkdddepc`, with automatic publication after approval.
The listing is free, public, and available in all regions. The public privacy
policy for the Store submission is
`https://gist.github.com/jtrosclair/d3781486ccae1a682a901fea5bba6d86`.

Chrome Web Store publishing uses a Chrome Web Store developer account; Google
Play developer registration alone does not register that account.

Build the upload file with `python3 tools/package-web-store.py`. Upload
`release/team-builder-unleashed-web-store-v0.7.3.zip` in the Chrome Web Store
Developer Dashboard. `manifest.json` is at the root of the ZIP. The ZIP excludes
tests, old releases, development data, and the GitHub release checker.

## Suggested listing copy

**Name:** Team Builder Unleashed

**Short description:** Connect the TeamCrafters Studio to EA Sports College
Football 27 Team Builder.

**Single purpose:** Carry roster, player, stadium, mascot, and school template
changes selected in the TeamCrafters Studio into EA Team Builder when the user
presses EA's Save button.

**Detailed description:**

> Team Builder Unleashed connects the TeamCrafters web studio with EA Sports
> College Football 27 Team Builder. Choose roster, player, stadium, mascot,
> prestige, or template changes in the Studio. The extension keeps those choices
> ready in your browser and applies them when you use Team Builder's normal Save
> button. A small status bar shows the changes ready for your next save.
>
> The extension also lets you copy supported TeamCrafters teams and EA Team
> Builder previews into a roster preset, import or export a roster CSV, and
> remove staged changes from its popup.
>
> Requires access to the TeamCrafters Studio and EA Team Builder in Chrome.
> Built by TeamCrafters. Not affiliated with or endorsed by Electronic Arts.

**Support:** Use the project's GitHub issues page or the support link in the
extension. **Privacy policy:** Publish the current `PRIVACY.md` at a public URL
and enter that URL in the dashboard. The policy in the repository must be pushed
before using its GitHub URL.

## Privacy practices and permissions

- `storage`: Holds the user-selected roster and staged team changes on this device
  until replaced or removed. The popup and options page provide removal controls.
- TeamCrafters content-script matches: Let users copy supported public rosters
  and exchange Studio selections with extension-local storage.
- EA Team Builder content-script match: Lets the extension prepare the selected
  roster and team changes in the editor and apply them when the user saves.
- Remote code: No. All executable JavaScript is in the submitted ZIP. The
  TeamCrafters API and EA responses provide data used by packaged code.

Review the dashboard's data-use questions against the actual behavior and the
published privacy policy before submitting. The extension processes website
content and user-created roster/team data. It does not include analytics or sell
that data.

## Listing images and submission

Use `icons/icon128.png` as the 128×128 store icon. The dashboard requires at least
one real screenshot. Capture the current Studio, popup, or Team Builder status
bar from a working browser session and keep listing images outside the extension
ZIP. Do not show real account or team information without permission.

After filling in the Store listing, Privacy practices, and Distribution tabs,
submit the package for review. A published Store install gets Chrome's automatic
extension updates. For every later update, increase `manifest.json`'s version,
build and upload a new full ZIP to the same Store item, then submit it for review.
Using the same Store item preserves its extension ID and local storage.

Existing unpacked installs have a different extension ID. Their stored changes
cannot move automatically to the Store install; users should copy or re-create
staged changes before removing the unpacked version.
