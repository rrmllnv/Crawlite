import type { WebContentsView } from 'electron'
import type { CrawlPageData } from '../types'
import { normalizeUrl } from './urlUtils'

const EXTRACT_PAGE_DATA_JS = `
(function() {
  const text = (v) => (typeof v === 'string' ? v : '');
  const pickMeta = (name) => {
    const el = document.querySelector('meta[name="' + name + '"]');
    const content = el && el.getAttribute ? el.getAttribute('content') : '';
    return text(content).trim();
  };

  const title = text(document.title).trim();
  const hasViewport = Boolean((function() {
    try {
      const el = document.querySelector('meta[name="viewport"]');
      const v = el && el.getAttribute ? String(el.getAttribute('content') || '').trim() : '';
      return Boolean(v);
    } catch (e) { return false; }
  })());

  let canonicalUrl = '';
  try {
    const c = document.querySelector('link[rel="canonical"][href]');
    canonicalUrl = c && c.href ? String(c.href) : '';
  } catch (e) { canonicalUrl = ''; }
  const hasCanonical = Boolean(String(canonicalUrl || '').trim());
  const isVisible = (el) => {
    try {
      if (!el) return false;
      const rects = el.getClientRects();
      if (!rects || rects.length === 0) return false;
      const style = window.getComputedStyle(el);
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    } catch (e) {
      return true;
    }
  };
  const normText = (s) => text(s).trim().replace(/\\s+/g, ' ').slice(0, 300);

  const allH1 = Array.from(document.querySelectorAll('h1')).filter((el) => isVisible(el));
  let chosen = null;
  let bestLen = -1;
  for (const el of allH1) {
    const t = normText(el && el.textContent);
    if (!t) continue;
    if (t.length > bestLen) {
      bestLen = t.length;
      chosen = el;
    }
  }
  const h1 = normText(chosen && chosen.textContent);
  const description = pickMeta('description').slice(0, 500);
  const keywords = pickMeta('keywords').slice(0, 500);
  const metaRobots = pickMeta('robots').slice(0, 500);

  const uniqKeepOrder = (arr) => {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const v = String(item || '').trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= 200) break;
    }
    return out;
  };

  const collectHeadingTexts = (sel) => {
    try {
      const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => isVisible(el));
      const texts = nodes.map((el) => normText(el && el.textContent)).filter(Boolean);
      return uniqKeepOrder(texts);
    } catch (e) {
      return [];
    }
  };

  const headingsText = {
    h1: collectHeadingTexts('h1'),
    h2: collectHeadingTexts('h2'),
    h3: collectHeadingTexts('h3'),
    h4: collectHeadingTexts('h4'),
    h5: collectHeadingTexts('h5'),
    h6: collectHeadingTexts('h6'),
  };

  const count = (sel) => {
    try {
      const n = document.querySelectorAll(sel).length;
      return (typeof n === 'number' && Number.isFinite(n)) ? n : 0;
    } catch (e) {
      return 0;
    }
  };

  const headingsCount = {
    h1: headingsText.h1.length || count('h1'),
    h2: headingsText.h2.length || count('h2'),
    h3: headingsText.h3.length || count('h3'),
    h4: headingsText.h4.length || count('h4'),
    h5: headingsText.h5.length || count('h5'),
    h6: headingsText.h6.length || count('h6'),
  };

  const headingsRawCount = {
    h1: count('h1'),
    h2: count('h2'),
    h3: count('h3'),
    h4: count('h4'),
    h5: count('h5'),
    h6: count('h6'),
  };

  const emptyCount = (sel) => {
    try {
      const nodes = Array.from(document.querySelectorAll(sel));
      let n = 0;
      for (const el of nodes) {
        const t = normText(el && el.textContent);
        if (!t) n += 1;
      }
      return n;
    } catch (e) {
      return 0;
    }
  };
  const headingsEmptyCount = {
    h1: emptyCount('h1'),
    h2: emptyCount('h2'),
    h3: emptyCount('h3'),
    h4: emptyCount('h4'),
    h5: emptyCount('h5'),
    h6: emptyCount('h6'),
  };

  const nestedHeadings = (function() {
    try {
      const issues = [];
      const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      for (const parent of all) {
        const child = parent && parent.querySelector ? parent.querySelector('h1,h2,h3,h4,h5,h6') : null;
        if (!child) continue;
        const p = String(parent.tagName || '').toLowerCase();
        const c = String(child.tagName || '').toLowerCase();
        if (!p || !c) continue;
        issues.push(p + ' содержит ' + c);
        if (issues.length >= 20) break;
      }
      return Array.from(new Set(issues));
    } catch (e) {
      return [];
    }
  })();

  let htmlBytes = null;
  try {
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    if (typeof TextEncoder !== 'undefined') {
      htmlBytes = new TextEncoder().encode(String(html || '')).length;
    } else {
      htmlBytes = String(html || '').length;
    }
  } catch (e) {
    htmlBytes = null;
  }

  const isHttpLike = (s) => /^https?:\\/\\//i.test(String(s || ''));
  const absUrl = (raw) => {
    try { return String(new URL(String(raw || ''), window.location.href).toString()); } catch (e) { return ''; }
  };
  const isDocOrMedia = (u) => {
    try {
      const x = new URL(String(u || ''));
      const p = String(x.pathname || '').toLowerCase();
      const ext = p.includes('.') ? (p.split('.').pop() || '') : '';
      const e = ext.split('?')[0].split('#')[0];
      const blocked = new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','zip','rar','7z','tar','gz','bz2','xz','exe','msi','dmg','apk','mp4','webm','mkv','mov','avi','wmv','flv','m4v','mp3','wav','flac','ogg','m4a']);
      return blocked.has(String(e || '').toLowerCase());
    } catch (e) {
      return false;
    }
  };

  const rawLinks = [];
  const rawLinksDetailed = [];
  const rawMisc = [];

  Array.from(document.querySelectorAll('a[href]')).forEach((a) => {
    try {
      const raw = a && a.getAttribute ? String(a.getAttribute('href') || '') : '';
      const v = String(raw || '').trim();
      if (!v) return;
      if (v.startsWith('#') || /^mailto:/i.test(v) || /^tel:/i.test(v) || /^javascript:/i.test(v)) {
        rawMisc.push(v);
        return;
      }
      const abs = absUrl(v);
      if (!abs) {
        rawMisc.push(v);
        return;
      }
      if (isHttpLike(abs) && !isDocOrMedia(abs)) {
        rawLinks.push(abs);
        rawLinksDetailed.push({ url: abs, anchor: normText(a && a.textContent).slice(0, 300) });
      } else {
        rawMisc.push(abs);
      }
    } catch (e) {
      rawMisc.push(String((a && a.href) || '').trim());
    }
  });

  const rawImages = [];
  Array.from(document.querySelectorAll('img[src]')).forEach((img) => {
    const raw = img && img.getAttribute ? String(img.getAttribute('src') || '') : '';
    const abs = absUrl(raw);
    if (!abs) return;
    if (isHttpLike(abs)) rawImages.push(abs);
    else rawMisc.push(abs);
  });

  const rawScripts = [];
  Array.from(document.querySelectorAll('script[src]')).forEach((s) => {
    const raw = s && s.getAttribute ? String(s.getAttribute('src') || '') : '';
    const abs = absUrl(raw);
    if (!abs) return;
    if (isHttpLike(abs)) rawScripts.push(abs);
    else rawMisc.push(abs);
  });

  const rawStyles = [];
  Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).forEach((l) => {
    const raw = l && l.getAttribute ? String(l.getAttribute('href') || '') : '';
    const abs = absUrl(raw);
    if (!abs) return;
    if (isHttpLike(abs)) rawStyles.push(abs);
    else rawMisc.push(abs);
  });

  Array.from(document.querySelectorAll('link[href]')).forEach((l) => {
    try {
      const rel = l && l.getAttribute ? String(l.getAttribute('rel') || '') : '';
      if (String(rel).toLowerCase().includes('stylesheet')) {
        return;
      }
      const raw = l && l.getAttribute ? String(l.getAttribute('href') || '') : '';
      const abs = absUrl(raw);
      if (!abs) return;
      rawMisc.push(abs);
    } catch (e) {
      void 0;
    }
  });

  const uniq = (arr) => Array.from(new Set(arr));
  const uniqLinksDetailed = (arr) => {
    const byUrl = new Map();
    for (const it of (arr || [])) {
      const url = it && it.url ? String(it.url).trim() : '';
      if (!url) continue;
      const anchor = it && typeof it.anchor === 'string' ? String(it.anchor).trim() : '';
      const prev = byUrl.get(url);
      if (!prev) {
        byUrl.set(url, { url, anchor });
        continue;
      }
      if (!prev.anchor && anchor) {
        byUrl.set(url, { url, anchor });
      }
    }
    return Array.from(byUrl.values());
  };
  return {
    url: String(window.location.href || ''),
    title,
    h1,
    hasViewport,
    hasCanonical,
    canonicalUrl: String(canonicalUrl || ''),
    headingsRawCount,
    headingsEmptyCount,
    nestedHeadings,
    headingsText,
    headingsCount,
    htmlBytes,
    description,
    keywords,
    metaRobots,
    links: uniq(rawLinks),
    linksDetailed: uniqLinksDetailed(rawLinksDetailed),
    images: uniq(rawImages),
    scripts: uniq(rawScripts),
    stylesheets: uniq(rawStyles),
    misc: uniq(rawMisc),
  };
})()
`

