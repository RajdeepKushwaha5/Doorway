# Deploying Doorway

Three services. The API and the fixture go to Render from `render.yaml`; the
dashboard goes to Vercel. All three are on free plans.

The step that catches people out is the first one, so it is first.

---

## 0. Point the hosts at this repository

The services that were already running were connected to the repository this
work started in. They kept serving whatever was last pushed there, which was a
build old enough to predate the Doorway routes entirely, and nothing about a
healthy `/api/health` said otherwise.

If you see `404` on `/api/doorway/opportunities` against a service that reports
`{"status":"ok"}`, this is why.

**Render**: open each service, Settings, Build and Deploy, Repository, then
connect `RajdeepKushwaha5/Doorway` and set the branch to `main`.

**Vercel**: Project Settings, Git, then connect the same repository.

`autoDeploy` is now `true` in the blueprint, so once connected each push to
`main` deploys. Confirm the first one landed rather than assuming it did:

```bash
curl -s https://<your-api>.onrender.com/api/doorway/opportunities | head -c 200
```

A JSON body means the new build is live. `{"error":"not found"}` means it is not.

---

## 1. The API and the fixture, on Render

From the Render dashboard: New, Blueprint, select this repository. It reads
`render.yaml` and creates both services.

Everything marked `sync: false` has to be filled in by hand, because secrets do
not belong in the repository.

| Variable | Service | What it is |
|---|---|---|
| `NOTICE_ADMIN_TOKEN` | notice-api | Any long random string. Mutating routes are **disabled entirely** when this is unset, rather than defaulting to open. |
| `BRIGHTDATA_API_KEY` | notice-api | From the Bright Data dashboard. Used by both the witness and live discovery. |
| `BRIGHTDATA_UNLOCKER_ZONE` | notice-api | Your Web Unlocker zone name. Without it the witness falls back to the `bdata` CLI, which is not installed on Render, and the second sensor cannot run at all. |
| `NOTICE_CORS_ORIGIN` | notice-api | The Vercel origin, once step 2 has given you one. Leave it unset until then. |
| `DRIFTMART_ADMIN_TOKEN` | driftmart | Any long random string. Guards the fault switch, which has to be publicly reachable so Bright Data can fetch the pages. |

Generate the two tokens with something that is actually random:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DISCOVERY_COUNTRY` is already set to `in` in the blueprint. It decides where
searches appear to come from, which matters because funding pages are
frequently geo-fenced and search results differ by country. Change it if your
students are somewhere else.

---

## 2. The dashboard, on Vercel

New Project, this repository, and set **Root Directory** to `frontend`. Take
every other default.

Do not override the install command. Vercel detects the npm workspace root on
its own and installs from there; an override runs inside `frontend/` and scopes
the install to one workspace, which leaves the build unable to resolve
`tailwindcss`.

Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_NOTICE_API_BASE` | `https://<your-api>.onrender.com` |
| `NOTICE_API_BASE` | the same, unless you have an internal hostname |
| `NOTICE_ADMIN_TOKEN` | the same value you gave the API |
| `DRIFTMART_ADMIN_TOKEN` | the same value you gave the fixture |
| `DRIFTMART_URL` | `https://<your-fixture>.onrender.com` |
| `NEXT_PUBLIC_SITE_URL` | the Vercel origin |

The two admin tokens live only on the dashboard's **server**, never in the
browser. They are what let `/proof` operate the fault switch and run a
collector. Without them the page still renders and says plainly which controls
are disabled and why, rather than failing under a visitor's hand.

Then go back to Render and set `NOTICE_CORS_ORIGIN` to the Vercel origin.

---

## 3. Check it, rather than assume it

```bash
API=https://<your-api>.onrender.com
SITE=https://<your-site>.vercel.app

curl -s $API/api/health
curl -s $API/api/doorway/opportunities | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" $SITE/proof
```

Then open `$SITE` and press **Search the live web**. Lines should appear within
about twenty seconds. If nothing appears, the stream is the thing to check: it
is a cross-origin `EventSource`, so it needs `NOTICE_CORS_ORIGIN` to be right.

Open `$SITE/proof` and run the walkthrough end to end. That exercises the API,
the fixture, the admin tokens and the Bright Data credentials in one pass, which
is a better check than any of them individually.

---

## What free plans will do to you

**Services sleep after 15 minutes idle.** The first request afterwards takes
thirty seconds or more. Warm all three URLs before showing this to anyone.

**There is no persistent disk.** A redeploy resets the store, so verified
opportunities disappear and the world empties. Re-run the collectors afterwards,
or seed:

```bash
npm run doorway:seed
```

Live discovery is unaffected, since it holds nothing between requests.

The fix, when it matters, is Postgres behind the existing `Store` interface
rather than a paid disk. The interface is already the seam.

**Live discovery spends real money.** Roughly one Web Unlocker request per
search plus one per page opened, so a run costs about fifteen. The route is
public because a student cannot be handed a token and neither can a judge, and
it is capped per caller and by a global hourly ceiling in
`backend/src/acquire/budget.ts`. The ceiling is the limit that actually protects
the account: the per-caller one is defeated by rotating addresses. Raise it only
if you have budget you are willing to lose.
