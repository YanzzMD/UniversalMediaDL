/**
 * LunarMediaDL — Instagram Logic
 */
(function App() {
  'use strict';
  const $ = id => document.getElementById(id);

  const urlInput = $('urlInput'), urlInputWrapper = $('urlInputWrapper');
  const fetchBtn = $('fetchBtn'), clearBtn = $('clearBtn'), pasteBtn = $('pasteBtn');
  const urlValidation = $('urlValidation');

  let activeTab = 'video';
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('tab-panel--active'));
      tab.classList.add('active');
      $(tab.dataset.tab === 'video' ? 'panelVideo' : 'panelAudio').classList.add('tab-panel--active');
      activeTab = tab.dataset.tab;
      $('downloadBtnLabel').textContent = activeTab === 'audio' ? 'Download Sound' : 'Download Video';
    });
  });

  // ─── TIKTOK VALIDATION ─────────────────────────────────────────
  const IG_PATTERNS =[ /^https?:\/\/(www\.)?instagram\.com\/.+/ ];
  
  function isValidUrl(url) { return IG_PATTERNS.some(p => p.test(url.trim())); }

  function validateUrl(url) {
    if (!url) { urlValidation.textContent = ''; fetchBtn.disabled = true; clearBtn.classList.add('hidden'); return; }
    clearBtn.classList.remove('hidden');
    if (isValidUrl(url)) {
      urlValidation.textContent = '✓ Valid Instagram URL';
      urlValidation.className = 'url-validation success';
      urlInputWrapper.className = 'url-input-wrapper valid';
      fetchBtn.disabled = false;
    } else {
      urlValidation.textContent = '✗ Hanya mendukung URL Instagram di halaman ini';
      urlValidation.className = 'url-validation error';
      urlInputWrapper.className = 'url-input-wrapper invalid';
      fetchBtn.disabled = true;
    }
  }

  urlInput.addEventListener('input', () => validateUrl(urlInput.value));
  urlInput.addEventListener('paste', () => setTimeout(() => validateUrl(urlInput.value), 0));
  clearBtn.addEventListener('click', () => { urlInput.value = ''; validateUrl(''); });
  pasteBtn.addEventListener('click', async () => {
    try { urlInput.value = await navigator.clipboard.readText(); validateUrl(urlInput.value); } catch {}
  });

  // ─── LOGIC ─────────────────────────────────────────
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!isValidUrl(url)) return;
    fetchBtn.disabled = true; fetchBtn.classList.add('loading');
    try {
      const meta = await Downloader.fetchInfo(url, false);
      $('videoTitle').textContent = meta.title || 'TikTok Video';
      $('videoChannel').textContent = meta.uploader || 'TikTok User';
      $('videoThumb').src = meta.thumbnail || '';
      UI.showStep('stepInfo');
    } catch (err) {
      UI.toast(err.message || 'Error fetching TikTok', 'error');
    } finally {
      fetchBtn.disabled = false; fetchBtn.classList.remove('loading');
    }
  });

  $('downloadBtn').addEventListener('click', async () => {
    const isAudio = activeTab === 'audio';
    const opts = {
      url: urlInput.value.trim(),
      audio_only: isAudio,
      audio_format: isAudio ? $('audioFormatSelect').value : '',
      quality: isAudio ? '' : 'bestvideo+bestaudio/best'
    };
    UI.showStep('stepProgress');
    try {
      const jobId = await Downloader.startDownload(opts);
      Downloader.pollStatus(jobId, onProgress, onComplete, onError);
    } catch (e) { onError(e); }
  });

  function onProgress(status) {
    $('progressTitle').textContent = `Downloading ${status.progress.toFixed(1)}%`;
    $('progressBarFill').style.width = `${status.progress}%`;
    $('progressPctText').textContent = `${Math.round(status.progress)}%`;
    $('progressSpeed').textContent = status.speed || '';
    $('progressEta').textContent = status.eta || '';
  }

  function onComplete(status) {
    $('progressTitle').textContent = '✓ Download Complete!';
    $('progressBarFill').style.width = `100%`;
    const btn = $('downloadFileBtn');
    btn.href = Downloader.getFileUrl(status.job_id || Downloader.getCurrentJobId());
    btn.download = status.filename || 'download';
    btn.classList.remove('hidden');
    UI.toast('File ready!', 'success');
  }

  function onError(err) {
    $('progressTitle').textContent = '✗ Error';
    UI.toast(err.message || 'Failed', 'error');
    $('newDownloadBtn').classList.remove('hidden');
  }

  $('backBtn').addEventListener('click', () => UI.showStep('stepUrl'));
  $('newDownloadBtn').addEventListener('click', () => { urlInput.value = ''; UI.showStep('stepUrl'); $('downloadFileBtn').classList.add('hidden'); });

  console.info('%cLunarMediaDL TikTok Module', 'color:#a78bfa;font-size:14px;font-weight:bold');
})();
