/**
 * reports.js
 * Report calculations (pure functions, reused by the dashboard) plus the
 * Reports page itself, which picks a report and renders it as a
 * print-friendly table.
 */
(function (global) {
  "use strict";

  const { formatCurrency, formatDate, escapeHtml, round2, expiryBucket } = Utils;

  function inRange(dateStr, from, to) {
    const t = new Date(dateStr).getTime();
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(to).getTime()) return false;
    return true;
  }

  function salesReport(sales, from, to) {
    let list = sales;
    if (from || to) list = list.filter((s) => inRange(s.date, from, to));
    const totalRevenue = round2(list.reduce((s, r) => s + r.total, 0));
    const itemCount = list.reduce((s, r) => s + r.items.reduce((a, i) => a + i.quantity, 0), 0);
    return { sales: [...list].sort((a, b) => new Date(b.date) - new Date(a.date)), totalRevenue, itemCount, count: list.length };
  }

  function salesByDay(sales, days) {
    const n = days || 14;
    const result = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const total = sales.filter((s) => s.date.slice(0, 10) === key).reduce((sum, s) => sum + s.total, 0);
      result.push({ label, total: round2(total) });
    }
    return result;
  }

  function salesByCategory(sales, medicines) {
    const catByMed = {};
    medicines.forEach((m) => { catByMed[m.id] = m.category; });
    const map = {};
    sales.forEach((s) => s.items.forEach((it) => {
      const cat = catByMed[it.medicineId] || "Uncategorized";
      map[cat] = (map[cat] || 0) + it.lineTotal;
    }));
    return Object.entries(map).map(([category, revenue]) => ({ category, revenue: round2(revenue) })).sort((a, b) => b.revenue - a.revenue);
  }

  function topSellingMedicines(sales, limit) {
    const map = {};
    sales.forEach((s) => s.items.forEach((it) => {
      if (!map[it.medicineId]) map[it.medicineId] = { medicineId: it.medicineId, name: it.name, quantitySold: 0, revenue: 0 };
      map[it.medicineId].quantitySold += it.quantity;
      map[it.medicineId].revenue += it.lineTotal;
    }));
    return Object.values(map).map((r) => ({ ...r, revenue: round2(r.revenue) })).sort((a, b) => b.quantitySold - a.quantitySold).slice(0, limit || 10);
  }

  function purchaseReport(purchases, from, to) {
    let list = purchases;
    if (from || to) list = list.filter((p) => inRange(p.date, from, to));
    const totalValue = round2(list.reduce((s, p) => s + p.totalValue, 0));
    return { purchases: [...list].sort((a, b) => new Date(b.date) - new Date(a.date)), totalValue, count: list.length };
  }

  function inventoryReport(medicines) {
    return medicines.map((m) => ({
      id: m.id, name: m.brandName, generic: m.genericName, category: m.category,
      quantity: m.quantity, purchaseValue: round2(m.quantity * m.purchasePrice),
      retailValue: round2(m.quantity * m.sellingPrice), status: Utils.stockStatus(m)
    }));
  }

  function inventoryValuation(medicines) {
    const totalUnits = medicines.reduce((s, m) => s + m.quantity, 0);
    const totalPurchaseValue = round2(medicines.reduce((s, m) => s + m.quantity * m.purchasePrice, 0));
    const totalRetailValue = round2(medicines.reduce((s, m) => s + m.quantity * m.sellingPrice, 0));
    const grossMargin = round2(totalRetailValue - totalPurchaseValue);
    return { totalUnits, totalPurchaseValue, totalRetailValue, grossMargin };
  }

  function expiryReport(batches) {
    return batches.map((b) => ({ ...b, bucket: expiryBucket(b.expiryDate) })).sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  }

  function lowStockReport(medicines) {
    return medicines.filter((m) => Utils.stockStatus(m) !== "In Stock").map((m) => ({ ...m, status: Utils.stockStatus(m) })).sort((a, b) => a.quantity - b.quantity);
  }

  function productPerformance(sales, medicines) {
    const sold = topSellingMedicines(sales, medicines.length);
    const bySoldId = {};
    sold.forEach((s) => { bySoldId[s.medicineId] = s; });
    return medicines.map((m) => ({
      name: m.brandName, category: m.category,
      quantitySold: bySoldId[m.id] ? bySoldId[m.id].quantitySold : 0,
      revenue: bySoldId[m.id] ? bySoldId[m.id].revenue : 0,
      currentStock: m.quantity
    })).sort((a, b) => b.revenue - a.revenue);
  }

  function profitEstimation(sales, medicines) {
    const costById = {};
    medicines.forEach((m) => { costById[m.id] = m.purchasePrice; });
    let revenue = 0, cost = 0;
    sales.forEach((s) => s.items.forEach((it) => {
      revenue += it.lineTotal;
      cost += (costById[it.medicineId] || 0) * it.quantity;
    }));
    const profit = round2(revenue - cost);
    return { revenue: round2(revenue), cost: round2(cost), profit, margin: revenue ? round2((profit / revenue) * 100) : 0 };
  }

  function supplierReport(purchases, medicines, suppliers) {
    return suppliers.map((s) => {
      const sPurchases = purchases.filter((p) => p.supplierId === s.id);
      const totalValue = round2(sPurchases.reduce((sum, p) => sum + p.totalValue, 0));
      const medicineCount = medicines.filter((m) => m.supplier === s.id).length;
      return { name: s.name, purchaseCount: sPurchases.length, totalValue, medicineCount };
    }).sort((a, b) => b.totalValue - a.totalValue);
  }

  // ---------------------------------------------------------------------
  // Reports page
  // ---------------------------------------------------------------------

  let activeReport = "sales";

  function renderPage(container) {
    container.innerHTML = `
      <div class="page-toolbar">
        <div class="pill-row" id="report-tabs">
          ${[
            ["sales", "Sales"], ["purchases", "Purchases"], ["inventory", "Inventory"], ["expiry", "Expiry"],
            ["lowstock", "Low Stock"], ["performance", "Product Performance"], ["profit", "Profit Estimate"], ["suppliers", "Suppliers"]
          ].map(([k, label]) => `<button class="pill ${activeReport === k ? "active" : ""}" data-report="${k}">${label}</button>`).join("")}
        </div>
        <div class="spacer"></div>
        <button class="btn btn-outline" id="print-report-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4v-6h16v6h-2M6 14h12v7H6v-7Z"/></svg>
          Print Report
        </button>
      </div>
      <div id="report-body" class="card"></div>
    `;
    renderBody();
    document.getElementById("report-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-report]");
      if (!btn) return;
      activeReport = btn.dataset.report;
      renderPage(container);
    });
    document.getElementById("print-report-btn").addEventListener("click", () => window.print());
  }

  function statCard(label, value, sub) {
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value tabular">${value}</div>${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
  }

  function table(headers, rows) {
    if (!rows.length) return Components.emptyState({ title: "No data yet", message: "There's nothing to report for this selection yet." });
    return `<div class="table-wrap" id="print-area"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderBody() {
    const body = document.getElementById("report-body");
    const sales = Storage.getSales();
    const purchases = Storage.getPurchases();
    const medicines = Storage.getMedicines();
    const batches = Storage.getBatches();
    const suppliers = Storage.getSuppliers();

    if (activeReport === "sales") {
      const r = salesReport(sales);
      body.innerHTML = `<h3 class="mb-16">Sales Report</h3>
        <div class="grid grid-stats mb-16">${statCard("Transactions", r.count)}${statCard("Revenue", formatCurrency(r.totalRevenue))}${statCard("Items Sold", r.itemCount)}${statCard("Avg. Sale", formatCurrency(r.count ? round2(r.totalRevenue / r.count) : 0))}</div>
        ${table(["Sale #", "Date", "Customer", "Items", "Total"], r.sales.map((s) => [escapeHtml(s.id), formatDate(s.date), escapeHtml(s.customerName), s.items.reduce((a, i) => a + i.quantity, 0), formatCurrency(s.total)]))}`;
    } else if (activeReport === "purchases") {
      const r = purchaseReport(purchases);
      body.innerHTML = `<h3 class="mb-16">Purchase Report</h3>
        <div class="grid grid-stats mb-16">${statCard("Purchase Orders", r.count)}${statCard("Total Value", formatCurrency(r.totalValue))}</div>
        ${table(["Purchase #", "Supplier", "Date", "Items", "Total"], r.purchases.map((p) => [escapeHtml(p.id), escapeHtml(p.supplierName), formatDate(p.date), p.items.length, formatCurrency(p.totalValue)]))}`;
    } else if (activeReport === "inventory") {
      const rows = inventoryReport(medicines);
      const v = inventoryValuation(medicines);
      body.innerHTML = `<h3 class="mb-16">Inventory Report</h3>
        <div class="grid grid-stats mb-16">${statCard("Total Units", v.totalUnits)}${statCard("Purchase Value", formatCurrency(v.totalPurchaseValue))}${statCard("Retail Value", formatCurrency(v.totalRetailValue))}${statCard("Est. Gross Margin", formatCurrency(v.grossMargin))}</div>
        ${table(["Medicine", "Category", "Qty", "Purchase Value", "Retail Value", "Status"], rows.map((r) => [escapeHtml(r.name), escapeHtml(r.category), r.quantity, formatCurrency(r.purchaseValue), formatCurrency(r.retailValue), Components.badge(r.status)]))}`;
    } else if (activeReport === "expiry") {
      const rows = expiryReport(batches);
      body.innerHTML = `<h3 class="mb-16">Expiry Report</h3>${table(["Medicine", "Batch #", "Expiry Date", "Qty", "Status"], rows.map((b) => [escapeHtml(b.medicineName), escapeHtml(b.batchNumber), formatDate(b.expiryDate), b.quantity, `<span class="badge ${Utils.expiryBadgeClass(b.bucket)}">${b.bucket}</span>`]))}`;
    } else if (activeReport === "lowstock") {
      const rows = lowStockReport(medicines);
      body.innerHTML = `<h3 class="mb-16">Low Stock Report</h3>${table(["Medicine", "Category", "Qty", "Reorder Level", "Status"], rows.map((m) => [escapeHtml(m.brandName), escapeHtml(m.category), m.quantity, m.reorderLevel, Components.badge(m.status)]))}`;
    } else if (activeReport === "performance") {
      const rows = productPerformance(sales, medicines);
      body.innerHTML = `<h3 class="mb-16">Product Performance</h3>${table(["Medicine", "Category", "Units Sold", "Revenue", "Current Stock"], rows.map((r) => [escapeHtml(r.name), escapeHtml(r.category), r.quantitySold, formatCurrency(r.revenue), r.currentStock]))}`;
    } else if (activeReport === "profit") {
      const p = profitEstimation(sales, medicines);
      body.innerHTML = `<h3 class="mb-16">Profit Estimation</h3>
        <div class="grid grid-stats">${statCard("Revenue", formatCurrency(p.revenue))}${statCard("Cost of Goods", formatCurrency(p.cost))}${statCard("Estimated Profit", formatCurrency(p.profit))}${statCard("Margin", p.margin + "%")}</div>
        <p class="field-hint mt-16">Estimated from purchase and selling prices recorded per medicine; does not include operating expenses or spoilage write-offs.</p>`;
    } else if (activeReport === "suppliers") {
      const rows = supplierReport(purchases, medicines, suppliers);
      body.innerHTML = `<h3 class="mb-16">Supplier Report</h3>${table(["Supplier", "Purchase Orders", "Total Value", "Medicines Supplied"], rows.map((r) => [escapeHtml(r.name), r.purchaseCount, formatCurrency(r.totalValue), r.medicineCount]))}`;
    }
  }

  global.Reports = {
    salesReport, salesByDay, salesByCategory, topSellingMedicines,
    purchaseReport, inventoryReport, inventoryValuation, expiryReport,
    lowStockReport, productPerformance, profitEstimation, supplierReport,
    renderPage
  };
})(window);
