import express from "express";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getEmailMode,
  gmailEnvDiagnostics,
  isEmailConfigured,
  sendInviteEmail,
  sendPasswordSetupEmail,
} from "./email.js";
import { createTournamentLib } from "./tournament-lib.mjs";
import {
  LEGACY_TOURNAMENT_ID,
  USER_TOURNAMENT_PREFIX,
  generateUserTournamentId,
  isLegacyPrincipal,
  isUserTournamentId,
  emptyTournamentPayload,
} from "./tournament-tenant.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "tournament.db");
const FIRESTORE_COLLECTION = "torneos_sc2";
const FIRESTORE_DOCUMENT_ID = "principal";
const tournamentLib = createTournamentLib({ maxPlayersPerTeam: 6 });

function publicTournamentEntry(id, name, payload, updatedAt) {
  if (!tournamentLib.isPubliclyListable(payload)) return null;
  return {
    id,
    name: name || payload?.tournamentName || id,
    drawn: true,
    teamCount: payload?.teams?.length || 0,
    updatedAt: updatedAt || payload?.savedAt || payload?.drawInfo?.drawnAt || null,
  };
}

function extractFirestorePayload(docData) {
  return tournamentLib.decodePayloadFromFirestore(docData);
}

function buildFirestoreWriteFields(admin, payload, extra = {}) {
  const encoded = tournamentLib.encodePayloadForFirestoreDoc(payload);
  if (!encoded) return null;
  return {
    ...encoded,
    payload: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  };
}

async function readPublishedPrincipalEntry() {
  const sqlite = readSqliteTournamentPayload();
  const firestore = await readFirestoreTournamentPayload();
  if (!sqlite && !firestore) return null;

  const candidates = [];
  if (firestore?.data) {
    candidates.push({
      data: firestore.data,
      updatedAt: firestore.updatedAt,
      name: firestore.data?.tournamentName || "Torneo principal",
    });
  }
  if (sqlite?.data) {
    candidates.push({
      data: sqlite.data,
      updatedAt: sqlite.updatedAt,
      name: sqlite.data?.tournamentName || "Torneo principal",
    });
  }

  const published = candidates.filter((c) => tournamentLib.isPubliclyListable(c.data));
  const pick =
    published.sort(
      (a, b) =>
        tournamentLib.payloadScore(b.data) - tournamentLib.payloadScore(a.data) ||
        Date.parse(b.data?.savedAt || 0) - Date.parse(a.data?.savedAt || 0)
    )[0] || null;

  if (!pick) return null;
  return publicTournamentEntry(
    LEGACY_TOURNAMENT_ID,
    pick.name,
    pick.data,
    pick.updatedAt || pick.data?.savedAt || null
  );
}

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

function readSqliteTournamentPayload() {
  const row = selectRow.get();
  if (!row) return null;
  try {
    return {
      data: JSON.parse(row.data),
      updatedAt: row.updated_at,
    };
  } catch (e) {
    console.warn("SQLite torneo corrupto:", e.message);
    return null;
  }
}

function writeSqliteTournamentPayload(payload, updatedAt = new Date().toISOString()) {
  upsertRow.run({
    data: JSON.stringify(payload),
    updated_at: updatedAt,
  });
  return updatedAt;
}

function isStaleTournamentWrite(incoming, current) {
  return tournamentLib.isIncomingStaleWrite(incoming, current);
}

async function readFirestoreTournamentPayloadById(documentId) {
  const admin = await initFirebaseAdmin();
  if (!admin) return null;
  try {
    const snap = await admin
      .firestore()
      .collection(FIRESTORE_COLLECTION)
      .doc(documentId)
      .get();
    if (!snap.exists) return null;
    const doc = snap.data();
    const payload = extractFirestorePayload(doc);
    if (!payload) return null;
    return {
      data: payload,
      updatedAt: doc.updatedAt?.toDate?.()?.toISOString?.() || payload.savedAt || null,
      meta: {
        ownerUid: doc.ownerUid || null,
        name: doc.name || null,
      },
    };
  } catch (e) {
    console.warn("Firestore torneo lectura:", e.message);
    return null;
  }
}

