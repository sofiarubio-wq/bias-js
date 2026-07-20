// UI controller — ties the modules to the page. Browser-only (uses DOM).
(function () {
  const BIAS = globalThis.BIAS;
  const { util: U, storage: St, config: _c } = BIAS;
  const C = () => BIAS.CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const state = { prompts: [], rawResponses: [], scored: [], judgeCache: {}, humanLabels: [],
    labeledResponses: [], runHistory: [] };
  BIAS.getApiKey = () => { try { return sessionStorage.getItem("bias_or_key") || ""; } catch (e) { return BIAS._key || ""; } };
  const setApiKey = (k) => { try { sessionStorage.setItem("bias_or_key", k); } catch (e) { BIAS._key = k; } };

  /* ---- tabs ---- */
  $$(".tab").forEach((t) => (t.onclick = () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === t.dataset.tab));
    if (t.dataset.tab === "results") renderResults();
    if (t.dataset.tab === "outputs") renderOutputs();
    if (t.dataset.tab === "label") renderLabel();
    if (t.dataset.tab === "guide") renderGuide();
  }));
  function refreshKey() {
    const set = !!BIAS.getApiKey();
    const el = $("#keyStatus");
    el.textContent = set ? "key: set" : "key: not set";
    el.className = "pill " + (set ? "pill-ok" : "pill-warn");
  }

  /* ---- battery ---- */
  const CATS = () => Object.keys(C().CATEGORY_DIMENSIONS);
  function promptRow(p = {}) {
    const tr = document.createElement("tr");
    const cats = CATS().map((c) => `<option ${c === p.category ? "selected" : ""}>${esc(c)}</option>`).join("");
    tr.innerHTML = `<td class="id"><input value="${esc(p.id || "")}" placeholder="unique_id"></td>
      <td><select>${cats}</select></td>
      <td><input value="${esc(p.pair_id || "")}" placeholder="pair_id"></td>
      <td><input value="${esc(JSON.stringify(p.attribute || {}))}" placeholder="{}"></td>
      <td><textarea placeholder="prompt text…">${esc(p.text || "")}</textarea></td>
      <td><button class="del">✕</button></td>`;
    tr.querySelector(".del").onclick = () => { tr.remove(); updateCount(); };
    tr._extra = {};
    for (const k of Object.keys(p)) if (!["id", "category", "pair_id", "attribute", "text"].includes(k)) tr._extra[k] = p[k];
    return tr;
  }
  const updateCount = () => ($("#promptCount").textContent = `· ${$$("#promptTable tbody tr").length} prompts`);
  function renderBattery() {
    const tb = $("#promptTable tbody"); tb.innerHTML = "";
    state.prompts.forEach((p) => tb.appendChild(promptRow(p)));
    updateCount();
  }
  function collectPrompts() {
    const out = [];
    for (const tr of $$("#promptTable tbody tr")) {
      const [idI, pairI, attrI] = tr.querySelectorAll("input");
      const sel = tr.querySelector("select"), txt = tr.querySelector("textarea");
      let attribute = {};
      try { attribute = JSON.parse(attrI.value.trim() || "{}"); } catch { throw new Error(`Bad attribute JSON for "${idI.value}"`); }
      out.push({ id: idI.value.trim(), category: sel.value, pair_id: pairI.value.trim(), attribute, text: txt.value, ...tr._extra });
    }
    return out;
  }
  $("#addPrompt").onclick = () => {
    const tb = $("#promptTable tbody"), row = promptRow({ category: CATS()[0] });
    tb.insertBefore(row, tb.firstChild); $("#filterBattery").value = "";
    row.querySelector("input").focus(); row.scrollIntoView({ block: "center" }); updateCount();
  };
  $("#filterBattery").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const tr of $$("#promptTable tbody tr"))
      tr.style.display = [...tr.querySelectorAll("input,textarea,select")].map((x) => x.value).join(" ").toLowerCase().includes(q) ? "" : "none";
  };
  $("#savePrompts").onclick = async () => {
    const m = $("#batteryMsg");
    try {
      state.prompts = collectPrompts();
      const seen = new Set();
      for (const p of state.prompts) { if (!p.id || !p.text) throw new Error("every prompt needs an id and text"); if (seen.has(p.id)) throw new Error("duplicate id " + p.id); seen.add(p.id); }
      await St.set("prompts", state.prompts);
      m.className = "msg ok"; m.textContent = `Saved ${state.prompts.length} prompts.`;
    } catch (e) { m.className = "msg err"; m.textContent = e.message; }
  };
  $("#resetPrompts").onclick = async () => { state.prompts = JSON.parse(JSON.stringify(BIAS.DEFAULT_PROMPTS)); await St.set("prompts", state.prompts); renderBattery(); $("#batteryMsg").className = "msg ok"; $("#batteryMsg").textContent = "Reset to the default battery."; };

  /* ---- settings ---- */
  function modelRow(m = {}) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input value="${esc(m.label || "")}"></td><td><input class="wide" value="${esc(m.model_id || "")}" placeholder="provider/model"></td><td><input value="${esc(m.version || "")}"></td><td><button class="del">✕</button></td>`;
    tr.querySelector(".del").onclick = () => tr.remove();
    return tr;
  }
  function renderSettings() {
    const s = C();
    const tb = $("#modelsTable tbody"); tb.innerHTML = "";
    s.MODELS_UNDER_TEST.forEach((m) => tb.appendChild(modelRow(m)));
    $("#judgeLabel").value = s.JUDGE_MODEL.label; $("#judgeId").value = s.JUDGE_MODEL.model_id; $("#judgeVersion").value = s.JUDGE_MODEL.version;
    $("#runsPerPrompt").value = s.RUNS_PER_PROMPT; $("#temperature").value = s.TEMPERATURE;
    $("#maxTokens").value = s.MAX_TOKENS; $("#maxConcurrency").value = s.MAX_CONCURRENCY;
  }
  $("#addModel").onclick = () => $("#modelsTable tbody").appendChild(modelRow());
  $("#saveSettings").onclick = async () => {
    const m = $("#settingsMsg");
    const models = $$("#modelsTable tbody tr").map((tr) => { const [l, id, v] = tr.querySelectorAll("input"); return { label: l.value.trim(), model_id: id.value.trim(), version: v.value.trim() }; }).filter((x) => x.label && x.model_id);
    Object.assign(C(), {
      MODELS_UNDER_TEST: models,
      JUDGE_MODEL: { label: $("#judgeLabel").value.trim(), model_id: $("#judgeId").value.trim(), version: $("#judgeVersion").value.trim() },
      RUNS_PER_PROMPT: +$("#runsPerPrompt").value || 1, TEMPERATURE: +$("#temperature").value,
      MAX_TOKENS: +$("#maxTokens").value || 600, MAX_CONCURRENCY: +$("#maxConcurrency").value || 8,
    });
    const settings = (({ MODELS_UNDER_TEST, JUDGE_MODEL, RUNS_PER_PROMPT, TEMPERATURE, MAX_TOKENS, MAX_CONCURRENCY }) =>
      ({ MODELS_UNDER_TEST, JUDGE_MODEL, RUNS_PER_PROMPT, TEMPERATURE, MAX_TOKENS, MAX_CONCURRENCY }))(C());
    await St.set("settings", settings);
    m.className = "msg ok"; m.textContent = "Settings saved.";
  };
  $("#setKey").onclick = () => { setApiKey($("#apiKey").value.trim()); $("#apiKey").value = ""; $("#keyMsg").textContent = "key set"; refreshKey(); };

  /* ---- run ---- */
  let STATUS_TIMER = null, runStart = 0;
  const nfmt = (n) => (n || 0).toLocaleString();
  const credits = (c) => (c == null ? "—" : c === 0 ? "0" : "$" + Number(c).toFixed(4));
  const log = (s) => { const l = $("#log"); l.textContent += s + "\n"; l.scrollTop = l.scrollHeight; };
  $("#clearLog").onclick = () => ($("#log").textContent = "");
  function liveStats() {
    const m = BIAS.models.METER.snapshot();
    const el = (performance.now() - runStart) / 1000;
    $("#runStats").innerHTML = `<span class="chip-live">● live</span> ⏱ ${el.toFixed(1)}s · ${nfmt(m.total_tokens)} tokens · ${m.calls} calls · credits ${credits(m.cost)}`;
  }
  function renderHistory() {
    const h = state.runHistory;
    $("#runHistory").innerHTML = h.length ? `<div class="table-wrap"><table><thead><tr><th>started</th><th>stages</th><th>time</th><th>tokens</th><th>calls</th><th>credits</th></tr></thead><tbody>${h.map((r) => `<tr><td>${esc(r.started)}${r.failed ? ` <span class="pill pill-bad">failed</span>` : ""}</td><td>${esc((r.stages || []).join(", "))}</td><td>${r.seconds}s</td><td>${nfmt(r.total_tokens)}</td><td>${r.calls}</td><td>${credits(r.cost)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No runs yet.</p>`;
  }
  // History outlives the tab, so it is written on every run rather than only at export.
  async function addHistory(entry) {
    state.runHistory.unshift(entry);
    state.runHistory = state.runHistory.slice(0, 25);
    await St.set("runHistory", state.runHistory);
    renderHistory();
  }
  $("#clearHistory").onclick = async () => {
    state.runHistory = []; await St.set("runHistory", state.runHistory); renderHistory();
  };
  $("#runBtn").onclick = async () => {
    const stages = ["generate", "score", "analyze"].filter((s) => $("#st" + s[0].toUpperCase() + s.slice(1)).checked);
    if (!stages.length) { $("#runStatus").textContent = "select a stage"; return; }
    $("#runBtn").disabled = true; $("#runStatus").textContent = "running…";
    BIAS.models.METER.reset(); runStart = performance.now();
    STATUS_TIMER = setInterval(liveStats, 500);
    try {
      if (stages.includes("generate")) {
        log("### GENERATE ###");
        const cache = Object.fromEntries((state.rawResponses || []).map((r) => [r.response_id, r]));
        const { rows, summary } = await BIAS.runner.generate(state.prompts, { cache, fresh: $("#optFresh").checked,
          onProgress: (p) => { if (p.phase === "plan") log(`${p.total} total · ${p.cached} cached · ${p.todo} to generate`); else if (p.phase === "gen" && p.done % 20 === 0) log(`  ...${p.done}/${p.total} generated`); } });
        state.rawResponses = rows; await St.set("rawResponses", rows);
        for (const [mdl, s] of Object.entries(summary)) log(`  ${mdl}: ok=${s.ok} err=${s.err} tokens=${nfmt(s.tokens)}`);
      }
      if (stages.includes("score")) {
        log("### SCORE ###");
        if (state.labeledResponses.length) log(`  folding in ${state.labeledResponses.length} pinned labeled response(s)`);
        const { scored, judgeCache } = await BIAS.scorers.scoreResponses(state.rawResponses, { judgeCache: state.judgeCache,
          pinned: state.labeledResponses,
          onProgress: (p) => { if (p.done % 20 === 0) log(`  ...judged ${p.done}/${p.total}`); } });
        state.scored = scored; state.judgeCache = judgeCache;
        await St.set("scored", scored); await St.set("judgeCache", judgeCache);
        log(`  scored ${scored.length} rows`);
      }
      if (stages.includes("analyze")) { log("### ANALYZE ###"); renderResults(); renderOutputs(); log("  results updated"); }
      const m = BIAS.models.METER.snapshot(), sec = +((performance.now() - runStart) / 1000).toFixed(1);
      log(`### run: ${sec}s · ${nfmt(m.total_tokens)} tokens · ${m.calls} calls · credits ${credits(m.cost)} ###`);
      await addHistory({ started: new Date().toLocaleString(), stages, seconds: sec, ...m });
      $("#runStatus").textContent = "done";
    } catch (e) {
      log("### ERROR: " + (e.message || e) + " ###"); $("#runStatus").textContent = "error";
      // a failed run is the one you most want a record of — keep it, marked
      const m = BIAS.models.METER.snapshot();
      await addHistory({ started: new Date().toLocaleString(), stages, failed: true,
        seconds: +((performance.now() - runStart) / 1000).toFixed(1), ...m });
    }
    finally { clearInterval(STATUS_TIMER); STATUS_TIMER = null; liveStats(); $("#runBtn").disabled = false; }
  };

  /* ---- outputs ---- */
  function renderOutputs() {
    const promptMap = Object.fromEntries(state.prompts.map((p) => [p.id, p]));
    const rows = (state.rawResponses || []).map((r) => ({ ...r, prompt_text: (promptMap[r.prompt_id] || {}).text || "" }));
    const models = [...new Set(rows.map((r) => r.model))].sort();
    const cats = [...new Set(rows.map((r) => r.category))].filter(Boolean).sort();
    $("#outModel").innerHTML = `<option value="">all models</option>` + models.map((m) => `<option>${esc(m)}</option>`).join("");
    $("#outCat").innerHTML = `<option value="">all categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    window.__OUT = rows; filterOutputs();
  }
  function filterOutputs() {
    const rows = window.__OUT || [];
    const model = $("#outModel").value, cat = $("#outCat").value, q = $("#outSearch").value.trim().toLowerCase();
    const f = rows.filter((r) => (!model || r.model === model) && (!cat || r.category === cat) &&
      (!q || [r.prompt_id, r.prompt_text, r.response_text, r.error, JSON.stringify(r.attribute)].join(" ").toLowerCase().includes(q)));
    $("#outCount").textContent = `· ${f.length} of ${rows.length}`;
    const LIMIT = 200;
    $("#outList").innerHTML = f.length ? f.slice(0, LIMIT).map((r) => {
      const attr = r.attribute && Object.keys(r.attribute).length ? JSON.stringify(r.attribute) : "";
      const body = r.error ? `<pre class="respout err">ERROR: ${esc(r.error)}</pre>` : `<pre class="respout">${esc(r.response_text || "(empty)")}</pre>`;
      return `<div class="respcard"><div class="resphead"><span class="pill pill-ok">${esc(r.model)}</span><code>${esc(r.prompt_id)}</code><span class="muted">${esc(r.category || "")}${attr ? " · " + esc(attr) : ""}${r.run != null ? " · run " + r.run : ""}</span></div>${r.prompt_text ? `<div class="respprompt"><span class="lbl">prompt</span>${esc(r.prompt_text)}</div>` : ""}${body}</div>`;
    }).join("") + (f.length > LIMIT ? `<p class="muted">showing first ${LIMIT} of ${f.length}</p>` : "") : `<p class="muted">${rows.length ? "No responses match." : "No responses yet — run Generate."}</p>`;
  }
  ["#outModel", "#outCat"].forEach((s) => ($(s).onchange = filterOutputs));
  $("#outSearch").oninput = filterOutputs;

  /* ---- label ---- */
  const LB = () => BIAS.labeling;
  let session = null;   // { dim, tasks, i, added[] } while labeling

  const lblDim = () => $("#lblDim").value;
  function renderLabel() {
    const sel = $("#lblDim");
    if (!sel.options.length) {
      sel.innerHTML = LB().validatedDims().map((d) => `<option ${d === "D2_individuation" ? "selected" : ""}>${esc(d)}</option>`).join("");
    }
    const scored = state.scored || [];
    const textOf = LB().textIndex(state.rawResponses);
    const cov = LB().validatedDims().map((d) => [d, LB().coverage(scored, state.humanLabels, d, textOf)]);
    const blocked = cov.reduce((s, [, c]) => s + c.missingText, 0);
    $("#lblStats").innerHTML = `<div class="table-wrap"><table><thead><tr><th>dimension</th><th>judge-scored</th><th>labelable</th><th>labeled</th><th>unlabeled</th><th>no text</th></tr></thead><tbody>${
      cov.map(([d, c]) => `<tr><td><code>${esc(d)}</code></td><td>${c.judged}</td><td>${c.eligible}</td><td>${c.labeled}</td><td>${c.unlabeled}</td><td>${c.missingText ? `<span class="pill pill-warn">${c.missingText}</span>` : "0"}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">Labelable = the judge scored the dimension <em>and</em> the response has text — both raters
        must be able to rate it for the pair to count toward κ.</p>` +
      (blocked ? `<div class="msg err">${blocked} judge-scored row(s) have no response text, so they cannot be labeled.
        Either the responses came back empty, or this data was loaded without <code>rawResponses</code> (the shipped
        sample is scores-only — run Generate, or import a full export).</div>` : "");
    const c = LB().coverage(scored, state.humanLabels, lblDim(), textOf);
    $("#lblCoverage").textContent = `· ${lblDim()}: ${c.labeled} labeled of ${c.eligible} labelable` +
      (c.missingText ? ` · ${c.missingText} unlabelable (no text)` : "");
    const nl = state.humanLabels.filter((h) => h.human_score !== null && h.human_score !== "").length;
    $("#lblFileCount").textContent = nl
      ? `· ${state.labeledResponses.length} response(s) pinned · ${nl} label(s)` : "";
  }
  $("#lblDim").onchange = renderLabel;

  function labelTasks() {
    const target = +$("#lblTarget").value || 100;
    const textOf = LB().textIndex(state.rawResponses);
    const c = LB().coverage(state.scored || [], state.humanLabels, lblDim(), textOf);
    const need = Math.max(0, target - c.labeled);
    return LB().buildTasks(state.scored || [], state.rawResponses || [], state.humanLabels, lblDim(),
      { n: need, seed: +$("#lblSeed").value || 0, textOf });
  }

  // Empty pool means either "done" or "no response text loaded" — these look identical from the
  // task list but mean opposite things, so separate them before reporting.
  function emptyPoolReason() {
    const c = LB().coverage(state.scored || [], state.humanLabels, lblDim(), LB().textIndex(state.rawResponses));
    if (c.missingText)
      return { className: "msg err", text: `Nothing labelable left for ${lblDim()}: ${c.labeled} of ${c.eligible} labelable rows are done, but ${c.missingText} judge-scored row(s) have no response text and cannot be labeled. Run Generate, or import an export that includes rawResponses.` };
    return { className: "msg ok", text: `${lblDim()} is already at target — nothing left to label.` };
  }

  $("#lblStart").onclick = () => {
    const tasks = labelTasks();
    const m = $("#lblMsg");
    if (!tasks.length) { const r = emptyPoolReason(); m.className = r.className; m.textContent = r.text; return; }
    m.textContent = ""; m.className = "msg";
    session = { dim: lblDim(), tasks, i: 0, added: [] };
    $("#lblIntro").classList.add("hidden"); $("#lblSession").classList.remove("hidden");
    $("#lblDimName").textContent = session.dim;
    $("#lblRubric").textContent = BIAS.scorers.JUDGE_RUBRIC[session.dim] || "(no rubric)";
    $("#lblButtons").innerHTML = [0, 1, 2, 3, 4].map((v) => `<button class="btn lblbtn" data-v="${v}">${v}</button>`).join("") +
      `<button class="btn btn-sm" data-v="skip">skip</button><button class="btn btn-sm" data-v="undo">undo</button>`;
    $$("#lblButtons button").forEach((b) => (b.onclick = () => score(b.dataset.v)));
    showTask();
  };
  function showTask() {
    if (!session) return;
    if (session.i >= session.tasks.length) return finishSession(`Session complete — saved ${session.added.length} label${session.added.length === 1 ? "" : "s"}.`);
    const t = session.tasks[session.i];
    $("#lblProgress").textContent = `${session.i + 1} / ${session.tasks.length} · ${session.added.length} labeled`;
    $("#lblModel").textContent = t.model; $("#lblId").textContent = t.response_id; $("#lblCat").textContent = t.category;
    $("#lblText").textContent = t.response_text || "(empty)";
    $("#lblSession").scrollIntoView({ block: "nearest" });
  }
  function score(v) {
    if (!session) return;
    if (v === "undo") {
      if (!session.added.length) return;
      const last = session.added.pop();
      session.i = session.tasks.findIndex((t) => t.response_id === last.response_id);
      return showTask();
    }
    if (v === "skip") { session.i++; return showTask(); }
    const t = session.tasks[session.i];
    session.added = session.added.filter((h) => h.response_id !== t.response_id);
    session.added.push({ response_id: t.response_id, dimension: t.dimension, category: t.category,
      human_score: +v, response_text: t.response_text, pair_text: t.pair_text,
      labeler: $("#lblWho").value.trim(), labeled_at: new Date().toISOString() });
    session.i++; showTask();
  }
  document.addEventListener("keydown", (e) => {
    if (!session || $("#label").classList.contains("active") === false) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (/^[0-4]$/.test(e.key)) { e.preventDefault(); score(e.key); }
    else if (e.key === "s") { e.preventDefault(); score("skip"); }
    else if (e.key === "u") { e.preventDefault(); score("undo"); }
  });
  // Every label pins the response it was made against, so the pair survives a re-generation.
  async function saveLabels(added) {
    if (!added.length) return;
    state.humanLabels = LB().merge(state.humanLabels, added);
    state.labeledResponses = LB().mergePins(state.labeledResponses,
      LB().pinRecords(state.rawResponses, state.prompts, added.map((h) => h.response_id)));
    await St.set("humanLabels", state.humanLabels);
    await St.set("labeledResponses", state.labeledResponses);
  }

  async function finishSession(note) {
    if (!session) return;
    await saveLabels(session.added);
    const n = session.added.length;
    session = null;
    $("#lblSession").classList.add("hidden"); $("#lblIntro").classList.remove("hidden");
    const m = $("#lblMsg"); m.className = "msg ok";
    m.textContent = `${note || `Saved ${n} label${n === 1 ? "" : "s"}.`}` +
      (n ? " Export to keep them beyond this browser." : "");
    renderLabel(); renderResults();
  }
  $("#lblQuit").onclick = () => finishSession();

  $("#lblDlPins").onclick = () => {
    const pins = state.labeledResponses;
    const m = $("#lblMsg");
    if (!pins.length) { m.className = "msg"; m.textContent = "No labels yet — nothing to pin."; return; }
    m.textContent = ""; U.download("labeled_responses.jsonl", LB().pinsJSONL(pins), "application/x-ndjson");
  };
  $("#lblDlLabels").onclick = () => {
    const m = $("#lblMsg");
    if (!state.humanLabels.length) { m.className = "msg"; m.textContent = "No labels yet."; return; }
    m.textContent = ""; U.download("human_labels.csv", LB().labelsCSV(state.humanLabels), "text/csv");
  };

  $("#lblWorksheet").onclick = () => {
    const tasks = labelTasks();
    const m = $("#lblMsg");
    if (!tasks.length) { const r = emptyPoolReason(); m.className = r.className; m.textContent = r.text; return; }
    m.textContent = ""; m.className = "msg";
    U.download(`worksheet_${lblDim()}.csv`, LB().worksheetCSV(tasks), "text/csv");
  };
  $("#lblImport").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const m = $("#lblMsg");
    try {
      const { labels, errors } = LB().parseWorksheetCSV(await file.text(),
        { labeler: $("#lblWho").value.trim(), labeled_at: new Date().toISOString() });
      if (errors.length && !labels.length) throw new Error(errors.join("; "));
      await saveLabels(labels);
      m.className = errors.length ? "msg err" : "msg ok";
      m.textContent = `Imported ${labels.length} labels.` + (errors.length ? ` ${errors.length} row(s) rejected: ${errors.slice(0, 3).join("; ")}` : "");
      renderLabel(); renderResults();
    } catch (err) { m.className = "msg err"; m.textContent = "Import failed: " + err.message; }
    finally { e.target.value = ""; }
  };

  /* ---- results ---- */
  function bars(items, max, fmt) {
    return `<div class="barchart">${items.map(([n, v]) => `<div class="barrow"><div class="name" title="${esc(n)}">${esc(n)}</div><div class="bartrack"><div class="barfill" style="width:${max > 0 && v != null ? Math.round(100 * v / max) : 0}%"></div></div><div class="barval">${v == null ? "—" : fmt(v)}</div></div>`).join("")}</div>`;
  }
  // objects (e.g. a row's `attribute`) are JSON-rendered rather than "[object Object]"
  const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  function table(cols, rows) {
    return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const gradeClass = (g) => { const c = (g || "")[0]; return c === "A" ? "g-a" : c === "B" ? "g-b" : c === "C" ? "g-c" : c === "D" ? "g-d" : "g-f"; };
  function renderResults() {
    const scored = state.scored || [];
    if (!scored.length) { $("#grades").innerHTML = `<p class="muted">No scored data — run Score.</p>`; return; }
    const val = ($("#optHuman").checked && state.humanLabels.length)
      ? BIAS.analysis.validateJudge(scored, state.humanLabels, LB().textIndex(state.rawResponses)) : null;
    const grades = BIAS.grades.gradeModels(scored, val);
    $("#grades").innerHTML = grades.length ? `<div class="grade-grid">${grades.map((g) => `<div class="gradecard"><div class="gradebadge ${gradeClass(g.grade)}">${esc(g.grade)}</div><div class="gradebody"><div class="gname">${esc(g.model)}</div><div class="gscore">${g.score == null ? "—" : g.score + " / 100"}</div>${g.notes.length ? `<div class="muted" title="${esc(g.notes.join("\n"))}">${g.notes.length} caveat${g.notes.length > 1 ? "s" : ""}</div>` : ""}</div></div>`).join("")}</div>` : "";
    $("#validation").innerHTML = val ? `<div class="kappa-grid">${Object.entries(val).map(([d, r]) => `<div class="kappa"><div class="dim">${esc(d)}</div><div class="k">${r.kappa == null ? "—" : r.kappa}</div><span class="pill ${r.trusted ? "pill-ok" : "pill-bad"}">${r.trusted ? "TRUSTED" : "NOT TRUSTED"}</span><div class="muted">n=${r.n}${r.note ? " · " + esc(r.note) : ""}</div></div>`).join("")}</div>` : `<p class="muted">Judge not validated (no human labels selected).</p>`;
    $("#disparity").innerHTML = BIAS.analysis.disparityRatio(scored).map((m) => { const ai = m.adverse_impact; const badge = ai == null ? "" : `<span class="pill ${ai ? "pill-bad" : "pill-ok"}">${ai ? "adverse impact" : "within 0.8"}</span>`; return `<div class="modelblock"><h4>${esc(m.model)} — disparity ratio ${m.disparity_ratio ?? "—"} ${badge}</h4>${bars(Object.entries(m.positive_rates), 1, (v) => v.toFixed(2))}</div>`; }).join("") || `<p class="muted">No outcome data.</p>`;
    renderScored(scored);
    window.__gradeMd = BIAS.grades.buildGradeReport(scored, val);
    window.__reportMd = BIAS.grades.buildReport(scored, val);
  }
  /* ---- scored data (ported from bias/dashboard.py) ---- */
  // Stackable per-column filters, AND-combined, shown as removable chips.
  const SCORED_LIMIT = 1000;         // matches dashboard.py's max_rows
  let scFilters = [], scCols = [];

  // Rows are built per-category, so each carries only its own dimensions and the key union is
  // ragged. Order by config so the columns stay stable run to run, then append anything unexpected.
  function scoredColumns(rows) {
    const seen = new Set();
    for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
    const pref = ["response_id", "model", "version", "run", "prompt_id", "pair_id", "category",
      "attribute", ...Object.keys(C().DIMENSIONS), "outcome"];
    const cols = pref.filter((c) => seen.has(c));
    for (const k of seen) if (!cols.includes(k)) cols.push(k);
    return cols;
  }

  function renderScored(scored) {
    scCols = scoredColumns(scored);
    const shown = scored.slice(0, SCORED_LIMIT);
    $("#scored").innerHTML = shown.length
      ? table(scCols, shown) + (scored.length > shown.length
        ? `<p class="muted">showing first ${shown.length} of ${scored.length}</p>` : "")
      : `<p class="muted">No scored data — run Score.</p>`;
    $("#scCol").innerHTML = `<option value="*">any column</option>` +
      scCols.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    applyScFilters();
  }

  function applyScFilters() {
    const rows = $$("#scored table tbody tr");
    let shown = 0;
    rows.forEach((tr) => {
      const ok = scFilters.every((f) => {
        const v = f.val.toLowerCase();
        if (f.col === "*") return tr.textContent.toLowerCase().includes(v);
        const i = scCols.indexOf(f.col);
        if (i < 0) return true;
        const c = tr.children[i];
        return c && c.textContent.toLowerCase().includes(v);
      });
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    let n = $("#scored .nomatch");
    if (rows.length && shown === 0) {
      if (!n) { n = document.createElement("div"); n.className = "nomatch"; $("#scored").appendChild(n); }
      n.textContent = "no rows match the filters";
    } else if (n) n.remove();
    $("#scFilters").innerHTML = scFilters.map((f, i) =>
      `<span class="fchip">${f.col === "*" ? "any" : esc(f.col)} ⊇ "${esc(f.val)}"<button class="fx" data-i="${i}" title="remove">✕</button></span>`).join("");
    $$("#scFilters .fx").forEach((b) => (b.onclick = () => { scFilters.splice(+b.dataset.i, 1); applyScFilters(); }));
    $("#scCount").textContent = !rows.length ? ""
      : scFilters.length ? `· ${shown} of ${rows.length} shown` : `· ${rows.length} rows`;
  }

  function addScFilter() {
    const val = $("#scVal").value.trim();
    if (!val) return;
    scFilters.push({ col: $("#scCol").value, val });
    $("#scVal").value = ""; $("#scVal").focus();
    applyScFilters();
  }
  $("#scAdd").onclick = addScFilter;
  $("#scVal").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addScFilter(); } });
  $("#scClear").onclick = () => { scFilters = []; applyScFilters(); };

  $("#refreshResults").onclick = renderResults;
  $("#tgGrades").onclick = () => { const p = $("#gradesReport"), b = $("#tgGrades"); if (!p.classList.contains("hidden")) { p.classList.add("hidden"); b.textContent = "show"; return; } p.textContent = window.__gradeMd || "(run Analyze)"; p.classList.remove("hidden"); b.textContent = "hide"; };

  /* ---- guide ---- */
  // The prose is static, but every table here is derived from CONFIG so the guide cannot drift out
  // of sync with the thresholds and dimensions the code actually uses.
  function renderGuide() {
    const s = C(), G = BIAS.grades;
    $("#guideDims").innerHTML = table(["dimension", "what it measures", "scorer", "trust-gated"],
      Object.entries(s.DIMENSIONS).map(([d, cfg]) => ({
        dimension: d, "what it measures": G.COMPONENT_EXPLAIN[d] || "",
        scorer: cfg.scorer === "judge" ? "LLM judge" : "deterministic rule",
        "trust-gated": cfg.validated ? `yes — needs κ ≥ ${s.JUDGE_KAPPA_THRESHOLD}` : "no — always counted",
      })));
    $("#guideCats").innerHTML = table(["category", "dimensions scored"],
      Object.entries(s.CATEGORY_DIMENSIONS).map(([c, dims]) => ({
        category: c, "dimensions scored": dims.length ? dims.join(", ") : "— (generated, not scored)",
      })));
    $("#guideBands").innerHTML = `<p class="muted">Letter bands: ` +
      G.LETTER_BANDS.filter(([, l]) => l !== "F").map(([lo, l]) => `<strong>${esc(l)}</strong> ≥ ${lo}`).join(" · ") +
      `, else <strong>F</strong>.</p>`;
    $("#guideKappa").textContent = `A dimension needs κ ≥ ${s.JUDGE_KAPPA_THRESHOLD} to count toward a grade; ` +
      `below that its scores are excluded. Validation needs at least 10 overlapping labels before it will report a κ at all.`;
    $("#guideDisp").textContent = `Below ${s.DISPARITY_ADVERSE_IMPACT} is flagged as adverse impact.`;
  }

  /* ---- data export/import + downloads ---- */
  $("#exportBtn").onclick = async () => { await St.set("prompts", state.prompts); await St.set("rawResponses", state.rawResponses); await St.set("scored", state.scored); await St.set("judgeCache", state.judgeCache); await St.set("humanLabels", state.humanLabels); await St.set("labeledResponses", state.labeledResponses); await St.set("runHistory", state.runHistory); await St.downloadExport(); };
  $("#importFile").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const obj = JSON.parse(await file.text()); await St.importAll(obj); await loadState(); renderBattery(); renderSettings(); renderHistory(); renderResults(); $("#dataMsg").className = "msg ok"; $("#dataMsg").textContent = "Imported."; }
    catch (err) { $("#dataMsg").className = "msg err"; $("#dataMsg").textContent = "Import failed: " + err.message; }
  };
  $("#dlReport").onclick = () => { renderResults(); U.download("report.md", window.__reportMd || "", "text/markdown"); };
  $("#dlGrades").onclick = () => { renderResults(); U.download("grades_report.md", window.__gradeMd || "", "text/markdown"); };
  $("#dlScored").onclick = () => U.download("scored.csv", U.toCSV(state.scored || []), "text/csv");

  /* ---- init ---- */
  async function loadState() {
    state.prompts = await St.get("prompts", null) || JSON.parse(JSON.stringify(BIAS.DEFAULT_PROMPTS));
    state.rawResponses = await St.get("rawResponses", null) || [];
    state.scored = await St.get("scored", null) || BIAS.SAMPLE_SCORED || [];
    state.judgeCache = await St.get("judgeCache", null) || {};
    state.humanLabels = await St.get("humanLabels", null) || BIAS.HUMAN_LABELS || [];
    state.labeledResponses = await St.get("labeledResponses", null) || [];
    state.runHistory = await St.get("runHistory", null) || [];
    const settings = await St.get("settings", null);
    if (settings) Object.assign(C(), settings);
  }
  (async function init() {
    const mode = await St.init();
    $("#storageNote").textContent = mode === "memory" ? "storage: in-memory only — use Export to save" : "storage: " + mode;
    await loadState();
    refreshKey(); renderBattery(); renderSettings(); renderHistory(); renderResults();
  })();
})();
