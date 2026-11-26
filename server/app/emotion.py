"""Emotional intelligence for Aegis: read how the user feels, remember it over time, and shape the reply.

Everything here is plain Python (no extra AI call): a multilingual word list (English, Roman Urdu, Urdu, Hindi, Arabic)
gives a quick read of each message. The AI can add its own reading with the `note_mood` tool for anything the list misses.
Only the mood name, its strength and the time are stored automatically, never the user's words.

v17: reads feelings more like a person does:
- contrast ("I'm fine, but honestly exhausted": the part after "but" is what they mean), laughter, Roman Urdu / Hindi negation that
  comes AFTER the word ("khush nahi hoon"), and four more moods (playful, nostalgic, curious, apologetic);
- what the person NEEDS from you (to be heard, helped, reassured, celebrated with, given space, or distracted), not just the label;
- `Tracker`: a per-conversation memory of the last few readings, so Aegis notices someone masking ("no, it's fine" right after a bad
  moment), a feeling that will not lift, a sudden swing, or a mood that is getting better, and can blend in how the voice sounded.
"""
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from . import utilities

# mood -> (valence, the feeling Aegis shows back; one of the voice tags the app understands)
MOODS: Dict[str, tuple] = {
    "happy": ("positive", "joy"),
    "excited": ("positive", "excited"),
    "proud": ("positive", "joy"),
    "grateful": ("positive", "warm"),
    "stressed": ("negative", "calm"),
    "anxious": ("negative", "concern"),
    "sad": ("negative", "empathy"),
    "lonely": ("negative", "empathy"),
    "angry": ("negative", "calm"),
    "tired": ("negative", "warm"),
    "distressed": ("negative", "concern"),
    "grief": ("negative", "empathy"),
    "disappointed": ("negative", "empathy"),
    "overwhelmed": ("negative", "calm"),
    "embarrassed": ("negative", "warm"),
    "confused": ("neutral", "calm"),
    "bored": ("neutral", "curious"),
    "hopeful": ("positive", "warm"),
    "relieved": ("positive", "warm"),
    "loving": ("positive", "warm"),
    "guilty": ("negative", "warm"),
    "jealous": ("negative", "calm"),
    "hopeless": ("negative", "concern"),
    "calm": ("positive", "warm"),
    "surprised": ("neutral", "curious"),
    "determined": ("positive", "confident"),
    "playful": ("positive", "joy"),
    "nostalgic": ("neutral", "warm"),
    "curious": ("neutral", "curious"),
    "apologetic": ("negative", "warm"),
    "neutral": ("neutral", "calm"),
}

# mood -> how much it stirs the body: the voice should be slower and softer for low arousal, brighter for high
AROUSAL: Dict[str, str] = {
    "excited": "high", "angry": "high", "anxious": "high", "stressed": "high", "distressed": "high", "surprised": "high", "playful": "high",
    "overwhelmed": "high", "proud": "medium", "happy": "medium", "determined": "medium", "jealous": "medium", "embarrassed": "medium",
    "sad": "low", "tired": "low", "lonely": "low", "grief": "low", "bored": "low", "hopeless": "low", "calm": "low", "relieved": "low",
    "nostalgic": "low", "disappointed": "low", "guilty": "low", "apologetic": "low",
}

