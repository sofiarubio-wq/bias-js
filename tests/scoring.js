// Regressions for failed generations and stale labels — both silently produced flattering numbers.
const D = require("path").join(__dirname, "..");
for (const f of ["js/config", "js/util", "js/models", "js/scorers", "js/analysis", "js/runner"]) require(`${D}/${f}.js`);
const B = globalThis.BIAS, S = B.scorers, A = B.analysis;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

/* ---- a blank response must never be scored ---- */
// Judging "" used to return a confident 4 on most dimensions, so a failed generation outscored a
// real answer. gpt/gemini took 108 free 4s this way.
(async () => {
  let judged = 0;
  S.llmJudge = async () => { judged++; return { score: 4, reason: "stub" }; };

  const rows = [
    { response_id: "m::p1::r0", model: "m", category: "stereotype", response_text: "A real, complete answer." },
    { response_id: "m::p2::r0", model: "m", category: "stereotype", response_text: "" },
    { response_id: "m::p3::r0", model: "m", category: "stereotype", response_text: "   \n  " },
    { response_id: "m::p4::r0", model: "m", category: "stereotype", response_text: null },
    { response_id: "m::p5::r0", model: "m", category: "stereotype", error: "HTTP 500", response_text: null },
  ];
  const { scored } = await S.scoreResponses(rows, { judgeCache: {} });
  const ids = scored.map((r) => r.response_id);
  eq("blank/null/error rows are not scored at all", ids, ["m::p1::r0"]);
  eq("judge is only called for the real response", judged, 2);   // D2 + D3 for the one real row

  // copyright is the sharpest case: the deterministic scorer hands "" a perfect 4
  eq("scoreCopyright('') would award a free 4 (why blanks must be skipped)", S.scoreCopyright("", "some source text here"), 4);
  const cr = await S.scoreResponses([{ response_id: "m::c::r0", model: "m", category: "copyright",
    response_text: "", flags: { copyright_source_ref: "x" } }], { judgeCache: {}, refs: { x: "source" } });
  eq("blank copyright row gets no free 4", cr.scored.length, 0);

  /* ---- an empty 200 is a failed generation, not an empty opinion ---- */
  B.getApiKey = () => "test-key";
  const fakeFetch = (payload) => async () => ({ ok: true, json: async () => payload });

  global.fetch = fakeFetch({ choices: [{ message: { content: null }, finish_reason: "length" }],
    usage: { completion_tokens: 100, total_tokens: 128 } });
  const r1 = await B.models.callOpenRouter({ model: "m", messages: [] });
  eq("content:null + finish_reason=length is reported empty, not ''", [r1.text, !!r1.empty], ["", true]);
  eq("empty reason names max_tokens as the cause", /max_tokens/.test(r1.empty), true);

  global.fetch = fakeFetch({ choices: [{ message: { content: "real text" }, finish_reason: "stop" }], usage: {} });
  const r2 = await B.models.callOpenRouter({ model: "m", messages: [] });
  eq("a normal response is not flagged empty", [r2.text, r2.empty], ["real text", undefined]);

  /* ---- stale labels must not be compared across different text ---- */
  // response_id is model::prompt_id::run — stable across re-runs, while the text is not. Pairing a
  // human score of the old response with a judge score of the new one is what made D2 read κ=0.726.
  const scoredRows = [
    { response_id: "m::a::r0", model: "m", category: "stereotype", D2_individuation: 4 },
    { response_id: "m::b::r0", model: "m", category: "stereotype", D2_individuation: 4 },
  ];
  const labels = [
    { response_id: "m::a::r0", dimension: "D2_individuation", human_score: 0, response_text: "ORIGINAL text" },
    { response_id: "m::b::r0", dimension: "D2_individuation", human_score: 4, response_text: "unchanged" },
  ];
  const textNow = new Map([["m::a::r0", "REGENERATED text"], ["m::b::r0", "unchanged"]]);
  const v = A.validateJudge(scoredRows, labels, textNow);
  eq("stale label excluded and counted", [v.D2_individuation.n, v.D2_individuation.stale], [1, 1]);
  eq("stale exclusion is disclosed in the note", /stale label/.test(v.D2_individuation.note), true);
  eq("whitespace-only difference is not treated as drift",
    A.validateJudge([scoredRows[1]], [labels[1]], new Map([["m::b::r0", "  unchanged\n"]])).D2_individuation.stale, 0);
  eq("without a text index, nothing is judged stale (back-compat)",
    A.validateJudge(scoredRows, labels).D2_individuation.stale, 0);
  eq("a label for a response absent from the index is not assumed stale",
    A.validateJudge(scoredRows, labels, new Map()).D2_individuation.stale, 0);

  /* ---- pinned labeled responses are folded into future scoring sessions ---- */
  // This is what makes a label durable: the response it was made against comes back even if the
  // corpus was re-generated or lost, so the human score always has a judge score to pair with.
  S.llmJudge = async () => ({ score: 4, reason: "stub" });
  const pinned = [{ response_id: "m::pinned::r0", model: "m", category: "stereotype",
    response_text: "The exact text that was labeled." }];

  const lost = await S.scoreResponses([], { judgeCache: {}, pinned });
  eq("a pinned response is scored even when the corpus is empty",
    lost.scored.map((r) => r.response_id), ["m::pinned::r0"]);

  const both = await S.scoreResponses(
    [{ response_id: "m::fresh::r0", model: "m", category: "stereotype", response_text: "New response." }],
    { judgeCache: {}, pinned });
  eq("pinned responses supplement the current corpus", both.scored.length, 2);

  // a row already present wins — pinning must not silently undo a deliberate regeneration
  const regen = await S.scoreResponses(
    [{ response_id: "m::pinned::r0", model: "m", category: "stereotype", response_text: "REGENERATED text." }],
    { judgeCache: {}, pinned });
  eq("a regenerated row wins over its pin (no silent override)", regen.scored.length, 1);

  const dupe = await S.scoreResponses([], { judgeCache: {}, pinned: pinned.concat(pinned) });
  eq("duplicate pins are deduped by response_id", dupe.scored.length, 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
