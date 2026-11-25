# LeadFinder

Eine App, zwei Seiten:

- **`/`** &ndash; öffentliche Verkaufs-Landingpage ("Website für 200 €/Monat, alles
  inklusive") mit Kontaktformular.
- **`/app`** &ndash; internes, passwortgeschütztes Dashboard: findet Betriebe über
  Google Maps, die keine oder eine veraltete Website haben, verwaltet sie als
  Leads, und zeigt eingehende Kontaktanfragen von der Landingpage an.

## Projektstruktur

```
public-site/   Verkaufs-Landingpage (öffentlich, unter /)
app/           Internes Dashboard (passwortgeschützt, unter /app)
services/      Google Places, Website-Check, Mailer, Rate-Limit
server.js      Express-Server mit allen Routen
db.js          SQLite-Datenbank (Leads + Kontaktanfragen)
```

## Was die App macht

**Landingpage (`/`)**: Verkauft das Angebot, nimmt über das Kontaktformular
Anfragen interessierter Betriebe entgegen (`POST /api/contact`, öffentlich,
mit Validierung, Spam-Honeypot und Rate-Limit pro IP).

**Dashboard (`/app`)**:
1. Du gibst eine Suche ein, z.B. `Friseure in Leipzig` oder `Handwerker in Dresden`.
2. Die App fragt die Google Places API (New) ab (bis zu 20 Treffer pro Seite, mit
   "Weitere Ergebnisse laden" für mehr).
3. Für jeden Treffer wird geprüft:
   - Hat der Betrieb überhaupt eine Website hinterlegt? → **Keine Website**
   - Ist die Website erreichbar? → sonst **Website nicht erreichbar**
   - Ist sie veraltet (kein HTTPS, nicht mobil-optimiert/kein viewport-Tag, Frames,
     Flash, sehr alte Jahreszahlen im Quelltext)? → **Veraltete Website**
   - Sonst: **Wirkt aktuell**
4. Alle Treffer werden als Leads in einer lokalen SQLite-Datenbank gespeichert. Du kannst
   pro Lead einen Status setzen (Neu / Kontaktiert / Termin / Kunde / Abgelehnt) und
   Notizen hinterlegen. Export als CSV für Outreach-Listen, Mailings etc.
5. Zweiter Reiter **Kontaktanfragen**: zeigt alle über die Landingpage eingegangenen
   Anfragen mit Status/Notizen. Optional zusätzlich E-Mail-Benachrichtigung per SMTP.
6. Dritter Reiter **Website-Generator**: Du gibst einen Google-Maps-Link oder die
   URL einer alten Website ein, dazu optional eigene Wünsche (Farben, Ton,
   Zielgruppe, Slogan-Idee, besondere Leistungen ...). Das Tool liest die Quelle
   aus (Places API bzw. Scraping der alten Seite), schickt das zusammen mit
   deinen Wünschen an die Anthropic API und baut daraus eine komplett neue,
   eigenständige Website (eine HTML-Datei, responsive, individuell gestaltet -
   keine Vorlage von der Stange). Ergebnis landet unter `/sites/<slug>/` und
   ist direkt per Link teilbar.

## Setup

```bash
npm install
cp .env.example .env
```

In `.env` ausfüllen:

```
GOOGLE_PLACES_API_KEY=dein-key
DASHBOARD_USER=dein-benutzername
DASHBOARD_PASS=dein-passwort
ANTHROPIC_API_KEY=dein-anthropic-key   # fuer den Website-Generator, siehe unten
```

**Wichtig**: Ohne `DASHBOARD_USER`/`DASHBOARD_PASS` ist `/app` (Leads +
Kontaktanfragen, also eure Kundendaten) für jeden im Internet offen
zugänglich! Lokal zum Testen ist das ok (dann startet der Server mit einer
Warnung), vor jedem Live-Betrieb aber unbedingt setzen.

### Google-API-Key besorgen

1. Google-Cloud-Projekt anlegen: https://console.cloud.google.com/
2. API "Places API (New)" aktivieren: https://console.cloud.google.com/google/maps-apis
3. API-Key erstellen (Credentials) und auf die Places API (New) einschränken.
4. Abrechnung aktivieren (Google verlangt eine hinterlegte Zahlungsmethode, es gibt aber
   ein monatliches Freikontingent). Preise unbedingt vorher prüfen:
   https://mapsplatform.google.com/pricing/ — Text Search kostet pro Request, je nach
   angefragten Feldern unterschiedlich viel. Bei täglicher Nutzung Kosten im Blick behalten.

### Anthropic-API-Key besorgen (für den Website-Generator)

1. Account unter https://console.anthropic.com anlegen (separat von Google, eigenes Abrechnungskonto).
2. Unter "API Keys" einen neuen Key erstellen und in `.env` als `ANTHROPIC_API_KEY` eintragen.
3. Kosten: Jede Generierung ist ein echter, bezahlter API-Aufruf (Standard-Modell
   `claude-opus-5-5`, höchste Qualität). Ein vollständiger Seiten-Entwurf kostet
   typischerweise niedrige Cent-Beträge bis knapp über 1 €, abhängig von der
   Seitenlänge - aktuelle Preise: https://platform.claude.com/docs/en/about-claude/pricing.
   Für spürbar günstigere (etwas einfachere) Ergebnisse kann `SITE_GEN_MODEL=claude-sonnet-5-5`
   in `.env` gesetzt werden.

## Starten

```bash
npm start
```

- Landingpage: http://localhost:3000/
- Dashboard: http://localhost:3000/app

Für Entwicklung mit Auto-Reload: `npm run dev`

## Live schalten

Siehe [`DEPLOY.md`](./DEPLOY.md) — Schritt-für-Schritt-Anleitung für einen
eigenen Server (VPS + Caddy/HTTPS), Docker, oder Managed-Hosting.

## Vor der Veröffentlichung der Landingpage noch zu erledigen

1. **Platzhalter ersetzen**: "IhreFirma" in `public-site/index.html`,
   `public-site/impressum.html`, `public-site/datenschutz.html` durch den
   echten Namen/Firmennamen ersetzen.
2. **Impressum & Datenschutz ausfüllen**: Beide Seiten enthalten nur
   Platzhalter mit `[...]`. In Deutschland ist ein vollständiges Impressum
   Pflicht (§5 TMG), eine DSGVO-konforme Datenschutzerklärung ebenso, sobald
   das Kontaktformular Daten verarbeitet.
3. **Leistungsumfang prüfen**: Der Abschnitt "Alles inklusive" in
   `public-site/index.html` (`<section id="leistungen">`) nennt
   Website-Erstellung, Hosting, Domain, Pflege, SSL, monatliche Kündbarkeit —
   bei Bedarf an das tatsächliche Angebot anpassen.

## Optional: E-Mail-Benachrichtigung bei neuen Kontaktanfragen

SMTP-Zugangsdaten in `.env` eintragen (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`, `CONTACT_NOTIFY_EMAIL`). Ohne SMTP wird die Anfrage
trotzdem gespeichert und erscheint im Reiter "Kontaktanfragen" — nur die
zusätzliche Mail entfällt.

## Daten

Die SQLite-Datenbank liegt unter `data/leadfinder.db` und wird beim ersten Start
automatisch angelegt. Sie ist in `.gitignore` ausgeschlossen (enthält ggf. Kontaktdaten
von Betrieben, die nicht ins Git-Repo gehören). Beim Hosting unbedingt dafür sorgen,
dass dieser Ordner dauerhaft erhalten bleibt (siehe `DEPLOY.md`).

Generierte Websites liegen unter `generated-sites/<slug>/index.html` und sind unter
`/sites/<slug>/` **öffentlich ohne Login** abrufbar (so lässt sich die Vorschau direkt
an den Betrieb schicken). Auch dieser Ordner ist in `.gitignore` und muss beim Hosting
dauerhaft erhalten bleiben.

**Wichtig**: Jede generierte Website ist ein KI-Entwurf. Vor dem Weitergeben an den
Betrieb immer gegenlesen - insbesondere übernommene Kontaktdaten (Telefon, Adresse)
gegenprüfen und die Platzhalter für Impressum/Datenschutz durch echte Angaben
ersetzen, bevor die Seite live geht.

## Rechtliches / Hinweise

- Die Nutzung der Google Places API unterliegt den Google-Maps-Plattform-Nutzungsbedingungen.
  Rohdaten dürfen laut Google-ToS nicht dauerhaft in einer eigenen Datenbank gespeichert
  werden (Caching-Beschränkungen) — für ein reines Lead-Tracking (Name, Adresse, Status,
  Notizen) ist das in der Praxis unkritisch, für den produktiven Einsatz aber selbst prüfen:
  https://cloud.google.com/maps-platform/terms
- Der automatische Website-Check ist eine Heuristik (HTTPS, Mobile-Tag, Frames, Flash,
  Jahreszahlen im Quelltext) und kein Ersatz für einen manuellen Blick auf die Seite,
  bevor du einen Betrieb kontaktierst.
- Beim automatischen Abruf fremder Websites bitte fair bleiben (kein Dauer-Crawling,
  vernünftige Anzahl Anfragen) und die robots.txt/Nutzungsbedingungen der jeweiligen
  Seite respektieren, falls du den Checker intensiver einsetzt.

## Nächste mögliche Schritte

- E-Mail-/Brief-Vorlagen für die Kontaktaufnahme direkt aus den Notizen generieren
- Mehrere Suchanfragen (Städte/Branchen) automatisiert nacheinander abarbeiten
- Mehrbenutzer-Login statt einem gemeinsamen Dashboard-Passwort, falls mehrere
  Personen im Team mit unterschiedlichen Rechten arbeiten sollen
