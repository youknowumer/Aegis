# Learning, voice browser control and instant reminders (v19)

## What learns, and how

| Layer | What it does | Takes effect |
|---|---|---|
| **Lessons** | Standing rules you say in passing ("from now on keep answers short", "stop calling me sir", "urdu mein jawab do", "never use emojis") or tell the AI with `teach`. Shown to the AI on every turn. Same topic (length, tone, language, address, format) replaces the older rule. | Immediately |
| **Feedback** | 👍 / 👎 under every reply. Stored with the reply. | Immediately (style) and in the training data |
| **Habits** | Read from your history: how long you write, whether you like short or long replies (from your thumbs), voice vs typing, tools you use most. Needs 8+ chats. | Immediately |
| **Memory** (v10 to v14) | People, dates, plans, feelings. Unchanged. | Immediately |
| **Training data** | Every chat is logged (secrets removed) and can be exported as JSONL for a real fine-tune. | When you train |

**Honest limit:** the model's weights do not change while you chat. Aegis adapts at once through lessons, memory and style hints, and gives you clean data to fine-tune a model of your own later.

## Your controls
Settings > *What Aegis has learned*: switch learning off, delete any rule, add one, download data, clear the log.
Server owner: `AEGIS_LEARNING=0` turns it off for everyone; `AEGIS_KEEP_INTERACTIONS=3000` caps the log per user.
Passwords, emails, phone and card numbers, and API keys are removed before storing and again before export. Thumbs-down replies and instant commands are never exported as training examples.

## Training your own model
```
python server/scripts/train_export.py you@example.com --fmt openai --out train.jsonl      # chat format
python server/scripts/train_export.py you@example.com --fmt kto --out thumbs.jsonl        # needs 👍/👎
```
* **Hosted fine-tune** (OpenAI, Together, Fireworks, Mistral): upload the `openai` file. Aim for 200+ good examples.
* **Local LoRA** (Unsloth / Axolotl on a GPU): use the `openai` or `alpaca` file; `kto` trains from thumbs.
* **Instant personal model, no training:** `Settings > Ollama Modelfile`, then `ollama create aegis-me -f Modelfile`. It bakes your rules into the system prompt of a local model.

## Instant commands (no AI, no daily quota, work without an AI key)

**Reminders** (English and Roman Urdu): "remind me in 20 minutes to call Ali", "remind me tomorrow at 9 to submit the report", "remind me every weekday at 8am to take medicine", "mujhe 20 minute baad yaad dilana ki chai peeni hai", "kal subah 9 baje yaad dilana ki meeting hai", "snooze 10 minutes", "what are my reminders", "cancel reminder about Ali". If no time is found, the AI asks.

**Browser by voice** (needs the Aegis Web Hands extension or the desktop app; it acts on your real browser):

| Say | Does |
|---|---|
| next tab, previous tab, switch to tab 2, go to the gmail tab, close this tab, new tab, list my tabs | tabs |
| search for cats on youtube, google quantum computing, play X on youtube | search / play |
| search X and open the first result, open the second result, read the results | results |
| open youtube in a new tab, go to github | navigate |
| scroll down (a lot), scroll to the bottom, go back, reload | page |
| show numbers, click 4, click sign in, type hello into the search box and press enter, press enter | click / type |
| find pricing on the page, read this page, take a screenshot | read |
| pause, play, mute, volume up, skip ahead 10 seconds, speed 1.5, next video | media (`chrome_media`) |

Roman Urdu works for the common ones (agla tab, tab band karo, neeche scroll karo). **Browser mode:** while a browser is linked, "scroll down" and "click ..." act on your other tab; say "control this page" to act on Aegis itself, "control my browser" to switch back. Clicks that could buy, send, post or delete are never done instantly: Aegis asks you first through the AI. Passwords are never typed. Several steps in one sentence ("click next then buy") go to the AI.

**Voice shortcuts** (this device): "when I say work mode, open github" then just say "work mode". "what shortcuts do I have", "forget shortcut work mode".
