FROM node:22-slim

WORKDIR /app

# python3/make/g++ stellen sicher, dass better-sqlite3 (natives Modul) auch
# dann baut, wenn fuer die jeweilige Plattform kein vorgefertigtes Binary
# verfuegbar ist (z.B. auf manchen ARM-Build-Servern).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# data/ enthaelt die SQLite-Datenbank, generated-sites/ die vom Website-
# Generator erzeugten Seiten - beide unbedingt als Volume einbinden, sonst
# sind sie nach jedem Container-Neustart weg.
VOLUME ["/app/data", "/app/generated-sites"]

CMD ["node", "server.js"]
