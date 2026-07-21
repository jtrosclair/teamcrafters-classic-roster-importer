# TeamCrafters Classic Roster Importer

A Chrome extension that copies a **classic** college football roster (NCAA 14 and older) from
[TeamCrafters](https://www.teamcrafters.net) into **EA Sports College Football 27 Team Builder**,
by adding it to Team Builder's own roster-presets list.

Built by TeamCrafters. Not affiliated with, endorsed by, or associated with Electronic Arts.

> **Status:** verified against EA Sports College Football 27 Team Builder as of July 2026.
> It works by reading and adjusting the data Team Builder already loads, so an EA update can
> break it. If it stops working, please [open an issue](../../issues).

---

# For users

## What it does

Pick any classic team on TeamCrafters (say, 2012 Alabama). Click a button. Then, in EA's Team
Builder, that roster shows up in the presets list — pick it, and the whole roster is replaced with
those real players: names, ratings, positions, class years, height/weight, and skin tones.

Nothing is uploaded to EA until *you* press EA's own **Save**.

## Supported Games/Consoles

This extension is a simple update utility for CFB 27 Team Builder. PC's and Consoles are both supported on any device that can log in and download from Team Builder.

## What you need

- **Google Chrome** (the only browser this has been tested in)
- An EA account with access to **College Football 27 Team Builder**
- No TeamCrafters account needed — the classic rosters are public AT THIS TIME.

## Install

This isn't in the Chrome Web Store, so you load it manually. Takes about a minute.

1. On this page, click the green **Code** button → **Download ZIP**.
2. Unzip it. You'll get a folder named `teamcrafters-classic-roster-importer-main`.
   Put it somewhere you won't delete by accident (not your Downloads folder).
3. Open Chrome and go to `chrome://extensions`
4. Turn on **Developer mode** (toggle, top-right).
5. Click **Load unpacked** and select the folder you unzipped.
6. The extension appears in your toolbar. (Click the puzzle-piece icon → pin it.)

If a TeamCrafters classic-roster page or EA Team Builder was already open, reload those tabs.

## Use it

1. Go to a classic team page on TeamCrafters, find them at.
   `teamcrafters.net/app/classic-rosters`
2. Click the blue **"Copy roster for EA Team Builder"** button (bottom-right).
3. Open your team in EA College Football 27 Team Builder. Go to the "Roster" tab.
4. On the **roster presets** dropdown, in the middle, you'll now see something like
   **"TeamCrafters: Alabama (NCAA 13)"**. Pick it.
5. The roster loads. Review it, then save, load up, and play on!

Click the extension's toolbar icon any time to see what's currently copied, preview it on
TeamCrafters, or clear it. While a local team is saved, so the names persist, the auto name-generation function is disabled, you'll need to unload your team to re-enable it.

## Troubleshooting

**The "Copy roster" button doesn't appear.**
It only shows on a *classic* team page — the URL must look like
`/app/classic-rosters/<game>/<team>`. It won't appear on the modern CFB 25/26/27 roster pages, or
on a game's team-list page. If the URL looks right, reload the tab.

**The preset doesn't show up in Team Builder.**
Check the toolbar popup actually shows a copied roster, then reload the Team Builder tab — the
presets list is fetched on page load, so it needs a refresh after you copy.

**"Cupcake" is missing from my presets.**
Expected while a roster is copied — the import takes Cupcake's slot. Clear the copied roster in
the popup and Cupcake comes back.

**The game crashed / the team won't load.**
Please [open an issue](../../issues) with the team and game you imported. If you can export the
broken team's JSON and attach it, that's the fastest way to diagnose.

**Some players' class is blank, or names/skin tones look off.**
Report it with the team name. Some classic-era source data is incomplete — see
[Known limitations](#known-limitations).

**Getting help:** [GitHub Issues](../../issues) for bugs and feature requests, or the
TeamCrafters Discord for quick questions: **https://discord.gg/FkW8Uaj7DH**

---

# For developers

## How it works

Team Builder ships built-in roster presets ("Cupcake", "Spread", …). Each preset is just an entry
in a JSON list pointing at two CDN files: a `roster.json` (player data) and a
`character_visuals.json` (appearance). Selecting one makes EA's own loader replace the roster.

This extension hijacks that mechanism rather than writing into the app's internal state (which is
closure-bound and effectively unreachable in the production build). It:

1. **At copy time** (teamcrafters.net) fetches the roster export, merges those players onto a
   bundled real EA preset, and stores the finished `roster.json` + `character_visuals.json` in
   `chrome.storage.local`.
2. **On the Team Builder page** intercepts three GET responses:
   - `template_rosters.json` — the presets list. Replaces the **Cupcake** entry with ours,
     **keeping Cupcake's real id (1238)**. This matters: EA copies the chosen preset's id into the
     loaded roster's `templateId`, and a made-up id crashes the game. Our merged roster is built on
     the Cupcake template, so 1238 is the correct id.
   - Two **sentinel asset URLs** (carrying a `_teamcrafters.json` marker) that only exist in our
     injected preset — answered locally with the stored roster/visuals, never hitting the network.
   - `plyr-gen-names.json` — the name-generator pool. While a roster is copied we serve an empty
     pool, because EA otherwise regenerates every player's name from their skin tone on load,
     overwriting the real names.
3. **EA's own loader** does the actual roster replacement.

## Project layout

| File | World | Runs on | Purpose |
|---|---|---|---|
| `teamcrafters-copy.js` | isolated | classic-roster pages | Copy button, calls the export API, stores the merged result |
| `roster-merge.js` | isolated | classic-roster pages | All merge logic (loaded first; shares scope) |
| `inject.js` | **main** | Team Builder | Patches `fetch`/`XMLHttpRequest` for the three interceptions |
| `ea-bridge.js` | isolated | Team Builder | Relays `chrome.storage` into the page (main-world scripts can't call `chrome.*`) |
| `popup.html` / `popup.js` | — | — | Toolbar status popup |
| `base-template/` | — | — | A real EA preset (Cupcake) used as the merge base |
| `reference/` | — | — | EA head catalog + sample team payload, reference only |

## How the merge works

The base template has 85 slots. Players are grouped by position on both sides, sorted best-first
by overall rating, and paired within position. Leftover players are reassigned across positions
into leftover slots (overwriting that slot's position). Any slot never filled is **deleted**, so
the final roster matches your team's size.

Only these are replaced — everything else stays exactly as the template, which keeps EA's asset
references internally consistent (mismatched appearance/asset fields crash the game on load):

- **Roster:** names, jersey number, height, weight, class year, handedness, dev trait, archetype,
  position (on reassignment), all 54 ratings, and `PLYR_PORTRAIT`
- **Visuals:** name/number/height/weight mirrors, plus `genericHeadName` + `skinTone`
- **Never touched:** `PLYR_ID`, `PLYR_ORIGID`, `PLYR_ASSETNAME`, `genericHead`, `assetName`,
  `bodyType`, `loadouts` (all equipment), `skinToneScale`, `containerId`

Encodings worth knowing, all confirmed against real team files:

- `PLYR_WEIGHT` is `actual pounds − 160`
- `PLYR_SCHOOLYEAR` is `0..3` = Freshman/Sophomore/Junior/Senior (nothing else is valid)
- `PLYR_POSITION` is `0..20` (QB, HB, FB, WR, TE, LT, LG, C, RG, RT, LE, RE, DT, LOLB, MLB, ROLB,
  CB, FS, SS, K, P)
- A visuals entry's `genericHeadName` recipe ends in its complexion digit, which **must** equal
  that entry's `skinTone`

## The roster export API

Copying calls a TeamCrafters-hosted endpoint:

```
GET https://www.teamcrafters.net/api/extension/v1/classic-rosters/{gameSlug}/{teamSlug}
```

e.g. `/api/extension/v1/classic-rosters/ncaa-13/alabama`. It returns normalized roster JSON:

```jsonc
{
  "schemaVersion": 1,
  "source": {
    "kind": "classic",
    "game": "NCAA13",
    "teamSlug": "alabama",
    "teamName": "Alabama Crimson Tide",
    "sourceUrl": "https://www.teamcrafters.net/app/classic-rosters/ncaa-13/alabama"
  },
  "copiedAt": "2026-07-21T18:00:00.000Z",
  "playerCount": 68,
  "positionCounts": { "QB": 3, "HB": 5 },
  "warnings": [{ "code": "unsupported-position", "message": "..." }],
  "players": [
    {
      "sourcePlayerId": 5944,
      "firstName": "Denard",
      "lastName": "Robinson",
      "jerseyNumber": 16,
      "position": "QB",        // abbreviation
      "positionCode": 0,       // EA position code 0-20
      "classYear": "Senior",
      "schoolYearCode": 3,     // EA wire value 0-3
      "heightInches": 72,      // null if unknown
      "weightLbs": 195,        // real pounds; merge subtracts 160 for the wire value
      "isLefty": false,        // null if unknown -> merge leaves EA's value
      "devTrait": null,        // 0-3 (Normal/Impact/Star/Elite), null if unknown
      "archetypeId": 4,        // PLYR_PLAYERTYPE, null if unknown
      "portraitId": "3163",    // PLYR_PORTRAIT, drives face/skin tone
      "skinToneCode": 8,
      "ratings": { "OVR": 93, "SPD": 96, "AWR": 84 }
    }
  ]
}
```

Notes for anyone working against this:

- `ratings` keys are modern rating abbreviations (`OVR`, `SPD`, `STR`, `AGI`, `ACC`, `AWR`, `THP`,
  `SAC`/`MAC`/`DAC`, `TAK`, `PBK`/`RBK`, `KPW`/`KAC`, …). See `EA_WIRE_SUFFIX_BY_MODERN_KEY` in
  `roster-merge.js` for the full 54-key table and each key's `PLYR_*` wire name.
- **Any rating key may be absent.** Classic-era games didn't have every modern rating, and values
  that would need an unverified conversion formula are omitted rather than guessed. The merge
  leaves the template's value for anything missing.
- Nullable fields (`heightInches`, `isLefty`, `devTrait`, `archetypeId`, `portraitId`) mean "not
  known for this player" — the merge skips them rather than writing a default.

## Developing

No build step — plain JS loaded directly by Chrome.

```bash
# syntax check everything
for f in *.js; do node --check "$f"; done
```

After editing, hit the reload icon on the extension's card in `chrome://extensions`, then reload
any open TeamCrafters / Team Builder tabs. Editing files on disk does **not** auto-reload it.

The merge logic is pure with no browser dependencies, so you can exercise it in Node against the
bundled template:

```js
const fs = require('fs');
global.window = {};
eval(fs.readFileSync('roster-merge.js', 'utf8'));

const roster  = JSON.parse(fs.readFileSync('base-template/roster.json', 'utf8'));
const visuals = JSON.parse(fs.readFileSync('base-template/character_visuals.json', 'utf8'));
const clipboard = { source: { teamName: 'Test' }, playerCount: 1, players: [ /* ... */ ] };

const out = window.TCRosterMerge.buildPresetPayload(clipboard, roster, visuals);
console.log(out.stats);
```

Debugging the EA side: open DevTools on the Team Builder tab, and make sure the console's
log-level filter includes **Info** — otherwise `console.log` output is silently hidden. Disable breakpoints because Team Builder has an anti-debugging auto-breakpoint that gets enabled when you open up Dev Tools.

## Contributing

Issues and pull requests welcome. Especially useful:

- **Equipment loadout editing** The json file uploaded to Team Builder supports custom equipment loadouts,
  although it isn't present on the web UI. We could theoretically inject our own equipment layouts with this method
- **Bug reports with a broken team file attached** — that's how most of the loader quirks here
  were found.

Please keep the "only replace names / bio / ratings / position / face" rule. Touching EA's asset
fields across template players caused every crash during development.

**Licensing of contributions:** by submitting a pull request, patch, or any other contribution to
this project, you agree that your contribution is licensed under the same **GNU General Public
License v3.0 or later** that covers this project.

## Known limitations

- The base template is a fixed EA preset. Positions your team doesn't fill get removed, so the
  roster ends up smaller than 85.
- Only ratings with a confirmed one-to-one mapping are converted. Anything needing an unverified
  regression formula is left at the template's value rather than guessed.
- Appearance is coarse: skin tone/face comes from a four-bucket portrait mapping, and
  equipment/body type stay as the template's.
- Archetype, dev trait, and potential depend on what the classic-era source data actually has;
  where it's missing, the template's values remain.
- Some classic games have sparser data than others, so results vary by era.

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
