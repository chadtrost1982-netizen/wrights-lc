# Wrights L.C. Quoting System

This app supports:
- Quote/invoice workflow
- Route distance/time via OSRM
- Automatic file save to OneDrive via Microsoft Graph (desktop + mobile)

## Environment Setup

Create `.env` from `.env.example` and set values.

Wholesale container and modification costs are not in the website bundle. The browser asks `/api/catalog` for selling prices only. That function checks the signed-in Microsoft account (or a shared password) before it answers. Markup (wholesale + $150, then the nearest $50) runs on the server.

Invoice and estimate numbers are separate sequences, reserved in one OneDrive file, `Desktop/Business/Disposal Solutions/counters.json`, so the PC and the phone cannot issue the same number. The file starts from the highest numbers already handed out: estimate 511 and invoice 509 (each of those was issued twice). The next estimate is 512 and the next invoice is 510. Existing files are not renumbered, and an invoice still keeps its estimate reference in the file name. In Settings, the boxes are the last number already used. The next document is one higher. Raising a number is allowed; lowering it is not. If a device already has a higher number saved locally, the shared counter moves up to that number before the next one is issued.

Driving distance uses the coordinates from the address suggestion you pick, and address search is limited to Ontario, Canada. If a route cannot be calculated, type the kilometres in the distance box and the quote still prices delivery. The server calls the public OSRM demo by default. Set `ORS_API_KEY` in Vercel to switch to OpenRouteService without putting the key in the browser.

### Required for OneDrive Auto-Save (Option 1)

```env
VITE_AZURE_CLIENT_ID=<your-app-client-id>
VITE_AZURE_TENANT_ID=common
VITE_AZURE_REDIRECT_URI=http://localhost:5173
VITE_REQUIRE_AUTH=true
VITE_ALLOWED_EMAILS=chadtrost@hotmail.com
VITE_ONEDRIVE_ESTIMATES_PATH=Desktop/Business/Disposal Solutions/Estimates
VITE_ONEDRIVE_INVOICES_PATH=Desktop/Business/Disposal Solutions/Invoices
```

- OneDrive paths are relative to your OneDrive root. `Desktop` is the OneDrive Desktop folder.
- Do not include leading/trailing slash.
- Leave the two path variables unset to use those Disposal Solutions folders.
- `VITE_ONEDRIVE_TARGET_PATH` is no longer used. A leftover `Business/WRIGHTS LC/...` value does not receive new files.
- Saving creates `Desktop/Business/Disposal Solutions/Estimates` or `Invoices` when that folder is missing. Files already in `Business/WRIGHTS LC` are left where they are.
- Access control:
  - `VITE_REQUIRE_AUTH=true` forces Microsoft sign-in before app access.
  - `VITE_ALLOWED_EMAILS` is a comma-separated allowlist; other accounts are blocked.

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
VITE_REQUIRE_AUTH=true
VITE_ALLOWED_EMAILS=chadtrost@hotmail.com
VITE_ONEDRIVE_ESTIMATES_PATH=Desktop/Business/Disposal Solutions/Estimates
VITE_ONEDRIVE_INVOICES_PATH=Desktop/Business/Disposal Solutions/Invoices
```

If Vercel already has the old `Business/WRIGHTS LC/Estimates` or `Business/WRIGHTS LC/Invoices` values, change them to the paths above (or delete them so the defaults apply) and redeploy. Also delete `VITE_ONEDRIVE_TARGET_PATH` if it is set. Until those variables are updated, new files keep going to whatever folder they name. Nothing in the old Wrights L.C. folders is moved.

Also set these server-only variables (do not add a `VITE_` prefix, or they would ship in the public website):

```env
ALLOWED_EMAILS=chadtrost@hotmail.com
AZURE_CLIENT_ID=<same client id as VITE_AZURE_CLIENT_ID>
APP_ACCESS_PASSWORD=<a password only Chad knows>
ORS_API_KEY=<optional OpenRouteService key>
```

- `ALLOWED_EMAILS` is the account allowed to load prices. If you leave it unset, the server falls back to `VITE_ALLOWED_EMAILS`.
- `AZURE_CLIENT_ID` is used to check the Microsoft sign-in token. If you leave it unset, the server falls back to `VITE_AZURE_CLIENT_ID`.
- `APP_ACCESS_PASSWORD` is optional. Use it if you want a password prompt instead of, or in addition to, Microsoft sign-in. The app remembers it on that device. Anyone without the password or the allowlisted account gets no prices.
- `ORS_API_KEY` is optional. Leave it empty to keep the public OSRM driving router. Set it to use OpenRouteService instead.
- `VITE_ONEDRIVE_COUNTERS_PATH` is optional. The default shared counter file is `Desktop/Business/Disposal Solutions/counters.json`. Delete it on Vercel if it still points at `Business/WRIGHTS LC/counters.json`.

Redeploy after setting env vars. The first new estimate is 512 and the first new invoice is 510. Open Settings only if you have already used a higher number, enter that last-used number, and save. Saved files are not renumbered.

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

## Driving distance

The browser calls `/api/geocode` and `/api/route`. Address search goes to Nominatim with a 1 request per second limit, a 24 hour cache, and an identifying app header, and it prefers Ontario. Routing uses OSRM unless `ORS_API_KEY` is set.

```env
OSRM_BASE_URL=https://router.project-osrm.org
ORS_API_KEY=
```

`VITE_OSRM_BASE_URL` still works as a fallback for the server. The public OSRM demo is not a production routing service; add an OpenRouteService key when you want a supported router.
