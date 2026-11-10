# Redesign preview site (Render)

The UI redesign lives on the `redesign` branch. It is deployed as a **second
static site** on Render, built from that branch, that talks to the **existing
Staging API and its data**. The Staging site (`hlcentral-staging`) is not
touched.

Because both sites share one API and one database, the `redesign` branch
changes the frontend only: no schema, migration or API-contract changes there.

The site is created by hand in the dashboard; it is not in `render.yaml` (the
Blueprint syncs from `main` and must not grow a service for a temporary branch).

## Before you start

The Staging API must already have the `CORS_ORIGIN` change that accepts a
comma-separated list (branch `cors-multiple-origins`, merged into `staging` and
deployed). Without it, a second origin in `CORS_ORIGIN` breaks the Staging site
too.

## 1. Create the static site

Render dashboard → the **healthy-tasks** project → **staging** environment →
**New** → **Static Site**:

| Field             | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| Repository        | `zev-hl/healthy-tasks`                                                               |
| Branch            | `redesign`                                                                           |
| Name              | e.g. `hlcentral-redesign` (gives `https://hlcentral-redesign.onrender.com` if free)  |
| Root directory    | _(leave blank — the repo root)_                                                      |
| Build command     | `npm ci --include=dev && npm run build:shared && npm run build --workspace frontend` |
| Publish directory | `./frontend/dist`                                                                    |
| Auto-deploy       | On commit                                                                            |

**Environment variables** (all baked in at build time; copy the values from the
`hlcentral-staging` site's Environment page):

| Key                        | Value                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `VITE_API_URL`             | the Staging API, `https://hlcentral-api-staging.onrender.com`     |
| `VITE_GOOGLE_CLIENT_ID`    | same as `hlcentral-staging`'s (the Staging OAuth client)          |
| `VITE_QUEUE_DASHBOARD_URL` | same as `hlcentral-staging`'s (`…-api-staging…/bullmq`), optional |

After it is created, open the new site → **Redirects/Rewrites** → add:

| Source | Destination   | Action  |
| ------ | ------------- | ------- |
| `/*`   | `/index.html` | Rewrite |

(The SPA fallback, so `/tasks`, `/goals`, `/admin/...` work on refresh.)

## 2. Let the Staging API accept the new site

`hlcentral-api-staging` → **Environment** → `CORS_ORIGIN`, add the new origin
after a comma (exact origin: `https://`, no trailing slash):

```
https://hlcentral-staging.onrender.com,https://hlcentral-redesign.onrender.com
```

Save (the API restarts). Leave `FRONTEND_URL` as the Staging site: links in
emails (password reset, notifications) keep pointing there.

## 3. Attachments: the bucket's CORS rule

Files go straight between the browser and the Staging bucket (pre-signed URLs),
so the bucket's own CORS policy must name the new site too, or uploads and
downloads fail on the preview. Cloudflare R2 → the Staging bucket → **Settings**
→ **CORS policy** → add the new origin to `AllowedOrigins`, next to the Staging
site's.

## 4. Google sign-in

If company accounts sign in with Google on Staging: Google Cloud Console →
**APIs & Services** → **Credentials** → the **Staging** OAuth client →
**Authorized JavaScript origins** → add `https://hlcentral-redesign.onrender.com`
(your real address). Otherwise Google answers `origin_mismatch`. Changes can take
a few minutes. Password sign-in needs nothing extra.

## Checks

- [ ] The preview loads and signing in works (password, and Google if used).
- [ ] The browser console shows no CORS errors; pages stay signed in while used.
- [ ] Uploading and opening an attachment works.
- [ ] The Staging site still works as before.

## Removing it later

Delete the static site, take its origin back out of `CORS_ORIGIN`, the bucket's
CORS policy and the Google client's origins.