async function readFirestoreTournamentPayload() {
  return readFirestoreTournamentPayloadById(FIRESTORE_DOCUMENT_ID);
}

async function writeFirestoreTournamentPayloadById(documentId, payload, extra = {}, options = {}) {
  const admin = await initFirebaseAdmin();
  if (!admin) return false;
  try {
    const firestore = admin.firestore();
    const ref = firestore.collection(FIRESTORE_COLLECTION).doc(documentId);
    const snap = await ref.get();
    const current = snap.exists ? extractFirestorePayload(snap.data()) : null;
    const needsFirstPublish =
      tournamentLib.isPubliclyListable(payload) && !tournamentLib.isPubliclyListable(current);
    const useDirectSet =
      options.force ||
      needsFirstPublish ||
      (isUserTournamentId(documentId) && tournamentLib.isPubliclyListable(payload));

    const writeFields = buildFirestoreWriteFields(admin, payload, extra);
    if (!writeFields) return false;

    if (useDirectSet) {
      await ref.set(writeFields, { merge: true });
      return true;
    }

    let wrote = false;
    await firestore.runTransaction(async (tx) => {
      const txSnap = await tx.get(ref);
      if (txSnap.exists) {
        const cur = extractFirestorePayload(txSnap.data());
        if (isStaleTournamentWrite(payload, cur)) return;
      }
      wrote = true;
      tx.set(ref, writeFields, { merge: true });
    });
    return wrote;
  } catch (e) {
    console.warn("Firestore torneo escritura:", e.message);
    return false;
  }
}

async function writeFirestoreTournamentPayload(payload) {
  return writeFirestoreTournamentPayloadById(FIRESTORE_DOCUMENT_ID, payload);
}

function loadFirebaseServiceAccountRaw() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8").trim();
  }
  const renderSecret = "/etc/secrets/firebase-service-account.json";
  if (fs.existsSync(renderSecret)) {
    return fs.readFileSync(renderSecret, "utf8").trim();
  }
  return null;
}

async function initFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  const raw = loadFirebaseServiceAccountRaw();
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

async function getAdminRolesData() {
  const admin = await initFirebaseAdmin();
  if (!admin) return null;
  const snap = await admin.firestore().collection("torneos_sc2").doc("admin_roles").get();
  if (!snap.exists) return null;
  return snap.data();
}

async function verifySuperAdmin(decoded) {
  const data = await getAdminRolesData();
  if (!data) return false;
  return (data.superAdminUids || []).includes(decoded.uid);
}

async function verifyEditor(decoded) {
  const data = await getAdminRolesData();
  if (!data) return false;
  return (data.editorUids || []).includes(decoded.uid);
}

async function verifyCanWriteTournament(decoded, tournamentId = LEGACY_TOURNAMENT_ID) {
  if (isLegacyPrincipal(tournamentId)) {
    return verifySuperAdmin(decoded);
  }
  if (!isUserTournamentId(tournamentId)) return false;
  if (await verifySuperAdmin(decoded)) return true;
  const admin = await initFirebaseAdmin();
  if (!admin) return false;
  const snap = await admin
    .firestore()
    .collection(FIRESTORE_COLLECTION)
    .doc(tournamentId)
    .get();
  if (!snap.exists) return false;
  const doc = snap.data();
  const ownerUid = doc?.ownerUid;
  const email = normalizeEmail(decoded.email);
  const ownerEmail = normalizeEmail(doc?.ownerEmail);
  if (ownerUid === decoded.uid) return true;
  if (ownerEmail && email && ownerEmail === email) return true;
  if (!ownerUid && (await verifyEditor(decoded))) return true;
  if (await verifyEditor(decoded)) {
    const owned = await admin
      .firestore()
      .collection(FIRESTORE_COLLECTION)
      .where("ownerUid", "==", decoded.uid)
      .get();
    if (owned.docs.some((d) => d.id === tournamentId)) return true;
  }
  return false;
}

function normalizePublishPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const out = { ...payload };
  if (tournamentLib.hasBracketStructure(out)) {
    out.drawn = true;
  }
  return out;
}

