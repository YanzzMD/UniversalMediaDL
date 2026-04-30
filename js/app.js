/**
 * LunarYtdl — Main Application
 * Orchestrates UI, API calls, and download flow
 * Author: Syawaliuz Octavian
 * v2.0 — Enhanced: dynamic download btn, bug fixes, history system
 */

(function App() {
  'use strict';

  // ════════════════════════════════════════════════════════
  //  DOM References
  // ════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);

  const urlInput        = $('urlInput');
  const urlInputWrapper = $('urlInputWrapper');
  const fetchBtn        = $('fetchBtn');
  const pasteBtn        = $('pasteBtn');
  const clearBtn        = $('clearBtn');
  const playlistToggle  = $('playlistToggle');
  const urlValidation   = $('urlValidation');

  // Video meta
  const videoThumb     = $('videoThumb');
  const videoDuration  = $('videoDuration');
  const videoTypeBadge = $('videoTypeBadge');
  const videoTitle     = $('videoTitle');
  const videoChannel   = $('videoChannel');
  const videoViews     = $('videoViews');
  const videoDate      = $('videoDate');
  const videoDesc      = $('videoDesc');

  // Format options
  const qualityGroupUHD = $('qualityGroupUHD');
  const qualityGroupHD  = $('qualityGroupHD');
  const qualityGroupSD  = $('qualityGroupSD');
  const qualitySelect   = $('qualitySelect');
  const formatList      = $('formatList');

  // Buttons
  const backBtn         = $('backBtn');
  const downloadBtn     = $('downloadBtn');       // single unified button
  const downloadBtnLabel = $('downloadBtnLabel'); // label span inside button
  const newDownloadBtn  = $('newDownloadBtn');
  const cancelBtn       = $('cancelBtn');
  const downloadFileBtn = $('downloadFileBtn');

  // Progress
  const progressTitle    = $('progressTitle');
  const progressFilename = $('progressFilename');
  const progressBarFill  = $('progressBarFill');
  const progressPctText  = $('progressPctText');
  const progressSpeed    = $('progressSpeed');
  const progressEta      = $('progressEta');
  const progressSize     = $('progressSize');
  const progressRing     = $('progressRing');

  // History
  const historyToggleBtn = $('historyToggleBtn');
  const historyPanel     = $('historyPanel');
  const historyBackdrop  = $('historyBackdrop');
  const historyCloseBtn  = $('historyCloseBtn');
  const historyList      = $('historyList');
  const historyEmpty     = $('historyEmpty');
  const clearHistoryBtn  = $('clearHistoryBtn');

  // ════════════════════════════════════════════════════════
  //  State: Track active tab for dynamic download button
  // ════════════════════════════════════════════════════════
  let activeTab = 'video'; // 'video' | 'audio' | 'advanced'

  function updateDownloadButton() {
    if (!downloadBtn || !downloadBtnLabel) return;

    const isAudio = activeTab === 'audio';
    downloadBtn.dataset.mode = isAudio ? 'audio' : 'video';

    const iconVideo = downloadBtn.querySelector('.download-btn__icon--video');
    const iconAudio = downloadBtn.querySelector('.download-btn__icon--audio');

    if (iconVideo) iconVideo.style.display = isAudio ? 'none' : '';
    if (iconAudio) iconAudio.style.display = isAudio ? '' : 'none';

    downloadBtnLabel.textContent = isAudio ? 'Download Audio' : 'Download Video';
  }

  // Intercept tab clicks to update active tab state
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab || 'video';
      updateDownloadButton();
    });
  });

  // ════════════════════════════════════════════════════════
  //  SVG progress ring math
  // ════════════════════════════════════════════════════════
  const RING_R = 28;
  const RING_CIRC = 2 * Math.PI * RING_R;

  function injectProgressGradient() {
    const svg = progressRing?.closest('svg');
    if (!svg) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#7c3aed"/>
        <stop offset="50%"  stop-color="#a78bfa"/>
        <stop offset="100%" stop-color="#67e8f9"/>
      </linearGradient>
    `;
    svg.prepend(defs);
    if (progressRing) progressRing.setAttribute('stroke', 'url(#progressGradient)');
  }

  function setRingProgress(pct) {
    if (!progressRing) return;
    const offset = RING_CIRC - (pct / 100) * RING_CIRC;
    progressRing.style.strokeDashoffset = offset;
    const pctEl = $('progressPct');
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  }

  // ════════════════════════════════════════════════════════
  //  URL Validation
  // ════════════════════════════════════════════════════════
  const YT_PATTERNS = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^https?:\/\/youtu\.be\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/@[\w.-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/channel\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/c\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}/,
  ];

  function isValidYouTubeUrl(url) {
    return YT_PATTERNS.some(p => p.test(url.trim()));
  }

  function validateUrl(url) {
    if (!url) {
      setValidation('', 'neutral');
      fetchBtn.disabled = true;
      clearBtn.classList.add('hidden');
      return;
    }

    clearBtn.classList.remove('hidden');

    if (isValidYouTubeUrl(url)) {
      setValidation('✓ Valid YouTube URL', 'success');
      urlInputWrapper.className = 'url-input-wrapper valid';
      fetchBtn.disabled = false;
    } else if (url.includes('youtube') || url.includes('youtu.be')) {
      setValidation('⚠ URL format not recognized. Is this a valid YouTube link?', 'error');
      urlInputWrapper.className = 'url-input-wrapper invalid';
      fetchBtn.disabled = true;
    } else {
      setValidation('✗ Only YouTube URLs are supported', 'error');
      urlInputWrapper.className = 'url-input-wrapper invalid';
      fetchBtn.disabled = true;
    }
  }

  function setValidation(msg, type) {
    urlValidation.textContent = msg;
    urlValidation.className   = `url-validation ${type !== 'neutral' ? type : ''}`;
  }

  // ════════════════════════════════════════════════════════
  //  URL Events
  // ════════════════════════════════════════════════════════
  urlInput.addEventListener('input', () => validateUrl(urlInput.value));
  urlInput.addEventListener('paste', () => setTimeout(() => validateUrl(urlInput.value), 0));

  pasteBtn.addEventListener('click', async () => {
    const text = await UI.pasteFromClipboard();
    if (text) {
      urlInput.value = text;
      validateUrl(text);
      urlInput.focus();
    } else {
      UI.toast('Could not access clipboard. Paste manually.', 'warning');
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    validateUrl('');
    urlInputWrapper.className = 'url-input-wrapper';
    urlInput.focus();
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !fetchBtn.disabled) fetchBtn.click();
  });

  // ════════════════════════════════════════════════════════
  //  Fetch Info
  // ════════════════════════════════════════════════════════
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url || !isValidYouTubeUrl(url)) return;

    fetchBtn.classList.add('loading');
    fetchBtn.setAttribute('aria-busy', 'true');
    fetchBtn.disabled = true;
    setValidation('Fetching video information…', 'neutral');

    try {
      const meta = await Downloader.fetchInfo(url, playlistToggle.checked);
      renderVideoMeta(meta);
      renderFormats(meta.formats || []);
      // Reset to video tab on new fetch
      activeTab = 'video';
      updateDownloadButton();
      UI.showStep('stepInfo');
    } catch (err) {
      const msg = err instanceof Downloader.APIError
        ? err.message
        : 'Could not connect to server. Is the backend running?';
      UI.toast(msg, 'error', 5000);
      setValidation(msg, 'error');
    } finally {
      fetchBtn.classList.remove('loading');
      fetchBtn.setAttribute('aria-busy', 'false');
      fetchBtn.disabled = false;
    }
  });

  // ════════════════════════════════════════════════════════
  //  Render Video Metadata
  // ════════════════════════════════════════════════════════
  function renderVideoMeta(meta) {
    videoTitle.textContent   = meta.title    || 'Unknown Title';
    videoChannel.textContent = meta.uploader || 'Unknown Channel';
    videoViews.textContent   = meta.view_count ? UI.formatNumber(meta.view_count) + ' views' : '—';
    videoDate.textContent    = UI.formatDate(meta.upload_date);
    videoDesc.textContent    = meta.description || '';

    if (meta.thumbnail) {
      videoThumb.src = meta.thumbnail;
      videoThumb.alt = meta.title || 'Thumbnail';
    }

    videoDuration.textContent = UI.formatDuration(meta.duration);
    videoTypeBadge.textContent = meta.is_playlist
      ? `Playlist · ${meta.playlist_count || '?'} videos`
      : 'Video';
  }

  // ════════════════════════════════════════════════════════
  //  Render Format List
  // ════════════════════════════════════════════════════════
  function renderFormats(formats) {
    qualityGroupUHD.innerHTML = '';
    qualityGroupHD.innerHTML  = '';
    qualityGroupSD.innerHTML  = '';
    formatList.innerHTML      = '';

    while (qualitySelect.options.length > 1) qualitySelect.remove(1);

    // Populate quality dropdown — video-only streams.
    // The server will ALWAYS merge with best audio automatically.
    const seenHeights = new Set();
    formats.forEach(fmt => {
      if (fmt.category !== 'video') return;
      if (!fmt.height) return;

      // Deduplicate by height to keep dropdown clean
      const heightKey = `${fmt.height}-${fmt.fps > 30 ? 'hfr' : 'std'}`;
      if (seenHeights.has(heightKey)) return;
      seenHeights.add(heightKey);

      const opt = document.createElement('option');
      // Store format_id as value — server adds +bestaudio automatically
      opt.value = fmt.format_id;
      opt.textContent = `${fmt.height}p${fmt.fps > 30 ? ` ${Math.round(fmt.fps)}fps` : ''} · ${fmt.ext.toUpperCase()} + Audio${fmt.filesize ? ' · ~' + UI.formatSize(fmt.filesize) : ''}`;

      if (fmt.height >= 2160)     qualityGroupUHD.appendChild(opt);
      else if (fmt.height >= 720) qualityGroupHD.appendChild(opt);
      else                        qualityGroupSD.appendChild(opt);
    });

    // Populate detailed format list
    formats.forEach(fmt => {
      const el = document.createElement('div');
      el.className = 'format-item';
      el.setAttribute('role', 'option');
      el.setAttribute('tabindex', '0');
      el.dataset.formatId = fmt.format_id;
      el.dataset.category = fmt.category;

      const badge = document.createElement('span');
      badge.className = `format-item__badge format-item__badge--${fmt.category}`;
      badge.textContent = fmt.category;

      const label = document.createElement('span');
      label.textContent = `${fmt.format_id} · ${fmt.label}`;
      if (fmt.resolution) label.textContent += ` · ${fmt.resolution}`;
      // Make clear that video streams will get audio merged in
      if (fmt.category === 'video') label.textContent += ' + audio';

      const size = document.createElement('span');
      size.className = 'format-item__size';
      size.textContent = fmt.filesize ? UI.formatSize(fmt.filesize) : '';

      el.appendChild(badge);
      el.appendChild(label);
      el.appendChild(size);

      const selectFmt = () => {
        document.querySelectorAll('.format-item').forEach(f => f.classList.remove('selected'));
        el.classList.add('selected');
        Downloader.setSelectedFormat(fmt.format_id);
      };

      el.addEventListener('click', selectFmt);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFmt(); }
      });

      formatList.appendChild(el);
    });

    if (!formatList.children.length) {
      formatList.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--clr-text-faint);font-size:0.82rem;">No formats available</div>';
    }
  }

  // ════════════════════════════════════════════════════════
  //  Download Flow — BUG FIX: Always read from activeTab
  // ════════════════════════════════════════════════════════
  function buildDownloadOptions() {
    const meta      = Downloader.getCurrentMeta();
    const url       = meta?.original_url || meta?.webpage_url || urlInput.value.trim();
    const audioOnly = activeTab === 'audio';

    // selected = format clicked in the format list (video-only stream ID e.g. "137")
    // qualitySelect.value = dropdown value e.g. "bestvideo+bestaudio" or a format_id
    const selected      = Downloader.getSelectedFormat();
    const dropdownVal   = qualitySelect.value; // e.g. "bestvideo+bestaudio" or "137"

    // For VIDEO: send format_id (from format list click) or leave empty so server
    // uses its own fallback. NEVER send "bestvideo+bestaudio" as format_id — send
    // it as quality so server handles the merge logic properly.
    const isAutoQuality = !selected && (
      dropdownVal === 'bestvideo+bestaudio' || dropdownVal === '' || !dropdownVal
    );

    return {
      url,
      audio_only:           audioOnly,
      audio_format:         $('audioFormatSelect').value,
      audio_quality:        $('audioQualitySelect').value,
      // Send format_id only if user explicitly clicked a format from the list
      // For audio: always empty — server uses -x flag
      format_id:            audioOnly ? '' : (selected || ''),
      // quality is used when no specific format_id is selected
      quality:              audioOnly ? '' : (isAutoQuality ? '' : dropdownVal),
      embed_thumbnail:      audioOnly ? $('embedThumbAudio').checked : $('embedThumbVideo').checked,
      embed_metadata:       audioOnly ? $('embedMetaAudio').checked  : $('embedMetaVideo').checked,
      embed_chapters:       !audioOnly && $('embedChapters').checked,
      playlist:             playlistToggle.checked,
      subtitles:            $('writeSubtitles').checked,
      auto_subtitles:       $('writeAutoSubs').checked,
      write_subtitles:      $('embedSubs').checked,
      subtitle_lang:        $('subLangInput').value || 'en',
      subtitle_format:      $('subFormatSelect').value,
      proxy:                $('proxyInput').value || null,
      rate_limit:           $('rateLimitInput').value || null,
      cookies_from_browser: $('cookiesInput').value || null,
    };
  }

  async function initiateDownload() {
    const opts     = buildDownloadOptions();
    const audioOnly = opts.audio_only;

    UI.showStep('stepProgress');
    setProgressState(0, audioOnly ? 'Extracting audio…' : 'Preparing download…', '');
    cancelBtn.classList.remove('hidden');
    downloadFileBtn.classList.add('hidden');
    newDownloadBtn.classList.add('hidden');

    // Reset progress bar color
    if (progressBarFill) progressBarFill.style.background = '';

    try {
      const jobId = await Downloader.startDownload(opts);

      UI.toast(audioOnly ? '🎵 Audio download started!' : '🎬 Video download started!', 'info');

      Downloader.pollStatus(jobId, onProgress, (status) => onComplete(status, opts), onError);
    } catch (err) {
      onError(err);
    }
  }

  // ─── Progress handlers ────────────────────────────────────
  function onProgress(status) {
    const pct = status.progress || 0;
    setProgressState(
      pct,
      pct < 5  ? 'Connecting to servers…' :
      pct < 95 ? `Downloading… ${pct.toFixed(1)}%` :
      'Merging & processing…',
      status.filename || '',
    );
    progressSpeed.textContent = status.speed ? `⚡ ${status.speed}` : '—';
    progressEta.textContent   = status.eta   ? `⏱ ETA ${status.eta}` : '—';
    progressSize.textContent  = status.filesize ? `📦 ${status.filesize}` : '—';
  }

  function onComplete(status, opts) {
    // BUG FIX: Some formats (FLAC) may not report 100% but are complete.
    // Force 100% on completion status regardless of last reported progress.
    setProgressState(100, '✓ Download Complete!', status.filename || '');
    if (progressBarFill) progressBarFill.style.background = 'linear-gradient(90deg, #22d3ee, #67e8f9)';

    const jobId = Downloader.getCurrentJobId() || status.job_id;
    if (jobId) {
      downloadFileBtn.href = Downloader.getFileUrl(jobId);
      downloadFileBtn.download = status.filename || 'download';
      downloadFileBtn.classList.remove('hidden');
    }

    cancelBtn.classList.add('hidden');
    newDownloadBtn.classList.remove('hidden');
    progressSpeed.textContent = '✓ Done';
    progressEta.textContent   = '';

    UI.toast('🌟 File ready! Click "Save File" to download.', 'success', 6000);

    // Save to history
    if (jobId) {
      const meta = Downloader.getCurrentMeta();
      History.add({
        jobId,
        title:     meta?.title     || 'Unknown',
        thumbnail: meta?.thumbnail || '',
        filename:  status.filename || 'download',
        audioOnly: opts?.audio_only || false,
        format:    opts?.audio_only ? (opts?.audio_format || 'mp3').toUpperCase() : 'Video',
        date:      Date.now(),
        fileUrl:   Downloader.getFileUrl(jobId),
      });
    }
  }

  function onError(err) {
    // BUG FIX: Check if server marked complete despite error field — happens with some containers (FLAC, WAV)
    // The worker sometimes exits 0 but yt-dlp output triggers error path
    const msg = err?.message || 'Download failed. Please try again.';

    // If error message suggests the file was actually created (post-processing error), show partial success
    const isPostProcError = msg.includes('already exists') || msg.includes('Destination:') || msg.includes('ExtractAudio');
    if (isPostProcError) {
      const jobId = Downloader.getCurrentJobId();
      if (jobId) {
        downloadFileBtn.href = Downloader.getFileUrl(jobId);
        downloadFileBtn.classList.remove('hidden');
      }
      setProgressState(100, '⚠ Processed with warnings', msg);
      UI.toast('File may be ready despite warnings. Try "Save File".', 'warning', 6000);
    } else {
      setProgressState(0, '✗ Error', msg);
      if (progressBarFill) progressBarFill.style.background = 'linear-gradient(90deg, var(--clr-error), #f87171)';
    }

    cancelBtn.classList.add('hidden');
    newDownloadBtn.classList.remove('hidden');
    if (!isPostProcError) UI.toast(msg, 'error', 6000);
  }

  function setProgressState(pct, title, subtitle) {
    const clampedPct = Math.min(Math.max(pct, 0), 100);
    progressTitle.textContent    = title;
    progressFilename.textContent = subtitle;
    progressBarFill.style.width  = `${clampedPct}%`;
    progressPctText.textContent  = `${Math.round(clampedPct)}%`;
    progressBarFill.closest('[role="progressbar"]').setAttribute('aria-valuenow', clampedPct);
    setRingProgress(clampedPct);
  }

  // ════════════════════════════════════════════════════════
  //  Button Events
  // ════════════════════════════════════════════════════════
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => initiateDownload());
  }

  backBtn.addEventListener('click', () => {
    UI.showStep('stepUrl');
    Downloader.setSelectedFormat(null);
  });

  cancelBtn.addEventListener('click', async () => {
    const jobId = Downloader.getCurrentJobId();
    if (jobId) {
      await Downloader.cancelJob(jobId);
      UI.toast('Download cancelled.', 'warning');
    }
    UI.showStep('stepInfo');
    cancelBtn.classList.add('hidden');
  });

  newDownloadBtn.addEventListener('click', () => {
    Downloader.clearPolling();
    urlInput.value = '';
    validateUrl('');
    urlInputWrapper.className = 'url-input-wrapper';
    activeTab = 'video';
    updateDownloadButton();
    UI.showStep('stepUrl');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ════════════════════════════════════════════════════════
  //  History System
  // ════════════════════════════════════════════════════════
  const History = (function() {
    // Per-user key based on browser fingerprint (no auth needed)
    const USER_KEY = 'lunarytdl_user_' + _getUserId();
    const HIST_KEY = USER_KEY + '_history';

    function _getUserId() {
      let id = localStorage.getItem('lunarytdl_uid');
      if (!id) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('lunarytdl_uid', id);
      }
      return id;
    }

    function load() {
      try {
        return JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      } catch { return []; }
    }

    function save(items) {
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(items.slice(0, 50)));
      } catch { /* storage full */ }
    }

    function add(entry) {
      const items = load();
      // Avoid duplicates by jobId
      const filtered = items.filter(i => i.jobId !== entry.jobId);
      filtered.unshift(entry);
      save(filtered);
      renderHistory();
    }

    async function remove(jobId) {
      const items = load();
      save(items.filter(i => i.jobId !== jobId));
      // Also try to delete file from server
      try {
        await Downloader.cancelJob(jobId);
      } catch { /* already gone */ }
      renderHistory();
    }

    function clear() {
      const items = load();
      // Best-effort server cleanup
      items.forEach(i => {
        try { Downloader.cancelJob(i.jobId); } catch { /* ignore */ }
      });
      save([]);
      renderHistory();
    }

    return { load, add, remove, clear };
  })();

  function renderHistory() {
    if (!historyList) return;
    const items = History.load();

    // Remove existing item cards (keep empty state)
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
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy"/>` : '<div class="history-item__thumb-placeholder"></div>'}
          <span class="history-item__format-badge">${item.format || 'Video'}</span>
        </div>
        <div class="history-item__info">
          <div class="history-item__title">${escapeHtml(item.title)}</div>
          <div class="history-item__meta">
            <span>${item.filename || ''}</span>
            <span class="history-item__date">${_relativeTime(item.date)}</span>
          </div>
        </div>
        <div class="history-item__actions">
          <a href="${item.fileUrl}" class="btn btn--ghost btn--xs" download title="Download again">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </a>
          <button class="btn btn--ghost btn--xs history-item__del" data-job="${item.jobId}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;

      el.querySelector('.history-item__del').addEventListener('click', async (e) => {
        const jobId = e.currentTarget.dataset.job;
        await History.remove(jobId);
      });

      historyList.appendChild(el);
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
  }

  // ── History Panel toggle ─────────────────────────────────
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

  // Close history on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && historyPanel?.classList.contains('open')) closeHistory();
  });

  // ════════════════════════════════════════════════════════
  //  Server Health Check
  // ════════════════════════════════════════════════════════
  async function checkServer() {
    const health = await Downloader.checkHealth();
    if (!health) {
      UI.toast('⚠ Backend server not reachable. Start the server first.', 'warning', 8000);
    } else {
      console.info(`LunarYtdl: Server online — yt-dlp ${health.ytdlp_version}`);
    }
  }

  // ════════════════════════════════════════════════════════
  //  Init
  // ════════════════════════════════════════════════════════
  function init() {
    UI.init();
    injectProgressGradient();
    updateDownloadButton();
    checkServer();
    renderHistory();

    console.info('%cLunarYtdl v2.0.0', [
      'color:#a78bfa', 'font-size:18px', 'font-weight:700',
      'background:#050816', 'padding:8px 16px', 'border-radius:6px',
    ].join(';'));
    console.info('%cCreated by Syawaliuz Octavian', 'color:#67e8f9;font-size:11px');
  }

  init();
})();