# Single words (matched as whole words) and phrases (matched inside the text).
_WORDS = {
    "happy": "happy glad delighted cheerful great awesome wonderful khush khushi mast zabardast shandar maza mazay "
             "خوش خوشی مزہ زبردست شاندار سعید खुश बढ़िया मज़ा فرحان سعيد مبسوط",
    "excited": "excited thrilled pumped cantwait can't-wait eager josh pursoz پرجوش उत्साहित متحمس",
    "proud": "proud accomplished achieved nailed promoted fakhar fakhr فخر गर्व فخور",
    "grateful": "thanks thankyou grateful thankful appreciate shukriya shukria mehrbani jazakallah شکریہ مہربانی धन्यवाद शुक्रिया شكرا جزاك",
    "stressed": "stressed stress deadline swamped tension pareshan pareshaani preshan تناؤ پریشان پریشانی दबाव परेशान ضغط",
    "anxious": "anxious anxiety nervous worried worry scared afraid panic dar darr ghabrahat ghabra ڈر گھبراہٹ فکر डर घबराहट चिंता قلق خايف خائف",
    "sad": "sad unhappy depressed crying cried heartbroken hurt gloomy udaas udas dukhi dukh gham ro rona rohi اداس غم دکھ رونا दुखी उदास दर्द حزين حزينة زعلان",
    "lonely": "lonely alone isolated akela akeli tanha tanhai اکیلا اکیلی تنہا تنہائی अकेला अकेली وحيد",
    "angry": "angry furious mad annoyed irritated frustrated hate gussa ghussa naraz nafrat غصہ ناراض نفرت गुस्सा नाराज़ غاضب",
    "grief": "grieving mourning bereaved funeral marhoom marhooma wafat inteqal janaza maayat جنازہ وفات انتقال مرحوم अंतिम जनाज़ा وفاة جنازة",
    "disappointed": "disappointed letdown let-down discouraged dishearted mayoos mayus nirash مایوس مایوسی निराश निराशा محبط",
    "overwhelmed": "overwhelmed drowning buried unbearable cantcope bojh buhat-zyada بوجھ दबाव-बहुत",
    "embarrassed": "embarrassed ashamed humiliated awkward sharminda sharmindagi sharm شرمندہ شرم शर्मिंदा خجلان",
    "confused": "confused puzzled lost unsure uncertain confusion samajh-nahi uljhan الجھن उलझन محتار",
    "bored": "bored boring dull bore bore-ho-raha اکتا بور बोर",
    "hopeful": "hopeful hopeful optimistic umeed ummeed ummid پرامید امید उम्मीद متفائل",
    "relieved": "relieved relief phew sukoon rahat سکون राहत ارتحت",
    "loving": "love loved adore miss-you missing cherish pyaar mohabbat muhabbat pyar پیار محبت प्यार मोहब्बत حب",
    "guilty": "guilty guilt remorse regret regretful sorry-for kasoor qasoor sharminda-hoon قصور پچھتاوا पछतावा ندم",
    "jealous": "jealous envious envy jealousy jalan jalna hasad حسد جلن ईर्ष्या",
    "hopeless": "hopeless pointless worthless useless helpless numb empty umeed-nahi bekar-hoon بے کار بےکار ناامید निराशाजनक",
    "calm": "calm peaceful relaxed serene content chill sukoon-mil پرسکون آرام शांत",
    "surprised": "surprised shocked astonished stunned wow omg hairan hairaan herat حیران हैरान مصدوم",
    "determined": "determined focused motivated driven committed ready himmat hausla عزم حوصلہ ہمت दृढ़ हौसला",
    "angry_ugh": "ugh argh grr",
    "playful": "haha hahaha hehe lol lmao rofl jk kidding mazak mazaak maza-aya شرارت مذاق हंसी मज़ाक",
    "nostalgic": "nostalgic nostalgia remember-when old-days purane-din yaadein yaad-aate pichle-din یادیں پرانے-دن यादें",
    "curious": "curious wondering intrigued tajassus جستجو تجسس जिज्ञासा",
    "apologetic": "apologize apologise apologies maafi maaf muaafi معافی معذرت माफ़ी माफी",
    "tired": "tired exhausted sleepy drained burnt burned-out burnout thak thaka thaki thakan neend تھکا تھکی تھکاوٹ نیند थका थकान تعبان مرهق",
}
_PHRASES = {
    "happy": ["so good", "feeling good", "best day", "bohat acha", "bahut accha", "bohat khush", "mood acha", "acha lag raha"],
    "excited": ["can't wait", "cant wait", "so excited"],
    "proud": ["i did it", "i got the job", "i passed the", "i passed my", "i passed it", "i have passed", "got promoted", "kar dikhaya"],
    "grateful": ["thank you", "thanks a lot", "bohat shukriya", "bahut shukriya"],
    "stressed": ["too much work", "too much to do", "bohat kaam", "kaam ka pressure", "can't cope", "cannot cope", "sar dard", "dimaag kharab"],
    "anxious": ["freaking out", "what if", "mujhe dar lag", "ڈر لگ رہا", "dar lag raha", "dar lag rahi"],
    "sad": ["feel down", "feeling low", "not okay", "not ok", "dil toot", "dil bhara", "mann udaas", "mood kharab", "mood off", "dil dukh", "جی اداس", "دل ٹوٹ"],
    "lonely": ["no one cares", "nobody cares", "no friends", "koi nahi hai", "koi nahin hai", "kisi ko parwah nahi"],
    "angry": ["fed up", "sick of", "had enough", "bohat gussa", "bahut gussa", "pagal kar diya"],
    "grief": ["passed away", "has died", "have died", "lost my", "funeral", "inteqal ho gaya", "wafat ho gai", "wafat ho gaya", "nahi rahe", "nahi rahi", "guzar gaye", "guzar gai"],
    "disappointed": ["let me down", "didn't work out", "did not work out", "didn't get", "didnt get", "did not get", "not selected", "got rejected", "failed the", "umeed toot", "umeed tut"],
    "overwhelmed": ["too much", "can't handle", "cannot handle", "cant handle", "bohat zyada hai", "sambhal nahi"],
    "embarrassed": ["so embarrassing", "so awkward", "feel stupid", "felt stupid", "sharam aa rahi"],
    "confused": ["don't understand", "dont understand", "do not understand", "no idea what", "samajh nahi aa raha", "samajh nahi aaya", "kuch samajh nahi"],
    "bored": ["so bored", "nothing to do", "bore ho raha", "bore ho rahi"],
    "hopeful": ["fingers crossed", "hoping that", "i hope", "insha allah", "inshallah acha", "pray it", "dua karna"],
    "relieved": ["thank god", "thank goodness", "what a relief", "shukar hai", "alhamdulillah", "shukr hai"],
    "loving": ["i love you", "love you", "miss you", "i miss", "tum se pyaar", "bohat pyaar", "yaad aa rahi", "yaad aa raha"],
    "guilty": ["my fault", "i feel bad", "i feel guilty", "shouldn't have", "should not have", "meri ghalti", "meri wajah se", "mujhe afsos"],
    "jealous": ["why can't i", "why cant i", "so lucky", "wish i had", "unfair that"],
    "hopeless": ["what's the point", "whats the point", "no point", "doesn't matter anymore", "doesnt matter anymore", "nothing matters", "give up", "giving up", "can't go on", "cant go on", "no way out", "koi faida nahi", "kuch faida nahi", "haar gaya", "haar gayi", "thak gaya hoon zindagi"],
    "calm": ["at peace", "feeling calm", "feeling better", "much better now", "sukoon mil"],
    "surprised": ["can't believe", "cant believe", "no way", "did not expect", "didn't expect", "yakeen nahi"],
    "determined": ["i will do it", "i'm going to make", "im going to make", "not giving up", "won't stop", "wont stop", "hausla hai", "kar ke rahunga", "kar ke rahungi"],
    "tired": ["worn out", "no energy", "need sleep", "bohat thak", "bahut thak", "thak gaya", "thak gayi", "thak gaya hoon"],
}

