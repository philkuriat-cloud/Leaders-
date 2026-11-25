import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { searchPlaces } from './services/places.js';
import { checkWebsite } from './services/websiteCheck.js';
import {
  upsertLead, listLeads, updateLeadStatus,
  insertContactRequest, listContactRequests, updateContactRequest,
  insertGeneratedSite, updateGeneratedSiteStatus, listGeneratedSites,
} from './db.js';
import { notifyContactRequest } from './services/mailer.js';
import { rateLimit } from './services/rateLimit.js';
import { resolveSource, generateSiteFromResolved, slugify } from './services/siteGenerator.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// --- Zugriffsschutz fuers interne Dashboard (/app und seine API-Routen) ---
// Das Kontaktformular-Backend (/api/contact) bleibt bewusst oeffentlich,
// das Dashboard mit den Leads/Kontaktanfragen nicht.
const { DASHBOARD_USER, DASHBOARD_PASS } = process.env;
const dashboardAuthConfigured = Boolean(DASHBOARD_USER && DASHBOARD_PASS);

if (!dashboardAuthConfigured) {
  console.warn(
    '[auth] DASHBOARD_USER/DASHBOARD_PASS sind nicht gesetzt - das Dashboard unter /app ' +
    'ist NICHT passwortgeschuetzt. Fuer den Live-Betrieb unbedingt in .env setzen!'
  );
}

function requireDashboardAuth(req, res, next) {
  if (!dashboardAuthConfigured) return next(); // lokale Entwicklung ohne Passwort

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    const userOk = timingSafeEqual(user, DASHBOARD_USER);
    const passOk = timingSafeEqual(pass, DASHBOARD_PASS);
    if (userOk && passOk) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="LeadFinder Dashboard"');
  return res.status(401).send('Zugriff verweigert.');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Optionales CORS fuer /api/contact - nur relevant, falls die Landingpage mal
// wieder getrennt (andere Domain) gehostet wird. Im Normalfall (ein Server,
// eine Domain fuer beides) ist das nicht noetig, schadet aber nicht.
const CONTACT_ALLOWED_ORIGIN = process.env.CONTACT_ALLOWED_ORIGIN || '*';
function withCors(req, res, next) {
  res.header('Access-Control-Allow-Origin', CONTACT_ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Oeffentliche Verkaufs-Landingpage (Root) ---
app.use(express.static(path.join(process.cwd(), 'public-site')));

// --- Internes Dashboard, passwortgeschuetzt ---
app.use('/app', requireDashboardAuth, express.static(path.join(process.cwd(), 'app')));

// --- Generierte Websites: oeffentlich abrufbar (Vorschau-Link fuer den Betrieb),
// das Erzeugen selbst ist unten hinter requireDashboardAuth.
app.use('/sites', express.static(path.join(process.cwd(), 'generated-sites')));

// Sucht Betriebe ueber Google Places und prueft jede gefundene Website.
// Ergebnisse werden direkt als Leads in der DB gespeichert (upsert ueber place_id).
app.post('/api/search', requireDashboardAuth, async (req, res) => {
  const { query, pageToken } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Feld "query" fehlt, z.B. "Friseure in Leipzig"' });
  }

  try {
    const { places, nextPageToken } = await searchPlaces({ query: query.trim(), pageToken });

    const results = [];
    for (const place of places) {
      const check = await checkWebsite(place.website);
      const lead = {
        id: place.id,
        name: place.name,
        address: place.address,
        phone: place.phone,
        website: place.website,
        final_url: check.finalUrl || '',
        rating: place.rating,
        rating_count: place.ratingCount,
        maps_url: place.mapsUrl,
        search_query: query.trim(),
        site_status: check.status,
        site_label: check.label,
        site_score: check.score,
        site_reasons: JSON.stringify(check.reasons),
      };
      upsertLead(lead);
      results.push(lead);
    }

    res.json({ count: results.length, nextPageToken, results });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// Baut aus einem Google-Maps-Link oder einer alten Website per Anthropic API
// automatisch eine neue Website. Rechenintensiv/teuer (externer API-Call) -
// daher hinter requireDashboardAuth und zusaetzlich rate-limitiert.
app.post(
  '/api/generate-site',
  requireDashboardAuth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }),
  async (req, res) => {
    const { url, notes } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: 'Feld "url" fehlt oder ist keine gueltige http(s)-Adresse.' });
    }
    if (notes && (typeof notes !== 'string' || notes.length > 3000)) {
      return res.status(400).json({ error: 'Feld "notes" ist zu lang.' });
    }

    const trimmedUrl = url.trim();
    let resolved;
    try {
      resolved = await resolveSource(trimmedUrl);
    } catch (err) {
      console.error('[generate-site] Quelle konnte nicht gelesen werden:', err);
      return res.status(502).json({ error: `Quelle konnte nicht gelesen werden: ${err.message}` });
    }

    const slug = slugify(resolved.businessName);
    insertGeneratedSite({
      slug,
      source_url: trimmedUrl,
      source_type: resolved.sourceType,
      business_name: resolved.businessName,
      notes: notes || '',
    });

    try {
      await generateSiteFromResolved({ url: trimmedUrl, resolved, notes, slug });
      updateGeneratedSiteStatus(slug, { status: 'done' });
      res.json({ slug, businessName: resolved.businessName, previewUrl: `/sites/${slug}/` });
    } catch (err) {
      console.error('[generate-site] Generierung fehlgeschlagen:', err);
      updateGeneratedSiteStatus(slug, { status: 'error', error_message: err.message });
      res.status(502).json({ error: err.message, slug });
    }
  }
);

