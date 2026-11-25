import * as cheerio from 'cheerio';

const TIMEOUT_MS = 7000;
const MAX_HTML_BYTES = 2_000_000;
const CURRENT_YEAR = new Date().getFullYear();

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFinderBot/1.0; +https://example.invalid/bot)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkWebsite(websiteUri) {
  if (!websiteUri) {
    return {
      status: 'keine_website',
      label: 'Keine Website',
      score: 100,
      reasons: ['Kein Website-Eintrag bei Google Maps hinterlegt'],
      finalUrl: '',
    };
  }

  let res;
  try {
    res = await fetchWithTimeout(websiteUri);
  } catch (err) {
    return {
      status: 'nicht_erreichbar',
      label: 'Website nicht erreichbar',
      score: 95,
      reasons: [`Abruf fehlgeschlagen: ${err.name === 'AbortError' ? 'Timeout' : err.message}`],
      finalUrl: websiteUri,
    };
  }

  const finalUrl = res.url || websiteUri;
  const reasons = [];
  let score = 0;

  if (!res.ok) {
    reasons.push(`HTTP-Status ${res.status}`);
    score += 20;
  }

  const buf = await res.arrayBuffer();
  const html = Buffer.from(buf.slice(0, MAX_HTML_BYTES)).toString('utf-8');
  const $ = cheerio.load(html);

  if (!finalUrl.startsWith('https://')) {
    reasons.push('Kein HTTPS');
    score += 25;
  }

  if ($('meta[name="viewport"]').length === 0) {
    reasons.push('Nicht mobil-optimiert (kein viewport-Meta-Tag)');
    score += 25;
  }

  if ($('frameset, frame').length > 0) {
    reasons.push('Nutzt veraltete HTML-Frames');
    score += 20;
  }

  if ($('object[type="application/x-shockwave-flash"]').length > 0 || /\.swf(\?|"|')/i.test(html)) {
    reasons.push('Nutzt Flash-Inhalte');
    score += 20;
  }

  const years = (html.match(/\b20\d{2}\b/g) || []).map(Number).filter((y) => y <= CURRENT_YEAR);
  const maxYear = years.length ? Math.max(...years) : null;
  if (maxYear && maxYear <= CURRENT_YEAR - 5) {
    reasons.push(`Älteste gefundene Jahreszahl auf der Seite: ${maxYear}`);
    score += 15;
  }

  if (!$('title').text().trim()) {
    reasons.push('Kein Seitentitel (<title> fehlt)');
    score += 5;
  }

  if (reasons.length === 0) {
    reasons.push('Keine auffaelligen Probleme gefunden');
  }

  const status = score >= 40 ? 'veraltet' : 'ok';
  const label = status === 'veraltet' ? 'Veraltete Website' : 'Wirkt aktuell';

  return { status, label, score: Math.min(score, 100), reasons, finalUrl };
}