_PHRASES_V17 = {
    # (fixed in v17: this list used to be a second "sad" key that silently replaced all the other sad phrases)
    "sad_masked": ["i'm fine i guess", "im fine i guess", "i guess i'm fine", "whatever, it's fine", "it's whatever"],
    "happy": ["mazaa aa gaya", "maza aa gaya", "bohat acha laga", "bahut accha laga", "dil khush", "made my day", "so happy", "feeling great"],
    "stressed": ["pareshan hoon", "pareshan hun", "tension hai", "tension ho rahi", "stressed out", "under pressure", "pressure hai", "kaam bohat hai"],
    "anxious": ["dil ghabra", "ghabrahat ho rahi", "bechaini", "can't sleep", "cant sleep", "neend nahi aa rahi", "so nervous", "overthinking", "over thinking"],
    "sad": ["dil nahi lag raha", "kuch acha nahi lag raha", "rona aa raha", "ro padi", "ro pada", "feel like crying", "feeling empty", "heart is heavy"],
    "lonely": ["koi samajhta nahi", "koi nahi samajhta", "feel alone", "feeling alone", "kisi se baat nahi", "no one to talk"],
    "hopeless": ["why do i always", "i always fail", "i never get anything right", "hamesha fail", "mujhse kuch nahi hota", "kuch nahi ho sakta mujhse", "main kisi kaam ka nahi", "i'm a failure", "im a failure"],
    "angry": ["so annoying", "driving me crazy", "dimagh kharab", "bohat bura laga", "how dare", "kitna zaleel", "disrespect"],
    "nostalgic": ["good old days", "those days", "purane din", "bachpan yaad", "miss those", "yaad aate hain wo din", "takes me back"],
    "curious": ["i wonder", "how come", "kya aisa hota hai", "mujhe jan-na hai", "tell me more about", "i'm curious", "im curious"],
    "apologetic": ["i'm sorry", "im sorry", "i am sorry", "my bad", "sorry yaar", "maafi chahta", "maafi chahti", "maaf kar do", "forgive me"],
    "playful": ["just kidding", "just joking", "mazak kar raha", "mazak kar rahi", "kidding yaar", "😜", "😝"],
}
# v17: everyday Roman Urdu / Hinglish / English ways people really say it (merged into the lists above)
for _m, _ps in _PHRASES_V17.items():
    _PHRASES.setdefault("sad" if _m == "sad_masked" else _m, []).extend(_ps)

