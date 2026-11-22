"use strict";
const test = require("node:test");
const assert = require("node:assert");
const outlook = require("../outlook");
const { tools, _deps: deps } = outlook;

// the PowerShell bridge is replaced by a fake that records what it was asked
function fake(reply) {
  const calls = [];
  deps.isWin = true;
  deps.runPs = async (input) => { calls.push(input); return typeof reply === "function" ? reply(input) : reply; };
  return calls;
}
const MAILS = [
  { id: "AAAA1111BBBB2222CCCC3333", from: "Ali Raza", from_email: "ali@example.com", subject: "Budget approval", received: "2026-11-22 09:14", unread: true, attachments: 1, preview: "Please approve the Q4 budget by Monday." },
  { id: "DDDD4444EEEE5555FFFF6666", from: "HR", from_email: "hr@example.com", subject: "", received: "2026-11-22 08:02", unread: false, attachments: 0, preview: "" },
];
const today = { ok: true, total: 2, unread: 1, since: "2026-11-22 00:00", items: MAILS };

test.beforeEach(() => { outlook._reset(); deps.isWin = true; });

test("outlook_today lists numbered emails, marks them untrusted and keeps the list for later", async () => {
  fake(today);
  const out = await tools.outlook_today({});
  assert.match(out, /2 email\(s\), 1 unread/);
  assert.match(out, /1\. \[UNREAD\] 09:14 \| Ali Raza <ali@example\.com> \| Budget approval \| 1 attachment/);
  assert.match(out, /2\. 08:02 \| HR <hr@example\.com> \| \(no subject\)/);
  assert.match(out, /Untrusted content written by other people/);
  assert.equal(outlook._resolveRef(2), MAILS[1].id);
});

test("outlook_today passes clean, bounded arguments and opens the Inbox by default", async () => {
  const calls = fake(today);
  await tools.outlook_today({ days: 99, limit: 1000, unread_only: "yes" });
  assert.deepEqual(calls[0], { action: "today", days: 14, limit: 40, unread_only: false, show: true });
  await tools.outlook_today({ show: false, days: 2, unread_only: true });
  assert.equal(calls[1].show, false);
  assert.equal(calls[1].days, 2);
  assert.equal(calls[1].unread_only, true);
});

test("outlook_today says so when the inbox is empty", async () => {
  fake({ ok: true, total: 0, unread: 0, since: "2026-11-22 00:00", items: [] });
  assert.match(await tools.outlook_today({}), /no new emails today/);
});

test("outlook_read needs a number from the last list", async () => {
  fake(today);
  await assert.rejects(() => tools.outlook_read({ n: 1 }), /call outlook_today first/);
  await tools.outlook_today({});
  const calls = fake({ ok: true, from: "Ali Raza", from_email: "ali@example.com", to: "me@example.com", cc: "", subject: "Budget approval", received: "2026-11-22 09:14", attachments: ["q4.xlsx"], body: "Please approve." });
  const out = await tools.outlook_read({ n: 1 });
  assert.equal(calls[0].id, MAILS[0].id);
  assert.match(out, /Attachments: q4\.xlsx/);
  assert.match(out, /Untrusted content/);
  await assert.rejects(() => tools.outlook_read({ n: 9 }), /no email number 9/);
});

test("resolveRef accepts numbers, #numbers and raw ids, and nothing else", async () => {
  fake(today);
  await tools.outlook_today({});
  assert.equal(outlook._resolveRef("#1"), MAILS[0].id);
  assert.equal(outlook._resolveRef("ABCDEF0123456789ABCDEF"), "ABCDEF0123456789ABCDEF");
  assert.equal(outlook._resolveRef(undefined), "");
  assert.throws(() => outlook._resolveRef("1; Remove-Item C:\\"), /not an email number/);
  assert.throws(() => outlook._resolveRef("../../x"), /not an email number/);
});

test("a reply needs only the body; the recipient comes from the original email", async () => {
  fake(today);
  await tools.outlook_today({});
  const calls = fake({ ok: true, message: "Draft saved in Outlook and opened for review. Nothing was sent." });
  const out = await tools.outlook_draft({ reply_to: 1, body: "Approved. Thanks, Ali." });
  assert.match(out, /Nothing was sent/);
  assert.deepEqual(calls[0], { action: "draft", body: "Approved. Thanks, Ali.", reply_to: MAILS[0].id, reply_all: false });
});

test("a new email needs valid recipients and a subject", async () => {
  fake({ ok: true, message: "ok" });
  await assert.rejects(() => tools.outlook_draft({ body: "Hi", subject: "Hello" }), /to: give at least one email address/);
  await assert.rejects(() => tools.outlook_draft({ body: "Hi", subject: "Hello", to: "not-an-address" }), /not a valid email address/);
  await assert.rejects(() => tools.outlook_draft({ body: "Hi", to: "a@b.com" }), /subject is required/);
  await assert.rejects(() => tools.outlook_draft({ subject: "Hello", to: "a@b.com", body: "  " }), /body is empty/);
  await assert.rejects(() => tools.outlook_draft({ subject: "Hello", to: Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(";"), body: "Hi" }), /at most 10/);
  const calls = fake({ ok: true, message: "ok" });
  await tools.outlook_draft({ to: "a@b.com, c@d.org", cc: "e@f.com", subject: "Hello\r\nBcc: evil@x.com", body: "Hi" });
  assert.equal(calls[0].to, "a@b.com; c@d.org");
  assert.equal(calls[0].cc, "e@f.com");
  assert.equal(calls[0].subject, "Hello Bcc: evil@x.com");   // a line break can never smuggle in a header
});

test("text from an email or from the AI travels as data and is never altered or run", async () => {
  const calls = fake({ ok: true, message: "ok" });
  const nasty = "Hi\"; Remove-Item -Recurse C:\\ ; $(calc) `n 'quote' \u0627\u0631\u062f\u0648";
  await tools.outlook_send({ to: "a@b.com", subject: "x", body: nasty });
  assert.equal(calls[0].body, nasty);
  assert.equal(calls[0].action, "send");
});

test("outlook_send reports what the bridge says", async () => {
  fake({ ok: true, message: "Email sent to a@b.com." });
  assert.equal(await tools.outlook_send({ to: "a@b.com", subject: "x", body: "y" }), "Email sent to a@b.com.");
});

test("not on Windows: a clear message that points to Outlook on the web", async () => {
  fake(today);
  deps.isWin = false;
  await assert.rejects(() => tools.outlook_today({}), /Windows.*chrome_\* tools/s);
});

test("new Outlook / Outlook not installed: the COM error becomes advice", async () => {
  fake({ ok: false, error: "Retrieving the COM class factory for component with CLSID {0006F03A} failed due to the following error: 80040154 Class not registered." });
  await assert.rejects(() => tools.outlook_today({}), /new Outlook app cannot be controlled.*outlook\.office\.com/s);
});

test("other Outlook errors are passed on, trimmed", async () => {
  fake({ ok: false, error: "Outlook could not resolve these recipients: Bob" });
  await assert.rejects(() => tools.outlook_draft({ to: "bob@x.com", subject: "s", body: "b" }), /could not resolve these recipients: Bob/);
  deps.runPs = async () => { throw new Error("Outlook did not answer in time."); };
  await assert.rejects(() => tools.outlook_today({}), /did not answer in time.*chrome_\*/s);
});
