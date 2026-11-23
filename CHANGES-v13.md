# v13: a deeper heart (stronger feelings, memory that behaves like a person's)

## Feelings, on a scale of 5
- **Intensity is now 1 to 5** (was 1 to 3), read from the words, emoji, CAPITALS, "!!!" and stretched words ("sooooo"). At 4 or 5 Aegis is told to slow down,
  give the feeling room, keep the reply short and human and not rush to fix; for big happy feelings it matches the energy.
- **11 new feelings**, in English, Roman Urdu, Urdu, Hindi and Arabic: grief, disappointed, overwhelmed, embarrassed, confused, bored, hopeful, relieved,
  loving (and emoji such as 😭 😡 🥰 are understood). Each has its own way of answering. "I passed away" style mix-ups are handled ("passed my exam" is pride, "passed away" is grief).
- **The voice feels it too**: the studio voice moves further from neutral (speed, pitch, volume, expressiveness) the stronger the feeling.
- **Emotional arc**: a heavy few days in a row makes Aegis extra gentle and gently present; a bright streak is enjoyed and named once; lifting or sinking compared
  with last week shapes the tone. Never a diagnosis.
- **Missing you**: after 3+ days away Aegis says it missed you (stronger after 2 weeks) and asks how you have been.

## Memory
- **Remembers on its own** (`AEGIS_AUTO_MEMORY=0` to switch off): your name, people ("my sister is Ayesha", "mere dost ka naam Ali hai"), birthdays and anniversaries,
  where you live / work / study, likes and dislikes, goals, upcoming events ("I have an interview tomorrow", "mera exam kal hai"), someone unwell, a loss.
  Questions and chit-chat are ignored. Everything is visible in the Memory panel and can be forgotten with the x; hover shows when it was learned and how you felt.
- **Memories carry the feeling**: what you felt when you shared it. Strongly felt moments stay vivid and fade far more slowly.
- **Better recall**: ranking by relevance (tolerant of spelling like behen/behan), importance, how strongly it was felt, recency (important things fade 5x slower)
  and how often it mattered. Each memory is shown to the AI with "3 days ago, they felt anxious very strongly".
- **Follow-ups**: on the welcome line Aegis brings up something recent you told it ("I have been thinking about ... How is that going?").
- **Birthdays and anniversaries**: a heads-up the day before and on the day.
- **Scales**: near-duplicates are merged and the least important, unused, old memories fade when you pass 400 (important or strongly felt ones never do).
  Runs with the regular housekeeping.
- New tools `who_is` (everything about one person) and `memory_timeline` ("what happened last month"). REST: `POST /api/memory`, `GET /api/bond`.

## The bond
- A **bond level from 1 to 5** (just met, getting to know each other, friends, close friends, trusted confidant) grows with conversations, days talked, feelings shared and
  things remembered. It sets how personal, playful and deep Aegis may be, and a small "we have grown closer" moment appears when you reach a new level.

## Tests
- Server: 307 pass (26 new in `tests/test_v13.py`). Front-end: `tests/v13-static.test.js`. Old databases are upgraded in place.