app.get('/api/generated-sites', requireDashboardAuth, (req, res) => {
  res.json(listGeneratedSites());
});

// Oeffentlicher Endpunkt: Kontaktformular der Verkaufs-Landingpage.
// Speichert die Anfrage immer in der DB und verschickt zusaetzlich eine
// Benachrichtigungs-Mail, falls SMTP in .env konfiguriert ist.
app.options('/api/contact', withCors);
app.post(
  '/api/contact',
  withCors,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 8 }),
  async (req, res) => {
    const { name, betrieb, email, nachricht, website } = req.body || {};

    // Honeypot: ein verstecktes Feld, das normale Besucher nie ausfuellen,
    // Spam-Bots aber oft automatisch befuellen.
    if (website) {
      return res.json({ ok: true });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name fehlt.' });
    }
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'Gueltige E-Mail-Adresse fehlt.' });
    }
    if (name.length > 200 || (betrieb && betrieb.length > 200) || (nachricht && nachricht.length > 5000)) {
      return res.status(400).json({ error: 'Eingabe zu lang.' });
    }

    const request = insertContactRequest({
      name: name.trim(),
      betrieb: (betrieb || '').trim(),
      email: email.trim(),
      nachricht: (nachricht || '').trim(),
      source_ip: req.ip,
    });

    notifyContactRequest(request).catch((err) => console.error('[mailer] unerwarteter Fehler:', err));

    res.json({ ok: true });
  }
);

app.get('/api/contact-requests', requireDashboardAuth, (req, res) => {
  const { status } = req.query;
  res.json(listContactRequests({ status: status || undefined }));
});

app.patch('/api/contact-requests/:id', requireDashboardAuth, (req, res) => {
  const { status, notes } = req.body || {};
  const updated = updateContactRequest(req.params.id, { status, notes });
  if (!updated) return res.status(404).json({ error: 'Kontaktanfrage nicht gefunden' });
  res.json(updated);
});

app.get('/api/leads', requireDashboardAuth, (req, res) => {
  const { status } = req.query;
  const leads = listLeads({ status: status || undefined }).map((l) => ({
    ...l,
    site_reasons: safeParse(l.site_reasons),
  }));
  res.json(leads);
});

app.patch('/api/leads/:id', requireDashboardAuth, (req, res) => {
  const { lead_status, notes } = req.body || {};
  const updated = updateLeadStatus(req.params.id, { lead_status, notes });
  if (!updated) return res.status(404).json({ error: 'Lead nicht gefunden' });
  res.json({ ...updated, site_reasons: safeParse(updated.site_reasons) });
});

app.get('/api/leads/export.csv', requireDashboardAuth, (req, res) => {
  const leads = listLeads({ status: req.query.status || undefined });
  const header = [
    'Name', 'Adresse', 'Telefon', 'Website', 'Status Website', 'Score',
    'Bewertung', 'Anzahl Bewertungen', 'Lead-Status', 'Notizen', 'Google Maps',
  ];
  const rows = leads.map((l) => [
    l.name, l.address, l.phone, l.website || l.final_url, l.site_label, l.site_score,
    l.rating ?? '', l.rating_count ?? '', l.lead_status, l.notes || '', l.maps_url,
  ]);

  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(';'))
    .join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('﻿' + csv);
});

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LeadFinder laeuft auf http://localhost:${PORT}`);
  console.log(`- Landingpage:        http://localhost:${PORT}/`);
  console.log(`- Internes Dashboard: http://localhost:${PORT}/app`);
});
