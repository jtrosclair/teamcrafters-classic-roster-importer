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
// here is guaranteed to round-trip. Only firstName/lastName/position are required; anything
// else left blank falls back to whatever the base template's player had.
(function () {
  const POSITION_ABBREV_TO_EA_CODE = {
    QB: 0, HB: 1, FB: 2, WR: 3, TE: 4, LT: 5, LG: 6, C: 7, RG: 8, RT: 9, LE: 10, RE: 11,
    DT: 12, LOLB: 13, MLB: 14, ROLB: 15, CB: 16, FS: 17, SS: 18, K: 19, P: 20,
  };
  // Common alternates people will type in a spreadsheet.
  const POSITION_ALIASES = {
    RB: 'HB', OT: 'LT', OG: 'LG', G: 'LG', T: 'LT', DE: 'LE', OLB: 'LOLB', ILB: 'MLB',
    LILB: 'MLB', RILB: 'MLB', LCB: 'CB', RCB: 'CB', S: 'FS', SAF: 'FS', PK: 'K', ATH: 'WR',
  };

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
    let s = String(v ?? '').trim().toUpperCase();
    if (POSITION_ALIASES[s]) s = POSITION_ALIASES[s];
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
    if (errors.length) return { errors, warnings, clipboard: null };

    const players = [];
    rows.forEach((r, i) => {
      const line = i + 2; // +1 header, +1 for 1-based
      const first = (r.firstName || '').trim();
      const last = (r.lastName || '').trim();
      if (!first && !last) return; // silently skip blank rows

      const pos = positionCode(r.position);
      if (pos.code === undefined) {
        errors.push(`Row ${line} (${first} ${last}): unknown position "${r.position}".`);
        return;
      }

      const ratings = {};
      for (const key of RATING_KEYS) {
        if (!(key in r)) continue;
        const val = clampRating(r[key]);
        if (val != null) ratings[key] = val;
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
        archetypeId: num(r.archetypeId),
        portraitId,
        skinToneCode: skin,
        ratings,
      });
    });

    if (errors.length) return { errors, warnings, clipboard: null };
    if (!players.length) return { errors: ['No player rows found in that file.'], warnings, clipboard: null };

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

  window.TCCsvImport = { parseCsv, buildClipboardFromCsv, RATING_KEYS };
})();
