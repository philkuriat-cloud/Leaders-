# Deploy &ndash; LeadFinder live schalten

Dieses Projekt ist jetzt **eine** App: Die Verkaufs-Landingpage l&auml;uft unter `/`,
das interne Dashboard (Leads-Suche + Kontaktanfragen) unter `/app` und ist per
Passwort gesch&uuml;tzt. Es muss nur **ein** Server betrieben werden.

Vorher unbedingt in `.env` setzen (siehe `.env.example`):
- `GOOGLE_PLACES_API_KEY`
- `DASHBOARD_USER` / `DASHBOARD_PASS` &ndash; ohne diese ist `/app` f&uuml;r jeden offen!
- `ANTHROPIC_API_KEY` &ndash; nur n&ouml;tig, wenn der Website-Generator-Reiter genutzt werden soll
- optional `SMTP_*` f&uuml;r Mail-Benachrichtigungen bei neuen Kontaktanfragen

Hinweis zur Datenbank: Es wird SQLite benutzt (`data/leadfinder.db`). Das ist
eine einzelne Datei auf der lokalen Festplatte &ndash; sie muss bei jedem der
folgenden Wege dauerhaft erhalten bleiben (siehe jeweils "Daten sichern").
Gleiches gilt f&uuml;r den Ordner `generated-sites/` (die vom Website-Generator
erzeugten Seiten) &ndash; beide geh&ouml;ren auf denselben dauerhaften Datentr&auml;ger/
dasselbe Volume.

---

## Option A: Eigener Server (VPS) &ndash; empfohlen f&uuml;r volle Kontrolle

Passt z.B. bei Hetzner, Netcup, IONOS, DigitalOcean &ndash; ein kleiner Server
(1 CPU, 1&ndash;2&nbsp;GB RAM) reicht locker.

1. **Domain auf den Server zeigen lassen**: Beim Domain-Anbieter einen
   A-Record (und ggf. AAAA f&uuml;r IPv6) auf die IP-Adresse des Servers anlegen.

2. **Node.js installieren** (Ubuntu/Debian):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
   sudo apt-get install -y nodejs
   ```

3. **Projekt auf den Server bringen** (z.B. per `git clone` aus einem eigenen
   Repo, oder per `scp`), dann:
   ```bash
   cd leadfinder
   npm install --omit=dev
   cp .env.example .env
   nano .env   # Werte eintragen
   ```

4. **Als Systemdienst einrichten**, damit die App automatisch startet und bei
   einem Absturz neu startet. `/etc/systemd/system/leadfinder.service`:
   ```ini
   [Unit]
   Description=LeadFinder
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/leadfinder
   ExecStart=/usr/bin/node server.js
   Restart=on-failure
   EnvironmentFile=/opt/leadfinder/.env
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   Dann:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now leadfinder
   sudo systemctl status leadfinder
   ```

5. **Caddy als Reverse Proxy mit automatischem HTTPS** (einfachste Variante,
   holt sich selbststaendig ein Let's-Encrypt-Zertifikat):
   ```bash
   sudo apt-get install -y caddy
   ```
   `/etc/caddy/Caddyfile`:
   ```
   ihrefirma.de {
     reverse_proxy localhost:3000
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```
   Alternative: nginx + `certbot` manuell, falls Caddy nicht verf&uuml;gbar ist.

6. **Firewall**: Nur Port 80/443 nach au&szlig;en offen lassen, Port 3000 nicht
   direkt aus dem Internet erreichbar machen (z.B. `ufw allow 80,443/tcp`,
   `ufw enable`). Caddy/nginx leiten intern an `localhost:3000` weiter.

7. **Daten sichern**: `data/leadfinder.db` regelm&auml;&szlig;ig per Cronjob
   wegsichern (z.B. taeglich auf einen anderen Server/Storage kopieren):
   ```bash
   0 3 * * * cp /opt/leadfinder/data/leadfinder.db /pfad/zu/backups/leadfinder-$(date +\%F).db
   ```

---

## Option B: Docker (auf dem gleichen VPS oder jedem Docker-Host)

```bash
docker build -t leadfinder .
docker run -d \
  --name leadfinder \
  --env-file .env \
  -p 3000:3000 \
  -v leadfinder-data:/app/data \
  -v leadfinder-sites:/app/generated-sites \
  --restart unless-stopped \
  leadfinder
```

Davor genau wie in Option A Schritt 5 einen Reverse Proxy (Caddy/nginx) mit
HTTPS auf `localhost:3000` einrichten. Die benannten Volumes `leadfinder-data`
und `leadfinder-sites` sorgen daf&uuml;r, dass Datenbank und generierte
Websites Container-Neustarts &uuml;berleben (`docker volume inspect
leadfinder-data` zeigt den Pfad auf dem Host, falls Backups davon noetig sind).

*Hinweis*: Der Docker-Build konnte in dieser Entwicklungsumgebung nicht
getestet werden (kein laufender Docker-Daemon verf&uuml;gbar). Das Dockerfile
folgt einem Standard-Muster; vor dem produktiven Einsatz einmal selbst lokal
durchbauen (`docker build -t leadfinder .`) und pr&uuml;fen.

---

## Option C: Managed-Hosting (Render, Railway, Fly.io, &auml;.) &ndash; am einfachsten, ohne Server-Administration

Diese Anbieter nehmen Node-Projekte direkt aus einem Git-Repo und bauen/starten
sie automatisch (Build-Befehl `npm install`, Start-Befehl `node server.js`).
Domain + HTTPS werden meist automatisch mitgeliefert.

**Wichtig bei SQLite auf solchen Plattformen**: Viele Managed-Hosting-Anbieter
haben standardm&auml;&szlig;ig ein **fl&uuml;chtiges Dateisystem** &ndash; bei jedem Deploy
oder Neustart w&auml;ren `data/leadfinder.db` und damit alle Leads/Kontaktanfragen
weg. Unbedingt vorher pr&uuml;fen, ob der Anbieter einen **persistenten Datenträger/Volume**
anbietet (oft ein kostenpflichtiges Zusatzfeature) und diesen auf den `data`-Ordner
mounten. Alternativ k&ouml;nnte man auf eine gehostete Postgres-Datenbank
umsteigen &ndash; das w&auml;re dann eine gr&ouml;&szlig;ere &Auml;nderung am Code (`db.js`),
kein reiner Deploy-Schritt mehr.

---

## Nach dem ersten Deploy

- `https://ihredomain.de/` &ouml;ffnen &rarr; Landingpage sollte erscheinen.
- `https://ihredomain.de/app` &ouml;ffnen &rarr; Login-Dialog sollte erscheinen
  (Browser-Basic-Auth), danach das Dashboard.
- Testanfrage &uuml;ber das Kontaktformular der Landingpage schicken und
  pr&uuml;fen, ob sie im Dashboard unter "Kontaktanfragen" auftaucht.
