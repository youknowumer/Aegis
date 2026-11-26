// Aegis voice: ONE female voice, with feeling.
//
// There is a single persona (a warm female voice). It is matched to the best female voice installed on the device
// (Neural / Natural / Premium / Siri voices are preferred; a male voice is never chosen while a female one exists).
// On top of that sits an emotion engine: every sentence is read for its feeling (joy, excitement, empathy, concern,
// urgency, curiosity, warmth, confidence...) and spoken with its own pitch, speed, volume and pause, so the voice
// does not sound like a monotone reader. No keys, no server: it all runs on the browser's built-in speech.
//
//   AegisVoice.resolve(lang, emotion?) -> { voice, lang, rate, pitch, volume }
//   AegisVoice.shape(text, lang, opts?) -> [{ text, emotion, rate, pitch, volume, pause }]   used by app.js to speak
//   AegisVoice.emotionOf(text)          -> "joy" | "excited" | "empathy" | "concern" | "urgent" | "curious" | "warm" | "confident" | "calm"
//   AegisVoice.analyze(text, pageLang)  -> { lang: "es-ES", base: "es", roman }   language of one sentence (any script; Roman Urdu too)
//   AegisVoice.stripTags(text)          removes the AI's [joy] / [empathy]... tags (they shape the voice, they are never shown or spoken)
//   AegisVoice.cloud                    optional studio voice from the server (ready / refresh / audio)
//   AegisVoice.tune({rate, pitch, volume, expression}) / reset() / describe() / preview() / find(text)
(() => {
  "use strict";

  const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // ---------------------------------------------------------------- the one voice
  const PERSONA = { id: "aegis", name: "Aegis", desc: "Warm, expressive female voice", g: "f", pitch: 1.06, rate: 1.0 };

  const FEMALE = /\b(samantha|ava|allison|susan|victoria|karen|moira|tessa|fiona|veena|zira|hazel|aria|jenny|libby|sonia|natasha|clara|catherine|nicky|joana|serena|kate|heera|neerja|olivia|emma|amy|salli|joanna|kendra|kimberly|ivy|zoe|female|woman|siri voice [24]|lekha|kalpana|nora|ellen|laura|paulina|monica|sara|zuzana|mariska|ting-ting|mei-jia|sin-ji|kyoko|samira|salma|uzma|swara|michelle|ana|emily|maisie|ruth|nicole|jessica|sophia|isabella|ayesha|aisha|zariyah|fatima|hoda|hala|laila|ekaterina|svetlana|katja|elke|denise|lucia|paloma|elvira|vera|amelie|audrey|aurelie|julie|hortense|marie|virginie|anna|petra|marlene|vicki|hedda|alice|elsa|federica|paola|luciana|fernanda|francisca|raquel|maria|milena|irina|tatyana|katya|yelda|filiz|emel|haruka|nanami|ayumi|sayaka|o-ren|yuna|sun-hi|heami|sora|xiaoxiao|xiaoyi|huihui|yaoyao|hiujan|tracy|tanishaa|pallavi|damayanti|gadis|kanya|premwadee|narisa|linh|hoaimy|claire|colette|fenna|zosia|agnieszka|melina|athina|carmit|hila|helena|valentina|camila|dalia|elena|salome|marisol|catalina|polina|yasmin|leila|noura|rana|sana|dilara|shakila|shruti|sapna)\b/i;
  const MALE = /\b(daniel|alex|fred|tom|oliver|arthur|aaron|rishi|david|mark|guy|ryan|george|james|richard|ravi|prabhat|male|man|thomas|liam|william|evan|gordon|lee|matthew|brian|justin|joey|kevin|russell|nathan|jorge|diego|siri voice [13]|hemant|madhur|henry|eddy|reed|rocko|salman|asad|christopher|eric|roger|steffan|mohan|ravi|hamed|naayf|maged|jamal|tarik|shakir|jorge|juan|carlos|pablo|stefan|conrad|killian|florian|jonas|hans|klaus|yuri|dmitry|pavel|maxim|ichiro|otoya|keita|naoki|kangkang|yunyang|yunxi|yunjian|injoon|bongjin|gookmin|valluvar|bashkar|andika|fabrice|henri|paul|bruno|giorgos|nikos|asaf|luca|emilio|lorenzo|thiago|antonio|felipe|ricardo|ali|farid|sultan)\b/i;
  const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|pipe organ|grandma|grandpa|ralph)\b/i;
  const QUALITY = [[/siri/i, 40], [/neural|natural|online/i, 30], [/premium|enhanced|studio|plus/i, 24], [/google/i, 12], [/microsoft/i, 8]];

  const genderOf = (v) => (FEMALE.test(v.name) ? "f" : MALE.test(v.name) ? "m" : "");
  const normLang = (l) => String(l || "").replace("_", "-");
  const regionOf = (v) => (normLang(v.lang).split("-")[1] || "").toUpperCase();
  const baseOf = (l) => normLang(l).split("-")[0].toLowerCase();
  const voices = () => (hasTTS ? speechSynthesis.getVoices() : []);

  function quality(v) {
    let q = 0;
    for (const [re, pts] of QUALITY) if (re.test(v.name)) q += pts;
    if (NOVELTY.test(v.name)) q -= 60;
    if (v.localService) q += 3;
    return q;
  }

  // A female voice always beats a male one; accent follows the page language (en-GB page -> British female, and so on).
  function score(v, lang) {
    if (baseOf(v.lang) !== baseOf(lang)) return -1e9;                    // never read English with a Hindi voice
    let s = quality(v) + 100;
    const g = genderOf(v);
    if (g === "f") s += 400; else if (g === "m") s -= 400;
    const want = (normLang(lang).split("-")[1] || "").toUpperCase();
    if (want && regionOf(v) === want) s += 25;
    return s;
  }

  function best(lang) {
    let top = null, topScore = -1e8;
    for (const v of voices()) { const s = score(v, lang); if (s > topScore) { top = v; topScore = s; } }
    return top;
  }

  // ---------------------------------------------------------------- state
  const num = (k, d, lo, hi) => { const n = parseFloat(store.get(k)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const state = {
    pitch: num("aegis_pitch", 1, 0.6, 1.6),
    volume: num("aegis_volume", 1, 0.1, 1),
    expression: num("aegis_expression", 1, 0, 1.6),   // 0 = flat, 1 = natural, 1.6 = very dramatic
  };
  const listeners = new Set();
  const emit = () => { listeners.forEach((f) => { try { f(); } catch {} }); };
  function rateInput() { const r = $("rate"); return r ? parseFloat(r.value) || 1.02 : 1.02; }

  // ---------------------------------------------------------------- emotion engine
  // pitch / rate / volume are multipliers around the neutral voice; pause is the silence (ms) left after the sentence.
  const EMOTIONS = {
    calm:      { pitch: 1.00, rate: 1.00, volume: 1.00, pause: 240 },
    warm:      { pitch: 1.05, rate: 0.97, volume: 1.00, pause: 260 },
    joy:       { pitch: 1.12, rate: 1.05, volume: 1.00, pause: 240 },
    excited:   { pitch: 1.18, rate: 1.12, volume: 1.00, pause: 200 },
    curious:   { pitch: 1.09, rate: 1.00, volume: 0.98, pause: 300 },
    empathy:   { pitch: 0.93, rate: 0.88, volume: 0.90, pause: 420 },
    concern:   { pitch: 0.96, rate: 0.93, volume: 0.96, pause: 360 },
    urgent:    { pitch: 1.08, rate: 1.12, volume: 1.00, pause: 160 },
    confident: { pitch: 0.98, rate: 0.98, volume: 1.00, pause: 280 },
  };
  const EMO_NAMES = Object.keys(EMOTIONS);

  // The AI marks each sentence with a tag such as [joy] (it understands feelings in every language). The tags are never shown or spoken.
  const TAG_SRC = "\\[\\s*(" + EMO_NAMES.join("|") + ")\\s*\\]";
  const stripTags = (t, partial) => {
    let s = String(t == null ? "" : t).replace(new RegExp(TAG_SRC + "[ \\t]?", "gi"), "");
    if (partial) s = s.replace(/\[[a-z]{0,9}$/i, "");      // a tag still arriving while the answer streams in
    return s;
  };

  // Keyword lexicon per language. "|" separates entries; a trailing * means "starts with". Latin-script words match whole words;
  // words in other scripts (Urdu, Hindi, Arabic, Chinese, Cyrillic...) match anywhere in the sentence.
  // This is the fallback: when the AI sends a tag, the tag wins.
  const LEX_SRC = {
    en: { joy: "great|awesome|wonderful|fantastic|excellent|perfect|congrat*|happy|glad|love|nice|brilliant|amazing|well done|good news|success*|celebrat*|delighted|thrilled|proud",
          excited: "wow|yay|incredible|unbelievable|can't wait|so exciting|let's go|hooray|woohoo|amazing news|finally",
          empathy: "sorry|apolog*|unfortunately|sadly|regret|my condolences|i understand|that must be|hard time|difficult time|sad|i'm here for you|take care|get well|condolence*|heartbroken",
          concern: "warning|careful|caution|risk*|danger*|problem|issue|blocker|failed|failure|error|cannot|can't|couldn't|unable|missing|delay*|late|overdue|worried",
          urgent: "urgent*|immediately|right now|asap|emergency|critical|alert|deadline today",
          warm: "hello|hi there|hey|good morning|good afternoon|good evening|welcome|thanks|thank you|please|pleasure",
          confident: "decided|decision|confirmed|approved|agreed|will do|done|completed|ready|sorted|settled|final" },
    roman: { joy: "mubarak|mubarik|shabash|zabardast|khush*|kamyab*|acha|achha|behtareen|kamaal|wah|bohat khoob|shandar|badhai|badhiya|bahut badhiya|maza aa gaya",
             excited: "arre wah|kya baat hai|mazza",
             empathy: "afsos|maaf*|dukh|takleef|mushkil waqt|dhyan rakhiye|khayal rakhiye",
             concern: "khatra|khatrey|masla|masail|ehtiyat|nakam*|ghalti|der ho|deri|pareshan*|fikar|chinta",
             urgent: "abhi|fori|foran|jaldi|zaroori|zaruri",
             warm: "assalam*|salam|shukriya|meherbani|khush amdeed|khair mubarak|aap ka shukriya|dhanyavaad|dhanyawad|namaste",
             confident: "faisla|tay|manzoor|mukammal|ho gaya|ho gayi|tayyar" },
    ur: { joy: "مبارک|شاباش|زبردست|خوش|کامیاب|بہترین|واہ|شاندار", excited: "واہ واہ|ماشاء اللہ|ماشاءاللہ", empathy: "معذرت|افسوس|معاف|دکھ|تکلیف|مشکل وقت|خیال رکھیے",
          concern: "خطرہ|مسئلہ|احتیاط|ناکام|غلطی|تاخیر|پریشان", urgent: "فوری|ابھی|جلدی|ضروری", warm: "سلام|شکریہ|مہربانی|خوش آمدید|السلام", confident: "فیصلہ|منظور|مکمل|تیار|طے" },
    hi: { joy: "बधाई|शानदार|बढ़िया|बहुत अच्छा|खुश|खुशी|शाबाश|कमाल|वाह|शुभकामना", excited: "अरे वाह|क्या बात है|मज़ा आ गया", empathy: "माफ़|माफी|खेद|दुख|अफ़सोस|अफसोस|सहानुभूति|ख्याल रखें",
          concern: "खतरा|ख़तरा|समस्या|सावधान|गलती|विफल|असफल|देरी|चिंता|परेशान", urgent: "तुरंत|अभी|जल्दी|ज़रूरी|जरूरी|फौरन", warm: "नमस्ते|धन्यवाद|शुक्रिया|स्वागत|कृपया|सुप्रभात", confident: "फैसला|निर्णय|तय|मंज़ूर|मंजूर|तैयार|हो गया" },
    ar: { joy: "مبروك|رائع|ممتاز|جميل|سعيد|تهانينا|أحسنت|ما شاء الله", excited: "لا أصدق|يا له من", empathy: "آسف|عذرا|للأسف|تعازي|حزين|أتفهم|اعتن بنفسك",
          concern: "تحذير|احذر|خطر|مشكلة|خطأ|فشل|تأخير|قلق", urgent: "عاجل|فورا|فوراً|الآن|بسرعة|طارئ", warm: "مرحبا|أهلا|السلام عليكم|شكرا|من فضلك|صباح الخير|مساء الخير", confident: "تقرر|تمت|موافق|جاهز|مؤكد" },
    fa: { joy: "تبریک|عالی|خوشحال|عالیه", excited: "باورم نمی", empathy: "متاسفم|متأسفم|ببخشید|همدردی|ناراحت", concern: "خطر|مشکل|اشتباه|نگران|شکست", urgent: "فوری|عجله|همین الان", warm: "سلام|ممنون|سپاس|خوش آمدید|صبح بخیر", confident: "تصمیم|تایید|انجام شد|آماده" },
    bn: { joy: "অভিনন্দন|চমৎকার|দারুণ|খুশি", excited: "অবিশ্বাস্য", empathy: "দুঃখিত|দুঃখ|ক্ষমা|সহানুভূতি", concern: "সতর্ক|বিপদ|সমস্যা|ভুল|ব্যর্থ|দেরি|চিন্তা", urgent: "জরুরি|এখনই|তাড়াতাড়ি", warm: "নমস্কার|ধন্যবাদ|স্বাগতম|শুভ সকাল", confident: "সিদ্ধান্ত|নিশ্চিত|সম্পন্ন|প্রস্তুত" },
    es: { joy: "felicidades|enhorabuena|genial|excelente|maravilloso|fantástico|perfecto|feliz|me alegra|buenas noticias|bien hecho|increíble", excited: "qué emoción|no puedo esperar|guau|vamos",
          empathy: "lo siento|perdón|lamento|lamentablemente|desafortunadamente|mis condolencias|entiendo|triste|cuídate", concern: "cuidado|advertencia|peligro|riesgo|problema|error|falló|fallo|retraso|no puedo|preocupa*",
          urgent: "urgente|inmediatamente|ahora mismo|cuanto antes|emergencia", warm: "hola|buenos días|buenas tardes|buenas noches|bienvenido|bienvenida|gracias|por favor", confident: "decidido|decisión|confirmado|aprobado|hecho|listo|acordado" },
    fr: { joy: "félicitations|bravo|génial|excellent|merveilleux|fantastique|parfait|heureux|content|bonne nouvelle|super|formidable", excited: "waouh|trop hâte|youpi|incroyable",
          empathy: "désolé|désolée|pardon|malheureusement|regrette|mes condoléances|je comprends|triste|prenez soin", concern: "attention|prudence|danger|risque|problème|erreur|échec|retard|inquiet*",
          urgent: "urgent|urgence|immédiatement|tout de suite|maintenant|au plus vite", warm: "bonjour|salut|bonsoir|bienvenue|merci|s'il vous plaît|s'il te plaît", confident: "décidé|décision|confirmé|approuvé|terminé|prêt|convenu" },
    de: { joy: "glückwunsch|gratuliere|großartig|wunderbar|fantastisch|ausgezeichnet|perfekt|glücklich|froh|toll|gute nachrichten|gut gemacht", excited: "wow|juhu|unglaublich|kaum erwarten",
          empathy: "entschuldigung|tut mir leid|leider|bedauere|beileid|verstehe|traurig|pass auf dich auf", concern: "achtung|vorsicht|warnung|gefahr|risiko|problem|fehler|gescheitert|verspätung|sorge",
          urgent: "dringend|sofort|jetzt|so schnell wie möglich|notfall", warm: "hallo|guten morgen|guten tag|guten abend|willkommen|danke|bitte", confident: "entschieden|entscheidung|bestätigt|genehmigt|erledigt|fertig|vereinbart" },
    pt: { joy: "parabéns|ótimo|excelente|maravilhoso|fantástico|perfeito|feliz|boas notícias|muito bem|incrível", excited: "uau|mal posso esperar",
          empathy: "desculpa|desculpe|lamento|infelizmente|meus sentimentos|entendo|triste|se cuide", concern: "cuidado|aviso|perigo|risco|problema|erro|falhou|atraso|preocupado",
          urgent: "urgente|imediatamente|agora|o mais rápido|emergência", warm: "olá|oi|bom dia|boa tarde|boa noite|bem vindo|obrigado|obrigada|por favor", confident: "decidido|decisão|confirmado|aprovado|pronto|combinado|está feito" },
    it: { joy: "congratulazioni|complimenti|ottimo|eccellente|meraviglioso|fantastico|perfetto|felice|buone notizie|ben fatto", excited: "evviva|incredibile|non vedo l'ora",
          empathy: "scusa|scusi|dispiace|purtroppo|condoglianze|capisco|triste|abbi cura", concern: "attenzione|cautela|pericolo|rischio|problema|errore|fallito|ritardo|preoccupato",
          urgent: "urgente|immediatamente|subito|adesso|emergenza|il prima possibile", warm: "ciao|buongiorno|buonasera|benvenuto|grazie|prego|per favore", confident: "deciso|decisione|confermato|approvato|fatto|pronto|concordato" },
    tr: { joy: "tebrikler|harika|mükemmel|muhteşem|güzel|mutlu|sevindim|iyi haberler|bravo|süper", excited: "vay|yaşasın|inanılmaz|sabırsızlanıyorum",
          empathy: "üzgünüm|özür|maalesef|başsağlığı|anlıyorum|üzücü|kendine iyi bak", concern: "dikkat|uyarı|tehlike|risk|sorun|hata|başarısız|gecikme|endişe*",
          urgent: "acil|hemen|şimdi|derhal|en kısa sürede", warm: "merhaba|selam|günaydın|iyi akşamlar|hoş geldiniz|teşekkürler|lütfen", confident: "karar|onaylandı|tamam|hazır|tamamlandı" },
    id: { joy: "hebat|luar biasa|bagus|sempurna|senang|bahagia|kabar baik|mantap", excited: "tidak sabar|wah", empathy: "maaf|sayangnya|turut berduka|saya mengerti|sedih|jaga diri",
          concern: "hati hati|bahaya|risiko|masalah|kesalahan|gagal|terlambat|khawatir", urgent: "segera|darurat|sekarang|secepatnya|mendesak", warm: "halo|hai|selamat pagi|selamat siang|selamat malam|selamat datang|terima kasih|tolong", confident: "diputuskan|keputusan|dikonfirmasi|disetujui|selesai|siap|sepakat" },
    ru: { joy: "поздравляю|поздравления|отлично|прекрасно|замечательно|великолепно|рад |счастлив|хорошие новости|молодец", excited: "ура|вау|невероятно|не могу дождаться",
          empathy: "извините|простите|сожалею|к сожалению|мои соболезнования|понимаю|грустно|береги себя", concern: "осторожно|внимание|предупреждение|опасность|риск|проблема|ошибка|неудача|задержка|беспокоюсь",
          urgent: "срочно|немедленно|сейчас|как можно скорее", warm: "привет|здравствуйте|доброе утро|добрый день|добрый вечер|добро пожаловать|спасибо|пожалуйста", confident: "решено|решение|подтверждено|одобрено|готово|договорились|сделано" },
    zh: { joy: "恭喜|太棒了|太好了|真好|开心|高兴|好消息|完美|優秀|优秀|太棒", excited: "哇|太激动|终于|終於", empathy: "对不起|對不起|抱歉|遗憾|遺憾|不幸|我理解|难过|難過|节哀|保重",
          concern: "小心|注意|警告|危险|危險|风险|風險|问题|問題|错误|錯誤|失败|失敗|延误|担心|擔心", urgent: "紧急|緊急|立即|马上|馬上|尽快|盡快", warm: "你好|早上好|下午好|晚上好|欢迎|歡迎|谢谢|謝謝", confident: "决定|決定|确认|確認|批准|完成|搞定" },
    ja: { joy: "おめでとう|素晴らしい|すばらしい|最高|嬉しい|うれしい|良かった|よかった|やった", excited: "わあ|すごい|楽しみ", empathy: "ごめん|すみません|申し訳|残念|お気の毒|わかります|悲しい|お大事に",
          concern: "注意|気をつけ|警告|危険|リスク|問題|エラー|失敗|遅れ|心配", urgent: "緊急|至急|今すぐ|すぐに|急い", warm: "こんにちは|おはよう|こんばんは|ようこそ|ありがとう|お願い", confident: "決定|確認|承認|完了|準備|了解|かしこまりました" },
    ko: { joy: "축하|훌륭|멋져|최고|기뻐|좋은 소식|잘했|대단", excited: "신나|기대|드디어", empathy: "죄송|미안|유감|안타깝|슬프|이해해|힘내|몸조심",
          concern: "조심|주의|경고|위험|문제|오류|실패|지연|걱정", urgent: "긴급|급해|지금 당장|빨리|즉시", warm: "안녕|환영|감사|고맙|부탁", confident: "결정|확정|승인|완료|준비|알겠" },
  };

  const norm = (s) => " " + String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{M}\p{N}']+/gu, " ").trim() + " ";
  const LEX = {};                                    // emotion -> [{ w, mode: "word" | "prefix" | "any" }]
  for (const e of EMO_NAMES) LEX[e] = [];
  for (const lang of Object.keys(LEX_SRC)) {
    for (const [e, list] of Object.entries(LEX_SRC[lang])) {
      for (let raw of list.split("|")) {
        const pre = raw.endsWith("*");
        if (pre) raw = raw.slice(0, -1);
        raw = raw.toLowerCase();
        if (!raw.trim()) continue;
        if (/[a-z]/.test(raw) || /[àâäçéèêëîïôöùûüÿœßñáíóúãõşğıİ]/.test(raw)) LEX[e].push({ w: norm(raw).slice(0, -1), mode: pre ? "prefix" : "word" });
        else LEX[e].push({ w: raw, mode: "any" });
      }
    }
  }
  function lexScore(raw, n) {
    const out = {};
    for (const e of EMO_NAMES) {
      let c = 0;
      for (const k of LEX[e]) {
        if (k.mode === "any") { if (raw.includes(k.w)) c++; }
        else if (k.mode === "prefix") { if (n.includes(k.w)) c++; }
        else if (n.includes(k.w + " ")) c++;
      }
      out[e] = c;
    }
    return out;
  }

  // The feeling of one sentence. `hint` (an AI tag, or a caller such as a meeting read-out) wins over the keyword guess.
  function emotionOf(text, hint) {
    if (hint && EMOTIONS[String(hint).toLowerCase()]) return String(hint).toLowerCase();
    const tag = String(text || "").match(new RegExp(TAG_SRC, "i"));
    if (tag) return tag[1].toLowerCase();
    const t = stripTags(text).trim();
    if (!t) return "calm";
    const score = lexScore(t.toLowerCase(), norm(t));
    const bangs = (t.match(/[!！]/g) || []).length;
    if (bangs) { score.excited += bangs > 1 ? 2 : 0; score.joy += 1; }
    if (/[?？؟]\s*$/.test(t)) score.curious += 2;
    if (/\.{3}|…/.test(t)) score.empathy += 1;
    if (/[\u{1F600}-\u{1F64F}\u{1F970}-\u{1F9FF}]/u.test(t)) score.joy += 1;
    let top = "calm", n = 0;
    for (const k of ["urgent", "empathy", "concern", "excited", "joy", "curious", "confident", "warm"]) {   // order = tie-break priority
      if ((score[k] || 0) > n) { top = k; n = score[k]; }
    }
    return top;
  }

  // ---------------------------------------------------------------- which language is this sentence in?
  // Script first (Urdu, Hindi, Arabic, Chinese, Cyrillic...), then common words for Latin-script languages.
  // Each sentence is spoken with a voice of ITS OWN language, so a mixed English + Urdu answer is read properly.
  const DEFAULT_REGION = { en: "en-US", ur: "ur-PK", hi: "hi-IN", ar: "ar-SA", fa: "fa-IR", bn: "bn-BD", pa: "pa-IN", gu: "gu-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN",
    es: "es-ES", fr: "fr-FR", de: "de-DE", pt: "pt-BR", it: "it-IT", tr: "tr-TR", id: "id-ID", nl: "nl-NL", ru: "ru-RU", uk: "uk-UA", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", th: "th-TH", he: "he-IL", el: "el-GR" };
  const SCRIPTS = [["hi", /[\u0900-\u097f]/g], ["bn", /[\u0980-\u09ff]/g], ["pa", /[\u0a00-\u0a7f]/g], ["gu", /[\u0a80-\u0aff]/g], ["ta", /[\u0b80-\u0bff]/g], ["te", /[\u0c00-\u0c7f]/g],
    ["kn", /[\u0c80-\u0cff]/g], ["ml", /[\u0d00-\u0d7f]/g], ["th", /[\u0e00-\u0e7f]/g], ["he", /[\u0590-\u05ff]/g], ["el", /[\u0370-\u03ff]/g], ["ru", /[\u0400-\u04ff]/g],
    ["ko", /[\uac00-\ud7af\u1100-\u11ff]/g], ["ja", /[\u3040-\u30ff]/g], ["zh", /[\u4e00-\u9fff]/g], ["ur", /[\u0600-\u06ff\u0750-\u077f]/g]];
  const WORDS = {
    en: "the and is are you to of in it that this for with have will can what how your i my please thanks not be do was they we",
    es: "el los las una que por para pero muy está estoy gracias hola cómo qué también porque usted buenos buenas con del es son lo mucho siento bien hay todo tengo quiero puedo fue noticias día difícil",
    fr: "le les des une est pas pour avec dans vous je nous merci bonjour être très c'est j'ai qu'il aussi mais et ça suis cette peux veux oui elle ils",
    de: "der die das und ist nicht ich sie wir ein eine mit für auf danke bitte hallo wie was auch aber zu bin habe kann sehr gut heute nein",
    pt: "não uma você para com muito obrigado obrigada olá está são também então isso tudo bom dia os tenho posso quero hoje sim",
    it: "il che non per una sono grazie ciao anche molto questo è della buongiorno prego perché gli ho posso voglio oggi",
    tr: "bir ve bu için ile değil çok merhaba teşekkürler evet hayır nasıl ben sen var ne",
    id: "yang dan di ini itu tidak ada untuk dengan saya anda terima kasih selamat apa bisa akan sudah",
    nl: "het een niet ik je dat van dank hallo goed wat hoe zijn naar ook maar",
    roman: "hai hain kya aap tum main mein nahi nahin ko ka ki ke se ho hoga kar karo kro raha rahi tha thi bohat bahut acha theek shukriya mujhe abhi kal aaj yeh woh kyun kaise bhai yaar",
  };
  const WORDSETS = {};
  for (const k of Object.keys(WORDS)) WORDSETS[k] = new Set(WORDS[k].split(" "));
  const URDU_ONLY = /[\u0679\u0688\u0691\u06ba\u06be\u06c1\u06c2\u06d2\u06d3]/;
  const ARABIC_ONLY = /[\u064a\u0643\u0629\u0649\u0623\u0625\u0624\u0626]/;
  const PERSIAN_WORDS = new Set("این است نیست خیلی چطور هستم هستیم برای بود ممنون متاسفم متأسفم داریم میکنم می‌کنم شما".split(" "));

  // -> { lang: "es-ES", base: "es", roman: false }. pageLang is the language chosen in the app (used when the text gives no clue).
  function analyze(text, pageLang) {
    const t = stripTags(text);
    const letters = (t.match(/\p{L}/gu) || []).length;
    const latin = (t.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    const native = Math.max(0, letters - latin);
    const pageBase = baseOf(pageLang || "") || "en";
    if (native > 0 && native * 2 >= latin) {
      let best = "", n = 0;
      for (const [code, re] of SCRIPTS) { const c = (t.match(re) || []).length; if (c > n) { best = code; n = c; } }
      if (best === "ur") {
        const persian = (t.match(/[\u0600-\u06ff\u200c]+/g) || []).some((w) => PERSIAN_WORDS.has(w));
        if (URDU_ONLY.test(t)) best = "ur";
        else if (persian && !ARABIC_ONLY.test(t)) best = "fa";
        else if (/[\u067e\u0686\u0698\u06af]/.test(t) && !ARABIC_ONLY.test(t) && pageBase !== "ur") best = "fa";
        else if (ARABIC_ONLY.test(t) && !/[\u067e\u0686\u0698\u06af]/.test(t)) best = "ar";
        else best = ["ur", "ar", "fa"].includes(pageBase) ? pageBase : "ur";
      } else if (best === "zh" && /[\u3040-\u30ff]/.test(t)) best = "ja";
      else if (best === "ru" && /[\u0456\u0457\u0454\u0491]/.test(t)) best = "uk";
      if (best) return { lang: pageBase === best && /-/.test(pageLang) ? normLang(pageLang) : DEFAULT_REGION[best], base: best, roman: false };
    }
    const lower = t.toLowerCase();
    if (/[ñ¿¡]/.test(lower)) return { lang: pageBase === "es" ? normLang(pageLang) : "es-ES", base: "es", roman: false };
    const toks = lower.replace(/[’‘]/g, "'").match(/[\p{L}']+/gu) || [];
    if (toks.length) {
      const score = {};
      for (const k of Object.keys(WORDSETS)) score[k] = toks.reduce((a, w) => a + (WORDSETS[k].has(w) ? 1 : 0), 0);
      if (/ß/.test(lower)) score.de += 2;
      if (/[ãõ]/.test(lower)) score.pt += 2;
      if (/[şğı]/.test(lower)) score.tr += 2;
      let top = "en", n = 0;
      for (const k of Object.keys(score)) if (k !== "en" && score[k] > n) { top = k; n = score[k]; }
      if (n >= 2 || (n >= 1 && toks.length <= 3 && score.en === 0)) {
        if (n > score.en) {
          if (top === "roman") return { lang: "en-IN", base: "ur", roman: true };        // Roman Urdu / Hindi: an Indian-English voice says it most naturally
          return { lang: pageBase === top && /-/.test(pageLang) ? normLang(pageLang) : DEFAULT_REGION[top], base: top, roman: false };
        }
      }
    }
    const en = /^en/i.test(pageLang || "") ? normLang(pageLang) : "en-US";
    return { lang: en, base: "en", roman: false };
  }
  const detectLang = (text, pageLang) => analyze(text, pageLang).lang;

  function splitSentences(text) {
    const parts = [];
    const END_ALWAYS = "\u06d4\u0964\u061f\u3002\uff01\uff1f\u2026";       // ۔ । ؟ 。 ！ ？ …
    const TRAIL = /[.!?\u06d4\u0964\u061f\u3002\uff01\uff1f\u2026"'\u201d\u2019)\]]/;
    for (const para of String(text || "").split(/\n{2,}/)) {
      const sents = [];
      for (const line of para.split("\n")) {
        let buf = "";
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          buf += ch;
          let end = END_ALWAYS.includes(ch);
          if (!end && (ch === "." || ch === "!" || ch === "?")) { const nx = line[i + 1]; end = nx === undefined || /[\s"'\u201d\u2019)\]]/.test(nx); }
          if (end) {
            while (i + 1 < line.length && TRAIL.test(line[i + 1])) buf += line[++i];
            if (buf.trim()) sents.push(buf.trim());
            buf = "";
          }
        }
        if (buf.trim()) sents.push(buf.trim());
      }
      sents.forEach((s, i) => parts.push({ text: s, para: i === sents.length - 1 }));
    }
    return parts;
  }

  // text -> pieces ready for speechSynthesis. Short sentences are joined (fewer gaps), long ones are cut at commas.
  // Each piece carries the feeling (an AI tag wins over the keyword guess) and the language of its own sentence.
  function shape(text, lang, opts) {
    opts = opts || {};
    const ex = opts.expression != null ? opts.expression : state.expression;
    const lerp = (m) => 1 + (m - 1) * ex;                 // scale a multiplier by the expression level
    const out = [];
    let idx = 0, carry = "";
    for (const s of splitSentences(text)) {
      const tag = s.text.match(new RegExp(TAG_SRC, "i"));
      if (tag) carry = tag[1].toLowerCase();
      const clean = stripTags(s.text).trim();
      if (!clean) continue;
      const emo = opts.emotion && EMOTIONS[opts.emotion] ? opts.emotion : carry ? carry : emotionOf(clean);
      if (s.para) carry = "";                              // a tag covers the rest of its paragraph, no further
      const e = EMOTIONS[emo];
      const info = analyze(clean, lang);
      // a gentle alternating lift so even a calm paragraph is never a flat line
      const drift = ex ? ((idx++ % 3) - 1) * 0.012 * ex : 0;
      const ell = /\.{3}|…\s*$/.test(clean);
      let pieces = [clean];
      if (clean.length > 170) pieces = clean.match(/.{1,170}(?:[,;،؛、，]\s*|\s|$)/g) || [clean];   // browsers cut long utterances
      pieces.forEach((p, i) => {
        const last = i === pieces.length - 1;
        out.push({
          text: p.trim(), emotion: emo, lang: info.lang, tts: info.base,
          rate: clamp(lerp(e.rate) * (ell ? 0.94 : 1), 0.6, 1.7),
          pitch: clamp(lerp(e.pitch) + drift, 0.5, 1.9),
          volume: clamp(lerp(e.volume), 0.1, 1),
          pause: last ? Math.round(e.pause * (s.para ? 1.5 : 1) * (ell ? 1.6 : 1) * Math.max(0.4, ex)) : 70,
        });
      });
    }
    return out.filter((x) => x.text);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Studio voice: neighbouring sentences with the same feeling and language go to the cloud voice as one request (fewer calls, smoother speech).
  function cloudGroups(pieces, maxChars) {
    const max = maxChars || 320, first = 110, out = [];     // the first request stays short so the voice starts speaking sooner
    for (const p of pieces) {
      const g = out[out.length - 1];
      const cap = out.length === 1 ? first : max;
      if (g && g.emotion === p.emotion && g.tts === p.tts && (g.text + " " + p.text).length <= cap) { g.text += " " + p.text; g.pause = p.pause; g.items.push(p); continue; }
      out.push({ text: p.text, emotion: p.emotion, lang: p.lang, tts: p.tts, pause: p.pause, rate: p.rate, items: [p] });   // items: the sentences, for the browser voice if this group cannot be fetched
    }
    return out;
  }

  // ---------------------------------------------------------------- resolve (one voice, optional emotion)
  function resolve(lang, emotion) {
    lang = lang || "en-US";
    if (!hasTTS) return null;
    const v = best(lang);
    let pitch = PERSONA.pitch * state.pitch;
    if (!v) pitch *= 1.08;                                                    // the browser will pick; lean female
    else if (genderOf(v) === "m") pitch *= 1.28;                              // only male voices installed: lift towards female
    const e = EMOTIONS[emotion] || EMOTIONS.calm;
    return {
      voice: v, lang: v ? v.lang : lang,
      rate: clamp(rateInput() * PERSONA.rate * (1 + (e.rate - 1) * state.expression), 0.6, 1.8),
      pitch: clamp(pitch * (1 + (e.pitch - 1) * state.expression), 0.4, 2),
      volume: state.volume,
    };
  }
  function tuning() { return { pitch: state.pitch, volume: state.volume }; }
  // true when this device has at least one installed voice for the language (e.g. "es-ES", "ur")
  function hasVoice(lang) { return voices().some((v) => baseOf(v.lang) === baseOf(lang)); }

  // ---------------------------------------------------------------- control
  function tune(o) {
    if (o.rate != null) { const r = $("rate"); const nv = clamp(o.rate, 0.8, 1.4); if (r) { r.value = String(nv); store.set("aegis_rate", String(nv)); } }
    if (o.pitch != null) { state.pitch = clamp(o.pitch, 0.6, 1.6); store.set("aegis_pitch", String(state.pitch)); }
    if (o.volume != null) { state.volume = clamp(o.volume, 0.1, 1); store.set("aegis_volume", String(state.volume)); }
    if (o.expression != null) { state.expression = clamp(o.expression, 0, 1.6); store.set("aegis_expression", String(state.expression)); }
    emit();
    return { rate: rateInput(), pitch: state.pitch, volume: state.volume, expression: state.expression };
  }
  function reset() {
    state.pitch = 1; state.volume = 1; state.expression = 1;
    ["aegis_pitch", "aegis_volume", "aegis_expression"].forEach((k) => store.set(k, null));
    const r = $("rate"); if (r) { r.value = "1.02"; store.set("aegis_rate", "1.02"); }
    emit();
  }

  // Any request about "which voice" now has one answer. Male / accent requests are mapped to the single persona (or refused by the caller).
  function find(text) {
    const t = String(text || "").toLowerCase();
    if (/\b(?:male|man|boy|guy|mard|larka|he)\b/.test(t) && !/\bfemale\b/.test(t)) return null;   // we only have the female voice
    return PERSONA;
  }
  const list = () => [PERSONA];
  const set = () => PERSONA;
  const cycle = () => PERSONA;
  function describe() {
    const r = resolve("en-US");
    const vname = r && r.voice ? r.voice.name.replace(/^(Microsoft|Google)\s+/, "") : "";
    return PERSONA.name + " (female" + (vname ? ", " + vname : "") + ")";
  }

  // ---------------------------------------------------------------- preview
  const SAMPLES = [
    ["warm", "Hi, I'm Aegis. It's lovely to talk with you."],
    ["joy", "Great news! Your report is ready, and it looks wonderful."],
    ["empathy", "I'm sorry, that sounds really hard. I'm here to help."],
    ["concern", "Careful, there is a risk of a delay on this one."],
  ];
  let previewGen = 0;
  function speakShaped(text, opts) {
    if (!hasTTS) return;
    const gen = ++previewGen;
    speechSynthesis.cancel();
    const pieces = shape(text, (opts && opts.lang) || "en-US", opts);
    const step = (i) => {
      if (gen !== previewGen || i >= pieces.length) return;
      const p = pieces[i];
      const lang = p.lang || "en-US";
      const r = resolve(lang, p.emotion);
      const u = new SpeechSynthesisUtterance(p.text);
      if (r && r.voice) u.voice = r.voice;
      u.lang = r ? r.lang : lang;
      u.rate = p.rate * (rateInput() * PERSONA.rate); u.pitch = clamp(p.pitch * PERSONA.pitch * state.pitch, 0.4, 2); u.volume = p.volume * state.volume;
      u.onstart = () => { if (window.__aegisOrb) window.__aegisOrb.pulse(0.9); };
      u.onboundary = () => { if (gen === previewGen && window.__aegisOrb) window.__aegisOrb.pulse(0.4 + Math.random() * 0.5); };
      const next = () => { if (gen === previewGen) setTimeout(() => step(i + 1), p.pause); };
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    };
    step(0);
  }
  let sampleIdx = 0;
  function preview() {
    const s = SAMPLES[sampleIdx++ % SAMPLES.length];
    speakShaped(s[1], { emotion: s[0] });
  }
  // One feeling-filled line per language: "Hear another language" cycles through them.
  const WORLD = [
    ["warm", "ur", "السلام علیکم! میں ایجس ہوں، آپ سے مل کر بہت خوشی ہوئی۔"], ["joy", "es", "¡Qué buena noticia! Tu informe está listo y quedó perfecto."],
    ["empathy", "fr", "Je suis vraiment désolée. Je comprends que ce soit difficile, je suis là."], ["joy", "hi", "अरे वाह! आपका काम पूरा हो गया, बहुत बधाई!"],
    ["concern", "ar", "انتبه من فضلك، هناك خطر من التأخير في هذا الأمر."], ["warm", "de", "Guten Morgen! Schön, dass du da bist. Wie kann ich helfen?"],
    ["joy", "ja", "おめでとうございます！本当に素晴らしいです。"], ["empathy", "tr", "Çok üzgünüm, bunu duyduğuma gerçekten üzüldüm. Yanındayım."],
    ["excited", "zh", "太棒了！恭喜你，我真的为你高兴！"], ["confident", "pt", "Está tudo decidido e confirmado. Pode contar comigo."],
    ["warm", "ru", "Здравствуйте! Рада вас слышать. Чем могу помочь?"], ["warm", "it", "Ciao! Che bello sentirti. Dimmi pure, sono qui per te."],
  ];
  let worldIdx = 0;
  function previewWorld() {
    const s = WORLD[worldIdx++ % WORLD.length];
    speakShaped(s[2], { emotion: s[0], lang: DEFAULT_REGION[s[1]] });
    return { language: s[1], text: s[2] };
  }

  // ---------------------------------------------------------------- studio voice (optional cloud voice)
  // When the Aegis server has a text-to-speech key, replies are spoken by a natural cloud voice that follows each sentence's feeling in
  // any language. Without it (or if it fails or runs out for the day) the browser's own voices take over, so speech never stops.
  const cloud = (() => {
    const token = () => store.get("aegis_token") || "";
    const api = () => (typeof window !== "undefined" && window.__aegisApi ? window.__aegisApi() : "");
    const isLocal = () => !!(typeof window !== "undefined" && window.AEGIS_RUNTIME && window.AEGIS_RUNTIME.local);
    let info = null, infoAt = 0, fails = 0;
    const enabled = () => store.get("aegis_studio") !== "0";
    const ready = () => !!(info && info.available && enabled() && fails < 2);
    async function refresh(force) {
      if (typeof fetch === "undefined" || isLocal() || !token()) { info = null; return info; }
      if (!force && Date.now() - infoAt < 120000) return info;
      infoAt = Date.now();
      try {
        const r = await fetch(api() + "/api/tts/status", { headers: { Authorization: "Bearer " + token() } });
        info = r.ok ? await r.json() : null;
        if (info && info.available) fails = 0;
      } catch { info = null; }
      emit();
      return info;
    }
    // One group of sentences -> an object URL for the audio, or null (then the caller uses the browser voice).
    async function audio(group, signal) {
      try {
        const r = await fetch(api() + "/api/tts", {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
          body: JSON.stringify({ text: group.text, emotion: group.emotion, lang: group.tts, intensity: (window.AegisFeel && Date.now() - window.AegisFeel.at < 600000) ? window.AegisFeel.intensity : 3 }),
        });
        if (!r.ok) { fails = [429, 503, 413].includes(r.status) ? 2 : fails + 1; if (info && r.status === 429) info.chars_left = 0; emit(); return null; }
        const blob = await r.blob();
        fails = 0;
        if (info && info.chars_left != null) info.chars_left = Math.max(0, info.chars_left - group.text.length);
        return URL.createObjectURL(blob);
      } catch (e) { if (!(e && e.name === "AbortError")) fails++; return null; }
    }
    return { ready, refresh, audio, enabled, info: () => info, setEnabled(on) { store.set("aegis_studio", on ? "1" : "0"); emit(); }, reset() { fails = 0; infoAt = 0; } };
  })();

  // ---------------------------------------------------------------- settings UI
  function mountUI() {
    const pick = $("voice-pick");
    const group = pick && pick.closest(".set-group");
    if (!group || group.querySelector(".vp")) return;
    const lab = pick.closest("label"); if (lab) lab.style.display = "none";       // one voice only: no manual voice picker
    const host = document.createElement("div");
    host.className = "vp";
    const h = document.createElement("div"); h.className = "vp-h"; h.textContent = "Aegis voice";
    const note = document.createElement("p"); note.className = "muted small vp-note";
    const refresh = () => {
      if (cloud.ready()) {
        const ci = cloud.info();
        note.textContent = ci && ci.provider === "mms"
          ? "Each language is spoken by its own local voice, so the voice changes with the language you speak. It reads the feeling of each sentence and adjusts speed and loudness."
          : "One female studio voice, the same woman in every language. It reads the feeling of each sentence and speaks it with matching tone, speed and pauses.";
        return;
      }
      note.textContent = hasTTS ? "One female voice: " + describe() + ". It reads the feeling of each sentence and speaks it with matching tone, speed and pauses." : "This browser can't speak.";
    };
    refresh(); listeners.add(refresh);
    const mk = (label, min, max, step, get, set) => {
      const l = document.createElement("label"); l.className = "field";
      const sp = document.createElement("span"); sp.textContent = label;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = String(get()); inp.setAttribute("aria-label", label);
      inp.addEventListener("input", () => set(parseFloat(inp.value)));
      inp.addEventListener("change", () => preview());
      l.append(sp, inp);
      return l;
    };
    const test = document.createElement("button"); test.type = "button"; test.className = "btn ghost small-btn"; test.textContent = "Hear my emotions";
    test.addEventListener("click", () => speakShaped(SAMPLES.map((s) => s[1]).join("\n\n")));
    const studio = document.createElement("label"); studio.className = "toggle";
    const studioBox = document.createElement("input"); studioBox.type = "checkbox"; studioBox.checked = cloud.enabled();
    studioBox.addEventListener("change", () => cloud.setEnabled(studioBox.checked));
    const studioTxt = document.createElement("span"); studioTxt.textContent = "Studio voice (natural, any language)";
    studio.append(studioBox, studioTxt);
    const studioNote = document.createElement("p"); studioNote.className = "muted small vp-note";
    const refreshStudio = () => {
      const i = cloud.info();
      studioNote.textContent = !i ? "Studio voice needs the Aegis server with a voice key (see SETUP.md). Until then the voices on your device are used."
        : !i.available ? "Studio voice is not set up on this server, so your device voices are used."
        : i.provider === "mms" ? "Local language voices are on" + (i.languages && i.languages.length ? " (" + i.languages.length + " languages" + (i.roman_urdu ? " + Roman Urdu" : "") + ")" : "")
          + ". Aegis speaks each sentence in its own language; any other language uses the fallback voice."
          + (i.downloading && i.downloading.length ? " Downloading " + i.downloading.length + " more voice" + (i.downloading.length > 1 ? "s" : "") + " in the background: the fallback voice speaks that language until it is ready." : "")
        : "Studio voice is on (" + i.provider + "). " + (i.chars_left != null ? Number(i.chars_left).toLocaleString() + " characters left today." : "")
          + (i.local_reason ? " Local language voices are off: " + i.local_reason + "." : "");
    };
    refreshStudio(); listeners.add(refreshStudio); cloud.refresh();
    const world = document.createElement("button"); world.type = "button"; world.className = "btn ghost small-btn"; world.textContent = "Hear another language";
    world.addEventListener("click", () => previewWorld());
    host.append(h, note,
      mk("Emotion (0 flat, 1 natural, 1.6 dramatic)", "0", "1.6", "0.1", () => state.expression, (v) => { state.expression = v; store.set("aegis_expression", String(v)); }),
      mk("Pitch", "0.6", "1.6", "0.05", () => state.pitch, (v) => { state.pitch = v; store.set("aegis_pitch", String(v)); }),
      mk("Volume", "0.1", "1", "0.05", () => state.volume, (v) => { state.volume = v; store.set("aegis_volume", String(v)); }),
      studio, studioNote, test, world);
    group.querySelector("h4").after(host);
  }

  // compact controller for the right-hand "Voice" tab (tabs.js creates #vp-quick; safe to call twice)
  let quick = null;
  function mountQuick() {
    const box = $("vp-quick");
    if (!box || quick) return;
    quick = { box };
    box.textContent = "";
    const head = document.createElement("div"); head.className = "row blk-head static";
    head.innerHTML = '<h3><svg class="h-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>Voice studio</h3>';
    const eq = document.createElement("div"); eq.className = "vq-eq"; eq.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 24; i++) { const b = document.createElement("i"); b.style.setProperty("--i", i); eq.appendChild(b); }
    quick.now = document.createElement("p"); quick.now.className = "vq-now";
    const mk = (label, min, max, step, get, set) => {
      const l = document.createElement("label"); l.className = "vq-row";
      const sp = document.createElement("span"); sp.textContent = label;
      const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.setAttribute("aria-label", label);
      const out = document.createElement("output");
      inp.addEventListener("input", () => { set(parseFloat(inp.value)); out.textContent = parseFloat(inp.value).toFixed(2); });
      inp.addEventListener("change", () => preview());
      l.append(sp, inp, out);
      return { l, inp, out, get };
    };
    quick.rows = [
      mk("Emotion", "0", "1.6", "0.1", () => state.expression, (v) => tune({ expression: v })),
      mk("Speed", "0.8", "1.4", "0.05", rateInput, (v) => tune({ rate: v })),
      mk("Pitch", "0.6", "1.6", "0.05", () => state.pitch, (v) => tune({ pitch: v })),
      mk("Volume", "0.1", "1", "0.05", () => state.volume, (v) => tune({ volume: v })),
    ];
    const test = document.createElement("button"); test.type = "button"; test.className = "btn ghost small-btn vq-test"; test.textContent = "Hear my emotions";
    test.addEventListener("click", () => speakShaped(SAMPLES.map((s) => s[1]).join("\n\n")));
    box.append(head, eq, quick.now, ...quick.rows.map((r) => r.l), test);
    renderQuick();
  }
  function renderQuick() {
    if (!quick) return;
    quick.now.textContent = hasTTS ? describe() : "Speech is not supported in this browser";
    quick.rows.forEach((r) => { const v = r.get(); r.inp.value = String(v); r.out.textContent = Number(v).toFixed(2); });
  }
  listeners.add(renderQuick);

  if (hasTTS && typeof document !== "undefined") {
    speechSynthesis.addEventListener("voiceschanged", emit);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountUI); else mountUI();
  }

  const api = { mountQuick, resolve, shape, emotionOf, analyze, detectLang, stripTags, cloudGroups, cloud, hasVoice, previewWorld, tuning, find, set, cycle, tune, reset, list, describe, preview, speakShaped, EMOTIONS, get persona() { return PERSONA.id; }, onChange(f) { listeners.add(f); } };
  if (typeof window !== "undefined") window.AegisVoice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
