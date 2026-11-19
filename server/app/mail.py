"""Email for the assistant: send through SMTP and read the inbox over IMAP (read-only).

Configured by the server owner with environment variables (never by the AI, never stored in the database):

  AEGIS_SMTP_HOST      e.g. smtp.gmail.com
  AEGIS_SMTP_PORT      587 (STARTTLS, default) or 465 (SSL)
  AEGIS_SMTP_USER      login, usually the full address
  AEGIS_SMTP_PASSWORD  for Gmail / Outlook use an *app password*, not the real account password
  AEGIS_MAIL_FROM      optional, defaults to AEGIS_SMTP_USER
  AEGIS_IMAP_HOST      e.g. imap.gmail.com (enables inbox reading; same user/password unless overridden)
  AEGIS_IMAP_USER / AEGIS_IMAP_PASSWORD   optional overrides
  AEGIS_EMAIL_DAILY_LIMIT   emails per user per day, default 20

Safety rules enforced here, not only in the prompt:
  - header injection is impossible (newlines are rejected in every header field),
  - at most 10 recipients, bodies capped at 20 000 characters,
  - the inbox is opened read-only, so reading mail never marks it as seen or deletes anything.
"""
import email
import imaplib
import os
import re
import smtplib
import ssl
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

ADDR_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
MAX_RECIPIENTS = 10
MAX_BODY = 20_000


class MailError(Exception):
    """A problem the user can understand and act on. Never contains a password."""


def _env(name, default=""):
    return os.environ.get(name, default).strip()


def smtp_configured() -> bool:
    return bool(_env("AEGIS_SMTP_HOST") and _env("AEGIS_SMTP_USER") and _env("AEGIS_SMTP_PASSWORD"))


def imap_configured() -> bool:
    return bool(_env("AEGIS_IMAP_HOST") and (_env("AEGIS_IMAP_USER") or _env("AEGIS_SMTP_USER")) and (_env("AEGIS_IMAP_PASSWORD") or _env("AEGIS_SMTP_PASSWORD")))


def daily_limit() -> int:
    try:
        return max(1, int(_env("AEGIS_EMAIL_DAILY_LIMIT", "20")))
    except ValueError:
        return 20


def _clean_header(value: str, field: str, limit: int = 200) -> str:
    value = str(value or "").strip()
    if re.search(r"[\r\n\x00]", value):
        raise MailError(f"The {field} contains a line break, which is not allowed.")
    if len(value) > limit:
        raise MailError(f"The {field} is too long.")
    return value


def parse_recipients(raw, field="recipient") -> list:
    """Accept 'a@x.com', 'a@x.com, b@y.com' or a list. Returns validated bare addresses."""
    if isinstance(raw, str):
        parts = re.split(r"[;,]", raw)
    elif isinstance(raw, (list, tuple)):
        parts = [str(p) for p in raw]
    else:
        parts = []
    out = []
    for p in parts:
        p = _clean_header(p, field)
        if not p:
            continue
        addr = parseaddr(p)[1] or p
        if not ADDR_RE.match(addr):
            raise MailError(f"'{p}' is not a valid email address.")
        if addr.lower() not in [a.lower() for a in out]:
            out.append(addr)
    if len(out) > MAX_RECIPIENTS:
        raise MailError(f"At most {MAX_RECIPIENTS} recipients per email.")
    return out


def build_message(to, subject, body, cc=None, reply_to=None) -> EmailMessage:
    to_l = parse_recipients(to, "to address")
    cc_l = parse_recipients(cc or [], "cc address")
    if not to_l:
        raise MailError("Who should this email go to? Give at least one address.")
    subject = _clean_header(subject, "subject", 250)
    if not subject:
        raise MailError("The email needs a subject.")
    body = str(body or "").strip()
    if not body:
        raise MailError("The email body is empty.")
    if len(body) > MAX_BODY:
        raise MailError("The email body is too long.")
    sender = _clean_header(_env("AEGIS_MAIL_FROM") or _env("AEGIS_SMTP_USER"), "from address")
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to_l)
    if cc_l:
        msg["Cc"] = ", ".join(cc_l)
    if reply_to:
        msg["Reply-To"] = parse_recipients(reply_to, "reply-to address")[0]
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)
    return msg