/** Correos que pueden registrarse como admin principal (servidor, sin depender de reglas cliente). */
function getBootstrapSuperEmails() {
  const raw =
    process.env.BOOTSTRAP_SUPER_ADMIN_EMAILS ||
    "geylquimichen@ucvvirtual.edu.pe,geylquimichen@gmail.com";
  return raw
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
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

async function optionalAuthHeader(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { decoded: null };
  const auth = await verifyAuthHeader(req);
  if (auth.error) return { decoded: null };
  return { decoded: auth.decoded };
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function firebaseEnvDiagnostics() {
  const raw = loadFirebaseServiceAccountRaw();
  if (!raw) {
    return {
      envSet: false,
      jsonValid: false,
      hint:
        "Falta Firebase: FIREBASE_SERVICE_ACCOUNT_JSON en Environment, o Secret File firebase-service-account.json (ver SETUP-RENDER-FIREBASE.txt)",
    };
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
  const gmEnv = gmailEnvDiagnostics();
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
    gmailEnvSet: gmEnv.envSet,
    gmailHint: gmEnv.hint,
    appPublicUrl: process.env.APP_PUBLIC_URL || null,
  });
});

app.get("/api/tournament", async (req, res) => {
  const auth = await optionalAuthHeader(req);
  if (auth.decoded) {
    const isSuper = await verifySuperAdmin(auth.decoded);
    if (!isSuper) {
      const roles = await getAdminRolesData();
      if ((roles?.editorUids || []).includes(auth.decoded.uid)) {
        return res.status(403).json({
          error: "El torneo principal solo está disponible para el administrador principal.",
        });
      }
    }
  }

  const sqlite = readSqliteTournamentPayload();
  const firestore = await readFirestoreTournamentPayload();

  if (!sqlite && !firestore) {
    return res.json({ data: null, updatedAt: null, source: "empty" });
  }

  let data = null;
  const candidates = [];
  if (firestore?.data) candidates.push(firestore.data);
  if (sqlite?.data) candidates.push(sqlite.data);
  const published = candidates.filter((c) => tournamentLib.isPubliclyListable(c));
  if (published.length) {
    data = published.sort(
      (a, b) => tournamentLib.payloadScore(b) - tournamentLib.payloadScore(a)
    )[0];
  } else {
    data =
      firestore && sqlite
        ? tournamentLib.mergePayload(sqlite.data, firestore.data, { prefer: "cloud" })
        : firestore?.data || sqlite?.data;
  }
  const updatedAt =
    data?.savedAt || firestore?.updatedAt || sqlite?.updatedAt || new Date().toISOString();

  // Si Render perdió/recreó SQLite al hibernar, lo rehidrata desde Firestore.
  if (data && (!sqlite || tournamentLib.payloadScore(data) > tournamentLib.payloadScore(sqlite.data))) {
    writeSqliteTournamentPayload(data, updatedAt);
  }
  // Si por alguna caída previa solo SQLite tenía lo más nuevo, repara Firestore.
  if (data && (!firestore || tournamentLib.payloadScore(data) > tournamentLib.payloadScore(firestore.data))) {
    await writeFirestoreTournamentPayload(data);
  }

  res.json({
    data,
    updatedAt,
    source: firestore ? (sqlite ? "merged" : "firestore") : "sqlite",
  });
});

app.put("/api/tournament", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const canWrite = await verifyCanWriteTournament(auth.decoded, LEGACY_TOURNAMENT_ID);
  if (!canWrite) {
    return res.status(403).json({
      error: "No tienes permiso para guardar en el servidor. Inicia sesión como admin o editor.",
    });
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido" });
  }
  const sqlite = readSqliteTournamentPayload();
  const firestore = await readFirestoreTournamentPayload();
  const current = firestore && sqlite
    ? tournamentLib.mergePayload(sqlite.data, firestore.data, { prefer: "cloud" })
    : (firestore?.data || sqlite?.data);
  if (isStaleTournamentWrite(payload, current)) {
    const updatedAt =
      current?.savedAt || firestore?.updatedAt || sqlite?.updatedAt || new Date().toISOString();
    return res.json({ ok: true, stale: true, updatedAt, firestoreOk: true });
  }
  const updatedAt = new Date().toISOString();
  writeSqliteTournamentPayload(payload, updatedAt);
  const firestoreOk = await writeFirestoreTournamentPayload(payload);
  res.json({ ok: true, updatedAt, firestoreOk });
});

