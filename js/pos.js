/**
 * pos.js
 * The point-of-sale screen: product search/filter, a running cart, and
 * sale completion. Selling a medicine deducts stock FEFO (first-expiry,
 * first-out) across its batches via inventory.js, and logs a Sale
 * movement per batch touched.
 */
(function (global) {
  "use strict";

  const { formatCurrency, formatDateTime, escapeHtml, round2 } = Utils;

  let cart = []; // { medicineId, name, genericName, sku, unitPrice, quantity, maxQty }
  let posSelectedCategory = "all";
  let posSearchTerm = "";
  let posSelectedCustomerId = "CUS-01";
  let posDiscount = 0;
  let posPaymentMethod = "Cash";

  function render(container) {
    const medicines = Storage.getMedicines();
    const categories = Storage.getCategories();
    const customers = Storage.getCustomers();
    const cfg = Storage.getConfig();

    container.innerHTML = `
      <div class="pos-layout">
        <div class="pos-catalog">
          <div class="pos-catalog-controls">
            <div class="search-input-wrap" style="flex:1;">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="search" id="pos-search" placeholder="Search brand, generic name or barcode…" value="${escapeHtml(posSearchTerm)}" />
            </div>
          </div>
          <div class="pos-category-pills" id="pos-category-pills">
            <button class="pill ${posSelectedCategory === "all" ? "active" : ""}" data-cat="all">All</button>
            ${categories.map((c) => `<button class="pill ${posSelectedCategory === c.name ? "active" : ""}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`).join("")}
          </div>
          <div class="product-grid" id="pos-product-grid"></div>
        </div>

        <div class="cart-panel">
          <div class="cart-header">
            <div class="flex-between">
              <h3 style="font-size:14.5px;">Current Sale</h3>
              <button class="btn btn-ghost btn-sm" id="pos-clear-cart">Clear</button>
            </div>
            <div class="mt-8">
              <label for="pos-customer">Customer</label>
              <select id="pos-customer">
                ${customers.map((c) => `<option value="${c.id}" ${c.id === posSelectedCustomerId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="cart-items" id="pos-cart-items"></div>
          <div class="cart-summary" id="pos-cart-summary"></div>
          <div class="cart-footer">
            <div>
              <label>Payment Method</label>
              <div class="payment-method-group" id="pos-payment-methods">
                ${["Cash", "Card", "Other"].map((m) => `<button class="pill ${posPaymentMethod === m ? "active" : ""}" data-method="${m}">${m}</button>`).join("")}
              </div>
            </div>
            <div id="pos-cash-row" class="field" style="margin:0; ${posPaymentMethod === "Cash" ? "" : "display:none;"}">
              <label for="pos-cash-received">Cash Received</label>
              <input type="number" id="pos-cash-received" min="0" step="0.01" placeholder="0.00" />
            </div>
            <button class="btn btn-primary btn-block" id="pos-complete-sale">Complete Sale</button>
          </div>
        </div>
      </div>
    `;

    renderGrid(medicines);
    renderCart(cfg);

    document.getElementById("pos-search").addEventListener("input", Utils.debounce((e) => {
      posSearchTerm = e.target.value;
      renderGrid(Storage.getMedicines());
    }, 200));

    document.getElementById("pos-category-pills").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      posSelectedCategory = btn.dataset.cat;
      renderGrid(Storage.getMedicines());
    });

    document.getElementById("pos-product-grid").addEventListener("click", (e) => {
      const card = e.target.closest("[data-medicine-id]");
      if (!card || card.disabled) return;
      addToCart(card.dataset.medicineId);
    });

    document.getElementById("pos-customer").addEventListener("change", (e) => { posSelectedCustomerId = e.target.value; });

    document.getElementById("pos-clear-cart").addEventListener("click", async () => {
      if (!cart.length) return;
      const ok = await Components.confirmDialog({ title: "Clear cart?", message: "This removes every item from the current sale.", confirmText: "Clear cart", danger: true });
      if (ok) { cart = []; renderCart(cfg); }
    });

    document.getElementById("pos-payment-methods").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-method]");
      if (!btn) return;
      posPaymentMethod = btn.dataset.method;
      document.querySelectorAll("#pos-payment-methods .pill").forEach((p) => p.classList.toggle("active", p.dataset.method === posPaymentMethod));
      document.getElementById("pos-cash-row").style.display = posPaymentMethod === "Cash" ? "" : "none";
      updateSummary(cfg);
    });

    document.getElementById("pos-complete-sale").addEventListener("click", () => completeSale(cfg));
  }

  function availableQty(medicineId) {
    const today = new Date().toISOString().slice(0, 10);
    return Storage.getBatches()
      .filter((b) => b.medicineId === medicineId && b.expiryDate >= today)
      .reduce((s, b) => s + b.quantity, 0);
  }

  function renderGrid(medicines) {
    const grid = document.getElementById("pos-product-grid");
    if (!grid) return;
    const term = posSearchTerm.trim().toLowerCase();
    const filtered = medicines.filter((m) => {
      const matchesCat = posSelectedCategory === "all" || m.category === posSelectedCategory;
      const matchesTerm = !term || m.brandName.toLowerCase().includes(term) || m.genericName.toLowerCase().includes(term) || m.barcode.includes(term) || m.sku.toLowerCase().includes(term);
      return matchesCat && matchesTerm;
    });
    if (!filtered.length) {
      grid.innerHTML = Components.emptyState({ title: "No medicines found", message: "Try a different search term or category." });
      return;
    }
    grid.innerHTML = filtered.map((m) => {
      const avail = availableQty(m.id);
      const out = avail <= 0;
      const initials = m.brandName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
      return `
        <button class="product-card ${out ? "out-of-stock" : ""}" data-medicine-id="${m.id}" ${out ? "disabled" : ""}>
          ${m.prescriptionRequired ? '<span class="rx-flag">Rx</span>' : ""}
          <div class="product-card-thumb">${escapeHtml(initials)}</div>
          <div class="product-card-name">${escapeHtml(m.brandName)}</div>
          <div class="product-card-generic">${escapeHtml(m.genericName)} · ${escapeHtml(m.strength)}</div>
          <div class="product-card-meta">
            <span class="product-card-price">${formatCurrency(m.sellingPrice)}</span>
            <span class="product-card-stock">${out ? "Out of stock" : `${avail} left`}</span>
          </div>
        </button>
      `;
    }).join("");
  }

  function addToCart(medicineId) {
    const med = Storage.getMedicines().find((m) => m.id === medicineId);
    const avail = availableQty(medicineId);
    if (!med || avail <= 0) return;
    const existing = cart.find((c) => c.medicineId === medicineId);
    if (existing) {
      if (existing.quantity >= avail) {
        Components.toast(`Only ${avail} of "${med.brandName}" available.`, "error");
        return;
      }
      existing.quantity += 1;
    } else {
      cart.push({ medicineId: med.id, name: med.brandName, genericName: med.genericName, sku: med.sku, unitPrice: med.sellingPrice, quantity: 1, maxQty: avail });
    }
    renderCart(Storage.getConfig());
  }

  function changeQty(medicineId, delta) {
    const item = cart.find((c) => c.medicineId === medicineId);
    if (!item) return;
    const next = item.quantity + delta;
    if (next <= 0) {
      cart = cart.filter((c) => c.medicineId !== medicineId);
    } else if (next > item.maxQty) {
      Components.toast(`Only ${item.maxQty} of "${item.name}" available.`, "error");
      return;
    } else {
      item.quantity = next;
    }
    renderCart(Storage.getConfig());
  }

  function totals(cfg) {
    const subtotal = round2(cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0));
    const discount = round2(Math.min(posDiscount || 0, subtotal));
    const taxable = Math.max(subtotal - discount, 0);
    const tax = round2(taxable * (cfg.taxRate || 0));
    const total = round2(taxable + tax);
    return { subtotal, discount, tax, total };
  }

  function renderCart(cfg) {
    const itemsEl = document.getElementById("pos-cart-items");
    if (!itemsEl) return;
    if (!cart.length) {
      itemsEl.innerHTML = Components.emptyState({ title: "Cart is empty", message: "Tap a medicine on the left to add it to this sale." });
    } else {
      itemsEl.innerHTML = cart.map((c) => `
        <div class="cart-item" data-cart-row="${c.medicineId}">
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(c.name)}</div>
            <div class="cart-item-price">${formatCurrency(c.unitPrice)} each</div>
          </div>
          <div class="qty-stepper">
            <button data-qty-delta="-1" aria-label="Decrease quantity">−</button>
            <span class="tabular">${c.quantity}</span>
            <button data-qty-delta="1" aria-label="Increase quantity">+</button>
          </div>
          <div class="cell-strong tabular" style="width:64px; text-align:right;">${formatCurrency(c.unitPrice * c.quantity)}</div>
          <button class="cart-item-remove" data-remove aria-label="Remove item">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      `).join("");
      itemsEl.querySelectorAll("[data-cart-row]").forEach((row) => {
        const id = row.dataset.cartRow;
        row.querySelector('[data-qty-delta="-1"]').addEventListener("click", () => changeQty(id, -1));
        row.querySelector('[data-qty-delta="1"]').addEventListener("click", () => changeQty(id, 1));
        row.querySelector("[data-remove]").addEventListener("click", () => { cart = cart.filter((c) => c.medicineId !== id); renderCart(cfg); });
      });
    }
    updateSummary(cfg);
  }

  function updateSummary(cfg) {
    const summaryEl = document.getElementById("pos-cart-summary");
    if (!summaryEl) return;
    const { subtotal, discount, tax, total } = totals(cfg);
    summaryEl.innerHTML = `
      <div class="summary-row"><span>Subtotal</span><span class="tabular">${formatCurrency(subtotal)}</span></div>
      <div class="summary-row"><span>Discount</span><input type="number" min="0" step="0.01" class="summary-inline-input tabular" id="pos-discount-input" value="${posDiscount || ""}" placeholder="0.00" /></div>
      <div class="summary-row"><span>Tax (${((cfg.taxRate || 0) * 100).toFixed(2)}%)</span><span class="tabular">${formatCurrency(tax)}</span></div>
      <div class="summary-row total"><span>Total</span><span class="tabular">${formatCurrency(total)}</span></div>
      ${posPaymentMethod === "Cash" ? `<div class="summary-row"><span>Change due</span><span class="tabular" id="pos-change-due">${formatCurrency(0)}</span></div>` : ""}
    `;
    document.getElementById("pos-discount-input").addEventListener("change", (e) => {
      posDiscount = parseFloat(e.target.value) || 0;
      updateSummary(cfg);
    });
    const cashInput = document.getElementById("pos-cash-received");
    if (cashInput) {
      cashInput.addEventListener("input", () => {
        const received = parseFloat(cashInput.value) || 0;
        const changeEl = document.getElementById("pos-change-due");
        if (changeEl) changeEl.textContent = formatCurrency(Math.max(received - total, 0));
      });
    }
  }

  /** Deducts qty from earliest-expiring, non-expired batches for one medicine; logs Sale movements. */
  function sellFromFEFO(medicineId, qtyWanted, saleId) {
    const today = new Date().toISOString().slice(0, 10);
    const batches = Storage.getBatches()
      .filter((b) => b.medicineId === medicineId && b.expiryDate >= today && b.quantity > 0)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    const allBatches = Storage.getBatches();
    const movements = Storage.getMovements();
    let remaining = qtyWanted;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      const target = allBatches.find((b) => b.id === batch.id);
      target.quantity -= take;
      remaining -= take;
      movements.push({
        id: Utils.nextId("MOV", "nextMovementSeq", 5),
        medicineId, medicineName: target.medicineName, batchId: target.id, batchNumber: target.batchNumber,
        type: "Sale", quantity: take, date: today, reason: `Point-of-sale transaction ${saleId}`, notes: ""
      });
    }
    Storage.saveBatches(allBatches);
    Storage.saveMovements(movements);
    Inventory.recomputeMedicineStock(medicineId);
  }

  function completeSale(cfg) {
    if (!cart.length) { Components.toast("Add at least one medicine before completing the sale.", "error"); return; }
    const { subtotal, discount, tax, total } = totals(cfg);
    let cashReceived = null, change = null;
    if (posPaymentMethod === "Cash") {
      cashReceived = parseFloat((document.getElementById("pos-cash-received") || {}).value) || 0;
      if (cashReceived < total) { Components.toast("Cash received is less than the total due.", "error"); return; }
      change = round2(cashReceived - total);
    }
    const customers = Storage.getCustomers();
    const customer = customers.find((c) => c.id === posSelectedCustomerId) || customers[0];
    const saleId = Utils.nextId("SALE", "nextSaleSeq");

    const sale = {
      id: saleId,
      date: new Date().toISOString(),
      customerId: customer.id,
      customerName: customer.name,
      items: cart.map((c) => ({ medicineId: c.medicineId, name: c.name, genericName: c.genericName, sku: c.sku, unitPrice: c.unitPrice, quantity: c.quantity, lineTotal: round2(c.unitPrice * c.quantity) })),
      subtotal, discount, tax, total,
      paymentMethod: posPaymentMethod,
      cashReceived, change,
      status: "Completed"
    };

    cart.forEach((c) => sellFromFEFO(c.medicineId, c.quantity, saleId));

    if (!customer.isGuest) {
      customer.totalPurchases = round2((customer.totalPurchases || 0) + total);
      Storage.saveCustomers(customers);
    }

    const sales = Storage.getSales();
    sales.push(sale);
    Storage.saveSales(sales);

    cart = [];
    posDiscount = 0;
    Components.toast(`Sale ${sale.id} completed.`, "success");
    showReceiptModal(sale);
    render(document.getElementById("app-content"));
  }

  function receiptHTML(sale) {
    const cfg = Storage.getConfig();
    return `
      <div class="receipt" id="print-area">
        <div class="receipt-header">
          <h3>${escapeHtml(cfg.pharmacyName || "")}</h3>
          <div>${escapeHtml(cfg.pharmacyAddress || "")}</div>
          <div>${escapeHtml(cfg.pharmacyPhone || "")}</div>
          ${cfg.receipt && cfg.receipt.showLicenseNumber && cfg.licenseNumber ? `<div>License: ${escapeHtml(cfg.licenseNumber)}</div>` : ""}
        </div>
        <hr />
        <div class="receipt-row"><span>Sale #</span><span>${escapeHtml(sale.id)}</span></div>
        <div class="receipt-row"><span>Date</span><span>${formatDateTime(sale.date)}</span></div>
        <div class="receipt-row"><span>Customer</span><span>${escapeHtml(sale.customerName)}</span></div>
        <hr />
        ${sale.items.map((it) => `
          <div class="receipt-line-item">
            <span>${it.quantity} × ${escapeHtml(it.name)}</span>
            <span>${formatCurrency(it.lineTotal)}</span>
          </div>
        `).join("")}
        <hr />
        <div class="receipt-row"><span>Subtotal</span><span>${formatCurrency(sale.subtotal)}</span></div>
        <div class="receipt-row"><span>Discount</span><span>-${formatCurrency(sale.discount)}</span></div>
        <div class="receipt-row"><span>Tax</span><span>${formatCurrency(sale.tax)}</span></div>
        <div class="receipt-row" style="font-weight:700;"><span>Total</span><span>${formatCurrency(sale.total)}</span></div>
        <div class="receipt-row"><span>Payment</span><span>${escapeHtml(sale.paymentMethod)}</span></div>
        ${sale.cashReceived != null ? `<div class="receipt-row"><span>Cash received</span><span>${formatCurrency(sale.cashReceived)}</span></div><div class="receipt-row"><span>Change</span><span>${formatCurrency(sale.change)}</span></div>` : ""}
        <div class="receipt-footer">${escapeHtml((cfg.receipt && cfg.receipt.footerMessage) || "Thank you!")}</div>
      </div>
    `;
  }

  function showReceiptModal(sale) {
    Components.openModal({
      title: `Receipt · ${sale.id}`,
      bodyHTML: receiptHTML(sale),
      footerHTML: `<button class="btn btn-outline" data-close-modal>Close</button><button class="btn btn-primary" id="print-receipt-btn">Print Receipt</button>`,
      onOpen: (root) => root.querySelector("#print-receipt-btn").addEventListener("click", () => window.print())
    });
  }

  global.POS = { render, showReceiptModal };
})(window);
