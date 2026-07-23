// Builds the bundled uniform-recipes-<part>.json files the extension ships, from the local
// recipes_target_format/ source (decoded CFB 27 uniform recipes — gitignored, 98MB).
//
//   node tools/build-uniform-recipes.mjs pants
//
// For each part referenced by uniform-catalog.json, it finds the matching recipe file (join:
// basename, minus a leading "U_", upper-cased), converts it to the exact shape EA's save uses for
// a uniformParts entry, and writes them keyed by that normalized name. inject.js drops one of
// these straight into teamData.frostbiteData.uniformParts.<part> to make the piece editable.
//
// Only "pants" is wired up so far. Jerseys are an exact drop-in and will be trivial to add;
// helmets and socks need extra save-only fields and aren't handled here yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'recipes_target_format');

// part -> { dir, category (uniformParts key), presetPrefix for materialPreset name -> path }
const PARTS = {
  pants: {
    dir: 'pants',
    presetPrefix: 'content/characters/player/parts/uniforms/pants/presets/',
    // recipe field -> keep as-is; only materialPreset needs the bare-name -> path fix.
    toEntry(recipe, presetPrefix) {
      let mp = recipe.materialPreset || '';
      if (mp && !/^(content|ContentShared)\//.test(mp)) mp = presetPrefix + mp;
      return { name: recipe.name, layerCompTexture: recipe.layerCompTexture, materialPreset: mp };
    },
  },
};

const norm = (n) => {
  const base = n.split('/').pop();
  return (/^U_/i.test(base) ? base.slice(2) : base).toUpperCase();
};

function build(part) {
  const spec = PARTS[part];
  if (!spec) throw new Error(`No builder for part "${part}". Known: ${Object.keys(PARTS).join(', ')}`);

  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'uniform-catalog.json'), 'utf8').replace(/^﻿/, ''));
  const files = new Map(
    fs.readdirSync(path.join(SRC, spec.dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5).toUpperCase(), path.join(SRC, spec.dir, f)])
  );

  const referenced = new Set();
  for (const team of Object.values(catalog.teams)) {
    const uniforms = Array.isArray(team.uniforms) ? team.uniforms : Object.values(team.uniforms);
    for (const u of uniforms) referenced.add(norm(u.paths[part]));
  }

  const recipes = {};
  const missing = [];
  for (const name of [...referenced].sort()) {
    const file = files.get(name);
    if (!file) { missing.push(name); continue; }
    recipes[name] = spec.toEntry(JSON.parse(fs.readFileSync(file, 'utf8')), spec.presetPrefix);
  }

  const out = { part, generated: new Date().toISOString().slice(0, 10), count: Object.keys(recipes).length, missing, recipes };
  const dest = path.join(root, `uniform-recipes-${part}.json`);
  fs.writeFileSync(dest, JSON.stringify(out));
  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  console.log(`${part}: ${out.count} recipes, ${missing.length} missing -> ${path.basename(dest)} (${kb} KB)`);
  if (missing.length) console.log('  missing:', missing.join(', '));
}

const part = process.argv[2];
if (!part) { console.error('usage: node tools/build-uniform-recipes.mjs <part>'); process.exit(1); }
build(part);
