// Builds the bundled uniform-recipes-<part>.json files the extension ships, from the local
// recipes_target_format/ source (decoded CFB 27 uniform recipes — gitignored, 98MB).
//
//   node tools/build-uniform-recipes.mjs pants
//   node tools/build-uniform-recipes.mjs jerseys
//   node tools/build-uniform-recipes.mjs helmets
//   node tools/build-uniform-recipes.mjs socks
//
// For each part referenced by uniform-catalog.json, it finds the matching recipe file (join:
// basename, minus a leading "U_", upper-cased), converts it to the exact shape EA's save uses for
// a uniformParts entry, and writes them keyed by that normalized name. inject.js drops one of
// these straight into teamData.frostbiteData.uniformParts.<part> to make the piece editable.
//
// Pants, jerseys, helmets, and socks are wired up. Helmet and sock recipes omit a few save-only
// settings; inject.js fills those from the team's original matching part.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'recipes_target_format');

// part -> { dir, presetPrefix }. The recipe format already matches EA's uniformParts entry shape
// for the parts here (jerseys and pants), so a recipe is kept whole and only two fixups are
// applied (see toEntry): materialPreset (a bare preset name the save wants as a full path) and
// bare placeholder textureIds the decode left behind.
// pathKey is how the catalog names this part in a uniform's `paths` (singular); dir is the recipe
// folder; presetPrefix turns a bare materialPreset name into the full path the save wants.
const PARTS = {
  helmets: { pathKey: 'helmet', dir: 'helmets', toEntry: toHelmetEntry },
  pants: { pathKey: 'pants', dir: 'pants', presetPrefix: 'content/characters/player/parts/uniforms/pants/presets/' },
  jerseys: { pathKey: 'jersey', dir: 'jerseys', presetPrefix: 'content/characters/player/parts/uniforms/jerseys/presets/' },
  socks: { pathKey: 'socks', dir: 'socks', presetPrefix: 'ContentShared/common/presets/characters/' },
};

// Blank any textureId that isn't a real asset path. Real texture references are always
// "content/…" or "ContentShared/…"; the decoder sometimes writes the latter as "contentShared"
// (wrong case), which is still an asset path and must be canonicalized rather than blanked. It also
// occasionally leaves a bare placeholder (e.g. "namePlateTexture") where the working save has an
// empty string, and a bogus path fails to load.
function sanitizeTextureIds(node) {
  if (Array.isArray(node)) { node.forEach(sanitizeTextureIds); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'textureId' && typeof v === 'string' && v) {
        if (/^contentShared\//i.test(v)) {
          node[k] = 'ContentShared/' + v.slice('contentShared/'.length);
        } else if (!/^content\//i.test(v)) {
          node[k] = '';
        }
      } else sanitizeTextureIds(v);
    }
  }
}

function toEntry(recipe, presetPrefix) {
  const entry = structuredClone(recipe);
  let mp = entry.materialPreset || '';
  if (mp && !/^(content|ContentShared)\//.test(mp)) mp = presetPrefix + mp;
  entry.materialPreset = mp;
  sanitizeTextureIds(entry);
  return entry;
}

const HELMET_PRESET_ROOT = 'content/characters/player/parts/uniforms/helmets/helmet_presets/';

function helmetPresetPath(name) {
  if (!name) return '';
  return /^(content|ContentShared)\//.test(name) ? name : HELMET_PRESET_ROOT + name;
}

// Decoded helmets carry their three material preset names in helmetPresets, whereas a save's
// uniformParts.helmets entry uses the explicit *Material fields. The source has no meaningful
// top-level materialPreset, so remove it rather than writing an empty/unsupported field.
function toHelmetEntry(recipe) {
  const entry = structuredClone(recipe);
  const presets = entry.helmetPresets || {};
  entry.shellMaterial = helmetPresetPath(presets.shell);
  entry.facemaskMaterial = helmetPresetPath(presets.facemask);
  entry.accMaterial = helmetPresetPath(presets.accessory);
  delete entry.helmetPresets;
  delete entry.materialPreset;
  sanitizeTextureIds(entry);
  return entry;
}

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
    for (const u of uniforms) referenced.add(norm(u.paths[spec.pathKey]));
  }

  const recipes = {};
  const missing = [];
  for (const name of [...referenced].sort()) {
    const file = files.get(name);
    if (!file) { missing.push(name); continue; }
    recipes[name] = spec.toEntry
      ? spec.toEntry(JSON.parse(fs.readFileSync(file, 'utf8')))
      : toEntry(JSON.parse(fs.readFileSync(file, 'utf8')), spec.presetPrefix);
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
