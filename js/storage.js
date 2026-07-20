// Persistence — best-effort so it degrades gracefully on file:// (where IndexedDB/localStorage
// may be blocked): IndexedDB → localStorage → in-memory. Export/Import JSON is the reliable path.
(function () {
  const BIAS = (globalThis.BIAS = globalThis.BIAS || {});
  const U = BIAS.util;
  const St = (BIAS.storage = {});
  const mem = new Map();
  let idb = null, mode = "memory";

  St.init = async function () {
    // try IndexedDB
    try {
      if (typeof indexedDB !== "undefined") {
        idb = await new Promise((res, rej) => {
          const req = indexedDB.open("bias_js", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("kv");
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        // probe a write
        await St._idbSet("__probe__", 1);
        mode = "indexeddb";
        return mode;
      }
    } catch (e) { idb = null; }
    // try localStorage
    try {
      if (typeof localStorage !== "undefined") { localStorage.setItem("__probe__", "1"); localStorage.removeItem("__probe__"); mode = "localstorage"; return mode; }
    } catch (e) { /* fall through */ }
    mode = "memory";
    return mode;
  };
  St.mode = () => mode;

  St._idbSet = (k, v) => new Promise((res, rej) => {
    const tx = idb.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  St._idbGet = (k) => new Promise((res, rej) => {
    const tx = idb.transaction("kv", "readonly"); const r = tx.objectStore("kv").get(k);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });

  St.set = async function (key, value) {
    try {
      if (mode === "indexeddb") return await St._idbSet(key, value);
      if (mode === "localstorage") return localStorage.setItem("bias_" + key, JSON.stringify(value));
    } catch (e) { /* quota / blocked → fall back to memory for this key */ }
    mem.set(key, value);
  };
  St.get = async function (key, dflt) {
    try {
      if (mode === "indexeddb") { const v = await St._idbGet(key); return v === undefined ? dflt : v; }
      if (mode === "localstorage") { const s = localStorage.getItem("bias_" + key); return s == null ? dflt : JSON.parse(s); }
    } catch (e) { /* fall through */ }
    return mem.has(key) ? mem.get(key) : dflt;
  };

  // full snapshot for Export / Import
  St.KEYS = ["prompts", "rawResponses", "scored", "humanLabels", "labeledResponses", "judgeCache",
    "settings", "runHistory"];
  St.exportAll = async function () {
    const obj = { _format: "bias-js/v1", exported: new Date().toISOString() };
    for (const k of St.KEYS) obj[k] = await St.get(k, null);
    return obj;
  };
  St.importAll = async function (obj) {
    for (const k of St.KEYS) if (obj[k] !== undefined && obj[k] !== null) await St.set(k, obj[k]);
  };
  St.downloadExport = async function () {
    U.download("bias-js-export.json", JSON.stringify(await St.exportAll(), null, 2), "application/json");
  };
})();
