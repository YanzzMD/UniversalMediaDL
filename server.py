#!/usr/bin/env python3
"""
LunarMediaDL - Backend Server
Production-ready Universal Downloader API powered by yt-dlp
Supports YouTube, TikTok, Instagram, and 1000+ other platforms.
"""

import os
import sys
import base64
import json
import uuid
import time
import threading
import logging
import re
import subprocess
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

# ─── Configuration ────────────────────────────────────────────────────────────
# Resolve BASE_DIR robustly for Railway and other cloud deployments.
# Priority: WORKDIR env var → directory of this script → cwd
def _resolve_base_dir() -> Path:
    if wd := os.environ.get("WORKDIR"):
        return Path(wd)
    script_dir = Path(__file__).resolve().parent
    # Prefer script dir if it contains index.html; otherwise fall back to cwd
    if (script_dir / "index.html").exists():
        return script_dir
    cwd = Path.cwd()
    if (cwd / "index.html").exists():
        return cwd
    return script_dir  # best guess

BASE_DIR     = _resolve_base_dir()
DOWNLOAD_DIR = BASE_DIR / "downloads"
LOG_DIR      = BASE_DIR / "logs"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

COOKIES_FILE = BASE_DIR / "cookies.txt"

# ─── Default Proxy ────────────────────────────────────────────────────────────
# Proxy default dipakai jika user tidak menyediakan proxy sendiri.
# Bisa di-override via environment variable PROXY_URL di Railway.
DEFAULT_PROXY = os.environ.get("PROXY_URL", "socks5://139.59.24.173:1080").strip()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "server.log"),
    ],
)
logger = logging.getLogger("LunarMediaDL")

# ─── App Init ─────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")

# Log resolved paths at startup for easier debugging on Railway
@app.before_request
def _log_base_dir_once():
    if not getattr(app, "_base_dir_logged", False):
        app._base_dir_logged = True
        logger.info(f"📁 BASE_DIR resolved to: {BASE_DIR}")
        logger.info(f"   index.html exists: {(BASE_DIR / 'index.html').exists()}")
        logger.info(f"   downloader.html exists: {(BASE_DIR / 'downloader.html').exists()}")
        logger.info(f"🌐 Default proxy: {DEFAULT_PROXY or 'none'}")
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ─── In-Memory Job Store ──────────────────────────────────────────────────────
jobs      = {}
jobs_lock = threading.Lock()

# ─── Helpers ──────────────────────────────────────────────────────────────────

def is_valid_url(url: str) -> bool:
    """Menerima semua platform yang didukung yt-dlp (HTTP/HTTPS)"""
    url_stripped = url.strip()
    return url_stripped.startswith("http://") or url_stripped.startswith("https://")

def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)[:200]

def cleanup_old_files(max_age_hours: int = 4):
    """Remove download files older than max_age_hours."""
    cutoff = time.time() - max_age_hours * 3600
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                logger.info(f"Cleaned up old file: {f.name}")
            except OSError:
                pass

def _ensure_cookies():
    """Decode env var ke cookies.txt — dipanggil lazy saat pertama kali dibutuhkan."""
    b64 = os.environ.get("YOUTUBE_COOKIES_B64", "").strip()
    if not b64:
        return
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        return
    try:
        decoded = base64.b64decode(b64)
        COOKIES_FILE.write_bytes(decoded)
        logger.info(f"Cookies written from env var ({len(decoded)} bytes)")
    except Exception as e:
        logger.warning(f"Failed to decode YOUTUBE_COOKIES_B64: {e}")

def get_cookies_args() -> list:
    _ensure_cookies()
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        return ["--cookies", str(COOKIES_FILE)]
    return []

def get_proxy_args(user_proxy: str = None) -> list:
    """
    Kembalikan argumen proxy untuk yt-dlp.
    Prioritas: proxy dari user (frontend) → env var PROXY_URL → default proxy hardcoded.
    Kalau semua kosong, kembalikan list kosong (tidak pakai proxy).
    """
    proxy = (user_proxy or "").strip() or DEFAULT_PROXY
    if proxy:
        logger.info(f"🌐 Using proxy: {proxy}")
        return ["--proxy", proxy]
    return []

