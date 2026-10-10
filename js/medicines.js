/**
 * medicines.js
 * The medicine catalog: master records for brand/generic name, category,
 * dosage form, pricing defaults, reorder level and prescription flag.
 * Actual stock quantities live on batches (see inventory.js) and are
 * kept in sync on this record whenever a batch changes.
 */
(function (global) {
  "use strict";

  const { formatCurrency, escapeHtml, stockStatus } = Utils;

  const DOSAGE_FORMS = ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Ointment", "Drops", "Inhaler", "Suspension", "Spray", "Other"];

  let filters = { search: "", category: "all", status: "all", sort: "name-asc" };

  function renderList(container) {
    const categories = Storage.getCategories();
    container.innerHTML = `
      <div class="page-toolbar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="med-search" placeholder="Search brand, generic, SKU or barcode…" value="${escapeHtml(filters.search)}" />
        </div>
        <select id="med-category-filter" style="max-width:190px;">
          <option value="all">All categories</option>
          ${categories.map((c) => `<option value="${escapeHtml(c.name)}" ${filters.category === c.name ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <select id="med-status-filter" style="max-width:160px;">
          <option value="all">All stock levels</option>
          <option>In Stock</option><option>Low Stock</option><option>Out of Stock</option>
        </select>
        <select id="med-sort" style="max-width:180px;">
          <option value="name-asc">Brand (A–Z)</option>
          <option value="name-desc">Brand (Z–A)</option>
          <option value="qty-asc">Quantity (low–high)</option>
          <option value="qty-desc">Quantity (high–low)</option>
          <option value="price-asc">Price (low–high)</option>
          <option value="price-desc">Price (high–low)</option>
        </select>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="add-medicine-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>
          Add Medicine
        </button>
      </div>
      <div id="med-table-wrap"></div>
    `;
    document.getElementById("med-category-filter").value = filters.category;
    document.getElementById("med-status-filter").value = filters.status;
    document.getElementById("med-sort").value = filters.sort;

    renderTable();

    document.getElementById("med-search").addEventListener("input", Utils.debounce((e) => { filters.search = e.target.value; renderTable(); }, 200));
    document.getElementById("med-category-filter").addEventListener("change", (e) => { filters.category = e.target.value; renderTable(); });
    document.getElementById("med-status-filter").addEventListener("change", (e) => { filters.status = e.target.value; renderTable(); });
    document.getElementById("med-sort").addEventListener("change", (e) => { filters.sort = e.target.value; renderTable(); });
    document.getElementById("add-medicine-btn").addEventListener("click", () => openModal());
  }

  function renderTable() {
    const wrap = document.getElementById("med-table-wrap");
    let meds = Storage.getMedicines();
    const term = filters.search.trim().toLowerCase();
    if (term) meds = meds.filter((m) => m.brandName.toLowerCase().includes(term) || m.genericName.toLowerCase().includes(term) || m.sku.toLowerCase().includes(term) || m.barcode.includes(term));
    if (filters.category !== "all") meds = meds.filter((m) => m.category === filters.category);
    if (filters.status !== "all") meds = meds.filter((m) => stockStatus(m) === filters.status);

    const [field, dir] = filters.sort.split("-");
    meds = [...meds].sort((a, b) => {
      let cmp = 0;
      if (field === "name") cmp = a.brandName.localeCompare(b.brandName);
      if (field === "qty") cmp = a.quantity - b.quantity;
      if (field === "price") cmp = a.sellingPrice - b.sellingPrice;
      return dir === "desc" ? -cmp : cmp;
    });

    if (!meds.length) {
      wrap.innerHTML = Components.emptyState({ title: "No medicines found", message: "Try adjusting your search or filters, or add a new medicine." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Brand / Generic</th><th>SKU</th><th>Category</th><th>Form</th><th>Price</th><th>Qty</th><th>Rx</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${meds.map((m) => `
              <tr>
                <td>
                  <div class="cell-strong">${escapeHtml(m.brandName)}</div>
                  <div class="cell-soft" style="font-size:11.5px;">${escapeHtml(m.genericName)} · ${escapeHtml(m.strength)}</div>
                </td>
                <td class="mono cell-soft">${escapeHtml(m.sku)}</td>
                <td>${escapeHtml(m.category)}</td>
                <td class="cell-soft">${escapeHtml(m.dosageForm)}</td>
                <td class="tabular">${formatCurrency(m.sellingPrice)}</td>
                <td class="tabular">${m.quantity}</td>
                <td>${m.prescriptionRequired ? '<span class="badge badge-rx">Rx</span>' : '<span class="cell-soft">OTC</span>'}</td>
                <td>${Components.badge(stockStatus(m))}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-edit="${m.id}" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Z"/></svg></button>
                  <button class="icon-btn danger" data-delete="${m.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.edit)));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteMedicine(b.dataset.delete)));
  }

  function openModal(medicineId) {
    const isEdit = !!medicineId;
    const med = isEdit ? Storage.getMedicines().find((m) => m.id === medicineId) : null;
    const categories = Storage.getCategories();
    const suppliers = Storage.getSuppliers();

    Components.openModal({
      title: isEdit ? "Edit Medicine" : "Add Medicine",
      size: "lg",
      bodyHTML: `
        <form id="med-form">
          <div class="field-row">
            <div class="field"><label for="mf-brand">Brand name</label><input id="mf-brand" required value="${escapeHtml(med?.brandName || "")}" /></div>
            <div class="field"><label for="mf-generic">Generic name</label><input id="mf-generic" required value="${escapeHtml(med?.genericName || "")}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="mf-sku">SKU</label><input id="mf-sku" required value="${escapeHtml(med?.sku || "")}" /></div>
            <div class="field"><label for="mf-barcode">Barcode</label><input id="mf-barcode" value="${escapeHtml(med?.barcode || "")}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="mf-category">Category</label>
              <select id="mf-category">${categories.map((c) => `<option ${med?.category === c.name ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
            </div>
            <div class="field"><label for="mf-form">Dosage form</label>
              <select id="mf-form">${DOSAGE_FORMS.map((f) => `<option ${med?.dosageForm === f ? "selected" : ""}>${f}</option>`).join("")}</select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label for="mf-strength">Strength</label><input id="mf-strength" placeholder="e.g. 500mg" value="${escapeHtml(med?.strength || "")}" /></div>
            <div class="field"><label for="mf-unit">Unit / pack</label><input id="mf-unit" placeholder="e.g. strip of 10" value="${escapeHtml(med?.unit || "")}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="mf-manufacturer">Manufacturer</label><input id="mf-manufacturer" value="${escapeHtml(med?.manufacturer || "")}" /></div>
            <div class="field"><label for="mf-supplier">Supplier</label>
              <select id="mf-supplier">${suppliers.map((s) => `<option value="${s.id}" ${med?.supplier === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label for="mf-cost">Purchase price</label><input id="mf-cost" type="number" min="0" step="0.01" value="${med?.purchasePrice ?? ""}" /></div>
            <div class="field"><label for="mf-price">Selling price</label><input id="mf-price" type="number" min="0" step="0.01" required value="${med?.sellingPrice ?? ""}" /></div>
          </div>
          <div class="field"><label for="mf-reorder">Reorder level</label><input id="mf-reorder" type="number" min="0" step="1" value="${med?.reorderLevel ?? 20}" /></div>
          <div class="field checkbox-field"><input type="checkbox" id="mf-rx" ${med?.prescriptionRequired ? "checked" : ""} /><label for="mf-rx" style="margin:0;">Prescription required</label></div>
          <div class="field"><label for="mf-desc">Description</label><textarea id="mf-desc" rows="2">${escapeHtml(med?.description || "")}</textarea></div>
          ${!isEdit ? `<p class="field-hint">New medicines start with zero stock — add a batch from Purchases or Batches to bring in inventory.</p>` : ""}
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="med-save-btn">${isEdit ? "Save Changes" : "Add Medicine"}</button>`,
      onOpen: () => document.getElementById("med-save-btn").addEventListener("click", () => saveFromModal(medicineId))
    });
  }

  function saveFromModal(medicineId) {
    const val = (id) => document.getElementById(id).value.trim();
    const brandName = val("mf-brand");
    const genericName = val("mf-generic");
    const sku = val("mf-sku");
    if (!brandName || !genericName || !sku) { Components.toast("Brand name, generic name and SKU are required.", "error"); return; }

    const medicines = Storage.getMedicines();
    const categories = Storage.getCategories();
    const category = val("mf-category");
    const catObj = categories.find((c) => c.name === category);
    const data = {
      brandName, genericName, sku,
      barcode: val("mf-barcode"),
      category, categoryId: catObj ? catObj.id : "",
      dosageForm: val("mf-form"),
      strength: val("mf-strength"),
      unit: val("mf-unit") || "unit",
      manufacturer: val("mf-manufacturer"),
      supplier: val("mf-supplier"),
      purchasePrice: parseFloat(val("mf-cost")) || 0,
      sellingPrice: parseFloat(val("mf-price")) || 0,
      reorderLevel: parseInt(val("mf-reorder"), 10) || 0,
      prescriptionRequired: document.getElementById("mf-rx").checked,
      description: val("mf-desc")
    };

    if (medicineId) {
      const idx = medicines.findIndex((m) => m.id === medicineId);
      medicines[idx] = Object.assign({}, medicines[idx], data);
      medicines[idx].status = stockStatus(medicines[idx]);
    } else {
      const id = Utils.nextId("MED", "nextMedicineSeq");
      medicines.push(Object.assign({ id, quantity: 0, status: "Out of Stock" }, data));
    }
    Storage.saveMedicines(medicines);
    Components.closeModal();
    Components.toast(`Medicine ${medicineId ? "updated" : "added"}.`, "success");
    renderTable();
  }

  async function deleteMedicine(medicineId) {
    const ok = await Components.confirmDialog({ title: "Delete medicine?", message: "This removes the medicine and its batch history permanently.", confirmText: "Delete", danger: true });
    if (!ok) return;
    Storage.saveMedicines(Storage.getMedicines().filter((m) => m.id !== medicineId));
    Storage.saveBatches(Storage.getBatches().filter((b) => b.medicineId !== medicineId));
    Components.toast("Medicine deleted.", "success");
    renderTable();
  }

  global.Medicines = { renderList, openModal, DOSAGE_FORMS };
})(window);
