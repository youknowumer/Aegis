# Security Policy

Aegis is proprietary software owned by Muhammad Umer Faheem (@youknowumer). See `LICENSE`.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.
Contact the owner privately through GitHub (https://github.com/youknowumer), or use
the repository's **Security > Report a vulnerability** form if it is enabled.
Include what you found, how to reproduce it, and the version (see `CHANGES-v*.md`).

## What the project already protects

Password hashing (scrypt), signed and revocable sessions, login throttling, CORS and
websocket origin allow-lists, security headers, SSRF guards, a sandboxed file area, and
human approval for risky actions. Details: README section 11.

## Keep your own copy safe

- Never commit API keys, `.env`, or `aegis.db`. Keys belong in server environment variables.
- Set `AEGIS_JWT_SECRET` and `AEGIS_ADMIN_TOKEN` to long random values.
