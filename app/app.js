const form = document.getElementById('search-form');
const queryInput = document.getElementById('query');
const statusBox = document.getElementById('search-status');
const tbody = document.getElementById('leads-body');
const statusFilter = document.getElementById('status-filter');
const exportLink = document.getElementById('export-link');
const loadMoreWrap = document.getElementById('load-more-wrap');
const loadMoreBtn = document.getElementById('load-more');

let currentQuery = '';
let currentPageToken = null;

const LEAD_STATUSES = [
  ['neu', 'Neu'],
  ['kontaktiert', 'Kontaktiert'],
  ['termin', 'Termin vereinbart'],
  ['kunde', 'Kunde geworden'],
  ['abgelehnt', 'Abgelehnt'],
];

async function loadLeads() {
  const status = statusFilter.value;
  const url = status ? `/api/leads?status=${encodeURIComponent(status)}` : '/api/leads';
  exportLink.href = status ? `/api/leads/export.csv?status=${encodeURIComponent(status)}` : '/api/leads/export.csv';
  const leads = await fetch(url).then((r) => r.json());
  renderLeads(leads);
}

function renderLeads(leads) {
  tbody.innerHTML = '';
  for (const lead of leads) {
    tbody.appendChild(renderRow(lead));
  }
}

function renderRow(lead) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  const siteLink = lead.website || lead.final_url;
  nameTd.innerHTML = `<strong>${escapeHtml(lead.name)}</strong>${
    siteLink ? `<br><a class="site-link" href="${escapeAttr(siteLink)}" target="_blank" rel="noopener">${escapeHtml(siteLink)}</a>` : ''
  }${lead.rating ? `<br><span class="reasons">${lead.rating}★ (${lead.rating_count || 0})</span>` : ''}`;

  const addrTd = document.createElement('td');
  addrTd.innerHTML = `${escapeHtml(lead.address || '')}${lead.phone ? `<br>${escapeHtml(lead.phone)}` : ''}${
    lead.maps_url ? `<br><a class="site-link" href="${escapeAttr(lead.maps_url)}" target="_blank" rel="noopener">Google Maps</a>` : ''
  }`;

  const statusTd = document.createElement('td');
  statusTd.innerHTML = `<span class="badge ${lead.site_status}">${escapeHtml(lead.site_label)}</span><br><span class="reasons">Score: ${lead.site_score}</span>`;

  const reasonsTd = document.createElement('td');
  const reasons = Array.isArray(lead.site_reasons) ? lead.site_reasons : [];
  reasonsTd.innerHTML = `<div class="reasons"><ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;

  const leadStatusTd = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'lead-status';
  for (const [value, label] of LEAD_STATUSES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === lead.lead_status) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => patchLead(lead.id, { lead_status: select.value }));
  leadStatusTd.appendChild(select);

  const notesTd = document.createElement('td');
  const textarea = document.createElement('textarea');
  textarea.className = 'notes';
  textarea.value = lead.notes || '';
  let debounceTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => patchLead(lead.id, { notes: textarea.value }), 600);
  });
  notesTd.appendChild(textarea);

  tr.append(nameTd, addrTd, statusTd, reasonsTd, leadStatusTd, notesTd);
  return tr;
}

async function patchLead(id, body) {
  await fetch(`/api/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runSearch(query, pageToken) {
  statusBox.textContent = 'Suche läuft ...';
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');

    currentQuery = query;
    currentPageToken = data.nextPageToken;
    loadMoreWrap.hidden = !currentPageToken;
    statusBox.textContent = `${data.count} Ergebnis(se) gefunden und geprüft.`;
    await loadLeads();
  } catch (err) {
    statusBox.textContent = `Fehler: ${err.message}`;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (query) runSearch(query, null);
});

loadMoreBtn.addEventListener('click', () => {
  if (currentQuery && currentPageToken) runSearch(currentQuery, currentPageToken);
});

statusFilter.addEventListener('change', loadLeads);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// --- Tabs ---
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  search: document.getElementById('tab-search'),
  contacts: document.getElementById('tab-contacts'),
  generator: document.getElementById('tab-generator'),
};
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    for (const [key, panel] of Object.entries(tabPanels)) {
      panel.hidden = key !== btn.dataset.tab;
    }
    if (btn.dataset.tab === 'contacts') loadContacts();
    if (btn.dataset.tab === 'generator') loadGeneratedSites();
  });
});

// --- Kontaktanfragen (vom Formular der Verkaufs-Landingpage) ---
const contactsBody = document.getElementById('contacts-body');
const contactStatusFilter = document.getElementById('contact-status-filter');
const contactCountBadge = document.getElementById('contact-count-badge');

const CONTACT_STATUSES = [
  ['neu', 'Neu'],
  ['beantwortet', 'Beantwortet'],
  ['kunde', 'Kunde geworden'],
  ['abgelehnt', 'Abgelehnt'],
];

async function loadContacts() {
  const status = contactStatusFilter.value;
  const url = status ? `/api/contact-requests?status=${encodeURIComponent(status)}` : '/api/contact-requests';
  const contacts = await fetch(url).then((r) => r.json());
  renderContacts(contacts);
}

function renderContacts(contacts) {
  contactsBody.innerHTML = '';
  for (const c of contacts) {
    contactsBody.appendChild(renderContactRow(c));
  }
}

