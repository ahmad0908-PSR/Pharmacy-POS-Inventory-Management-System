/**
 * inventory.js
 * Everything related to stock levels: the medicine-level overview, the
 * batch ledger (with manual stock movements), the expiry dashboard, and
 * the purchasing/receiving workflow that creates new batches.
 */
(function (global) {
  "use strict";

  const { formatCurrency, formatDate, escapeHtml, round2, stockStatus, expiryBucket, expiryBadgeClass, daysUntil } = Utils;

  const MOVEMENT_TYPES = ["Return", "Damage", "Adjustment", "Expired"];

  /** Recomputes a medicine's total quantity + status from its batches. Call after any batch change. */
  function recomputeMedicineStock(medicineId) {
    const medicines = Storage.getMedicines();
    const batches = Storage.getBatches();
    const med = medicines.find((m) => m.id === medicineId);
    if (!med) return;
    med.quantity = batches.filter((b) => b.medicineId === medicineId).reduce((s, b) => s + b.quantity, 0);
    med.status = stockStatus(med);
    Storage.saveMedicines(medicines);
  }

  // =======================================================================
  // Inventory overview
  // =======================================================================

  let invFilter = "all";

  function renderOverview(container) {
    const medicines = Storage.getMedicines();
    const totalValue = round2(medicines.reduce((s, m) => s + m.quantity * m.purchasePrice, 0));
    const retailValue = round2(medicines.reduce((s, m) => s + m.quantity * m.sellingPrice, 0));
    const low = medicines.filter((m) => stockStatus(m) === "Low Stock").length;
    const out = medicines.filter((m) => stockStatus(m) === "Out of Stock").length;

    container.innerHTML = `
      <div class="grid grid-stats mb-16">
        ${statCard("Purchase Value", formatCurrency(totalValue), "total units at cost")}
        ${statCard("Retail Value", formatCurrency(retailValue), "total units at selling price")}
        ${statCard("Low Stock", low, "below reorder level", low ? "negative" : "")}
        ${statCard("Out of Stock", out, "need reordering", out ? "negative" : "")}
      </div>
      <div class="page-toolbar">
        <div class="pill-row" id="inv-filter-pills">
          <button class="pill ${invFilter === "all" ? "active" : ""}" data-filter="all">All</button>
          <button class="pill ${invFilter === "Low Stock" ? "active" : ""}" data-filter="Low Stock">Low Stock</button>
          <button class="pill ${invFilter === "Out of Stock" ? "active" : ""}" data-filter="Out of Stock">Out of Stock</button>
        </div>
      </div>
      <div id="inv-table-wrap"></div>
    `;
    renderOverviewTable();
    document.getElementById("inv-filter-pills").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      invFilter = btn.dataset.filter;
      renderOverview(container);
    });
  }

  function statCard(label, value, sub, subClass) {
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value tabular">${value}</div>${sub ? `<div class="stat-sub ${subClass || ""}">${escapeHtml(sub)}</div>` : ""}</div>`;
  }

  function renderOverviewTable() {
    const wrap = document.getElementById("inv-table-wrap");
    let medicines = Storage.getMedicines();
    if (invFilter !== "all") medicines = medicines.filter((m) => stockStatus(m) === invFilter);

    if (!medicines.length) {
      wrap.innerHTML = Components.emptyState({ title: "Nothing to show", message: "No medicines match this filter." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Medicine</th><th>Category</th><th>Qty</th><th>Reorder Level</th><th>Purchase Value</th><th>Retail Value</th><th>Status</th></tr></thead>
          <tbody>
            ${medicines.map((m) => `
              <tr>
                <td class="cell-strong">${escapeHtml(m.brandName)}<div class="cell-soft" style="font-size:11px;">${escapeHtml(m.genericName)}</div></td>
                <td class="cell-soft">${escapeHtml(m.category)}</td>
                <td class="tabular">${m.quantity}</td>
                <td class="tabular cell-soft">${m.reorderLevel}</td>
                <td class="tabular">${formatCurrency(m.quantity * m.purchasePrice)}</td>
                <td class="tabular">${formatCurrency(m.quantity * m.sellingPrice)}</td>
                <td>${Components.badge(stockStatus(m))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // =======================================================================
  // Batches + stock movements
  // =======================================================================

  let batchTab = "batches";
  let batchFilters = { search: "", bucket: "all" };

  function renderBatches(container) {
    container.innerHTML = `
      <div class="tabs" id="batch-tabs">
        <button class="tab-btn ${batchTab === "batches" ? "active" : ""}" data-tab="batches">Batch Ledger</button>
        <button class="tab-btn ${batchTab === "movements" ? "active" : ""}" data-tab="movements">Stock Movements</button>
      </div>
      <div id="batch-body"></div>
    `;
    paintBatchBody(container);
    document.getElementById("batch-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      batchTab = btn.dataset.tab;
      renderBatches(container);
    });
  }

  function paintBatchBody(container) {
    const body = document.getElementById("batch-body");
    if (batchTab === "batches") {
      body.innerHTML = `
        <div class="page-toolbar">
          <div class="search-input-wrap">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="search" id="batch-search" placeholder="Search by medicine or batch #…" value="${escapeHtml(batchFilters.search)}" />
          </div>
          <select id="batch-bucket-filter" style="max-width:190px;">
            <option value="all">All expiry statuses</option>
            <option>Expired</option><option>Expiring in 30 Days</option><option>Expiring in 60 Days</option><option>Expiring in 90 Days</option><option>Valid</option>
          </select>
          <div class="spacer"></div>
          <button class="btn btn-outline" id="log-movement-btn">Log Stock Movement</button>
        </div>
        <div id="batches-table-wrap"></div>
      `;
      document.getElementById("batch-bucket-filter").value = batchFilters.bucket;
      renderBatchesTable();
      document.getElementById("batch-search").addEventListener("input", Utils.debounce((e) => { batchFilters.search = e.target.value; renderBatchesTable(); }, 200));
      document.getElementById("batch-bucket-filter").addEventListener("change", (e) => { batchFilters.bucket = e.target.value; renderBatchesTable(); });
      document.getElementById("log-movement-btn").addEventListener("click", () => openMovementModal(renderBatchesTable));
    } else {
      body.innerHTML = `<div id="movements-table-wrap"></div>`;
      renderMovementsTable();
    }
  }

  function renderBatchesTable() {
    const wrap = document.getElementById("batches-table-wrap");
    const medicines = Storage.getMedicines();
    const medById = {};
    medicines.forEach((m) => { medById[m.id] = m; });
    let batches = [...Storage.getBatches()];

    const term = batchFilters.search.trim().toLowerCase();
    if (term) batches = batches.filter((b) => b.medicineName.toLowerCase().includes(term) || b.batchNumber.toLowerCase().includes(term));
    if (batchFilters.bucket !== "all") batches = batches.filter((b) => expiryBucket(b.expiryDate) === batchFilters.bucket);

    batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    if (!batches.length) {
      wrap.innerHTML = Components.emptyState({ title: "No batches found", message: "Try a different search or filter." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Medicine</th><th>Batch #</th><th>Mfg Date</th><th>Expiry Date</th><th>Days Left</th><th>Qty</th><th>Status</th></tr></thead>
          <tbody>
            ${batches.map((b) => {
              const bucket = expiryBucket(b.expiryDate);
              const days = daysUntil(b.expiryDate);
              return `
                <tr>
                  <td class="cell-strong">${escapeHtml(b.medicineName)}</td>
                  <td class="mono cell-soft">${escapeHtml(b.batchNumber)}</td>
                  <td class="cell-soft">${formatDate(b.manufacturingDate)}</td>
                  <td class="cell-soft">${formatDate(b.expiryDate)}</td>
                  <td class="tabular">${days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}</td>
                  <td class="tabular">${b.quantity}</td>
                  <td><span class="badge ${expiryBadgeClass(bucket)}">${bucket}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderMovementsTable() {
    const wrap = document.getElementById("movements-table-wrap");
    const movements = [...Storage.getMovements()].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!movements.length) {
      wrap.innerHTML = Components.emptyState({ title: "No stock movements yet", message: "Movements you log will appear here." });
      return;
    }
    const typeBadge = (t) => t === "Purchase" || t === "Return" ? "badge-success" : t === "Sale" ? "badge-info" : t === "Damage" || t === "Expired" ? "badge-danger" : "badge-warning";
    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Medicine</th><th>Batch #</th><th>Type</th><th>Qty</th><th>Reason</th></tr></thead>
          <tbody>
            ${movements.map((m) => `
              <tr>
                <td class="cell-soft">${formatDate(m.date)}</td>
                <td class="cell-strong">${escapeHtml(m.medicineName)}</td>
                <td class="mono cell-soft">${escapeHtml(m.batchNumber || "—")}</td>
                <td><span class="badge ${typeBadge(m.type)}">${escapeHtml(m.type)}</span></td>
                <td class="tabular">${m.quantity}</td>
                <td class="cell-soft">${escapeHtml(m.reason || "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function openMovementModal(onSaved) {
    const medicines = Storage.getMedicines();
    Components.openModal({
      title: "Log Stock Movement",
      bodyHTML: `
        <form id="movement-form">
          <div class="field"><label for="mv-medicine">Medicine</label>
            <select id="mv-medicine">${medicines.map((m) => `<option value="${m.id}">${escapeHtml(m.brandName)} (${m.quantity} in stock)</option>`).join("")}</select>
          </div>
          <div class="field"><label for="mv-batch">Batch</label><select id="mv-batch"></select></div>
          <div class="field-row">
            <div class="field"><label for="mv-type">Type</label><select id="mv-type">${MOVEMENT_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
            <div class="field"><label for="mv-qty">Quantity</label><input id="mv-qty" type="number" min="1" step="1" value="1" /></div>
          </div>
          <div class="field"><label for="mv-reason">Reason</label><input id="mv-reason" placeholder="e.g. Customer return, unopened" /></div>
          <div class="field"><label for="mv-notes">Notes (optional)</label><textarea id="mv-notes" rows="2"></textarea></div>
          <p class="field-hint">Return adds to stock. Damage, Adjustment and Expired remove from stock.</p>
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="movement-save-btn">Save Movement</button>`,
      onOpen: (root) => {
        const medSelect = root.querySelector("#mv-medicine");
        const batchSelect = root.querySelector("#mv-batch");
        const populateBatches = () => {
          const batches = Storage.getBatches().filter((b) => b.medicineId === medSelect.value);
          batchSelect.innerHTML = batches.map((b) => `<option value="${b.id}">${escapeHtml(b.batchNumber)} · ${b.quantity} left · exp ${formatDate(b.expiryDate)}</option>`).join("") || `<option value="">No batches available</option>`;
        };
        populateBatches();
        medSelect.addEventListener("change", populateBatches);
        root.querySelector("#movement-save-btn").addEventListener("click", () => saveMovement(onSaved));
      }
    });
  }

  function saveMovement(onSaved) {
    const medicineId = document.getElementById("mv-medicine").value;
    const batchId = document.getElementById("mv-batch").value;
    const type = document.getElementById("mv-type").value;
    const qty = parseInt(document.getElementById("mv-qty").value, 10) || 0;
    const reason = document.getElementById("mv-reason").value.trim();
    const notes = document.getElementById("mv-notes").value.trim();
    if (!batchId) { Components.toast("This medicine has no batches to adjust.", "error"); return; }
    if (qty <= 0) { Components.toast("Quantity must be greater than zero.", "error"); return; }

    const batches = Storage.getBatches();
    const batch = batches.find((b) => b.id === batchId);
    const medicines = Storage.getMedicines();
    const med = medicines.find((m) => m.id === medicineId);
    const isAddition = type === "Return";
    if (!isAddition && qty > batch.quantity) { Components.toast(`Only ${batch.quantity} units available in this batch.`, "error"); return; }

    batch.quantity = isAddition ? batch.quantity + qty : batch.quantity - qty;
    Storage.saveBatches(batches);
    recomputeMedicineStock(medicineId);

    const movements = Storage.getMovements();
    movements.push({
      id: Utils.nextId("MOV", "nextMovementSeq", 5),
      medicineId, medicineName: med.brandName, batchId, batchNumber: batch.batchNumber,
      type, quantity: qty, date: new Date().toISOString().slice(0, 10), reason, notes
    });
    Storage.saveMovements(movements);

    Components.closeModal();
    Components.toast("Stock movement recorded.", "success");
    if (typeof onSaved === "function") onSaved();
  }

  // =======================================================================
  // Expiry dashboard
  // =======================================================================

  let expiryFilter = "all";

  function renderExpiry(container) {
    const batches = Storage.getBatches();
    const buckets = ["Expired", "Expiring in 30 Days", "Expiring in 60 Days", "Expiring in 90 Days", "Valid"];
    const counts = {};
    buckets.forEach((b) => { counts[b] = batches.filter((batch) => expiryBucket(batch.expiryDate) === b).length; });

    container.innerHTML = `
      <div class="expiry-strip">
        <button class="pill ${expiryFilter === "all" ? "active" : ""}" data-bucket="all">All (${batches.length})</button>
        ${buckets.map((b) => `<button class="pill ${expiryFilter === b ? "active" : ""}" data-bucket="${b}">${b} (${counts[b]})</button>`).join("")}
      </div>
      <div id="expiry-table-wrap"></div>
    `;
    renderExpiryTable();
    container.querySelector(".expiry-strip").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bucket]");
      if (!btn) return;
      expiryFilter = btn.dataset.bucket;
      renderExpiry(container);
    });
  }

  function renderExpiryTable() {
    const wrap = document.getElementById("expiry-table-wrap");
    let batches = [...Storage.getBatches()];
    if (expiryFilter !== "all") batches = batches.filter((b) => expiryBucket(b.expiryDate) === expiryFilter);
    batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    if (!batches.length) {
      wrap.innerHTML = Components.emptyState({ title: "Nothing in this category", message: "No batches match this expiry status." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Medicine</th><th>Batch #</th><th>Expiry Date</th><th>Days</th><th>Qty</th><th>Value at Cost</th><th>Status</th></tr></thead>
          <tbody>
            ${batches.map((b) => {
              const med = Storage.getMedicines().find((m) => m.id === b.medicineId);
              const bucket = expiryBucket(b.expiryDate);
              const days = daysUntil(b.expiryDate);
              return `
                <tr>
                  <td class="cell-strong">${escapeHtml(b.medicineName)}</td>
                  <td class="mono cell-soft">${escapeHtml(b.batchNumber)}</td>
                  <td class="cell-soft">${formatDate(b.expiryDate)}</td>
                  <td class="tabular ${days < 0 ? "expiry-expired" : ""}">${days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}</td>
                  <td class="tabular">${b.quantity}</td>
                  <td class="tabular">${formatCurrency(b.quantity * (med ? med.purchasePrice : b.purchasePrice))}</td>
                  <td><span class="badge ${expiryBadgeClass(bucket)}">${bucket}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // =======================================================================
  // Purchasing (receiving stock)
  // =======================================================================

  let purchaseFilters = { search: "" };
  let purchaseLineCounter = 0;

  function renderPurchases(container) {
    container.innerHTML = `
      <div class="page-toolbar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="purchase-search" placeholder="Search by supplier or purchase #…" value="${escapeHtml(purchaseFilters.search)}" />
        </div>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="new-purchase-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>
          New Purchase
        </button>
      </div>
      <div id="purchase-table-wrap"></div>
    `;
    renderPurchaseTable();
    document.getElementById("purchase-search").addEventListener("input", Utils.debounce((e) => { purchaseFilters.search = e.target.value; renderPurchaseTable(); }, 200));
    document.getElementById("new-purchase-btn").addEventListener("click", () => openPurchaseModal());
  }

  function renderPurchaseTable() {
    const wrap = document.getElementById("purchase-table-wrap");
    let purchases = [...Storage.getPurchases()].sort((a, b) => new Date(b.date) - new Date(a.date));
    const term = purchaseFilters.search.trim().toLowerCase();
    if (term) purchases = purchases.filter((p) => p.supplierName.toLowerCase().includes(term) || p.id.toLowerCase().includes(term));

    if (!purchases.length) {
      wrap.innerHTML = Components.emptyState({ title: "No purchases found", message: "Try a different search, or create a new purchase." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Purchase #</th><th>Supplier</th><th>Date</th><th>Items</th><th>Total Value</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${purchases.map((p) => `
              <tr>
                <td class="cell-strong">${escapeHtml(p.id)}</td>
                <td>${escapeHtml(p.supplierName)}</td>
                <td class="cell-soft">${formatDate(p.date)}</td>
                <td class="tabular">${p.items.length}</td>
                <td class="tabular">${formatCurrency(p.totalValue)}</td>
                <td>${Components.badge(p.status)}</td>
                <td class="row-actions"><button class="btn btn-outline btn-sm" data-view="${p.id}">View</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewPurchase(b.dataset.view)));
  }

  function openPurchaseModal() {
    const suppliers = Storage.getSuppliers();
    const medicines = Storage.getMedicines();
    purchaseLineCounter = 1;

    Components.openModal({
      title: "New Purchase",
      size: "xl",
      bodyHTML: `
        <form id="purchase-form">
          <div class="field"><label for="pf-supplier">Supplier</label>
            <select id="pf-supplier">${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
          </div>
          <label>Items received</label>
          <div id="purchase-line-items">${purchaseLineRow(0, medicines)}</div>
          <button type="button" class="btn btn-ghost btn-sm mt-8" id="add-purchase-line-btn">+ Add item</button>
          <div class="card mt-16" style="background:var(--color-surface-alt);">
            <div id="purchase-live-total" style="font-weight:700; font-size:15px;">Total: ${formatCurrency(0)}</div>
          </div>
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="purchase-save-btn">Receive Purchase</button>`,
      onOpen: (root) => {
        wirePurchaseLines(root, medicines);
        root.querySelector("#add-purchase-line-btn").addEventListener("click", () => {
          const div = document.createElement("div");
          div.innerHTML = purchaseLineRow(purchaseLineCounter++, medicines);
          root.querySelector("#purchase-line-items").appendChild(div.firstElementChild);
          wirePurchaseLines(root, medicines);
          updatePurchaseLiveTotal(root);
        });
        root.querySelector("#purchase-save-btn").addEventListener("click", () => savePurchaseFromModal(root));
      }
    });
  }

  function purchaseLineRow(idx, medicines) {
    const defaultMed = medicines[0];
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return `
      <div class="card mb-16" data-line-item="${idx}" style="background:var(--color-surface-alt);">
        <div class="field-row">
          <div class="field"><label>Medicine</label>
            <select class="line-medicine">${medicines.map((m) => `<option value="${m.id}" data-cost="${m.purchasePrice}" data-price="${m.sellingPrice}">${escapeHtml(m.brandName)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Batch number</label><input class="line-batch" value="B${String(Date.now()).slice(-6)}${idx}" /></div>
        </div>
        <div class="field-row-3">
          <div class="field"><label>Quantity</label><input type="number" class="line-qty" min="1" step="1" value="50" /></div>
          <div class="field"><label>Purchase price</label><input type="number" class="line-cost" min="0" step="0.01" value="${defaultMed ? defaultMed.purchasePrice : 0}" /></div>
          <div class="field"><label>Selling price</label><input type="number" class="line-price" min="0" step="0.01" value="${defaultMed ? defaultMed.sellingPrice : 0}" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Manufacturing date</label><input type="date" class="line-mfg" value="${today}" /></div>
          <div class="field"><label>Expiry date</label><input type="date" class="line-expiry" value="${nextYear.toISOString().slice(0, 10)}" /></div>
        </div>
        <button type="button" class="btn btn-danger btn-sm remove-line-btn">Remove item</button>
      </div>
    `;
  }

  function wirePurchaseLines(root, medicines) {
    root.querySelectorAll(".line-medicine").forEach((sel) => {
      sel.onchange = () => {
        const row = sel.closest("[data-line-item]");
        const opt = sel.options[sel.selectedIndex];
        row.querySelector(".line-cost").value = opt.dataset.cost;
        row.querySelector(".line-price").value = opt.dataset.price;
        updatePurchaseLiveTotal(root);
      };
    });
    root.querySelectorAll(".line-qty, .line-cost").forEach((inp) => { inp.oninput = () => updatePurchaseLiveTotal(root); });
    root.querySelectorAll(".remove-line-btn").forEach((btn) => {
      btn.onclick = () => {
        const rows = root.querySelectorAll("[data-line-item]");
        if (rows.length <= 1) { Components.toast("A purchase needs at least one item.", "error"); return; }
        btn.closest("[data-line-item]").remove();
        updatePurchaseLiveTotal(root);
      };
    });
  }

  function readPurchaseLines(root, medicines) {
    return [...root.querySelectorAll("[data-line-item]")].map((row) => {
      const medicineId = row.querySelector(".line-medicine").value;
      const med = medicines.find((m) => m.id === medicineId);
      return {
        medicineId,
        medicineName: med ? med.brandName : "",
        batchNumber: row.querySelector(".line-batch").value.trim(),
        quantity: parseInt(row.querySelector(".line-qty").value, 10) || 0,
        purchasePrice: parseFloat(row.querySelector(".line-cost").value) || 0,
        sellingPrice: parseFloat(row.querySelector(".line-price").value) || 0,
        manufacturingDate: row.querySelector(".line-mfg").value,
        expiryDate: row.querySelector(".line-expiry").value
      };
    });
  }

  function updatePurchaseLiveTotal(root) {
    const medicines = Storage.getMedicines();
    const lines = readPurchaseLines(root, medicines);
    const total = round2(lines.reduce((s, l) => s + l.quantity * l.purchasePrice, 0));
    root.querySelector("#purchase-live-total").textContent = `Total: ${formatCurrency(total)}`;
    return total;
  }

  function savePurchaseFromModal(root) {
    const suppliers = Storage.getSuppliers();
    const medicines = Storage.getMedicines();
    const supplierId = document.getElementById("pf-supplier").value;
    const supplier = suppliers.find((s) => s.id === supplierId);
    const lines = readPurchaseLines(root, medicines);
    if (!lines.length || lines.some((l) => !l.medicineId || l.quantity <= 0)) { Components.toast("Add at least one valid item with a quantity.", "error"); return; }

    const batches = Storage.getBatches();
    const movements = Storage.getMovements();
    const purchaseDate = new Date().toISOString().slice(0, 10);
    let totalValue = 0;
    const items = [];

    lines.forEach((line) => {
      const batchId = Utils.nextId("BAT", "nextBatchSeq", 5);
      batches.push({
        id: batchId, batchNumber: line.batchNumber || batchId, medicineId: line.medicineId, medicineName: line.medicineName,
        manufacturingDate: line.manufacturingDate, expiryDate: line.expiryDate, quantity: line.quantity,
        purchasePrice: line.purchasePrice, sellingPrice: line.sellingPrice
      });
      movements.push({
        id: Utils.nextId("MOV", "nextMovementSeq", 5),
        medicineId: line.medicineId, medicineName: line.medicineName, batchId, batchNumber: line.batchNumber || batchId,
        type: "Purchase", quantity: line.quantity, date: purchaseDate, reason: `Received from ${supplier.name}`, notes: ""
      });
      const lineTotal = round2(line.quantity * line.purchasePrice);
      totalValue += lineTotal;
      items.push(Object.assign({ batchId, lineTotal }, line));

      const med = medicines.find((m) => m.id === line.medicineId);
      if (med) {
        med.purchasePrice = line.purchasePrice;
        med.sellingPrice = line.sellingPrice;
      }
    });

    Storage.saveBatches(batches);
    Storage.saveMovements(movements);
    Storage.saveMedicines(medicines);
    lines.forEach((l) => recomputeMedicineStock(l.medicineId));

    const purchases = Storage.getPurchases();
    const purchase = {
      id: Utils.nextId("PUR", "nextPurchaseSeq"),
      supplierId, supplierName: supplier.name, date: purchaseDate,
      items, totalValue: round2(totalValue), status: "Received"
    };
    purchases.push(purchase);
    Storage.savePurchases(purchases);

    Components.closeModal();
    Components.toast(`Purchase ${purchase.id} received — inventory updated.`, "success");
    if (document.getElementById("purchase-table-wrap")) renderPurchaseTable();
  }

  function viewPurchase(purchaseId) {
    const purchase = Storage.getPurchases().find((p) => p.id === purchaseId);
    Components.openModal({
      title: `Purchase ${purchase.id}`,
      size: "lg",
      bodyHTML: `
        <div class="grid grid-2 mb-16">
          <div><label>Supplier</label><p>${escapeHtml(purchase.supplierName)}</p></div>
          <div><label>Date</label><p>${formatDate(purchase.date)}</p></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Medicine</th><th>Batch #</th><th>Qty</th><th>Expiry</th><th>Cost/unit</th><th>Line Total</th></tr></thead>
            <tbody>${purchase.items.map((it) => `<tr><td class="cell-strong">${escapeHtml(it.medicineName)}</td><td class="mono cell-soft">${escapeHtml(it.batchNumber)}</td><td class="tabular">${it.quantity}</td><td class="cell-soft">${formatDate(it.expiryDate)}</td><td class="tabular">${formatCurrency(it.purchasePrice)}</td><td class="tabular">${formatCurrency(it.lineTotal)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="mt-16" style="text-align:right; font-weight:700;">Total: ${formatCurrency(purchase.totalValue)}</div>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Close</button>`
    });
  }

  global.Inventory = { renderOverview, renderBatches, renderExpiry, renderPurchases, recomputeMedicineStock };
})(window);