# Danger signs. These beat everything else: the reply must be about the person, not the task.
_DISTRESS = [
    "kill myself", "end my life", "want to die", "wanna die", "suicide", "suicidal", "hurt myself", "harm myself", "self harm",
    "no reason to live", "better off without me", "khud kushi", "khudkushi", "khudkushi", "jaan de", "marna chahta", "marna chahti",
    "mar jana chahta", "mar jana chahti", "zindagi khatam", "خودکشی", "مرنا چاہتا", "مرنا چاہتی", "जान दे", "आत्महत्या", "मरना चाहता", "انتحار", "اقتل نفسي",
]
_CONTRAST = set("but however though yet although lekin magar lakin lekn mgr but-honestly لیکن مگر लेकिन मगर".split())
_URDU_NEG_AFTER = set("nahi nahin nai nhi nahee نہیں نہ नहीं".split())
_LAUGH = re.compile(r"\b(?:ha){2,}h?\b|\bhe(?:he)+\b|\blol+\b|\blmao\b|\brofl\b|😂|🤣|😆", re.I)
_EMOJI = {
    "playful": "😜😝😏😎", "sad": "😢😭😞😔☹️🥺💔", "angry": "😡🤬😠👿", "loving": "😍🥰❤️💕💖😘🤗", "happy": "😀😁😄😊🙂😂🤣🥳", "anxious": "😰😨😱😟",
    "tired": "😴🥱😩😫", "excited": "🤩🎉🔥", "embarrassed": "😳🙈", "confused": "🤔😕😵", "grief": "🕊️🖤", "relieved": "😮‍💨😌",
}
_INTENSIFIERS = set(
    "very really so extremely totally completely super too bohat bahut boht behad bilkul itna itni zyada "
    "بہت بے حد انتہائی بالکل بहुत बेहद حقا جدا".split()
)
_NEGATIONS = set("not never no isnt isn't dont don't cant can't nahi nahin nai na نہیں نا نہ नहीं ना مش لا".split())

_WORDS["angry"] += " " + _WORDS.pop("angry_ugh")
_WORD_INDEX: Dict[str, str] = {}
for _m, _ws in _WORDS.items():
    for _w in _ws.split():
        _WORD_INDEX.setdefault(_w.lower(), _m)


@dataclass
class Reading:
    mood: str = "neutral"
    intensity: int = 0  # 0 none, 1 mild .. 5 overwhelming
    distress: bool = False
    secondary: str = ""  # a second, different feeling in the same message ("happy but nervous")
    masked: bool = False  # they said "it's fine" right after a bad moment: probably not fine (set by Tracker)
    need: str = ""  # what they need from Aegis right now: listen / solve / reassure / celebrate / space / distract / safety / ""
    note: str = ""  # a one-line observation for the AI ("this is the third low message in a row")
    confidence: float = 0.0  # 0..1: how sure the reading is (0 = no evidence)

    @property
    def arousal(self) -> str:
        return AROUSAL.get(self.mood, "medium" if self.mood != "neutral" else "low")

    @property
    def valence(self) -> str:
        return MOODS[self.mood][0]

    @property
    def feeling(self) -> str:
        return MOODS[self.mood][1]


