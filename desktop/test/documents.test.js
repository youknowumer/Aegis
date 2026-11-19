"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const AdmZip = require("adm-zip");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-doc-"));
const second = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-doc2-"));
fs.mkdirSync(path.join(sandbox, "Downloads"));
process.env.AEGIS_SAFE_ROOTS = [path.join(sandbox, "Downloads"), sandbox, second].join(path.delimiter);
const tools = require("../tools");
const DL = path.join(sandbox, "Downloads");

// ---------- fixtures built in code, so the tests need no binary files ----------
function makeZip(file, parts) {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(parts)) z.addFile(name, Buffer.from(content, "utf8"));
  z.writeZip(file);
}
function makePdf(file, line) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 80 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  fs.writeFileSync(file, out);
}

test("read_document: Word keeps paragraphs, tabs and decodes entities", async () => {
  const f = path.join(sandbox, "memo.docx");
  makeZip(f, { "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Budget &amp; plan</w:t></w:r></w:p><w:p><w:r><w:t>Q4 target</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>PKR 5M</w:t></w:r></w:p></w:body></w:document>' });
  assert.strictEqual(await tools.run("read_document", { path: f }), "Budget & plan\nQ4 target\tPKR 5M");
});

test("read_document: Word tables read as rows with tab-separated cells (real Word layout)", async () => {
  const f = path.join(sandbox, "table.docx");
  const cell = (t) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  makeZip(f, { "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Stock</w:t></w:r></w:p><w:tbl><w:tr>${cell("SKU")}${cell("Qty")}</w:tr><w:tr>${cell("Kurta")}${cell("42")}</w:tr></w:tbl></w:body></w:document>` });
  assert.strictEqual(await tools.run("read_document", { path: f }), "Stock\nSKU\tQty\nKurta\t42");
});

test("read_document: Excel formulas without a cached value are shown as formulas", async () => {
  const f = path.join(sandbox, "formula.xlsx");
  makeZip(f, {
    "xl/workbook.xml": '<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1"><v>5</v></c><c r="B1"><f>A1*100</f></c><c r="C1"><f>A1*2</f><v>10</v></c><c r="D1"><f>A1+1</f><v></v></c></row></sheetData></worksheet>',
  });
  assert.strictEqual(await tools.run("read_document", { path: f }), "## Sheet: S\n5\t=A1*100\t10\t=A1+1");
});

test("read_document: Excel shows sheet names, shared strings, numbers and gaps", async () => {
  const f = path.join(sandbox, "sales.xlsx");
  makeZip(f, {
    "xl/workbook.xml": '<workbook><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>SKU</t></si><si><t>Qty</t></si><si><t>Kurta</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>',
  });
  const out = await tools.run("read_document", { path: f });
  assert.strictEqual(out, "## Sheet: Orders\nSKU\t\tQty\nKurta\t\t42");
});

test("read_document: PowerPoint lists slides in numeric order", async () => {
  const f = path.join(sandbox, "deck.pptx");
  makeZip(f, {
    "ppt/slides/slide10.xml": "<p><a:p><a:t>Ten</a:t></a:p></p>",
    "ppt/slides/slide2.xml": "<p><a:p><a:t>Two</a:t></a:p><a:p><a:t>Detail</a:t></a:p></p>",
  });
  assert.strictEqual(await tools.run("read_document", { path: f }), "## Slide 2\nTwo\nDetail\n\n## Slide 10\nTen");
});

test("read_document: PDF text layer", async () => {
  const f = path.join(sandbox, "invoice.pdf");
  makePdf(f, "Hello Aegis PDF");
  assert.match(await tools.run("read_document", { path: f }), /Hello Aegis PDF/);
});

test("read_document: long files come in pages, bad input fails cleanly", async () => {
  const f = path.join(sandbox, "long.txt");
  fs.writeFileSync(f, "x".repeat(20000));
  const p1 = await tools.run("read_document", { path: f });
  assert.match(p1, /^\[page 1 of 3; ask for page 2/);
  assert.match(await tools.run("read_document", { path: f, page: 3 }), /^\[page 3 of 3\]/);
  fs.writeFileSync(path.join(sandbox, "bad.docx"), "not a zip");
  assert.match(await tools.run("read_document", { path: path.join(sandbox, "bad.docx") }), /^Error:/);
  fs.writeFileSync(path.join(sandbox, "blob.bin"), Buffer.from([1, 0, 2, 0]));
  assert.match(await tools.run("read_document", { path: path.join(sandbox, "blob.bin") }), /^Error: cannot read/);
  assert.match(await tools.run("read_document", { path: "/etc/passwd" }), /^Error: path is outside/);
});

test("read_file hands Office files to the document reader instead of printing zip bytes", async () => {
  assert.match(await tools.run("read_file", { path: path.join(sandbox, "memo.docx") }), /Budget & plan/);
});

test("bare file names are found in whichever allowed folder holds them", async () => {
  fs.writeFileSync(path.join(second, "only-here.txt"), "found me");
  assert.strictEqual(await tools.run("read_file", { path: "only-here.txt" }), "found me");
  assert.match(await tools.run("read_file", { path: "../../etc/hosts" }), /^Error: path is outside/);
});

test("search_in_files finds lines, skips binaries and hidden/huge files", async () => {
  fs.mkdirSync(path.join(sandbox, "proj"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "proj", "a.py"), "import os\nAPI_URL = 'x'\n");
  fs.writeFileSync(path.join(sandbox, "proj", "b.csv"), "id,api_url\n1,y\n");
  fs.writeFileSync(path.join(sandbox, "proj", "c.png"), "api_url inside a picture");
  fs.mkdirSync(path.join(sandbox, ".hidden"));
  fs.writeFileSync(path.join(sandbox, ".hidden", "d.txt"), "api_url hidden");
  const out = await tools.run("search_in_files", { query: "api_url", folder: path.join(sandbox, "proj") });
  assert.match(out, /a\.py:2: API_URL/);
  assert.match(out, /b\.csv:1:/);
  assert.doesNotMatch(out, /c\.png/);
  assert.doesNotMatch(await tools.run("search_in_files", { query: "api_url" }), /\.hidden/);
  assert.match(await tools.run("search_in_files", { query: "a" }), /^Error: give at least 2/);
});

test("make_folder, copy_file (never overwrites), append_file, file_info", async () => {
  const d = path.join(sandbox, "work", "2026");
  assert.match(await tools.run("make_folder", { path: d }), /Folder ready/);
  const a = path.join(d, "a.txt");
  assert.match(await tools.run("append_file", { path: a, content: "one" }), /Added 3/);
  await tools.run("append_file", { path: a, content: "+two" });
  assert.strictEqual(fs.readFileSync(a, "utf8"), "one+two");
  const b = path.join(d, "b.txt");
  assert.match(await tools.run("copy_file", { src: a, dst: b }), /Copied/);
  assert.match(await tools.run("copy_file", { src: a, dst: b }), /^Error:/); // exists: refused
  assert.match(await tools.run("copy_file", { src: d, dst: path.join(d, "x") }), /^Error: only single files/);
  assert.match(await tools.run("file_info", { path: a }), /7\.?\d* KB|0\.0 KB|File .*a\.txt/);
  assert.match(await tools.run("file_info", { path: d }), /Folder .* 2 items/);
  assert.match(await tools.run("make_folder", { path: path.join(os.tmpdir(), "aegis-escape") }), /^Error: path is outside/);
  assert.match(await tools.run("append_file", { path: a, content: "" }), /^Error: content must/);
});

test("app names: friendly aliases resolve, unknown names pass through", () => {
  assert.strictEqual(tools.resolveAppName("Word"), "winword");
  assert.strictEqual(tools.resolveAppName("VS Code"), "code");
  assert.strictEqual(tools.resolveAppName("Power BI"), "pbidesktop");
  assert.strictEqual(tools.resolveAppName("someapp"), "someapp");
});

// ---------- email drafts ----------
test("buildMailto encodes safely and refuses header tricks", () => {
  const m = tools.buildMailto({ to: "Ali <ali@example.com>, sara@example.com", cc: "boss@example.com", subject: "Q4 report & plan", body: "Hi Ali,\nSee attached." });
  assert.ok(m.url.startsWith("mailto:ali@example.com,sara@example.com?cc=boss@example.com&subject=Q4%20report%20%26%20plan&body=Hi%20Ali%2C%0D%0ASee%20attached."));
  assert.strictEqual(m.bodyDropped, false);
  assert.throws(() => tools.buildMailto({ to: "a@x.com", subject: "Hi\r\nBcc: evil@x.com" }), /line break/);
  assert.throws(() => tools.buildMailto({ to: "a@x.com\nb@x.com" }), /line break/);
  assert.throws(() => tools.buildMailto({ to: "javascript:alert(1)" }), /not a valid email/);
  assert.throws(() => tools.buildMailto({ to: "" }), /who should/);
  assert.throws(() => tools.buildMailto({ to: Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(",") }), /at most 10/);
  const long = tools.buildMailto({ to: "a@x.com", subject: "s", body: "word ".repeat(600) });
  assert.strictEqual(long.bodyDropped, true);
  assert.ok(long.url.length < 200 && !long.url.includes("body="));
});

// ---------- downloads ----------
const publicLookup = async () => [{ address: "93.184.216.34" }];
function fakeResponse(body, { status = 200, headers = {} } = {}) {
  return { status, headers: { "content-length": String(Buffer.byteLength(body)), ...headers }, stream: Readable.from([Buffer.from(body)]) };
}

test("isPublicIp rejects private, loopback, link-local, metadata and mapped addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1", "not-an-ip"]) {
    assert.strictEqual(tools.isPublicIp(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) assert.strictEqual(tools.isPublicIp(ip), true, ip);
});

test("sanitizeFilename strips paths and illegal characters", () => {
  assert.strictEqual(tools.sanitizeFilename("..\\..\\Windows\\evil.txt"), "evil.txt");
  assert.strictEqual(tools.sanitizeFilename("a<b>:c|d?.pdf"), "a_b__c_d_.pdf");
  assert.strictEqual(tools.sanitizeFilename("...hidden"), "hidden");
  assert.strictEqual(tools.sanitizeFilename(""), "");
});

test("downloadFile saves into Downloads and never overwrites", async () => {
  const deps = { lookup: publicLookup, request: async () => fakeResponse("hello file"), dir: DL };
  const a = await tools.downloadFile("https://example.com/report.txt", "", deps);
  const b = await tools.downloadFile("https://example.com/report.txt", "", { ...deps, request: async () => fakeResponse("second") });
  assert.strictEqual(path.basename(a.path), "report.txt");
  assert.strictEqual(path.basename(b.path), "report (1).txt");
  assert.strictEqual(fs.readFileSync(a.path, "utf8"), "hello file");
});

test("downloadFile refuses http, private hosts, redirects to private hosts, programs and oversize files", async () => {
  const base = { lookup: publicLookup, request: async () => fakeResponse("x"), dir: DL };
  await assert.rejects(tools.downloadFile("http://example.com/a.txt", "", base), /only https/);
  await assert.rejects(tools.downloadFile("https://user:pw@example.com/a.txt", "", base), /embedded logins/);
  await assert.rejects(tools.downloadFile("https://127.0.0.1/a.txt", "", base), /not a public website/);
  await assert.rejects(tools.downloadFile("https://[::1]/a.txt", "", base), /not a public website/);
  await assert.rejects(tools.downloadFile("https://intranet.local/a.txt", "", { ...base, lookup: async () => [{ address: "10.0.0.5" }] }), /not a public website/);
  await assert.rejects(tools.downloadFile("https://example.com/a.txt", "", { ...base, lookup: async () => [{ address: "93.184.216.34" }, { address: "192.168.0.9" }] }), /not a public website/); // mixed answers
  // redirect from a public host to the cloud metadata address
  let calls = 0;
  const redirecting = { ...base, lookup: async (h) => (h === "evil.example" ? [{ address: "93.184.216.34" }] : [{ address: "169.254.169.254" }]), request: async () => (++calls === 1 ? fakeResponse("", { status: 302, headers: { location: "https://metadata.internal/latest" } }) : fakeResponse("secret")) };
  await assert.rejects(tools.downloadFile("https://evil.example/start", "", redirecting), /not a public website/);
  await assert.rejects(tools.downloadFile("https://example.com/setup.exe", "", base), /programs or scripts/);
  await assert.rejects(tools.downloadFile("https://example.com/x", "run.bat", base), /programs or scripts/);
  await assert.rejects(tools.downloadFile("https://example.com/a.txt", "", { ...base, request: async () => fakeResponse("x", { headers: { "content-length": String(60 * 1024 * 1024) } }) }), /larger than 50 MB/);
  await assert.rejects(tools.downloadFile("https://example.com/a.txt", "", { ...base, request: async () => fakeResponse("nope", { status: 404 }) }), /HTTP 404/);
  assert.ok(!fs.existsSync(path.join(DL, "setup.exe")) && !fs.existsSync(path.join(DL, "run.bat")));
});

test("downloadFile cleans up a partial file when the stream fails mid-way", async () => {
  const broken = async () => ({ status: 200, headers: {}, stream: new Readable({ read() { this.push(Buffer.from("part")); this.destroy(new Error("connection reset")); } }) });
  await assert.rejects(tools.downloadFile("https://example.com/partial.dat", "", { lookup: publicLookup, request: broken, dir: DL }), /connection reset/);
  assert.ok(!fs.existsSync(path.join(DL, "partial.dat")));
});

test("download_file via run() reports errors as text and needs a real url", async () => {
  assert.match(await tools.run("download_file", { url: "not a url" }), /^Error:/);
  assert.match(await tools.run("download_file", { url: "http://example.com/a.txt" }), /^Error: only https/);
});
