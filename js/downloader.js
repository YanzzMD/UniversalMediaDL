/**
 * LunarYtdl — Downloader API Module
 * Handles all communication with backend server
 * Author: Syawaliuz Octavian
 */

const Downloader = (function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  const API_BASE = window.LUNARYTDL_API || 'http://localhost:5000/api';
  const POLL_INTERVAL = 800; // ms

  // ── State ─────────────────────────────────────────────────
  let currentJobId   = null;
  let pollTimer      = null;
  let currentMeta    = null;
  let selectedFormat = null;

  // ── API helpers ───────────────────────────────────────────
  async function apiCall(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...options,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        let errData;
        try { errData = await res.json(); } catch { errData = { error: res.statusText }; }
        throw new APIError(errData.error || 'Server error', res.status);
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new APIError('Request timed out. Check your connection.', 408);
      throw err;
    }
  }

  class APIError extends Error {
    constructor(message, status) {
      super(message);
      this.name   = 'APIError';
      this.status = status;
    }
  }

  // ── Check server health ───────────────────────────────────
  async function checkHealth() {
    try {
      const data = await apiCall('/health');
      return data;
    } catch {
      return null;
    }
  }

  // ── Fetch video metadata ──────────────────────────────────
  async function fetchInfo(url, playlist = false) {
    const data = await apiCall('/info', {
      method: 'POST',
      body: JSON.stringify({ url, playlist }),
    });
    currentMeta = data;
    return data;
  }

  // ── Start download job ────────────────────────────────────
  async function startDownload(options) {
    const data = await apiCall('/download/start', {
      method: 'POST',
      body: JSON.stringify(options),
    });
    currentJobId = data.job_id;
    return data.job_id;
  }

  // ── Poll job status ───────────────────────────────────────
  function pollStatus(jobId, onProgress, onComplete, onError) {
    clearPolling();

    async function doPoll() {
      try {
        const status = await apiCall(`/download/status/${jobId}`);

        if (status.status === 'completed') {
          clearPolling();
          onComplete(status);
        } else if (status.status === 'error') {
          clearPolling();
          onError(new APIError(status.error || 'Download failed', 500));
        } else {
          onProgress(status);
          pollTimer = setTimeout(doPoll, POLL_INTERVAL);
        }
      } catch (err) {
        clearPolling();
        onError(err);
      }
    }

    doPoll();
  }

  // ── Cancel job ────────────────────────────────────────────
  async function cancelJob(jobId) {
    clearPolling();
    if (!jobId) return;
    try {
      await apiCall(`/download/cancel/${jobId}`, { method: 'DELETE' });
    } catch { /* already done */ }
    currentJobId = null;
  }

  // ── Get download file URL ─────────────────────────────────
  function getFileUrl(jobId) {
    return `${API_BASE}/download/file/${jobId}`;
  }

  // ── Clear polling ─────────────────────────────────────────
  function clearPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  // ── Set selected format ───────────────────────────────────
  function setSelectedFormat(fmt) { selectedFormat = fmt; }
  function getSelectedFormat()    { return selectedFormat; }
  function getCurrentMeta()       { return currentMeta; }
  function getCurrentJobId()      { return currentJobId; }

  // Public API
  return {
    checkHealth,
    fetchInfo,
    startDownload,
    pollStatus,
    cancelJob,
    getFileUrl,
    setSelectedFormat,
    getSelectedFormat,
    getCurrentMeta,
    getCurrentJobId,
    clearPolling,
    APIError,
  };
})();