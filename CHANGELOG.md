# Changelog

## v0.6.0 — 2026-08-08

> **Note from Jerry:** There are many untested/unverified changes in this release, mostly due to
> pending Team Builder patches that can ultimately break functionality in this extension. Please
> continue to use at your own risk until it has been verified that this extension will properly
> work with Team Builder.

### Highlights

- Copy a public TeamCrafters **custom team** or CFB 27 **Team Builder directory team** straight
  into Team Builder. Its original roster, player appearances, and equipment are preserved whenever
  an EA asset is available. Those pages also offer **Download CSV** for the roster.
- Copy actions now start only from TeamCrafters. The former EA Team Builder preview-page copy tool
  has been retired, so use a TeamCrafters classic, custom-team, or Team Builder directory page as
  the source instead.
- Pick a **mascot** from the new extension tools, then apply it when you save in Team Builder.
  Every save change remains explicitly confirmed.
- Try the **experimental stadium picker** to apply a stadium on your next save. Not all stadiums
  have been tested yet, so confirm the result in Team Builder before relying on it.
- Create reusable **school templates** in the extension and find them alongside EA's built-in
  templates during Team Builder setup.
- CSV roster imports and exports now retain a player's hometown and home state.

### Upgrade

Reload the extension in `chrome://extensions`, then reload any open TeamCrafters and Team Builder
tabs. Your copied roster, uniform selection, and existing extension settings are retained.

## v0.5.0 — 2026-08-03

### Highlights

- Add an explicit **Copy roster for Team Builder** control on EA Team Builder preview URLs. It
  reads the page's `nonce-primary` response and saves its roster data and character visuals as a
  reusable TeamCrafters preset, or downloads the same roster as an editable CSV.
- Add the production Team Builder Unleashed bridge for the TeamCrafters web equipment editor, with
  whitelisted reads, revision-safe visual-only writes, player-ID and preservation validation, and
  live clipboard-change notifications. The extension's former local editor is now a launch/status
  surface for the full web experience.
- Add optional CSV `portraitId` support. An exact valid EA portrait now overrides `skinTone`,
  while blank values retain the existing skin-tone fallback.
- Preserve portrait IDs in downloaded CSVs and use the full bundled EA portrait catalog to apply
  each selected head's matching recipe and complexion during import.

### Upgrade

Reload the extension from `chrome://extensions`, then reload any open Team Builder or TeamCrafters
tabs. Existing copied rosters and uniform selections are retained.

## v0.4.0

### Highlights

- Raise the Team Builder uniform-draft limit to 10 uniforms.
- Keep an **Add Uniform** control available after EA hides its native control at five uniforms.
- Name a new uniform before creating it, then choose it from the list when ready to edit.
- Make longer uniform lists horizontally scrollable.

## v0.3.2

### Highlights

- Make helmets, jerseys, pants, and socks editable for imported CFB 27 uniforms.
- Remove previously inserted named uniform parts when Team Builder first loads `nonce-primary.json`,
  preventing old imported uniforms from accumulating before the next import.
- Preserve helmet and sock settings that are not present in decoded recipes by reusing the team's
  original matching part settings.
- Fix decoded `contentShared/...` CID-mask paths so affected jerseys retain their materials and
  colors; this fixes Colorado's 2023 black and white alternate jerseys.
- Add an update notifier in the popup. It checks GitHub Releases while the popup is open and links
  to a newer release when one is available; installation remains manual.

### Known recipe gaps

- `PUR_PANTS_2024_GOLD` and `NIKE_SOCKS_2023_WHITE` have no decoded source recipe. They remain
  normal prebuilt assets rather than incomplete editable parts.

## v0.3.0

### Highlights

- Add a uniform picker with 1,167 CFB 27 uniforms across 150 selectable groups.
- Add selected uniforms to a Team Builder save only after an explicit confirmation. The original
  team uniform required by Team Builder is kept as an unused anchor.
- Split uniform selection and CSV roster import into dedicated options-page tabs.
- Support both legacy and current uniform-catalog formats, including named Frosty enum values.

### Install / update

**New install:** Download and unzip the release, then open Chrome's `chrome://extensions` page.
Enable **Developer mode**, choose **Load unpacked**, and select the unzipped folder.

**Update:** Replace the files in the same folder you previously loaded, then use the extension's
**Reload** button on `chrome://extensions`. Keeping the same folder preserves your copied roster
and selected-uniform data.

If Team Builder is already open after selecting uniforms or importing a roster, reload that page.