app.delete("/api/tournament", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const isSuper = await verifySuperAdmin(auth.decoded);
  if (!isSuper) {
    return res.status(403).json({
      error: "Solo el administrador principal puede borrar la copia del servidor.",
    });
  }
  deleteRow.run();
  const admin = await initFirebaseAdmin();
  if (admin) {
    try {
      await admin.firestore().collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOCUMENT_ID).delete();
    } catch (e) {
      console.warn("Firestore torneo borrar:", e.message);
    }
  }
  res.json({ ok: true });
});

/** Catálogo público: torneos con cuadro sorteado (principal + ut_*). */
app.get("/api/tournaments/public", async (_req, res) => {
  const tournaments = [];
  try {
    const principal = await readPublishedPrincipalEntry();
    if (principal) tournaments.push(principal);

    const admin = await initFirebaseAdmin();
    if (admin) {
      const snap = await admin.firestore().collection(FIRESTORE_COLLECTION).get();
      for (const d of snap.docs) {
        if (!isUserTournamentId(d.id)) continue;
        const data = d.data();
        const payload = extractFirestorePayload(data);
        if (!payload) continue;
        const entry = publicTournamentEntry(
          d.id,
          data.name,
          payload,
          data.updatedAt?.toDate?.()?.toISOString?.() ||
            payload?.savedAt ||
            payload?.drawInfo?.drawnAt ||
            null
        );
        if (entry) tournaments.push(entry);
      }
    }

    tournaments.sort(
      (a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)
    );
    res.json({ tournaments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Lista torneos del usuario (no incluye `principal`). */
app.get("/api/tournaments", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const admin = await initFirebaseAdmin();
  if (!admin) return res.json({ tournaments: [] });
  try {
    const snap = await admin
      .firestore()
      .collection(FIRESTORE_COLLECTION)
      .where("ownerUid", "==", auth.decoded.uid)
      .get();
    const tournaments = snap.docs
      .filter((d) => isUserTournamentId(d.id))
      .map((d) => {
        const data = d.data();
        const payload = extractFirestorePayload(data);
        return {
          id: d.id,
          name: data.name || d.id,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || payload?.savedAt || null,
          teamCount: payload?.teams?.length || 0,
          drawn: !!payload?.drawn,
        };
      });
    res.json({ tournaments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Crear torneo propio (documento ut_* en Firestore). */
app.post("/api/tournaments", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const admin = await initFirebaseAdmin();
  if (!admin) {
    return res.status(503).json({ error: "Firebase Admin no configurado en el servidor." });
  }
  const name = String(req.body?.name || "Mi torneo").trim().slice(0, 80) || "Mi torneo";
  const id = generateUserTournamentId();
  const payload = emptyTournamentPayload();
  payload.tournamentName = name;
  const now = new Date().toISOString();
  const createFields = buildFirestoreWriteFields(admin, payload, {
    ownerUid: auth.decoded.uid,
    ownerEmail: auth.decoded.email || null,
    name,
    createdAt: now,
  });
  await admin.firestore().collection(FIRESTORE_COLLECTION).doc(id).set(createFields);
  res.json({ ok: true, id, name, publicUrl: `index.html?t=${encodeURIComponent(id)}` });
});

app.get("/api/tournaments/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUserTournamentId(id)) {
    return res.status(400).json({ error: "ID de torneo inválido" });
  }
  const firestore = await readFirestoreTournamentPayloadById(id);
  if (!firestore) {
    return res.json({ data: null, updatedAt: null, source: "empty", id });
  }
  const auth = await optionalAuthHeader(req);
  const isOwnerOrSuper =
    auth.decoded &&
    (auth.decoded.uid === firestore.meta?.ownerUid ||
      (await verifySuperAdmin(auth.decoded)));
  if (!tournamentLib.isPubliclyListable(firestore.data) && !isOwnerOrSuper) {
    return res.status(403).json({
      error: "Este torneo aún no está publicado (falta sortear cruces).",
      id,
      name: firestore.meta?.name || id,
      published: false,
    });
  }
  res.json({
    data: firestore.data,
    updatedAt: firestore.updatedAt,
    source: "firestore",
    id,
    name: firestore.meta?.name || id,
    ownerUid: firestore.meta?.ownerUid || null,
      published: !!tournamentLib.isPubliclyListable(firestore.data),
  });
});

app.put("/api/tournaments/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUserTournamentId(id)) {
    return res.status(400).json({ error: "ID de torneo inválido" });
  }
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const canWrite = await verifyCanWriteTournament(auth.decoded, id);
  if (!canWrite) {
    const meta = await readFirestoreTournamentPayloadById(id);
    console.warn(
      "PUT torneo denegado:",
      id,
      "uid=",
      auth.decoded.uid,
      "owner=",
      meta?.meta?.ownerUid
    );
    return res.status(403).json({ error: "No tienes permiso para guardar este torneo." });
  }
  const payload = normalizePublishPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: "Cuerpo inválido" });
  }
  const current = await readFirestoreTournamentPayloadById(id);
  const force = req.query.force === "1" || req.query.force === "true";
  const needsFirstPublish =
    tournamentLib.isPubliclyListable(payload) && !tournamentLib.isPubliclyListable(current?.data);
  if (!force && !needsFirstPublish && isStaleTournamentWrite(payload, current?.data)) {
    return res.json({
      ok: true,
      stale: true,
      updatedAt: current?.updatedAt || new Date().toISOString(),
      firestoreOk: false,
    });
  }
  const updatedAt = new Date().toISOString();
  const firestoreOk = await writeFirestoreTournamentPayloadById(
    id,
    payload,
    {
      name: payload.tournamentName || current?.meta?.name || "Mi torneo",
      ownerUid: current?.meta?.ownerUid || auth.decoded.uid,
    },
    { force: force || needsFirstPublish }
  );
  if (!firestoreOk && needsFirstPublish) {
    console.warn("PUT torneo: reintento directo Firestore", id);
    const retryOk = await writeFirestoreTournamentPayloadById(
      id,
      payload,
      {
        name: payload.tournamentName || current?.meta?.name || "Mi torneo",
        ownerUid: current?.meta?.ownerUid || auth.decoded.uid,
      },
      { force: true }
    );
    res.json({
      ok: true,
      updatedAt,
      firestoreOk: retryOk,
      published: !!tournamentLib.isPubliclyListable(payload),
      retried: !firestoreOk && retryOk,
    });
    return;
  }
  res.json({ ok: true, updatedAt, firestoreOk, published: !!tournamentLib.isPubliclyListable(payload) });
});

/** Publicar cuadro sorteado (editores / dueños). Escritura directa en Firestore vía Admin SDK. */
app.post("/api/tournaments/:id/publish", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUserTournamentId(id)) {
    return res.status(400).json({ error: "ID de torneo inválido" });
  }
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const canWrite = await verifyCanWriteTournament(auth.decoded, id);
  if (!canWrite) {
    return res.status(403).json({
      error: "No tienes permiso para publicar este torneo. Usa la cuenta que lo creó.",
    });
  }
  const payload = normalizePublishPayload(req.body);
  if (!payload || !tournamentLib.hasBracketStructure(payload)) {
    return res.status(400).json({
      error: "Falta el cuadro sorteado. Sortea cruces en admin y vuelve a publicar.",
    });
  }
  const admin = await initFirebaseAdmin();
  if (!admin) return res.status(503).json({ error: "Firebase Admin no configurado." });
  const ref = admin.firestore().collection(FIRESTORE_COLLECTION).doc(id);
  const snap = await ref.get();
  const meta = snap.exists ? snap.data() : {};
  const ownerUid =
    meta.ownerUid === auth.decoded.uid ||
    !meta.ownerUid ||
    normalizeEmail(meta.ownerEmail) === normalizeEmail(auth.decoded.email)
      ? auth.decoded.uid
      : meta.ownerUid;
  try {
    const writeFields = buildFirestoreWriteFields(admin, payload, {
      ownerUid,
      ownerEmail: meta.ownerEmail || auth.decoded.email || null,
      name: payload.tournamentName || meta.name || id,
    });
    if (!writeFields) {
      return res.status(400).json({ error: "Payload inválido para publicar." });
    }
    await ref.set(writeFields, { merge: true });
    res.json({
      ok: true,
      firestoreOk: true,
      published: true,
      id,
      name: payload.tournamentName || meta.name || id,
    });
  } catch (e) {
    console.warn("POST publish:", e.message);
    res.status(500).json({ error: "No se pudo publicar en Firestore: " + e.message });
  }
});

