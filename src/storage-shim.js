// Stand-in for the Claude artifact `window.storage` API, backed by localStorage.
// Stats and settings persist in this browser. "Shared" keys are only shared
// between tabs of the same browser, so online multiplayer rooms won't reach
// other people.
if (typeof window.storage === "undefined") {
  const k = (key, shared) => (shared ? "shared:" : "own:") + key;
  window.storage = {
    async get(key, shared = false) {
      const value = localStorage.getItem(k(key, shared));
      if (value === null) throw new Error("Key not found: " + key);
      return { key, value, shared };
    },
    async set(key, value, shared = false) {
      localStorage.setItem(k(key, shared), value);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      localStorage.removeItem(k(key, shared));
      return { key, deleted: true, shared };
    },
    async list(prefix = "", shared = false) {
      const p = k(prefix, shared), base = k("", shared);
      const keys = Object.keys(localStorage).filter((x) => x.startsWith(p)).map((x) => x.slice(base.length));
      return { keys, prefix, shared };
    },
  };
}
