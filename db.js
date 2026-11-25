import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'leadfinder.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    betrieb TEXT,
    email TEXT NOT NULL,
    nachricht TEXT,
    source_ip TEXT,
    status TEXT NOT NULL DEFAULT 'neu',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generated_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    business_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    website TEXT,
    final_url TEXT,
    rating REAL,
    rating_count INTEGER,
    maps_url TEXT,
    search_query TEXT,
    site_status TEXT NOT NULL,
    site_label TEXT NOT NULL,
    site_score INTEGER NOT NULL,
    site_reasons TEXT,
    lead_status TEXT NOT NULL DEFAULT 'neu',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function upsertLead(lead) {
  const stmt = db.prepare(`
    INSERT INTO leads (
      id, name, address, phone, website, final_url, rating, rating_count,
      maps_url, search_query, site_status, site_label, site_score, site_reasons
    ) VALUES (
      @id, @name, @address, @phone, @website, @final_url, @rating, @rating_count,
      @maps_url, @search_query, @site_status, @site_label, @site_score, @site_reasons
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      address=excluded.address,
      phone=excluded.phone,
      website=excluded.website,
      final_url=excluded.final_url,
      rating=excluded.rating,
      rating_count=excluded.rating_count,
      maps_url=excluded.maps_url,
      search_query=excluded.search_query,
      site_status=excluded.site_status,
      site_label=excluded.site_label,
      site_score=excluded.site_score,
      site_reasons=excluded.site_reasons,
      updated_at=datetime('now')
  `);
  stmt.run(lead);
}

export function listLeads({ status } = {}) {
  if (status) {
    return db
      .prepare('SELECT * FROM leads WHERE lead_status = ? ORDER BY site_score DESC, created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM leads ORDER BY site_score DESC, created_at DESC').all();
}

export function updateLeadStatus(id, { lead_status, notes }) {
  const current = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!current) return null;
  db.prepare(`
    UPDATE leads SET
      lead_status = COALESCE(@lead_status, lead_status),
      notes = COALESCE(@notes, notes),
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, lead_status: lead_status ?? null, notes: notes ?? null });
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

export function insertContactRequest({ name, betrieb, email, nachricht, source_ip }) {
  const stmt = db.prepare(`
    INSERT INTO contact_requests (name, betrieb, email, nachricht, source_ip)
    VALUES (@name, @betrieb, @email, @nachricht, @source_ip)
  `);
  const info = stmt.run({ name, betrieb: betrieb ?? '', email, nachricht: nachricht ?? '', source_ip: source_ip ?? '' });
  return db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(info.lastInsertRowid);
}

export function listContactRequests({ status } = {}) {
  if (status) {
    return db
      .prepare('SELECT * FROM contact_requests WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM contact_requests ORDER BY created_at DESC').all();
}

export function updateContactRequest(id, { status, notes }) {
  const current = db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(id);
  if (!current) return null;
  db.prepare(`
    UPDATE contact_requests SET
      status = COALESCE(@status, status),
      notes = COALESCE(@notes, notes),
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, status: status ?? null, notes: notes ?? null });
  return db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(id);
}

export function insertGeneratedSite({ slug, source_url, source_type, business_name, notes }) {
  db.prepare(`
    INSERT INTO generated_sites (slug, source_url, source_type, business_name, notes, status)
    VALUES (@slug, @source_url, @source_type, @business_name, @notes, 'pending')
  `).run({ slug, source_url, source_type, business_name: business_name ?? '', notes: notes ?? '' });
  return db.prepare('SELECT * FROM generated_sites WHERE slug = ?').get(slug);
}

export function updateGeneratedSiteStatus(slug, { status, error_message }) {
  db.prepare(`
    UPDATE generated_sites SET
      status = COALESCE(@status, status),
      error_message = @error_message,
      updated_at = datetime('now')
    WHERE slug = @slug
  `).run({ slug, status: status ?? null, error_message: error_message ?? null });
  return db.prepare('SELECT * FROM generated_sites WHERE slug = ?').get(slug);
}

export function listGeneratedSites() {
  return db.prepare('SELECT * FROM generated_sites ORDER BY created_at DESC').all();
}

export default db;
