// Generation — mirrors bias/runner.py: concurrency pool + resume via prompt_hash.
(function () {
  const BIAS = (globalThis.BIAS = globalThis.BIAS || {});
  const U = BIAS.util, C = () => BIAS.CONFIG;
  const R = (BIAS.runner = {});

  const promptHash = (t) => U.hash(t || "");

  function makeRow(model, p, run, out, err) {
    const rid = `${model.label}::${p.id}::r${run}`;
    // A 200 that carried no content is a failed generation, recorded like any other error so the
    // Run summary counts it, resume retries it, and the scorer skips it instead of judging "".
    const failure = err ? String(err.message || err) : (out && out.empty) || null;
    if (failure) return { response_id: rid, model: model.label, prompt_id: p.id, category: p.category,
      prompt_hash: promptHash(p.text), error: failure, empty: !err && !!(out && out.empty),
      usage: out ? out.usage : undefined, response_text: null };
    const flags = {};
    for (const k of ["outcome_prompt", "counterfactual", "should_refuse", "copyright_source_ref"])
      if (k in p) flags[k] = p[k];
    return { response_id: rid, model: model.label, model_id: model.model_id, version: model.version,
      temperature: C().TEMPERATURE, run, timestamp: new Date().toISOString(), prompt_id: p.id,
      pair_id: p.pair_id, category: p.category, attribute: p.attribute || {}, flags,
      prompt_hash: promptHash(p.text), usage: out.usage, response_text: out.text };
  }

  // prompts: array; opts.cache: { response_id: row } from a prior run; opts.fresh; opts.onProgress.
  // Returns { rows, summary }.
  R.generate = async function (prompts, opts = {}) {
    const models = C().MODELS_UNDER_TEST;
    const cache = opts.fresh ? {} : (opts.cache || {});
    const onProgress = opts.onProgress || (() => {});
    const runs = C().RUNS_PER_PROMPT;

    const expected = [];
    for (const m of models) for (const p of prompts) for (let run = 0; run < runs; run++)
      expected.push({ model: m, prompt: p, run, rid: `${m.label}::${p.id}::r${run}` });

    const result = {};
    const tasks = [];
    for (const e of expected) {
      const c = cache[e.rid];
      if (c && !c.error && c.response_text != null && c.prompt_hash === promptHash(e.prompt.text)) result[e.rid] = c;
      else tasks.push(e);
    }
    onProgress({ phase: "plan", total: expected.length, cached: expected.length - tasks.length, todo: tasks.length });

    let done = 0;
    await U.runPool(tasks, async (t) => {
      let row;
      try {
        const out = await BIAS.models.callOpenRouter({ model: t.model.model_id, messages: [{ role: "user", content: t.prompt.text }] });
        row = makeRow(t.model, t.prompt, t.run, out, null);
      } catch (e) {
        if (e.fatal && /api key/i.test(e.message)) throw e;   // stop the whole run on a missing key
        row = makeRow(t.model, t.prompt, t.run, null, e);
      }
      result[t.rid] = row;
      onProgress({ phase: "gen", done: ++done, total: tasks.length, row });
      return null;
    }, C().MAX_CONCURRENCY);

    const rows = Object.values(result);
    const summary = {};
    for (const r of rows) {
      const s = (summary[r.model] = summary[r.model] || { ok: 0, err: 0, empty: 0, tokens: 0 });
      if (r.empty) s.empty++;
      if (r.error) s.err++; else s.ok++;
      s.tokens += (r.usage && r.usage.total_tokens) || 0;   // empty generations still cost credits
    }
    return { rows, summary };
  };
})();
