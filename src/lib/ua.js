import { UAParser } from 'ua-parser-js';

export function parseUa(uaString) {
  const parser = new UAParser(uaString || '');
  const result = parser.getResult();
  // Store family names for clean dashboard grouping (full UA kept separately).
  let browser = result.browser.name || 'unknown';
  if (/^mobile\s+/i.test(browser)) browser = browser.replace(/^mobile\s+/i, '');
  const os = result.os.name || 'unknown';
  let device = 'desktop';
  const type = (result.device.type || '').toLowerCase();
  if (type === 'mobile') device = 'mobile';
  else if (type === 'tablet') device = 'tablet';
  else if (type === 'smarttv' || type === 'console' || type === 'wearable' || type === 'embedded') {
    device = type;
  }
  return { browser, os, device };
}

export function referrerHost(referrer, siteHost) {
  if (!referrer) return '';
  try {
    const u = new URL(referrer);
    const host = u.hostname.replace(/^www\./, '');
    if (siteHost && host === siteHost.replace(/^www\./, '')) return '';
    return host;
  } catch {
    return '';
  }
}
