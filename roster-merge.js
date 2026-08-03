// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// roster-merge.js — ISOLATED world, teamcrafters.net. Loaded before teamcrafters-copy.js and
// shares its isolated-world global scope. Exposes window.TCRosterMerge.
//
// Takes the normalized TeamCrafters roster export (the "clipboard") plus a bundled EA base
// template (a real preset's roster.json + character_visuals.json) and merges our players onto
// the template's 85 slots — matched by position, best-to-best by overall rating. The result is
// a complete roster.json + character_visuals.json pair in EA's exact format, which the extension
// later serves to EA's own preset loader. Slots we don't fill keep the template's filler player,
// so the preset is always a valid full 85-man roster.
(function () {
  // abbreviation (TeamCrafters column) -> EA wire suffix (PLYR_<suffix>), from teamcrafters'
  // app/app/customTeams/[customTeamId]/statsDictionary.ts.
  const EA_WIRE_SUFFIX_BY_MODERN_KEY = {
    OVR: 'OVERALLRATING', SPD: 'SPEED', STR: 'STRENGTH', AGI: 'AGILITY', ACC: 'ACCELERATION',
    AWR: 'AWARENESS', BTK: 'BREAKTACKLE', TRK: 'TRUCKING', COD: 'CHANGEOFDIRECTION', BCV: 'BCVISION',
    SFA: 'STIFFARM', SPM: 'SPINMOVE', JKM: 'JUKEMOVE', CAR: 'CARRYING', CTH: 'CATCHING',
    SRR: 'SHORTROUTERUN', MRR: 'MEDROUTERUN', DRR: 'DEEPROUTERUN', CIT: 'CATCHINTRAFFIC',
    SPC: 'SPECTACULARCATCH', RLS: 'RELEASE', JMP: 'JUMPING', THP: 'THROWPOWER',
    SAC: 'THROWACCURACYSHORT', MAC: 'THROWACCURACYMID', DAC: 'THROWACCURACYDEEP',
    RUN: 'THROWONTHERUN', TUP: 'THROWUNDERPRESSURE', BSK: 'BREAKSACK', PAC: 'PLAYACTION',
    TAK: 'TACKLE', POW: 'HITPOWER', PMV: 'POWERMOVES', FMV: 'FINESSEMOVES', BSH: 'BLOCKSHEDDING',
    PUR: 'PURSUIT', PRC: 'PLAYRECOGNITION', MCV: 'MANCOVERAGE', ZCV: 'ZONECOVERAGE', PRS: 'PRESS',
    PBK: 'PASSBLOCK', PBP: 'PASSBLOCKPOWER', PBF: 'PASSBLOCKFINESSE', RBK: 'RUNBLOCK',
    RBP: 'RUNBLOCKPOWER', RPF: 'RUNBLOCKFINESSE', LBK: 'LEADBLOCK', IBL: 'IMPACTBLOCKING',
    KPW: 'KICKPOWER', KAC: 'KICKACCURACY', RET: 'KICKRETURN', STA: 'STAMINA', INJ: 'INJURY',
    TGH: 'TOUGHNESS', LSP: 'LONGSNAPRATING',
  };

  const WEIGHT_WIRE_OFFSET = 160; // PLYR_WEIGHT wire value = actual lbs - 160

  // Sentinel asset URLs the injected EA preset points at. They look like real EA CDN asset URLs
  // (so EA's loader fetches them normally) but carry a "_teamcrafters.json" marker that inject.js
  // recognizes and answers with our stored roster/visuals instead of hitting the network.
  const ROSTER_URL =
    'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-roster.json';
  const VISUALS_URL =
    'https://cdn.mcr.ea.com/303/teamcrafters/files/tu1-2c74c88433_teamcrafters.json/0-applicationjson-character_visuals.json';

  // Exact Team Builder portraits need both their roster ID and the paired character-visuals
  // recipe/complexion. The catalog covers the full EA set, not only the four skin-tone fallbacks.
  const PORTRAIT_CATALOG_PATH = 'reference/portrait-catalog.json';
  let portraitCatalogPromise = null;

  function loadPortraitCatalog() {
    if (!portraitCatalogPromise) {
      const url = chrome.runtime.getURL(PORTRAIT_CATALOG_PATH);
      portraitCatalogPromise = fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`Could not load the EA portrait catalog (${res.status}).`);
        return res.json();
      });
    }
    return portraitCatalogPromise;
  }

  function appearanceForPortrait(portraitCatalog, portraitId) {
    if (portraitId == null) return null;
    const entry = portraitCatalog?.[String(portraitId)];
    if (!entry?.recipe || !Number.isInteger(entry.complexionId)) return null;
    return { recipe: entry.recipe, skinTone: entry.complexionId };
  }

  // Overwrite one base roster slot + its paired visuals entry with a TeamCrafters player.
  // Names, bio, ratings, position, PLYR_PORTRAIT, genericHeadName, and skinTone may change. The
  // remaining appearance and asset fields (including genericHead, assetName, and loadouts) stay
  // exactly as the template's so the roster and visuals asset references remain consistent.
  function mergeIntoSlot(rosterEntry, visualsEntry, tc, overwritePosition, portraitCatalog) {
    rosterEntry.PLYR_FIRSTNAME = tc.firstName;
    rosterEntry.PLYR_LASTNAME = tc.lastName;
    rosterEntry.PLYR_JERSEYNUM = String(tc.jerseyNumber);
    rosterEntry.PLYR_WEIGHT = String(tc.weightLbs - WEIGHT_WIRE_OFFSET);
    rosterEntry.PLYR_SCHOOLYEAR = String(tc.schoolYearCode);
    if (tc.heightInches != null) rosterEntry.PLYR_HEIGHT = String(tc.heightInches);
    if (tc.isLefty != null) rosterEntry.PLYR_HANDEDNESS = tc.isLefty ? '1' : '0';
    if (tc.devTrait != null) rosterEntry.PLYR_TRAITDEVELOPMENT = String(tc.devTrait);
    if (tc.archetypeId != null) rosterEntry.PLYR_PLAYERTYPE = String(tc.archetypeId);
    if (overwritePosition) rosterEntry.PLYR_POSITION = String(tc.positionCode);

    for (const [modernKey, wireSuffix] of Object.entries(EA_WIRE_SUFFIX_BY_MODERN_KEY)) {
      const value = tc.ratings[modernKey];
      if (value === undefined) continue;
      if (modernKey === 'LSP' && !value) continue; // 0 = "no snapper rating"; keep template's
      rosterEntry['PLYR_' + wireSuffix] = String(value);
    }

    // Skin tone / face: set the mapped portrait on the roster. genericHead index, assetName and
    // loadouts stay stock.
    if (tc.portraitId != null) rosterEntry.PLYR_PORTRAIT = String(tc.portraitId);

    // character_visuals: mirror the roster identity fields (name/number/bio) and apply the matched
    // head recipe + complexion. jerseyName is intentionally NOT set — the stock Cupcake preset
    // omits it and loads fine (EA falls back to lastName). Leave genericHead, assetName, loadouts
    // stock.
    if (visualsEntry) {
      visualsEntry.firstName = tc.firstName;
      visualsEntry.lastName = tc.lastName;
      visualsEntry.jerseyNumber = Number(tc.jerseyNumber);
      visualsEntry.weightPounds = Number(tc.weightLbs);
      if (tc.heightInches != null) visualsEntry.heightInches = Number(tc.heightInches);
      const appearance = appearanceForPortrait(portraitCatalog, tc.portraitId);
      if (appearance) {
        visualsEntry.genericHeadName = appearance.recipe;
        visualsEntry.skinTone = appearance.skinTone;
      }
    }
  }

  // Produce a full { roster, visuals } pair by merging clipboard.players onto clones of the base
  // template. Matching mirrors the original design: group both sides by EA position code, sort
  // each side best-first by overall rating, pair within position, then reassign any leftover
  // players across positions into leftover slots (overwriting those slots' position).
  function buildPresetPayload(clipboard, baseRoster, baseVisuals, portraitCatalog) {
    for (const player of clipboard.players || []) {
      if (player.portraitId != null && !appearanceForPortrait(portraitCatalog, player.portraitId)) {
        throw new Error(
          `Player ${player.firstName || ''} ${player.lastName || ''} has portraitId ` +
          `"${player.portraitId}", which isn't in the EA portrait catalog.`
        );
      }
    }
    const roster = structuredClone(baseRoster);
    const visuals = structuredClone(baseVisuals);

    const slotsByPosition = new Map();
    for (const slotId of Object.keys(roster)) {
      const code = Number(roster[slotId].PLYR_POSITION);
      if (!slotsByPosition.has(code)) slotsByPosition.set(code, []);
      slotsByPosition.get(code).push(slotId);
    }
    for (const ids of slotsByPosition.values()) {
      ids.sort((a, b) => Number(roster[b].PLYR_OVERALLRATING) - Number(roster[a].PLYR_OVERALLRATING));
    }

    const playersByPosition = new Map();
    for (const player of clipboard.players) {
      if (!playersByPosition.has(player.positionCode)) playersByPosition.set(player.positionCode, []);
      playersByPosition.get(player.positionCode).push(player);
    }
    // clipboard.players already arrives OVR desc within position (route.ts orderBy).

    let filledCount = 0;
    const leftoverSlots = [];
    const leftoverPlayers = [];

    const allCodes = new Set([...slotsByPosition.keys(), ...playersByPosition.keys()]);
    for (const code of allCodes) {
      const slotIds = slotsByPosition.get(code) || [];
      const players = playersByPosition.get(code) || [];
      const pairCount = Math.min(slotIds.length, players.length);
      for (let i = 0; i < pairCount; i++) {
        const id = slotIds[i];
        mergeIntoSlot(roster[id], visuals[id], players[i], false, portraitCatalog);
        filledCount++;
      }
      leftoverSlots.push(...slotIds.slice(pairCount));
      leftoverPlayers.push(...players.slice(pairCount));
    }

    const reassignCount = Math.min(leftoverSlots.length, leftoverPlayers.length);
    for (let i = 0; i < reassignCount; i++) {
      const id = leftoverSlots[i];
      mergeIntoSlot(roster[id], visuals[id], leftoverPlayers[i], true, portraitCatalog);
      filledCount++;
    }

    // Any template slot we never filled is a leftover filler player — remove it so the final
    // roster matches the TeamCrafters team's size (e.g. don't keep the template's extra QBs).
    const removedSlots = leftoverSlots.slice(reassignCount);
    for (const id of removedSlots) {
      delete roster[id];
      delete visuals[id];
    }

    return {
      roster,
      visuals,
      stats: {
        filledCount,
        removedFiller: removedSlots.length, // template players dropped
        unplacedPlayers: leftoverPlayers.length - reassignCount, // TC players with no slot
        totalSlots: Object.keys(roster).length,
      },
    };
  }

  window.TCRosterMerge = {
    buildPresetPayload,
    loadPortraitCatalog,
    ROSTER_URL,
    VISUALS_URL,
  };
})();
