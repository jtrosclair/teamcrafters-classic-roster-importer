# Team Builder Unleashed

Team Builder Unleashed is the Chrome bridge for the
[Team Builder Unleashed Studio](https://www.teamcrafters.net/team-builder-unleashed/cfb27).
Choose your CFB 27 roster, player, stadium, mascot, prestige, or template changes in the web
studio, then use EA Team Builder's normal **Save** button. This extension keeps those choices
ready and applies them only when you save.

Built by TeamCrafters. Not affiliated with, endorsed by, or associated with Electronic Arts.

> **Status:** verified against EA Sports College Football 27 Team Builder as of July 2026.
> It works by reading and adjusting the data Team Builder already loads, so an EA update can
> break it. If it stops working, please [open an issue](../../issues).

> [!WARNING]
> Use this tool carefully and entirely at your own risk. TeamCrafters is not responsible for team data being overwritten, lost, or otherwise changed. EA can patch or update Team Builder at any moment, which may break this extension or change its behavior. Back up anything important before using it. You have been warned.

---

# For users

## What it does

The Studio is where you make changes. The extension is the small connection between the Studio and
EA Team Builder. It shows a compact list of changes ready for your next save in the top-left corner
of Team Builder, where you can turn an individual stadium, mascot, or uniform change on or off.

Use the Studio's plain-language guides whenever you need help:
[Team Builder Unleashed Help](https://www.teamcrafters.net/team-builder-unleashed/help).

Nothing is uploaded to EA until *you* press EA's own **Save**.

## Supported Games/Consoles

Team Builder Unleashed currently supports CFB 27 Team Builder. PC and console players can use the
teams they create, as long as they can access Team Builder from a computer running Chrome.

## What you need

- **Google Chrome** (the only browser this has been tested in)
- An EA account with access to **College Football 27 Team Builder**
- No TeamCrafters account needed — the classic rosters are public AT THIS TIME.

## Install

This isn't in the Chrome Web Store, so you load it manually. Takes about a minute.

1. Download the latest release ZIP from the [Releases](../../releases) page.
2. Unzip it into a new folder named `team-builder-unleashed-v0.7.2`.
   Put that folder somewhere you won't delete by accident (not your Downloads folder).
3. Open Chrome and go to `chrome://extensions`
4. Turn on **Developer mode** (toggle, top-right).
5. Click **Load unpacked** and select the folder you unzipped.
6. The extension appears in your toolbar. (Click the puzzle-piece icon → pin it.)

If the Studio or EA Team Builder was already open, reload those tabs.

## Use it

1. Open the [CFB 27 Studio](https://www.teamcrafters.net/team-builder-unleashed/cfb27).
2. Choose the roster, player, stadium, mascot, prestige, or template change you want. The Studio
   will let you know when it is ready.
3. Open your team in EA College Football 27 Team Builder. If you made roster or template changes
   while it was open, refresh that Team Builder tab first.
4. Look for the **Team Builder Unleashed** bar in the top-left. It shows what is ready for your
   next save and lets you temporarily turn a save change off.
5. Use EA Team Builder's regular **Save** button, then test your team in game.

> **Important for roster changes:** After importing a roster or changing any player appearance or
> equipment, refresh the EA Team Builder page first. Then select a different roster template such
> as **Spread**, and select **TeamCrafters** again. EA only reloads the staged roster after a page
> refresh and a template change. Skipping either step means your roster changes may not show
> correctly.

Click the extension icon any time to open the Studio, read Help, or safely remove a staged change.

For custom teams with an original Team Builder asset (including legacy entries that retained only
their submission URL), the copy reads that team’s published `nonce-primary` file through the
TeamCrafters extension API and preserves its player data, portraits, and equipment. Entries with no
asset reference fall back to the public roster table and use the extension's stable base appearance
map so they remain safe to load in Team Builder.

Team Builder directory pages under either the current `CFB` or legacy `CFB27` URL use the same
verified payload path, so they preserve the original roster, portraits, and equipment.

## Or copy an EA Team Builder preview

1. Open a shared team at `https://www.ea.com/games/ea-sports-college-football/team-builder/preview/[teamid]`.
2. Wait for the page to load, then use the **Copy roster for Team Builder** control at the bottom-right.
3. Open the roster presets on any Team Builder team, select a different template such as
   **Spread**, then select the new **TeamCrafters** preset.

The preview copy reads the page's `nonce-primary` response and preserves the original player map
and `characterVisuals` map together, including each player's exact portrait and equipment. It only
writes the clipboard after you press Copy. Then open the CFB 27 Studio to review or edit the
roster. Use **Download CSV** beside it to save the same roster as a spreadsheet; the CSV includes
`portraitId` for every player.

## Or build a roster from a spreadsheet

You don't have to start from a TeamCrafters team — you can bring your own roster in from a CSV.

1. Open the CFB 27 Studio and choose **Rosters**, then **Import**.
2. Click **Download sample CSV**. It's a complete, valid 85-player roster with every required column filled in.
3. Open it in Excel or Google Sheets, replace the players with whatever you want, and save as CSV.
4. Back in the Studio, give the roster a name, choose your file, and click **Import roster**.
5. Refresh an already-open Team Builder tab. In the preset list, select a different template such
   as **Spread**, then select **TeamCrafters** to load the new roster.

Every rating must be a number from 0–99. **`OVR` and archetype are always calculated dynamically from the player's ratings and position on import** — don't include an `OVR` column at all, a supplied value is rejected. Bio fields (height, weight, class, skin tone, `homeTown`, and `homeTownState`) can be left blank too; those fall back to the base template's values. `homeTownState` is an optional integer: 0–49 map to Alabama–Wyoming alphabetically, and 50 is Non-US. An optional `portraitId` preserves a Team Builder player's exact EA head; it takes precedence over `skinTone`, while a blank `portraitId` uses the existing skin-tone-to-portrait fallback.

Your roster also has to be able to field a team, so the import requires **45–85 players** and a minimum at each position (2 QB, 3 HB, 5 WR, 2 TE, 1 each on the O-line, 2 LE/RE, 3 DT, 2 MLB, 2 CB, 2 FS, 1 SS, 1 K, 1 P — FB optional). Two units also have a combined minimum on top of that: **8 offensive linemen** across LT/LG/C/RG/RT and **3 outside linebackers** across LOLB/ROLB. How you distribute those is up to you, as long as no single spot is empty. Nothing is imported until everything passes, and the page tells you the exact row and column to fix.

## Or start from a real team and edit it

The classic team page also has a **"Download CSV"** button next to "Copy For Team Builder". It hands you
that team as a spreadsheet in the same format the importer above accepts, so you can change a
rating, swap a player, or reorder the depth chart and bring it back in.

It's a faithful dump — nothing is padded or guessed:

- **Blank ratings are possible.** Older games didn't track every rating CFB 27 has, and those cells
  come out empty rather than filled with a made-up number. The importer requires them, so fill them
  in.
- **Short rosters stay short.** You get exactly the players the team has. If that's under 45, or
  under a position minimum (plenty of real teams carry one kicker), the CSV won't import until you
  add players.

Either way the file always downloads, and the button tells you exactly what to fix first.

## Modify player equipment

Every copied or CSV-imported roster carries its matching player details. Open the CFB 27 Studio,
choose **Rosters**, then **Edit**, select a player, and choose **Equipment**. The web editor has the
CFB 27 equipment catalog, searchable previews, paired-side controls, and copy-loadout actions.

The page communicates with the extension through a versioned, revision-safe bridge. It receives
only the roster and player fields needed by the editor, saves supported player changes as you make
them, and keeps all unrelated clipboard fields private to the extension. A stale editor cannot
overwrite a newly copied roster.

Before saving any equipment or player change, refresh the EA Team Builder page first. Then select
a different roster template such as **Spread**, and select **TeamCrafters** again. The change will
not reliably appear unless EA reloads the refreshed TeamCrafters preset.

## Uniforms

Choose uniform overrides in the CFB 27 Studio's **Uniforms** tab, then save normally in Team
Builder. Read the [uniform guide](https://www.teamcrafters.net/team-builder-unleashed/help/cfb27/uniforms)
before saving: an override replaces every uniform on your team with the selected real team's
uniforms, and EA may patch this behavior at any time. The extension shows any staged override and
lets you turn it off or remove it safely.

## Troubleshooting

**The "Copy For Team Builder" button doesn't appear.**
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
2. **On the Team Builder page** intercepts the relevant GET responses:
   - `template_rosters.json` — the presets list. Replaces the **Cupcake** entry with ours,
     **keeping Cupcake's real id (1238)**. This matters: EA copies the chosen preset's id into the
     loaded roster's `templateId`, and a made-up id crashes the game. Our merged roster is built on
     the Cupcake template, so 1238 is the correct id.
   - Two **sentinel asset URLs** (carrying a `_teamcrafters.json` marker) that only exist in our
     injected preset — answered locally with the stored roster/visuals, never hitting the network.
   - `plyr-gen-names.json` — the name-generator pool. While a roster is copied we serve an empty
     pool, because EA otherwise regenerates every player's name from their skin tone on load,
     overwriting the real names.
   - `my_school_templates.json` — appends locally-created school templates, leaving every EA
     template untouched. Fixed grades have identical `min`/`max` values; only Pro Potential can
     have a range.
3. **EA's own loader** does the actual roster replacement.

## Project layout

| File | World | Runs on | Purpose |
|---|---|---|---|
| `teamcrafters-copy.js` | isolated | classic-roster and custom-team pages | Copy controls; reads the classic API or custom-team page roster, then stores the merged result or writes the CSV |
| `roster-merge.js` | isolated | TeamCrafters roster pages | All merge logic (loaded first; shares scope) |
| `inject.js` | **main** | Team Builder | Patches `fetch`/`XMLHttpRequest` for roster and school-template responses |
| `ea-bridge.js` | isolated | Team Builder | Relays `chrome.storage` into the page (main-world scripts can't call `chrome.*`) |
| `popup.html` / `popup.js` | — | — | Toolbar status popup |
| `options.html` / `options.js` | — | — | TeamCrafters-branded Studio shortcuts, ready-to-save status, and safe recovery controls |
| `equipment-web-bridge.js` | isolated | exact Team Builder Unleashed route | Versioned, revision-safe web editor bridge for the stored roster visuals |
| `csv-import.js` | isolated | classic-roster pages | CSV parsing + mapping into the normalized roster shape; owns the column schema and roster rules |
| `csv-export.js` | isolated | classic-roster pages | The reverse — normalized roster to CSV, reusing `csv-import.js`'s tables so the two can't drift |
| `cfb27-position-ovr-calculator.js` | — | — | Archetype-weighted OVR calculation used by the Studio bridge |
| `sample-roster.csv` | — | — | Complete 85-player sample, generated from the base template |
| `uniform-build.js` | — | — | Converts catalog uniforms into EA's payload shape for the save bridge |
| `uniform-catalog.json` | — | — | 150 selectable groups / 1,167 uniforms decoded from CFB 27 |
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
- **Never touched during roster merge:** `PLYR_ID`, `PLYR_ORIGID`, `PLYR_ASSETNAME`, `genericHead`,
  `assetName`, `bodyType`, `loadouts`, `skinToneScale`, `containerId`

The Team Builder Unleashed web editor runs after that merge. The extension bridge validates that a
save changes only supported `loadoutElements[].itemAssetName` values (or appends the minimal element
for a missing slot); identity, ratings, head recipe, and the rest of each visuals entry remain
untouched.

Encodings worth knowing, all confirmed against real team files:

- `PLYR_WEIGHT` is `actual pounds − 160`
- `PLYR_SCHOOLYEAR` is `0..3` = Freshman/Sophomore/Junior/Senior (nothing else is valid)
- `PLYR_POSITION` is `0..20` (QB, HB, FB, WR, TE, LT, LG, C, RG, RT, LE, RE, DT, LOLB, MLB, ROLB,
  CB, FS, SS, K, P)
- A visuals entry's `genericHeadName` recipe ends in its complexion digit, which **must** equal
  that entry's `skinTone`

## Two ways in, one pipeline

There are two sources for a roster, and they converge immediately:

- `teamcrafters-copy.js` fetches the export API on a TeamCrafters page.
- `csv-import.js` parses a user-supplied CSV from the Team Builder Unleashed Studio.

Both produce the **same normalized shape** (documented below), which is handed to `roster-merge.js`. Everything after that point — position matching, merge rules, wire encodings, storage, and serving — is identical. If you add a third source, produce that shape and you're done.

`csv-export.js` runs that shape back out to CSV, closing the loop: a roster fetched from the API can be written to a spreadsheet and re-enter through `csv-import.js`. It derives its column list and roster rules from `csv-import.js`'s exports rather than restating them, so the two halves can't disagree about the format. The export includes `portraitId` whenever the source supplies one, preserving the exact Team Builder head on re-import; if the column is cleared, `skinTone` remains the fallback. The export writes the clipboard **directly**, never the merged result — that's what keeps a rating the classic game lacked visible as a blank cell instead of silently inheriting the base template's value.

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
      "homeTown": "Ann Arbor", // PLYR_HOME_TOWN, null leaves the template value
      "homeTownState": 21,      // PLYR_HOME_STATE; 0=Alabama ... 50=Non-US
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
- Nullable fields (`heightInches`, `isLefty`, `devTrait`, `archetypeId`, `portraitId`, `homeTown`,
  `homeTownState`) mean "not
  known for this player" — the merge skips them rather than writing a default.

## Developing

No build step — plain JS loaded directly by Chrome.

```bash
# syntax check everything
for f in *.js; do node --check "$f"; done
```

After editing, hit the reload icon on the extension's card in `chrome://extensions`, then reload
any open TeamCrafters / Team Builder tabs. Editing files on disk does **not** auto-reload it.

The merge logic stays pure when given the bundled portrait catalog, so you can exercise it in Node
against the bundled template:

```js
const fs = require('fs');
global.window = {};
eval(fs.readFileSync('roster-merge.js', 'utf8'));

const roster  = JSON.parse(fs.readFileSync('base-template/roster.json', 'utf8'));
const visuals = JSON.parse(fs.readFileSync('base-template/character_visuals.json', 'utf8'));
const portraits = JSON.parse(fs.readFileSync('reference/portrait-catalog.json', 'utf8'));
const clipboard = { source: { teamName: 'Test' }, playerCount: 1, players: [ /* ... */ ] };

const out = window.TCRosterMerge.buildPresetPayload(clipboard, roster, visuals, portraits);
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
