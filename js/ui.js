/**
 * LunarYtdl — UI Utilities
 * Toasts, tabs, scroll effects, micro-interactions
 * Author: Syawaliuz Octavian
 */

const UI = (function () {
  'use strict';

  // ── Toast System ──────────────────────────────────────────
  const toastContainer = document.getElementById('toastContainer');
  const toastQueue = [];
  let toastActive = false;

  function toast(message, type = 'info', duration = 3500) {
    toastQueue.push({ message, type, duration });
    if (!toastActive) processQueue();
  }

  function processQueue() {
    if (!toastQueue.length) { toastActive = false; return; }
    toastActive = true;

    const { message, type, duration } = toastQueue.shift();
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);

    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => {
        el.remove();
        processQueue();
      }, { once: true });
    }, duration);
  }

  // ── Tab System ────────────────────────────────────────────
  function initTabs(containerSelector, tabSelector, panelSelector) {
    const tabs   = document.querySelectorAll(tabSelector);
    const panels = document.querySelectorAll(panelSelector);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t   => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        panels.forEach(p => { p.classList.remove('tab-panel--active'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const panel = document.getElementById(`panel${capitalize(target)}`);
        if (panel) {
          panel.classList.add('tab-panel--active');
          panel.style.animation = 'none';
          panel.offsetHeight; // reflow
          panel.style.animation = '';
        }
      });
    });
  }

  // ── Header scroll effect ──────────────────────────────────
  function initScrollHeader() {
    const header = document.getElementById('header');
    if (!header) return;
    const handler = () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', handler, { passive: true });
    handler();
  }

  // ── Scroll reveal ─────────────────────────────────────────
  function initScrollReveal() {
    const els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    els.forEach(el => obs.observe(el));
  }

  // ── Add data-reveal to section elements ───────────────────
  function addRevealAttrs() {
    const cards = document.querySelectorAll('.feature-card, .stat-card');
    cards.forEach((el, i) => {
      el.setAttribute('data-reveal', '');
      el.setAttribute('data-delay', Math.min(i + 1, 4).toString());
    });
    document.querySelectorAll('.section__header, .video-meta-card, .options-tabs').forEach(el => {
      el.setAttribute('data-reveal', '');
    });
  }

  // ── Steps management ─────────────────────────────────────
  function showStep(id) {
    document.querySelectorAll('.panel__step').forEach(s => {
      s.classList.add('hidden');
    });
    const step = document.getElementById(id);
    if (step) {
      step.classList.remove('hidden');
      step.style.animation = 'none';
      step.offsetHeight;
      step.style.animation = '';
    }
  }

  // ── Format number ─────────────────────────────────────────
  function formatNumber(n) {
    if (!n) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  // ── Format date ───────────────────────────────────────────
  function formatDate(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length < 8) return '—';
    const y = yyyymmdd.slice(0, 4);
    const m = yyyymmdd.slice(4, 6);
    const d = yyyymmdd.slice(6, 8);
    return new Date(`${y}-${m}-${d}`).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  // ── Format file size ──────────────────────────────────────
  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  // ── Duration seconds to string ────────────────────────────
  function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h) return `${h}:${pad(m)}:${pad(s)}`;
    return `${m}:${pad(s)}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── Clipboard paste ───────────────────────────────────────
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      return text.trim();
    } catch {
      return null;
    }
  }

  // ── Mobile nav burger ────────────────────────────────────
  function initBurger() {
    const burger = document.getElementById('navBurger');
    const links  = document.querySelector('.nav__links');
    if (!burger || !links) return;

    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      links.style.display = open ? '' : 'flex';
      links.style.position = 'fixed';
      links.style.top = 'var(--header-h)';
      links.style.left = '0'; links.style.right = '0';
      links.style.flexDirection = 'column';
      links.style.padding = '1.5rem';
      links.style.background = 'rgba(5 8 22 / 0.95)';
      links.style.backdropFilter = 'blur(16px)';
      links.style.borderBottom = '1px solid var(--clr-border)';
    });

    // Close on link click
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        burger.setAttribute('aria-expanded', 'false');
        links.style.display = '';
      });
    });
  }

  // ── Smooth anchor scroll ─────────────────────────────────
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    initScrollHeader();
    addRevealAttrs();
    initScrollReveal();
    initTabs('.options-tabs', '.tab', '.tab-panel');
    initBurger();
    initSmoothScroll();
  }

  // Public API
  return {
    toast,
    showStep,
    formatNumber,
    formatDate,
    formatSize,
    formatDuration,
    pasteFromClipboard,
    init,
  };
})();