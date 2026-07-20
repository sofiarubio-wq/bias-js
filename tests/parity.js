// Parity: JS analysis + grades must reproduce the Python outputs on the same data.
const D = require("path").join(__dirname, "..");
for (const f of ["js/config", "js/util", "js/analysis", "js/grades", "data/sampleScored", "data/humanLabels"])
  require(`${D}/${f}.js`);
const B = globalThis.BIAS;

let fail = 0;
function check(name, ok, extra = "") { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : " " + extra}`); if (!ok) fail++; }

// --- string-shaped data (from scored.csv) vs known Python results ---
const val = B.analysis.validateJudge(B.SAMPLE_SCORED, B.HUMAN_LABELS);
console.log("Judge validation:");
for (const [d, r] of Object.entries(val)) console.log(`    ${d}: κ=${r.kappa} n=${r.n} ${r.trusted ? "TRUSTED" : "NOT"}`);
check("D1 κ = 0.916 TRUSTED", val.D1_equal_treatment.kappa === 0.916 && val.D1_equal_treatment.trusted);
check("all four judge dims TRUSTED", ["D1_equal_treatment", "D2_individuation", "D3_valence", "D5_refusal"].every((d) => val[d] && val[d].trusted));

const grades = B.grades.gradeModels(B.SAMPLE_SCORED, val);
console.log("Grades:");
grades.forEach((g) => console.log(`    ${g.model.padEnd(8)} ${g.grade.padEnd(3)} ${g.score}`));
const expect = { gemini: ["D+", 69.3], claude: ["B", 84.3], llama: ["C", 75], gpt: ["D", 65] };
for (const [m, [lg, sc]] of Object.entries(expect)) {
  const g = grades.find((x) => x.model === m);
  check(`${m}: ${lg} ~${sc}`, g.grade === lg && Math.abs(g.score - sc) < 0.11, `(got ${g.grade} ${g.score})`);
}

// --- object-shaped data (the live scoring path) sanity ---
const objRows = [
  { model: "m", attribute: { gender: "male" }, category: "demographic_parity", outcome: "positive", D6_disclosure: 4 },
  { model: "m", attribute: { gender: "female" }, category: "demographic_parity", outcome: "negative", D6_disclosure: 4 },
];
Object.assign(B.CONFIG, { MODELS_UNDER_TEST: [{ label: "m", model_id: "x", version: "v" }] });
const og = B.grades.gradeModels(objRows, null);
check("object-shaped: model graded", og.length === 1 && og[0].model === "m");
check("object-shaped: disparity 0 (flip) counted", og[0].disparity_ratio === 0);
check("object-shaped: groupLabel from object attr", B.util.groupLabel({ gender: "male" }) === "male");

console.log(`\n${fail === 0 ? "PARITY: ALL PASS" : "PARITY: " + fail + " FAILED"}`);
process.exit(fail ? 1 : 0);
