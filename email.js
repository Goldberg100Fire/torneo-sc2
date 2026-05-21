import nodemailer from "nodemailer";

let transporter = null;

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

export function isEmailConfigured() {
  return !!smtpConfig();
}

export async function sendInviteEmail({ to, setupLink, appName = "Torneo StarCraft" }) {
  const t = getTransporter();
  if (!t) {
    throw new Error(
      "Correo no configurado en el servidor. Define SMTP_HOST, SMTP_USER, SMTP_PASS y EMAIL_FROM (ver SETUP-EMAIL.txt)."
    );
  }

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

  try {
    await t.transporter.sendMail({
      from: t.from,
      to,
      subject,
      text,
      html,
    });
  } catch (e) {
    const detail = e.response || e.message || String(e);
    throw new Error(detail);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
