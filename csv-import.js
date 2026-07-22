// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// csv-import.js — turns a user-supplied CSV into the same normalized roster shape the
// TeamCrafters export API returns, so it can go through the exact same merge pipeline
// (see roster-merge.js). Exposes window.TCCsvImport.
//
// The shipped sample-roster.csv is generated from the bundled base template, so every column
// here is guaranteed to round-trip. Ratings are validated strictly (present and 0-99, OVR
// excepted), as is roster composition (50-85 players, per-position minimums). Bio fields left
// blank fall back to whatever the base template's player had.
(function () {
  const POSITION_ABBREV_TO_EA_CODE = {
    QB: 0, HB: 1, FB: 2, WR: 3, TE: 4, LT: 5, LG: 6, C: 7, RG: 8, RT: 9, LE: 10, RE: 11,
    DT: 12, LOLB: 13, MLB: 14, ROLB: 15, CB: 16, FS: 17, SS: 18, K: 19, P: 20,
  };
  // Positions must be spelled out exactly — no RB/OT/OLB/S-style aliases. The position
  // minimums below are specific to a side (LT vs RT, LOLB vs ROLB, FS vs SS); a generic
  // alias would silently satisfy the wrong one, so this only accepts the real codes.
  const VALID_POSITIONS = Object.keys(POSITION_ABBREV_TO_EA_CODE);

  // EA's PLYR_SCHOOLYEAR is a plain 0-3 scale.
  const CLASS_YEAR_TO_CODE = {
    FR: 0, 'FRESHMAN': 0, 'RS FR': 0, 'REDSHIRT FRESHMAN': 0,
    SO: 1, 'SOPHOMORE': 1,
    JR: 2, 'JUNIOR': 2,
    SR: 3, 'SENIOR': 3,
  };

  // Skin tone (0-7) -> PLYR_PORTRAIT. roster-merge.js pairs each portrait with its head recipe
  // and complexion, so this is the only appearance value the CSV needs to carry.
  const PORTRAIT_ID_BY_SKIN_TONE = {
    0: '7', 1: '7', 2: '3157', 3: '3087', 4: '3163', 5: '3163', 6: '3163', 7: '3157',
  };

  const RATING_KEYS = [
    'OVR','SPD','STR','AGI','ACC','AWR','BTK','TRK','COD','BCV','SFA','SPM','JKM','CAR','CTH',
    'SRR','MRR','DRR','CIT','SPC','RLS','JMP','THP','SAC','MAC','DAC','RUN','TUP','BSK','PAC',
    'TAK','POW','PMV','FMV','BSH','PUR','PRC','MCV','ZCV','PRS','PBK','PBP','PBF','RBK','RBP',
    'RPF','LBK','IBL','KPW','KAC','RET','STA','INJ','TGH','LSP',
  ];

  // OVR is derived, not authored — it's always calculated on import, and a CSV that supplies
  // its own value is rejected. Every other rating must be present and 0-99.
  const REQUIRED_RATINGS = RATING_KEYS.filter((k) => k !== 'OVR');

  // A roster has to be able to field a team. These are EA's practical minimums per position; only
  // one kicker is required, since real teams routinely carry exactly one.
  const MIN_PLAYERS = 50;
  const MAX_PLAYERS = 85;
  const POSITION_MINIMUMS = {
    QB: 2, HB: 3, FB: 0, WR: 5, TE: 2, LT: 2, LG: 2, C: 2, RG: 2, RT: 2, LE: 2, RE: 2,
    DT: 3, LOLB: 1, ROLB: 1, MLB: 3, CB: 5, FS: 2, SS: 2, K: 1, P: 1,
  };

  // Some requirements span a pair of positions. A defense needs three outside linebackers, but how
  // they split across the two sides is the roster's business — the per-side minimums above only
  // insist that neither side is empty. Together these come to 46 players, under the 50 floor.
  const POSITION_GROUP_MINIMUMS = [
    { label: 'LOLB+ROLB', positions: ['LOLB', 'ROLB'], min: 3 },
  ];

  // Every position and group falling short, as { position, has, needs }. Shared with csv-export.js
  // so a downloaded CSV's warnings say exactly what this importer would reject.
  function findRosterShortfalls(counts) {
    const short = [];
    for (const [pos, min] of Object.entries(POSITION_MINIMUMS)) {
      if (min > 0 && (counts[pos] || 0) < min) {
        short.push({ position: pos, has: counts[pos] || 0, needs: min });
      }
    }
    for (const group of POSITION_GROUP_MINIMUMS) {
      const has = group.positions.reduce((n, pos) => n + (counts[pos] || 0), 0);
      if (has < group.min) short.push({ position: group.label, has, needs: group.min });
    }
    return short;
  }

  // Don't build a wall of thousands of messages for a badly-formed file.
  const MAX_COLLECTED_ERRORS = 100;

  // Both values are derived from the CFB 27 position/archetype weights. CSV-provided OVR and
  // archetype values are intentionally ignored: ratings are always the source of truth.
  function computePositionRating(player) {
    return window.TCCfb27PositionOvrCalculator
      ?.calculateCfb27PositionRating(player.position, player.ratings) ?? null;
  }

  // --- CSV parsing -----------------------------------------------------------------------
  // Handles quoted fields, embedded commas/newlines, escaped quotes, CRLF, and Excel's BOM.
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }

    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [] };
    const headers = nonEmpty[0].map((h) => h.trim());
    const out = nonEmpty.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
      return o;
    });
    return { headers, rows: out };
  }

  // --- field coercion --------------------------------------------------------------------
  function num(v) {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function clampRating(v) {
    const n = num(v);
    return n == null ? null : Math.max(0, Math.min(99, Math.round(n)));
  }
  function bool(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'l', 'left', 'lefty'].includes(s)) return true;
    if (['false', 'no', 'n', '0', 'r', 'right'].includes(s)) return false;
    return null; // unknown -> merge leaves the template's value
  }
  // Accept 74, "74", 6'2", 6-2, 6 2
  function heightInches(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const m = s.match(/^(\d+)\s*(?:'|-|\s)\s*(\d+)/);
    if (m) return Number(m[1]) * 12 + Number(m[2]);
    return num(s);
  }
  function positionCode(v) {
    const s = String(v ?? '').trim().toUpperCase();
    return { abbrev: s, code: POSITION_ABBREV_TO_EA_CODE[s] };
  }

  // --- CSV rows -> normalized roster ------------------------------------------------------
  function buildClipboardFromCsv(text, teamName) {
    const { headers, rows } = parseCsv(text);
    const errors = [];
    const warnings = [];

    if (!headers.length) {
      return { errors: ['That file is empty — no rows found.'], warnings: [], clipboard: null };
    }
    for (const required of ['firstName', 'lastName', 'position']) {
      if (!headers.includes(required)) {
        errors.push(`Missing required column "${required}". Start from the sample CSV to get the right headers.`);
      }
    }
    const missingRatingCols = REQUIRED_RATINGS.filter((k) => !headers.includes(k));
    if (missingRatingCols.length) {
      errors.push(`Missing ${missingRatingCols.length} rating column(s): ${missingRatingCols.join(', ')}.`);
    }
    if (errors.length) return { errors, warnings, clipboard: null };

    const players = [];
    rows.forEach((r, i) => {
      const line = i + 2; // +1 header, +1 for 1-based
      const first = (r.firstName || '').trim();
      const last = (r.lastName || '').trim();
      if (!first && !last) return; // silently skip blank rows

      const pos = positionCode(r.position);
      if (pos.code === undefined) {
        errors.push(
          `Row ${line} (${first} ${last}): position "${r.position}" isn't recognized. ` +
          `Positions must be spelled out exactly — one of: ${VALID_POSITIONS.join(', ')}.`
        );
        return;
      }

      const ratings = {};
      for (const key of REQUIRED_RATINGS) {
        const raw = r[key];
        if (raw === '' || raw == null) {
          if (errors.length < MAX_COLLECTED_ERRORS) {
            errors.push(`Row ${line} (${first} ${last}): ${key} is blank — every rating except OVR is required.`);
          }
          continue;
        }
        const n = num(raw);
        if (n == null || n < 0 || n > 99) {
          if (errors.length < MAX_COLLECTED_ERRORS) {
            errors.push(`Row ${line} (${first} ${last}): ${key} is "${raw}" — must be a number from 0 to 99.`);
          }
          continue;
        }
        ratings[key] = Math.round(n);
      }
      // OVR is always calculated from the ratings — a CSV that supplies its own value is
      // rejected rather than silently overridden, so a stale number can't look authoritative.
      if (r.OVR !== undefined && r.OVR !== '' && r.OVR != null) {
        if (errors.length < MAX_COLLECTED_ERRORS) {
          errors.push(`Row ${line} (${first} ${last}): OVR is "${r.OVR}" — remove it, OVR is always calculated from the ratings.`);
        }
      }

      const classRaw = String(r.classYear ?? '').trim().toUpperCase();
      let schoolYearCode = CLASS_YEAR_TO_CODE[classRaw];
      if (classRaw && schoolYearCode === undefined) {
        warnings.push(`Row ${line} (${first} ${last}): unrecognized class "${r.classYear}", used FR.`);
      }
      if (schoolYearCode === undefined) schoolYearCode = 0;

      const skin = num(r.skinTone);
      const portraitId = skin != null ? PORTRAIT_ID_BY_SKIN_TONE[skin] ?? null : null;
      if (skin != null && portraitId == null) {
        warnings.push(`Row ${line} (${first} ${last}): skinTone "${r.skinTone}" is outside 0-7, left unchanged.`);
      }

      const weight = num(r.weightLbs);
      if (weight == null) {
        warnings.push(`Row ${line} (${first} ${last}): no weight, kept the template's.`);
      }

      players.push({
        sourcePlayerId: line,
        firstName: first,
        lastName: last,
        jerseyNumber: num(r.jerseyNumber) ?? 0,
        position: pos.abbrev,
        positionCode: pos.code,
        classYear: r.classYear || '',
        schoolYearCode,
        heightInches: heightInches(r.heightInches),
        // weightLbs is required by the merge (it writes weight unconditionally); fall back to a
        // neutral 200 lb only when the CSV omits it entirely.
        weightLbs: weight ?? 200,
        isLefty: bool(r.isLefty),
        devTrait: num(r.devTrait),
        archetypeId: null,
        portraitId,
        skinToneCode: skin,
        ratings,
      });
    });

    if (errors.length) {
      if (errors.length >= MAX_COLLECTED_ERRORS) {
        errors.push(`(stopped after ${MAX_COLLECTED_ERRORS} problems — fix these and re-upload)`);
      }
      return { errors, warnings, clipboard: null };
    }
    if (!players.length) return { errors: ['No player rows found in that file.'], warnings, clipboard: null };

    // --- roster composition ---
    if (players.length < MIN_PLAYERS) {
      errors.push(`Only ${players.length} players — a roster needs at least ${MIN_PLAYERS}.`);
    }
    if (players.length > MAX_PLAYERS) {
      errors.push(`${players.length} players — a roster can hold at most ${MAX_PLAYERS}.`);
    }
    const counts = {};
    for (const p of players) counts[p.position] = (counts[p.position] || 0) + 1;
    const short = findRosterShortfalls(counts);
    if (short.length) {
      const detail = short.map((s) => `${s.position}: has ${s.has}, needs ${s.needs}`).join('; ');
      errors.push(`Not enough players at ${short.length} position(s) — ${detail}.`);
    }
    if (errors.length) return { errors, warnings, clipboard: null };

    // --- derive archetype and OVR from the position-specific CFB 27 weights ---
    let uncalculated = 0;
    for (const p of players) {
      const rating = computePositionRating(p);
      if (rating != null) {
        p.ratings.OVR = rating.overall;
        p.archetypeId = rating.archetype;
      } else {
        uncalculated++;
      }
    }
    if (uncalculated) {
      warnings.push(`${uncalculated} player(s) could not have an archetype or OVR calculated, so those keep the base template's values.`);
    }

    // roster-merge.js pairs players to slots in the order given, best-first within each
    // position — so sort here rather than trusting the spreadsheet's row order.
    players.sort((a, b) =>
      a.positionCode - b.positionCode || (b.ratings.OVR ?? 0) - (a.ratings.OVR ?? 0));

    const positionCounts = {};
    for (const p of players) positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;

    return {
      errors: [],
      warnings,
      clipboard: {
        schemaVersion: 1,
        source: { kind: 'csv', game: 'CSV', teamName: teamName || 'Imported roster' },
        copiedAt: new Date().toISOString(),
        playerCount: players.length,
        positionCounts,
        players,
        warnings: [],
      },
    };
  }

  // The lookup tables and roster rules are shared with csv-export.js so a downloaded CSV always
  // speaks the exact dialect this importer accepts.
  window.TCCsvImport = {
    parseCsv,
    buildClipboardFromCsv,
    RATING_KEYS,
    POSITION_ABBREV_TO_EA_CODE,
    CLASS_YEAR_TO_CODE,
    PORTRAIT_ID_BY_SKIN_TONE,
    POSITION_MINIMUMS,
    POSITION_GROUP_MINIMUMS,
    findRosterShortfalls,
    MIN_PLAYERS,
    MAX_PLAYERS,
  };
})();
