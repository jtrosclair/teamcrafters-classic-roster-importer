# Changelog

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
