import { appState } from '../state'

type ToggleResult = {
  success: boolean
  enabledAll?: boolean
  enabledHover?: boolean
  error?: string
}

async function runToggle(kind: 'all' | 'hover'): Promise<ToggleResult> {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }

  try {
    const js = `
      (function () {
        try {
          const TOGGLE_KIND = ${JSON.stringify(kind)};
          const STATE_KEY = '__crawlite_inspector_elements_state';
          const STYLE_ID = '__crawlite_inspector_elements_style';
          const LABELS_ID = '__crawlite_inspector_elements_labels';
          const HOVER_BOX_ID = '__crawlite_inspector_elements_hover_box';
          const HOVER_LABEL_ID = '__crawlite_inspector_elements_hover_label';
          const DATA_ATTR = 'data-crawlite-inspector-el';
          const LABEL_CLASS = '__crawlite_inspector_el_label';

          const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
          const toInt = (v) => {
            const n = Math.round(Number(v));
            return Number.isFinite(n) ? n : 0;
          };
          const safeText = (s, maxLen) => {
            try {
              const x = String(s || '').replace(/\\s+/g, ' ').trim();
              if (!x) return '';
              const m = typeof maxLen === 'number' && maxLen > 0 ? Math.floor(maxLen) : 140;
              return x.length > m ? (x.slice(0, m - 1) + '…') : x;
            } catch (e) {
              return '';
            }
          };

          const isProbablyVisible = (el) => {
            try {
              if (!el) return false;
              const rects = el.getClientRects();
              if (!rects || rects.length === 0) return false;
              const st = window.getComputedStyle(el);
              if (!st) return true;
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              const op = Number(st.opacity || '1');
              if (Number.isFinite(op) && op <= 0.01) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const hasAnyText = (el) => {
            try {
              if (!el) return false;
              const tn = el.childNodes;
              if (!tn || tn.length === 0) return false;
              for (let i = 0; i < tn.length; i += 1) {
                const n = tn[i];
                if (n && n.nodeType === 3) {
                  const t = String(n.textContent || '');
                  if (t.trim()) return true;
                }
              }
              return false;
            } catch (e) {
              return false;
            }
          };

          const getRect = (el) => {
            try {
              return el.getBoundingClientRect();
            } catch (e) {
              return null;
            }
          };

          const isInViewport = (rect) => {
            try {
              const vw = window.innerWidth || 0;
              const vh = window.innerHeight || 0;
              if (!vw || !vh) return false;
              if (rect.right < 0 || rect.bottom < 0) return false;
              if (rect.left > vw || rect.top > vh) return false;
              const w = Math.max(0, rect.width);
              const h = Math.max(0, rect.height);
              if (w * h < 6) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const ensureStyle = () => {
            try {
              let st = document.getElementById(STYLE_ID);
              if (st) return st;
              st = document.createElement('style');
              st.id = STYLE_ID;
              st.textContent = [
                '[' + DATA_ATTR + '="1"]{outline:2px solid rgba(255,100,100,0.9) !important;outline-offset:-1px !important;}',
                '#' + LABELS_ID + '{position:fixed !important;inset:0 !important;pointer-events:none !important;z-index:2147483647 !important;}',
                '.' + LABEL_CLASS + '{position:fixed !important;pointer-events:none !important;z-index:2147483647 !important;max-width:280px !important;',
                  'padding:2px 6px !important;border-radius:6px !important;',
                  'background:rgba(0,0,0,0.65) !important;color:#fff !important;',
                  'border:1px solid rgba(255,100,100,0.9) !important;',
                  'font:11px/1.25 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;',
                  'white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;',
                '}',
                '#' + HOVER_BOX_ID + '{position:fixed !important;pointer-events:none !important;z-index:2147483647 !important;',
                  'border:2px solid rgba(255,100,100,0.9) !important;background:rgba(255,100,100,0.08) !important;',
                  'border-radius:10px !important;box-shadow:0 0 0 1px rgba(0,0,0,0.25) !important;',
                '}',
                '#' + HOVER_LABEL_ID + '{position:fixed !important;pointer-events:none !important;z-index:2147483647 !important;max-width:320px !important;',
                  'padding:3px 8px !important;border-radius:8px !important;',
                  'background:rgba(0,0,0,0.72) !important;color:#fff !important;',
                  'border:1px solid rgba(255,100,100,0.9) !important;',
                  'font:12px/1.25 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;',
                  'white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;',
                '}',
              ].join('\\n');
              document.documentElement.appendChild(st);
              return st;
            } catch (e) {
              return null;
            }
          };

          const ensureLabelsRoot = () => {
            try {
              let root = document.getElementById(LABELS_ID);
              if (root) return root;
              root = document.createElement('div');
              root.id = LABELS_ID;
              document.documentElement.appendChild(root);
              return root;
            } catch (e) {
              return null;
            }
          };

          const removeById = (id) => {
            try {
              const el = document.getElementById(id);
              if (el) el.remove();
            } catch (e) { /* noop */ }
          };

          const ensureHoverOverlay = () => {
            try {
              let box = document.getElementById(HOVER_BOX_ID);
              if (!box) {
                box = document.createElement('div');
                box.id = HOVER_BOX_ID;
                document.documentElement.appendChild(box);
              }
              let label = document.getElementById(HOVER_LABEL_ID);
              if (!label) {
                label = document.createElement('div');
                label.id = HOVER_LABEL_ID;
                document.documentElement.appendChild(label);
              }
              try { box.style.setProperty('display', 'none', 'important'); } catch (e) { /* noop */ }
              try { label.style.setProperty('display', 'none', 'important'); } catch (e) { /* noop */ }
              return { box, label };
            } catch (e) {
              return null;
            }
          };

          const cleanupAll = (state) => {
            try {
              if (!state) return;
              if (typeof state.cleanupAll === 'function') {
                try { state.cleanupAll(); } catch (e) { /* noop */ }
              }
            } catch (e) { /* noop */ }
            try {
              const marked = state && Array.isArray(state.marked) ? state.marked : [];
              for (let i = 0; i < marked.length; i += 1) {
                try {
                  const el = marked[i];
                  if (el && el.removeAttribute) el.removeAttribute(DATA_ATTR);
                } catch (e) { /* noop */ }
              }
            } catch (e) { /* noop */ }

            removeById(LABELS_ID);
          };

          const cleanupHover = (state) => {
            try {
              if (!state) return;
              if (typeof state.cleanupHover === 'function') {
                try { state.cleanupHover(); } catch (e) { /* noop */ }
              }
            } catch (e) { /* noop */ }
            removeById(HOVER_BOX_ID);
            removeById(HOVER_LABEL_ID);
          };

          const INTERESTING_SELECTOR = 'img,input,textarea,select,button,label,a,h1,h2,h3,h4,h5,h6';
          const root = document.body || document.documentElement;

          const addCandidate = (el, candidates) => {
            try {
              if (!el || !el.tagName) return;
              const tag = String(el.tagName || '').toLowerCase();
              if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link') return;
              if (el.id === LABELS_ID || el.id === STYLE_ID) return;
              if (el.id === HOVER_BOX_ID || el.id === HOVER_LABEL_ID) return;
              if (candidates && typeof candidates.add === 'function') candidates.add(el);
            } catch (e) { /* noop */ }
          };

          const makeInfo = (el, rect) => {
            const tag = String(el.tagName || '').toLowerCase();
            const w = toInt(rect.width);
            const h = toInt(rect.height);
            const parts = [];
            parts.push('<' + tag + '>');
            parts.push(w + '×' + h);

            try {
              if (tag === 'img' && el instanceof HTMLImageElement) {
                const nw = toInt(el.naturalWidth);
                const nh = toInt(el.naturalHeight);
                if (nw > 0 && nh > 0) parts.push('natural ' + nw + '×' + nh);
              }
            } catch (e) { /* noop */ }

            if (tag === 'input') {
              try {
                const type = String(el.getAttribute('type') || '').trim().toLowerCase() || 'text';
                parts.push('type=' + type);
                const name = safeText(el.getAttribute('name') || '', 30);
                if (name) parts.push('name=' + name);
              } catch (e) { /* noop */ }
            } else if (tag === 'textarea') {
              try {
                const name = safeText(el.getAttribute('name') || '', 30);
                if (name) parts.push('name=' + name);
              } catch (e) { /* noop */ }
            } else if (tag === 'select') {
              try {
                const opts = el && el.options ? el.options.length : 0;
                parts.push('options=' + String(toInt(opts)));
                const name = safeText(el.getAttribute('name') || '', 30);
                if (name) parts.push('name=' + name);
              } catch (e) { /* noop */ }
            } else if (tag === 'button') {
              try {
                const type = String(el.getAttribute('type') || '').trim().toLowerCase() || 'button';
                parts.push('type=' + type);
              } catch (e) { /* noop */ }
            } else if (tag === 'label') {
              try {
                const f = safeText(el.getAttribute('for') || '', 40);
                if (f) parts.push('for=' + f);
              } catch (e) { /* noop */ }
            } else if (tag === 'a') {
              try {
                const href = safeText(el.getAttribute('href') || '', 80);
                if (href) parts.push(href);
              } catch (e) { /* noop */ }
            }

            // Для любого "текстового" элемента показываем цвет.
            try {
              if (hasAnyText(el)) {
                const st = window.getComputedStyle(el);
                const c = st && st.color ? String(st.color) : '';
                if (c) parts.push('color=' + c);
              }
            } catch (e) { /* noop */ }

            return parts.join(' • ');
          };

          let state = window[STATE_KEY];
          if (!state || typeof state !== 'object') {
            state = {
              enabledAll: false,
              enabledHover: false,
              marked: [],
              labelsByKey: Object.create(null),
              cleanupAll: null,
              cleanupHover: null,
              clickBlocker: null,
              raf: 0,
              hoverRaf: 0,
              hoverEl: null,
            };
            window[STATE_KEY] = state;
          }

          const ensureBase = () => {
            ensureStyle();
          };

          const ensureClickBlocker = () => {
            try {
              if (state.clickBlocker && state.clickBlocker.enabled) return;

              const INSPECT_LAST_KEY = '__crawlite_inspector_selected_element';
              const INSPECT_LOG_PREFIX = '__CRAWLITE_INSPECTOR_ELEMENT__:';

              const shouldIgnoreTarget = (t) => {
                try {
                  if (!t) return false;
                  const id = String(t.id || '');
                  if (id === LABELS_ID || id === STYLE_ID || id === HOVER_BOX_ID || id === HOVER_LABEL_ID) return true;
                  return false;
                } catch (e) {
                  return false;
                }
              };

              const buildRect = (el) => {
                try {
                  const r = el.getBoundingClientRect();
                  return {
                    left: Number(r.left) || 0,
                    top: Number(r.top) || 0,
                    right: Number(r.right) || 0,
                    bottom: Number(r.bottom) || 0,
                    width: Number(r.width) || 0,
                    height: Number(r.height) || 0,
                  };
                } catch (e) {
                  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
                }
              };

              const buildAttributes = (el) => {
                try {
                  const out = Object.create(null);
                  if (!el || !el.attributes) return out;
                  const attrs = el.attributes;
                  for (let i = 0; i < attrs.length; i += 1) {
                    const a = attrs[i];
                    if (!a) continue;
                    const n = String(a.name || '');
                    if (!n) continue;
                    out[n] = String(a.value || '');
                  }
                  return out;
                } catch (e) {
                  return Object.create(null);
                }
              };

              const buildComputedStyles = (el) => {
                try {
                  const st = window.getComputedStyle(el);
                  const out = Object.create(null);
                  if (!st) return out;
                  for (let i = 0; i < st.length; i += 1) {
                    const prop = st[i];
                    if (!prop) continue;
                    try {
                      out[String(prop)] = String(st.getPropertyValue(prop));
                    } catch (e) { /* noop */ }
                  }
                  return out;
                } catch (e) {
                  return Object.create(null);
                }
              };

              const buildUserStyles = (el) => {
                try {
                  const merged = Object.create(null);
                  const rulesOut = [];
                  const rulesOutBefore = [];
                  const rulesOutAfter = [];

                  const rulesMeta = [];
                  const rulesMetaBefore = [];
                  const rulesMetaAfter = [];

                  let rulesOrder = 0;
                  if (!el) return { merged, rules: rulesOut, rulesBefore: rulesOutBefore, rulesAfter: rulesOutAfter };

                  // 1) Inline styles (style="...")
                  // (дальше pushRule, поэтому inline добавляем тем же путём)

                  // 2) Styles from accessible stylesheets (best-effort; cross-origin may throw)
                  const extractDecl = (styleDecl) => {
                    try {
                      const decl = Object.create(null);
                      if (!styleDecl || typeof styleDecl.length !== 'number') return;
                      for (let i = 0; i < styleDecl.length; i += 1) {
                        const name = styleDecl[i];
                        if (!name) continue;
                        const value = String(styleDecl.getPropertyValue(name) || '').trim();
                        const pr = String(styleDecl.getPropertyPriority(name) || '').trim();
                        if (!value) continue;
                        const v = pr ? (value + ' !' + pr) : value;
                        decl[name] = v;
                      }
                      return decl;
                    } catch (e) { /* noop */ }
                  };

                  const getSheetSource = (sheet) => {
                    try {
                      const href = sheet && sheet.href ? String(sheet.href) : '';
                      if (href) return href;
                      const owner = sheet && sheet.ownerNode ? sheet.ownerNode : null;
                      const tag = owner && owner.tagName ? String(owner.tagName).toLowerCase() : '';
                      if (tag === 'style') return '<style>';
                      if (tag === 'link') return '<link>';
                      return '<stylesheet>';
                    } catch (e) {
                      return '<stylesheet>';
                    }
                  };

                  const MAX_RULES = 120;
                  const MAX_DECLS_PER_RULE = 220;

                  const splitSelectorList = (selText) => {
                    try {
                      const src = String(selText || '');
                      const out = [];
                      let buf = '';
                      let par = 0;
                      let br = 0;
                      let quote = '';
                      for (let i = 0; i < src.length; i += 1) {
                        const ch = src[i];
                        if (quote) {
                          buf += ch;
                          if (ch === '\\\\') {
                            if (i + 1 < src.length) { buf += src[i + 1]; i += 1; }
                            continue;
                          }
                          if (ch === quote) quote = '';
                          continue;
                        }
                        if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
                        if (ch === '(') { par += 1; buf += ch; continue; }
                        if (ch === ')') { par = Math.max(0, par - 1); buf += ch; continue; }
                        if (ch === '[') { br += 1; buf += ch; continue; }
                        if (ch === ']') { br = Math.max(0, br - 1); buf += ch; continue; }
                        if (ch === ',' && par === 0 && br === 0) {
                          const v = String(buf || '').trim();
                          if (v) out.push(v);
                          buf = '';
                          continue;
                        }
                        buf += ch;
                      }
                      const last = String(buf || '').trim();
                      if (last) out.push(last);
                      return out;
                    } catch (e) {
                      return String(selText || '').split(',').map((x) => String(x || '').trim()).filter(Boolean);
                    }
                  };

                  const compareSpec = (a, b) => {
                    try {
                      const a0 = a && a.length ? (a[0] | 0) : 0;
                      const a1 = a && a.length ? (a[1] | 0) : 0;
                      const a2 = a && a.length ? (a[2] | 0) : 0;
                      const b0 = b && b.length ? (b[0] | 0) : 0;
                      const b1 = b && b.length ? (b[1] | 0) : 0;
                      const b2 = b && b.length ? (b[2] | 0) : 0;
                      if (a0 !== b0) return a0 - b0;
                      if (a1 !== b1) return a1 - b1;
                      return a2 - b2;
                    } catch (e) { return 0; }
                  };

                  const calcSpecificity = (selector) => {
                    try {
                      let s = String(selector || '');
                      if (!s) return [0, 0, 0];
                      // Убираем строки, чтобы не ловить символы внутри кавычек.
                      // ВАЖНО: это код внутри template string, поэтому backslash нужно экранировать.
                      s = s.replace(/"([^"\\\\]|\\\\.)*"/g, '""').replace(/'([^'\\\\]|\\\\.)*'/g, "''");
                      // :not() не даёт специфику само по себе, но аргументы учитываются.
                      s = s.replace(/:not\\(/g, '(');

                      const ids = (s.match(/#[\\w-]+/g) || []).length;
                      const classes = (s.match(/\\.[\\w-]+/g) || []).length;
                      const attrs = (s.match(/\\[[^\\]]+\\]/g) || []).length;

                      const pseudoElements1 = (s.match(/::[\\w-]+/g) || []).length;
                      const pseudoElements2 = (s.match(/:(before|after|first-line|first-letter)\\b/g) || []).length;
                      const pseudoElements = pseudoElements1 + pseudoElements2;

                      const pseudoClassesRaw = (s.match(/:(?!:)[\\w-]+(\\([^)]*\\))?/g) || []).length;
                      const pseudoClasses = Math.max(0, pseudoClassesRaw - pseudoElements2);

                      // Type selectors
                      let types = 0;
                      const re = /(^|[\\s>+~,(])([a-zA-Z][\\w-]*)/g;
                      let m;
                      while ((m = re.exec(s))) {
                        const name = String(m[2] || '').toLowerCase();
                        if (!name) continue;
                        if (name === '*') continue;
                        types += 1;
                      }

                      return [ids, classes + attrs + pseudoClasses, types + pseudoElements];
                    } catch (e) {
                      return [0, 0, 0];
                    }
                  };

                  const extractPseudoClasses = (selector) => {
                    try {
                      let s = String(selector || '');
                      if (!s) return [];
                      // Убираем строки/эскейпы, чтобы не ловить ":" внутри кавычек.
                      s = s.replace(/"([^"\\\\]|\\\\.)*"/g, '""').replace(/'([^'\\\\]|\\\\.)*'/g, "''");
                      const out = [];
                      const re = /:(?!:)[a-zA-Z-]+(?:\\([^)]*\\))?/g;
                      let m;
                      while ((m = re.exec(s))) {
                        const v = String(m[0] || '').trim();
                        if (v) out.push(v);
                        if (out.length > 80) break;
                      }
                      return out;
                    } catch (e) {
                      return [];
                    }
                  };

                  const getPseudoElementKind = (selector) => {
                    try {
                      const s = String(selector || '');
                      if (/::before\b/i.test(s) || /:before\b/i.test(s)) return 'before';
                      if (/::after\b/i.test(s) || /:after\b/i.test(s)) return 'after';
                      return null;
                    } catch (e) {
                      return null;
                    }
                  };

                  const stripPseudoElement = (selector) => {
                    try {
                      return String(selector || '')
                        .replace(/::before\b/gi, '')
                        .replace(/::after\b/gi, '')
                        .replace(/:before\b/gi, '')
                        .replace(/:after\b/gi, '');
                    } catch (e) {
                      return String(selector || '');
                    }
                  };

                  const getMatchedSpecificity = (selectorText, targetPseudo) => {
                    try {
                      const selectors = splitSelectorList(selectorText);
                      let best = [0, 0, 0];
                      let bestPseudo = [];
                      let matched = false;
                      for (let i = 0; i < selectors.length; i += 1) {
                        const sel = selectors[i];
                        if (!sel) continue;
                        const pseudoKind = getPseudoElementKind(sel);
                        if (targetPseudo) {
                          if (pseudoKind !== targetPseudo) continue;
                        } else {
                          if (pseudoKind) continue;
                        }
                        const baseSel = targetPseudo ? stripPseudoElement(sel) : sel;
                        try {
                          if (baseSel && el.matches && el.matches(baseSel)) {
                            matched = true;
                            const sp = calcSpecificity(baseSel);
                            if (compareSpec(sp, best) > 0) {
                              best = sp;
                              bestPseudo = extractPseudoClasses(baseSel);
                            }
                          }
                        } catch (e) { /* noop */ }
                      }
                      return matched ? { spec: best, pseudoClasses: bestPseudo } : null;
                    } catch (e) {
                      return null;
                    }
                  };

                  function pushRule(target, selectorText, styleDecl, sheetSource, mediaText, matchInfo, isInline) {
                    try {
                      const outArr = target === 'before' ? rulesOutBefore : target === 'after' ? rulesOutAfter : rulesOut;
                      const metaArr = target === 'before' ? rulesMetaBefore : target === 'after' ? rulesMetaAfter : rulesMeta;
                      if (outArr.length >= MAX_RULES) return;
                      const declAll = extractDecl(styleDecl) || Object.create(null);
                      const keys = Object.keys(declAll);
                      if (keys.length === 0) return;
                      // ограничение на размер
                      if (keys.length > MAX_DECLS_PER_RULE) {
                        const cut = Object.create(null);
                        keys.slice(0, MAX_DECLS_PER_RULE).forEach((k) => { cut[k] = declAll[k]; });
                        outArr.push({
                          selector: String(selectorText || '').trim(),
                          source: String(sheetSource || ''),
                          media: String(mediaText || ''),
                          declarations: cut,
                          truncated: true,
                          pseudoClasses: matchInfo && matchInfo.pseudoClasses ? matchInfo.pseudoClasses : [],
                        });
                        metaArr.push({ spec: (matchInfo && matchInfo.spec) ? matchInfo.spec : [0, 0, 0], order: rulesOrder, inline: Boolean(isInline) });
                        rulesOrder += 1;
                      } else {
                        outArr.push({
                          selector: String(selectorText || '').trim(),
                          source: String(sheetSource || ''),
                          media: String(mediaText || ''),
                          declarations: declAll,
                          pseudoClasses: matchInfo && matchInfo.pseudoClasses ? matchInfo.pseudoClasses : [],
                        });
                        metaArr.push({ spec: (matchInfo && matchInfo.spec) ? matchInfo.spec : [0, 0, 0], order: rulesOrder, inline: Boolean(isInline) });
                        rulesOrder += 1;
                      }
                      // merged — только для обычного элемента (не pseudo).
                      if (!target) {
                        for (let i = 0; i < keys.length; i += 1) {
                          const k = keys[i];
                          merged[k] = declAll[k];
                        }
                      }
                    } catch (e) { /* noop */ }
                  }

                  // 1) Inline styles (style="...")
                  try {
                    const st = el.style;
                    if (st && typeof st.length === 'number' && st.length > 0) {
                      pushRule(null, 'element.style', st, 'inline', '', { spec: [1000000, 0, 0], pseudoClasses: [] }, true);
                    }
                  } catch (e) { /* noop */ }

                  const walkRules = (rules, sheetSource, mediaText) => {
                    try {
                      if (!rules || typeof rules.length !== 'number') return;
                      for (let i = 0; i < rules.length; i += 1) {
                        const r = rules[i];
                        if (!r) continue;

                        // CSSStyleRule
                        if (r.type === 1 && r.selectorText && r.style) {
                          const selText = String(r.selectorText || '');
                          const matchMain = getMatchedSpecificity(selText, null);
                          if (matchMain) pushRule(null, selText, r.style, sheetSource, mediaText, matchMain, false);

                          const matchBefore = getMatchedSpecificity(selText, 'before');
                          if (matchBefore) pushRule('before', selText, r.style, sheetSource, mediaText, matchBefore, false);

                          const matchAfter = getMatchedSpecificity(selText, 'after');
                          if (matchAfter) pushRule('after', selText, r.style, sheetSource, mediaText, matchAfter, false);
                          continue;
                        }

                        // CSSMediaRule / CSSSupportsRule / etc. with nested cssRules
                        if (r.type === 4 && r.media && r.cssRules) {
                          const nextMedia = String(r.media.mediaText || '').trim();
                          let ok = true;
                          if (nextMedia) {
                            ok = false;
                            try {
                              ok = Boolean(window.matchMedia && window.matchMedia(nextMedia) && window.matchMedia(nextMedia).matches);
                            } catch (e) { ok = false; }
                          }
                          if (ok) {
                            const combined = mediaText ? (mediaText + ' & ' + nextMedia) : nextMedia;
                            walkRules(r.cssRules, sheetSource, combined);
                          }
                          continue;
                        }
                        if (r.cssRules) {
                          walkRules(r.cssRules, sheetSource, mediaText);
                        }
                      }
                    } catch (e) { /* noop */ }
                  };

                  try {
                    const sheets = document.styleSheets || [];
                    for (let i = 0; i < sheets.length; i += 1) {
                      const sheet = sheets[i];
                      if (!sheet) continue;
                      let rules = null;
                      try { rules = sheet.cssRules; } catch (e) { rules = null; }
                      if (!rules) continue;
                      walkRules(rules, getSheetSource(sheet), '');
                      if (rulesOut.length >= MAX_RULES) break;
                    }
                  } catch (e) { /* noop */ }

                  const finalizeRules = (arr, metaArr) => {
                    // Помечаем перебитые свойства (примерно как DevTools: зачёркнутые декларации).
                    const bestByProp = Object.create(null);
                    const isImportant = (v) => /!\\s*important\\s*$/i.test(String(v || ''));
                    const better = (cand, prev) => {
                      if (!prev) return true;
                      if (cand.important !== prev.important) return cand.important;
                      const sc = compareSpec(cand.spec, prev.spec);
                      if (sc !== 0) return sc > 0;
                      return (cand.order | 0) > (prev.order | 0);
                    };

                    for (let i = 0; i < arr.length; i += 1) {
                      const r = arr[i];
                      const decls = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null;
                      if (!decls) continue;
                      const meta = metaArr[i] || { spec: [0, 0, 0], order: i };
                      for (const k in decls) {
                        if (!Object.prototype.hasOwnProperty.call(decls, k)) continue;
                        const cand = {
                          idx: i,
                          important: isImportant(decls[k]),
                          spec: meta.spec || [0, 0, 0],
                          order: meta.order | 0,
                        };
                        const prev = bestByProp[k];
                        if (better(cand, prev)) bestByProp[k] = cand;
                      }
                    }

                    for (let i = 0; i < arr.length; i += 1) {
                      const r = arr[i];
                      const decls = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null;
                      if (!decls) continue;
                      const ov = Object.create(null);
                      for (const k in decls) {
                        if (!Object.prototype.hasOwnProperty.call(decls, k)) continue;
                        const win = bestByProp[k];
                        ov[k] = win ? (win.idx !== i) : false;
                      }
                      r.overridden = ov;
                    }

                    // Прокидываем метаданные правила (для сортировки/отображения).
                    for (let i = 0; i < arr.length; i += 1) {
                      const meta = metaArr[i] || null;
                      if (!meta) continue;
                      arr[i].specificity = meta.spec || [0, 0, 0];
                      arr[i].order = meta.order | 0;
                    }
                  };

                  try { finalizeRules(rulesOut, rulesMeta); } catch (e) { /* noop */ }
                  try { finalizeRules(rulesOutBefore, rulesMetaBefore); } catch (e) { /* noop */ }
                  try { finalizeRules(rulesOutAfter, rulesMetaAfter); } catch (e) { /* noop */ }

                  return { merged, rules: rulesOut, rulesBefore: rulesOutBefore, rulesAfter: rulesOutAfter };
                } catch (e) {
                  return { merged: Object.create(null), rules: [], rulesBefore: [], rulesAfter: [] };
                }
              };

              const buildNonDefaultStyles = (el, computed) => {
                try {
                  const out = Object.create(null);
                  if (!el || !el.tagName) return out;
                  const tag = String(el.tagName || '').toLowerCase();
                  if (!tag) return out;

                  const tmp = document.createElement(tag);
                  // чтобы не влиять на layout страницы
                  try {
                    tmp.style.position = 'absolute';
                    tmp.style.left = '-99999px';
                    tmp.style.top = '-99999px';
                    tmp.style.visibility = 'hidden';
                    tmp.style.pointerEvents = 'none';
                  } catch (e) { /* noop */ }

                  try {
                    (document.body || document.documentElement).appendChild(tmp);
                  } catch (e) { /* noop */ }

                  const base = buildComputedStyles(tmp);
                  try { tmp.remove(); } catch (e) { /* noop */ }

                  const src = computed && typeof computed === 'object' ? computed : Object.create(null);
                  for (const k in src) {
                    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
                    const v = String(src[k] || '');
                    const b = String(base[k] || '');
                    if (v !== b) out[k] = v;
                  }
                  return out;
                } catch (e) {
                  return Object.create(null);
                }
              };

              const buildChildrenSummary = (el) => {
                try {
                  const direct = el && el.children ? el.children : null;
                  const directCount = direct ? direct.length : 0;
                  const directTagCounts = Object.create(null);
                  if (direct && directCount > 0) {
                    for (let i = 0; i < directCount; i += 1) {
                      const c = direct[i];
                      const tag = c && c.tagName ? String(c.tagName).toLowerCase() : '';
                      if (!tag) continue;
                      directTagCounts[tag] = (directTagCounts[tag] || 0) + 1;
                    }
                  }
                  let descendantsCount = 0;
                  try {
                    descendantsCount = el && el.querySelectorAll ? el.querySelectorAll('*').length : 0;
                  } catch (e) {
                    descendantsCount = 0;
                  }
                  let directTextNodes = 0;
                  try {
                    const cn = el && el.childNodes ? el.childNodes : null;
                    if (cn && cn.length) {
                      for (let i = 0; i < cn.length; i += 1) {
                        const n = cn[i];
                        if (n && n.nodeType === 3 && String(n.textContent || '').trim()) directTextNodes += 1;
                      }
                    }
                  } catch (e) { /* noop */ }
                  return { directCount, directTagCounts, descendantsCount, directTextNodes };
                } catch (e) {
                  return { directCount: 0, directTagCounts: Object.create(null), descendantsCount: 0, directTextNodes: 0 };
                }
              };

              const captureElementInfo = (el) => {
                try {
                  if (!el || !el.tagName) return null;
                  const tag = String(el.tagName || '').toLowerCase();
                  const requestId = String(Date.now()) + ':' + String(Math.random()).slice(2);
                  const rect = buildRect(el);
                  const attributes = buildAttributes(el);
                  const styles = buildComputedStyles(el);
                  const stylesUserPack = buildUserStyles(el);
                  const stylesUser = stylesUserPack && stylesUserPack.merged ? stylesUserPack.merged : Object.create(null);
                  const stylesUserRules = stylesUserPack && stylesUserPack.rules ? stylesUserPack.rules : [];
                  const stylesUserRulesBefore = stylesUserPack && stylesUserPack.rulesBefore ? stylesUserPack.rulesBefore : [];
                  const stylesUserRulesAfter = stylesUserPack && stylesUserPack.rulesAfter ? stylesUserPack.rulesAfter : [];
                  const stylesNonDefault = buildNonDefaultStyles(el, styles);
                  const children = buildChildrenSummary(el);
                  const id = typeof el.id === 'string' ? el.id : '';
                  const className = typeof el.className === 'string' ? el.className : '';
                  const text = safeText(el.textContent || '', 220);
                  return {
                    requestId,
                    tag,
                    id,
                    className,
                    rect,
                    attributes,
                    styles,
                    stylesUser,
                    stylesUserRules,
                    stylesUserRulesBefore,
                    stylesUserRulesAfter,
                    stylesNonDefault,
                    children,
                    text,
                  };
                } catch (e) {
                  return null;
                }
              };

              const block = (evt) => {
                try {
                  if (!evt) return;
                  const t = evt.target || null;
                  if (shouldIgnoreTarget(t)) return;

                  // На обычный click сохраняем полный снимок элемента для панели инспектора.
                  try {
                    if (evt.type === 'click' && t && t.tagName) {
                      const payload = captureElementInfo(t);
                      if (payload) {
                        try { window[INSPECT_LAST_KEY] = payload; } catch (e) { /* noop */ }
                        try { console.log(INSPECT_LOG_PREFIX + payload.requestId); } catch (e) { /* noop */ }
                      }
                    }
                  } catch (e) { /* noop */ }

                  if (typeof evt.preventDefault === 'function') evt.preventDefault();
                  if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
                  if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
                } catch (e) { /* noop */ }
              };

              // capture=true чтобы перехватывать раньше обработчиков страницы
              window.addEventListener('click', block, true);
              window.addEventListener('auxclick', block, true);
              window.addEventListener('dblclick', block, true);

              state.clickBlocker = {
                enabled: true,
                cleanup: () => {
                  try { window.removeEventListener('click', block, true); } catch (e) { /* noop */ }
                  try { window.removeEventListener('auxclick', block, true); } catch (e) { /* noop */ }
                  try { window.removeEventListener('dblclick', block, true); } catch (e) { /* noop */ }
                },
              };
            } catch (e) { /* noop */ }
          };

          const disableClickBlocker = () => {
            try {
              if (!state.clickBlocker || !state.clickBlocker.enabled) return;
              if (typeof state.clickBlocker.cleanup === 'function') {
                try { state.clickBlocker.cleanup(); } catch (e) { /* noop */ }
              }
              state.clickBlocker = null;
            } catch (e) { /* noop */ }
          };

          const finalizeStateMaybe = () => {
            try {
              if (state.enabledAll || state.enabledHover) return;
              // Если оба режима выключены — полный cleanup.
              disableClickBlocker();
              cleanupAll(state);
              cleanupHover(state);
              removeById(LABELS_ID);
              removeById(HOVER_BOX_ID);
              removeById(HOVER_LABEL_ID);
              removeById(STYLE_ID);
              try { delete window[STATE_KEY]; } catch (e) { window[STATE_KEY] = null; }
            } catch (e) { /* noop */ }
          };

          const clearLabels = () => {
            try {
              const labelsRoot = document.getElementById(LABELS_ID);
              if (!labelsRoot) return;
              labelsRoot.textContent = '';
              state.labelsByKey = Object.create(null);
            } catch (e) { /* noop */ }
          };

          const updateLabels = () => {
            state.raf = 0;
            try {
              const labelsRoot = document.getElementById(LABELS_ID);
              if (!labelsRoot) return;
              const vw = window.innerWidth || 0;
              const vh = window.innerHeight || 0;
              if (!vw || !vh) return;

              const next = [];
              const marked = Array.isArray(state.marked) ? state.marked : [];
              for (let i = 0; i < marked.length; i += 1) {
                const el = marked[i];
                if (!el || !el.tagName) continue;
                if (!isProbablyVisible(el)) continue;

                const rect = getRect(el);
                if (!rect) continue;
                if (!isInViewport(rect)) continue;

                const tag = String(el.tagName || '').toLowerCase();
                const isTyped =
                  tag === 'img' ||
                  tag === 'input' ||
                  tag === 'textarea' ||
                  tag === 'select' ||
                  tag === 'button' ||
                  tag === 'label' ||
                  tag === 'a' ||
                  tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6';
                const isText = hasAnyText(el);
                if (!isTyped && !isText) continue;

                next.push({ el, rect, tag });
              }

              // Удаляем старые и пересобираем. (Проще и надёжнее, чем диффить.)
              clearLabels();

              const maxLabels = 420;
              for (let i = 0; i < next.length && i < maxLabels; i += 1) {
                const item = next[i];
                const el = item.el;
                const rect = item.rect;
                const info = makeInfo(el, rect);

                const label = document.createElement('div');
                label.className = LABEL_CLASS;
                label.textContent = info;

                const pad = 2;
                const labelW = 280;
                let x = toInt(rect.left) + pad;
                let y = toInt(rect.top) - 18;
                if (y < 2) y = toInt(rect.top) + pad;
                x = clamp(x, 2, Math.max(2, vw - labelW - 2));
                y = clamp(y, 2, Math.max(2, vh - 18 - 2));

                label.style.left = x + 'px';
                label.style.top = y + 'px';
                labelsRoot.appendChild(label);
              }
            } catch (e) { /* noop */ }
          };

          const scheduleUpdate = () => {
            try {
              if (state.raf) return;
              state.raf = window.requestAnimationFrame(updateLabels);
            } catch (e) { /* noop */ }
          };

          const hideHover = () => {
            try {
              const box = document.getElementById(HOVER_BOX_ID);
              const label = document.getElementById(HOVER_LABEL_ID);
              if (!box || !label) return;
              box.style.setProperty('display', 'none', 'important');
              label.style.setProperty('display', 'none', 'important');
              label.textContent = '';
            } catch (e) { /* noop */ }
          };

          const updateHover = () => {
            state.hoverRaf = 0;
            try {
              const hoverOverlay = ensureHoverOverlay();
              if (!hoverOverlay) return;
              const el = state.hoverEl;
              if (!el || !el.tagName) return hideHover();

              const tag = String(el.tagName || '').toLowerCase();
              if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link') {
                return hideHover();
              }
              if (el.id === LABELS_ID || el.id === STYLE_ID || el.id === HOVER_BOX_ID || el.id === HOVER_LABEL_ID) {
                return hideHover();
              }

              const rect = getRect(el);
              if (!rect) return hideHover();
              if (!isInViewport(rect)) return hideHover();
              if (!isProbablyVisible(el)) return hideHover();

              const pad = 4;
              const left = Math.max(2, toInt(rect.left) - pad);
              const top = Math.max(2, toInt(rect.top) - pad);
              const width = Math.max(0, toInt(rect.width) + pad * 2);
              const height = Math.max(0, toInt(rect.height) + pad * 2);

              hoverOverlay.box.style.left = left + 'px';
              hoverOverlay.box.style.top = top + 'px';
              hoverOverlay.box.style.width = width + 'px';
              hoverOverlay.box.style.height = height + 'px';
              hoverOverlay.box.style.setProperty('display', 'block', 'important');

              const info = makeInfo(el, rect);
              hoverOverlay.label.textContent = info;
              const vw = window.innerWidth || 0;
              const vh = window.innerHeight || 0;
              const labelW = 320;
              let lx = toInt(rect.left) + 2;
              let ly = toInt(rect.top) - 22;
              if (ly < 2) ly = toInt(rect.bottom) + 2;
              lx = clamp(lx, 2, Math.max(2, vw - labelW - 2));
              ly = clamp(ly, 2, Math.max(2, vh - 22 - 2));
              hoverOverlay.label.style.left = lx + 'px';
              hoverOverlay.label.style.top = ly + 'px';
              hoverOverlay.label.style.setProperty('display', 'block', 'important');
            } catch (e) {
              hideHover();
            }
          };

          const scheduleHoverUpdate = () => {
            try {
              if (state.hoverRaf) return;
              state.hoverRaf = window.requestAnimationFrame(updateHover);
            } catch (e) { /* noop */ }
          };

          const enableAll = () => {
            ensureBase();
            const labelsRoot = ensureLabelsRoot();
            const candidates = new Set();
            const marked = [];

            try {
              const list = Array.from(document.querySelectorAll(INTERESTING_SELECTOR));
              for (let i = 0; i < list.length; i += 1) addCandidate(list[i], candidates);
            } catch (e) { /* noop */ }

            // "Любой текст" — добавляем элементы, у которых есть непосредственные текстовые узлы.
            try {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
              let node = walker.nextNode();
              while (node) {
                try {
                  const t = String(node.textContent || '');
                  if (t.trim()) {
                    const p = node.parentElement;
                    if (p) addCandidate(p, candidates);
                  }
                } catch (e) { /* noop */ }
                node = walker.nextNode();
              }
            } catch (e) { /* noop */ }

            try {
              candidates.forEach((el) => {
                try {
                  if (!el || !el.setAttribute) return;
                  el.setAttribute(DATA_ATTR, '1');
                  marked.push(el);
                } catch (e) { /* noop */ }
              });
            } catch (e) { /* noop */ }

            state.marked = marked;
            state.enabledAll = true;

            const onScrollAll = () => scheduleUpdate();
            const onResizeAll = () => scheduleUpdate();
            try {
              window.addEventListener('scroll', onScrollAll, true);
              window.addEventListener('resize', onResizeAll);
            } catch (e) { /* noop */ }

            state.cleanupAll = () => {
              try { window.removeEventListener('scroll', onScrollAll, true); } catch (e) { /* noop */ }
              try { window.removeEventListener('resize', onResizeAll); } catch (e) { /* noop */ }
              try { if (state.raf) window.cancelAnimationFrame(state.raf); } catch (e) { /* noop */ }
              try { clearLabels(); } catch (e) { /* noop */ }
              try { if (labelsRoot) labelsRoot.textContent = ''; } catch (e) { /* noop */ }
            };

            scheduleUpdate();
          };

          const disableAll = () => {
            state.enabledAll = false;
            cleanupAll(state);
            state.marked = [];
            state.cleanupAll = null;
          };

          const enableHover = () => {
            ensureBase();
            ensureHoverOverlay();
            state.enabledHover = true;

            const onMouseMove = (evt) => {
              try {
                const t = evt && evt.target ? evt.target : null;
                state.hoverEl = (t && t.tagName) ? t : null;
                scheduleHoverUpdate();
              } catch (e) { /* noop */ }
            };
            const onScrollHover = () => scheduleHoverUpdate();
            const onResizeHover = () => scheduleHoverUpdate();
            try {
              window.addEventListener('mousemove', onMouseMove, true);
              window.addEventListener('scroll', onScrollHover, true);
              window.addEventListener('resize', onResizeHover);
            } catch (e) { /* noop */ }

            state.cleanupHover = () => {
              try { window.removeEventListener('mousemove', onMouseMove, true); } catch (e) { /* noop */ }
              try { window.removeEventListener('scroll', onScrollHover, true); } catch (e) { /* noop */ }
              try { window.removeEventListener('resize', onResizeHover); } catch (e) { /* noop */ }
              try { if (state.hoverRaf) window.cancelAnimationFrame(state.hoverRaf); } catch (e) { /* noop */ }
              try { hideHover(); } catch (e) { /* noop */ }
            };

            scheduleHoverUpdate();
          };

          const disableHover = () => {
            state.enabledHover = false;
            cleanupHover(state);
            state.cleanupHover = null;
            state.hoverEl = null;
          };

          if (TOGGLE_KIND === 'all') {
            if (state.enabledAll) disableAll();
            else enableAll();
          } else if (TOGGLE_KIND === 'hover') {
            if (state.enabledHover) disableHover();
            else enableHover();
          }

          // Пока любой режим включён — блокируем клики, чтобы страница не реагировала.
          if (state.enabledAll || state.enabledHover) ensureClickBlocker();
          else disableClickBlocker();

          finalizeStateMaybe();
          return { enabledAll: Boolean(state && state.enabledAll), enabledHover: Boolean(state && state.enabledHover) };
        } catch (e) {
          return { enabledAll: false, enabledHover: false, error: String(e) };
        }
      })();
    `

    const res = await appState.browserView.webContents.executeJavaScript(js, true)
    const enabledAll = Boolean(res && typeof res === 'object' && (res as any).enabledAll)
    const enabledHover = Boolean(res && typeof res === 'object' && (res as any).enabledHover)
    return { success: true, enabledAll, enabledHover }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function handleToggleInspectorElementsAll(): Promise<ToggleResult> {
  return runToggle('all')
}

export async function handleToggleInspectorElementsHover(): Promise<ToggleResult> {
  return runToggle('hover')
}