def send_email(to, subject, body, cc=None) -> str:
    """Send one plain-text email. Blocking: call it from a worker thread."""
    if not smtp_configured():
        raise MailError("Email sending is not set up on this server (AEGIS_SMTP_HOST / USER / PASSWORD are missing).")
    msg = build_message(to, subject, body, cc)
    recipients = parse_recipients(to, "to address") + parse_recipients(cc or [], "cc address")
    host, port = _env("AEGIS_SMTP_HOST"), int(_env("AEGIS_SMTP_PORT", "587") or 587)
    try:
        ctx = ssl.create_default_context()
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=20, context=ctx)
        else:
            server = smtplib.SMTP(host, port, timeout=20)
            server.starttls(context=ctx)
        try:
            server.login(_env("AEGIS_SMTP_USER"), _env("AEGIS_SMTP_PASSWORD"))
            server.send_message(msg, to_addrs=recipients)
        finally:
            try:
                server.quit()
            except Exception:
                pass
    except smtplib.SMTPAuthenticationError:
        raise MailError("The mail server rejected the login. For Gmail or Outlook use an app password.")
    except smtplib.SMTPRecipientsRefused:
        raise MailError("The mail server refused that recipient address.")
    except (smtplib.SMTPException, OSError):
        raise MailError("Could not reach the mail server right now.")
    return f"Email sent to {', '.join(recipients)} with subject: {msg['Subject']}"


def _decode(value) -> str:
    try:
        return str(make_header(decode_header(value or ""))).strip()
    except Exception:
        return str(value or "").strip()


def _plain_body(msg) -> str:
    """First text/plain part, or the text of the first html part with tags removed."""
    html = ""
    for part in msg.walk():
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        ctype = part.get_content_type()
        try:
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            continue
        if ctype == "text/plain" and text.strip():
            return text.strip()
        if ctype == "text/html" and not html:
            html = text
    if html:
        from .utilities import html_to_text

        return html_to_text(html)[1]
    return ""


def check_inbox(limit=5, unread_only=True, query="") -> str:
    """Summarise recent messages: sender, subject, date and the first lines. Read-only. Blocking."""
    if not imap_configured():
        raise MailError("Inbox reading is not set up on this server (AEGIS_IMAP_HOST is missing).")
    limit = max(1, min(int(limit or 5), 10))
    user = _env("AEGIS_IMAP_USER") or _env("AEGIS_SMTP_USER")
    pw = _env("AEGIS_IMAP_PASSWORD") or _env("AEGIS_SMTP_PASSWORD")
    crit = ["UNSEEN"] if unread_only else ["ALL"]
    query = str(query or "").strip()
    if query:
        if re.search(r"[\r\n\"\\]", query) or len(query) > 80:
            raise MailError("That search text is not allowed.")
        crit = crit + ["TEXT", f'"{query}"']
    try:
        box = imaplib.IMAP4_SSL(_env("AEGIS_IMAP_HOST"), timeout=20)
        try:
            box.login(user, pw)
            box.select("INBOX", readonly=True)  # readonly: reading never marks mail as seen
            typ, data = box.search(None, *crit)
            ids = (data[0].split() if typ == "OK" and data and data[0] else [])[-limit:][::-1]
            if not ids:
                return "No unread messages." if unread_only and not query else "No matching messages."
            blocks = []
            for mid in ids:
                typ, parts = box.fetch(mid, "(BODY.PEEK[])")
                if typ != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                msg = email.message_from_bytes(parts[0][1])
                body = re.sub(r"\s+", " ", _plain_body(msg))[:400]
                blocks.append(f"From: {_decode(msg.get('From'))}\nSubject: {_decode(msg.get('Subject'))}\nDate: {msg.get('Date', '')}\n{body}")
        finally:
            try:
                box.logout()
            except Exception:
                pass
    except imaplib.IMAP4.error:
        raise MailError("The mail server rejected the login. For Gmail or Outlook use an app password.")
    except OSError:
        raise MailError("Could not reach the mail server right now.")
    return "\n\n---\n\n".join(blocks) or "No matching messages."