export type ExtractedPageData = Omit<
  CrawlPageData,
  'statusCode' | 'contentLength' | 'loadTimeMs' | 'analysisTimeMs' | 'discoveredAt' | 'ipAddress'
> & { htmlBytes: number | null }

export async function extractPageDataFromView(view: WebContentsView): Promise<ExtractedPageData> {
  const data = await view.webContents.executeJavaScript(EXTRACT_PAGE_DATA_JS)

  const url = typeof data?.url === 'string' ? data.url : ''
  return {
    url,
    normalizedUrl: normalizeUrl(url),
    title: typeof data?.title === 'string' ? data.title : '',
    h1: typeof data?.h1 === 'string' ? data.h1 : '',
    hasViewport: Boolean((data as any)?.hasViewport),
    hasCanonical: Boolean((data as any)?.hasCanonical),
    canonicalUrl: typeof (data as any)?.canonicalUrl === 'string' ? (data as any).canonicalUrl : '',
    metaRobots: typeof (data as any)?.metaRobots === 'string' ? (data as any).metaRobots : '',
    headingsRawCount:
      data && typeof data === 'object' && (data as any).headingsRawCount && typeof (data as any).headingsRawCount === 'object'
        ? {
            h1: typeof (data as any).headingsRawCount.h1 === 'number' ? (data as any).headingsRawCount.h1 : 0,
            h2: typeof (data as any).headingsRawCount.h2 === 'number' ? (data as any).headingsRawCount.h2 : 0,
            h3: typeof (data as any).headingsRawCount.h3 === 'number' ? (data as any).headingsRawCount.h3 : 0,
            h4: typeof (data as any).headingsRawCount.h4 === 'number' ? (data as any).headingsRawCount.h4 : 0,
            h5: typeof (data as any).headingsRawCount.h5 === 'number' ? (data as any).headingsRawCount.h5 : 0,
            h6: typeof (data as any).headingsRawCount.h6 === 'number' ? (data as any).headingsRawCount.h6 : 0,
          }
        : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    headingsEmptyCount:
      data && typeof data === 'object' && (data as any).headingsEmptyCount && typeof (data as any).headingsEmptyCount === 'object'
        ? {
            h1: typeof (data as any).headingsEmptyCount.h1 === 'number' ? (data as any).headingsEmptyCount.h1 : 0,
            h2: typeof (data as any).headingsEmptyCount.h2 === 'number' ? (data as any).headingsEmptyCount.h2 : 0,
            h3: typeof (data as any).headingsEmptyCount.h3 === 'number' ? (data as any).headingsEmptyCount.h3 : 0,
            h4: typeof (data as any).headingsEmptyCount.h4 === 'number' ? (data as any).headingsEmptyCount.h4 : 0,
            h5: typeof (data as any).headingsEmptyCount.h5 === 'number' ? (data as any).headingsEmptyCount.h5 : 0,
            h6: typeof (data as any).headingsEmptyCount.h6 === 'number' ? (data as any).headingsEmptyCount.h6 : 0,
          }
        : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    nestedHeadings: Array.isArray((data as any)?.nestedHeadings)
      ? (data as any).nestedHeadings.filter((x: unknown) => typeof x === 'string')
      : [],
    headingsText:
      data && typeof data === 'object' && (data as any).headingsText && typeof (data as any).headingsText === 'object'
        ? {
            h1: Array.isArray((data as any).headingsText.h1) ? (data as any).headingsText.h1.filter((x: unknown) => typeof x === 'string') : [],
            h2: Array.isArray((data as any).headingsText.h2) ? (data as any).headingsText.h2.filter((x: unknown) => typeof x === 'string') : [],
            h3: Array.isArray((data as any).headingsText.h3) ? (data as any).headingsText.h3.filter((x: unknown) => typeof x === 'string') : [],
            h4: Array.isArray((data as any).headingsText.h4) ? (data as any).headingsText.h4.filter((x: unknown) => typeof x === 'string') : [],
            h5: Array.isArray((data as any).headingsText.h5) ? (data as any).headingsText.h5.filter((x: unknown) => typeof x === 'string') : [],
            h6: Array.isArray((data as any).headingsText.h6) ? (data as any).headingsText.h6.filter((x: unknown) => typeof x === 'string') : [],
          }
        : { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    headingsCount:
      data && typeof data === 'object' && (data as any).headingsCount && typeof (data as any).headingsCount === 'object'
        ? {
            h1: typeof (data as any).headingsCount.h1 === 'number' ? (data as any).headingsCount.h1 : 0,
            h2: typeof (data as any).headingsCount.h2 === 'number' ? (data as any).headingsCount.h2 : 0,
            h3: typeof (data as any).headingsCount.h3 === 'number' ? (data as any).headingsCount.h3 : 0,
            h4: typeof (data as any).headingsCount.h4 === 'number' ? (data as any).headingsCount.h4 : 0,
            h5: typeof (data as any).headingsCount.h5 === 'number' ? (data as any).headingsCount.h5 : 0,
            h6: typeof (data as any).headingsCount.h6 === 'number' ? (data as any).headingsCount.h6 : 0,
          }
        : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    description: typeof data?.description === 'string' ? data.description : '',
    keywords: typeof data?.keywords === 'string' ? data.keywords : '',
    links: Array.isArray(data?.links) ? data.links.filter((x: unknown) => typeof x === 'string') : [],
    linksDetailed: Array.isArray((data as any)?.linksDetailed)
      ? (data as any).linksDetailed
          .map((x: any) => ({ url: String(x?.url || '').trim(), anchor: String(x?.anchor || '').trim() }))
          .filter((x: any) => x.url)
      : [],
    images: Array.isArray(data?.images) ? data.images.filter((x: unknown) => typeof x === 'string') : [],
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: unknown) => typeof x === 'string') : [],
    stylesheets: Array.isArray(data?.stylesheets) ? data.stylesheets.filter((x: unknown) => typeof x === 'string') : [],
    misc: Array.isArray((data as any)?.misc) ? (data as any).misc.filter((x: unknown) => typeof x === 'string') : [],
    htmlBytes:
      typeof (data as any)?.htmlBytes === 'number' && Number.isFinite((data as any).htmlBytes)
        ? Math.trunc((data as any).htmlBytes)
        : null,
  }
}
