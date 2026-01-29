import { appState } from '../state'

export async function handleHighlightHeading(payload: {
  level: number
  text: string
}): Promise<{ success: boolean; error?: string }> {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const level = typeof payload?.level === 'number' ? Math.floor(payload.level) : 0
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (level < 1 || level > 6) {
    return { success: false, error: 'Invalid heading level' }
  }
  if (!text.trim()) {
    return { success: false, error: 'Empty heading text' }
  }

  try {
    const js = `
      (function() {
        try {
          let overlayCleanup = null;
          const clearOverlayWithCleanup = () => {
            try {
              if (overlayCleanup) { try { overlayCleanup(); } catch (e) { /* noop */ } overlayCleanup = null; }
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const clearOverlay = clearOverlayWithCleanup;
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.setProperty('position', 'fixed', 'important');
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.setProperty('position', 'fixed', 'important');
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const level = ${level};
          const targetRaw = ${JSON.stringify(text)};
          const normalize = (s) => String(s || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
          const target = normalize(targetRaw);
          const list = Array.from(document.querySelectorAll('h' + level));
          const exact = list.find((el) => normalize(el && el.textContent) === target) || null;
          const partial = exact ? exact : (list.find((el) => normalize(el && el.textContent).includes(target)) || null);
          const el = partial;
          if (!el) return false;

          const ensureSmoothScroll = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_smooth');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_smooth';
              st.textContent = 'html,body,*{scroll-behavior:smooth !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el, maxMs) => {
            const timeout = typeof maxMs === 'number' && maxMs > 0 ? maxMs : 2500;
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > timeout) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = ensureSmoothScroll();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView({ behavior: 'smooth' }); } catch (e2) { /* noop */ } }
            await waitStable(el, 2500);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
              const onUpdate = () => { try { positionBox(ov.box, el); } catch (e) { /* noop */ } };
              window.addEventListener('scroll', onUpdate, true);
              window.addEventListener('resize', onUpdate);
              overlayCleanup = () => {
                window.removeEventListener('scroll', onUpdate, true);
                window.removeEventListener('resize', onUpdate);
              };
            }

            setTimeout(() => {
              clearOverlay();
            }, 1500);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await appState.browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function handleHighlightLink(url: string): Promise<{ success: boolean; error?: string }> {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    return { success: false, error: 'Empty URL' }
  }
  try {
    const js = `
      (function() {
        try {
          const clearOverlay = () => {
            try {
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.setProperty('position', 'fixed', 'important');
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.setProperty('position', 'fixed', 'important');
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const targetRaw = ${JSON.stringify(target)};
          const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
          const strip = (u) => {
            try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch (e) { return ''; }
          };
          const target = norm(targetRaw);
          const targetNoQuery = strip(target);

          const openDetailsChain = (el) => {
            const opened = [];
            try {
              let d = el && el.closest ? el.closest('details') : null;
              while (d) {
                if (!d.open) { d.open = true; opened.push(d); }
                d = d.parentElement && d.parentElement.closest ? d.parentElement.closest('details') : null;
              }
            } catch (e) { /* noop */ }
            return opened;
          };

          const isVisible = (el) => {
            try {
              if (!el) return false;
              const rects = el.getClientRects();
              if (!rects || rects.length === 0) return false;
              const st = window.getComputedStyle(el);
              if (!st) return true;
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              if (Number(st.opacity || '1') <= 0.01) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const pickHighlightTarget = (el) => {
            let cur = el;
            for (let i = 0; i < 8 && cur; i += 1) {
              if (isVisible(cur)) {
                const r = cur.getBoundingClientRect();
                const area = Math.max(0, r.width) * Math.max(0, r.height);
                if (area >= 120) return cur;
              }
              cur = cur.parentElement;
            }
            return el;
          };

          const list = Array.from(document.querySelectorAll('a[href]'));

          const state = (window.__crawlite_link_cycle_state = window.__crawlite_link_cycle_state || Object.create(null));
          const pickCycled = (key, arr) => {
            try {
              if (!arr || arr.length === 0) return null;
              const raw = state[key];
              const idx = (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) ? Math.floor(raw) : 0;
              const chosen = arr[idx % arr.length] || null;
              state[key] = idx + 1;
              return chosen;
            } catch (e) {
              return (arr && arr.length > 0) ? (arr[0] || null) : null;
            }
          };

          const exactAll = list.filter((a) => norm(a && a.href) === target);
          const exactVisible = exactAll.filter((a) => isVisible(a));
          const exact = (exactVisible.length > 0 ? exactVisible : exactAll);

          const sameNoQueryAll = list.filter((a) => {
            const href = norm(a && a.href);
            const hrefNoQuery = strip(href);
            return Boolean(hrefNoQuery && targetNoQuery && hrefNoQuery === targetNoQuery);
          });
          const sameNoQueryVisible = sameNoQueryAll.filter((a) => isVisible(a));
          const sameNoQuery = (sameNoQueryVisible.length > 0 ? sameNoQueryVisible : sameNoQueryAll);

          let best = pickCycled('exact:' + target, exact);
          if (!best) {
            best = pickCycled('noquery:' + targetNoQuery, sameNoQuery);
          }

          if (!best) {
            const scored = list.map((a) => {
              const href = norm(a && a.href);
              const hrefNoQuery = strip(href);
              let score = 0;
              if (href === target) score += 100;
              if (hrefNoQuery && targetNoQuery && hrefNoQuery === targetNoQuery) score += 60;
              if (href && target && href.includes(target)) score += 20;
              if (target && href && target.includes(href)) score += 10;
              if (isVisible(a)) score += 15;
              return { a, score };
            }).sort((x, y) => y.score - x.score);
            best = scored.length > 0 ? scored[0].a : null;
          }
          if (!best) return false;
          openDetailsChain(best);
          const el = pickHighlightTarget(best);

          const disableSmooth = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_fix');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_fix';
              st.textContent = 'html,body,*{scroll-behavior:auto !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el) => {
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > 800) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = disableSmooth();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
            await waitStable(el);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
            }

            setTimeout(() => {
              clearOverlay();
            }, 1400);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await appState.browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function handleHighlightImage(url: string): Promise<{ success: boolean; error?: string }> {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    return { success: false, error: 'Empty URL' }
  }
  try {
    const js = `
      (function() {
        try {
          const clearOverlay = () => {
            try {
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.setProperty('position', 'fixed', 'important');
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.setProperty('position', 'fixed', 'important');
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const targetRaw = ${JSON.stringify(target)};
          const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
          const strip = (u) => {
            try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch (e) { return ''; }
          };
          const target = norm(targetRaw);
          const targetNoQuery = strip(target);
          const filename = (u) => {
            try { const x = new URL(u); const p = String(x.pathname || '').split('/').filter(Boolean).pop() || ''; return p.toLowerCase(); } catch (e) { return ''; }
          };
          const targetFile = filename(target);

          const isVisible = (el) => {
            try {
              if (!el) return false;
              const rects = el.getClientRects();
              if (!rects || rects.length === 0) return false;
              const st = window.getComputedStyle(el);
              if (!st) return true;
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              if (Number(st.opacity || '1') <= 0.01) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const pickUrl = (img) => {
            try {
              const c = img && img.currentSrc ? String(img.currentSrc) : '';
              const s = img && img.src ? String(img.src) : '';
              const a = img && img.getAttribute ? String(img.getAttribute('src') || '') : '';
              const d = img && img.getAttribute ? String(img.getAttribute('data-src') || '') : '';
              return norm(c || s || a || d);
            } catch (e) {
              return '';
            }
          };

          const list = Array.from(document.querySelectorAll('img'));
          const scored = list.map((img) => {
            const u = pickUrl(img);
            const uNoQuery = strip(u);
            let score = 0;
            if (u === target) score += 120;
            if (uNoQuery && targetNoQuery && uNoQuery === targetNoQuery) score += 80;
            if (targetFile && filename(u) === targetFile) score += 35;
            if (u && target && (u.includes(target) || target.includes(u))) score += 15;
            if (isVisible(img)) score += 15;
            return { img, score };
          }).sort((a, b) => b.score - a.score);

          const best = scored.length > 0 ? scored[0].img : null;
          if (!best) return false;

          let el = best;
          for (let i = 0; i < 6 && el; i += 1) {
            if (isVisible(el)) {
              const r = el.getBoundingClientRect();
              const area = Math.max(0, r.width) * Math.max(0, r.height);
              if (area >= 160) break;
            }
            el = el.parentElement;
          }
          el = el || best;

          const disableSmooth = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_fix');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_fix';
              st.textContent = 'html,body,*{scroll-behavior:auto !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el) => {
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > 800) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = disableSmooth();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
            await waitStable(el);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
            }

            setTimeout(() => {
              clearOverlay();
            }, 1400);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await appState.browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
