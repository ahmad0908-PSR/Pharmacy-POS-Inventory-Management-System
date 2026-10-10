/**
 * utils.js
 * Small, dependency-free helper functions shared across the app.
 */
(function (global) {
  "use strict";

  function formatCurrency(amount) {
    const cfg = global.AppConfig || { currencySymbol: "$", currencyDecimals: 2 };
    const value = Number(amount) || 0;
    const fixed = value.toFixed(cfg.currencyDecimals != null ? cfg.currencyDecimals : 2);
    const parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${cfg.currencySymbol || "$"}${parts.join(".")}`;
  }

  function formatDate(isoString, opts) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const options = opts || { month: "short", day: "numeric", year: "numeric" };
    return d.toLocaleDateString("en-US", options);
  }

  function formatDateTime(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${datePart} · ${timePart}`;
  }

  function isSameDay(isoString, referenceDate) {
    const d = new Date(isoString);
    const ref = referenceDate || new Date();
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
  }

  function isSameMonth(isoString, referenceDate) {
    const d = new Date(isoString);
    const ref = referenceDate || new Date();
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  }

  function daysUntil(isoDateString, referenceDate) {
    const target = new Date(isoDateString);
    const ref = referenceDate || new Date();
    const diffMs = new Date(target.getFullYear(), target.getMonth(), target.getDate()) -
      new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return Math.round(diffMs / 86400000);
  }

  /** Classify a batch's expiry into one of five buckets used across Batches / Expiry pages. */
  function expiryBucket(expiryDateString, referenceDate) {
    const days = daysUntil(expiryDateString, referenceDate);
    if (days < 0) return "Expired";
    if (days <= 30) return "Expiring in 30 Days";
    if (days <= 60) return "Expiring in 60 Days";
    if (days <= 90) return "Expiring in 90 Days";
    return "Valid";
  }

  function expiryBadgeClass(bucket) {
    switch (bucket) {
      case "Expired": return "badge-danger";
      case "Expiring in 30 Days": return "badge-danger";
      case "Expiring in 60 Days": return "badge-warning";
      case "Expiring in 90 Days": return "badge-warning";
      default: return "badge-success";
    }
  }

  function nextId(prefix, seqKey, pad) {
    const settings = Storage.getSettings();
    const seq = settings[seqKey] || 1;
    settings[seqKey] = seq + 1;
    Storage.saveSettings(settings);
    const num = pad ? String(seq).padStart(pad, "0") : seq;
    return `${prefix}-${num}`;
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay || 250);
    };
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function stockStatus(medicine) {
    const qty = Number(medicine.quantity) || 0;
    const reorder = Number(medicine.reorderLevel) || 0;
    if (qty <= 0) return "Out of Stock";
    if (qty < reorder) return "Low Stock";
    return "In Stock";
  }

  function statusBadgeClass(status) {
    switch (status) {
      case "In Stock":
      case "Completed":
      case "Received":
      case "Active":
      case "Valid":
        return "badge-success";
      case "Low Stock":
      case "Expiring in 60 Days":
      case "Expiring in 90 Days":
        return "badge-warning";
      case "Out of Stock":
      case "Cancelled":
      case "Expired":
      case "Expiring in 30 Days":
        return "badge-danger";
      default:
        return "badge-neutral";
    }
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function initials(name) {
    if (!name) return "?";
    return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }

  global.Utils = {
    formatCurrency, formatDate, formatDateTime, isSameDay, isSameMonth,
    daysUntil, expiryBucket, expiryBadgeClass, nextId, escapeHtml, debounce,
    round2, stockStatus, statusBadgeClass, downloadFile, readFileAsText, initials
  };
})(window);
