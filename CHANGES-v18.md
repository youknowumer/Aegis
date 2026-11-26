# v18: new landing hero (sage / editorial)

## Design
- New one-screen hero (`landing-halora.css`, `landing-halora.js`): sage wall `#CBCFB8`, a hand + ring video, copy on the left, three frosted glass
  cards on the right (Tools 65 / Approvals 18 / Free daily 15). All sizes use the 2048x1152 artboard scale `--s`, floor 0.55px, no drop shadows.
- New header: logo, 4 links, Sign in (moss glass pill), Start free (dark pill), theme switch. Below 820px it folds into a frosted menu behind a round burger.
- Entrance: one Web Animations timeline (backwards fill) that starts after fonts/photo are ready and then cancels itself.
- Video: two stacked copies dissolve into each other during the last second, so the loop never jumps; 0.8s fade-in on first frame.
- Reduced motion: no entrance, no transitions, no video.
- Tablet landscape (<1200px): copy | hand | cards grid. Portrait: copy, cards row, hand.
- Light (sage) is now the default theme; a saved choice still wins.
- Fonts: Outfit (numerals) added in `fonts/`. Optional still photo: `assets/halora/hero.jpg` (see README there).

## Bugs fixed
- Server CSP had no `media-src`, so the hero video was blocked when served by the Aegis server. Added the CDN host.
- The Aegis server only served `icons/`; `fonts/` and `assets/` returned 404 (Inter Tight never loaded, icons fell back to CDN). Routes added (type-whitelisted, no path escape).
- `landing-motion.js`: the hero-only block ended the whole module early, which also skipped the reveal stagger and eyebrow underlines. Split.
- Hero sticker icons depended on the old hero's DOM; they now load themselves (local file, CDN fallback).
- No mobile menu existed below 760px (links were just hidden): burger menu added.
- `landing-pro.css` padded every `<section>`; the hero resets it.
- Edge blur bands no longer smear the picture while the hero is on screen.
- New test `test_landing_hero_assets_are_served`; suite: 408 passed.

## v18.1: colour + iOS-smooth motion (`landing-ios.css`, `landing-ios.js`)
- One palette for the whole page (sage / forest / olive gold / clay) instead of neon cyan-violet-pink; dark theme is now forest night.
- Hero: sheen on the headline's second line, breathing dot, faint sun grade over the picture, saturated glass cards that catch light.
- Spring motion: UIKit-style easing everywhere, depth parallax on pointer, hero recedes on scroll (one frame-rate-independent spring loop),
  magnetic buttons, numerals count up after the entrance.
- Inertial wheel scrolling for mouse wheels (touch, trackpads, keyboard, anchors, nested scrollers, reduced motion are left alone).
- Reveals on the rest of the page use the same curve with longer, softer blur-to-sharp.
- Scroll soft focus: items blur up to 14px, fade, shrink and drift as they enter/leave (eased, wider zones than before).