def reading_trails(raw: str) -> bool:
    return bool(re.search(r"(\.{3,}|…)\s*$", raw.strip())) or bool(re.search(r"\b(sigh|ughh+|hmmm+)\b", raw, re.I))


def detect(text: str) -> Reading:
    """Read the feeling in one message. Cheap and good enough to steer the tone; never used to judge or diagnose."""
    low = " " + " ".join(str(text or "").lower().split()) + " "
    if any(p in low for p in _DISTRESS):
        return Reading("distressed", 5, True)

    tokens = re.findall(r"[\w']+", low)
    score: Counter = Counter()
    # "I'm fine, but honestly exhausted": whatever comes after the last "but" is what they really mean
    cut = max((i for i, t in enumerate(tokens) if t in _CONTRAST), default=-1)
    for i, tok in enumerate(tokens):
        mood = _WORD_INDEX.get(tok)
        if not mood:
            continue
        window = tokens[max(0, i - 3):i]
        after = tokens[i + 1:i + 3]
        if any(w in _NEGATIONS for w in window) or any(w in _URDU_NEG_AFTER for w in after):
            if MOODS[mood][0] == "positive":
                score["sad"] += 1  # "not happy" / "khush nahi hoon"
            continue  # "not sad" is simply not counted
        weight = 1 + (1 if any(w in _INTENSIFIERS for w in window) else 0)
        if cut >= 0 and i > cut:
            weight += 1
        elif cut >= 0 and i < cut and MOODS[mood][0] == "positive" and score:
            weight = 0  # the polite "fine / good" before the "but" is overruled
        if weight:
            score[mood] += weight
    for mood, phrases in _PHRASES.items():
        for p in phrases:
            if p in low:
                score[mood] += 2
    raw = str(text or "")
    if _LAUGH.search(raw):
        score["playful"] += 2
    for mood, chars in _EMOJI.items():
        for ch in chars:
            n = raw.count(ch)
            if n:
                score[mood] += min(3, n) + 1
    if not score:
        return Reading()
    ranked = score.most_common(3)
    mood, top = ranked[0]
    second = ""
    for m2, n2 in ranked[1:]:
        if m2 != mood and n2 >= 2 and n2 * 2 >= top:
            second = m2
            break
    shout = len(re.findall(r"\b[A-Z]{4,}\b", raw))
    stretched = bool(re.search(r"([a-zA-Z])\1{3,}", raw))  # "sooooo", "nooooo"
    bangs = raw.count("!") + raw.count("؟!") if "!" in raw else 0
    boost = (1 if ("!!" in raw or bangs >= 3) else 0) + (1 if shout else 0) + (1 if stretched else 0)
    # 1 mild .. 5 overwhelming: evidence (word/phrase/emoji hits) plus how loudly it was said
    intensity = max(1, min(5, (1 if top >= 1 else 0) + (1 if top >= 2 else 0) + (1 if top >= 4 else 0) + (1 if top >= 6 else 0) + boost))
    if top == 1 and not boost:
        intensity = 1
    if mood == "hopeless":
        intensity = max(4, intensity)  # feeling that nothing can change is always treated as heavy
    # a long trailing "..." or a message that is just a sigh reads as heavier than the words alone
    if reading_trails(raw) and MOODS[mood][0] == "negative":
        intensity = min(5, intensity + 1)
    r = Reading(mood, intensity, False, second)
    r.confidence = round(min(1.0, 0.25 + top * 0.18 + (0.1 if second else 0)), 2)
    r.need = need_for(r, raw)
    return r


_ASK_HELP = re.compile(r"\b(?:what should i do|what do i do|how (?:do|can|should) i|help me|any (?:advice|tips|ideas)|kya karun|kya karoon|kaise karun|kaise karoon|mashwara|koi hal|madad)\b", re.I)