app.delete("/api/tournaments/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUserTournamentId(id)) {
    return res.status(400).json({ error: "ID de torneo inválido" });
  }
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const canWrite = await verifyCanWriteTournament(auth.decoded, id);
  if (!canWrite) {
    return res.status(403).json({ error: "No tienes permiso para borrar este torneo." });
  }
  const admin = await initFirebaseAdmin();
  if (!admin) return res.status(503).json({ error: "Firebase Admin no configurado." });
  await admin.firestore().collection(FIRESTORE_COLLECTION).doc(id).delete();
  res.json({ ok: true });
});

function resolveContinueUrl(req) {
  const fromBody = String(req.body?.continueUrl || "").trim();
  if (fromBody.startsWith("http://") || fromBody.startsWith("https://")) return fromBody;
  const envUrl = String(process.env.APP_PUBLIC_URL || "").trim();
  if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) return envUrl;
  return null;
}

/** Crear contraseña (login): envía enlace por Gmail API; no requiere estar logueado */
app.post("/api/auth/password-setup-email", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Correo inválido" });
  }

  const admin = await initFirebaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "Firebase Admin no configurado en el servidor. Añade FIREBASE_SERVICE_ACCOUNT_JSON en Render.",
    });
  }

  if (!isEmailConfigured()) {
    return res.status(503).json({
      error: "Correo no configurado. Configura Gmail API en Render (SETUP-GMAIL-API.txt).",
    });
  }

  const continueUrl = resolveContinueUrl(req);
  if (!continueUrl) {
    return res.status(400).json({
      error: "Falta APP_PUBLIC_URL en el servidor.",
    });
  }

  try {
    await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      return res.status(404).json({
        error: "No hay cuenta con este correo. Pide una invitación al administrador principal.",
      });
    }
    return res.status(500).json({ error: e.message });
  }

  let setupLink;
  try {
    setupLink = await admin.auth().generatePasswordResetLink(email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
  } catch (e) {
    return res.status(500).json({
      error: `No se pudo generar el enlace: ${e.message}`,
    });
  }

  try {
    await sendPasswordSetupEmail({
      to: email,
      setupLink,
      appName: process.env.APP_NAME || "Torneo StarCraft",
    });
  } catch (e) {
    return res.status(502).json({ error: `No se pudo enviar el correo: ${e.message}` });
  }

  res.json({
    ok: true,
    email,
    message: `Correo enviado a ${email}. Revisa bandeja y spam.`,
  });
});

