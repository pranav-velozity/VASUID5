# UID Ops Backend (Render-ready)

## Run locally
```bash
npm install
npm start
# http://localhost:4000
```

## Deploy to Render
- Web Service root: this folder
- Build command: `npm install`
- Start command: `node server.js`
- **Environment variables**:
  - `ALLOWED_ORIGIN` = `https://<your-netlify-site>.netlify.app`  (exact origin; or `*` for dev)
  - `DB_DIR` = `/var/data`  (ensure a Disk is mounted here)
  - `npm_config_build_from_source` = `true`  (forces native rebuild)
- **Disks**: Add a Disk and mount it at `/var/data`
- Node version is pinned via `.nvmrc` and `engines` to `20.17.0`.

If you hit native module errors for `better-sqlite3`, clear build cache and redeploy.
