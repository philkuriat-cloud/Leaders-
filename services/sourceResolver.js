import * as cheerio from 'cheerio';
import { searchPlaces } from './places.js';

const TIMEOUT_MS = 10000;
const PHONE_RE = /(\+49|0)[\d\s/()-]{6,}\d/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function isGoogleMapsUrl(url) {
  const host = new URL(url).hostname;
  return (
    host.includes('google.') && url.includes('/maps') ||
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl'
  );
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFinderBot/1.0)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function parsePlaceNameFromMapsUrl(finalUrl) {
  const match = finalUrl.match(/\/maps\/place\/([^/]+)/);
  if (!match) return null;
  return decodeURIComponent(match[1].replace(/\+/g, ' '));
}

async function resolveMapsLink(url) {
  const res = await fetchWithTimeout(url);
  const finalUrl = res.url || url;
  const html = await res.text();

  let name = parsePlaceNameFromMapsUrl(finalUrl);
  if (!name) {
    const $ = cheerio.load(html);
    name = ($('title').text() || '').replace(/\s*-\s*Google Maps\s*$/i, '').trim() || null;
  }
  if (!name) {
    throw new Error('Konnte keinen Betriebsnamen aus dem Google-Maps-Link lesen.');
  }

  const { places } = await searchPlaces({ query: name });
  const place = places[0];

  if (!place) {
    return {
      businessName: name,
      summary: `Betrieb "${name}" (aus Google-Maps-Link, Places API lieferte keine Details).`,
    };
  }

  const lines = [
    `Name: ${place.name}`,
    place.address ? `Adresse: ${place.address}` : null,
    place.phone ? `Telefon: ${place.phone}` : null,
    place.website ? `Bisherige Website (falls vorhanden): ${place.website}` : 'Keine Website bei Google Maps hinterlegt.',
    place.rating ? `Google-Bewertung: ${place.rating} (${place.ratingCount ?? 0} Bewertungen)` : null,
  ].filter(Boolean);

  return {
    businessName: place.name,
    address: place.address,
    phone: place.phone,
    summary: lines.join('\n'),
  };
}

async function resolveWebsiteLink(url) {
  const res = await fetchWithTimeout(url);
  const finalUrl = res.url || url;
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const headings = $('h1, h2').slice(0, 6).map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const paragraphs = $('p').slice(0, 10).map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 20);
  const bodyText = $('body').text().replace(/\s+/g, ' ');

  const phoneMatch = bodyText.match(PHONE_RE);
  const emailMatch = bodyText.match(EMAIL_RE);

  let image = $('meta[property="og:image"]').attr('content') || $('img').first().attr('src') || null;
  if (image) {
    try { image = new URL(image, finalUrl).href; } catch { image = null; }
  }

  const lines = [
    title ? `Seitentitel: ${title}` : null,
    metaDesc ? `Meta-Beschreibung: ${metaDesc}` : null,
    headings.length ? `Überschriften: ${headings.join(' / ')}` : null,
    paragraphs.length ? `Textauszüge:\n${paragraphs.slice(0, 5).map((p) => `- ${p.slice(0, 220)}`).join('\n')}` : null,
    phoneMatch ? `Telefon (gefunden): ${phoneMatch[0].trim()}` : null,
    emailMatch ? `E-Mail (gefunden): ${emailMatch[0].trim()}` : null,
    image ? `Referenzbild (bisherige Seite): ${image}` : null,
  ].filter(Boolean);

  return {
    businessName: title || null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    email: emailMatch ? emailMatch[0].trim() : null,
    image,
    summary: lines.join('\n') || '(Konnte keine verwertbaren Inhalte von der alten Website lesen.)',
  };
}

export async function resolveSource(url) {
  const sourceType = isGoogleMapsUrl(url) ? 'maps' : 'website';
  const data = sourceType === 'maps' ? await resolveMapsLink(url) : await resolveWebsiteLink(url);
  return { sourceType, ...data };
}
