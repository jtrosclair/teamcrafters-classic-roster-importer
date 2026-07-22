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

  // One catalog uniform -> one teamVisuals.uniforms entry.
  //
  // paths are used verbatim rather than rebuilt from a prefix: the shoe root genuinely varies per
  // asset (U_GENERIC_SHOESX_WHIPRI sits under ContentShared/, the rest under content/), so any
  // reconstruction would be wrong for one group or the other.
  function toPayloadUniform(entry) {
    return {
      displayName: entry.displayName,
      currentOfficial: !!entry.currentOfficial,
      isCustom: false,
      uniform: {
        loadoutType: entry.loadoutType,
        loadoutCategory: entry.loadoutCategory,
        loadoutElements: SLOTS.map((s) => ({
          slotType: s.slotType,
          itemAssetName: entry.paths[s.part],
          itemDisplayName: s.label,
        })),
        displayOrder: 9999,
      },
    };
  }

  // A whole team -> what gets stored and later written into the save.
  function buildUniformSet(teamName, team) {
    if (!team || !Array.isArray(team.uniforms) || !team.uniforms.length) {
      throw new Error(`No uniforms found for ${teamName}.`);
    }
    const uniforms = team.uniforms.map(toPayloadUniform);

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
      uniforms,
    };
  }

  window.TCUniformBuild = { buildUniformSet, toPayloadUniform, SLOTS };
})();
