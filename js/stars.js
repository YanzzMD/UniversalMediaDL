/**
 * LunarYtdl — Starfield Engine (v2 Optimized)
 * Procedural star particle system with parallax & shooting stars
 * Author: Syawaliuz Octavian
 * v2: Reduced CPU/GPU load, battery-aware, device-tier detection
 */

(function StarfieldEngine() {
  'use strict';

  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });

  // ── Detect device tier for adaptive quality ───────────────
  const LOW_END = (
    navigator.hardwareConcurrency <= 2 ||
    navigator.deviceMemory <= 2 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  if (LOW_END) {
    // On low-end devices, skip canvas entirely and use CSS fallback
    canvas.style.display = 'none';
    return;
  }

  // ── Config — reduced counts vs original ──────────────────
  const CONFIG = {
    layers: [
      { count: 100, speed: 0.012, minR: 0.3, maxR: 0.8,  alpha: 0.45 },
      { count: 60,  speed: 0.025, minR: 0.5, maxR: 1.1,  alpha: 0.7  },
      { count: 25,  speed: 0.05,  minR: 0.9, maxR: 1.8,  alpha: 0.95 },
    ],
    shootingStarInterval: 4500,
    shootingStarChance:   0.28,
    fpsTarget: 45, // 45fps is plenty for background stars — saves ~25% GPU
    parallaxStrength: 0.018,
    colorPalette: ['#ffffff', '#c4b5fd', '#a5f3fc', '#e2e8f0', '#fde68a'],
  };

  // ── State ─────────────────────────────────────────────────
  let W, H;
  let stars    = [];
  let shooters = [];
  let mouseX = 0, mouseY = 0;
  let targetMouseX = 0, targetMouseY = 0;
  let frame    = 0;
  let lastShot = 0;
  let animId;
  let lastTime = 0;
  let isHidden = false;
  const fpsInterval = 1000 / CONFIG.fpsTarget;

  // ── Star class ────────────────────────────────────────────
  class Star {
    constructor(layer, layerIdx) {
      this.layer    = layer;
      this.layerIdx = layerIdx;
      this.reset(true);
    }

    reset(init = false) {
      this.x           = Math.random() * W;
      this.y           = init ? Math.random() * H : -2;
      this.r           = rand(this.layer.minR, this.layer.maxR);
      this.baseAlpha   = this.layer.alpha * rand(0.4, 1.0);
      this.alpha       = this.baseAlpha;
      this.color       = pickRandom(CONFIG.colorPalette);
      this.twinkleSpeed  = rand(0.005, 0.022);
      this.twinkleOffset = Math.random() * Math.PI * 2;
    }

    update(t) {
      this.y += this.layer.speed;
      if (this.y > H + 2) this.reset();

      // Twinkle
      this.alpha = this.baseAlpha * (0.65 + 0.35 * Math.sin(t * this.twinkleSpeed + this.twinkleOffset));
    }

    draw() {
      const pFactor = (this.layerIdx + 1) * CONFIG.parallaxStrength;
      const rx = this.x + mouseX * pFactor;
      const ry = this.y + mouseY * pFactor;

      ctx.globalAlpha = clamp(this.alpha, 0, 1);

      // Only add glow for larger stars (perf optimization)
      if (this.r > 1.4) {
        const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, this.r * 2.5);
        g.addColorStop(0, this.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(rx, ry, this.r * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(rx, ry, this.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Shooting Star ─────────────────────────────────────────
  class ShootingStar {
    constructor() {
      this.x     = rand(W * 0.1, W * 0.9);
      this.y     = rand(H * 0.0, H * 0.25);
      this.len   = rand(80, 180);
      this.speed = rand(7, 16);
      this.angle = rand(30, 60) * (Math.PI / 180);
      this.alpha = 1;
      this.decay = rand(0.013, 0.026);
      this.color = Math.random() > 0.5 ? '#c4b5fd' : '#67e8f9';
      this.width = rand(1, 2.2);
      this.active = true;
    }

    update() {
      this.x     += Math.cos(this.angle) * this.speed;
      this.y     += Math.sin(this.angle) * this.speed;
      this.alpha -= this.decay;
      if (this.alpha <= 0) this.active = false;
    }

    draw() {
      ctx.globalAlpha = clamp(this.alpha, 0, 1);

      const tailX = this.x - Math.cos(this.angle) * this.len;
      const tailY = this.y - Math.sin(this.angle) * this.len;

      const grad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.6, this.color + '80');
      grad.addColorStop(1, this.color);

      ctx.strokeStyle = grad;
      ctx.lineWidth   = this.width;
      ctx.lineCap     = 'round';
      ctx.shadowColor = this.color;
      ctx.shadowBlur  = 6;

      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle  = '#fff';
      ctx.globalAlpha = this.alpha * 0.85;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.width * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Utils ─────────────────────────────────────────────────
  const rand       = (lo, hi) => Math.random() * (hi - lo) + lo;
  const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp      = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── Resize ────────────────────────────────────────────────
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildStars();
  }

  function buildStars() {
    stars = [];
    CONFIG.layers.forEach((layer, idx) => {
      for (let i = 0; i < layer.count; i++) stars.push(new Star(layer, idx));
    });
  }

  // ── Render loop ───────────────────────────────────────────
  function loop(timestamp) {
    animId = requestAnimationFrame(loop);
    if (isHidden) return;

    const elapsed = timestamp - lastTime;
    if (elapsed < fpsInterval) return;
    lastTime = timestamp - (elapsed % fpsInterval);
    frame++;

    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    const t = frame * 0.016;

    // Batch draw stars
    for (let i = 0; i < stars.length; i++) {
      stars[i].update(t);
      stars[i].draw();
    }

    ctx.globalAlpha = 1;

    // Shooting stars
    if (timestamp - lastShot > CONFIG.shootingStarInterval && Math.random() < CONFIG.shootingStarChance) {
      shooters.push(new ShootingStar());
      lastShot = timestamp;
    }

    for (let i = shooters.length - 1; i >= 0; i--) {
      shooters[i].update();
      shooters[i].draw();
      if (!shooters[i].active) shooters.splice(i, 1);
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  // ── Mouse parallax — throttled ────────────────────────────
  let mouseRAF = null;
  window.addEventListener('mousemove', (e) => {
    targetMouseX = (e.clientX - W / 2) * 0.4;
    targetMouseY = (e.clientY - H / 2) * 0.4;
    if (!mouseRAF) {
      mouseRAF = requestAnimationFrame(() => {
        mouseX   += (targetMouseX - mouseX) * 0.07;
        mouseY   += (targetMouseY - mouseY) * 0.07;
        mouseRAF = null;
      });
    }
  }, { passive: true });

  // ── Visibility API — pause when tab hidden ────────────────
  document.addEventListener('visibilitychange', () => {
    isHidden = document.hidden;
    if (!isHidden) {
      lastTime = 0;
    }
  });

  // ── Init ──────────────────────────────────────────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }, { passive: true });

  resize();
  requestAnimationFrame(loop);

})();