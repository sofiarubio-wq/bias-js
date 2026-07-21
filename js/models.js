// OpenRouter access via browser fetch + retry, and a usage meter. Mirrors bias/models.py.
(function () {
  const BIAS = (globalThis.BIAS = globalThis.BIAS || {});
  const U = BIAS.util, C = () => BIAS.CONFIG;
  const M = (BIAS.models = {});
  const URL = "https://openrouter.ai/api/v1/chat/completions";

  // process-wide token + credit tally (reset per run, snapshot for the Run tab)
  M.METER = (function () {
    let s;
    const reset = () => (s = { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
    reset();
    return {
      reset,
      add(usage, cost) {
        s.calls++;
        if (usage) {
          s.prompt_tokens += usage.prompt_tokens || 0;
          s.completion_tokens += usage.completion_tokens || 0;
          s.total_tokens += usage.total_tokens || 0;
        }
        if (cost) s.cost += Number(cost) || 0;
      },
      snapshot() { return Object.assign({}, s, { cost: U.round(s.cost, 6) }); },
    };
  })();

  M.callOpenRouter = async function ({ model, messages, response_format, temperature, seed }) {
    const key = BIAS.getApiKey ? BIAS.getApiKey() : "";
    if (!key) throw Object.assign(new Error("No OpenRouter API key set (Settings tab)."), { fatal: true });
    // temperature/seed default to the generation settings; the judge overrides them for determinism.
    const body = { model, max_tokens: C().MAX_TOKENS, temperature: temperature ?? C().TEMPERATURE, messages, usage: { include: true } };
    if (seed != null) body.seed = seed;   // honored by providers that support it; ignored otherwise
    if (response_format) body.response_format = response_format;

    let lastErr;
    for (let attempt = 0; attempt < C().MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(URL, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bias-eval.local",
            "X-Title": "Bias Evaluator (JS)",
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          const err = new Error("HTTP " + resp.status + ": " + t.slice(0, 160));
          if (!(resp.status === 429 || resp.status >= 500)) err.fatal = true;  // client errors: no retry
          throw err;
        }
        const data = await resp.json();
        const choice = data?.choices?.[0] || {};
        const text = choice.message?.content || "";
        const u = data.usage || {};
        const usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens,
          total_tokens: u.total_tokens, cost: u.cost };
        M.METER.add(usage, u.cost);
        // A 200 with no content is a FAILED generation, not an empty opinion — reasoning models
        // burn the whole max_tokens budget on reasoning and return content:null, which
        // `content || ""` would turn into a scoreable empty string. Surface it instead: the
        // caller records the reason and the row is excluded rather than judged as a blank.
        if (!text.trim()) {
          const why = choice.finish_reason === "length"
            ? `max_tokens (${C().MAX_TOKENS}) exhausted before any content — raise it`
            : `no content (finish_reason=${choice.finish_reason ?? "?"})`;
          return { text: "", usage, empty: why, finish_reason: choice.finish_reason ?? null };
        }
        return { text, usage, finish_reason: choice.finish_reason ?? null };
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        if (attempt < C().MAX_RETRIES - 1) await U.sleep(Math.min(30, Math.max(2, 2 ** attempt)) * 1000);
      }
    }
    throw lastErr;
  };
})();
