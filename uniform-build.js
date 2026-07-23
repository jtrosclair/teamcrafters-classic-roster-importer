// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// uniform-build.js — converts entries from the bundled uniform catalog into the exact shape EA's
// save payload uses for teamVisuals.uniforms. Runs on the options page only; the converted result
// is what gets stored, so inject.js never needs the catalog. Exposes window.TCUniformBuild.
//
// The catalog is generated from CFB 27's own uniform assets, and its loadoutType/loadoutCategory
// are already translated to EA's numeric values there (TeamDark -> 6, TeamLight -> 3,
// UniformOnly -> 1), verified against reference/example-payload.json.
(function () {
  // Slot order matches every stock uniform in EA's payload: helmet, jersey, pants, socks, then
  // both shoe slots. Shoes occupy 95 and 96 with the same asset.
  const SLOTS = [
    { slotType: 93, part: 'helmet', label: 'HELMET' },
    { slotType: 98, part: 'jersey', label: 'JERSEY' },
    { slotType: 97, part: 'pants', label: 'PANTS' },
    { slotType: 94, part: 'socks', label: 'SOCKS' },
    { slotType: 95, part: 'shoes', label: 'SHOES' },
    { slotType: 96, part: 'shoes', label: 'SHOES' },
  ];

  // Slots EA binds through characterUniformItems. Shoes are excluded — see REGISTERED_SLOTS in
  // inject.js, which does the actual registering; this copy only exists to report the count.
  const REGISTERED_SLOTS = new Set([93, 98, 97, 94]);

  // uniform slot -> uniformParts category / recipe kind. Used to attach a part recipe to the
  // matching loadoutElement so inject.js can turn that slot into an editable team part rather than
  // a fixed reference to a prebuilt asset. Only the parts we have recipes bundled for appear here.
  const RECIPE_KIND_BY_SLOT = { 97: 'pants' };

  // A part recipe is keyed in the bundle by the asset's normalized name: basename, minus a leading
  // "U_", upper-cased. e.g. ".../U_ALA_PANTS_2023_WHITE" -> "ALA_PANTS_2023_WHITE".
  function normalizePartName(itemAssetName) {
    const base = String(itemAssetName).split('/').pop();
    const stripped = /^U_/i.test(base) ? base.slice(2) : base;
    return stripped.toUpperCase();
  }

  // Attach a save-ready part recipe to each uniform's matching slot, in place. `recipesByKind` is
  // { pants: { NORMNAME: recipeEntry }, ... }. inject.js reads uniform.parts to build the editable
  // team part; a slot with no recipe is left as its prebuilt-asset reference. Pure — no I/O.
  function attachPartRecipes(uniforms, recipesByKind) {
    let attached = 0;
    const missing = [];
    for (const u of uniforms) {
      for (const el of u.uniform.loadoutElements) {
        const kind = RECIPE_KIND_BY_SLOT[el.slotType];
        const table = kind && recipesByKind && recipesByKind[kind];
        if (!table) continue;
        const recipe = table[normalizePartName(el.itemAssetName)];
        if (recipe) {
          (u.parts || (u.parts = {}))[kind] = recipe;
          attached++;
        } else {
          missing.push(el.itemAssetName);
        }
      }
    }
    return { attached, missing };
  }

  // A team's two current uniforms occupy EA's home (6) and away (3) slots. Everything beyond those
  // is an extra, and in a real Team Builder save every extra carries loadoutType 8 / displayOrder 0
  // — that pair is what marks a uniform as a selectable alternate rather than one of the two
  // fixed slots. Observed in a save with three user-made uniforms alongside the stock Home/Away.
  const ALTERNATE_LOADOUT_TYPE = 8;

  // Catalog generators have used two shapes over time: the original one stored uniforms in an
  // array with EA's numeric enum values, while the current generator stores them in an object
  // keyed by asset name and preserves Frosty's enum names. Normalize at the boundary so the rest
  // of the picker always works with the payload-ready shape.
  const LOADOUT_TYPES = {
    LoadoutType_TeamDark: 6,
    LoadoutType_TeamLight: 3,
  };
  const LOADOUT_CATEGORIES = {
    LoadoutCategory_UniformOnly: 1,
  };

  function enumValue(value, values, label) {
    if (Number.isInteger(value)) return value;
    if (Object.prototype.hasOwnProperty.call(values, value)) return values[value];
    throw new Error(`Unsupported ${label}: ${String(value)}.`);
  }

  function normalizeUniforms(team) {
    if (!team || !team.uniforms) return [];
    const source = Array.isArray(team.uniforms) ? team.uniforms : Object.values(team.uniforms);
    return source.map((entry) => ({
      ...entry,
      loadoutType: enumValue(entry.loadoutType, LOADOUT_TYPES, 'loadout type'),
      loadoutCategory: enumValue(entry.loadoutCategory, LOADOUT_CATEGORIES, 'loadout category'),
    }));
  }

  function normalizeCatalog(catalog) {
    if (!catalog || !catalog.teams || typeof catalog.teams !== 'object') {
      throw new Error('The uniform catalog does not contain any teams.');
    }
    for (const [teamName, team] of Object.entries(catalog.teams)) {
      const uniforms = normalizeUniforms(team);
      if (!uniforms.length) throw new Error(`No uniforms found for ${teamName}.`);
      for (const uniform of uniforms) {
        if (!uniform.paths || SLOTS.some(({ part }) => !uniform.paths[part])) {
          throw new Error(`Uniform "${uniform.displayName || 'unnamed'}" for ${teamName} is missing an item path.`);
        }
      }
      team.uniforms = uniforms;
    }
    catalog.teamCount = Object.keys(catalog.teams).length;
    return catalog;
  }

  // One catalog uniform -> one teamVisuals.uniforms entry.
  //
  // paths are used verbatim rather than rebuilt from a prefix: the shoe root genuinely varies per
  // asset (U_GENERIC_SHOESX_WHIPRI sits under ContentShared/, the rest under content/), so any
  // reconstruction would be wrong for one group or the other.
  function toPayloadUniform(entry) {
    const isCurrent = !!entry.currentOfficial;
    return {
      displayName: entry.displayName,
      currentOfficial: isCurrent,
      isCustom: false,
      uniform: {
        loadoutType: isCurrent ? entry.loadoutType : ALTERNATE_LOADOUT_TYPE,
        loadoutCategory: entry.loadoutCategory,
        loadoutElements: SLOTS.map((s) => ({
          slotType: s.slotType,
          itemAssetName: entry.paths[s.part],
          itemDisplayName: s.label,
        })),
        displayOrder: isCurrent ? 9999 : 0,
      },
    };
  }

  // A whole team -> what gets stored and later written into the save. When `recipesByKind` is
  // supplied ({ pants: {...} }), each uniform's matching slot gets a save-ready part recipe
  // attached under uniform.parts, which inject.js turns into an editable team part.
  function buildUniformSet(teamName, team, recipesByKind) {
    const entries = normalizeUniforms(team);
    if (!entries.length) {
      throw new Error(`No uniforms found for ${teamName}.`);
    }
    const uniforms = entries.map(toPayloadUniform);
    const parts = recipesByKind ? attachPartRecipes(uniforms, recipesByKind) : { attached: 0, missing: [] };

    // Count the assets that will need a characterUniformItems entry, so the picker can say how
    // many up front. Must mirror REGISTERED_SLOTS in inject.js: only the four slots EA itself
    // registers, never the shoes.
    const assets = new Set();
    for (const u of uniforms) {
      for (const el of u.uniform.loadoutElements) {
        if (!REGISTERED_SLOTS.has(el.slotType)) continue;
        if (!String(el.itemAssetName).startsWith('ContentShared/')) assets.add(el.itemAssetName);
      }
    }

    return {
      version: 1,
      teamName,
      abbr: team.abbr || null,
      tgid: team.tgid || null,
      armedAt: new Date().toISOString(),
      uniformCount: uniforms.length,
      assetCount: assets.size,
      editablePartCount: parts.attached,
      uniforms,
    };
  }

  window.TCUniformBuild = {
    buildUniformSet, normalizeCatalog, normalizeUniforms, toPayloadUniform,
    attachPartRecipes, normalizePartName, SLOTS,
  };
})();
