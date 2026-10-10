/**
 * customers.js
 * Customer CRUD plus a purchase-history view drawn from Sales.
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
          <input type="search" id="cust-search" placeholder="Search customers…" value="${escapeHtml(search)}" />
        </div>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="add-cust-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>
          Add Customer
        </button>
      </div>
      <div id="cust-table-wrap"></div>
    `;
    renderTable();
    document.getElementById("cust-search").addEventListener("input", Utils.debounce((e) => { search = e.target.value; renderTable(); }, 200));
    document.getElementById("add-cust-btn").addEventListener("click", () => openModal());
  }

  function renderTable() {
    const wrap = document.getElementById("cust-table-wrap");
    let customers = Storage.getCustomers();
    const term = search.trim().toLowerCase();
    if (term) customers = customers.filter((c) => c.name.toLowerCase().includes(term) || (c.phone || "").includes(term) || (c.email || "").toLowerCase().includes(term));

    if (!customers.length) {
      wrap.innerHTML = Components.emptyState({ title: "No customers found", message: "Try a different search, or add a new customer." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Total Purchases</th><th></th></tr></thead>
          <tbody>
            ${customers.map((c) => `
              <tr>
                <td class="cell-strong">${escapeHtml(c.name)}</td>
                <td class="cell-soft">${escapeHtml(c.phone || "—")}</td>
                <td class="cell-soft">${escapeHtml(c.email || "—")}</td>
                <td class="tabular">${formatCurrency(c.totalPurchases || 0)}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-view="${c.id}" aria-label="View"><svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>
                  ${!c.isGuest ? `<button class="icon-btn" data-edit="${c.id}" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Z"/></svg></button>
                  <button class="icon-btn danger" data-delete="${c.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewDetails(b.dataset.view)));
    wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.edit)));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteCustomer(b.dataset.delete)));
  }

  function viewDetails(customerId) {
    const customer = Storage.getCustomers().find((c) => c.id === customerId);
    const sales = Storage.getSales().filter((s) => s.customerId === customerId).sort((a, b) => new Date(b.date) - new Date(a.date));
    Components.openModal({
      title: customer.name,
      size: "lg",
      bodyHTML: `
        <div class="grid grid-2 mb-16">
          <div><label>Phone</label><p>${escapeHtml(customer.phone || "—")}</p></div>
          <div><label>Email</label><p>${escapeHtml(customer.email || "—")}</p></div>
          <div><label>Address</label><p>${escapeHtml(customer.address || "—")}</p></div>
          <div><label>Total Purchases</label><p class="tabular">${formatCurrency(customer.totalPurchases || 0)}</p></div>
        </div>
        <h4 style="font-size:13.5px; margin-bottom:8px;">Purchase History</h4>
        ${sales.length ? `
          <div class="table-wrap">
            <table><thead><tr><th>Date</th><th>Sale #</th><th>Items</th><th>Total</th></tr></thead>
              <tbody>${sales.map((s) => `<tr><td class="cell-soft">${formatDate(s.date)}</td><td>${escapeHtml(s.id)}</td><td>${s.items.reduce((a, i) => a + i.quantity, 0)}</td><td class="tabular">${formatCurrency(s.total)}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        ` : Components.emptyState({ title: "No purchases yet", message: "This customer hasn't made a purchase." })}
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Close</button>`
    });
  }

  function openModal(customerId) {
    const customer = customerId ? Storage.getCustomers().find((c) => c.id === customerId) : null;
    Components.openModal({
      title: customerId ? "Edit Customer" : "Add Customer",
      bodyHTML: `
        <form id="cust-form">
          <div class="field"><label for="cf-name">Full name</label><input id="cf-name" required value="${escapeHtml(customer?.name || "")}" /></div>
          <div class="field-row">
            <div class="field"><label for="cf-phone">Phone</label><input id="cf-phone" value="${escapeHtml(customer?.phone || "")}" /></div>
            <div class="field"><label for="cf-email">Email</label><input id="cf-email" type="email" value="${escapeHtml(customer?.email || "")}" /></div>
          </div>
          <div class="field"><label for="cf-address">Address</label><input id="cf-address" value="${escapeHtml(customer?.address || "")}" /></div>
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="cust-save-btn">${customerId ? "Save Changes" : "Add Customer"}</button>`,
      onOpen: () => document.getElementById("cust-save-btn").addEventListener("click", () => saveFromModal(customerId))
    });
  }

  function saveFromModal(customerId) {
    const name = document.getElementById("cf-name").value.trim();
    if (!name) { Components.toast("Customer name is required.", "error"); return; }
    const customers = Storage.getCustomers();
    const data = {
      name,
      phone: document.getElementById("cf-phone").value.trim(),
      email: document.getElementById("cf-email").value.trim(),
      address: document.getElementById("cf-address").value.trim()
    };
    if (customerId) {
      const idx = customers.findIndex((c) => c.id === customerId);
      customers[idx] = Object.assign({}, customers[idx], data);
    } else {
      customers.push(Object.assign({ id: Utils.nextId("CUS", "nextCustomerSeq"), totalPurchases: 0 }, data));
    }
    Storage.saveCustomers(customers);
    Components.closeModal();
    Components.toast(`Customer ${customerId ? "updated" : "added"}.`, "success");
    renderTable();
  }

  async function deleteCustomer(customerId) {
    const ok = await Components.confirmDialog({ title: "Delete customer?", message: "This removes the customer record. Past sales stay in your history.", confirmText: "Delete", danger: true });
    if (!ok) return;
    Storage.saveCustomers(Storage.getCustomers().filter((c) => c.id !== customerId));
    Components.toast("Customer deleted.", "success");
    renderTable();
  }

  global.Customers = { renderList };
})(window);
