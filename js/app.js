/**
 * app.js
 * Router + dashboard + sales history + settings + app chrome. Medicines,
 * inventory/batches/expiry/purchases, POS, customers, suppliers,
 * prescriptions and reports each live in their own module.
 */
(function (global) {
  "use strict";

  const { formatCurrency, formatDate, formatDateTime, isSameDay, isSameMonth, escapeHtml, round2, expiryBucket } = Utils;

  const ROUTES = {
    dashboard: { title: "Dashboard", subtitle: "A snapshot of the pharmacy today.", render: renderDashboard },
    pos: { title: "Pharmacy POS", subtitle: "Build a sale and check out a customer.", render: (c) => POS.render(c) },
    medicines: { title: "Medicines", subtitle: "The pharmacy's medicine catalog.", render: (c) => Medicines.renderList(c) },
    inventory: { title: "Inventory", subtitle: "Stock levels and valuation across all medicines.", render: (c) => Inventory.renderOverview(c) },
    batches: { title: "Batches", subtitle: "Every batch on hand, plus manual stock movements.", render: (c) => Inventory.renderBatches(c) },
    expiry: { title: "Expiry", subtitle: "Batches grouped by how soon they expire.", render: (c) => Inventory.renderExpiry(c) },
    purchases: { title: "Purchases", subtitle: "Receive stock from suppliers.", render: (c) => Inventory.renderPurchases(c) },
    sales: { title: "Sales", subtitle: "Search and review completed transactions.", render: renderSalesHistory },
    prescriptions: { title: "Prescriptions", subtitle: "Demo prescription records.", render: (c) => Prescriptions.renderList(c) },
    customers: { title: "Customers", subtitle: "Manage customer records and purchase history.", render: (c) => Customers.renderList(c) },
    suppliers: { title: "Suppliers", subtitle: "Manage the vendors that supply your stock.", render: (c) => Suppliers.renderList(c) },
    reports: { title: "Reports", subtitle: "Sales, purchasing, inventory, expiry and profit reports.", render: (c) => Reports.renderPage(c) },
    settings: { title: "Settings", subtitle: "Pharmacy info, tax, and data management.", render: renderSettings }
  };

  let charts = {};

  async function boot() {
    await Storage.init();
    applyChrome();
    wireChrome();
    window.addEventListener("hashchange", route);
    if (!global.location.hash) global.location.hash = "#/dashboard";
    route();
  }

  function applyChrome() {
    const cfg = Storage.getConfig();
    document.title = cfg.pharmacyName || "Wellspring Pharmacy";
    const brand = document.querySelector(".brand-name");
    if (brand) brand.textContent = (cfg.pharmacyName || "Wellspring Pharmacy").split(" ")[0];
    const link = document.getElementById("portfolio-link");
    if (link) link.href = cfg.portfolioUrl || "#";
    const banner = document.querySelector(".demo-banner span");
    if (banner && cfg.demoNotice) banner.textContent = cfg.demoNotice;
  }

  function wireChrome() {
    const shell = document.querySelector(".app-shell");
    document.getElementById("sidebar-collapse").addEventListener("click", () => shell.classList.toggle("collapsed"));
    document.getElementById("mobile-nav-toggle").addEventListener("click", () => shell.classList.add("mobile-open"));
    document.getElementById("sidebar-scrim").addEventListener("click", closeMobileNav);
    document.querySelectorAll(".nav-link").forEach((a) => a.addEventListener("click", closeMobileNav));
  }

  function closeMobileNav() {
    document.querySelector(".app-shell").classList.remove("mobile-open");
  }

  function currentRouteName() {
    const hash = global.location.hash.replace(/^#\/?/, "");
    return ROUTES[hash] ? hash : "dashboard";
  }

  function route() {
    destroyCharts();
    const name = currentRouteName();
    const def = ROUTES[name];
    document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
    document.getElementById("page-title").textContent = def.title;
    document.getElementById("page-subtitle").textContent = def.subtitle || "";
    const content = document.getElementById("app-content");
    content.innerHTML = "";
    def.render(content);
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
  }

  global.App = { route };

  // ---------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------

  function renderDashboard(container) {
    const medicines = Storage.getMedicines();
    const sales = Storage.getSales();
    const customers = Storage.getCustomers();
    const suppliers = Storage.getSuppliers();
    const batches = Storage.getBatches();

    const todaysSales = sales.filter((s) => isSameDay(s.date));
    const todaysRevenue = round2(todaysSales.reduce((s, r) => s + r.total, 0));
    const monthlySales = sales.filter((s) => isSameMonth(s.date));
    const monthlyRevenue = round2(monthlySales.reduce((s, r) => s + r.total, 0));

    const lowStock = medicines.filter((m) => Utils.stockStatus(m) === "Low Stock").length;
    const outOfStock = medicines.filter((m) => Utils.stockStatus(m) === "Out of Stock").length;
    const expiringSoon = batches.filter((b) => ["Expiring in 30 Days", "Expiring in 60 Days", "Expiring in 90 Days"].includes(expiryBucket(b.expiryDate))).length;
    const expired = batches.filter((b) => expiryBucket(b.expiryDate) === "Expired").length;

    const inventoryValue = round2(medicines.reduce((s, m) => s + m.quantity * m.purchasePrice, 0));
    const profit = Reports.profitEstimation(sales, medicines);

    container.innerHTML = `
      <div class="grid grid-stats">
        ${statCard("Today's Sales", formatCurrency(todaysRevenue), `${todaysSales.length} transaction${todaysSales.length === 1 ? "" : "s"}`)}
        ${statCard("Monthly Sales", formatCurrency(monthlyRevenue), `${monthlySales.length} transactions this month`)}
        ${statCard("Total Medicines", medicines.length, `${customers.length} customers · ${suppliers.length} suppliers`)}
        ${statCard("Inventory Value", formatCurrency(inventoryValue), "at purchase price")}
      </div>
      <div class="grid grid-stats mt-16">
        ${statCard("Low Stock", lowStock, "below reorder level", lowStock ? "accent-warning" : "")}
        ${statCard("Out of Stock", outOfStock, "need reordering", outOfStock ? "accent-danger" : "")}
        ${statCard("Expiring Soon", expiringSoon, "within 90 days", expiringSoon ? "accent-warning" : "")}
        ${statCard("Expired", expired, "flagged for disposal", expired ? "accent-danger" : "")}
      </div>
      <div class="mt-16"><div class="stat-card" style="border-left-color:var(--color-rx);"><div class="stat-label">Estimated Gross Profit (all-time)</div><div class="stat-value tabular">${formatCurrency(profit.profit)}</div><div class="stat-sub">${profit.margin}% margin on ${formatCurrency(profit.revenue)} revenue</div></div></div>

      <div class="grid grid-charts">
        <div class="card chart-card"><div class="card-title-row"><h3>Sales trend (last 14 days)</h3></div><canvas id="chart-sales-trend"></canvas></div>
        <div class="card chart-card"><div class="card-title-row"><h3>Sales by category</h3></div><canvas id="chart-sales-category"></canvas></div>
      </div>
      <div class="grid grid-charts-3">
        <div class="card chart-card"><div class="card-title-row"><h3>Top-selling medicines</h3></div><canvas id="chart-top-meds"></canvas></div>
        <div class="card chart-card"><div class="card-title-row"><h3>Inventory status</h3></div><canvas id="chart-inv-status"></canvas></div>
        <div class="card chart-card"><div class="card-title-row"><h3>Expiry status</h3></div><canvas id="chart-expiry-status"></canvas></div>
      </div>
    `;

    try {
      drawSalesTrend(sales);
      drawSalesCategory(sales, medicines);
      drawTopMeds(sales);
      drawInventoryStatus(medicines);
      drawExpiryStatus(batches);
    } catch (e) {
      console.warn("Dashboard charts could not be drawn.", e);
    }
  }

  function statCard(label, value, sub, subClass) {
    return `<div class="stat-card ${subClass || ""}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value tabular">${value}</div>${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
  }

  function drawSalesTrend(sales) {
    const data = Reports.salesByDay(sales, 14);
    const ctx = document.getElementById("chart-sales-trend");
    if (!ctx) return;
    charts.salesTrend = new Chart(ctx, {
      type: "line",
      data: { labels: data.map((d) => d.label), datasets: [{ label: "Revenue", data: data.map((d) => d.total), borderColor: "#2563EB", backgroundColor: "rgba(37,99,235,0.12)", tension: 0.3, fill: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } } }
    });
  }

  function drawSalesCategory(sales, medicines) {
    const data = Reports.salesByCategory(sales, medicines).slice(0, 7);
    const ctx = document.getElementById("chart-sales-category");
    if (!ctx) return;
    charts.salesCategory = new Chart(ctx, {
      type: "doughnut",
      data: { labels: data.map((d) => d.category), datasets: [{ data: data.map((d) => d.revenue), backgroundColor: ["#2563EB", "#1FA971", "#D9930E", "#7C5CFC", "#DC3B4E", "#0B1E3D", "#8B98AD"] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10.5 } } } } }
    });
  }

  function drawTopMeds(sales) {
    const data = Reports.topSellingMedicines(sales, 5).reverse();
    const ctx = document.getElementById("chart-top-meds");
    if (!ctx) return;
    charts.topMeds = new Chart(ctx, {
      type: "bar",
      data: { labels: data.map((d) => d.name), datasets: [{ label: "Units sold", data: data.map((d) => d.quantitySold), backgroundColor: "#0B1E3D", borderRadius: 4 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
  }

  function drawInventoryStatus(medicines) {
    const counts = { "In Stock": 0, "Low Stock": 0, "Out of Stock": 0 };
    medicines.forEach((m) => { counts[Utils.stockStatus(m)]++; });
    const ctx = document.getElementById("chart-inv-status");
    if (!ctx) return;
    charts.invStatus = new Chart(ctx, {
      type: "doughnut",
      data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ["#1FA971", "#D9930E", "#DC3B4E"] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10.5 } } } } }
    });
  }

  function drawExpiryStatus(batches) {
    const buckets = ["Expired", "Expiring in 30 Days", "Expiring in 60 Days", "Expiring in 90 Days", "Valid"];
    const counts = buckets.map((b) => batches.filter((batch) => expiryBucket(batch.expiryDate) === b).length);
    const ctx = document.getElementById("chart-expiry-status");
    if (!ctx) return;
    charts.expiryStatus = new Chart(ctx, {
      type: "bar",
      data: { labels: buckets.map((b) => b.replace("Expiring in ", "").replace(" Days", "d")), datasets: [{ label: "Batches", data: counts, backgroundColor: ["#DC3B4E", "#DC3B4E", "#D9930E", "#D9930E", "#1FA971"], borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
  }

  // ---------------------------------------------------------------------
  // Sales history
  // ---------------------------------------------------------------------

  let salesFilters = { search: "", payment: "all", from: "", to: "" };

  function renderSalesHistory(container) {
    container.innerHTML = `
      <div class="page-toolbar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="sh-search" placeholder="Search by sale # or customer…" value="${escapeHtml(salesFilters.search)}" />
        </div>
        <select id="sh-payment-filter" style="max-width:150px;">
          <option value="all">All payments</option>
          <option>Cash</option><option>Card</option><option>Other</option>
        </select>
        <input type="date" id="sh-from" value="${salesFilters.from}" style="max-width:150px;" />
        <input type="date" id="sh-to" value="${salesFilters.to}" style="max-width:150px;" />
      </div>
      <div id="sh-table-wrap"></div>
    `;
    document.getElementById("sh-payment-filter").value = salesFilters.payment;
    renderSalesTable();
    document.getElementById("sh-search").addEventListener("input", Utils.debounce((e) => { salesFilters.search = e.target.value; renderSalesTable(); }, 200));
    document.getElementById("sh-payment-filter").addEventListener("change", (e) => { salesFilters.payment = e.target.value; renderSalesTable(); });
    document.getElementById("sh-from").addEventListener("change", (e) => { salesFilters.from = e.target.value; renderSalesTable(); });
    document.getElementById("sh-to").addEventListener("change", (e) => { salesFilters.to = e.target.value; renderSalesTable(); });
  }

  function renderSalesTable() {
    const wrap = document.getElementById("sh-table-wrap");
    let sales = [...Storage.getSales()].sort((a, b) => new Date(b.date) - new Date(a.date));
    const term = salesFilters.search.trim().toLowerCase();
    if (term) sales = sales.filter((s) => s.id.toLowerCase().includes(term) || s.customerName.toLowerCase().includes(term));
    if (salesFilters.payment !== "all") sales = sales.filter((s) => s.paymentMethod === salesFilters.payment);
    if (salesFilters.from) sales = sales.filter((s) => s.date.slice(0, 10) >= salesFilters.from);
    if (salesFilters.to) sales = sales.filter((s) => s.date.slice(0, 10) <= salesFilters.to);

    if (!sales.length) {
      wrap.innerHTML = Components.emptyState({ title: "No transactions found", message: "Try adjusting your search or date range." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Sale #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${sales.map((s) => `
              <tr>
                <td class="cell-strong">${escapeHtml(s.id)}</td>
                <td class="cell-soft">${formatDateTime(s.date)}</td>
                <td>${escapeHtml(s.customerName)}</td>
                <td class="tabular">${s.items.reduce((a, i) => a + i.quantity, 0)}</td>
                <td class="tabular cell-strong">${formatCurrency(s.total)}</td>
                <td>${escapeHtml(s.paymentMethod)}</td>
                <td>${Components.badge(s.status)}</td>
                <td class="row-actions"><button class="btn btn-outline btn-sm" data-view-sale="${s.id}">View</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-view-sale]").forEach((b) => b.addEventListener("click", () => {
      const sale = Storage.getSales().find((s) => s.id === b.dataset.viewSale);
      POS.showReceiptModal(sale);
    }));
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  function renderSettings(container) {
    const cfg = Storage.getConfig();
    container.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title-row"><h3>Pharmacy Information</h3></div>
          <form id="settings-form">
            <div class="field"><label for="st-name">Pharmacy name</label><input id="st-name" value="${escapeHtml(cfg.pharmacyName || "")}" /></div>
            <div class="field"><label for="st-address">Address</label><input id="st-address" value="${escapeHtml(cfg.pharmacyAddress || "")}" /></div>
            <div class="field-row">
              <div class="field"><label for="st-phone">Phone</label><input id="st-phone" value="${escapeHtml(cfg.pharmacyPhone || "")}" /></div>
              <div class="field"><label for="st-email">Email</label><input id="st-email" value="${escapeHtml(cfg.pharmacyEmail || "")}" /></div>
            </div>
            <div class="field"><label for="st-license">License number</label><input id="st-license" value="${escapeHtml(cfg.licenseNumber || "")}" /></div>
            <div class="field-row">
              <div class="field"><label for="st-currency">Currency symbol</label><input id="st-currency" value="${escapeHtml(cfg.currencySymbol || "$")}" /></div>
              <div class="field"><label for="st-tax">Tax rate (%)</label><input id="st-tax" type="number" min="0" step="0.01" value="${(cfg.taxRate || 0) * 100}" /></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="st-lowstock">Default low-stock threshold</label><input id="st-lowstock" type="number" min="0" step="1" value="${cfg.lowStockThreshold || 20}" /></div>
              <div class="field"><label for="st-expiry">Expiry warning window (days)</label><input id="st-expiry" type="number" min="1" step="1" value="${cfg.expiryWarningDays || 90}" /></div>
            </div>
            <div class="field"><label for="st-portfolio">Portfolio URL</label><input id="st-portfolio" value="${escapeHtml(cfg.portfolioUrl || "")}" /></div>
            <div class="field"><label for="st-receipt-footer">Receipt footer message</label><textarea id="st-receipt-footer" rows="2">${escapeHtml((cfg.receipt && cfg.receipt.footerMessage) || "")}</textarea></div>
            <button type="button" class="btn btn-primary" id="save-settings-btn">Save Settings</button>
          </form>
        </div>

        <div class="card">
          <div class="card-title-row"><h3>Data Management</h3></div>
          <p class="text-soft mb-16">All data is stored locally in your browser. Use these tools to back up, restore, or reset it.</p>
          <div class="flex gap-8" style="flex-wrap:wrap;">
            <button class="btn btn-outline" id="export-data-btn">Export Data (JSON)</button>
            <label class="btn btn-outline" for="import-data-input" style="cursor:pointer;">Import Data (JSON)</label>
            <input type="file" id="import-data-input" accept="application/json" class="hidden" />
          </div>
          <hr style="border:none; border-top:1px solid var(--color-border); margin:18px 0;" />
          <div class="flex gap-8" style="flex-wrap:wrap;">
            <button class="btn btn-ghost" id="reset-demo-btn">Reset Demo Data</button>
            <button class="btn btn-danger" id="clear-data-btn">Clear All Data</button>
          </div>
          <p class="field-hint mt-16">Reset Demo Data reloads the original sample catalog, batches, sales and purchases. Clear All Data empties everything — this cannot be undone.</p>
        </div>
      </div>
    `;

    document.getElementById("save-settings-btn").addEventListener("click", () => {
      const val = (id) => document.getElementById(id).value.trim();
      const updated = Object.assign({}, cfg, {
        pharmacyName: val("st-name"),
        pharmacyAddress: val("st-address"),
        pharmacyPhone: val("st-phone"),
        pharmacyEmail: val("st-email"),
        licenseNumber: val("st-license"),
        currencySymbol: val("st-currency") || "$",
        taxRate: (parseFloat(val("st-tax")) || 0) / 100,
        lowStockThreshold: parseInt(val("st-lowstock"), 10) || 20,
        expiryWarningDays: parseInt(val("st-expiry"), 10) || 90,
        portfolioUrl: val("st-portfolio"),
        receipt: Object.assign({}, cfg.receipt, { footerMessage: val("st-receipt-footer") })
      });
      Storage.saveConfig(updated);
      applyChrome();
      Components.toast("Settings saved.", "success");
    });

    document.getElementById("export-data-btn").addEventListener("click", () => {
      Utils.downloadFile(`wellspring-pharmacy-backup-${new Date().toISOString().slice(0, 10)}.json`, Storage.exportAll());
      Components.toast("Data exported.", "success");
    });

    document.getElementById("import-data-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await Utils.readFileAsText(file);
        const ok = await Components.confirmDialog({ title: "Import data?", message: "This overwrites your current data with the contents of this file.", confirmText: "Import", danger: true });
        if (!ok) { e.target.value = ""; return; }
        Storage.importAll(text);
        Components.toast("Data imported successfully.", "success");
        applyChrome();
        route();
      } catch (err) {
        Components.toast("Could not import that file. Make sure it's a valid export.", "error");
      }
      e.target.value = "";
    });

    document.getElementById("reset-demo-btn").addEventListener("click", async () => {
      const ok = await Components.confirmDialog({ title: "Reset demo data?", message: "This replaces all current data with the original sample catalog, batches, sales and purchases.", confirmText: "Reset Data", danger: true });
      if (!ok) return;
      await Storage.resetDemoData();
      Components.toast("Demo data restored.", "success");
      applyChrome();
      route();
    });

    document.getElementById("clear-data-btn").addEventListener("click", async () => {
      const ok = await Components.confirmDialog({ title: "Clear all data?", message: "This permanently empties your medicines, customers, sales, purchases, batches and prescriptions.", confirmText: "Clear Data", danger: true });
      if (!ok) return;
      Storage.clearAppData();
      Components.toast("All application data cleared.", "success");
      route();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})(window);
