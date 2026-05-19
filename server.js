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

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: DB_PATH });
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

app.listen(PORT, () => {
  console.log(`Torneo StarCraft: http://localhost:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
});
