import nodemailer from "nodemailer";

let transporter = null;

function resendApiConfig() {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !String(apiKey).startsWith("re_")) return null;
  if (!from) return null;
  return { apiKey, from };
}

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1" || port === 465;
  return {
    host,
    port,
    secure,
    auth: { user, pass },
    from: process.env.EMAIL_FROM || user,
  };
}

function getTransporter() {
  const cfg = smtpConfig();
  if (!cfg) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    });
  }
  return { transporter, from: cfg.from };
}

/** Render bloquea SMTP saliente; usar API HTTPS de Resend en producción. */
export function getEmailMode() {
  if (resendApiConfig()) return "resend-api";
  if (smtpConfig()) return "smtp";
  return null;
}

export function isEmailConfigured() {
  return !!getEmailMode();
}

function buildInviteContent({ setupLink, appName }) {
  const subject = `Invitación — ${appName} (crear tu contraseña)`;
  const text = [
    `Hola,`,
    ``,
    `Te invitaron como editor del panel de administración de ${appName}.`,
    ``,
    `Abre este enlace para crear tu contraseña e iniciar sesión:`,
    setupLink,
    ``,
    `El enlace caduca en unas horas. Si expira, pide otra invitación al administrador principal.`,
    ``,
    `Si no esperabas este mensaje, ignóralo.`,
  ].join("\n");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;color:#1a1a1a">
      <h2 style="color:#c9a227">${escapeHtml(appName)}</h2>
      <p>Te invitaron como <strong>editor</strong> del panel de administración del torneo.</p>
      <p><a href="${escapeHtml(setupLink)}" style="display:inline-block;background:#c9a227;color:#0a0a0f;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Crear mi contraseña</a></p>
      <p style="font-size:13px;color:#555">Si el botón no funciona, copia este enlace en el navegador:<br><a href="${escapeHtml(setupLink)}">${escapeHtml(setupLink)}</a></p>
      <p style="font-size:12px;color:#888">El enlace caduca en unas horas. Si no esperabas este correo, ignóralo.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

async function sendViaResendApi({ to, from, apiKey, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || body.error || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function sendViaSmtp({ to, from, subject, text, html }) {
  const t = getTransporter();
  if (!t) throw new Error("SMTP no configurado");
  try {
    await t.transporter.sendMail({ from, to, subject, text, html });
  } catch (e) {
    const detail = e.response || e.message || String(e);
    throw new Error(detail);
  }
}

export async function sendInviteEmail({ to, setupLink, appName = "Torneo StarCraft" }) {
  const { subject, text, html } = buildInviteContent({ setupLink, appName });
  const mode = getEmailMode();

  if (mode === "resend-api") {
    const cfg = resendApiConfig();
    await sendViaResendApi({
      to,
      from: cfg.from,
      apiKey: cfg.apiKey,
      subject,
      text,
      html,
    });
    return;
  }

  if (mode === "smtp") {
    const t = getTransporter();
    await sendViaSmtp({ to, from: t.from, subject, text, html });
    return;
  }

  throw new Error(
    "Correo no configurado. En Render usa RESEND_API_KEY + EMAIL_FROM (ver SETUP-EMAIL.txt). SMTP suele estar bloqueado en Render."
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
