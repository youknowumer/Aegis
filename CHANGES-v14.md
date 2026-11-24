# v14: landing motion, smooth navigation, detailed sign-up, new icons

## Landing page
- **Hero intro**: panel wipe, then headline, buttons, caption, stats and sprout cascade in.
- **Hero life**: pointer parallax (background, icon, word), spotlight, drifting sparks, scroll recede, magnetic buttons with sheen.
- **Smooth navigation**: eased anchor scrolling with a live target, sliding nav underline (scrollspy), right-hand section rail, smart header, reading-progress bar and ring on the back-to-top button.
- **Detailing**: staggered card entrances, 3D card tilt, heading and eyebrow underline draws, floating stickers, animated FAQ with one answer open at a time, footer columns rise on scroll, page fade when opening the app and prefetch on hover.
- **Accessibility and performance**: everything respects `prefers-reduced-motion`; touch devices skip pointer effects; canvases pause off-screen; one throttled scroll handler. 61 fps in a full-page scroll test.
- New files: `landing-motion.css`, `landing-motion.js`.

## Sign-up form
- Four-step progress checklist, confirm-password field with live match, terms checkbox, email typo suggestion, password suggester (crypto-random passphrase, copy to clipboard), guess-time estimate, success burst, cascading fields, rotating card border light.
- Server API unchanged.
- Files: `app.html`, `app.js`, `auth-fx.js`, `app-fx.css`.

## Favicon and icons
- New bold gradient shield filling about 80% of the tile. `favicon.svg`, `favicon.ico` (6 sizes), PNGs 16/32/48/192/512, maskable 512, Apple touch 180, `site.webmanifest`. Both pages link the set.

## Feelings and memory
- 6 new moods (guilty, jealous, hopeless, calm, surprised, determined), mixed-feeling detection, hopeless always heavy (intensity 4+), trailing "..." or sighs read one level stronger. `note_mood` accepts the new moods.
- More auto-memory: pets, allergies, health conditions, fears, favourites, job title, age, life events.
- One value per slot (name, city, workplace, study, birthday, age, singular relations, favourites): new replaces old, applied on save and during housekeeping.
- Fix: housekeeping no longer merges two different people ("Their sister is Ayesha" / "...Sana") into one memory.
- Recall understands synonyms (mom/mother/ammi, bday/birthday, job/work); memories that are important or used often are flagged to the AI.
- Files: `server/app/emotion.py`, `heart.py`, `agent.py`, `tools.py`; new tests `server/tests/test_v14.py`. Server suite: 319 passed.

## Server and deployment
- `settings.py` `WEB_FILES` now also lists the `landing-vela*` files, `landing-motion.*`, `favicon.*` and `site.webmanifest`; before, the Docker / server-hosted site was missing the vela hero files.
- `main.py` serves `/icons/<name>`.
- `Dockerfile` copies the icon files.

## Tests
- `node --test tests/*.test.js`: 54 tests, 43 pass, 0 fail, 11 skipped (need jsdom).