function renderContactRow(c) {
  const tr = document.createElement('tr');

  const senderTd = document.createElement('td');
  senderTd.innerHTML = `<strong>${escapeHtml(c.name)}</strong>${
    c.betrieb ? `<br>${escapeHtml(c.betrieb)}` : ''
  }<br><a class="site-link" href="mailto:${escapeAttr(c.email)}">${escapeHtml(c.email)}</a>`;

  const msgTd = document.createElement('td');
  msgTd.innerHTML = `<div class="reasons">${escapeHtml(c.nachricht || '')}</div>`;

  const dateTd = document.createElement('td');
  dateTd.innerHTML = `<span class="reasons">${escapeHtml(c.created_at)}</span>`;

  const statusTd = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'lead-status';
  for (const [value, label] of CONTACT_STATUSES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === c.status) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => patchContact(c.id, { status: select.value }));
  statusTd.appendChild(select);

  const notesTd = document.createElement('td');
  const textarea = document.createElement('textarea');
  textarea.className = 'notes';
  textarea.value = c.notes || '';
  let debounceTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => patchContact(c.id, { notes: textarea.value }), 600);
  });
  notesTd.appendChild(textarea);

  tr.append(senderTd, msgTd, dateTd, statusTd, notesTd);
  return tr;
}

async function patchContact(id, body) {
  await fetch(`/api/contact-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

contactStatusFilter.addEventListener('change', loadContacts);

async function refreshContactBadge() {
  try {
    const neue = await fetch('/api/contact-requests?status=neu').then((r) => r.json());
    if (neue.length > 0) {
      contactCountBadge.textContent = neue.length;
      contactCountBadge.hidden = false;
    } else {
      contactCountBadge.hidden = true;
    }
  } catch {
    // Badge ist nur ein Hinweis, Fehler hier sind unkritisch.
  }
}

refreshContactBadge();
setInterval(refreshContactBadge, 30000);

// --- Website-Generator ---
const generatorForm = document.getElementById('generator-form');
const genUrlInput = document.getElementById('gen-url');
const genNotesInput = document.getElementById('gen-notes');
const generatorStatus = document.getElementById('generator-status');
const previewSection = document.getElementById('generator-preview-section');
const previewTitle = document.getElementById('generator-preview-title');
const previewLink = document.getElementById('generator-preview-link');
const previewFrame = document.getElementById('generator-preview-frame');
const generatedBody = document.getElementById('generated-body');

const GEN_STATUS_LABELS = {
  pending: 'Wird generiert …',
  done: 'Fertig',
  error: 'Fehlgeschlagen',
};

generatorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = genUrlInput.value.trim();
  if (!url) return;
  runGeneration(url, genNotesInput.value.trim());
});

async function runGeneration(url, notes) {
  const submitBtn = generatorForm.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  previewSection.hidden = true;
  generatorStatus.className = '';
  generatorStatus.textContent = 'Lese Quelle, generiere Website … das kann 1-2 Minuten dauern.';
  // Damit man den Fortschritt sieht, auch wenn man gerade eine andere Zeile
  // ("Neu generieren") angestoßen hat, statt das Formular zu benutzen:
  genUrlInput.value = url;
  genNotesInput.value = notes || '';

  try {
    const res = await fetch('/api/generate-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, notes: notes || '' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');

    generatorStatus.textContent = `Fertig: ${data.businessName || 'Website'} wurde generiert.`;
    generatorStatus.className = 'ok';

    previewTitle.textContent = data.businessName || 'Vorschau';
    previewLink.href = data.previewUrl;
    previewFrame.src = data.previewUrl;
    previewSection.hidden = false;
  } catch (err) {
    generatorStatus.textContent = `Fehler: ${err.message}`;
    generatorStatus.className = 'error';
  } finally {
    submitBtn.disabled = false;
    loadGeneratedSites();
  }
}

async function loadGeneratedSites() {
  const sites = await fetch('/api/generated-sites').then((r) => r.json());
  generatedBody.innerHTML = '';
  for (const site of sites) {
    generatedBody.appendChild(renderGeneratedRow(site));
  }
}

function renderGeneratedRow(site) {
  const tr = document.createElement('tr');

  const nameTd = document.createElement('td');
  nameTd.innerHTML = `<strong>${escapeHtml(site.business_name || '(ohne Namen)')}</strong>`;

  const sourceTd = document.createElement('td');
  sourceTd.innerHTML = `<span class="reasons">${site.source_type === 'maps' ? 'Google Maps' : 'Alte Website'}</span><br><a class="site-link" href="${escapeAttr(site.source_url)}" target="_blank" rel="noopener">${escapeHtml(site.source_url)}</a>`;

  const statusTd = document.createElement('td');
  statusTd.innerHTML = `<span class="badge ${site.status}">${GEN_STATUS_LABELS[site.status] || site.status}</span>${
    site.status === 'error' && site.error_message ? `<br><span class="reasons">${escapeHtml(site.error_message)}</span>` : ''
  }`;

  const dateTd = document.createElement('td');
  dateTd.innerHTML = `<span class="reasons">${escapeHtml(site.created_at)}</span>`;

  const actionsTd = document.createElement('td');
  actionsTd.className = 'generated-actions';
  if (site.status === 'done') {
    const openLink = document.createElement('a');
    openLink.className = 'site-link';
    openLink.href = `/sites/${encodeURIComponent(site.slug)}/`;
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.textContent = 'Öffnen';
    actionsTd.appendChild(openLink);
  }
  if (site.status === 'done' || site.status === 'error') {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'regen-btn';
    regenBtn.textContent = 'Neu generieren';
    regenBtn.addEventListener('click', () => runGeneration(site.source_url, site.notes));
    actionsTd.appendChild(regenBtn);
  }

  tr.append(nameTd, sourceTd, statusTd, dateTd, actionsTd);
  return tr;
}

loadLeads();
