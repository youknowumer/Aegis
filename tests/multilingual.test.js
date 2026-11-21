"use strict";
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const load = (voices) => {
  const window = { speechSynthesis: { getVoices: () => voices || [], addEventListener() {} } };
  const ctx = { window, document: { readyState: "complete", getElementById: () => null, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, SpeechSynthesisUtterance: function () {}, speechSynthesis: window.speechSynthesis };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "voice.js"), "utf8"), ctx);
  return ctx.window.AegisVoice;
};
const A = load();
const V = (name, lang) => ({ name, lang, localService: true });

test("language is recognised from the script and from common words", () => {
  const b = (t, page) => A.analyze(t, page).base;
  assert.strictEqual(b("آپ کا شکریہ، یہ کام ہو گیا ہے"), "ur");
  assert.strictEqual(b("धन्यवाद, आपका काम हो गया है"), "hi");
  assert.strictEqual(b("شكرا جزيلا، هذا رائع جدا"), "ar");
  assert.strictEqual(b("ممنون، این کار خیلی عالی بود", "en-US"), "fa");
  assert.strictEqual(b("আপনাকে ধন্যবাদ"), "bn");
  assert.strictEqual(b("Hola, ¿cómo estás? Muchas gracias por todo."), "es");
  assert.strictEqual(b("Bonjour, je suis très content de vous voir."), "fr");
  assert.strictEqual(b("Guten Morgen, ich habe das nicht gemacht."), "de");
  assert.strictEqual(b("Olá, você está muito bem. Obrigado!"), "pt");
  assert.strictEqual(b("Merhaba, çok teşekkürler, nasıl yardımcı olabilirim"), "tr");
  assert.strictEqual(b("Terima kasih, saya tidak bisa datang untuk itu"), "id");
  assert.strictEqual(b("Привет, как твои дела сегодня?"), "ru");
  assert.strictEqual(b("Привіт, як справи? Це дуже добре і гарно."), "uk");
  assert.strictEqual(b("你好，今天过得怎么样？"), "zh");
  assert.strictEqual(b("こんにちは、今日はいい天気ですね。"), "ja");
  assert.strictEqual(b("안녕하세요, 만나서 반갑습니다."), "ko");
  assert.strictEqual(b("The meeting is at three and you can join if you like."), "en");
  assert.strictEqual(b("Gracias"), "es");                                        // one strong word is enough for a very short phrase
  assert.strictEqual(b("Come here, the main road is closed"), "en");              // look-alike words do not flip English
  assert.strictEqual(b("I think that is wrong, please check it with Ben"), "en");
});

test("Roman Urdu is spoken with an Indian-English voice and sent to the cloud as Urdu; mixed text follows its majority", () => {
  const r = A.analyze("Aap ka kaam ho gaya hai, bohat acha kiya", "en-US");
  assert.deepStrictEqual({ lang: r.lang, base: r.base, roman: r.roman }, { lang: "en-IN", base: "ur", roman: true });
  assert.strictEqual(A.analyze("Please open the Chrome browser now, شکریہ", "en-US").base, "en");   // one Urdu word inside English stays English
  assert.strictEqual(A.analyze("میٹنگ ٹھیک ہے meeting", "en-US").base, "ur");
  assert.strictEqual(A.analyze("Hola amigo", "es-MX").lang, "es-MX");              // the page's own region is kept
  assert.strictEqual(A.detectLang("Hello there", "ur-PK"), "en-US");               // Latin text on an Urdu page is still English
});

test("Urdu / Arabic / Persian are told apart when the letters allow it", () => {
  assert.strictEqual(A.analyze("ٹھیک ہے، میں آتا ہوں").base, "ur");
  assert.strictEqual(A.analyze("كيف حالك يا صديقي").base, "ar");
  assert.strictEqual(A.analyze("سلام، حال شما چطور است؟", "en-US").base, "fa");
});

test("feelings are understood in many languages", () => {
  const e = (t) => A.emotionOf(t);
  assert.strictEqual(e("¡Felicidades! Qué buena noticia."), "joy");
  assert.strictEqual(e("Je suis désolée, c'est vraiment triste."), "empathy");
  assert.strictEqual(e("Das ist dringend, bitte sofort!"), "urgent");
  assert.strictEqual(e("مبروك! هذا رائع"), "joy");
  assert.strictEqual(e("बधाई हो, बहुत बढ़िया!"), "joy");
  assert.strictEqual(e("申し訳ありません、残念です"), "empathy");
  assert.strictEqual(e("恭喜你，太棒了！"), "joy");
  assert.strictEqual(e("Осторожно, есть риск и проблема"), "concern");
  assert.strictEqual(e("Merhaba, hoş geldiniz"), "warm");
  assert.strictEqual(e("축하합니다"), "joy");
  assert.strictEqual(e("Cuidado, hay un problema y un riesgo"), "concern");
  assert.strictEqual(e("Mi dispiace, purtroppo è andata male"), "empathy");
  assert.strictEqual(e("Está decidido e confirmado, tudo pronto"), "confident");
  assert.strictEqual(e("Maaf kijiye, mujhe bahut dukh hai"), "empathy");
  assert.strictEqual(e("Das ist ein Tisch mit vier Beinen."), "calm");
  assert.strictEqual(e("¿Quieres que lo abra?"), "curious");
  assert.strictEqual(e("你想打开它吗？"), "curious");                               // full-width question mark
});

