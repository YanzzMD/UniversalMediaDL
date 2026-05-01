#!/usr/bin/env python3
"""
LunarMediaDL - Backend Server
Production-ready Universal Downloader API powered by yt-dlp
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

BASE_DIR     = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
LOG_DIR      = BASE_DIR / "logs"
DOWNLOAD_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

COOKIES_FILE = BASE_DIR / "cookies.txt"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "server.log"),
    ],
)
logger = logging.getLogger("LunarMediaDL")

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app, resources={r"/api/*": {"origins": "*"}})

jobs      = {}
jobs_lock = threading.Lock()

# ─── URL Validation (UNIVERSAL) ───────────────────────────────────────────────
def is_valid_url(url: str) -> bool:
    """Menerima semua platform yang disupport yt-dlp (TikTok, IG, FB, Twitter, dll)"""
    return url.strip().startswith("http://") or url.strip().startswith("https://")

def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)[:200]

def cleanup_old_files(max_age_hours: int = 4):
    cutoff = time.time() - max_age_hours * 3600
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
            except OSError:
                pass

def _ensure_cookies():
    b64 = os.environ.get("YOUTUBE_COOKIES_B64", "").strip()
    if not b64: return
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0: return
    try:
        decoded = base64.b64decode(b64)
        COOKIES_FILE.write_bytes(decoded)
    except Exception as e:
        logger.warning(f"Failed to decode YOUTUBE_COOKIES_B64: {e}")

def get_cookies_args() -> list:
    _ensure_cookies()
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        return["--cookies", str(COOKIES_FILE)]
    return[]

def run_ytdlp(args: list) -> subprocess.CompletedProcess:
    cmd = ["yt-dlp"] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300)

def _find_latest_file(job_id: str = None, hint_name: str = None) -> Path | None:
    if hint_name:
        hint_path = Path(hint_name)
        if hint_path.exists(): return hint_path
        candidate = DOWNLOAD_DIR / hint_path.name
        if candidate.exists(): return candidate
    files = sorted([f for f in DOWNLOAD_DIR.glob("*.*") if f.is_file()],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return files[0] if files else None

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def serve_index(): return send_from_directory(str(BASE_DIR), "index.html")

@app.route("/downloader", methods=["GET"])
@app.route("/downloader.html", methods=["GET"])
def serve_downloader(): return send_from_directory(str(BASE_DIR), "downloader.html")

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
    except Exception as e:
        ytdlp_version = f"error: {e}"
    return jsonify({
        "status": "online",
        "server": "LunarMediaDL v2.0.0",
        "ytdlp_version": ytdlp_version,
        "timestamp": datetime.utcnow().isoformat(),
    })

@app.route("/api/info", methods=["POST"])
def fetch_info():
    data = request.get_json(silent=True) or {}
    url  = (data.get("url") or "").strip()

    if not url: return jsonify({"error": "URL is required"}), 400
    if not is_valid_url(url): return jsonify({"error": "Invalid URL format"}), 422

    logger.info(f"Fetching info for: {url}")
    args =[
        url, "--dump-json",
        "--no-playlist" if not data.get("playlist") else "--yes-playlist",
        "--no-warnings", "--socket-timeout", "30", "--retries", "3",
    ] + get_cookies_args()

    try:
        result = run_ytdlp(args)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Request timed out. Try again."}), 504

    if result.returncode != 0:
        err_msg = result.stderr.strip().split("\n")[-1]
        return jsonify({"error": f"Failed to fetch media info: {err_msg}"}), 400

    lines =[l for l in result.stdout.strip().split("\n") if l.startswith("{")]
    if not lines: return jsonify({"error": "No media data returned"}), 400

    try:
        meta = json.loads(lines[0])
    except json.JSONDecodeError:
        return jsonify({"error": "Failed to parse data"}), 500

    formats =[]
    seen = set()
    for f in (meta.get("formats") or[]):
        fid, ext = f.get("format_id", ""), f.get("ext", "")
        vcodec, acodec = f.get("vcodec", "none"), f.get("acodec", "none")
        height, fps = f.get("height"), f.get("fps")
        if vcodec == "none" and acodec == "none": continue

        label_parts =[]
        if height: label_parts.append(f"{height}p")
        if fps and fps > 30: label_parts.append(f"{int(fps)}fps")
        if ext: label_parts.append(ext.upper())

        category = "video" if vcodec != "none" else "audio"
        key = f"{height}-{ext}-{category}"
        if key in seen: continue
        seen.add(key)

        formats.append({
            "format_id": fid, "ext": ext, "height": height, "fps": fps,
            "category": category, "label": " · ".join(label_parts) or fid,
            "filesize": f.get("filesize") or f.get("filesize_approx")
        })
    formats.sort(key=lambda x: (0 if x["category"] == "video" else 1, -(x["height"] or 0)))

    is_playlist = data.get("playlist") and len(lines) > 1
    response = {
        "title": meta.get("title"),
        "uploader": meta.get("uploader") or meta.get("channel"),
        "duration": meta.get("duration"),
        "thumbnail": meta.get("thumbnail"),
        "formats": formats,
        "is_playlist": is_playlist,
        "original_url": url,
    }
    return jsonify(response)

@app.route("/api/download/start", methods=["POST"])
def start_download():
    data = request.get_json(silent=True) or {}
    url  = (data.get("url") or "").strip()
    if not url: return jsonify({"error": "URL is required"}), 400
    if not is_valid_url(url): return jsonify({"error": "Invalid URL"}), 422

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "progress": 0, "url": url, "created_at": time.time()}

    threading.Thread(target=_download_worker, args=(job_id, url, data), daemon=True).start()
    return jsonify({"job_id": job_id})

def _download_worker(job_id: str, url: str, opts: dict):
    cleanup_old_files()
    output_template = str(DOWNLOAD_DIR / "%(title)s.%(ext)s")
    args =[url, "--output", output_template, "--no-warnings", "--newline", "--progress"]
    
    if opts.get("audio_only"):
        args +=["-x", "--audio-format", opts.get("audio_format", "mp3"), "--audio-quality", "0"]
    elif opts.get("format_id"):
        args +=["-f", f"{opts.get('format_id')}+bestaudio/best"]
    elif opts.get("quality"):
        args += ["-f", f"{opts.get('quality')}+bestaudio/best"]
    else:
        args += ["-f", "bestvideo+bestaudio/best"]

    args += get_cookies_args()
    if not opts.get("audio_only"): args +=["--merge-output-format", "mp4"]

    with jobs_lock: jobs[job_id]["status"] = "downloading"

    try:
        proc = subprocess.Popen(["yt-dlp"] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        output_filename = None
        for line in proc.stdout:
            if "[download]" in line and "%" in line:
                m = re.search(r"(\d+\.?\d*)%.*?at\s+([\d.]+\s*\S+/s).*?ETA\s+(\S+)", line)
                if m:
                    with jobs_lock:
                        jobs[job_id].update({"progress": float(m.group(1)), "speed": m.group(2), "eta": m.group(3)})
            if "Destination:" in line: output_filename = line.split("Destination:")[-1].strip()
        proc.wait(timeout=600)
        
        candidate = _find_latest_file(hint_name=output_filename)
        if candidate and candidate.stat().st_mtime > time.time() - 60:
            with jobs_lock:
                jobs[job_id].update({"status": "completed", "progress": 100, "filename": candidate.name, "filepath": str(candidate)})
        else:
            with jobs_lock: jobs[job_id].update({"status": "error", "error": "Download failed."})
    except Exception as e:
        with jobs_lock: jobs[job_id].update({"status": "error", "error": str(e)})

@app.route("/api/download/status/<job_id>", methods=["GET"])
def job_status(job_id: str):
    with jobs_lock: job = jobs.get(job_id)
    if not job: return jsonify({"error": "Job not found"}), 404
    return jsonify(job)

@app.route("/api/download/file/<job_id>", methods=["GET"])
def serve_file(job_id: str):
    with jobs_lock: job = jobs.get(job_id)
    if not job or job.get("status") != "completed": return jsonify({"error": "Not ready"}), 404
    return send_file(job["filepath"], as_attachment=True, download_name=sanitize_filename(Path(job["filepath"]).name))

@app.route("/api/download/cancel/<job_id>", methods=["DELETE"])
@app.route("/api/history/<job_id>", methods=["DELETE"])
def cancel_job(job_id: str):
    with jobs_lock: job = jobs.pop(job_id, None)
    if job and job.get("filepath") and Path(job["filepath"]).exists():
        try: Path(job["filepath"]).unlink()
        except OSError: pass
    return jsonify({"message": "Job removed"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, threaded=True)
