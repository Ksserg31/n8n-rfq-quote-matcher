const fs = require('fs');

const strip = f => fs.readFileSync(f, 'utf8')
  .replace(/\nmodule\.exports[\s\S]*?;\s*$/m, '\n');

const parseSrc = strip('parse.js');
const matchSrc = strip('match.js');
const catalogueCsv = fs.readFileSync('catalogue.csv', 'utf8');

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name, type, typeVersion, position, ...extra
});

const CATALOGUE_NODE = `/* ---------------------------------------------------------------
 * CATALOGUE SOURCE — replace this node with your real source.
 *
 * Swap for: Google Sheets (Get Rows) / Postgres (Select) / HTTP Request
 * to your ERP. The only contract the rest of the workflow needs is
 * one item per article with these fields:
 *
 *   code, description, unit, unit_price_eur, manufacturer
 *
 * Nothing downstream cares where the rows came from.
 * The inline CSV below is the demo catalogue so the workflow runs
 * out of the box.
 * --------------------------------------------------------------- */

const CSV = ${JSON.stringify(catalogueCsv)};

function parseCsv(txt) {
  const lines = txt.trim().split(/\\r?\\n/);
  const head = lines.shift().split(',');
  return lines.map(l => {
    const cells = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const o = {}; head.forEach((h, i) => o[h] = cells[i]);
    o.unit_price_eur = Number(o.unit_price_eur);
    return o;
  });
}

return parseCsv(CSV).map(json => ({ json }));`;

const PARSE_NODE = `/* RFQ text -> line items. See notes inside. */
${parseSrc}

const text = $('Extract from File').first().json.text || '';
const items = parseRfq(text);

if (!items.length) {
  // Loud, not silent: an empty parse means the PDF was scanned, or the
  // layout is one we have not seen. Better to stop than to send an
  // empty quotation.
  throw new Error('No line items could be read from this PDF. If it is a scan, OCR is required first.');
}

return items.map(json => ({ json }));`;

const MATCH_NODE = `/* Matcher. Allowed to say "I don't know" — see CFG. */
${matchSrc}

const items = $input.all().map(i => i.json);
const catalogue = $('Load catalogue').all().map(i => i.json);
const res = matchAll(items, catalogue);

return [{ json: { summary: res.summary, generated_at: new Date().toISOString() } }]
  .concat(res.lines.map(json => ({ json })));`;

const ROWS_NODE = `/* Flatten to spreadsheet rows. Review lines keep their candidates
 * in one cell so the person checking never has to open the JSON. */
const all = $input.all().map(i => i.json);
const summary = all[0].summary ? all.shift().summary : null;

const rows = all.map(l => ({
  Line: l.line,
  'RFQ code': l.raw_code || '',
  'RFQ description': l.raw_description || '',
  Qty: l.qty,
  Unit: l.raw_unit || '',
  'Matched code': l.matched_code || '',
  'Catalogue description': l.matched_description || '',
  'Unit price EUR': l.unit_price_eur,
  'Line total EUR': l.line_total_eur,
  Confidence: l.confidence || '',
  Status: l.status === 'review' ? 'REVIEW' : 'matched',
  'Note / why': l.reason || '',
  Candidates: (l.candidates || []).map(c => c.code + ' (' + c.desc_score + ')').join('  |  ')
}));

if (summary) {
  rows.push({});
  rows.push({
    Line: '', 'RFQ description': 'Lines: ' + summary.total_lines +
      '   matched: ' + summary.matched + '   review: ' + summary.review,
    'Line total EUR': summary.quote_subtotal_eur,
    'Note / why': summary.note
  });
}

return rows.map(json => ({ json }));`;

const wf = {
  name: 'RFQ PDF → catalogue match → Excel quotation draft',
  nodes: [
    node('RFQ upload', 'n8n-nodes-base.formTrigger', 2, [-260, 300], {
      formTitle: 'Quotation request',
      formDescription: 'Upload a text-based RFQ PDF. Scanned PDFs need OCR first.',
      formFields: { values: [{ fieldLabel: 'RFQ PDF', fieldType: 'file', acceptFileTypes: '.pdf', requiredField: true }] },
      options: {}
    }, { webhookId: 'rfq-upload-demo' }),
    node('Extract from File', 'n8n-nodes-base.extractFromFile', 1, [-40, 300], {
      operation: 'pdf', binaryPropertyName: 'RFQ_PDF', options: {}
    }),
    node('Load catalogue', 'n8n-nodes-base.code', 2, [-40, 520], {
      mode: 'runOnceForAllItems', jsCode: CATALOGUE_NODE
    }),
    node('Parse RFQ lines', 'n8n-nodes-base.code', 2, [180, 300], {
      mode: 'runOnceForAllItems', jsCode: PARSE_NODE
    }),
    node('Match against catalogue', 'n8n-nodes-base.code', 2, [400, 300], {
      mode: 'runOnceForAllItems', jsCode: MATCH_NODE
    }),
    node('Rows for Excel', 'n8n-nodes-base.code', 2, [620, 300], {
      mode: 'runOnceForAllItems', jsCode: ROWS_NODE
    }),
    node('Quotation draft.xlsx', 'n8n-nodes-base.convertToFile', 1.1, [840, 300], {
      operation: 'xlsx', options: { fileName: 'quotation_draft.xlsx', sheetName: 'Quotation draft' }
    })
  ],
  connections: {
    'RFQ upload': { main: [[{ node: 'Extract from File', type: 'main', index: 0 }]] },
    'Extract from File': { main: [[{ node: 'Load catalogue', type: 'main', index: 0 }]] },
    'Load catalogue': { main: [[{ node: 'Parse RFQ lines', type: 'main', index: 0 }]] },
    'Parse RFQ lines': { main: [[{ node: 'Match against catalogue', type: 'main', index: 0 }]] },
    'Match against catalogue': { main: [[{ node: 'Rows for Excel', type: 'main', index: 0 }]] },
    'Rows for Excel': { main: [[{ node: 'Quotation draft.xlsx', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { instanceId: 'rfq-demo' },
  tags: []
};

fs.writeFileSync('workflow_rfq_to_quote.json', JSON.stringify(wf, null, 2));
console.log('workflow_rfq_to_quote.json', JSON.stringify(wf).length, 'bytes');
