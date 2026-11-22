"use strict";
const test = require("node:test");
const assert = require("node:assert");
const b = require("../browser");

test("search url encodes the words and collapses spaces", () => {
  assert.equal(b.youtubeSearchUrl("  Kesariya   Arijit Singh "), "https://www.youtube.com/results?search_query=Kesariya%20Arijit%20Singh");
  assert.equal(b.youtubeSearchUrl("a&b=c#d"), "https://www.youtube.com/results?search_query=a%26b%3Dc%23d");
});

test("empty or huge searches are refused", () => {
  assert.throws(() => b.youtubeSearchUrl("   "), /which song/);
  assert.throws(() => b.youtubeSearchUrl("x".repeat(201)), /too long/);
});

test("the first real video is picked; Shorts, channels, playlists and junk are skipped", () => {
  const picked = b.pickYoutubeResult([
    { href: "/shorts/abc123", title: "short" },
    { href: "/channel/UC1234567", title: "channel" },
    { href: "/playlist?list=PL123", title: "list" },
    { href: "https://evil.example/watch?v=abcdefghijk", title: "offsite" },
    { href: "/watch?v=dQw4w9WgXcQ&pp=abc", title: "  The Song  " },
    { href: "/watch?v=zzzzzzzzzzz", title: "second" },
  ]);
  assert.deepEqual(picked, { title: "The Song", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&pp=abc" });
  assert.equal(b.pickYoutubeResult([]), null);
  assert.equal(b.pickYoutubeResult(null), null);
});

test("the tool is registered and rejects an empty query before touching Chrome", async () => {
  assert.equal(typeof b.tools.chrome_youtube_play, "function");
  await assert.rejects(() => b.tools.chrome_youtube_play({ query: "" }), /which song/);
});
