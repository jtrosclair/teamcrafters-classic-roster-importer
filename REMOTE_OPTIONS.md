# Remote options

The extension and both Studio equipment editors use:

`https://tc-cdn.trosclair.dev/team-builder-assets/cfb27/config/options-v1.json`

`config/options-v1.json` contains the initial options. The only accepted fields are:

- `schemaVersion`: exactly `1`.
- `revision`: a unique identifier containing letters, numbers, dots, underscores, or hyphens.
- `equipment.catalogBaseUrl`: an HTTPS directory beneath the TeamCrafters CDN's
  `/team-builder-assets/cfb27/equipment/` path.
- `equipment.editableSlotIds`: unique integer equipment IDs from 0 through 254.
- `catalogs.mascotsUrl` and `catalogs.stadiumsUrl`: JSON files beneath the CDN's
  `/team-builder-assets/cfb27/catalogs/` path, using the existing bundled row formats.

Unknown fields, other hosts, query strings, scripts, commands, and expressions are
rejected. Slots 97, 112, 113, and 129 cannot be enabled remotely. The equipment
bridges only permit gear loadout category 0 and preserve all unrelated fields.
Body type remains in Appearance. Permissions, routes, save logic, uniform switches,
and transformations are packaged code and cannot be changed through this config.

## Publish an options update

1. Publish a new equipment or identity catalog at a fresh immutable CDN path.
2. Edit a copy of `config/options-v1.json`, change only the needed options, and
   give the update a new `revision`.
3. From the TeamCrafters website repository, run:

   ```sh
   node agent-scripts/publish-tbu-remote-options.js --config /path/to/options-v1.json
   ```

4. Inspect the dry run, then repeat with `--execute`. For the initial publication,
   `--catalog-dir /path/to/extension/reference` uploads the two bundled identity
   catalogs at their configured immutable locations.

The publisher validates the schema, verifies that configured slots exist in the
equipment catalog, validates identity rows, and refuses to replace different data
at an immutable URL. It archives each revision and publishes the mutable options
pointer last, with a one-minute CDN cache. It reads published data back to verify it.
To roll back, publish the previous values under a fresh revision.

Clients check the config when needed, at most once per five minutes. Refresh an
open Studio page to reload its displayed catalog after the cache window. Config
and identity catalogs are cached in extension-local storage; the website uses
local storage. Failed or invalid responses use the last valid data, then bundled
defaults. A broken equipment catalog URL falls back to the bundled catalog URL.
Requests omit credentials and send no roster or account data.

Version 0.7.4 advertises remote-options support in both bridge handshakes. The
Studio limits older extensions to their bundled slot set, so future remotely
added slots cannot be offered to extensions that cannot save them.

`remote-config.js` is packaged JavaScript, shared byte for byte with the website's
`lib/cfb27-equipment/remote-config.js`. Keep those copies aligned when changing
the loader. Remote JSON cannot change loader behavior. Test with
`node tools/test-remote-config.mjs` and both equipment bridge test scripts.
