/**
 * storage.js
 * The app's entire data layer. Static JSON files under /data are used only
 * as the first-run seed; every runtime read/write goes through
 * localStorage, keyed under the "wellspringRx." prefix.
 */
(function (global) {
  "use strict";

  const KEYS = {
    config: "wellspringRx.config",
    settings: "wellspringRx.settings",
    medicines: "wellspringRx.medicines",
    categories: "wellspringRx.categories",
    suppliers: "wellspringRx.suppliers",
    customers: "wellspringRx.customers",
    sales: "wellspringRx.sales",
    purchases: "wellspringRx.purchases",
    batches: "wellspringRx.batches",
    stockMovements: "wellspringRx.stockMovements",
    prescriptions: "wellspringRx.prescriptions",
    initFlag: "wellspringRx.initialized"
  };

  const SEED_FILES = {
    config: "data/config.json",
    settings: "data/settings.json",
    medicines: "data/medicines.json",
    categories: "data/categories.json",
    suppliers: "data/suppliers.json",
    customers: "data/customers.json",
    sales: "data/sales.json",
    purchases: "data/purchases.json",
    batches: "data/batches.json",
    stockMovements: "data/stock_movements.json",
    prescriptions: "data/prescriptions.json"
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.error(`Storage: failed to parse ${key}`, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`Storage: failed to save ${key}`, e);
      return false;
    }
  }

  async function fetchSeed(name) {
    try {
      const res = await fetch(SEED_FILES[name]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`Storage: could not load seed for "${name}", using empty default.`, e);
      return name === "config" || name === "settings" ? {} : [];
    }
  }

  // The portfolio link is owner-controlled: it always comes from data/config.json,
  // never from localStorage edits or imported backups.
  let seedPortfolioUrl = "";

  async function seedAll() {
    const names = Object.keys(SEED_FILES);
    const values = await Promise.all(names.map(fetchSeed));
    names.forEach((name, i) => writeJSON(KEYS[name], values[i]));
    writeJSON(KEYS.initFlag, true);
    seedPortfolioUrl = values[names.indexOf("config")].portfolioUrl || "";
  }

  async function init() {
    const alreadyInitialized = readJSON(KEYS.initFlag, false);
    if (!alreadyInitialized) {
      await seedAll();
    } else {
      const seedConfig = await fetchSeed("config");
      seedPortfolioUrl = seedConfig.portfolioUrl || "";
      const currentConfig = readJSON(KEYS.config, {});
      writeJSON(KEYS.config, Object.assign({}, seedConfig, currentConfig, { portfolioUrl: seedPortfolioUrl }));
    }
    global.AppConfig = readJSON(KEYS.config, {});
  }

  async function resetDemoData() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    await seedAll();
    global.AppConfig = readJSON(KEYS.config, {});
  }

  function clearAppData() {
    writeJSON(KEYS.medicines, []);
    writeJSON(KEYS.customers, []);
    writeJSON(KEYS.sales, []);
    writeJSON(KEYS.purchases, []);
    writeJSON(KEYS.batches, []);
    writeJSON(KEYS.stockMovements, []);
    writeJSON(KEYS.prescriptions, []);
  }

  function exportAll() {
    const payload = {};
    Object.entries(KEYS).forEach(([name, key]) => {
      if (name === "initFlag") return;
      payload[name] = readJSON(key, name === "config" || name === "settings" ? {} : []);
    });
    payload.exportedAt = new Date().toISOString();
    return JSON.stringify(payload, null, 2);
  }

  function importAll(jsonString) {
    const parsed = JSON.parse(jsonString);
    const validNames = Object.keys(KEYS).filter((n) => n !== "initFlag");
    let importedAny = false;
    validNames.forEach((name) => {
      if (Object.prototype.hasOwnProperty.call(parsed, name)) {
        writeJSON(KEYS[name], parsed[name]);
        importedAny = true;
      }
    });
    if (!importedAny) throw new Error("No recognizable data found in file.");
    writeJSON(KEYS.config, Object.assign({}, readJSON(KEYS.config, {}), { portfolioUrl: seedPortfolioUrl }));
    writeJSON(KEYS.initFlag, true);
    global.AppConfig = readJSON(KEYS.config, {});
    return true;
  }

  const Storage = {
    KEYS, init, resetDemoData, clearAppData, exportAll, importAll,

    getConfig: () => readJSON(KEYS.config, {}),
    saveConfig: (v) => { writeJSON(KEYS.config, v); global.AppConfig = v; },

    getSettings: () => readJSON(KEYS.settings, {}),
    saveSettings: (v) => writeJSON(KEYS.settings, v),

    getMedicines: () => readJSON(KEYS.medicines, []),
    saveMedicines: (v) => writeJSON(KEYS.medicines, v),

    getCategories: () => readJSON(KEYS.categories, []),
    saveCategories: (v) => writeJSON(KEYS.categories, v),

    getSuppliers: () => readJSON(KEYS.suppliers, []),
    saveSuppliers: (v) => writeJSON(KEYS.suppliers, v),

    getCustomers: () => readJSON(KEYS.customers, []),
    saveCustomers: (v) => writeJSON(KEYS.customers, v),

    getSales: () => readJSON(KEYS.sales, []),
    saveSales: (v) => writeJSON(KEYS.sales, v),

    getPurchases: () => readJSON(KEYS.purchases, []),
    savePurchases: (v) => writeJSON(KEYS.purchases, v),

    getBatches: () => readJSON(KEYS.batches, []),
    saveBatches: (v) => writeJSON(KEYS.batches, v),

    getMovements: () => readJSON(KEYS.stockMovements, []),
    saveMovements: (v) => writeJSON(KEYS.stockMovements, v),

    getPrescriptions: () => readJSON(KEYS.prescriptions, []),
    savePrescriptions: (v) => writeJSON(KEYS.prescriptions, v)
  };

  global.Storage = Storage;
})(window);
