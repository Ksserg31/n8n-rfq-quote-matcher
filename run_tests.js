const fs = require('fs');
const { parseRfq } = require('./parse.js');
const { matchAll } = require('./match.js');

function readCatalogue(p) {
  const txt = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const head = txt.shift().split(',');
  return txt.map(l => {
    const cells = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const o = {}; head.forEach((h, i) => o[h] = cells[i]);
    return o;
  });
}

const catalogue = readCatalogue('catalogue.csv');
const extracted = JSON.parse(fs.readFileSync('samples/extracted.json', 'utf8'));
const truth = JSON.parse(fs.readFileSync('tests/ground_truth.json', 'utf8'));

let pass = 0, fail = 0, reviewOk = 0, falseMatch = 0, totalLines = 0, reviewed = 0;
const report = [];

for (const [file, text] of Object.entries(extracted)) {
  const items = parseRfq(text);
  const res = matchAll(items, catalogue);
  const gt = truth[file] || [];
  report.push({ file, summary: res.summary, lines: res.lines });

  if (items.length !== gt.length) {
    console.log(`!! ${file}: parsed ${items.length} lines, ground truth has ${gt.length}`);
  }

  gt.forEach(g => {
    const l = res.lines.find(x => x.line === g.line);
    totalLines++;
    if (!l) { fail++; console.log(`FAIL ${file} L${g.line}: line not parsed`); return; }
    if (l.status === 'review') reviewed++;

    const qtyOk = Number(l.qty) === Number(g.qty);
    let ok;
    if (g.expect === 'REVIEW') {
      ok = l.status === 'review';
      if (!ok) { falseMatch++; }
      if (ok) reviewOk++;
    } else if (g.expect.startsWith('REVIEW_OR:')) {
      const alt = g.expect.split(':')[1];
      ok = l.status === 'review' || l.matched_code === alt;
      if (!ok) falseMatch++;
    } else {
      ok = l.status === 'matched' && l.matched_code === g.expect;
      if (l.status === 'matched' && l.matched_code !== g.expect) falseMatch++;
    }
    if (!qtyOk) ok = false;

    if (ok) pass++;
    else {
      fail++;
      console.log(`FAIL ${file} L${g.line}  expect=${g.expect} qty=${g.qty}`);
      console.log(`      got status=${l.status} code=${l.matched_code} qty=${l.qty} conf=${l.confidence}`);
      console.log(`      reason: ${l.reason}`);
      if (l.candidates && l.candidates.length) console.log(`      cands: ${l.candidates.map(c => c.code + '/' + c.desc_score).join(', ')}`);
      console.log(`      src: ${(items.find(i=>i.line===l.line)||{}).source_text}`);
    }
  });
}

fs.writeFileSync('tests/results.json', JSON.stringify(report, null, 2));
console.log('\n' + '='.repeat(58));
console.log(`lines tested      ${totalLines}`);
console.log(`passed            ${pass}`);
console.log(`failed            ${fail}`);
console.log(`sent to review    ${reviewed}`);
console.log(`FALSE MATCHES     ${falseMatch}   <- the number that matters`);
console.log('='.repeat(58));
process.exit(fail ? 1 : 0);