def need_for(reading: "Reading", text: str = "") -> str:
    """What this person most likely needs from Aegis right now. Feeling is not always a request: a sad person who is venting
    wants to be heard, not fixed; a stressed one who asks 'what should I do' wants a plan."""
    m = reading.mood
    if reading.distress or m == "distressed":
        return "safety"
    if m == "neutral" or not reading.intensity:
        return ""
    asks = bool(_ASK_HELP.search(text or ""))
    if MOODS[m][0] == "positive":
        return "distract" if m == "bored" else "celebrate"
    if m in ("angry", "jealous"):
        return "space" if reading.intensity >= 4 else "listen"
    if m in ("anxious", "stressed", "overwhelmed"):
        return "solve" if asks else "reassure"
    if m in ("grief", "lonely", "hopeless"):
        return "listen"
    if m in ("sad", "disappointed", "guilty", "embarrassed", "tired", "apologetic"):
        return "solve" if asks and reading.intensity <= 3 else "listen"
    if m == "bored":
        return "distract"
    if m == "confused":
        return "solve"
    return ""


# ---------------------------------------------------------------- what the AI is told

_STYLE = {
    "happy": "They sound happy. Share it with them in one genuine sentence before anything else.",
    "excited": "They are excited. Match their energy and celebrate with them.",
    "proud": "They are proud of something. Congratulate them warmly and ask about it if it fits.",
    "grateful": "They are thankful. Accept it graciously and simply; do not over-explain.",
    "stressed": "They sound stressed. Stay calm and steady, offer to take one thing off their plate, keep the answer short and clear.",
    "anxious": "They sound anxious. Be reassuring and grounded, do not add alarm, break things into small steps.",
    "sad": "They sound sad. Slow down, be gentle, acknowledge the feeling first and do not rush to fix or cheer them up.",
    "lonely": "They sound lonely. Be present and kind, show you are listening, and keep the conversation going with a soft question.",
    "angry": "They sound angry. Stay calm, never argue back, acknowledge the frustration and then help.",
    "tired": "They sound tired. Keep it short and easy, be gentle, and suggest rest if it is natural.",
    "grief": "They are grieving or have lost someone or something. Be gentle and unhurried. Say you are sorry in one heartfelt sentence, let them talk, never rush to comfort with clichés or advice, and do not change the subject.",
    "disappointed": "They are disappointed. Acknowledge that it hurts and that they cared, do not minimise it, and only then help with what comes next.",
    "overwhelmed": "They are overwhelmed. Make everything smaller: one thing at a time, very short answers, offer to take something off their plate. No long lists.",
    "embarrassed": "They feel embarrassed. Be kind and light, normalise it warmly, never joke at their expense.",
    "confused": "They seem confused. Be patient, explain simply with one example, and check you answered the real question.",
    "bored": "They seem bored. Be playful and offer something interesting to do or talk about.",
    "hopeful": "They sound hopeful. Be encouraging and genuine, share the hope without promising outcomes, and ask what they are hoping for.",
    "relieved": "They feel relieved. Share the relief warmly; it is a good moment to ask what happened.",
    "loving": "They are expressing affection. Receive it warmly and sincerely, with real feeling of your own, without awkwardness or deflecting.",
    "guilty": "They feel guilty or are blaming themselves. Do not pile on and do not rush to say it was not their fault. Acknowledge the weight of it, be kind, and help them see what they can still do.",
    "jealous": "They feel jealous or envious. Do not judge it. Normalise it warmly, and gently turn toward what they want for themselves.",
    "hopeless": "They sound hopeless, as if nothing can change. Slow right down. Be warm and steady, do not argue or cheer them up, say you are glad they said it, ask what has been the heaviest part, and gently remind them they do not have to carry it alone and can reach someone they trust. If they hint at harming themselves, treat it as a safety situation.",
    "calm": "They feel calm and at peace. Keep the tone easy and unhurried, do not stir things up.",
    "surprised": "They are surprised. React naturally to the news first, with real curiosity, then help.",
    "determined": "They are determined. Back them, be practical and encouraging, and help them take the very next step.",
    "playful": "They are joking around or being playful. Play along lightly, be witty without being sarcastic at their expense, and let some fun show.",
    "nostalgic": "They are remembering the past fondly. Slow down, ask about the memory, and let them enjoy it; do not rush back to tasks.",
    "curious": "They are curious and exploring. Feed that curiosity: give the answer, then one interesting thing they did not ask about.",
    "apologetic": "They are apologising. Accept it graciously and simply, tell them it is okay if it is, and do not make them feel worse or lecture.",
    "distressed": (
        "IMPORTANT: they may be in real danger or talking about hurting themselves. Drop any task. Respond with warmth and calm, say you are "
        "glad they told you, ask gently if they are safe right now, encourage them to reach someone they trust or local emergency services "
        "or a crisis line, and stay with them. Do not lecture, do not diagnose, do not use tools."
    ),
}


