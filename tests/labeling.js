// Node tests for label sampling / merging / worksheet round-trip.
const D = require("path").join(__dirname, "..");
for (const f of ["js/config", "js/util", "js/labeling"]) require(`${D}/${f}.js`);
const B = globalThis.BIAS, L = B.labeling, U = B.util;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

// fixture: 10 judge-scored rows, 2 the judge left empty, across 2 models
const scored = [];
for (let i = 0; i < 10; i++)
  scored.push({ response_id: `m${i % 2}::p${i}::r0`, model: `m${i % 2}`, category: "stereotype", D2_individuation: i % 5 });
scored.push({ response_id: "m0::pair_b::r0", model: "m0", category: "stereotype", D2_individuation: "" });
scored.push({ response_id: "m1::pair_b::r0", model: "m1", category: "stereotype", D2_individuation: null });
const raw = scored.map((r) => ({ response_id: r.response_id, response_text: "text for " + r.response_id }));

// --- eligibility: judge-scored only ---
eq("eligible excludes rows the judge left empty", L.eligible(scored, "D2_individuation").length, 10);

// --- eligibility: response must have text (a human can't rate an empty string) ---
const rawWithBlanks = raw.map((r) => (r.response_id === "m0::p2::r0" ? { ...r, response_text: "" } : r));
const textOf = L.textIndex(rawWithBlanks);
eq("eligible drops empty-text rows the judge still scored", L.eligible(scored, "D2_individuation", textOf).length, 9);
eq("eligible drops whitespace-only text",
  L.eligible(scored, "D2_individuation", L.textIndex(raw.map((r) => (r.response_id === "m0::p2::r0" ? { ...r, response_text: "  \n " } : r)))).length, 9);
eq("sample never offers an empty-text row",
  L.sample(scored, [], "D2_individuation", { n: 99, seed: 1, textOf }).some((r) => r.response_id === "m0::p2::r0"), false);

// textIndex covers calibration rows, whose text is not in rawResponses
BIAS.CALIBRATION_GOLD = [{ response_id: "cal::x::r0", response_text: "gold text" }];
eq("textIndex includes calibration gold", L.textIndex([]).get("cal::x::r0"), "gold text");
eq("textIndex: rawResponses win over calibration on id collision",
  L.textIndex([{ response_id: "cal::x::r0", response_text: "raw wins" }]).get("cal::x::r0"), "raw wins");
BIAS.CALIBRATION_GOLD = [];

// --- coverage ---
const human = [{ response_id: "m0::p0::r0", dimension: "D2_individuation", human_score: 3 }];
eq("coverage counts labeled/unlabeled", L.coverage(scored, human, "D2_individuation"),
  { judged: 10, eligible: 10, labeled: 1, unlabeled: 9, missingText: 0 });
eq("coverage narrows to labelable when text is known", L.coverage(scored, human, "D2_individuation", textOf),
  { judged: 10, eligible: 9, labeled: 1, unlabeled: 8, missingText: 1 });
// an empty pool must never read as "done" when it is really "no text loaded"
eq("coverage reports rows blocked on missing text",
  L.coverage(scored, human, "D2_individuation", new Map()),
  { judged: 10, eligible: 0, labeled: 0, unlabeled: 0, missingText: 10 });
eq("coverage ignores blank human_score",
  L.coverage(scored, [{ response_id: "m0::p0::r0", dimension: "D2_individuation", human_score: "" }], "D2_individuation").labeled, 0);

// --- sampling ---
const s1 = L.sample(scored, human, "D2_individuation", { n: 5, seed: 1 });
eq("sample: honors n", s1.length, 5);
eq("sample: never returns an already-labeled row", s1.some((r) => r.response_id === "m0::p0::r0"), false);
eq("sample: never returns a judge-empty row", s1.some((r) => /pair_b/.test(r.response_id)), false);
eq("sample: deterministic for a seed", L.sample(scored, human, "D2_individuation", { n: 5, seed: 1 }).map((r) => r.response_id), s1.map((r) => r.response_id));
eq("sample: different seed reorders", L.sample(scored, human, "D2_individuation", { n: 9, seed: 7 }).map((r) => r.response_id).join() !==
  L.sample(scored, human, "D2_individuation", { n: 9, seed: 1 }).map((r) => r.response_id).join(), true);
eq("sample: n over pool size returns whole pool", L.sample(scored, human, "D2_individuation", { n: 999, seed: 1 }).length, 9);
eq("sample: n<=0 returns nothing", L.sample(scored, human, "D2_individuation", { n: 0, seed: 1 }).length, 0);

// growth stability: labeling more must not reshuffle what a re-run draws
const grown = [...scored, { response_id: "m0::new::r0", model: "m0", category: "stereotype", D2_individuation: 2 }];
const before = L.sample(scored, human, "D2_individuation", { n: 4, seed: 1 }).map((r) => r.response_id);
const after = L.sample(grown, human, "D2_individuation", { n: 20, seed: 1 }).map((r) => r.response_id);
eq("sample: prior draws keep their order when the pool grows", before, after.filter((id) => before.includes(id)));

// --- tasks are blind ---
const tasks = L.buildTasks(scored, raw, human, "D2_individuation", { n: 3, seed: 1 });
eq("buildTasks: attaches response text", tasks.every((t) => t.response_text.startsWith("text for ")), true);
eq("buildTasks: carries no judge score", tasks.some((t) => "D2_individuation" in t || "judge_score" in t), false);

