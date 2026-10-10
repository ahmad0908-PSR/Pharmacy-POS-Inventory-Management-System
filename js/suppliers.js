/**
 * suppliers.js
 * Supplier CRUD, with a quick view of medicines and recent purchases
 * linked to each supplier.
 */
(function (global) {
  "use strict";

  const { formatCurrency, formatDate, escapeHtml } = Utils;

  let search = "";

  function renderList(container) {
    container.innerHTML = `
      <div class="page-toolbar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="sup-search" placeholder="Search suppliers…" value="${escapeHtml(search)}" />
        </div>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="add-sup-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>
          Add Supplier
        </button>
      </div>
      <div id="sup-table-wrap"></div>
    `;
    renderTable();
    document.getElementById("sup-search").addEventListener("input", Utils.debounce((e) => { search = e.target.value; renderTable(); }, 200));
    document.getElementById("add-sup-btn").addEventListener("click", () => openModal());
  }

  function renderTable() {
    const wrap = document.getElementById("sup-table-wrap");
    let suppliers = Storage.getSuppliers();
    const term = search.trim().toLowerCase();
    if (term) suppliers = suppliers.filter((s) => s.name.toLowerCase().includes(term) || (s.contactPerson || "").toLowerCase().includes(term));

    if (!suppliers.length) {
      wrap.innerHTML = Components.emptyState({ title: "No suppliers found", message: "Try a different search, or add a new supplier." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Products Supplied</th><th></th></tr></thead>
          <tbody>
            ${suppliers.map((s) => `
              <tr>
                <td class="cell-strong">${escapeHtml(s.name)}</td>
                <td class="cell-soft">${escapeHtml(s.contactPerson || "—")}</td>
                <td class="cell-soft">${escapeHtml(s.phone || "—")}</td>
                <td class="cell-soft">${escapeHtml(s.productsSupplied || "—")}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-view="${s.id}" aria-label="View"><svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>
                  <button class="icon-btn" data-edit="${s.id}" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Z"/></svg></button>
                  <button class="icon-btn danger" data-delete="${s.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewDetails(b.dataset.view)));
    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.edit)));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteSupplier(b.dataset.delete)));
  }

  function viewDetails(supplierId) {
    const supplier = Storage.getSuppliers().find((s) => s.id === supplierId);
    const medicines = Storage.getMedicines().filter((m) => m.supplier === supplierId);
    const purchases = Storage.getPurchases().filter((p) => p.supplierId === supplierId).sort((a, b) => new Date(b.date) - new Date(a.date));
    Components.openModal({
      title: supplier.name,
      size: "lg",
      bodyHTML: `
        <div class="grid grid-2 mb-16">
          <div><label>Contact person</label><p>${escapeHtml(supplier.contactPerson || "—")}</p></div>
          <div><label>Phone</label><p>${escapeHtml(supplier.phone || "—")}</p></div>
          <div><label>Email</label><p>${escapeHtml(supplier.email || "—")}</p></div>
          <div><label>Address</label><p>${escapeHtml(supplier.address || "—")}</p></div>
        </div>
        <h4 style="font-size:13.5px; margin-bottom:8px;">Medicines Supplied (${medicines.length})</h4>
        <p class="text-soft mb-16">${medicines.slice(0, 8).map((m) => escapeHtml(m.brandName)).join(", ") || "None yet"}${medicines.length > 8 ? "…" : ""}</p>
        <h4 style="font-size:13.5px; margin-bottom:8px;">Recent Purchases</h4>
        ${purchases.length ? `
          <div class="table-wrap"><table><thead><tr><th>Purchase #</th><th>Date</th><th>Total</th></tr></thead>
            <tbody>${purchases.slice(0, 6).map((p) => `<tr><td>${escapeHtml(p.id)}</td><td class="cell-soft">${formatDate(p.date)}</td><td class="tabular">${formatCurrency(p.totalValue)}</td></tr>`).join("")}</tbody>
          </table></div>
        ` : Components.emptyState({ title: "No purchases yet", message: "No purchases have been recorded from this supplier." })}
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Close</button>`
    });
  }

  function openModal(supplierId) {
    const supplier = supplierId ? Storage.getSuppliers().find((s) => s.id === supplierId) : null;
    Components.openModal({
      title: supplierId ? "Edit Supplier" : "Add Supplier",
      bodyHTML: `
        <form id="sup-form">
          <div class="field"><label for="sf-name">Supplier name</label><input id="sf-name" required value="${escapeHtml(supplier?.name || "")}" /></div>
          <div class="field-row">
            <div class="field"><label for="sf-contact">Contact person</label><input id="sf-contact" value="${escapeHtml(supplier?.contactPerson || "")}" /></div>
            <div class="field"><label for="sf-phone">Phone</label><input id="sf-phone" value="${escapeHtml(supplier?.phone || "")}" /></div>
          </div>
          <div class="field"><label for="sf-email">Email</label><input id="sf-email" type="email" value="${escapeHtml(supplier?.email || "")}" /></div>
          <div class="field"><label for="sf-address">Address</label><input id="sf-address" value="${escapeHtml(supplier?.address || "")}" /></div>
          <div class="field"><label for="sf-products">Products supplied</label><input id="sf-products" value="${escapeHtml(supplier?.productsSupplied || "")}" /></div>
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="sup-save-btn">${supplierId ? "Save Changes" : "Add Supplier"}</button>`,
      onOpen: () => document.getElementById("sup-save-btn").addEventListener("click", () => saveFromModal(supplierId))
    });
  }

  function saveFromModal(supplierId) {
    const name = document.getElementById("sf-name").value.trim();
    if (!name) { Components.toast("Supplier name is required.", "error"); return; }
    const suppliers = Storage.getSuppliers();
    const data = {
      name,
      contactPerson: document.getElementById("sf-contact").value.trim(),
      phone: document.getElementById("sf-phone").value.trim(),
      email: document.getElementById("sf-email").value.trim(),
      address: document.getElementById("sf-address").value.trim(),
      productsSupplied: document.getElementById("sf-products").value.trim()
    };
    if (supplierId) {
      const idx = suppliers.findIndex((s) => s.id === supplierId);
      suppliers[idx] = Object.assign({}, suppliers[idx], data);
    } else {
      suppliers.push(Object.assign({ id: Utils.nextId("SUP", "nextSupplierSeq") }, data));
    }
    Storage.saveSuppliers(suppliers);
    Components.closeModal();
    Components.toast(`Supplier ${supplierId ? "updated" : "added"}.`, "success");
    renderTable();
  }

  async function deleteSupplier(supplierId) {
    const ok = await Components.confirmDialog({ title: "Delete supplier?", message: "This removes the supplier record.", confirmText: "Delete", danger: true });
    if (!ok) return;
    Storage.saveSuppliers(Storage.getSuppliers().filter((s) => s.id !== supplierId));
    Components.toast("Supplier deleted.", "success");
    renderTable();
  }

  global.Suppliers = { renderList };
})(window);