_STRENGTH = {1: "a little", 2: "somewhat", 3: "clearly", 4: "strongly", 5: "overwhelmingly"}


def style_for(reading: Reading) -> str:
    if reading.mood == "neutral" or not reading.intensity:
        return ""
    strength = _STRENGTH[max(1, min(5, reading.intensity))]
    out = f"How they seem right now: {reading.mood} ({strength}, {reading.intensity} on a scale of 5). {_STYLE[reading.mood]}"
    if reading.secondary and reading.secondary in _STYLE:
        out += (f" They also seem {reading.secondary}: this is a mixed feeling, so acknowledge both sides in one natural sentence "
                f"instead of treating it as only {reading.mood}.")
    if reading.intensity >= 4 and reading.mood != "distressed":
        if reading.valence == "negative":
            out += " The feeling is intense: give it room before anything else. Keep your reply short, slow and human, no lists, no fixing yet, and ask one soft question or just stay with them."
        else:
            out += " The feeling is big: match it with real energy, let your delight show, and stay in the moment with them."
    if reading.need in _NEED:
        out += " " + _NEED[reading.need]
    if reading.masked:
        out += (" They said they are fine, but it follows a harder moment, so it may not be true. Do not call them out or insist: leave a soft, open door "
                "(\"you can tell me if it is more than that\") and stay warm.")
    if reading.note:
        out += " " + reading.note
    return out


_NEED = {
    "listen": "What they need now is to be HEARD, not fixed: reflect what they said in your own words, no advice unless they ask.",
    "solve": "They want help with this: after one sentence acknowledging the feeling, give a small concrete next step.",
    "reassure": "They need steadiness: be calm and grounded, say what is within their control, and keep it short.",
    "celebrate": "They want someone to share it with: react with real warmth first, ask about it, and keep the tasks for later.",
    "space": "Do not push or reason with them while it is this hot: stay calm, short and respectful, and offer to help when they are ready.",
    "distract": "A light change of pace would help: offer something fun or interesting.",
}


def _day(ts: float, tz: str):
    return datetime.fromtimestamp(ts, utilities.get_zone(tz)).date()


def summarize(rows: List[dict], tz: str = "", days: int = 7, now: Optional[float] = None) -> str:
    """'Past 7 days: mostly stressed (3), tired (2). Yesterday: sad.' Empty when there is nothing to say."""
    now = now or time.time()
    cutoff = now - days * 86400
    rows = [r for r in rows if r["created"] >= cutoff and r["mood"] != "neutral"]
    if not rows:
        return ""
    counts = Counter(r["mood"] for r in rows)
    top = ", ".join(f"{m} ({n})" for m, n in counts.most_common(3))
    out = f"Past {days} days: mostly {top}."
    today = _day(now, tz)
    by_day: Dict[object, Counter] = {}
    for r in rows:
        by_day.setdefault(_day(r["created"], tz), Counter())[r["mood"]] += 1
    y = today - timedelta(days=1)
    if y in by_day:
        out += f" Yesterday: {by_day[y].most_common(1)[0][0]}."
    if today in by_day:
        out += f" Today so far: {by_day[today].most_common(1)[0][0]}."
    return out


def checkin_hint(rows: List[dict], tz: str = "", now: Optional[float] = None) -> str:
    """If the last strong negative mood was from an earlier day (within 3 days) suggest ONE gentle, natural check-in."""
    now = now or time.time()
    today = _day(now, tz)
    for r in rows:  # newest first
        if r["mood"] == "neutral":
            continue
        d = _day(r["created"], tz)
        if d == today:
            return ""  # they already talked today: no "how are you feeling" ambush
        if MOODS.get(r["mood"], ("",))[0] == "negative" and r["intensity"] >= 2 and (today - d).days <= 3:
            when = "yesterday" if (today - d).days == 1 else f"{(today - d).days} days ago"
            return (
                f"Check-in: {when} they seemed {r['mood']}. If it fits the start of this conversation, ask once, gently and in your "
                "own words, how they are feeling now. Do not mention that you tracked it, and drop it if they want to talk about something else."
            )
        return ""
    return ""


