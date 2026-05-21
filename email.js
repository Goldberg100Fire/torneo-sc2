import nodemailer from "nodemailer";

let transporter = null;
let gmailClientPromise = null;

function trimEnv(name) {
  const v = process.env[name];
  return v ? String(v).trim() : "";
}

function gmailApiConfig() {
  const clientId = trimEnv("GMAIL_CLIENT_ID");
  const clientSecret = trimEnv("GMAIL_CLIENT_SECRET");
  const refreshToken = trimEnv("GMAIL_REFRESH_TOKEN");
  const user = trimEnv("GMAIL_USER") || trimEnv("SMTP_USER");
  if (!clientId || !clientSecret || !refreshToken || !user) return null;
  const from =
    trimEnv("EMAIL_FROM") ||
    `Torneo StarCraft <${user.includes("@") ? user : `${user}@gmail.com`}>`;
  const redirectUri =
    trimEnv("GMAIL_REDIRECT_URI") || "https://developers.google.com/oauthplayground";
  return { clientId, clientSecret, refreshToken, user, from, redirectUri };
}

export function gmailEnvDiagnostics() {
  const clientId = trimEnv("GMAIL_CLIENT_ID");
  const clientSecret = trimEnv("GMAIL_CLIENT_SECRET");
  const refreshToken = trimEnv("GMAIL_REFRESH_TOKEN");
  const user = trimEnv("GMAIL_USER");
  if (!clientId || !clientSecret || !refreshToken || !user) {
    return {
      envSet: false,
      hint: "Faltan GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN o GMAIL_USER en Render",
    };
  }
  if (!refreshToken.startsWith("1//")) {
    return {
      envSet: true,
      hint: "GMAIL_REFRESH_TOKEN no parece válido (debe empezar con 1//). Genera uno nuevo en OAuth Playground.",
    };
  }
  return { envSet: true, hint: null };
}

function resendApiConfig() {
  const apiKey = process.env.RESEND_API_KEY;
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

/** Prioridad: Gmail API > Resend API > SMTP (solo local; Render bloquea SMTP). */
export function getEmailMode() {
  if (gmailApiConfig()) return "gmail-api";
  if (resendApiConfig()) return "resend-api";
  const onRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_NAME);
  if (smtpConfig() && !onRender) return "smtp";
  return null;
}

export function isEmailConfigured() {
  return !!getEmailMode();
}

function buildInviteContent({ setupLink, appName }) {
  const subject = `Acceso editor - ${appName}`;
  const text = [
    `Hola,`,
    ``,
    `Te dieron acceso como editor del panel de ${appName}.`,
    ``,
    `Para crear tu contraseña e iniciar sesion, abre este enlace:`,
    setupLink,
    ``,
    `El enlace caduca en unas horas. Si expira, pide otra invitacion al administrador.`,
    ``,
    `Si no conoces este torneo, ignora este mensaje.`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">
      <p>Hola,</p>
      <p>Te dieron acceso como <strong>editor</strong> del panel de <strong>${escapeHtml(appName)}</strong>.</p>
      <p>Para crear tu contraseña, abre este enlace:</p>
      <p><a href="${escapeHtml(setupLink)}">${escapeHtml(setupLink)}</a></p>
      <p style="font-size:13px;color:#555">El enlace caduca en unas horas. Si no conoces este torneo, ignora este correo.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

function encodeSubjectUtf8(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildRawMime({ from, to, subject, text, html, replyTo }) {
  const boundary = `torneo_${Date.now()}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubjectUtf8(subject)}`,
  ];
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  const mime = [
    ...headers,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getGmailClient() {
  if (!gmailClientPromise) {
    gmailClientPromise = (async () => {
      const cfg = gmailApiConfig();
      const { google } = await import("googleapis");
      const oauth2 = new google.auth.OAuth2(
        cfg.clientId,
        cfg.clientSecret,
        cfg.redirectUri
      );
      oauth2.setCredentials({ refresh_token: cfg.refreshToken });
      return google.gmail({ version: "v1", auth: oauth2 });
    })().catch((e) => {
      gmailClientPromise = null;
      throw e;
    });
  }
  return gmailClientPromise;
}

async function sendViaGmailApi({ to, from, subject, text, html }) {
  const gmail = await getGmailClient();
  const replyTo = gmailApiConfig()?.user || from;
  const raw = buildRawMime({ from, to, subject, text, html, replyTo });
  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message || String(e);
    if (/invalid_grant|unauthorized_client/i.test(msg)) {
      throw new Error(
        `${msg} — Regenera GMAIL_REFRESH_TOKEN en OAuth Playground (scope https://mail.google.com/) con tus credenciales.`
      );
    }
    throw new Error(msg);
  }
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

function buildPasswordSetupContent({ setupLink, appName }) {
  const subject = `Crear contraseña - ${appName}`;
  const text = [
    `Hola,`,
    ``,
    `Recibimos una solicitud para crear la contraseña del panel de ${appName}.`,
    ``,
    `Enlace:`,
    setupLink,
    ``,
    `Si no fuiste tu, ignora este mensaje.`,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">
      <p>Hola,</p>
      <p>Recibimos una solicitud para crear la contraseña del panel de <strong>${escapeHtml(appName)}</strong>.</p>
      <p><a href="${escapeHtml(setupLink)}">${escapeHtml(setupLink)}</a></p>
      <p style="font-size:13px;color:#555">Si no fuiste tu, ignora este correo.</p>
    </div>
  `.trim();
  return { subject, text, html };
}

async function dispatchEmail({ to, from, subject, text, html }) {
  const mode = getEmailMode();
  if (mode === "gmail-api") {
    await sendViaGmailApi({ to, from, subject, text, html });
    return;
  }
  if (mode === "resend-api") {
    const cfg = resendApiConfig();
    await sendViaResendApi({ to, from: cfg.from, apiKey: cfg.apiKey, subject, text, html });
    return;
  }
  if (mode === "smtp") {
    const t = getTransporter();
    await sendViaSmtp({ to, from: t.from, subject, text, html });
    return;
  }
  throw new Error(
    "Correo no configurado. En Render usa Gmail API (SETUP-GMAIL-API.txt) o RESEND_API_KEY."
  );
}

export async function sendInviteEmail({ to, setupLink, appName = "Torneo StarCraft" }) {
  const { subject, text, html } = buildInviteContent({ setupLink, appName });
  const from = gmailApiConfig()?.from || resendApiConfig()?.from || getTransporter()?.from;
  await dispatchEmail({ to, from, subject, text, html });
}

export async function sendPasswordSetupEmail({ to, setupLink, appName = "Torneo StarCraft" }) {
  const { subject, text, html } = buildPasswordSetupContent({ setupLink, appName });
  const from = gmailApiConfig()?.from || resendApiConfig()?.from || getTransporter()?.from;
  await dispatchEmail({ to, from, subject, text, html });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