def run_ytdlp(args: list) -> subprocess.CompletedProcess:
    cmd = ["yt-dlp"] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300)

def _find_latest_file(job_id: str = None, hint_name: str = None) -> Path | None:
    """Find the most recently modified file in DOWNLOAD_DIR."""
    if hint_name:
        hint_path = Path(hint_name)
        if hint_path.exists():
            return hint_path
        candidate = DOWNLOAD_DIR / hint_path.name
        if candidate.exists():
            return candidate

    files = sorted([f for f in DOWNLOAD_DIR.glob("*.*") if f.is_file()],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return files[0] if files else None

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def serve_index():
    index_path = BASE_DIR / "index.html"
    if not index_path.exists():
        # Helpful debug response instead of cryptic 404
        return (
            f"<h2>index.html not found</h2>"
            f"<p>BASE_DIR = <code>{BASE_DIR}</code></p>"
            f"<p>Files in BASE_DIR: {[f.name for f in BASE_DIR.iterdir() if f.is_file()]}</p>"
            f"<p>Set the <code>WORKDIR</code> environment variable to the directory containing your HTML files.</p>",
            200,
            {"Content-Type": "text/html"},
        )
    return send_from_directory(str(BASE_DIR), "index.html")

@app.route("/downloader", methods=["GET"])
@app.route("/downloader.html", methods=["GET"])
def serve_downloader():
    return send_from_directory(str(BASE_DIR), "downloader.html")

@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    if filename.startswith("api/"):
        from flask import abort
        abort(404)
    return send_from_directory(str(BASE_DIR), filename)

@app.route("/api/health", methods=["GET"])
def health_check():
    try:
        result = run_ytdlp(["--version"])
        ytdlp_version = result.stdout.strip()
    except FileNotFoundError:
        ytdlp_version = "not found"
    except Exception as e:
        ytdlp_version = f"error: {e}"

    _ensure_cookies()
    cookies_ok  = COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0
    cookies_src = "env_var" if os.environ.get("YOUTUBE_COOKIES_B64") else ("file" if cookies_ok else "none")
    return jsonify({
        "status":         "online",
        "server":         "LunarMediaDL v2.0.0",
        "ytdlp_version":  ytdlp_version,
        "timestamp":      datetime.utcnow().isoformat(),
        "cookies_loaded": cookies_ok,
        "cookies_source": cookies_src,
        "proxy_active":   bool(DEFAULT_PROXY),
        "proxy":          DEFAULT_PROXY or "none",
    })

@app.route("/api/info", methods=["POST"])
def fetch_info():
    data = request.get_json(silent=True) or {}
    url  = (data.get("url") or "").strip()

    if not url:
        return jsonify({"error": "URL is required"}), 400
    if not is_valid_url(url):
        return jsonify({"error": "Invalid or unsupported URL"}), 422

    logger.info(f"Fetching info for: {url}")

    # Proxy dari user (manual via frontend), fallback ke default proxy
    user_proxy = (data.get("proxy") or "").strip()

    args = [
        url, "--dump-json",
        "--no-playlist" if not data.get("playlist") else "--yes-playlist",
        "--no-warnings", "--socket-timeout", "30", "--retries", "3",
        "--extractor-retries", "3",
    ] + get_cookies_args() + get_proxy_args(user_proxy)

    # Apply Cookies From Browser Settings
    if data.get("cookies_from_browser"):
        args += ["--cookies-from-browser", data.get("cookies_from_browser")]

    try:
        result = run_ytdlp(args)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Request timed out. Try again."}), 504
    except FileNotFoundError:
        return jsonify({"error": "yt-dlp not installed on server"}), 500

    if result.returncode != 0:
        err_msg = result.stderr.strip().split("\n")[-1]
        logger.warning(f"yt-dlp info error: {err_msg}")
        return jsonify({"error": f"Failed to fetch media info: {err_msg}"}), 400

    lines = [l for l in result.stdout.strip().split("\n") if l.startswith("{")]
    if not lines:
        return jsonify({"error": "No media data returned"}), 400

    try:
        meta = json.loads(lines[0])
    except json.JSONDecodeError:
        return jsonify({"error": "Failed to parse media data"}), 500

    # Build format list
    formats = []
    seen    = set()
    for f in (meta.get("formats") or []):
        fid    = f.get("format_id", "")
        ext    = f.get("ext", "")
        vcodec = f.get("vcodec", "none")
        acodec = f.get("acodec", "none")
        height = f.get("height")
        width  = f.get("width")
        tbr    = f.get("tbr")
        fps    = f.get("fps")
        fsize  = f.get("filesize") or f.get("filesize_approx")

        if vcodec == "none" and acodec == "none":
            continue

        label_parts = []
        if height:            label_parts.append(f"{height}p")
        if fps and fps > 30:  label_parts.append(f"{int(fps)}fps")
        if ext:               label_parts.append(ext.upper())

        category = "video" if vcodec != "none" else "audio"
        key      = f"{height}-{ext}-{category}"
        if key in seen: continue
        seen.add(key)

        formats.append({
            "format_id":  fid,
            "ext":        ext,
            "resolution": f"{width}x{height}" if width and height else None,
            "height":     height,
            "fps":        fps,
            "tbr":        tbr,
            "filesize":   fsize,
            "vcodec":     vcodec,
            "acodec":     acodec,
            "category":   category,
            "label":      " · ".join(label_parts) or fid,
        })

    formats.sort(key=lambda x: (0 if x["category"] == "video" else 1, -(x["height"] or 0)))

    subtitles = {}
    for lang, subs in (meta.get("subtitles") or {}).items():
        if subs:
            subtitles[lang] = [{"ext": s.get("ext"), "name": s.get("name", lang)} for s in subs[:3]]

    auto_subs = {}
    for lang, subs in (meta.get("automatic_captions") or {}).items():
        if subs:
            auto_subs[lang] = [{"ext": s.get("ext"), "name": s.get("name", lang)} for s in subs[:3]]

    is_playlist    = data.get("playlist") and len(lines) > 1
    playlist_count = len(lines) if is_playlist else None

    response = {
        "id":               meta.get("id"),
        "title":            meta.get("title"),
        "uploader":         meta.get("uploader") or meta.get("channel"),
        "duration":         meta.get("duration"),
        "duration_string":  meta.get("duration_string"),
        "view_count":       meta.get("view_count"),
        "like_count":       meta.get("like_count"),
        "thumbnail":        meta.get("thumbnail"),
        "description":      (meta.get("description") or "")[:500],
        "upload_date":      meta.get("upload_date"),
        "formats":          formats,
        "subtitles":        subtitles,
        "automatic_captions": auto_subs,
        "is_playlist":      is_playlist,
        "playlist_count":   playlist_count,
        "playlist_title":   meta.get("playlist_title") if is_playlist else None,
        "webpage_url":      meta.get("webpage_url") or url,
        "original_url":     url,
    }

    logger.info(f"Info fetched: {meta.get('title')!r} | {len(formats)} formats")
    return jsonify(response)

@app.route("/api/download/start", methods=["POST"])
def start_download():
    data = request.get_json(silent=True) or {}
    url  = (data.get("url") or "").strip()

    if not url:
        return jsonify({"error": "URL is required"}), 400
    if not is_valid_url(url):
        return jsonify({"error": "Invalid URL"}), 422

    job_id = str(uuid.uuid4())

    with jobs_lock:
        jobs[job_id] = {
            "status":     "queued",
            "progress":   0,
            "speed":      None,
            "eta":        None,
            "filename":   None,
            "filesize":   None,
            "error":      None,
            "url":        url,
            "created_at": time.time(),
        }

    thread = threading.Thread(
        target=_download_worker,
        args=(job_id, url, data),
        daemon=True,
        name=f"download-{job_id[:8]}",
    )
    thread.start()

    logger.info(f"Download job {job_id[:8]} started for {url}")
    return jsonify({"job_id": job_id})

def _download_worker(job_id: str, url: str, opts: dict):
    """Background thread: runs yt-dlp and updates job state."""
    cleanup_old_files()

    audio_only    = opts.get("audio_only", False)
    audio_format  = opts.get("audio_format", "mp3")
    format_id     = opts.get("format_id", "")
    quality       = opts.get("quality", "bestvideo+bestaudio")
    subtitles     = opts.get("subtitles", False)
    subtitle_lang = opts.get("subtitle_lang", "en")
    auto_subs     = opts.get("auto_subtitles", False)
    playlist      = opts.get("playlist", False)
    embed_thumb   = opts.get("embed_thumbnail", False)
    embed_meta    = opts.get("embed_metadata", True)
    write_subs    = opts.get("write_subtitles", False)
    sub_format    = opts.get("subtitle_format", "srt")
    cookies_from  = opts.get("cookies_from_browser")
    rate_limit    = opts.get("rate_limit")
    user_proxy    = (opts.get("proxy") or "").strip()

    output_template = str(DOWNLOAD_DIR / "%(title)s.%(ext)s")

    args = [
        url,
        "--output", output_template,
        "--no-warnings",
        "--socket-timeout", "60",
        "--retries", "5",
        "--fragment-retries", "5",
        "--extractor-retries", "3",
        "--newline",
        "--progress",
    ]

    # ── Format selection ──────────────────────────────────────────────────────
    if audio_only:
        args += ["-x", "--audio-format", audio_format, "--audio-quality", "0"]
    elif format_id:
        # Fallback bestaudio + ultimate fallback ke best
        args += ["-f", f"{format_id}+bestaudio[ext=m4a]/{format_id}+bestaudio/{format_id}/bestvideo+bestaudio/best"]
    elif quality and quality not in ("best", "bestvideo+bestaudio", ""):
        args += ["-f", f"{quality}+bestaudio[ext=m4a]/{quality}+bestaudio/{quality}/bestvideo+bestaudio/best"]
    else:
        args += ["-f", "bestvideo+bestaudio/best"]

    # ── Playlist ──────────────────────────────────────────────────────────────
    if not playlist:
        args.append("--no-playlist")
    else:
        args += [
            "--yes-playlist",
            "--output",
            str(DOWNLOAD_DIR / "%(playlist_title)s/%(playlist_index)s - %(title)s.%(ext)s"),
        ]

    # ── Subtitles ─────────────────────────────────────────────────────────────
    if subtitles:
        args += ["--write-subs", "--sub-langs", subtitle_lang, "--sub-format", sub_format]
    if auto_subs:
        args += ["--write-auto-subs", "--sub-langs", subtitle_lang]
    if write_subs:
        args += ["--embed-subs"]

    # ── Metadata / Thumbnail ──────────────────────────────────────────────────
    if embed_thumb:
        args.append("--embed-thumbnail")
    if embed_meta:
        args.append("--embed-metadata")

    # ── Network & Cookies ─────────────────────────────────────────────────────
    if rate_limit:
        args += ["--rate-limit", str(rate_limit)]
    if cookies_from:
        args += ["--cookies-from-browser", cookies_from]

    # Proxy: user_proxy dari frontend → fallback ke default proxy
    args += get_proxy_args(user_proxy)
    args += get_cookies_args()

    # ── Post-processing ───────────────────────────────────────────────────────
    if not audio_only:
        args += ["--merge-output-format", "mp4", "--add-metadata"]

    with jobs_lock:
        jobs[job_id]["status"] = "downloading"

    # ── Run yt-dlp ────────────────────────────────────────────────────────────
    try:
        proc = subprocess.Popen(
            ["yt-dlp"] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        output_filename = None
        last_pct        = 0

        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            # Parse progress
            if "[download]" in line and "%" in line:
                m = re.search(
                    r"(\d+\.?\d*)%.*?of\s+([\d.]+\s*\S+).*?at\s+([\d.]+\s*\S+/s).*?ETA\s+(\S+)",
                    line,
                )
                if m:
                    pct   = float(m.group(1))
                    total = m.group(2)
                    speed = m.group(3)
                    eta   = m.group(4)
                    last_pct = pct
                    with jobs_lock:
                        jobs[job_id]["progress"] = pct
                        jobs[job_id]["speed"]    = speed
                        jobs[job_id]["eta"]      = eta
                        jobs[job_id]["filesize"] = total

            # Detect output filename
            if "Destination:" in line:
                parts = line.split("Destination:")
                if len(parts) > 1:
                    output_filename = parts[1].strip()

            if "[ExtractAudio]" in line and "Destination:" in line:
                output_filename = line.split("Destination:")[-1].strip()

            # Detect "already been downloaded" for re-runs
            if "has already been downloaded" in line:
                m = re.search(r"\[download\]\s+(.+?)\s+has already been downloaded", line)
                if m:
                    output_filename = m.group(1).strip()

            logger.debug(f"yt-dlp [{job_id[:8]}]: {line}")

        proc.wait(timeout=600)

        if proc.returncode == 0:
            if not output_filename or not Path(output_filename).exists():
                output_filename = str(_find_latest_file(hint_name=output_filename) or "")

            with jobs_lock:
                jobs[job_id]["status"]   = "completed"
                jobs[job_id]["progress"] = 100
                jobs[job_id]["filename"] = Path(output_filename).name if output_filename else None
                jobs[job_id]["filepath"] = output_filename

            logger.info(f"Job {job_id[:8]} completed: {output_filename}")
        else:
            # Check if file exists (e.g. warning but file completed successfully)
            candidate = _find_latest_file(hint_name=output_filename)
            if candidate and candidate.stat().st_mtime > time.time() - 30:
                logger.warning(f"Job {job_id[:8]} exited {proc.returncode} but file found: {candidate}")
                with jobs_lock:
                    jobs[job_id]["status"]   = "completed"
                    jobs[job_id]["progress"] = 100
                    jobs[job_id]["filename"] = candidate.name
                    jobs[job_id]["filepath"] = str(candidate)
            else:
                with jobs_lock:
                    jobs[job_id]["status"] = "error"
                    jobs[job_id]["error"]  = "Download failed. Check URL or try again."
                logger.warning(f"Job {job_id[:8]} failed with code {proc.returncode}")

    except subprocess.TimeoutExpired:
        proc.kill()
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"]  = "Download timed out."
    except FileNotFoundError:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"]  = "yt-dlp is not installed on this server."
    except Exception as e:
        logger.exception(f"Unexpected error in job {job_id[:8]}")
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"]  = str(e)

@app.route("/api/download/status/<job_id>", methods=["GET"])
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if job is None:
        return jsonify({"error": "Job not found"}), 404

    return jsonify({
        "job_id":    job_id,
        "status":    job["status"],
        "progress":  job["progress"],
        "speed":     job["speed"],
        "eta":       job["eta"],
        "filename":  job["filename"],
        "filesize":  job["filesize"],
        "error":     job["error"],
    })

@app.route("/api/download/file/<job_id>", methods=["GET"])
def serve_file(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if job is None:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "completed":
        return jsonify({"error": "Download not yet complete"}), 409

    filepath = job.get("filepath")
    if not filepath or not Path(filepath).exists():
        return jsonify({"error": "File not found on server"}), 404

    filename = Path(filepath).name
    return send_file(filepath, as_attachment=True, download_name=sanitize_filename(filename))

@app.route("/api/download/cancel/<job_id>", methods=["DELETE"])
@app.route("/api/history/<job_id>", methods=["DELETE"])
def cancel_job(job_id: str):
    with jobs_lock:
        job = jobs.pop(job_id, None)

    if job is None:
        return jsonify({"error": "Job not found"}), 404

    filepath = job.get("filepath")
    if filepath and Path(filepath).exists():
        try:
            Path(filepath).unlink()
        except OSError:
            pass

    return jsonify({"message": "Job cancelled and file removed"})

@app.errorhandler(404)
def not_found(e):
    # Return JSON only for /api/* routes; serve index.html for everything else (SPA fallback)
    if request.path.startswith("/api/"):
        return jsonify({"error": "Endpoint not found"}), 404
    index_path = BASE_DIR / "index.html"
    if index_path.exists():
        return send_from_directory(str(BASE_DIR), "index.html")
    return jsonify({"error": "Endpoint not found", "base_dir": str(BASE_DIR)}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("DEBUG", "false").lower() == "true"

    logger.info(f"🌙 LunarMediaDL Server starting on port {port}")
    logger.info(f"📂 BASE_DIR: {BASE_DIR}")
    logger.info(f"📂 Download directory: {DOWNLOAD_DIR}")
    logger.info(f"📄 index.html found: {(BASE_DIR / 'index.html').exists()}")
    logger.info(f"🌐 Proxy: {DEFAULT_PROXY or 'none'}")

    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
