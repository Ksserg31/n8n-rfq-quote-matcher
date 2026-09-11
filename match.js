/* ------------------------------------------------------------------
 * RFQ line-item matcher  —  dependency-free, runs unchanged in an
 * n8n Code node (Run Once for All Items) and in plain Node for tests.
 *
 * Design rule: the matcher is allowed to say "I don't know".
 * A wrong price on a quotation costs more than a line a human checks,
 * so every tier below has to clear BOTH an absolute score and a
 * margin over the runner-up. Ties go to review, never to the winner.
 * ------------------------------------------------------------------ */

const CFG = {
  CODE_FUZZY_MIN:   0.88,  // code similarity needed when codes differ
  CODE_DESC_SUPPORT:0.55,  // description must not contradict a fuzzy code hit
  DESC_MIN:         0.82,  // description-only match, absolute floor
  DESC_MARGIN:      0.08,  // ...and it must beat the runner-up by this much
  CODE_MARGIN:      0.05,
  CANDIDATES:       3      // how many alternatives to show a reviewer
};

/* ---------- normalisation ---------- */

const stripDiacritics = s =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function normCode(s) {
  return stripDiacritics(String(s || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const UNIT_MAP = {
  'm': 'm', 'mtr': 'm', 'meter': 'm', 'metre': 'm', 'metres': 'm', 'meters': 'm', 'lfm': 'm',
  'pc': 'pc', 'pcs': 'pc', 'pce': 'pc', 'piece': 'pc', 'pieces': 'pc',
  'stk': 'pc', 'stck': 'pc', 'st': 'pc', 'ea': 'pc', 'each': 'pc', 'unit': 'pc', 'units': 'pc',
  'set': 'set', 'sets': 'set',
  'box': 'box', 'boxes': 'box',
  'roll': 'roll', 'rolls': 'roll'
};

function normUnit(s) {
  const k = stripDiacritics(String(s || '')).toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_MAP[k] || (k || null);
}

// Descriptions: fold the notation that varies between a customer's RFQ
// and a distributor's catalogue but means the same thing.
const DESC_SYNONYM = [
  [/\bmm2\b|\bmm²\b|\bsqmm\b|\bsq mm\b/g, 'mm2'],
  [/\bmcb\b|\bminiature circuit breaker\b|\bcircuit breaker\b|\bautomat\b/g, 'mcb'],
  [/\brcd\b|\brccb\b|\bresidual current\b|\bearth leakage\b|\bfi switch\b|\bfi\b/g, 'rcd'],
  [/\bpole\b|\bpoles\b|\bp\b(?=\s|$)/g, 'pole'],
  [/\bcontactor\b|\bschutz\b/g, 'contactor'],
  [/\bpsu\b|\bpower supply\b|\bnetzteil\b/g, 'psu'],
  [/\benclosure\b|\bcabinet\b|\bgehause\b|\bgehaeuse\b/g, 'enclosure'],
  [/\bgland\b|\bverschraubung\b/g, 'gland'],
  [/\bsocket\b|\bsteckdose\b/g, 'socket'],
  [/\bcable\b|\bkabel\b|\bleitung\b/g, 'cable'],
  [/\bgrey\b|\bgray\b|\bgrau\b/g, 'grey'],
  [/\bvac\b|\bv ac\b/g, 'vac'],
  [/\bvdc\b|\bv dc\b/g, 'vdc']
];

const STOP = new Set(['the','a','an','and','or','of','for','with','type','pcs','pc','st','stk']);

function normDesc(s) {
  let t = stripDiacritics(String(s || '')).toLowerCase();
  t = t.replace(/\u00b2/g, '2').replace(/\u00b3/g, '3');   // mm² -> mm2
  t = t.replace(/[×x](?=\d)/g, 'x');
  t = t.replace(/[^a-z0-9.,/x-]+/g, ' ');
  t = t.replace(/,(?=\d)/g, '.');           // 2,5 mm² -> 2.5 mm2
  for (const [re, to] of DESC_SYNONYM) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function tokens(s) {
  return normDesc(s).split(' ').filter(w => w && !STOP.has(w));
}

/* ---------- similarity ---------- */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a, b) =>
  (!a.length && !b.length) ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);

// Token-set similarity, weighted so that numeric tokens (16, 2.5, 400)
// count double: in electrical parts the number IS the product.
function tokenSetSim(aTok, bTok) {
  if (!aTok.length || !bTok.length) return 0;
  const w = t => (/\d/.test(t) ? 2 : 1);
  const bPool = bTok.slice();
  let inter = 0, aW = 0, bW = 0;
  for (const t of aTok) aW += w(t);
  for (const t of bTok) bW += w(t);
  for (const t of aTok) {
    let bi = -1, best = 0;
    for (let i = 0; i < bPool.length; i++) {
      const r = ratio(t, bPool[i]);
      if (r > best) { best = r; bi = i; }
    }
    if (best >= 0.86 && bi >= 0) { inter += w(t) * best; bPool.splice(bi, 1); }
  }
  return (2 * inter) / (aW + bW);
}

function descSim(a, b) {
  const at = tokens(a), bt = tokens(b);
  const set = tokenSetSim(at, bt);
  const seq = ratio(normDesc(a), normDesc(b));
  return 0.75 * set + 0.25 * seq;   // set-based leads; sequence breaks ties
}

/* ---------- matching ---------- */

function buildIndex(catalogue) {
  const byCode = new Map();
  const rows = catalogue.map(c => {
    const r = {
      code: String(c.code).trim(),
      description: String(c.description || ''),
      unit: normUnit(c.unit),
      unit_price_eur: Number(c.unit_price_eur),
      manufacturer: c.manufacturer || null,
      _nc: normCode(c.code),
      _dt: tokens(c.description)
    };
    byCode.set(r._nc, r);
    return r;
  });
  return { rows, byCode };
}

function scoreAll(item, idx) {
  const d1 = item.description || '';
  const d2 = item.description_full || d1;
  return idx.rows.map(r => ({
    row: r,
    code: item.code ? ratio(normCode(item.code), r._nc) : 0,
    desc: Math.max(descSim(d1, r.description), d2 === d1 ? 0 : descSim(d2, r.description))
  }));
}

function matchItem(item, idx) {
  const out = {
    line: item.line,
    raw_code: item.code || null,
    raw_description: item.description || null,
    qty: item.qty,
    raw_unit: item.unit || null,
    status: 'review',
    reason: null,
    matched_code: null,
    matched_description: null,
    unit: null,
    unit_price_eur: null,
    line_total_eur: null,
    confidence: 0,
    candidates: []
  };

  // Tier 1 — exact normalised code.
  if (item.code) {
    const hit = idx.byCode.get(normCode(item.code));
    if (hit) return finish(out, hit, 1.0, normCode(item.code) === normCode(hit.code) && item.code.trim() === hit.code ? 'exact code' : 'code, normalised');
  }

  // Tier 1b — the code exists but was typed without separators:
  // "cbl nyy j 5g4" instead of "CBL-NYY-J-5G4". Distributors' customers
  // do this constantly; treating it as a description match loses it.
  if (item.description_full || item.description) {
    const toks = String(item.description_full || item.description).trim().split(/\s+/);
    for (let k = Math.min(7, toks.length); k >= 2; k--) {
      const joined = normCode(toks.slice(0, k).join(''));
      if (joined.length < 6) continue;
      const hit = idx.byCode.get(joined);
      if (hit) return finish(out, hit, 0.98, 'code written without separators');
    }
  }

  const scored = scoreAll(item, idx);

  // Tier 2 — fuzzy code, but only if the description does not contradict it.
  if (item.code) {
    const byCode = scored.slice().sort((a, b) => b.code - a.code);
    const top = byCode[0], next = byCode[1];
    if (top && top.code >= CFG.CODE_FUZZY_MIN &&
        top.desc >= CFG.CODE_DESC_SUPPORT &&
        (!next || top.code - next.code >= CFG.CODE_MARGIN)) {
      return finish(out, top.row, Math.min(0.96, 0.6 * top.code + 0.4 * top.desc), 'code near-match, description agrees');
    }
    if (top && top.code >= CFG.CODE_FUZZY_MIN && top.desc < CFG.CODE_DESC_SUPPORT) {
      out.reason = 'code looks close but description disagrees — possible typo on a different article';
      out.candidates = topN(byCode, item);
      return out;
    }
  }

  // Tier 3 — description only.
  const byDesc = scored.slice().sort((a, b) => b.desc - a.desc);
  const top = byDesc[0], next = byDesc[1];
  if (top && top.desc >= CFG.DESC_MIN && (!next || top.desc - next.desc >= CFG.DESC_MARGIN)) {
    const unitClash = item.unit && top.row.unit && normUnit(item.unit) !== top.row.unit;
    if (unitClash) {
      out.reason = `description matches ${top.row.code} but unit differs (RFQ "${item.unit}" vs catalogue "${top.row.unit}")`;
      out.candidates = topN(byDesc, item);
      return out;
    }
    return finish(out, top.row, Math.min(0.93, top.desc), 'description match, clear margin');
  }

  out.reason = !top || top.desc < 0.45
    ? 'no plausible catalogue article'
    : (next && top.desc - next.desc < CFG.DESC_MARGIN
        ? `ambiguous: ${top.row.code} and ${next.row.code} score within ${((top.desc - next.desc) * 100).toFixed(1)} points`
        : 'below confidence threshold');
  out.candidates = topN(byDesc, item);
  return out;

  function finish(o, row, conf, reason) {
    o.status = 'matched';
    o.reason = reason;
    o.matched_code = row.code;
    o.matched_description = row.description;
    o.unit = row.unit;
    o.unit_price_eur = row.unit_price_eur;
    o.line_total_eur = round2(row.unit_price_eur * (Number(o.qty) || 0));
    o.confidence = round3(conf);
    const unitClash = o.raw_unit && row.unit && normUnit(o.raw_unit) !== row.unit;
    if (unitClash) {
      o.status = 'review';
      o.reason = `matched ${row.code} but unit differs (RFQ "${o.raw_unit}" vs catalogue "${row.unit}") — quantity must be confirmed`;
    }
    return o;
  }
}

function topN(sortedScored, item) {
  return sortedScored.slice(0, CFG.CANDIDATES).map(s => ({
    code: s.row.code,
    description: s.row.description,
    unit: s.row.unit,
    unit_price_eur: s.row.unit_price_eur,
    code_score: round3(s.code),
    desc_score: round3(s.desc)
  }));
}

const round2 = n => Math.round(n * 100) / 100;
const round3 = n => Math.round(n * 1000) / 1000;

function matchAll(items, catalogue) {
  const idx = buildIndex(catalogue);
  const lines = items.map(it => matchItem(it, idx));
  const matched = lines.filter(l => l.status === 'matched');
  return {
    lines,
    summary: {
      total_lines: lines.length,
      matched: matched.length,
      review: lines.length - matched.length,
      quote_subtotal_eur: round2(matched.reduce((s, l) => s + (l.line_total_eur || 0), 0)),
      note: 'Lines in review carry no price and are excluded from the subtotal by design.'
    }
  };
}

module.exports = { matchAll, matchItem, buildIndex, normCode, normUnit, normDesc, descSim, CFG };