/**
 * Registra el uid del usuario en admin_roles (Admin SDK).
 * Útil cuando Firestore rules del cliente bloquean el primer alta del admin.
 */
app.post("/api/admin/bootstrap-roles", async (req, res) => {
  const auth = await verifyAuthHeader(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const email = normalizeEmail(auth.decoded.email);
  const allowed = getBootstrapSuperEmails();
  if (!allowed.includes(email)) {
    return res.status(403).json({
      error: `El correo ${email} no está en la lista de admin principal del servidor.`,
      allowedEmails: allowed,
    });
  }

  const admin = await initFirebaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "Firebase Admin no configurado en Render (FIREBASE_SERVICE_ACCOUNT_JSON).",
    });
  }

  const uid = auth.decoded.uid;
  const ref = admin.firestore().collection("torneos_sc2").doc("admin_roles");
  const snap = await ref.get();
  const data = snap.exists
    ? snap.data()
    : { superAdminUids: [], editorUids: [], members: [] };

  if ((data.superAdminUids || []).includes(uid)) {
    return res.json({ ok: true, uid, email, alreadyRegistered: true });
  }

  const next = {
    superAdminUids: [...new Set([...(data.superAdminUids || []), uid])],
    editorUids: data.editorUids || [],
    members: [
      ...(data.members || []).filter((m) => m.uid !== uid),
      {
        uid,
        email,
        role: "super",
        addedAt: new Date().toISOString(),
        source: "server-bootstrap",
      },
    ],
  };
  await ref.set(next, { merge: true });
  res.json({ ok: true, uid, email, message: "Admin principal registrado en Firestore." });
});

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
        "Servicio de correo no configurado. Usa Gmail API (SETUP-GMAIL-API.txt) o RESEND_API_KEY.",
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

