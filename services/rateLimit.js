// Einfaches In-Memory-Rate-Limit pro IP. Reicht fuer ein Kontaktformular mit
// normalem Besucheraufkommen; bei mehreren Server-Instanzen hinter einem
// Load Balancer muesste das durch einen gemeinsamen Speicher (z.B. Redis)
// ersetzt werden.
//
// Jeder rateLimit(...)-Aufruf bekommt seine EIGENE hits-Map (nicht modul-weit
// geteilt) - sonst wuerden sich voneinander unabhaengige Routen (z.B.
// /api/contact und /api/generate-site) gegenseitig das Kontingent wegnehmen.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: 'Zu viele Anfragen, bitte spaeter erneut versuchen.' });
    }
    next();
  };
}
