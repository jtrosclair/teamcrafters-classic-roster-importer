// TeamCrafters Classic Roster Importer
// Copyright (C) 2026 TeamCrafters
//
// This program is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version. This program
// is distributed WITHOUT ANY WARRANTY; see the GNU General Public License for details.
// You should have received a copy of the license along with this program (see LICENSE);
// if not, see <https://www.gnu.org/licenses/>.

// csv-export.js — turns a normalized TeamCrafters roster export (the "clipboard") into a CSV in
// the exact dialect csv-import.js accepts, so a classic roster can be pulled out, edited in a
// spreadsheet, and brought back in. Exposes window.TCCsvExport.
//
// This is a faithful dump, not a repair job. Nothing is invented: ratings the classic game never
// tracked stay blank, and a roster short of the importer's 50-player floor or a position minimum
// is exported short. buildRosterCsv returns a summary naming anything that would block a
// re-import, for the caller to show the user — the file itself is always produced.
(function () {
  const {
    RATING_KEYS,
    POSITION_ABBREV_TO_EA_CODE,
    CLASS_YEAR_TO_CODE,
    PORTRAIT_ID_BY_SKIN_TONE,
    findRosterShortfalls,
    MIN_PLAYERS,
    MAX_PLAYERS,
  } = window.TCCsvImport;

  const BIO_COLUMNS = [
    'firstName', 'lastName', 'position', 'jerseyNumber', 'classYear',
    'heightInches', 'weightLbs', 'isLefty', 'skinTone', 'devTrait',
  ];

  // OVR is derived on import and a supplied value is rejected, so it never appears in the file.
  const RATING_COLUMNS = RATING_KEYS.filter((k) => k !== 'OVR');
  const COLUMNS = [...BIO_COLUMNS, ...RATING_COLUMNS];

  // --- inverse lookups -------------------------------------------------------------------
  // Built from the importer's own tables so the two can't drift.

  // EA position code (0-20) -> exact abbreviation. The clipboard also carries a `position`
  // string, but we invert the code instead: the importer requires exact codes, and the code is
  // what the merge itself keys on.
  const POSITION_BY_CODE = {};
  for (const [abbrev, code] of Object.entries(POSITION_ABBREV_TO_EA_CODE)) {
    POSITION_BY_CODE[code] = abbrev;
  }

  // PLYR_SCHOOLYEAR 0-3 -> FR/SO/JR/SR. The table maps long names onto the same codes, so keep
  // the first (two-letter) spelling for each.
  const CLASS_BY_CODE = {};
  for (const [name, code] of Object.entries(CLASS_YEAR_TO_CODE)) {
    if (CLASS_BY_CODE[code] === undefined) CLASS_BY_CODE[code] = name;
  }

  // Portrait -> one canonical skin tone. Several tones share a portrait, so pick the lowest; it
  // round-trips back to the same portrait on import. The clipboard's own skinToneCode is NOT used
  // — real exports carry values outside the 0-7 the importer understands.
  const SKIN_TONE_BY_PORTRAIT = {};
  for (const [tone, portrait] of Object.entries(PORTRAIT_ID_BY_SKIN_TONE)) {
    if (SKIN_TONE_BY_PORTRAIT[portrait] === undefined) SKIN_TONE_BY_PORTRAIT[portrait] = Number(tone);
  }

  // --- CSV writing -----------------------------------------------------------------------
  // RFC 4180: quote when the value contains a delimiter, quote, or newline; double inner quotes.
  function escapeCell(value) {
    if (value == null) return '';
    const s = String(value);
    if (!/[",\r\n]/.test(s)) return s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function rowFor(player) {
    const portrait = player.portraitId != null ? String(player.portraitId) : null;
    const skinTone = portrait != null ? SKIN_TONE_BY_PORTRAIT[portrait] : undefined;

    const bio = {
      firstName: player.firstName,
      lastName: player.lastName,
      position: POSITION_BY_CODE[player.positionCode],
      jerseyNumber: player.jerseyNumber,
      classYear: CLASS_BY_CODE[player.schoolYearCode],
      heightInches: player.heightInches,
      weightLbs: player.weightLbs,
      isLefty: player.isLefty == null ? null : (player.isLefty ? 'TRUE' : 'FALSE'),
      skinTone: skinTone === undefined ? null : skinTone,
      devTrait: player.devTrait,
    };

    const ratings = player.ratings || {};
    return COLUMNS.map((col) =>
      escapeCell(col in bio ? bio[col] : ratings[col])
    ).join(',');
  }

  // What would stop this file from importing again. Computed from the players rather than by
  // re-parsing the CSV, so the messages can name columns and positions directly.
  function summarize(players) {
    const blankColumns = new Set();
    let blankCells = 0;
    for (const p of players) {
      const ratings = p.ratings || {};
      for (const key of RATING_COLUMNS) {
        const v = ratings[key];
        if (v === undefined || v === null || v === '') {
          blankCells++;
          blankColumns.add(key);
        }
      }
    }

    const counts = {};
    for (const p of players) {
      const pos = POSITION_BY_CODE[p.positionCode];
      if (pos) counts[pos] = (counts[pos] || 0) + 1;
    }
    const shortPositions = findRosterShortfalls(counts);

    return {
      playerCount: players.length,
      blankCells,
      blankColumns: [...blankColumns],
      tooFewPlayers: players.length < MIN_PLAYERS ? MIN_PLAYERS : null,
      tooManyPlayers: players.length > MAX_PLAYERS ? MAX_PLAYERS : null,
      shortPositions,
      get importable() {
        return !this.blankCells && !this.tooFewPlayers && !this.tooManyPlayers &&
          !this.shortPositions.length;
      },
    };
  }

  // clipboard (see README) -> { csv, summary }. The CSV is always produced; summary.importable
  // says whether it would survive a round trip through csv-import.js as-is.
  function buildRosterCsv(clipboard) {
    const players = [...(clipboard.players || [])];

    // Depth-chart order, matching sample-roster.csv and what the importer re-applies anyway.
    players.sort((a, b) =>
      a.positionCode - b.positionCode || (b.ratings?.OVR ?? 0) - (a.ratings?.OVR ?? 0));

    const lines = [COLUMNS.join(','), ...players.map(rowFor)];

    // Leading BOM so Excel reads accented names correctly; parseCsv strips it on the way back in.
    return { csv: '﻿' + lines.join('\r\n') + '\r\n', summary: summarize(players) };
  }

  window.TCCsvExport = { buildRosterCsv, COLUMNS };
})();
