import express from "express";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getEmailMode, isEmailConfigured, sendInviteEmail } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "tournament.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tournament (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const selectRow = db.prepare("SELECT data, updated_at FROM tournament WHERE id = 1");
const upsertRow = db.prepare(`
  INSERT INTO tournament (id, data, updated_at)
  VALUES (1, @data, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);
const deleteRow = db.prepare("DELETE FROM tournament WHERE id = 1");

let firebaseAdmin = null;

async function initFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const admin = (await import("firebase-admin")).default;
    if (!admin.apps.length) {
      const cred = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    }
    firebaseAdmin = admin;
    return admin;
  } catch (e) {
    console.warn("Firebase Admin no configurado:", e.message);
    return null;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function verifySuperAdmin(decoded) {
  const admin = await initFirebaseAdmin();
  if (!admin) return false;
  const dbFs = admin.firestore();
  const snap = await dbFs.collection("torneos_sc2").doc("admin_roles").get();
  if (!snap.exists) return false;
  const data = snap.data();
  return (data.superAdminUids || []).includes(decoded.uid);
}

async function verifyAuthHeader(req) {
  const admin = await initFirebaseAdmin();
  if (!admin) return { error: "Firebase Admin no configurado en el servidor", status: 503 };
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: "Falta token de autenticación", status: 401 };
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { decoded };
  } catch (e) {
    return { error: "Token inválido", status: 401 };
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function firebaseEnvDiagnostics() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !String(raw).trim()) {
    return { envSet: false, jsonValid: false, hint: "Falta FIREBASE_SERVICE_ACCOUNT_JSON en Render → Environment" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      return {
        envSet: true,
        jsonValid: false,
        hint: "El JSON no parece una cuenta de servicio de Firebase (falta client_email o private_key)",
      };
    }
    return { envSet: true, jsonValid: true, hint: null };
  } catch (e) {
    return {
      envSet: true,
      jsonValid: false,
      hint: `JSON inválido: ${e.message}. Pega el .json en UNA sola línea o usa comillas escapadas.`,
    };
  }
}

app.get("/api/health", async (_req, res) => {
  const fbEnv = firebaseEnvDiagnostics();
  const admin = await initFirebaseAdmin();
  res.json({
    ok: true,
    db: DB_PATH,
    firebaseAdmin: !!admin,
    firebaseEnvSet: fbEnv.envSet,
    firebaseJsonValid: fbEnv.jsonValid,
    firebaseHint: fbEnv.hint,
    emailConfigured: isEmailConfigured(),
    emailMode: getEmailMode(),
    appPublicUrl: process.env.APP_PUBLIC_URL || null,
  });
});

app.get("/api/tournament", (_req, res) => {
  const row = selectRow.get();
  if (!row) {
    return res.json({ data: null, updatedAt: null });
  }
  res.json({
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
  });
});

app.put("/api/tournament", (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido" });
  }
  const updatedAt = new Date().toISOString();
  upsertRow.run({
    data: JSON.stringify(payload),
    updated_at: updatedAt,
  });
  res.json({ ok: true, updatedAt });
});

app.delete("/api/tournament", (_req, res) => {
  deleteRow.run();
  res.json({ ok: true });
});

function resolveContinueUrl(req) {
  const fromBody = String(req.body?.continueUrl || "").trim();
  if (fromBody.startsWith("http://") || fromBody.startsWith("https://")) return fromBody;
  const envUrl = String(process.env.APP_PUBLIC_URL || "").trim();
  if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) return envUrl;
  return null;
}

/** Invitar editor: crea usuario en Auth y envía correo con enlace para contraseña */
app.post("/api/admin/invite", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const isSuper = await verifySuperAdmin(auth.decoded);
  if (!isSuper) return res.status(403).json({ error: "Solo el administrador principal puede invitar" });

  const email = normalizeEmail(req.body?.email);
  const role = req.body?.role === "super" ? "super" : "editor";
  if (role === "super") {
    return res.status(400).json({ error: "No se puede invitar otro admin principal desde aquí" });
  }
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Correo inválido" });
  }

  if (!isEmailConfigured()) {
    return res.status(503).json({
      error:
        "Servicio de correo no configurado. En Render usa RESEND_API_KEY y EMAIL_FROM (ver SETUP-EMAIL.txt).",
    });
  }

  const continueUrl = resolveContinueUrl(req);
  if (!continueUrl) {
    return res.status(400).json({
      error:
        "Falta URL de retorno. Define APP_PUBLIC_URL en el servidor o envía continueUrl desde el panel.",
    });
  }

  const admin = await initFirebaseAdmin();
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      userRecord = await admin.auth().createUser({ email, emailVerified: false });
    } else {
      return res.status(500).json({ error: e.message });
    }
  }

  const dbFs = admin.firestore();
  const ref = dbFs.collection("torneos_sc2").doc("admin_roles");
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : { superAdminUids: [], editorUids: [], members: [] };
  const editorUids = [...new Set([...(data.editorUids || []), userRecord.uid])];
  const members = [
    ...(data.members || []).filter((m) => m.uid !== userRecord.uid),
    {
      uid: userRecord.uid,
      email,
      role: "editor",
      addedAt: new Date().toISOString(),
      invitedBy: auth.decoded.uid,
    },
  ];
  const pendingInvites = (data.pendingInvites || []).filter(
    (p) => normalizeEmail(p.email) !== email
  );
  await ref.set({ editorUids, members, pendingInvites }, { merge: true });

  let setupLink;
  try {
    setupLink = await admin.auth().generatePasswordResetLink(email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
  } catch (e) {
    return res.status(500).json({
      error: `No se pudo generar el enlace de invitación: ${e.message}. Revisa dominios autorizados en Firebase y APP_PUBLIC_URL.`,
    });
  }

  try {
    await sendInviteEmail({
      to: email,
      setupLink,
      appName: process.env.APP_NAME || "Torneo StarCraft",
    });
  } catch (e) {
    return res.status(502).json({
      error: `Usuario creado pero falló el envío del correo: ${e.message}`,
      uid: userRecord.uid,
      email,
    });
  }

  res.json({
    ok: true,
    uid: userRecord.uid,
    email,
    emailSent: true,
    message: `Correo de invitación enviado a ${email}. Revisa spam si no llega en 2 minutos.`,
  });
});

app.listen(PORT, () => {
  console.log(`Torneo StarCraft: http://localhost:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("Invitaciones: define FIREBASE_SERVICE_ACCOUNT_JSON en Render");
  }
  if (!isEmailConfigured()) {
    console.log("Invitaciones: define RESEND_API_KEY + EMAIL_FROM en Render (SETUP-EMAIL.txt)");
  }
  if (!process.env.APP_PUBLIC_URL) {
    console.log("Invitaciones: define APP_PUBLIC_URL (ej. https://tu-app.onrender.com/admin.html)");
  }
});
