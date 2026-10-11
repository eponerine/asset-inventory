# asset-inventory
Quick and dirty demo of how to glom data from Intune, Azure, GCP, AWS, Linode, etc into a single-pane-of-glass.

## Run

```powershell
npm install
npm run dev      # http://localhost:5173
```

All data is simulated locally (seeded generator in `src/data/generate.ts`, ~53k assets by default). Connector config lives in browser localStorage; secrets are never persisted.
