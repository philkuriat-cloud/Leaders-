import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

export { resolveSource } from './sourceResolver.js';

const SITES_DIR = path.join(process.cwd(), 'generated-sites');
const MODEL = process.env.SITE_GEN_MODEL || 'claude-opus-5-5';

const SYSTEM_PROMPT = `Du bist der Design-Lead einer kleinen, vielseitigen Digitalagentur in Deutschland.
Du baust für lokale Betriebe (Handwerker, Friseure, Gastronomie, Dienstleister etc.)
jeweils eine einzelne, komplett eigenständige HTML-Datei als neue Website - auf dem
Niveau der besten deutschen Agentur- und Markenwebsites, nicht generische Vorlagen.

Technische Vorgaben:
- EIN einziges HTML-Dokument: <!doctype html> + <head> + <body>, CSS inline in
  einem <style>-Tag, JavaScript inline in einem <script>-Tag am Ende. Keine
  externen Build-Tools, keine Frameworks. Einzige erlaubte externe Ressource:
  ein Google-Fonts-<link> für die Schriftarten.
- Vollständig responsive (mind. 360px bis Desktop), kein horizontales Scrollen.
  Teste gedanklich jede Zeile auf schmalen Bildschirmen.
- Der Preis einer Zahl/eines Werts, der angezeigt wird, muss beim Laden sofort
  korrekt sichtbar sein - keine Inhalte, die dauerhaft unsichtbar bleiben, falls
  JavaScript nicht ausgeführt wird oder eine Scroll-Animation nie auslöst.
  Scroll-Effekte dürfen Inhalte dezent verschieben/einblenden, aber niemals der
  einzige Weg sein, wie Inhalt sichtbar wird.
- Echte Kontaktdaten des Betriebs (Telefon, Adresse, falls vorhanden E-Mail)
  prominent und als klickbare tel:/mailto:-Links einbinden.
- Footer mit Platzhalter-Links/Abschnitten für Impressum und Datenschutz
  (klar als [Platzhalter] markiert, da echte Angaben fehlen).
- Für Bilder: falls kein echtes Bild verfügbar ist, nutze dezente CSS-Flächen/
  Verläufe/Icons statt kaputter <img>-Tags oder Stock-Foto-Platzhalter-URLs.

Design-Philosophie (wichtig, das unterscheidet gute von generischen KI-Seiten):
- Keine Templates von der Stange. Leite Farbpalette, Typografie und Bildsprache
  konkret aus der Branche und den Wünschen des Kunden ab, nicht aus einem
  Standard-Schema.
- Vermeide die typischen "KI-Look"-Muster: warmes Creme (#F4F1EA) mit Serifen-
  Headline und Terrakotta-Akzent; Nahezu-Schwarz mit einzelnem Neongrün/
  Vermillion-Akzent; zentrierte Layouts für alles; Lila-Blau-Verlauf-Hero;
  austauschbare "rounded-lg"-Karten überall. Triff stattdessen bewusste,
  zum Betrieb passende Entscheidungen.
- Typografie: zwei bewusst gepaarte Google-Fonts (eine Display-/Headline-
  Schrift mit Charakter, eine gut lesbare Fließtext-Schrift). Echte
  Typo-Hierarchie, text-wrap: balance auf Überschriften.
- Ein bis zwei durchdachte Bewegungsmomente (z.B. ein Lade-Reveal der
  Headline, dezentes Hover-Verhalten) schlagen eine Flut von Effekten.
- Nutze die vom Kunden gelieferten Inhalte/Daten so weit wie möglich echt
  (Name, Adresse, Telefon, vorhandene Texte) statt Lorem Ipsum oder erfundene
  Fakten. Erfinde keine falschen Jahreszahlen, Kundenzahlen o.ä.
- Struktur, die zur Branche passt: ein Handwerksbetrieb braucht andere
  Abschnitte (Leistungen, Referenzen, Einzugsgebiet) als ein Friseursalon
  (Angebot, Terminbuchung, Team, Atmosphäre) oder ein Restaurant (Speisekarte,
  Öffnungszeiten, Lage, Reservierung).

Antworte AUSSCHLIESSLICH mit dem vollständigen HTML-Code, beginnend mit
"<!doctype html>". Keine Erklärungen davor oder danach, keine Markdown-
Codeblöcke (keine \`\`\`).`;

export function slugify(name) {
  const base = (name || 'betrieb')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'betrieb';
  return `${base}-${Date.now().toString(36)}`;
}

function stripCodeFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n/, '').replace(/```$/, '').trim();
  }
  return t;
}

// resolved: das Ergebnis von resolveSource(url) - wird separat aufgerufen,
// damit der Server schon vor dem (langsamen) KI-Call einen DB-Eintrag mit
// Slug/Betriebsname anlegen kann.
export async function generateSiteFromResolved({ url, resolved, notes, slug }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY ist nicht gesetzt. Siehe .env.example - das Tool braucht einen eigenen Anthropic-API-Key (console.anthropic.com), getrennt vom Google-Places-Key.'
    );
  }

  const userPrompt = [
    `Quelle: ${resolved.sourceType === 'maps' ? 'Google-Maps-Eintrag' : 'bestehende (alte) Website'} (${url})`,
    '',
    'Gefundene Informationen zum Betrieb:',
    resolved.summary,
    '',
    'Persönliche Wünsche des Auftraggebers für die neue Website:',
    notes?.trim() || '(keine besonderen Wünsche angegeben - triff passende Design-Entscheidungen selbst)',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 24000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const finalMessage = await stream.finalMessage();

  if (finalMessage.stop_reason === 'refusal') {
    throw new Error('Claude hat die Anfrage aus Sicherheitsgründen abgelehnt (stop_reason: refusal).');
  }

  const textBlock = finalMessage.content.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Keine Textantwort erhalten.');
  }

  const html = stripCodeFences(textBlock.text);
  if (!html.toLowerCase().startsWith('<!doctype')) {
    throw new Error('Antwort sah nicht wie eine vollständige HTML-Seite aus - bitte erneut versuchen.');
  }

  const siteDir = path.join(SITES_DIR, slug);
  await fs.mkdir(siteDir, { recursive: true });
  await fs.writeFile(path.join(siteDir, 'index.html'), html, 'utf-8');

  return { slug, businessName: resolved.businessName, sourceType: resolved.sourceType };
}
