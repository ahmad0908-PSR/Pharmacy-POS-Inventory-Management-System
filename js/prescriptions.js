/**
 * prescriptions.js
 * A demo prescription log: which medicines a prescriber listed for a
 * customer, with free-text dosage instructions entered by staff. This
 * module only records what's on a prescription — it never suggests,
 * validates, or recommends any medicine or dosage.
 */
(function (global) {
  "use strict";

  const { formatDate, escapeHtml } = Utils;

  let search = "";
  let lineCounter = 0;

  function renderList(container) {
    container.innerHTML = `
      <p class="field-hint mb-16">Demo record-keeping only — this module does not verify, validate or recommend medicines or dosages.</p>
      <div class="page-toolbar">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="rx-search" placeholder="Search by customer or prescription #…" value="${escapeHtml(search)}" />
        </div>
        <div class="spacer"></div>
        <button class="btn btn-rx" id="add-rx-btn">
          <svg class="btn-icon" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>
          New Prescription
        </button>
      </div>
      <div id="rx-table-wrap"></div>
    `;
    renderTable();
    document.getElementById("rx-search").addEventListener("input", Utils.debounce((e) => { search = e.target.value; renderTable(); }, 200));
    document.getElementById("add-rx-btn").addEventListener("click", () => openModal());
  }

  function renderTable() {
    const wrap = document.getElementById("rx-table-wrap");
    let prescriptions = [...Storage.getPrescriptions()].sort((a, b) => new Date(b.date) - new Date(a.date));
    const term = search.trim().toLowerCase();
    if (term) prescriptions = prescriptions.filter((p) => p.customerName.toLowerCase().includes(term) || p.prescriptionNumber.toLowerCase().includes(term));

    if (!prescriptions.length) {
      wrap.innerHTML = Components.emptyState({ title: "No prescriptions found", message: "Try a different search, or add a new prescription record." });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Prescription #</th><th>Customer</th><th>Date</th><th>Prescriber</th><th>Medicines</th><th></th></tr></thead>
          <tbody>
            ${prescriptions.map((p) => `
              <tr>
                <td class="mono cell-soft">${escapeHtml(p.prescriptionNumber)}</td>
                <td class="cell-strong">${escapeHtml(p.customerName)}</td>
                <td class="cell-soft">${formatDate(p.date)}</td>
                <td class="cell-soft">${escapeHtml(p.prescriber)}</td>
                <td class="tabular">${p.medicines.length}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-view="${p.id}" aria-label="View"><svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>
                  <button class="icon-btn danger" data-delete="${p.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewPrescription(b.dataset.view)));
    wrap.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deletePrescription(b.dataset.delete)));
  }

  function viewPrescription(rxId) {
    const rx = Storage.getPrescriptions().find((p) => p.id === rxId);
    Components.openModal({
      title: `Prescription · ${rx.prescriptionNumber}`,
      size: "lg",
      bodyHTML: `
        <div class="grid grid-2 mb-16">
          <div><label>Customer</label><p>${escapeHtml(rx.customerName)}</p></div>
          <div><label>Date</label><p>${formatDate(rx.date)}</p></div>
          <div><label>Prescriber</label><p>${escapeHtml(rx.prescriber)}</p></div>
          <div><label>Notes</label><p>${escapeHtml(rx.notes || "—")}</p></div>
        </div>
        <div class="table-wrap">
          <table><thead><tr><th>Medicine</th><th>Generic Name</th><th>Dosage Instructions</th></tr></thead>
            <tbody>${rx.medicines.map((m) => `<tr><td class="cell-strong">${escapeHtml(m.medicineName)}</td><td class="cell-soft">${escapeHtml(m.genericName)}</td><td>${escapeHtml(m.dosageInstructions)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Close</button>`
    });
  }

  function openModal() {
    const customers = Storage.getCustomers().filter((c) => !c.isGuest);
    const medicines = Storage.getMedicines();
    lineCounter = 1;

    Components.openModal({
      title: "New Prescription",
      size: "lg",
      bodyHTML: `
        <form id="rx-form">
          <div class="field-row">
            <div class="field"><label for="rf-customer">Customer</label>
              <select id="rf-customer">${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
            </div>
            <div class="field"><label for="rf-prescriber">Prescriber</label><input id="rf-prescriber" placeholder="e.g. Dr. Jane Smith, MD" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="rf-number">Prescription number</label><input id="rf-number" value="RXN-${Date.now().toString().slice(-8)}" /></div>
            <div class="field"><label for="rf-date">Date</label><input id="rf-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
          </div>
          <label>Medicines</label>
          <div id="rx-line-items">${lineRow(0, medicines)}</div>
          <button type="button" class="btn btn-ghost btn-sm mt-8" id="add-rx-line-btn">+ Add medicine</button>
          <div class="field mt-16"><label for="rf-notes">Notes</label><textarea id="rf-notes" rows="2"></textarea></div>
        </form>
      `,
      footerHTML: `<button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-rx" id="rx-save-btn">Save Prescription</button>`,
      onOpen: (root) => {
        wireLines(root);
        root.querySelector("#add-rx-line-btn").addEventListener("click", () => {
          const div = document.createElement("div");
          div.innerHTML = lineRow(lineCounter++, medicines);
          root.querySelector("#rx-line-items").appendChild(div.firstElementChild);
          wireLines(root);
        });
        root.querySelector("#rx-save-btn").addEventListener("click", () => saveFromModal(root));
      }
    });
  }

  function lineRow(idx, medicines) {
    return `
      <div class="field-row" data-line-item="${idx}" style="align-items:end;">
        <div class="field" style="margin-bottom:8px;"><label>Medicine</label>
          <select class="line-med">${medicines.map((m) => `<option value="${m.id}">${escapeHtml(m.brandName)} (${escapeHtml(m.genericName)})</option>`).join("")}</select>
        </div>
        <div class="field" style="margin-bottom:8px; display:flex; gap:8px;">
          <div style="flex:1;"><label>Dosage instructions</label><input type="text" class="line-dosage" placeholder="As written on the prescription" /></div>
          <button type="button" class="icon-btn danger remove-line-btn" style="margin-top:22px;" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
      </div>
    `;
  }

  function wireLines(root) {
    root.querySelectorAll(".remove-line-btn").forEach((btn) => {
      btn.onclick = () => {
        const rows = root.querySelectorAll("[data-line-item]");
        if (rows.length <= 1) { Components.toast("A prescription needs at least one medicine.", "error"); return; }
        btn.closest("[data-line-item]").remove();
      };
    });
  }

  function saveFromModal(root) {
    const customers = Storage.getCustomers();
    const medicines = Storage.getMedicines();
    const customerId = document.getElementById("rf-customer").value;
    const customer = customers.find((c) => c.id === customerId);
    const prescriber = document.getElementById("rf-prescriber").value.trim();
    if (!prescriber) { Components.toast("Enter the prescriber's name.", "error"); return; }

    const lines = [...root.querySelectorAll("[data-line-item]")].map((row) => {
      const medId = row.querySelector(".line-med").value;
      const med = medicines.find((m) => m.id === medId);
      return {
        medicineId: medId,
        medicineName: med ? med.brandName : "",
        genericName: med ? med.genericName : "",
        dosageInstructions: row.querySelector(".line-dosage").value.trim()
      };
    });

    const prescriptions = Storage.getPrescriptions();
    prescriptions.push({
      id: Utils.nextId("RX", "nextPrescriptionSeq"),
      customerId, customerName: customer.name,
      date: document.getElementById("rf-date").value,
      prescriber,
      prescriptionNumber: document.getElementById("rf-number").value.trim(),
      medicines: lines,
      notes: document.getElementById("rf-notes").value.trim()
    });
    Storage.savePrescriptions(prescriptions);
    Components.closeModal();
    Components.toast("Prescription saved.", "success");
    renderTable();
  }

  async function deletePrescription(rxId) {
    const ok = await Components.confirmDialog({ title: "Delete prescription?", message: "This permanently removes this prescription record.", confirmText: "Delete", danger: true });
    if (!ok) return;
    Storage.savePrescriptions(Storage.getPrescriptions().filter((p) => p.id !== rxId));
    Components.toast("Prescription deleted.", "success");
    renderTable();
  }

  global.Prescriptions = { renderList };
})(window);
