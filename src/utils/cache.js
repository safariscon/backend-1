const store = new Map();

const getCache = (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
};

const setCache = (key, value, ttlMs = 15000) => {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
};

const clearCache = (prefix = "") => {
  for (const key of store.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      store.delete(key);
    }
  }
};

module.exports = {
  getCache,
  setCache,
  clearCache,
};