test("the AI's emotion tags win, are never shown, and cover the rest of their paragraph", () => {
  const p = A.shape("[empathy] Lo siento mucho. Fue un día difícil.\n\n[joy] ¡Pero hay buenas noticias! [calm] Todo está listo.", "en-US");
  assert.deepStrictEqual(Array.from(p, (x) => x.emotion), ["empathy", "empathy", "joy", "calm"]);
  assert.ok(p.every((x) => !/\[|\]/.test(x.text)));
  assert.strictEqual(p[0].tts, "es");
  assert.strictEqual(A.shape("[warm] [calm]", "en-US").length, 0);                    // a tag with no words is nothing to say
  assert.strictEqual(A.emotionOf("[urgent] Nice and happy day!"), "urgent");          // tag beats the keyword guess
  assert.strictEqual(A.shape("[joy] Hello.", "en-US", { emotion: "concern" })[0].emotion, "concern");   // a caller's hint still wins
  assert.strictEqual(A.stripTags("[warm] Hi! [joy] Great [Joy]news"), "Hi! Great news");
  assert.strictEqual(A.stripTags("See [1] and [link]"), "See [1] and [link]");       // only the real tags go
  assert.strictEqual(A.stripTags("Almost [jo", true), "Almost ");                      // a tag still streaming in
});

test("each sentence is spoken in its own language, even inside one answer", () => {
  const p = A.shape("Your report is ready. آپ کا کام مکمل ہو گیا ہے۔ ¡Qué bien!", "en-US");
  assert.deepStrictEqual(Array.from(p, (x) => x.tts), ["en", "ur", "es"]);
  assert.deepStrictEqual(Array.from(p, (x) => x.lang), ["en-US", "ur-PK", "es-ES"]);
});

test("sentences split correctly in every script, and decimals stay whole", () => {
  assert.strictEqual(A.shape("今日は天気がいいです。散歩に行きましょう！楽しみですね。", "ja-JP").length, 3);
  assert.strictEqual(A.shape("आज मौसम अच्छा है। चलो टहलने चलें।", "hi-IN").length, 2);
  assert.strictEqual(A.shape("It is 3.5 degrees outside.", "en-US").length, 1);
  assert.strictEqual(A.shape("Wait... what? Really!", "en-US").length, 3);
  assert.ok(A.shape("Hello.\nSecond line", "en-US").length === 2);
});

test("studio voice groups neighbouring sentences with the same feeling and language, within the size limit", () => {
  const pieces = A.shape("[joy] Great news. [joy] The report is ready. [joy] Well done. [empathy] I am sorry about the delay.", "en-US");
  const g = A.cloudGroups(pieces);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].text, "Great news. The report is ready. Well done.");
  assert.strictEqual(g[0].emotion, "joy"); assert.strictEqual(g[1].emotion, "empathy");
  const long = A.cloudGroups(A.shape("[calm] " + "Sentence number one is here. ".repeat(40), "en-US"), 100);
  assert.ok(long.length > 5 && long.every((x) => x.text.length <= 100));
  assert.strictEqual(A.cloudGroups(A.shape("[calm] Hello there. [calm] Hola, ¿cómo estás? Muchas gracias.", "en-US")).length, 2);   // language change = new request
});

test("female voices are picked for the new languages, and missing voices are reported", () => {
  const B = load([V("Microsoft Jorge", "es-ES"), V("Microsoft Elvira Online (Natural)", "es-ES"), V("Microsoft Nanami Online (Natural)", "ja-JP"), V("Microsoft Keita", "ja-JP"), V("Microsoft Xiaoxiao Online (Natural)", "zh-CN"), V("Microsoft Yunxi Online (Natural)", "zh-CN")]);
  assert.match(B.resolve("es-ES").voice.name, /Elvira/);
  assert.match(B.resolve("ja-JP").voice.name, /Nanami/);
  assert.match(B.resolve("zh-CN").voice.name, /Xiaoxiao/);
  assert.ok(B.hasVoice("es") && B.hasVoice("ja-JP") && !B.hasVoice("ur-PK") && !B.hasVoice("de-DE"));
  assert.strictEqual(B.resolve("ur-PK").voice, null);                                   // never an English voice for Urdu text
});

test("studio voice is off until the server says it is available", () => {
  assert.strictEqual(A.cloud.ready(), false);
  assert.strictEqual(A.cloud.enabled(), true);
  assert.strictEqual(A.cloud.info(), null);
});
