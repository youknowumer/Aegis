# v17: a new landing page made of 66,000 dots

## What changed
- **`index.html`** is a new single full-screen scene. A dark room holds a head-and-shoulders bust drawn from about **66,000 glowing dots** (three.js 0.170). The face is smooth and featureless; the likeness lives in the silhouette, the hair, a leaf sprig and a wraparound visor.
- **Loader:** a ring of 96 dots whose number is the real download of the 3D model (about 1.48 MB). At 100 every dot arcs from the ring into place, then one band of light sweeps down the bust once.
- **Interaction:** the cursor is a small light, the head turns toward it, a sage glint crosses the visor and leaves every 4.2 s, dust drifts upward and a film grain sits over everything. Touch screens are supported; with no pointer the light orbits by itself.
- **Real product data, redefined:** the details sheet ("What it does") now states the counts from the code: **118 tools** (59 server, 59 PC), **26 always ask** (4 more when a call looks risky), plans **15 / 150 / 1,000** messages a day, **31** local voice languages. The old page said 65 tools and 18 approvals.
- **"What it does" sheet:** flow strip (Ask, Plan, Approve, Done), six capability cards with examples, control lists, plans, installer details (version, size and date read from GitHub), install steps and FAQ.
- **Download:** the Windows button is on the page (`DOWNLOAD_URL` in `config.js`), with a friendly message if no installer is published yet.

## Files
- New: `landing-dots.css`, `landing-dots.js`, `landing-dots-ui.js`.
- Changed: `index.html`, `server/app/settings.py` (the three files are on the serve list), `server/app/main.py`, `server/tests/test_server.py`, `README.md`.
- The older landing files are no longer loaded. They stay in the project (an existing test still reads `landing.css` and `landing.js`) and can be deleted later.

## Server security
- `/` and `/index.html` get a wider Content-Security-Policy: scripts from `'self'` and `cdn.jsdelivr.net`, the model from CloudFront, fonts from `fonts.gstatic.com`. All other pages keep the strict policy.
- The inline import map is allowed by its SHA-256 hash, computed from `index.html` by `landing_importmap_hash()`, so editing the import map never needs a server change.

## Accessibility and motion
- `prefers-reduced-motion`: the bust is already assembled; no breathing, dust drift, shine or glint; the head stays still.
- The loader is a `progressbar`; the details sheet is a modal dialog that closes with Esc and returns focus. If the model cannot load, the counter says "Could not load" and the buttons and sheet still work.

## Tests
- `server/tests/test_server.py`: the landing assertions now check the new page, the landing CSP (and that `app.html` keeps the strict one) and the three new files. Server suite: 396 passed, 1 skipped.
- The dot builder was run in Node on a synthetic mesh: exactly 66,000 dots, no NaN values, about 0.8 s.
- Not tested here: the real 3D scene in a browser (no WebGL and no internet in the build environment), the real GLB and the CDN. Open `index.html` once and check that the dots assemble.