// --- merge ---
const merged = L.merge(human, [{ response_id: "m0::p2::r0", dimension: "D2_individuation", human_score: 1 }]);
eq("merge: appends new", merged.length, 2);
eq("merge: re-label overwrites, no duplicate",
  L.merge(human, [{ response_id: "m0::p0::r0", dimension: "D2_individuation", human_score: 0 }]),
  [{ response_id: "m0::p0::r0", dimension: "D2_individuation", human_score: 0 }]);
eq("merge: same id, different dimension coexists",
  L.merge(human, [{ response_id: "m0::p0::r0", dimension: "D3_valence", human_score: 2 }]).length, 2);

// --- worksheet round-trip ---
const nasty = [{ response_id: "x::1::r0", dimension: "D2_individuation", category: "stereotype", model: "m0",
  response_text: 'He said "hi", then left,\nand paused.', pair_text: "" }];
const csv = L.worksheetCSV(nasty);
eq("worksheet: ships human_score blank for the labeler", U.parseCSV(csv)[0].human_score, "");
eq("worksheet: text with quotes/commas/newlines survives", U.parseCSV(csv)[0].response_text, nasty[0].response_text);

const filled = csv.replace("x::1::r0,D2_individuation,stereotype,m0,,", "x::1::r0,D2_individuation,stereotype,m0,3,");
const { labels, errors } = L.parseWorksheetCSV(filled, { labeler: "sofia" });
eq("parse: reads the filled score", [labels.length, labels[0].human_score, labels[0].labeler], [1, 3, "sofia"]);
eq("parse: no errors on a clean sheet", errors, []);
eq("parse: unlabeled rows are skipped, not zeroed", L.parseWorksheetCSV(csv).labels.length, 0);

/* ---- pinned responses: the corpus half of a label ---- */
const prompts = [{ id: "p0", text: "Write a sketch." }, { id: "p2", text: "Another prompt." }];
const rawFull = [{ response_id: "m0::p0::r0", model: "m0", model_id: "openai/x", version: "v1",
  temperature: 0.7, run: 0, timestamp: "2026-07-14T00:00:00Z", prompt_id: "p0", pair_id: null,
  category: "stereotype", attribute: { group: "Black" }, flags: {}, prompt_hash: "abc",
  response_text: "The original response." }];
const pins = L.pinRecords(rawFull, prompts, ["m0::p0::r0"]);
eq("pin: matches bias/calibration_gold.jsonl keys (+prompt_text)", Object.keys(pins[0]),
  ["response_id", "model", "model_id", "version", "temperature", "run", "timestamp", "prompt_id",
    "pair_id", "category", "attribute", "flags", "prompt_text", "response_text"]);
eq("pin: captures the exact response text", pins[0].response_text, "The original response.");
eq("pin: carries the prompt text", pins[0].prompt_text, "Write a sketch.");
eq("pin: skips a response with no text",
  L.pinRecords([{ response_id: "x::p0::r0", prompt_id: "p0", response_text: "" }], prompts, ["x::p0::r0"]).length, 0);
eq("pin: skips an unknown response_id", L.pinRecords(rawFull, prompts, ["nope::p0::r0"]).length, 0);

BIAS.CALIBRATION_GOLD = [{ response_id: "cal::g::r0", model: "cal", prompt_id: "g", response_text: "gold text" }];
eq("pin: can pin a calibration-gold response", L.pinRecords([], [], ["cal::g::r0"])[0].response_text, "gold text");
BIAS.CALIBRATION_GOLD = [];

eq("pin merge: re-pinning the same id does not duplicate",
  L.mergePins(pins, L.pinRecords(rawFull, prompts, ["m0::p0::r0"])).length, 1);
eq("pin merge: a later pin replaces the earlier record",
  L.mergePins(pins, [{ response_id: "m0::p0::r0", response_text: "newer" }])[0].response_text, "newer");

const jsonl = L.pinsJSONL(pins);
eq("pins JSONL: one object per line", jsonl.trim().split("\n").length, 1);
eq("pins JSONL: each line parses back", JSON.parse(jsonl.trim()).response_id, "m0::p0::r0");
eq("pins JSONL: empty input yields no stray newline", L.pinsJSONL([]), "");

/* ---- labels CSV matches the Python schema ---- */
const lc = L.labelsCSV([{ response_id: "m0::p0::r0", dimension: "D2_individuation", category: "stereotype",
  human_score: 3, response_text: "text", pair_text: "", labeler: "sofia", labeled_at: "2026-07-14" }]);
eq("labels CSV: bias/human_labels.csv column order, then extras", lc.split("\n")[0],
  "response_id,dimension,category,human_score,response_text,pair_text,labeler,labeled_at");
eq("labels CSV: round-trips", U.parseCSV(lc)[0].human_score, "3");
eq("labels CSV: unlabeled rows are not emitted",
  L.labelsCSV([{ response_id: "a", dimension: "D2_individuation", human_score: "" }]).split("\n").length, 1);

const bad = L.parseWorksheetCSV(csv.replace(",m0,,", ",m0,7,"));
eq("parse: out-of-scale score rejected", [bad.labels.length, bad.errors.length], [0, 1]);
eq("parse: non-integer rejected", L.parseWorksheetCSV(csv.replace(",m0,,", ",m0,2.5,")).errors.length, 1);
eq("parse: unknown dimension rejected", L.parseWorksheetCSV(csv.replace("D2_individuation", "D9_nope").replace(",m0,,", ",m0,3,")).errors.length, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
