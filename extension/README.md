# Aegis Web Hands (browser extension)

Lets Aegis use **your real browser, with your own sign-ins**, when you talk to it: open sites, read pages, click, type, scroll, switch tabs and play YouTube. It works in Chrome, Edge, Brave and other Chromium browsers, with or without the desktop app.

## Install (2 minutes)
1. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
2. Press **Load unpacked** and choose this `extension` folder.
3. In Aegis open **Settings, Browser control** and press **Copy connection code**.
4. Click the Aegis Web Hands icon in the toolbar, paste the code, press **Connect**. The badge shows **ON**.
5. Keep an Aegis tab (or the desktop app) open and say, for example: "Hey Aegis, open YouTube and play Kesariya", "read this page", "scroll down", "search biryani recipes on Google and open the first result".

## What it will and will not do
- Never types into password fields; you type those yourself.
- Anything that looks like buying, sending, posting, deleting or accepting asks for your approval first.
- Cannot touch browser pages (`chrome://`), the extension store or error pages; works on the top frame of normal sites.
- Key presses are synthetic: they reach the page, and Enter, Tab, Escape, Page Up/Down, Home/End do what you expect.
- Screenshots capture the visible part of the page and go to Downloads/Aegis.
- The connection code contains your login token: do not share it. Pressing Disconnect removes it from the extension. When Aegis asks you to log in again, copy a new code.

## For server owners
Set `AEGIS_EXTENSION_IDS=<extension id>` to accept only your extension. Without it, any extension that has a valid login token can connect.
