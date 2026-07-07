/**
 * utils.js
 * Shared, dependency-free helper functions used across the app.
 * Exposed globally under the `FMRUtils` namespace to keep things
 * simple within a plain Cordova/JS project (no bundler required).
 */
(function (global) {
  'use strict';

  const FMRUtils = {};

  /* ---------------------------------------------------------------
   * ID / naming helpers
   * ------------------------------------------------------------- */

  /** Generates a reasonably unique ID (timestamp + random suffix). */
  FMRUtils.generateId = function (prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix || 'id'}_${Date.now()}_${rand}`;
  };

  /** Returns "YYYY-MM-DD_HHmmss" for folder / file naming. */
  FMRUtils.timestampForFolder = function (date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
           `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };

  /** Sanitizes a user-entered string for safe use as a folder/file name. */
  FMRUtils.sanitizeFileName = function (name) {
    return String(name || 'Untitled')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'Untitled';
  };

  /** Builds the canonical project folder name: ProjectName_Date_Time */
  FMRUtils.buildProjectFolderName = function (projectName, date) {
    return `${FMRUtils.sanitizeFileName(projectName)}_${FMRUtils.timestampForFolder(date)}`;
  };

  /* ---------------------------------------------------------------
   * Geo math
   * ------------------------------------------------------------- */

  /** Haversine distance in meters between two {latitude, longitude} points. */
  FMRUtils.haversineDistance = function (p1, p2) {
    if (!p1 || !p2) return 0;
    const R = 6371000; // Earth radius in meters
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(p2.latitude - p1.latitude);
    const dLon = toRad(p2.longitude - p1.longitude);
    const lat1 = toRad(p1.latitude);
    const lat2 = toRad(p2.latitude);

    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  /** Bearing in degrees (0-360) from p1 to p2. */
  FMRUtils.bearing = function (p1, p2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const toDeg = (v) => (v * 180) / Math.PI;
    const lat1 = toRad(p1.latitude);
    const lat2 = toRad(p2.latitude);
    const dLon = toRad(p2.longitude - p1.longitude);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  /* ---------------------------------------------------------------
   * Formatting
   * ------------------------------------------------------------- */

  FMRUtils.formatMeters = function (m) {
    if (m == null || isNaN(m)) return '--';
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
  };

  FMRUtils.formatDuration = function (ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  FMRUtils.formatBytes = function (bytes) {
    if (!bytes) return '0MB';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
  };

  FMRUtils.formatDateTime = function (isoOrDate) {
    const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  FMRUtils.accuracyClass = function (accuracyMeters) {
    if (accuracyMeters == null) return 'searching';
    if (accuracyMeters <= 8) return 'good';
    if (accuracyMeters <= 20) return 'fair';
    return 'poor';
  };

  /* ---------------------------------------------------------------
   * UI helpers: toast + loading overlay
   * ------------------------------------------------------------- */

  let toastTimer = null;
  FMRUtils.toast = function (message, type, durationMs) {
    const el = document.getElementById('toast-fmr');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast-fmr show' + (type ? ` ${type}` : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, durationMs || 2600);
  };

  FMRUtils.showLoading = function (text) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-overlay-text');
    if (textEl) textEl.textContent = text || 'Working...';
    if (overlay) overlay.classList.add('show');
  };

  FMRUtils.hideLoading = function () {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('show');
  };

  /**
   * Vibrate briefly if the vibration plugin/API is available.
   * Silently no-ops on platforms without it (e.g. desktop browser testing).
   */
  FMRUtils.vibrate = function (ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 80);
    } catch (e) { /* no-op */ }
  };

  /** Promise-based wrapper around document ready / deviceready. */
  FMRUtils.onReady = function (callback) {
    // In a Cordova WebView, deviceready fires once natives are ready.
    // When running in a plain browser for development, it never fires,
    // so we fall back to DOMContentLoaded after a short timeout race.
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      callback();
    };
    document.addEventListener('deviceready', fire, false);
    // Fallback for browser-based development/testing without Cordova.
    if (!global.cordova) {
      document.addEventListener('DOMContentLoaded', () => setTimeout(fire, 50));
    }
  };

  /** Simple debounce utility. */
  FMRUtils.debounce = function (fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  /** Convert a data URL (base64) string into a Blob for zipping/export. */
  FMRUtils.dataURLToBlob = function (dataUrl) {
    const parts = dataUrl.split(',');
    const meta = parts[0];
    const isBase64 = meta.indexOf('base64') !== -1;
    const contentType = meta.match(/:(.*?);/)[1];
    const raw = isBase64 ? atob(parts[1]) : decodeURIComponent(parts[1]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: contentType });
  };

  global.FMRUtils = FMRUtils;
})(window);
