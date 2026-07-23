# Changelog

## v0.3.0

### Highlights

- Add a uniform picker with 1,167 CFB 27 uniforms across 150 selectable groups, including Missouri State.
- Add selected uniforms to a Team Builder save only after an explicit confirmation. The original
  team uniform required by Team Builder is kept as an unused anchor.
- Split uniform selection and CSV roster import into dedicated options-page tabs. Popup links open
  the relevant tab directly.
- Support both legacy and current uniform-catalog formats, including named Frosty enum values.

### Install / update

**New install:** Download and unzip the release, then open Chrome's `chrome://extensions` page.
Enable **Developer mode**, choose **Load unpacked**, and select the unzipped folder.

**Update:** Replace the files in the same folder you previously loaded, then use the extension's
**Reload** button on `chrome://extensions`. Keeping the same folder preserves your copied roster
and selected-uniform data.

If Team Builder is already open after selecting uniforms or importing a roster, reload that page.
