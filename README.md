# RFQ → catalogue → Excel quotation draft

An n8n pipeline that reads quotation requests from PDF, matches the line
items against a catalogue and price list, and produces an Excel quotation
draft — **escalating anything it is not sure about to a human instead of
guessing**.

Run the tests before you read the code. The numbers are the point.

```
node run_tests.js
```

```
lines tested      32
passed            32
failed             0
sent to review     4
FALSE MATCHES      0   <- the number that matters
```

---

## Why the last number is the only one that matters

In document automation the expensive failure is not the line a human has
to check. It is the plausible wrong answer that nobody notices until it
reaches a customer.

A line sent to review costs someone thirty seconds. A line matched to the
wrong article costs a wrong price in a quotation that has already left the
building.

So this matcher is allowed to say *I don't know*, and it says it four
times out of thirty-two — every time for a reason it can state:

| Line | Why it stopped |
|---|---|
| `miniature circuit breaker B16` | exists as 1-pole **and** 3-pole, scores identical → shows both rather than picking |
| `FLT-EMC-3P-16` | not in the catalogue at all → nothing invented |
| `ML-CU-12X2` | code correct, but the request asks in metres and the catalogue sells pieces → price withheld, quantity flagged |
| `cable drum trolley` | not an electrical article → no plausible match |

And two traps it does **not** fall into:

- `MCB-B16-3B` — a typo; no such article. Resolved to `MCB-B16-3P` using
  the description, which says *3-pole*. Not to `MCB-B16-1P`, which is the
  expensive mistake.
- `cbl nyy j 5g4` — the code typed lowercase with spaces instead of
  separators. Recovered to `CBL-NYY-J-5G4`.

---

## How it decides

Four tiers. Each has to clear an absolute score **and** a margin over the
runner-up. A tie is not a winner; a tie is a question.

| Tier | Condition | Max confidence |
|---|---|---|
| 1 | exact code after normalising case, spaces, separators | 1.00 |
| 2 | code typed without separators, recovered from the description | 0.98 |
| 3 | near-miss code, accepted **only** if the description agrees | 0.96 |
| 4 | description only, ≥ 0.82 **and** ≥ 0.08 clear of second place | 0.93 |

Anything else stops and carries its three best candidates with their
scores, so the person deciding sees what the machine saw.

Two guards that matter for this domain specifically:

- **Numbers are weighted double** in the description comparison. In
  electrical parts the number *is* the product: 16 vs 32, 1-pole vs
  3-pole, 2.5 mm² vs 4 mm². Plain text similarity is what produces silent
  substitutions.
- **Unit conflicts are never resolved automatically.** Metres versus
  pieces changes what the quantity means.

---

## Where it will fail

Stated up front, because finding out later is the whole problem this repo
is about.

- **Scanned PDFs.** No OCR here. The workflow throws a named error rather
  than producing an empty quotation, but the file still needs OCR first.
- **Descriptions wrapped across two lines** in a source table need a merge
  rule that depends on the actual layouts involved.
- **Thresholds are tuned on 44 articles.** On a price list of thousands
  the right numbers are different. They are three constants at the top of
  `match.js`, and the honest way to set them is to run real documents
  through and read the false-match count — which the test runner prints.
- **A catalogue with near-duplicate articles** across manufacturers will
  push *more* lines to review, not fewer. Intended, but it changes the
  review workload.

---

## Files

| File | What it is |
|---|---|
| `workflow_rfq_to_quote.json` | the n8n workflow, importable as-is |
| `match.js` | the matcher — tiers, thresholds, review reasons |
| `parse.js` | PDF text → line items |
| `run_tests.js` | runs both against the ground truth and prints the table |
| `tests/ground_truth.json` | all 32 lines with the reason each is in the set |
| `catalogue.csv` | 44-article demo catalogue |
| `samples/*.pdf` | three RFQ documents in three layouts |
| `samples/quotation_draft.xlsx` | the Excel output, including the review queue |
| `RESULTS.md` | the full test report |

No external libraries. `match.js` and `parse.js` run unchanged inside an
n8n Code node and in plain Node, which is why the tests test the same code
that runs in production rather than a copy of it.

## Running the workflow

1. Import `workflow_rfq_to_quote.json` into n8n.
2. Replace the **Load catalogue** node with your real source — Google
   Sheets, Postgres, or an HTTP call to your ERP. The only contract the
   rest of the workflow needs is one item per article with `code`,
   `description`, `unit`, `unit_price_eur`.
3. Open the form trigger and upload a text-based PDF.

The demo catalogue is inlined in the Load catalogue node so the workflow
runs out of the box.

## Data

Everything here is synthetic. The catalogue, the three RFQ documents and
the company names in them were written for this repository. No client data.

## Licence

MIT — see `LICENSE`.
