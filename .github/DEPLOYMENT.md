# Automated Worker deploys

Every push to `main` that touches `worker/**` runs `.github/workflows/deploy-worker.yml`,
which bundles the Worker with esbuild and uploads it to Cloudflare via the REST API,
then hits the live `/version` and `/corpus` endpoints to smoke-test the deploy.

## One-time setup

The workflow needs one GitHub Actions secret set on this repo:

- **`CLOUDFLARE_API_TOKEN`** — a Cloudflare API token with the following
  permissions:
    - Account · Workers Scripts · Edit
    - Account · Workers Routes · Edit
    - Zone · Zone · Read (on specimenregistry.org)

Add it at:
`https://github.com/mpgonzalez271/specimen-registry/settings/secrets/actions/new`

The account ID (`dd63b051b79cc09c7faa9232d1be3003`) and Worker name (`sar-v0`)
are set as workflow-level env vars — they're not secret.

## Manual override

Trigger a deploy without a push:
`https://github.com/mpgonzalez271/specimen-registry/actions/workflows/deploy-worker.yml`
→ **Run workflow**.

## Local bundle

```
cd worker
npm install
npm run bundle
```

Produces `worker/dist/index.js`.

## Rolling back

Cloudflare keeps Worker version history. Roll back at:
`https://dash.cloudflare.com/dd63b051b79cc09c7faa9232d1be3003/workers/services/view/sar-v0`
→ **Deployments** tab → click a prior version → **Rollback**.

The workflow doesn't tag its own deploys yet — that's a future improvement.
