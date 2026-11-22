"use strict";
// Runs outlook.ps1 against a pretend Outlook (outlook-mock.ps1). Skipped when PowerShell is not installed.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");

const PS = ["pwsh", "powershell.exe"].find((c) => spawnSync(c, ["-NoProfile", "-Command", "1"], { stdio: "ignore" }).status === 0);
const SCRIPT = path.join(__dirname, "..", "outlook.ps1");
const HARNESS = path.join(__dirname, "outlook-mock.ps1");

function ask(input) {
  const r = spawnSync(PS, ["-NoProfile", "-NonInteractive", "-File", HARNESS, "-Script", SCRIPT], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" } });
  const [first, second] = r.stdout.replace(/^\uFEFF/, "").split(/\r?\n/);
  assert.ok(first, "no output. stderr: " + r.stderr);
  return { res: JSON.parse(first), seen: second ? [].concat(JSON.parse(second) || []) : [] };
}
const opts = { skip: !PS && "PowerShell is not installed" };

test("today: only today's mails, newest first, meeting items skipped, counts right", opts, () => {
  const { res, seen } = ask({ action: "today", days: 1, limit: 20, show: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items.map((m) => m.id), ["ID0001", "ID0002"]);
  assert.equal(res.total, 2);
  assert.equal(res.unread, 1);
  assert.equal(res.items[0].preview, "Please approve the Q4 budget by Monday.");
  assert.equal(res.items[0].from_email, "ali@example.com");
  assert.equal(res.items[0].attachments, 1);
  assert.ok(seen.some((s) => s.call === "DisplayInbox"), "the Inbox window should open");
  assert.ok(seen.some((s) => s.call === "Sort" && s.field === "[ReceivedTime]" && s.desc === true), "must ask Outlook for newest first");
});

test("today: days=2 reaches yesterday, unread_only filters, limit caps", opts, () => {
  assert.equal(ask({ action: "today", days: 2, limit: 20 }).res.items.length, 3);
  assert.deepEqual(ask({ action: "today", days: 1, limit: 20, unread_only: true }).res.items.map((m) => m.id), ["ID0001"]);
  const capped = ask({ action: "today", days: 2, limit: 1 }).res;
  assert.equal(capped.items.length, 1);
  assert.equal(capped.total, 3);
});

test("today: show=false leaves the Inbox window alone", opts, () => {
  assert.ok(!ask({ action: "today", days: 1, limit: 5, show: false }).seen.some((s) => s.call === "DisplayInbox"));
});

test("read: full text with attachments", opts, () => {
  const { res } = ask({ action: "read", id: "ID0001" });
  assert.equal(res.ok, true);
  assert.equal(res.subject, "Budget approval");
  assert.deepEqual([].concat(res.attachments), ["q4.xlsx"]);
  assert.match(res.body, /approve/);
});

test("draft reply: saved and shown, never sent, reply text goes above the quoted original, text is escaped", opts, () => {
  const { res, seen } = ask({ action: "draft", reply_to: "ID0001", body: "Approved <b>&</b>.\nThanks!" });
  assert.equal(res.ok, true);
  assert.match(res.message, /Nothing was sent/);
  assert.deepEqual(seen.map((s) => s.call), ["Save", "Display"]);
  const d = seen[0];
  assert.equal(d.to, "ali@example.com");
  assert.equal(d.subject, "RE: Budget approval");
  assert.match(d.html, /Approved &lt;b&gt;&amp;&lt;\/b&gt;\.<br>Thanks!/);
  assert.ok(d.html.indexOf("Approved") < d.html.indexOf("quoted original"));
});

test("draft new email keeps the signature and handles Urdu text", opts, () => {
  const { res, seen } = ask({ action: "draft", to: "bob@example.com; eve@example.com", cc: "boss@example.com", subject: "Salaam", body: "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u06cc\u06a9\u0645" });
  assert.equal(res.ok, true);
  assert.equal(seen[0].to, "bob@example.com; eve@example.com");
  assert.equal(seen[0].cc, "boss@example.com");
  assert.match(seen[0].html, /\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u06cc\u06a9\u0645/);
  assert.match(seen[0].html, /-- signature --/);
});

test("send: sends exactly once, and never touches the Save/Display path", opts, () => {
  const { res, seen } = ask({ action: "send", to: "bob@example.com", subject: "Hi", body: "Hello" });
  assert.equal(res.ok, true);
  assert.match(res.message, /Email sent to bob@example\.com/);
  assert.deepEqual(seen.map((s) => s.call), ["Send"]);
});

test("a recipient Outlook cannot resolve stops the email before it is sent", opts, () => {
  const { res, seen } = ask({ action: "send", to: "unresolved@example.com", subject: "Hi", body: "Hello" });
  assert.equal(res.ok, false);
  assert.match(res.error, /could not resolve these recipients/);
  assert.equal(seen.length, 0);
});

test("an unknown action is an error, not a crash", opts, () => {
  const { res } = ask({ action: "format-disk" });
  assert.equal(res.ok, false);
  assert.match(res.error, /unknown action/);
});
