# Wrights L.C. Quoting System

This app supports:
- Quote/invoice workflow
- Route distance/time via OSRM
- Automatic file save to OneDrive via Microsoft Graph (desktop + mobile)

## Environment Setup

Create `.env` from `.env.example` and set values.

### Required for OneDrive Auto-Save (Option 1)

```env
VITE_AZURE_CLIENT_ID=<your-app-client-id>
VITE_AZURE_TENANT_ID=common
VITE_AZURE_REDIRECT_URI=http://localhost:5173
VITE_ONEDRIVE_TARGET_PATH=Business/WRIGHTS LC/Invoices
```

- `VITE_ONEDRIVE_TARGET_PATH` is relative to your OneDrive root.
- Do not include leading/trailing slash.

## Azure / Entra App Registration

1. Go to Azure Portal -> Microsoft Entra ID -> App registrations -> New registration.
2. Name the app (e.g., Wrights LC Quoting).
3. Supported account types: choose `Accounts in any organizational directory and personal Microsoft accounts`.
4. Add Redirect URI for SPA:
   - `http://localhost:5173`
   - your production URL when deployed (example: `https://your-app-domain.vercel.app`)
5. Under API permissions, add Microsoft Graph delegated permission:
   - `Files.ReadWrite`
   - `User.Read`
   - `Mail.Send`
   - `Mail.ReadWrite`
6. Grant consent as required by tenant policy.
7. Copy Application (client) ID into `VITE_AZURE_CLIENT_ID`.

## Deploy (Phone + Desktop Access)

Use a free static host (recommended: Vercel). Data still stays in your OneDrive.

### 1) Push code to GitHub

- Create a GitHub repo and push this project.

### 2) Deploy to Vercel

1. Go to Vercel and import the GitHub repo.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Deploy.

`vercel.json` is included for SPA route rewrites.

### 3) Set Vercel environment variables

In Vercel -> Project -> Settings -> Environment Variables:

```env
VITE_OSRM_BASE_URL=https://router.project-osrm.org
VITE_AZURE_CLIENT_ID=<your-app-client-id>
VITE_AZURE_TENANT_ID=common
VITE_AZURE_REDIRECT_URI=https://your-app-domain.vercel.app
VITE_ONEDRIVE_TARGET_PATH=Business/WRIGHTS LC/Invoices
```

Redeploy after setting env vars.

### 4) Add production redirect URI in Azure app

In Azure app registration -> Authentication -> Single-page application:

- `http://localhost:5173`
- `https://your-app-domain.vercel.app`

### 5) Test live

1. Open app URL on desktop and phone.
2. Sign in once.
3. Save estimate/invoice to confirm OneDrive upload.
4. Send test estimate email and confirm `Graph 202`.

## Save Behavior

- Quote save:
  - Tries Graph upload to OneDrive (`.json` + `.pdf`)
  - Falls back to local folder-handle auto-save if configured
- Invoice save:
  - Default output is Excel (`.xlsx`)
  - PDF export also keeps matching Excel filename
  - Both try OneDrive Graph first, then local folder handle fallback

## OSRM Routing Endpoint

```env
VITE_OSRM_BASE_URL=http://localhost:5000
```

If omitted, app uses public OSRM demo server.
