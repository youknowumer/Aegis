#!/bin/sh
# Downloads the four hero icons into assets/vela/ so the landing page is fully self-hosted. Run from the repo root.
set -e
B=https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P
mkdir -p assets/vela
curl -fL "$B/83de7c35-dd91-4e56-bfb8-0ffafc83d0e0.webp" -o assets/vela/message.webp
curl -fL "$B/4d952211-0474-48cc-af48-58f68b3b7525.webp" -o assets/vela/browse.webp
curl -fL "$B/e2e91fca-5b3f-4e0e-a437-8a581592e407.webp" -o assets/vela/transact.webp
curl -fL "$B/6b32bb47-4ad6-4938-a637-c997b373c68b.webp" -o assets/vela/web.webp
echo "done"