async function requireSuperAdmin(req, res) {
  const auth = await verifyAuthHeader(req);
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return null;
  }
  if (!(await verifySuperAdmin(auth.decoded))) {
    res.status(403).json({ error: "Solo el administrador principal puede hacer esto." });
    return null;
  }
  return auth;
}

async function writeAdminRolesDoc(patch) {
  const admin = await initFirebaseAdmin();
  if (!admin) return null;
  const ref = admin.firestore().collection("torneos_sc2").doc("admin_roles");
  const snap = await ref.get();
  const data = snap.exists
    ? snap.data()
    : { superAdminUids: [], editorUids: [], members: [], pendingInvites: [] };
  const next = {
    superAdminUids: data.superAdminUids || [],
    editorUids: data.editorUids || [],
    members: data.members || [],
    pendingInvites: data.pendingInvites || [],
    ...patch,
  };
  await ref.set(next, { merge: true });
  return next;
}

/** Lista equipo admin con metadatos de Firebase Auth. */
app.get("/api/admin/staff", async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const data = (await getAdminRolesData()) || {
    superAdminUids: [],
    editorUids: [],
    members: [],
    pendingInvites: [],
  };
  const admin = await initFirebaseAdmin();
  const members = [];
  for (const m of data.members || []) {
    let authMeta = null;
    if (admin && m.uid) {
      try {
        const u = await admin.auth().getUser(m.uid);
        authMeta = {
          disabled: !!u.disabled,
          emailVerified: !!u.emailVerified,
          lastSignIn: u.metadata.lastSignInTime || null,
          creationTime: u.metadata.creationTime || null,
        };
      } catch (e) {
        authMeta = { missing: true };
      }
    }
    members.push({ ...m, auth: authMeta });
  }

  res.json({
    members,
    pendingInvites: data.pendingInvites || [],
    superAdminCount: (data.superAdminUids || []).length,
    editorCount: (data.editorUids || []).filter(
      (uid) => !(data.superAdminUids || []).includes(uid)
    ).length,
    currentUid: auth.decoded.uid,
  });
});

