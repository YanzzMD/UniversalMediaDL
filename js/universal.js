/**
 * LunarMediaDL — Universal Downloader Logic
 * Fixed: Full history system + UI.init() for burger menu & history panel
 */
(function App() {
  'use strict';
  const $ = id => document.getElementById(id);

  const urlInput        = $('urlInput');
  const urlInputWrapper = $('urlInputWrapper');
  const fetchBtn        = $('fetchBtn');
  const clearBtn        = $('clearBtn');
  const pasteBtn        = $('pasteBtn');
  const urlValidation   = $('urlValidation');

  // ─── Tab System ────────────────────────────────────────────────
  let activeTab = 'video';
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('tab-panel--active'));
      tab.classList.add('active');
      const panelId = tab.dataset.tab === 'video' ? 'panelVideo' : 'panelAudio';
      $(panelId).classList.add('tab-panel--active');
      activeTab = tab.dataset.tab;
      $('downloadBtnLabel').textContent = activeTab === 'audio' ? 'Download Sound' : 'Download Video';
    });
  });

  // ─── URL Validation — accepts any HTTP/HTTPS URL ───────────────
  function isValidUrl(url) {
    return /^https?:\/\/.+/.test(url.trim());
  }

  function validateUrl(url) {
    if (!url) {
      urlValidation.textContent = '';
      fetchBtn.disabled = true;
      clearBtn.classList.add('hidden');
      return;
    }
    clearBtn.classList.remove('hidden');
    if (isValidUrl(url)) {
      urlValidation.textContent = '✓ Valid URL';
      urlValidation.className   = 'url-validation success';
      urlInputWrapper.className = 'url-input-wrapper valid';
      fetchBtn.disabled = false;
    } else {
      urlValidation.textContent = '✗ Masukkan URL yang valid (https://...)';
      urlValidation.className   = 'url-validation error';
      urlInputWrapper.className = 'url-input-wrapper invalid';
      fetchBtn.disabled = true;
    }
  }

  urlInput.addEventListener('input',  () => validateUrl(urlInput.value));
  urlInput.addEventListener('paste',  () => setTimeout(() => validateUrl(urlInput.value), 0));
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !fetchBtn.disabled) fetchBtn.click(); });
  clearBtn.addEventListener('click',  () => { urlInput.value = ''; validateUrl(''); urlInput.focus(); });
  pasteBtn.addEventListener('click',  async () => {
    try { urlInput.value = await navigator.clipboard.readText(); validateUrl(urlInput.value); } catch {}
  });

  // ─── Fetch Info ────────────────────────────────────────────────
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!isValidUrl(url)) return;
    fetchBtn.disabled = true;
    fetchBtn.classList.add('loading');
    try {
      const meta = await Downloader.fetchInfo(url, false);
      $('videoTitle').textContent   = meta.title    || 'Media';
      $('videoChannel').textContent = meta.uploader || 'Unknown';
      $('videoThumb').src           = meta.thumbnail || '';
      if (meta.duration_string) $('videoDuration').textContent = meta.duration_string;
      UI.showStep('stepInfo');
    } catch (err) {
      UI.toast(err.message || 'Error fetching media info', 'error');
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.classList.remove('loading');
    }
  });

  // ─── Download ──────────────────────────────────────────────────
  $('downloadBtn').addEventListener('click', async () => {
    const isAudio = activeTab === 'audio';
    const opts = {
      url:          urlInput.value.trim(),
      audio_only:   isAudio,
      audio_format: isAudio ? $('audioFormatSelect').value : '',
      quality:      isAudio ? '' : 'bestvideo+bestaudio/best',
    };
    UI.showStep('stepProgress');
    try {
      const jobId = await Downloader.startDownload(opts);
      Downloader.pollStatus(jobId, onProgress, onComplete, onError);
    } catch (e) { onError(e); }
  });

  function onProgress(status) {
    $('progressTitle').textContent    = `Downloading ${status.progress.toFixed(1)}%`;
    $('progressBarFill').style.width  = `${status.progress}%`;
    $('progressPctText').textContent  = `${Math.round(status.progress)}%`;
    $('progressSpeed').textContent    = status.speed || '';
    $('progressEta').textContent      = status.eta   || '';
  }

  function onComplete(status) {
    $('progressTitle').textContent   = '✓ Download Complete!';
    $('progressBarFill').style.width = '100%';
    $('progressPctText').textContent = '100%';
    const btn = $('downloadFileBtn');
    const jobId = status.job_id || Downloader.getCurrentJobId();
    btn.href     = Downloader.getFileUrl(jobId);
    btn.download = status.filename || 'download';
    btn.classList.remove('hidden');
    UI.toast('File ready!', 'success');

    // Add to history
    const meta = Downloader.getCurrentMeta();
    History.add({
      jobId:     jobId,
      title:     meta?.title    || 'Media Download',
      uploader:  meta?.uploader || 'Unknown',
      thumbnail: meta?.thumbnail || '',
      filename:  status.filename || 'download',
      format:    activeTab === 'audio' ? 'Audio' : 'Video',
      fileUrl:   Downloader.getFileUrl(jobId),
      date:      Date.now(),
    });
  }

  function onError(err) {
    $('progressTitle').textContent = '✗ Error';
    UI.toast(err.message || 'Download failed', 'error');
    $('newDownloadBtn').classList.remove('hidden');
  }

  $('backBtn').addEventListener('click', () => UI.showStep('stepUrl'));
  $('newDownloadBtn').addEventListener('click', () => {
    urlInput.value = '';
    validateUrl('');
    UI.showStep('stepUrl');
    $('downloadFileBtn').classList.add('hidden');
    $('newDownloadBtn').classList.add('hidden');
  });

  // ════════════════════════════════════════════════════════════
  //  FULL HISTORY SYSTEM
  // ════════════════════════════════════════════════════════════
  const historyToggleBtn = $('historyToggleBtn');
  const historyPanel     = $('historyPanel');
  const historyBackdrop  = $('historyBackdrop');
  const historyCloseBtn  = $('historyCloseBtn');
  const historyList      = $('historyList');
  const historyEmpty     = $('historyEmpty');
  const clearHistoryBtn  = $('clearHistoryBtn');

  const History = (function () {
    const HIST_KEY = 'lunarytdl_user_history';

    function load() {
      try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
    }
    function save(items) {
      try { localStorage.setItem(HIST_KEY, JSON.stringify(items.slice(0, 50))); } catch {}
    }
    function add(entry) {
      const items = load();
      const filtered = items.filter(i => i.jobId !== entry.jobId);
      filtered.unshift(entry);
      save(filtered);
      renderHistory();
    }
    async function remove(jobId) {
      save(load().filter(i => i.jobId !== jobId));
      try { await Downloader.cancelJob(jobId); } catch {}
      renderHistory();
    }
    function clear() {
      try { localStorage.removeItem(HIST_KEY); } catch {}
      renderHistory();
    }
    return { load, add, remove, clear };
  })();

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function renderHistory() {
    if (!historyList) return;
    const items = History.load();
    historyList.querySelectorAll('.history-item').forEach(el => el.remove());

    if (!items.length) {
      if (historyEmpty) historyEmpty.style.display = '';
      return;
    }
    if (historyEmpty) historyEmpty.style.display = 'none';

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <div class="history-item__thumb">
          ${item.thumbnail
            ? `<img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy"/>`
            : '<div class="history-item__thumb-placeholder"></div>'}
          <span class="history-item__format-badge">${escapeHtml(item.format || 'Video')}</span>
        </div>
        <div class="history-item__info">
          <div class="history-item__title">${escapeHtml(item.title)}</div>
          <div class="history-item__meta">
            <span>${escapeHtml(item.filename || '')}</span>
            <span class="history-item__date">${relativeTime(item.date)}</span>
          </div>
        </div>
        <div class="history-item__actions">
          <a href="${escapeHtml(item.fileUrl)}" class="btn btn--ghost btn--xs" download title="Download again">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </a>
          <button class="btn btn--ghost btn--xs history-item__del" data-job="${escapeHtml(item.jobId)}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;
      el.querySelector('.history-item__del').addEventListener('click', async e => {
        await History.remove(e.currentTarget.dataset.job);
      });
      historyList.appendChild(el);
    });
  }

  function openHistory() {
    renderHistory();
    historyPanel.classList.add('open');
    historyPanel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeHistory() {
    historyPanel.classList.remove('open');
    historyPanel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (historyToggleBtn) historyToggleBtn.addEventListener('click', openHistory);
  if (historyCloseBtn)  historyCloseBtn.addEventListener('click', closeHistory);
  if (historyBackdrop)  historyBackdrop.addEventListener('click', closeHistory);
  if (clearHistoryBtn)  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all download history?')) {
      History.clear();
      UI.toast('History cleared.', 'info');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && historyPanel?.classList.contains('open')) closeHistory();
  });

  // ─── Init ──────────────────────────────────────────────────────
  function init() {
    UI.init();            // activates burger menu, scroll header, smooth scroll
    renderHistory();
    console.info('%cLunarMediaDL Universal Module', 'color:#22d3ee;font-size:14px;font-weight:bold');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
