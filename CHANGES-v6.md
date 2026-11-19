# v6: voices like Siri, a deeper orb, more instant commands

## Voice personalities (`voice.js`, new)
- 10 personas: Aria, Ethan (US), Olivia, Oliver (UK), Ruby, Noah (AU), Priya, Arjun (Indian English), Nova (fast, bright), Atlas (deep, slow).
  Plus **Auto**, **Siri-style** (appears automatically on Apple devices that have Siri voices) and **Pick manually**.
- A persona is a recipe (gender, accent, pitch, speed) matched to the voices installed on the device. Siri / Neural / Natural / Premium
  voices are preferred, novelty voices (Zarvox, Bells...) are never chosen, and English is never read with an Urdu/Hindi voice.
  If a device has no voice of the right gender, the closest one is used and its pitch is shifted so the persona still sounds different.
- Settings > Voice: persona cards with a Preview button, Pitch and Volume sliders (Speaking speed still works on top).
- Voice commands: "change voice to British male", "use Siri voice", "next voice", "speak faster / slower", "deeper voice",
  "louder / softer", "what voices do you have", "reset voice".

## Orb animation and depth (`orb.js`)
- Reacts to real speech: every spoken word sends a pulse (shockwave disc + brighter shell); voices that report no word events get a soft heartbeat.
- Depth: three-layer parallax starfield, comet tails on the ring beads, lit-sphere specular highlight, tilted 3D shockwaves.
- State-specific effects: listening = particles stream inward, thinking = neural arcs flash across the shell, speaking = energy bursts.
- New API: `orb.pulse(0..1)`, `orb.setLevel(0..1)`. Reduced-motion users still get a static frame.

## Interface motion (`style.css`)
- Messages arrive with a spring + blur-in, state-coloured halo behind the orb, decorative rings speed up while thinking,
  sidebar blocks cascade in, buttons lift / press, slow aurora drift. All disabled by "reduce motion".

## New instant commands (`commands.js`, work offline)
- `say <text>`, stopwatch (start / lap / stop / reset), `generate a password [20]` (crypto-random, auto-copied, never spoken),
  `days until Christmas / 25 December`, `copy that`.

## Tests
`node --test tests/commands.test.js` = 7 (new cases for voice, stopwatch, password, dates). Server and desktop untouched.

## Honest limits
- Browsers only expose the voices your system has. "Siri" voices appear on Apple devices only; on Windows you get Microsoft Natural voices,
  on Android Google voices. To add more, install voices in the system's speech settings. True studio-quality voices would need a
  cloud TTS service (ElevenLabs, Azure, OpenAI) behind your server: a good next step.
- Tested here in headless Chromium with simulated voices; try the Preview buttons once on your own device.

# v6.1: tabbed side rails + stronger animation

## Tabs (`tabs.js`, new)
- **Left rail:** Plan (tasks + reminders) | Focus (timer + scratchpad) | Memory.
  **Right rail:** Activity | Status (PC link, usage, device) | World (weather + shortcuts) | **Voice** (new quick voice studio).
- Panels are moved, not copied, so every existing handler keeps working. Nothing is hidden on short screens any more; each tab scrolls instead.
- Sliding glow indicator, live count badges (hidden at zero), badge "ping" when something lands in a hidden tab, ripple on click,
  direction-aware 3D slide + staggered entrance, light sweep down the rail, remembered tab per side.
- Keyboard: arrow keys / Home / End on tabs, **Alt+1..7** jumps to a tab. Voice: "show memory tab", "open the activity panel", "show voice tab".
- Voice tab: live equaliser that follows Aegis's state, persona chips, Speed / Pitch / Volume, Test voice.

## Stronger animation
- Rotating light ring around the message box (green listening, violet thinking, accent speaking).
- Rails glow in the state colour; orb label glitches in on every state change; orb floats; the orb pulses as you type and bursts on send.

Tests: `node --test tests/commands.test.js` = 7 (includes the tab commands).
