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

1. Open the app on the PC and on the phone.
2. Sign in as `chadtrost@hotmail.com` when Microsoft asks. That account is OneDrive.
3. Save an estimate or invoice and confirm it lands in the Disposal Solutions folder on that OneDrive.
4. Email a test file. The first time on each browser, sign in as `disposalsolutions@outlook.com` and accept Send mail. The alert should say it was sent from that address. See the checklist below.

## Sending email from Disposal Solutions

Invoices and estimates go out from `disposalsolutions@outlook.com`. OneDrive saves stay on `chadtrost@hotmail.com`. A personal Outlook mailbox cannot send mail as a different address, so the same browser holds two Microsoft sign-ins. The existing Azure app is reused. There is no new app, no client secret, and no Vercel change.

Do not add `disposalsolutions@outlook.com` to `VITE_ALLOWED_EMAILS` or `ALLOWED_EMAILS`.

Do this once on the PC, then once on the phone. Each browser remembers the sign-in on its own.

1. Open `https://wrights-lc.vercel.app`.
2. If Microsoft shows **Pick an account**, click `chadtrost@hotmail.com`. If that address is missing, click **Use another account**, type `chadtrost@hotmail.com`, and sign in. Confirm the app opens and does not say Access denied.
3. Open an estimate or invoice and start an email. Confirm the form says **From:** `disposalsolutions@outlook.com`.
4. Fill in To, then click **Send Email**.
5. Microsoft shows **Pick an account** again. Click `disposalsolutions@outlook.com`. If it is missing, click **Use another account**, type `disposalsolutions@outlook.com`, and enter that mailbox’s password.
6. Microsoft shows **Permissions requested**. The list should include sending mail. Click **Accept**.
7. The app comes back. Click **Send Email** again. Confirm the alert says the email was sent from `disposalsolutions@outlook.com`.
8. In a browser, open [https://outlook.live.com](https://outlook.live.com) and sign in as `disposalsolutions@outlook.com`. Open **Sent Items**. Confirm the message is there and the customer sees that From address.
9. Save a new estimate. Confirm the file appears in Chad’s OneDrive at `Desktop/Business/Disposal Solutions/Estimates`, not in the business mailbox’s OneDrive.

Later sends on that same browser skip steps 5 and 6.

### Only if Accept is missing or Microsoft says the app cannot send mail

Skip this when step 6 already shows Send mail and Accept works. Do not create a new registration and do not add a secret.

1. Open [https://portal.azure.com](https://portal.azure.com).
2. In the search box at the top, type `App registrations` and open it.
3. Open the existing quoting app. Match **Application (client) ID** to `VITE_AZURE_CLIENT_ID`. Do not click **New registration**.
4. Left menu, **Authentication**. Under **Supported account types**, select **Accounts in any organizational directory and personal Microsoft accounts** if it is not already selected. Click **Save** only if you changed it. Confirm the sentence on that page includes personal Microsoft accounts.
5. Left menu, **API permissions**. If `Mail.Send` is already in the table as Microsoft Graph / Delegated, stop. If it is missing, click **Add a permission**, then **Microsoft Graph**, then **Delegated permissions**, search `Mail.Send`, check `Mail.Send`, and click **Add permissions**. Do not click **Grant admin consent**.
6. Leave **Certificates & secrets** alone.

No redeploy is required after that. Repeat the send steps above.

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
