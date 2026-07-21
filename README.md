# TeamCrafters Classic Roster Importer

A browser extension by TeamCrafters that copies a **classic** (NCAA14-and-older) TeamCrafters
roster and loads it into EA Sports College Football Team Builder as a roster **preset** —
"Import from TeamCrafters" — using EA's own preset loader.

Built by TeamCrafters. Not affiliated with, endorsed by, or associated with Electronic Arts.

## What it does

1. On a classic roster team page (`teamcrafters.net/app/classic-rosters/<game>/<team>`), an
   injected **"Copy roster for EA Team Builder"** button fetches a normalized export of that
   team, merges it onto a bundled EA base template to produce a complete `roster.json` +
   `character_visuals.json` pair, and stores that locally in the browser (`chrome.storage.local`).
2. In EA College Football Team Builder (`www.ea.com`), the extension replaces the **Cupcake**
   entry in the roster presets list with **"TeamCrafters: &lt;team&gt; (&lt;game&gt;)"** (it reuses
   Cupcake's real preset id so the loaded roster gets a valid `templateId`). Selecting it makes
   EA's own loader fetch our roster + visuals and replace the whole roster — the same way its
   built-in presets work. Clearing the copied roster restores Cupcake.
3. Nothing is uploaded until you use EA's own Save. The extension never writes to EA's servers;
   it only edits the preset list and answers the preset's asset requests locally.

## Scope

This only targets **classic** rosters (NCAA14 and older). It intentionally does not run on the
modern `teamcrafters.net/rosters/...` pages (CFB25/26/27).

## Install (unpacked / developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Reload any already-open `teamcrafters.net` or `ea.com` tabs.

## Use it

1. Go to a classic team page on teamcrafters.net and click **Copy roster for EA Team Builder**.
2. Open EA College Football Team Builder, open the roster presets, and pick the
   **"TeamCrafters: &lt;team&gt;"** entry (it takes Cupcake's spot). The roster loads.
3. Review/edit in EA as normal, then use EA's own **Save**.

The toolbar popup shows what's currently copied (team, player count, when) and lets you clear it.

## How it works internally

- `roster-merge.js` + `teamcrafters-copy.js` (isolated world, teamcrafters.net only) — render the
  copy button, call TeamCrafters' export API, merge the players onto the bundled base template
  (`base-template/`), and store the finished `roster.json` + `character_visuals.json`.
- `ea-bridge.js` (isolated world, ea.com only) — the only place with `chrome.storage` access on
  the EA side; relays the stored payload into the page on request.
- `inject.js` (**main world**, ea.com only) — patches `fetch`/`XMLHttpRequest` to (a) swap our
  preset in for Cupcake in `template_rosters.json`, (b) answer our preset's two sentinel asset URLs
  with the stored roster/visuals, and (c) while a roster is armed, serve an empty
  `plyr-gen-names.json` so EA doesn't regenerate over our imported player names. It asks
  `ea-bridge.js` for the payload via a `CustomEvent` round trip (main-world scripts can't call
  `chrome.*` directly).
- `base-template/` — a real EA preset (roster.json + character_visuals.json) used as the merge
  base, so unfilled slots and all EA-owned fields (IDs, cosmetics, loadouts) stay valid.
- `popup.html` / `popup.js` — the toolbar status popup.

## Known limitations

- The base template is a fixed EA preset; players you don't have (beyond your roster's size, or
  positions your team doesn't fill) remain as that template's filler.
- Only ratings with a confirmed direct/one-to-one mapping are converted (see the TeamCrafters
  repo's `docs/team-builder-extension/classic-rating-conversion.md` and
  `ps2-core-rating-conversion.md`). Ratings requiring an unconfirmed regression formula are left
  as the template's values rather than guessed.
- Player appearance (portrait, head, loadouts) stays as the template's; only skin tone, name,
  number, height, and weight are updated on the visuals side. `reference/portrait-catalog.json`
  (5,041 complexion-indexed entries) is a starting point for richer appearance mapping later.
- Archetype/potential/dev-trait follow the source data's actual coverage; see the TeamCrafters
  repo's `lib/teamBuilderRoster/` for the exact rules.

## License

Copyright (C) 2026 TeamCrafters.

This program is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License v3.0 or later** as published by the Free Software Foundation.
It is distributed WITHOUT ANY WARRANTY. See [LICENSE](LICENSE) for the full text, or
<https://www.gnu.org/licenses/>.

The GPL covers **the extension's own source code**. It does not, and cannot, relicense the
bundled Electronic Arts game data used as reference/base material:

- `base-template/roster.json`, `base-template/character_visuals.json` — a real EA Team Builder
  roster preset, used as the merge base.
- `reference/portrait-catalog.json`, `reference/example-payload.json` — EA head catalog and a
  sample team payload, kept for reference.

Those files remain the property of Electronic Arts and are included only to make this interop
tool work and reproducible. EA, EA Sports, and College Football are trademarks of Electronic
Arts Inc. This project is unaffiliated with and unendorsed by EA.
