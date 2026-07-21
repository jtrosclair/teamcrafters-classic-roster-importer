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

  // For each portrait our skin-tone mapping can produce (from heads.json): the head recipe
  // (== character_visuals.genericHeadName) and its complexion (== character_visuals.skinTone).
  // A valid character_visuals entry requires genericHeadName and skinTone to agree (the recipe's
  // trailing complexion digit equals skinTone in every working team), so we set both together.
  // genericHead (int) and assetName are left as the template slot's — the head index is a
  // secondary cache and the asset name is tied 1:1 to the slot and must never change.
  const APPEARANCE_BY_PORTRAIT = {
    '7': { recipe: 'Generic_0007_P_T0000_D_1_4', skinTone: 1 },
    '3157': { recipe: 'Generic_3157_P_T0150_D_3_3', skinTone: 3 },
    '3087': { recipe: 'Generic_3087_P_T0147_T_5_4', skinTone: 5 },
    '3163': { recipe: 'Generic_3163_P_T0151_T_7_2', skinTone: 7 },
  };

  // Overwrite one base roster slot + its paired visuals entry with a TeamCrafters player.
  // ONLY names / bio / ratings / position are replaced. Every appearance and asset field
  // (PLYR_PORTRAIT, PLYR_ASSETNAME, genericHead, genericHeadName, skinTone, loadouts, and every
  // other cosmetic/engine field) is left exactly as the template's, so the roster and visuals
  // asset references stay internally consistent. Editing appearance across template players
  // created unlinked assets and crashed the game on load, so we deliberately keep it stock.
  function mergeIntoSlot(rosterEntry, visualsEntry, tc, overwritePosition) {
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
      const appearance = tc.portraitId != null ? APPEARANCE_BY_PORTRAIT[String(tc.portraitId)] : null;
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
  function buildPresetPayload(clipboard, baseRoster, baseVisuals) {
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
        mergeIntoSlot(roster[id], visuals[id], players[i], false);
        filledCount++;
      }
      leftoverSlots.push(...slotIds.slice(pairCount));
      leftoverPlayers.push(...players.slice(pairCount));
    }

    const reassignCount = Math.min(leftoverSlots.length, leftoverPlayers.length);
    for (let i = 0; i < reassignCount; i++) {
      const id = leftoverSlots[i];
      mergeIntoSlot(roster[id], visuals[id], leftoverPlayers[i], true);
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

  window.TCRosterMerge = { buildPresetPayload };
})();
