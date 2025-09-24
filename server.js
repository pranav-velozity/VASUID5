// velOzity Backend — Express + SQLite + DOCX
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const Database = require('better-sqlite3');
const {
  Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType,
  ImageRun, Table, TableRow, TableCell, WidthType
} = require('docx');

// -------------------- Config --------------------
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const RAW = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '*';
const ALLOWED = RAW.split(',').map(s => s.trim()).filter(Boolean);
const isAllowed = (origin) => !origin || ALLOWED.includes('*') ||
  ALLOWED.some(a => a === origin || (a.startsWith('https://*.') && origin.endsWith(a.slice('https://*.'.length))));

// -------------------- App -----------------------
const app = express();
app.disable('x-powered-by');
app.use(morgan('tiny'));
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: (origin, cb) => isAllowed(origin) ? cb(null, true) : cb(new Error('CORS blocked: '+origin)) }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowed(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// -------------------- DB ------------------------
const db = new Database(DB_PATH);
// Pragmas for reliability
try { db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); } catch {}

// Tables
// plans: week_start (YYYY-MM-DD Monday), data: JSON string of [{po_number, sku_code, target_qty}]
db.prepare(`CREATE TABLE IF NOT EXISTS plans (
  week_start TEXT PRIMARY KEY,
  data TEXT NOT NULL
)`).run();

// records: one row per applied action
// Minimal fields consumed by UI: po_number, sku_code, date_local (YYYY-MM-DD), status ('complete')
db.prepare(`CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT,
  sku_code TEXT,
  date_local TEXT,
  status TEXT
)`).run();

db.prepare('CREATE INDEX IF NOT EXISTS idx_records_date ON records(date_local)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_records_status ON records(status)').run();

// -------------------- Helpers -------------------
function isISODate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')); }
function clampLimit(v, d){ const n = Number(v||d)||d; return Math.max(1, Math.min(200000, n)); }

// -------------------- Routes --------------------
app.get('/health', (req, res) => res.json({ ok: true }));

// Get plan for a week (array)
app.get('/plan/weeks/:weekStart', (req, res) => {
  const weekStart = req.params.weekStart;
  if (!isISODate(weekStart)) return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD (Monday)' });
  const row = db.prepare('SELECT data FROM plans WHERE week_start = ?').get(weekStart);
  let arr = [];
  if (row && row.data) { try { arr = JSON.parse(row.data); } catch { arr = []; } }
  res.json(arr);
});

// Upsert plan for a week (array of {po_number, sku_code, target_qty})
app.post('/plan/weeks/:weekStart', (req, res) => {
  const weekStart = req.params.weekStart;
  const plan = Array.isArray(req.body) ? req.body : [];
  if (!isISODate(weekStart)) return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD (Monday)' });
  db.prepare('INSERT INTO plans(week_start, data) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET data=excluded.data')
    .run(weekStart, JSON.stringify(plan));
  res.json({ ok: true, count: plan.length });
});

// Query records
// /records?from=YYYY-MM-DD&to=YYYY-MM-DD&status=complete&limit=50000
app.get('/records', (req, res) => {
  const { from, to, status = 'complete', limit } = req.query;
  if (!isISODate(from) || !isISODate(to)) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  const lim = clampLimit(limit, 50000);
  const rows = db.prepare(
    `SELECT po_number, sku_code, date_local, status
     FROM records
     WHERE date_local >= ? AND date_local <= ? AND status = ?
     ORDER BY date_local ASC
     LIMIT ?`
  ).all(from, to, status, lim);
  res.json({ records: rows });
});

// Insert one record (for ingestion/testing)
app.post('/records', (req, res) => {
  const { po_number, sku_code, date_local, status } = req.body || {};
  if (!po_number || !sku_code || !isISODate(date_local)) return res.status(400).json({ error: 'po_number, sku_code, date_local required' });
  db.prepare('INSERT INTO records(po_number, sku_code, date_local, status) VALUES (?, ?, ?, ?)')
    .run(String(po_number), String(sku_code), String(date_local), String(status || 'complete'));
  res.json({ ok: true });
});

// Word export (one-page summary)
app.post('/export/summary.docx', async (req, res) => {
  const { weekStart, weekEnd, logoDataURL } = req.body || {};
  if (!isISODate(weekStart) || !isISODate(weekEnd)) return res.status(400).json({ error: 'weekStart/weekEnd must be YYYY-MM-DD' });
  const planRow = db.prepare('SELECT data FROM plans WHERE week_start=?').get(weekStart);
  let plan = []; try { plan = planRow?.data ? JSON.parse(planRow.data) : []; } catch {}
  const plannedTotal = plan.reduce((s,r)=> s + (Number(r?.target_qty||0)||0), 0);
  const actuals = db.prepare(`
    SELECT po_number, date_local FROM records
    WHERE status='complete' AND date_local >= ? AND date_local <= ?
  `).all(weekStart, weekEnd);
  const appliedTotal = actuals.length;

  const P=new Map(); plan.forEach(r=> P.set(r.po_number, (P.get(r.po_number)||0) + (Number(r.target_qty||0)||0)));
  const A=new Map(); actuals.forEach(r=> A.set(r.po_number, (A.get(r.po_number)||0) + 1));
  const risk = Array.from(P.keys()).map(po=>({po, planned:P.get(po)||0, applied:A.get(po)||0}))
    .map(x=>({...x, remaining: Math.max(0, x.planned - x.applied)}))
    .filter(x=> x.remaining>0)
    .sort((a,b)=> b.remaining - a.remaining)
    .slice(0,5);

  const children = [];
  if (logoDataURL) {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(logoDataURL);
    if (m) {
      children.push(new Paragraph({ alignment: AlignmentType.LEFT, children:[
        new ImageRun({ data: Buffer.from(m[2], 'base64'), transformation: { width: 180, height: 48 } })
      ]}));
    }
  }
  children.push(new Paragraph({ text: 'Weekly Execution Summary', heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: `Week: ${weekStart} → ${weekEnd}` }));
  children.push(new Paragraph({ spacing: { after: 300 } }));

  const pct = plannedTotal>0 ? Math.round((appliedTotal/plannedTotal)*100) : 0;
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [ new TableRow({ children: [
    new TableCell({ children:[new Paragraph('Planned')] }), new TableCell({ children:[new Paragraph(String(plannedTotal))] }),
    new TableCell({ children:[new Paragraph('Applied')] }), new TableCell({ children:[new Paragraph(String(appliedTotal))] }),
    new TableCell({ children:[new Paragraph('Completion')] }), new TableCell({ children:[new Paragraph(pct + '%')] })
  ]}) ] }));

  children.push(new Paragraph({ spacing: { after: 200 } }));
  children.push(new Paragraph({ text: 'Top At-Risk POs (Remaining qty)', heading: HeadingLevel.HEADING_2 }));
  risk.forEach(r => children.push(new Paragraph({ children: [
    new TextRun({ text: `${r.po}  `, bold: true }),
    new TextRun({ text: `Rem: ${r.remaining}  (P:${r.planned} / A:${r.applied})` })
  ] })));

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buf = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="exec_summary_${weekStart}_to_${weekEnd}.docx"`);
  res.send(buf);
});

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log(`velOzity backend listening on :${PORT}`);
  console.log(`DB at ${DB_PATH}`);
  console.log(`Allowed origins: ${ALLOWED.join(', ') || '*'}\n`);
});
