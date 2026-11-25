import nodemailer from 'nodemailer';

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Benachrichtigt per E-Mail ueber eine neue Kontaktanfrage von der Website.
// Ist kein SMTP konfiguriert (siehe .env.example), passiert einfach nichts -
// die Anfrage ist in jedem Fall schon in der Datenbank gespeichert.
export async function notifyContactRequest(request) {
  const transport = getTransport();
  if (!transport) {
    console.log('[mailer] SMTP nicht konfiguriert, Benachrichtigung uebersprungen (Anfrage ist in der DB gespeichert).');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const to = process.env.CONTACT_NOTIFY_EMAIL;
  if (!to) {
    console.log('[mailer] CONTACT_NOTIFY_EMAIL nicht gesetzt, Benachrichtigung uebersprungen.');
    return { sent: false, reason: 'notify_email_not_configured' };
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      replyTo: request.email,
      subject: `Neue Kontaktanfrage: ${request.betrieb || request.name}`,
      text: [
        `Name: ${request.name}`,
        `Betrieb: ${request.betrieb || '-'}`,
        `E-Mail: ${request.email}`,
        '',
        'Nachricht:',
        request.nachricht || '(keine Nachricht)',
      ].join('\n'),
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Versand fehlgeschlagen:', err.message);
    return { sent: false, reason: err.message };
  }
}
