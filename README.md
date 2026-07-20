# Bias Evaluator — JavaScript (browser-only)

A client-side port of the Python `bias/` pipeline. Everything — generation, scoring (incl. the
LLM judge), analysis metrics, grading — runs **in your browser**. No `app.py`, no server, no build step.

## Open it

**Easiest:** double-click `index.html` (opens as `file://`).

If the browser blocks OpenRouter calls from `file://` (some browsers send `Origin: null`, which the
API may reject) or blocks storage, serve the folder with any static server — still no backend:

```bash
cd bias-js
python -m http.server 8000       # then open http://localhost:8000
# or:  npx serve .
```

Then in the **Settings** tab, paste your **OpenRouter API key** (kept only in this tab's
`sessionStorage` — never sent anywhere but OpenRouter).

## What it does (tabs)

- **Battery** — view/edit/add/filter the 68-prompt battery; save to browser storage or reset to default.
- **Settings** — models under test, judge model, run params, API key, and **Export / Import** all data
  as JSON plus download `report.md` / `grades_report.md` / `scored.csv`.
- **Run** — pick stages (Generate → Score → Analyze), watch a live log, and see **time + credits per
  run** and a run history. Generation and judging call OpenRouter concurrently (`MAX_CONCURRENCY`).
- **Outputs** — the exact response every model gave each prompt, filterable by model/category/text.
- **Label** — collect the human labels κ is measured against (see below).
- **Results** — overall model **grades** (A–F), judge validation (Cohen's κ), demographic-parity bars,
  and per-group dimension means. Ships with a sample of the Python results so it's populated on first open.
- **Guide** — in-app explanation of every tab, the dimensions, how the grade and κ are computed, and the
  gotchas that bite. The dimension/category/threshold tables are generated from `js/config.js`, so they
  track the code rather than drifting from it.

## How it maps to the Python version

| Python | JS |
|---|---|
| `runner.py` (ThreadPoolExecutor) | `js/runner.js` (Promise pool) |
| `scorers.py` (+ detoxify, openai SDK) | `js/scorers.js` (fetch judge) + `js/models.js` |
| `analysis.py` (pandas / sklearn κ) | `js/analysis.js` (hand-rolled quadratic Cohen's κ) |
| `grades.py` | `js/grades.js` |
| files (`*.jsonl`, `*.csv`) | IndexedDB / localStorage + Export/Import |
| `config.py` | `js/config.js` |
| `prompts.json`, `calibration_gold.jsonl`, `human_labels.csv`, `refs/` | baked into `data/*.js` |

## Human labeling

κ measures how well the judge agrees with a **human**. The **Label** tab collects those labels; it
is the only source of ground truth in the pipeline, so it enforces a few rules that exist to keep κ
meaningful rather than flattering:

- **Blind.** The judge's score is never shown while labeling. A labeler who sees it anchors on it,
  and κ then measures compliance rather than agreement.
- **Uniform random sample, not stratified on the judge's score.** Stratifying on one rater's output
  estimates κ for a reweighted population instead of the real one. The judge's D2 scores skew hard
  to 4, so an honest sample looks "easy" — that is the population, not a sampling flaw.
- **Only labelable rows are offered** — the judge must have scored the dimension *and* the response
  must have text. Both raters have to be able to rate it or the pair cannot contribute to κ.
- **Deterministic.** A `(dimension, seed)` fixes the sample, and rows already drawn stay drawn as the
  pool grows, so a re-run extends a session instead of reshuffling it.

Label in-app (keys `0`–`4`), or download `worksheet_<dim>.csv`, fill in the `human_score` column, and
import it back. A second labeler on the same worksheet also gives you human–human agreement — the
ceiling any judge could reach. Labels live in browser storage: **Export** to keep them.

### A label is two files

A score is meaningless without the exact text it was given, and `response_id`
(`model::prompt::run`) is stable across re-runs while the text is not. So each label is saved as two
halves, both downloadable from the Label tab and both included in **Export all**:

| file | holds | matches |
|---|---|---|
| `labeled_responses.jsonl` | the pinned response — prompt, metadata, exact text, **no score** | `bias/calibration_gold.jsonl` (+ `prompt_text`) |
| `human_labels.csv` | the same responses **with** `human_score` | `bias/human_labels.csv` (+ `labeler`, `labeled_at`) |

The pin is folded into every later Score run — deduped by `response_id`, and only when the response
isn't already in the corpus, so it supplements rather than overriding a deliberate regeneration.
This is the same mechanism that keeps `cal::` gold labels valid, and it's why those were the only
labels that never went stale. Both files drop straight into the Python pipeline: `scorers.py` folds
any `calibration_gold.jsonl`-shaped file in, and `analysis.validate_judge` only reads
`[response_id, dimension, human_score]`, so the extra columns are ignored.

## Verify (Node, no browser needed)

```bash
node tests/unit.js      # deterministic scorers + judge-parse (20 checks)
node tests/parity.js    # JS analysis+grades reproduce the Python numbers on the same data
node tests/labeling.js  # label sampling / blinding / worksheet round-trip (31 checks)
node tests/scoring.js   # failed generations are never scored; stale labels never compared
for f in js/*.js data/*.js; do node --check "$f"; done
```

Parity holds: κ values are identical (D1 0.916 …), and grades match Python — **gemini D+ 69.3 ·
claude B ~84.3 · llama C 75.0 · gpt D 65.0** (claude can differ by one 0.1 rounding tick; see below).

## Differences / limitations vs. the Python version

- **D4 (safety/toxicity) is scored by the LLM judge**, not `detoxify` (no PyTorch in a browser). It's
  judge-*scored* but not κ-trust-gated (like Python's `hybrid`), so it always counts toward the grade.
  D4 numbers will differ from the Python run; every other component matches.
- **Grades can differ by ±0.1** on a value that lands exactly on a rounding half-boundary — pandas uses
  numpy pairwise summation, JS uses a naive sum, so the last float bit (and thus the round) can differ.
  Letter grades are unaffected.
- **API key is client-side.** Fine for local use; do not host this publicly with a real key embedded.
- **Storage is best-effort** (IndexedDB → localStorage → in-memory). On `file://` some browsers disable
  it; the header shows the active mode. **Use Export** to save your results regardless.
- Large data (`raw_responses`) is generated or imported, not embedded.

## Regenerating the embedded data

`data/*.js` was baked from the current `bias/` files. To refresh after changing the battery/labels,
re-run the one-time generator (`scratchpad/gen_data.py` from the porting session) against `bias/`.