/** Quitar acceso de editor (deshabilita cuenta en Auth; opcional borrar). */
app.delete("/api/admin/members/:uid", async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const uid = String(req.params.uid || "").trim();
  if (!uid) return res.status(400).json({ error: "UID inválido" });
  if (uid === auth.decoded.uid) {
    return res.status(400).json({ error: "No puedes quitarte tu propio acceso." });
  }

  const data = await getAdminRolesData();
  if (!data) return res.status(404).json({ error: "No hay datos de roles." });
  if ((data.superAdminUids || []).includes(uid)) {
    return res.status(400).json({ error: "No se puede eliminar un admin principal." });
  }
  if (!(data.editorUids || []).includes(uid)) {
    return res.status(404).json({ error: "Este usuario no es editor." });
  }

  const member = (data.members || []).find((m) => m.uid === uid);
  const email = member?.email || null;
  const editorUids = (data.editorUids || []).filter((id) => id !== uid);
  const members = (data.members || []).filter((m) => m.uid !== uid);
  const pendingInvites = (data.pendingInvites || []).filter(
    (p) => !email || normalizeEmail(p.email) !== normalizeEmail(email)
  );
  await writeAdminRolesDoc({ editorUids, members, pendingInvites });

  const deleteAuth = String(req.query.deleteAuth || "") === "true";
  const admin = await initFirebaseAdmin();
  if (admin) {
    try {
      if (deleteAuth) await admin.auth().deleteUser(uid);
      else await admin.auth().updateUser(uid, { disabled: true });
    } catch (e) {
      console.warn("Auth al quitar editor:", e.message);
    }
  }

  res.json({
    ok: true,
    uid,
    email,
    disabled: !deleteAuth,
    deleted: deleteAuth,
    message: deleteAuth
      ? "Usuario eliminado del equipo y de Firebase Auth."
      : "Acceso revocado. La cuenta quedó deshabilitada en Firebase.",
  });
});

/** Reenviar correo de invitación / crear contraseña. */
app.post("/api/admin/invite/resend", async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Correo inválido" });
  }
  if (!isEmailConfigured()) {
    return res.status(503).json({ error: "Servicio de correo no configurado en el servidor." });
  }
  const continueUrl = resolveContinueUrl(req);
  if (!continueUrl) {
    return res.status(400).json({ error: "Falta APP_PUBLIC_URL o continueUrl." });
  }

  const admin = await initFirebaseAdmin();
  if (!admin) return res.status(503).json({ error: "Firebase Admin no configurado." });

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      return res.status(404).json({ error: "No hay cuenta con ese correo. Envía una invitación nueva." });
    }
    return res.status(500).json({ error: e.message });
  }

  const data = await getAdminRolesData();
  const isEditor = (data?.editorUids || []).includes(userRecord.uid);
  const isSuper = (data?.superAdminUids || []).includes(userRecord.uid);
  if (!isEditor && !isSuper) {
    return res.status(400).json({ error: "Ese correo no pertenece al equipo admin." });
  }

  let setupLink;
  try {
    setupLink = await admin.auth().generatePasswordResetLink(email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    await sendInviteEmail({
      to: email,
      setupLink,
      appName: process.env.APP_NAME || "Torneo StarCraft",
    });
  } catch (e) {
    return res.status(502).json({ error: `No se pudo enviar el correo: ${e.message}` });
  }

  if (userRecord.disabled) {
    try {
      await admin.auth().updateUser(userRecord.uid, { disabled: false });
    } catch (e) {
      console.warn("Reactivar usuario:", e.message);
    }
  }

  res.json({
    ok: true,
    email,
    emailSent: true,
    message: `Correo reenviado a ${email}.`,
  });
});

/** Cancelar invitación pendiente (sin quitar editor ya registrado). */
app.delete("/api/admin/invites", async (req, res) => {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Correo inválido" });

  const data = await getAdminRolesData();
  if (!data) return res.status(404).json({ error: "No hay datos de roles." });
  const had = (data.pendingInvites || []).some((p) => normalizeEmail(p.email) === email);
  const pendingInvites = (data.pendingInvites || []).filter(
    (p) => normalizeEmail(p.email) !== email
  );
  await writeAdminRolesDoc({ pendingInvites });

  res.json({
    ok: true,
    email,
    removed: had,
    message: had ? "Invitación pendiente cancelada." : "No había invitación pendiente para ese correo.",
  });
});

app.listen(PORT, () => {
  console.log(`Torneo StarCraft: http://localhost:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("Invitaciones: define FIREBASE_SERVICE_ACCOUNT_JSON en Render");
  }
  if (!isEmailConfigured()) {
    console.log("Invitaciones: Gmail API (SETUP-GMAIL-API.txt) o RESEND_API_KEY");
  }
  if (!process.env.APP_PUBLIC_URL) {
    console.log("Invitaciones: define APP_PUBLIC_URL (ej. https://tu-app.onrender.com/admin.html)");
  }
});
