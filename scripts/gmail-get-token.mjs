/**
 * Ejecutar UNA vez en tu PC para obtener GMAIL_REFRESH_TOKEN:
 *
 *   $env:GMAIL_CLIENT_ID="xxx.apps.googleusercontent.com"
 *   $env:GMAIL_CLIENT_SECRET="GOCSPX-xxx"
 *   node scripts/gmail-get-token.mjs
 */
import http from "http";
import { URL } from "url";
import { google } from "googleapis";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Define GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET antes de ejecutar.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://mail.google.com/"],
});

console.log("\n1) Abre esta URL en el navegador e inicia sesión con la cuenta Gmail que enviará invitaciones:\n");
console.log(authUrl);
console.log("\n2) Acepta los permisos. Volverás a localhost automáticamente.\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("Falta code");
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Listo</h1><p>Revisa la consola donde ejecutaste el script.</p>");
    console.log("\n=== Copia esto en Render (Environment) ===\n");
    console.log("GMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\nTambién necesitas GMAIL_USER = el correo Gmail que usaste para autorizar.");
    console.log("Ejemplo: GMAIL_USER=geylquimichen@gmail.com\n");
  } catch (e) {
    res.writeHead(500);
    res.end("Error: " + e.message);
    console.error(e);
  } finally {
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(PORT, () => {
  console.log(`Esperando callback en ${REDIRECT_URI} ...`);
});
