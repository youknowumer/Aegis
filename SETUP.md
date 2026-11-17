# Aegis: setup in 10 minutes

Aegis has two parts. The **website** (Cloudflare Pages / GitHub Pages) is only the screen. The **server** (Render) is the
brain: login, memory and the AI. The website talks to the server, so you need both.

## 1. Get the AI key (this is "the API")
1. Go to **console.anthropic.com**, sign in, open **API keys**, press **Create key**, copy it (`sk-ant-...`).
2. Add billing credit in the console (the API is pay-as-you-go, separate from a Claude chat subscription).
3. **Never** paste this key into the website, `config.js` or GitHub. It only goes into the server (step 2).

## 2. Deploy the server on Render
1. render.com -> **New -> Blueprint** -> pick your GitHub repo (`render.yaml` is already in it).
2. When asked, paste the key as `ANTHROPIC_API_KEY`.
3. Set `AEGIS_ALLOWED_ORIGINS` to your website address(es), comma separated, no trailing slash, for example
   `https://your-project.pages.dev,https://*.pages.dev`
4. Open `https://YOUR-SERVICE.onrender.com/healthz`. It must show `{"ok":true}`.

## 3. Connect the website to the server (no code editing)
Open the website, press **Connect AI** (top right), paste the Render address, **Save & connect**. Create your account again
(local-mode accounts live only in your browser). Done: chat, memory, web voice and weather now run through the server.

Optional: to make it permanent for every visitor, put the same address in `config.js` (`API_BASE`) and push to git.

## 4. Windows PC control (optional)
`cd desktop && npm install && npm run dist`, install `Aegis-Setup.exe`, sign in once. See README.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Can't reach that server" | Free Render sleeps; wait 30 s and retry. Check `/healthz`. |
| "This website is not allowed to use that server" | `AEGIS_ALLOWED_ORIGINS` is missing your website address. |
| Login works but AI says error | Key missing/wrong, or no credit on the Anthropic account. |
| Accounts vanish after a restart | Free Render has no disk. Use a paid instance with the disk in `render.yaml`. |
