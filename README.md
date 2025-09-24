# velOzity Backend

Express + SQLite backend for the velOzity UI.

## Endpoints
- `GET /health` → `{ ok: true }`
- `GET /plan/weeks/:weekStart` → `[{ po_number, sku_code, target_qty }, ...]`
- `POST /plan/weeks/:weekStart` body = array above → upsert
- `GET /records?from=YYYY-MM-DD&to=YYYY-MM-DD&status=complete&limit=50000` → `{ records: [...] }`
- `POST /records` body = `{ po_number, sku_code, date_local, status? }`
- `POST /export/summary.docx` body = `{ weekStart, weekEnd, logoDataURL? }` → downloads `.docx`

## Local dev
```bash
npm ci
npm start
# defaults: PORT=3000, DB_PATH=./data.sqlite, ALLOWED_ORIGINS=* (allow all)
```

## Render deploy
1. Push this folder to GitHub.
2. Render → **New Web Service** → connect repo.
3. Build: `npm ci` • Start: `node server.js`.
4. Env vars:
   - `NODE_VERSION=20.17.0`
   - `ALLOWED_ORIGINS=https://vasdash.netlify.app,https://web-sandbox.oaiusercontent.com`
   - `DB_PATH=/var/data/data.sqlite` (plus attach a disk mounted at `/var/data`)
