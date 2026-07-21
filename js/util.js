// Small helpers shared across modules (browser + Node safe).
(function () {
  const BIAS = (globalThis.BIAS = globalThis.BIAS || {});
  const U = (BIAS.util = {});

  // Fast deterministic 53-bit hash (cyrb53). Used for judge-cache / prompt-hash keys — these
  // only need to be self-consistent within the app (not byte-match Python), so no WebCrypto.
  U.hash = function (str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  };

  // Coerce to a finite number or NaN (empty string / null / "nan" -> NaN).
  U.num = function (v) {
    if (v === "" || v === null || v === undefined) return NaN;
    const n = Number(v);
    return Number.isNaN(n) ? NaN : n;
  };

  // Parse an attribute value that may be a real object (browser path) OR a Python-repr
  // string like "{'gender': 'male'}" (imported CSV). Returns a plain object.
  U.parsePyDict = function (a) {
    if (a && typeof a === "object") return a;
    if (typeof a !== "string") return {};
    const s = a.trim();
    if (!s.startsWith("{")) return {};
    try {
      const j = s.replace(/\bNone\b/g, "null").replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false").replace(/'/g, '"');
      return JSON.parse(j) || {};
    } catch (e) { return {}; }
  };

  // First value of the attribute dict, or "none" (matches analysis._group_label).
  U.groupLabel = function (a) {
    const o = U.parsePyDict(a);
    const keys = Object.keys(o);
    return keys.length ? String(o[keys[0]]) : "none";
  };

  // Bounded-concurrency map: run `worker(item, i)` over items, at most `limit` at once.
  // Preserves result order. onDone(i) fires as each finishes (for progress).
  // If `signal` (an AbortSignal) is aborted, lanes stop pulling NEW items — in-flight workers
  // finish so no request is orphaned or double-charged, and completed results are kept.
  U.runPool = async function (items, worker, limit, signal, onDone) {
    const results = new Array(items.length);
    let next = 0;
    async function lane() {
      while (true) {
        if (signal && signal.aborted) return;
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
        if (onDone) onDone(i);
      }
    }
    const lanes = [];
    for (let k = 0; k < Math.max(1, Math.min(limit, items.length)); k++) lanes.push(lane());
    await Promise.all(lanes);
    return results;
  };

  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Round on the raw IEEE-754 double (no epsilon nudge) so results match Python's round()
  // to the last decimal on our data — e.g. 3.525*100 === 352.4999… → 3.52, not 3.53.
  U.round = (x, d = 2) => {
    if (x === null || x === undefined || Number.isNaN(x)) return null;
    const p = Math.pow(10, d);
    return Math.round(x * p) / p;
  };

  // Build a GitHub-flavored markdown table.
  U.mdTable = function (columns, rows) {
    const head = "| " + columns.join(" | ") + " |";
    const sep = "| " + columns.map(() => "---").join(" | ") + " |";
    const body = rows.map((r) => "| " + columns.map((c) => {
      const v = r[c];
      return v === null || v === undefined ? "" : String(v);
    }).join(" | ") + " |");
    return [head, sep, ...body].join("\n");
  };

  // Serialize rows to CSV (columns from the union of keys, or provided list).
  U.toCSV = function (rows, columns) {
    const cols = columns || Array.from(rows.reduce((s, r) => {
      Object.keys(r).forEach((k) => s.add(k)); return s;
    }, new Set()));
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  };

  // Inverse of toCSV: parse to row objects keyed by the header. Handles quoted fields with
  // embedded commas, newlines, and doubled quotes — response_text contains all three.
  U.parseCSV = function (text) {
    const rows = [];
    let row = [], field = "", quoted = false, i = 0;
    const s = String(text ?? "").replace(/\r\n?/g, "\n");
    const endField = () => { row.push(field); field = ""; };
    const endRow = () => { endField(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
    while (i < s.length) {
      const c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { quoted = false; i++; continue; }
        field += c; i++;
      } else if (c === '"' && field === "") { quoted = true; i++; }
      else if (c === ",") { endField(); i++; }
      else if (c === "\n") { endRow(); i++; }
      else { field += c; i++; }
    }
    endRow();
    if (!rows.length) return [];
    const header = rows[0];
    return rows.slice(1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])));
  };

  // Browser download (no-op guard under Node).
  U.download = function (filename, text, mime = "text/plain") {
    if (typeof document === "undefined") return;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