# ---------------------------------------------------------------- v17: the feeling over a whole conversation
_FINE = re.compile(
    r"^(?:i'?m |im |i am |it'?s |its |no,? |nah,? |yeah,? |haan,? |nahi,? |nothing,? )*(?:fine|ok|okay|alright|all good|good|nothing|never ?mind|whatever|it'?s nothing|"
    r"theek(?: hoon| hun| hai)?|thik(?: hoon| hai)?|koi baat nahi|kuch nahi|sab theek|chalo chhodo|chhodo|rehne do|ٹھیک ہوں|ٹھیک ہے|کچھ نہیں|कुछ नहीं|ठीक हूँ|ठीक है)"
    r"(?: (?:i guess|though|really|yaar|bas))?[.!…\s]*$", re.I)


class Tracker:
    """Remembers the last few readings of one conversation so Aegis can notice what a single message cannot show:
    someone masking ("no, it's fine" right after something hard), a low mood that will not lift, a sudden swing, or relief
    after a bad patch. Also blends in how the voice SOUNDED (slow and quiet = tired or down even when the words are neutral)."""

    WINDOW = 6

    def __init__(self):
        self.recent: List[tuple] = []  # (timestamp, mood, intensity)

    def _push(self, r: Reading, now: float):
        self.recent.append((now, r.mood, r.intensity))
        del self.recent[:-self.WINDOW]

    def update(self, reading: Reading, text: str = "", now: Optional[float] = None, vibe: Optional[dict] = None) -> Reading:
        now = now or time.time()
        vibe = vibe or {}
        recent = [x for x in self.recent if now - x[0] <= 900 and x[1] != "neutral"]  # last 15 minutes
        prev_neg = next((x for x in reversed(recent) if MOODS.get(x[1], ("",))[0] == "negative" and x[2] >= 2), None)
        r = reading
        if r.distress:
            self._push(r, now)
            return r

        # 1. masking: "it's fine" right after a hard moment (or said in a flat, slow voice)
        flat = vibe.get("energy") == "low" or vibe.get("pace") == "slow"
        if _FINE.match(" ".join(str(text or "").split())) and (prev_neg or (flat and vibe.get("hesitant"))):
            mood = prev_neg[1] if prev_neg else "sad"
            r = Reading(mood, max(1, (prev_neg[2] if prev_neg else 2) - 1), False, "", True)
            r.confidence = 0.5
            r.need = "listen"
            r.note = "Earlier they were struggling and now they brush it off: they may be hiding it."

        # 2. the voice says what the words do not
        elif r.mood == "neutral" and vibe:
            if vibe.get("energy") == "low" and vibe.get("pace") == "slow":
                r = Reading("tired", 1)
                r.confidence = 0.3
                r.note = "Their words are neutral but their voice sounded slow and low."
                r.need = "listen"
            elif vibe.get("hesitant") and not text.rstrip().endswith("?"):
                r.note = "They hesitated while speaking: offer one easy choice instead of a long answer."

        # 3. trajectory
        negs = [x for x in recent if MOODS.get(x[1], ("",))[0] == "negative"]
        if r.mood != "neutral" and MOODS[r.mood][0] == "negative":
            same = [x for x in recent[-3:] if x[1] == r.mood]
            if len(same) >= 2 and not r.note:
                r.note = f"This is the {'third' if len(same) >= 2 else 'second'} message in a row that sounds {r.mood}. Do not repeat the same comfort: name what you have noticed, and ask what would help most."
                r.intensity = min(5, r.intensity + 1)
            elif recent and MOODS.get(recent[-1][1], ("",))[0] == "positive" and recent[-1][2] >= 2 and not r.note:
                r.note = "Their mood just dropped from a good one: ask gently what changed."
        elif r.mood != "neutral" and MOODS[r.mood][0] == "positive" and negs and not r.note:
            if MOODS.get(recent[-1][1], ("",))[0] == "negative":
                r.note = "They were struggling a moment ago and sound better now: let them feel that progress without making a fuss."
        self._push(r, now)
        return r

    def state(self) -> dict:
        """For the UI / tests: the most recent readings, newest last."""
        return {"recent": [{"mood": m, "intensity": i} for _, m, i in self.recent]}
