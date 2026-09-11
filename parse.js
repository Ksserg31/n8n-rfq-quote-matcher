/* ------------------------------------------------------------------
 * RFQ text -> line items.
 * Input is the plain text of a text-based PDF (n8n: "Extract from File").
 * Handles the three layouts distributors actually receive:
 *   A) code | description | qty | unit      (tabular)
 *   B) "1.  CBL-NYY-J-5G2.5   Power cable ...   250 m"
 *   C) free text, no code: "12 pcs LED panel 600x600 40W"
 * Anything it cannot parse is returned as an unparsed line rather
 * than silently dropped — a line lost here is a line missing from the
 * quotation, which is worse than a line flagged.
 * ------------------------------------------------------------------ */

const UNIT_WORDS = 'm|mtr|meter|metre|metres|meters|lfm|pc|pcs|pce|piece|pieces|stk|stck|st|ea|each|unit|units|set|sets|box|boxes|roll|rolls';
const UNIT_RE = new RegExp(`\\b(${UNIT_WORDS})\\b`, 'i');

// A product code: letters and digits joined by - _ / or .
// Must contain at least one digit, otherwise ordinary hyphenated words
// ("fit-out", "start-up") get read as article numbers.
const CODE_RE = /\b([A-Z][A-Z0-9]{1,}(?:[-_/.][A-Z0-9]+){1,6})\b/;
const looksLikeCode = c => /\d/.test(c) && /[A-Z]/.test(c);

const NOISE = /^(page\s*\d|seite\s*\d|request for quotation|rfq|quotation request|anfrage|date|datum|customer|kunde|project|projekt|delivery|lieferung|contact|kontakt|total|subtotal|summe|please quote|we kindly|thank you|best regards|mit freundlichen|item\s+(code|no)|pos\.?\s|no\.?\s+description)/i;

function numberish(s) {
  const t = String(s).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseLine(raw, lineNo) {
  const line = raw.replace(/ /g, ' ').trim();
  if (!line || line.length < 4) return null;
  if (NOISE.test(line)) return null;

  let rest = line;

  // leading bullet: "- ", "* ", "• ", "·"
  rest = rest.replace(/^\s*[-*\u2022\u00b7\u2013\u2014]\s+/, '');
  // leading position number: "1.", "01)", "3 -"
  rest = rest.replace(/^\s*\d{1,3}\s*[.)\-]\s+/, '');
  // a second bullet after a position number
  rest = rest.replace(/^\s*[-*\u2022\u00b7]\s+/, '');

  // pipe / tab separated tables
  if (/[|\t]/.test(rest)) {
    const cells = rest.split(/\s*[|\t]\s*/).map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      const codeCell = CODE_RE.test(cells[0].toUpperCase()) ? cells[0] : null;
      const qtyIdx = cells.findIndex((c, i) => i > 0 && numberish(c) !== null);
      const qty = qtyIdx > -1 ? numberish(cells[qtyIdx]) : null;
      const unitCell = cells.slice(qtyIdx + 1).find(c => UNIT_RE.test(c));
      const desc = cells.filter((c, i) => i !== qtyIdx && c !== codeCell && c !== unitCell).join(' ').trim();
      if (qty !== null) {
        return item(lineNo, codeCell, desc, qty, unitCell ? (unitCell.match(UNIT_RE) || [])[1] : null, line);
      }
    }
  }

  // quantity + unit, either trailing ("... 250 m") or leading ("12 pcs LED ...")
  let qty = null, unit = null, work = rest;

  const trailing = work.match(new RegExp(`(?:^|\\s)([0-9][0-9.,\\s]*)\\s*(${UNIT_WORDS})\\.?\\s*$`, 'i'));
  const leading  = work.match(new RegExp(`^([0-9][0-9.,]*)\\s*(${UNIT_WORDS})\\b\\s*`, 'i'));

  if (trailing) {
    qty = numberish(trailing[1]); unit = trailing[2];
    work = work.slice(0, work.length - trailing[0].length).trim();
  } else if (leading) {
    qty = numberish(leading[1]); unit = leading[2];
    work = work.slice(leading[0].length).trim();
  } else {
    const bare = work.match(/(?:^|\s)([0-9][0-9.,]*)\s*$/);
    if (bare) { qty = numberish(bare[1]); work = work.slice(0, work.length - bare[0].length).trim(); }
  }

  const full = work.trim();
  const cm = work.toUpperCase().match(CODE_RE);
  let code = null;
  if (cm && looksLikeCode(cm[1])) {
    const at = work.toUpperCase().indexOf(cm[1]);
    code = work.substr(at, cm[1].length);
    work = (work.slice(0, at) + ' ' + work.slice(at + code.length)).replace(/\s+/g, ' ').trim();
  }

  const desc = work.replace(/^[-–—:\s]+|[-–—:\s]+$/g, '').trim();

  // A line item has to carry at least a quantity or an article code.
  // Prose ("we need a quotation for the following material") has neither,
  // and dropping it here is safer than letting it reach the matcher.
  if (qty === null && !code) return null;
  return item(lineNo, code, desc, qty, unit, line, full);
}

function item(lineNo, code, description, qty, unit, source, full) {
  return {
    line: lineNo,
    code: code || null,
    description: description || null,
    // description with the code left in: some codes ARE part of the
    // product name (H07V-K), and stripping them loses the match.
    description_full: full || description || null,
    qty: qty,
    unit: unit ? unit.toLowerCase() : null,
    source_text: source,
    parse_warning: qty === null ? 'quantity not found on this line' : null
  };
}

function parseRfq(text) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  let n = 0;
  for (const raw of lines) {
    const it = parseLine(raw, n + 1);
    if (it) { n++; it.line = n; items.push(it); }
  }
  return items;
}

module.exports = { parseRfq, parseLine };
