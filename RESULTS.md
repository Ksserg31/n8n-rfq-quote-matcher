# RFQ → catalogue → Excel quotation draft
## Test run, September 2026

Everything below was produced by the files in this folder. Re-run it with
`node run_tests.js`; the numbers are printed, not transcribed.

---

## Result

| | |
|---|---|
| RFQ documents | 3 (three different layouts) |
| Catalogue articles | 44 |
| Line items parsed | 32 of 32 |
| Matched with a price | 28 |
| Sent to human review | 4 |
| **Wrong articles matched** | **0** |
| Quotation subtotal, matched lines only | € 13 324.40 |

The last row of the first table is the only one that matters. A line sent to
review costs a person thirty seconds. A line matched to the wrong article
costs a wrong price in a quotation that has already gone out.

---

## What the three documents contain

**`rfq_01_voltmark.pdf`** — clean tabular RFQ, every article code correct.
Ten lines, ten matched. Includes a quantity written European-style
(`1.200` meaning one thousand two hundred) to confirm it is not read as 1.2.

**`rfq_02_nordlicht.pdf`** — the same shape, but deliberately dirty:

| Line | What is wrong with it | Result |
|---|---|---|
| 1 | Code typed lowercase with spaces: `cbl nyy j 5g4` | matched `CBL-NYY-J-5G4`, confidence 0.98, reason logged as *code written without separators* |
| 3 | Typo: `MCB-B16-3B` — no such article; `3P` exists | matched `MCB-B16-3P` via the description, which says *3-pole*. Not matched to `MCB-B16-1P`, which is the expensive mistake here |
| 8 | Code correct, but the RFQ asks in metres and the catalogue sells pieces | **review** — matched code shown, price withheld, note: *unit differs, quantity must be confirmed* |
| 9 | `FLT-EMC-3P-16`, an article that simply is not in the catalogue | **review** — *no plausible catalogue article*. Nothing invented |

**`rfq_03_workshop.pdf`** — an email with no article codes at all, twelve
lines of free-text description.

| Line | Why it is hard | Result |
|---|---|---|
| 4 | "63A 4-pole 30mA type A" — the catalogue also has 40A 4-pole and 40A 2-pole | matched `RCD-63-4P-30`, not collapsed to a 40A variant |
| 5 | "miniature circuit breaker B16" — exists as 1-pole **and** 3-pole | **review** — *ambiguous: MCB-B16-1P and MCB-B16-3P score within 0.0 points*, both offered to the reviewer |
| 8 | "H07V-K 1x10" against a catalogue that also stocks 1x6 | matched `CBL-H07V-K-1X10` |
| 10 | "LED panel 600x600 30W" against an otherwise identical 40W panel | matched `LED-PAN-600-30` |
| 11 | "terminal block screw 4mm² grey" against 2.5mm² grey and 2.5mm² blue | matched `TB-4-GY` |
| 12 | "cable drum trolley, steel, 400mm" — not an electrical article at all | **review** — *no plausible catalogue article* |

---

## How it decides

Four tiers, each of which has to clear an absolute score **and** a margin
over the runner-up. A tie is not a winner; a tie is a question.

1. **Exact code** after normalisation (case, spaces, separators removed) → confidence 1.00
2. **Code typed without separators**, recovered from the description text → 0.98
3. **Near-miss code**, accepted only if the description agrees with it → ≤ 0.96
4. **Description only**, accepted only above 0.82 **and** at least 0.08 clear of the second-best candidate → ≤ 0.93

Anything else stops, and carries with it the three best candidates with their
scores, so the person deciding sees what the machine saw.

Two extra guards:

- **Numbers are weighted double** in the description comparison. In electrical
  parts the number *is* the product: 16 versus 32, 1-pole versus 3-pole,
  2.5 mm² versus 4 mm². Word-level similarity alone will confuse these, and
  that is where silent substitutions come from.
- **Unit conflicts are never resolved automatically.** If the RFQ says metres
  and the catalogue sells pieces, the line goes to review with its code
  attached, because the quantity has a different meaning in each.

---

## Where it will fail, stated in advance

- **Scanned PDFs.** There is no OCR in this pipeline. The workflow throws a
  named error instead of producing an empty quotation, but the document still
  needs OCR upstream. Adding it is a separate, priced step.
- **Descriptions split across two lines** in the source table. Currently each
  physical line is one item; wrapped descriptions need a merge rule, which
  depends on the actual layout of your customers' documents.
- **A catalogue with near-duplicate articles** (same description, different
  manufacturer) will push more lines to review rather than fewer. That is the
  intended behaviour, but it changes the review workload, and it is worth
  measuring on your real price list before agreeing a target.
- **Thresholds are tuned on 44 articles.** On a catalogue of thousands the
  right numbers will be different. They are three constants at the top of the
  matcher, and the honest way to set them is to run your own RFQs through and
  read the false-match count — which is exactly what `run_tests.js` prints.

---

## Files

| File | What it is |
|---|---|
| `catalogue.csv` | 44-article demo catalogue |
| `samples/*.pdf` | the three RFQ documents |
| `parse.js` | PDF text → line items |
| `match.js` | line items + catalogue → matches, confidences, review reasons |
| `run_tests.js` | runs both against `tests/ground_truth.json` and prints the table above |
| `tests/ground_truth.json` | expected result for every one of the 32 lines, with the reason each line is in the set |
| `tests/results.json` | full output of the last run |
| `samples/quotation_draft.xlsx` | the Excel deliverable: one sheet per RFQ plus a combined review queue |
| `workflow_rfq_to_quote.json` | the n8n workflow, importable as-is; `parse.js` and `match.js` are inlined in Code nodes |

No external libraries. `match.js` and `parse.js` run unchanged inside an n8n
Code node and inside plain Node, which is why the tests test the same code
that runs in production rather than a copy of it.
