import express from "express";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    db: DB_PATH,
    firebaseAdmin: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
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

/** Invitar editor: crea usuario en Auth y deja listo el correo de contraseña */
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

  res.json({ ok: true, uid: userRecord.uid, email });
});

app.listen(PORT, () => {
  console.log(`Torneo StarCraft: http://localhost:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("Invitaciones por correo: define FIREBASE_SERVICE_ACCOUNT_JSON en Render");
  }
});
