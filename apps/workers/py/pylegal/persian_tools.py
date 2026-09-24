"""Persian text utilities — Production hardened for Iranian legal platform.

Features:
- Normalization: Arabic ي/ي ك/ك folding, diacritics removal, Persian digits to English
- Tokenization: hazm/parsivar with regex fallback
- Stopwords: complete Persian stopwords list
- Stemming/Lemmatization: Persian verbs
- NER: Iranian names, cities, courts
- All stdlib-first, dependency-optional (regex fallback per task constraints)

All functions are deterministic — same input always yields same output,
required for content hashing and deduplication.
"""
from __future__ import annotations

import re
import unicodedata
from typing import List, Dict, Set, Tuple, Optional

# ---------------------------------------------------------------------------
# Normalization — Arabic to Persian + diacritics + digits
# ---------------------------------------------------------------------------

# Arabic -> Persian character folding
_AR_TO_FA = str.maketrans({
    "ي": "ی",  # Arabic Yeh -> Persian Yeh
    "ى": "ی",  # Arabic Yeh without dots
    "ك": "ک",  # Arabic Kaf -> Persian Kaf
    "ة": "ه",  # Teh Marbuta -> Heh
    "ۀ": "ه",  # Heh with hamza
    "ؤ": "و",  # Waw with hamza
    "أ": "ا",  # Alef with hamza above
    "إ": "ا",  # Alef with hamza below
    "آ": "آ",  # Keep Alef with madda (already Persian)
    "ء": "",   # Hamza standalone -> remove
    "٠": "۰", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴",
    "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹",
})

# Reverse: Persian digits to English
_FA_DIGITS_TO_EN = str.maketrans({
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
})

_EN_DIGITS_TO_FA = str.maketrans({
    "0": "۰", "1": "۱", "2": "۲", "3": "۳", "4": "۴",
    "5": "۵", "6": "۶", "7": "۷", "8": "۸", "9": "۹",
})

# Arabic diacritics (harakat) to remove
_DIACRITICS_RE = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")

# ZWNJ and ZWJ handling
_ZWNJ = "\u200c"
_WS_RE = re.compile(r"[ \t\u200c]+")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!؟?؛:])\s+")

# Persian character range
_PERSIAN_CHARS = r"\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF"

# ---------------------------------------------------------------------------
# Stopwords — complete Persian list for legal domain
# ---------------------------------------------------------------------------

PERSIAN_STOPWORDS: Set[str] = {
    # Common Persian stopwords
    "و", "در", "به", "از", "که", "این", "را", "با", "است", "برای",
    "آن", "یک", "شده", "خود", "تا", "کند", "بر", "بود", "شد", "شود",
    "هم", "نیز", "هر", "او", "ما", "شما", "آنها", "اینها", "یا",
    "اما", "اگر", "همه", "همین", "چنین", "چنان", "همان", "باید",
    "خواهد", "تواند", "دارد", "دارند", "داشت", "داشته", "خواهد",
    "کنند", "کند", "کرد", "کرده", "کنیم", "کنید", "شود", "شوند",
    "شدن", "شدن", "بودن", "هست", "هستند", "نیست", "نیستند",
    "بعد", "قبل", "زیر", "روی", "بین", "درباره", "برابر", "مقابل",
    "طبق", "براساس", "بر اساس", "جهت", "علیه", "نسبت", "طی",
    "حین", "ضمن", "عند", "نزد", "پیش", "پس", "سپس", "آن‌گاه",
    # Legal-specific stopwords (low information in legal context)
    "مورد", "موارد", "خصوص", "راجع", "مربوط", "مذکور", "فوق", "ذکر",
    "فوق‌الذکر", "مزبور", "نامبرده", "یاد", "شده", "فوق‌الاشاره",
    # Auxiliary verbs
    "است", "هست", "بود", "شد", "شدن", "کردن", "داشتن", "بودن",
    "شده", "کرده", "داشته", "خواهد", "باید", "توانستن",
}

# Extended stopwords for legal filtering
LEGAL_STOPWORDS: Set[str] = PERSIAN_STOPWORDS | {
    "قانون", "ماده", "تبصره", "بند", "اصل", "قوانین", "مقررات",
    "آیین", "نامه", "دستورالعمل",
}

# ---------------------------------------------------------------------------
# Persian verb stemming / lemmatization
# ---------------------------------------------------------------------------

# Common Persian verb suffixes
_VERB_SUFFIXES = [
    " خواهم", " خواهی", " خواهد", " خواهیم", " خواهید", " خواهند",
    " می‌شوم", " می‌شوی", " می‌شود", " می‌شویم", " می‌شوید", " می‌شوند",
    " شده‌ام", " شده‌ای", " شده", " شده‌ایم", " شده‌اید", " شده‌اند",
    " می‌کردم", " می‌کردی", " می‌کرد", " می‌کردیم", " می‌کردید", " می‌کردند",
    " می‌کنم", " می‌کنی", " می‌کند", " می‌کنیم", " می‌کنید", " می‌کنند",
    " خواهم کرد", " خواهی کرد", " خواهد کرد",
]

# Simple suffix stripping for Persian verbs
_PERSIAN_VERB_SUFFIXES = [
    " می‌کردند", " می‌کردید", " می‌کردیم", " می‌کرد", " می‌کردی", " می‌کردم",
    " می‌کنند", " می‌کنید", " می‌کنیم", " می‌کند", " می‌کنی", " می‌کنم",
    " خواهید", " خواهیم", " خواهند", " خواهم", " خواهی", " خواهد",
    " شده‌اند", " شده‌اید", " شده‌ایم", " شده‌ای", " شده‌ام", " شده",
    " می‌شوند", " می‌شوید", " می‌شویم", " می‌شود", " می‌شوی", " می‌شوم",
    "‌ام", "‌ای", "‌ایم", "‌اید", "‌اند",
    " ام", " ای", " ایم", " اید", " اند",
    " ترین", " تر",
    " ها", " های", " هایی",
    "‌ها", "‌های", "‌هایی",
    "ها", "های", "هایی",  # without ZWNJ or space
]

_PERSIAN_PREFIXES = ["می‌", "نمی‌", "ب", "ن", "می ", "نمی "]


def normalize_persian(text: str, *, to_english_digits: bool = False) -> str:
    """
    Fold Arabic variants to Persian, fix ZWNJ spacing, trim blanks.
    - ي -> ی, ك -> ک, ة -> ه, etc.
    - Remove Arabic diacritics (harakat)
    - Normalize whitespace
    - Optionally convert Persian digits to English (for NER, numbers)
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")

    # NFC normalization first
    text = unicodedata.normalize("NFC", text)

    # Remove diacritics (harakat: َ ِ ُ ً ٍ ٌ ْ ّ etc.)
    text = _DIACRITICS_RE.sub("", text)

    # Arabic -> Persian folding
    text = text.translate(_AR_TO_FA)

    # Handle newlines
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Collapse runs of spaces/tabs but keep newlines (structure matters)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(ln for ln in lines if ln != "")

    # Optionally convert Persian digits to English
    if to_english_digits:
        text = text.translate(_FA_DIGITS_TO_EN)

    return text.strip()


def persian_digits_to_english(text: str) -> str:
    """Convert Persian/Arabic digits to English digits."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    # First normalize Arabic digits to Persian, then to English
    text = text.translate(_AR_TO_FA)
    return text.translate(_FA_DIGITS_TO_EN)


def english_digits_to_persian(text: str) -> str:
    """Convert English digits to Persian digits."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    return text.translate(_EN_DIGITS_TO_FA)


def remove_diacritics(text: str) -> str:
    """Remove Arabic/Persian diacritics (harakat) from text."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    text = unicodedata.normalize("NFC", text)
    return _DIACRITICS_RE.sub("", text)


def tokenize_persian(text: str, *, remove_stopwords: bool = False) -> List[str]:
    """
    Tokenize Persian text.
    Tries hazm/parsivar if available, otherwise regex-based fallback.

    Returns list of tokens.
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")

    text = normalize_persian(text)
    if not text:
        return []

    # Try hazm if available
    try:
        from hazm import word_tokenize as hazm_tokenize
        tokens = hazm_tokenize(text)
        if remove_stopwords:
            tokens = [t for t in tokens if t not in PERSIAN_STOPWORDS]
        return tokens
    except ImportError:
        pass

    # Try parsivar if available
    try:
        from parsivar import Tokenizer as ParsivarTokenizer
        tokenizer = ParsivarTokenizer()
        tokens = tokenizer.tokenize_words(text)
        if remove_stopwords:
            tokens = [t for t in tokens if t not in PERSIAN_STOPWORDS]
        return tokens
    except ImportError:
        pass

    # Regex-based fallback (stdlib only)
    # Improved: properly separate punctuation including Persian comma ،
    # Use pattern that captures words and punctuation separately
    # Persian punctuation: ، ؛ ؟ « » 
    punctuation = r".,؛:!?()\"'«»،؟\[\]{}"
    # Pattern: match words OR single punctuation chars
    token_pattern = re.compile(
        rf"[{_PERSIAN_CHARS}a-zA-Z0-9]+|[{re.escape(punctuation)}]",
        re.UNICODE
    )
    tokens = token_pattern.findall(text)

    # Clean tokens: split any token that still has attached punctuation
    refined: List[str] = []
    for token in tokens:
        if not token.strip():
            continue
        # If token contains both word chars and punctuation, split
        # e.g., "سلام،" should be ["سلام", "،"]
        if re.search(rf"[{_PERSIAN_CHARS}a-zA-Z0-9]", token) and re.search(rf"[{re.escape(punctuation)}]", token):
            # Split by punctuation
            parts = re.split(rf"([{re.escape(punctuation)}])", token)
            for part in parts:
                part = part.strip()
                if part:
                    refined.append(part)
        else:
            refined.append(token)

    # Filter empty and whitespace
    refined = [t.strip() for t in refined if t.strip()]

    if remove_stopwords:
        refined = [t for t in refined if t not in PERSIAN_STOPWORDS]

    return refined


def get_stopwords(*, legal: bool = False) -> Set[str]:
    """Return Persian stopwords set. If legal=True, includes legal-specific stopwords."""
    return LEGAL_STOPWORDS if legal else PERSIAN_STOPWORDS.copy()


def remove_stopwords(tokens: List[str], *, legal: bool = False) -> List[str]:
    """Remove stopwords from token list."""
    stopwords = get_stopwords(legal=legal)
    return [t for t in tokens if t not in stopwords]


def stem_persian(word: str) -> str:
    """
    Simple Persian stemmer — removes common suffixes/prefixes.
    For production, hazm Stemmer is preferred if available.
    """
    if not isinstance(word, str):
        raise TypeError("word must be str")

    original = word
    word = normalize_persian(word)

    # Try hazm stemmer if available
    try:
        from hazm import Stemmer as HazmStemmer
        stemmer = HazmStemmer()
        return stemmer.stem(word)
    except ImportError:
        pass

    # Regex-based fallback stemming
    # Remove verb prefixes
    for prefix in sorted(_PERSIAN_PREFIXES, key=len, reverse=True):
        if word.startswith(prefix) and len(word) > len(prefix) + 2:
            word = word[len(prefix):]
            break

    # Remove suffixes (longest first)
    for suffix in sorted(_PERSIAN_VERB_SUFFIXES, key=len, reverse=True):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            word = word[:-len(suffix)]
            break

    # Remove plural suffixes
    if word.endswith("گان") and len(word) > 4:
        word = word[:-3]
    elif word.endswith("ان") and len(word) > 3:
        # Avoid removing from words like "ایران"
        if word not in {"ایران", "تهران", "اصفهان", "شیراز", "تبریز", "مشهد", "قران", "قرآن"}:
            word = word[:-2]

    return word if word else original


def lemmatize_persian(word: str) -> str:
    """
    Persian lemmatization — returns dictionary form.
    Uses hazm if available, otherwise stem + rules.
    """
    if not isinstance(word, str):
        raise TypeError("word must be str")

    word = normalize_persian(word)

    try:
        from hazm import Lemmatizer as HazmLemmatizer
        lemmatizer = HazmLemmatizer()
        return lemmatizer.lemmatize(word)
    except ImportError:
        pass

    # Fallback: stem + verb infinitive mapping for common verbs
    verb_map = {
        "رفت": "رفتن", "آمد": "آمدن", "گفت": "گفتن", "کرد": "کردن",
        "شد": "شدن", "بود": "بودن", "داشت": "داشتن", "خواست": "خواستن",
        "دید": "دیدن", "داد": "دادن", "گرفت": "گرفتن", "آورد": "آوردن",
        "نوشت": "نوشتن", "خواند": "خواندن", "زد": "زدن", "خورد": "خوردن",
        "برد": "بردن", "خرید": "خریدن", "فروخت": "فروختن", "ساخت": "ساختن",
        "پرداخت": "پرداختن", "دریافت": "دریافت کردن",
    }

    stemmed = stem_persian(word)
    return verb_map.get(stemmed, verb_map.get(word, stemmed))


# ---------------------------------------------------------------------------
# NER — Iranian names, cities, courts
# ---------------------------------------------------------------------------

# Iranian first names (common)
_IRANIAN_FIRST_NAMES = {
    "محمد", "علی", "حسین", "حسن", "رضا", "مهدی", "احمد", "محمود", "جواد", "اکبر",
    "اصغر", "عباس", "مصطفی", "ابراهیم", "اسماعیل", "یوسف", "عبدالله", "عبدالرحمن",
    "سید", "میر", "حاج", "کریم", "رحیم", "ناصر", "منصور", "بهروز", "فرهاد", "فرزاد",
    "امیر", "سعید", "مجید", "وحید", "حمید", "سجاد", "صادق", "باقر", "کاظم", "تقی",
    "نقی", "جواد", "رضا", "هادی", "مهدی", "قاسم", "جعفر", "محسن", "مرتضی", "مصطفی",
    "فاطمه", "زهرا", "مریم", "زینب", "خدیجه", "سارا", "نرگس", "لیلا", "مینا", "سمیه",
    "زهره", "نسرین", "پروین", "شیرین", "فرشته", "الهام", "مژگان", "مرجان", "شقایق",
    "آزاده", "نازنین", "نگار", "سحر", "سپیده", "رویا", "پریسا", "مهسا", "مهناز", "فرناز",
}

_IRANIAN_LAST_NAMES = {
    "محمدی", "حسینی", "احمدی", "کریمی", "موسوی", "جعفری", "صادقی", "رضایی", "حسنی", "قاسمی",
    "اکبری", "عباسی", "نوری", "مهدوی", "هاشمی", "علوی", "حیدری", "رحیمی", "امینی", "مرادی",
    "نظری", "کاظمی", "ابراهیمی", "مقدم", "پور", "زاده", "نژاد", "فر", "یان", "یان",
    "قلی", "خانی", "بیگی", "لو", "آبادی", "نیا", "تبار", "دوست", "خواه", "پناه",
}

_IRANIAN_CITIES = {
    "تهران", "مشهد", "اصفهان", "شیراز", "تبریز", "کرج", "قم", "اهواز", "کرمانشاه", "ارومیه",
    "رشت", "زاهدان", "همدان", "کرمان", "یزد", "اردبیل", "بندرعباس", "اراک", "اسلامشهر", "زنجان",
    "سنندج", "قزوین", "خرم‌آباد", "گرگان", "ساری", "شهریار", "قدس", "کاشان", "ملارد", "دزفول",
    "نیشابور", "بابل", "خمینی‌شهر", "سبزوار", "گلستان", "آمل", "پاکدشت", "نجف‌آباد", "بروجرد", "آبادان",
    "قرچک", "بوشهر", "ورامین", "شهرکرد", "سیرجان", "ساوه", "کازرون", "قائمشهر", "بوکان", "مهاباد",
    "سقز", "بندر ماهشهر", "رفسنجان", "گنبد کاووس", "شاهرود", "مرودشت", "کمال‌شهر", "ایلام", "مراغه", "ایرانشهر",
}

_IRANIAN_COURTS = {
    "دیوان عالی کشور", "دیوان عدالت اداری", "دادگاه انقلاب", "دادگاه کیفری",
    "دادگاه حقوقی", "دادگاه خانواده", "دادگاه تجدیدنظر", "دادگاه بدوی",
    "دادگاه عمومی", "دادگاه اختصاصی", "شورای حل اختلاف", "دادسرا",
    "دادسرای عمومی", "دادسرای انقلاب", "دادگاه نظامی", "دادگاه ویژه",
    "دادگاه اطفال", "دادگاه انتظامی", "هیات تشخیص", "هیات حل اختلاف",
    "کمیسیون ماده ۱۰۰", "کمیسیون ماده ۷۷", "کمیسیون ماده ۹۹",
}

# Patterns for NER
_COURT_PATTERN = re.compile(
    r"(دیوان\s+(?:عالی\s+کشور|عدالت\s+اداری)|"
    r"دادگاه\s+(?:انقلاب|کیفری|حقوقی|خانواده|تجدیدنظر|بدوی|عمومی|اختصاصی|نظامی|ویژه|اطفال|انتظامی)|"
    r"شورای\s+حل\s+اختلاف|دادسرا(?:ی\s+(?:عمومی|انقلاب))?|"
    r"کمیسیون\s+ماده\s+[۰-۹0-9]+|"
    r"هیات\s+(?:تشخیص|حل\s+اختلاف))",
    re.UNICODE
)

_PERSON_PATTERN = re.compile(
    r"(?:آقای|خانم|جناب|سرکار)?\s*([A-Z\u0600-\u06FF]+(?:\s+[A-Z\u0600-\u06FF]+){1,2})",
    re.UNICODE
)


def extract_cities(text: str) -> List[str]:
    """Extract Iranian city names from text."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    text = normalize_persian(text)
    found: List[str] = []
    for city in _IRANIAN_CITIES:
        if city in text:
            found.append(city)
    return sorted(list(set(found)))


def extract_courts(text: str) -> List[Dict[str, str]]:
    """Extract court mentions from text."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    text = normalize_persian(text)
    courts: List[Dict[str, str]] = []
    for m in _COURT_PATTERN.finditer(text):
        courts.append({
            "text": m.group(0),
            "type": "COURT",
            "start": m.start(),
            "end": m.end(),
        })
    return courts


def extract_persons(text: str) -> List[Dict[str, str]]:
    """Extract person names (heuristic — Iranian names)."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    text = normalize_persian(text)

    # Simple heuristic: look for known first names followed by last name patterns
    persons: List[Dict[str, str]] = []
    tokens = tokenize_persian(text)

    i = 0
    while i < len(tokens) - 1:
        token = tokens[i]
        next_token = tokens[i + 1] if i + 1 < len(tokens) else ""

        # Check if current token is a known first name
        if token in _IRANIAN_FIRST_NAMES:
            # Next token might be last name
            if next_token and (next_token in _IRANIAN_LAST_NAMES or next_token.endswith(("ی", "پور", "زاده", "نژاد", "فر", "لو"))):
                persons.append({
                    "text": f"{token} {next_token}",
                    "type": "PERSON",
                    "first_name": token,
                    "last_name": next_token,
                })
                i += 2
                continue

        # Check for "آقای/خانم + Name"
        if token in {"آقای", "خانم", "جناب", "سرکار"} and i + 1 < len(tokens):
            # Next 1-2 tokens are name
            name_parts = []
            for j in range(1, 3):
                if i + j < len(tokens) and tokens[i + j] not in {"و", "در", "به", "از", "که"}:
                    name_parts.append(tokens[i + j])
                else:
                    break
            if name_parts:
                persons.append({
                    "text": f"{token} {' '.join(name_parts)}",
                    "type": "PERSON",
                    "title": token,
                    "name": " ".join(name_parts),
                })

        i += 1

    return persons


def ner_persian(text: str) -> Dict[str, List[Dict[str, str]]]:
    """
    Full NER for Persian legal text.
    Returns dict with keys: persons, cities, courts, dates, numbers
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")

    text = normalize_persian(text)

    # Cities
    cities = [{"text": c, "type": "CITY"} for c in extract_cities(text)]

    # Courts
    courts = extract_courts(text)

    # Persons
    persons = extract_persons(text)

    # Dates (Persian date patterns: ۱۴۰۲/۰۵/۱۲ or 1402-05-12 or ۱۲ مرداد ۱۴۰۲)
    date_pattern = re.compile(
        r"([۰-۹0-9]{4}[/-][۰-۹0-9]{1,2}[/-][۰-۹0-9]{1,2}|"
        r"[۰-۹0-9]{1,2}\s+(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s+[۰-۹0-9]{4})"
    )
    dates = [
        {"text": m.group(0), "type": "DATE", "start": m.start(), "end": m.end()}
        for m in date_pattern.finditer(text)
    ]

    # Legal references
    refs = article_refs(text)

    return {
        "persons": persons,
        "cities": cities,
        "courts": courts,
        "dates": dates,
        "legal_refs": refs,
    }


# ---------------------------------------------------------------------------
# Existing functions — preserved + enhanced
# ---------------------------------------------------------------------------

def split_sentences(text: str) -> List[str]:
    """Sentence splitter that respects Persian punctuation."""
    text = normalize_persian(text)
    if not text:
        return []
    parts = _SENTENCE_SPLIT.split(text)
    return [p.strip() for p in parts if p.strip()]


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", normalize_persian(text)))


def chunk_legal_text(text: str, *, max_chars: int = 1800, overlap: int = 120) -> List[str]:
    """Chunk by sentences with a sliding overlap — chunks must never split a
    ماده mid-way if avoidable, because retrieval quotes them."""
    if max_chars <= 0 or overlap < 0 or overlap >= max_chars:
        raise ValueError("bad chunking parameters")
    sentences = split_sentences(text)
    chunks: List[str] = []
    buf: List[str] = []
    size = 0
    for s in sentences:
        if size + len(s) > max_chars and buf:
            chunks.append(" ".join(buf))
            # carry the tail sentence(s) that fit into the overlap budget
            keep: List[str] = []
            keep_size = 0
            for back in reversed(buf):
                if keep_size + len(back) > overlap:
                    break
                keep.insert(0, back)
                keep_size += len(back)
            buf = keep
            size = keep_size
        buf.append(s)
        size += len(s)
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def article_refs(text: str) -> List[Dict[str, str]]:
    """Extract references like «ماده ۱۰ قانون مدنی» / «تبصره ۲» for
    citation indexing (Phase 2+ wiring into citation_links)."""
    pattern = re.compile(r"(ماده|تبصره|بند|اصل)\s+([۰-۹0-9]+)(?:\s+(قانون\s+[^\s.،؛]+))?")
    refs = []
    for m in pattern.finditer(normalize_persian(text)):
        refs.append({
            "kind": m.group(1),
            "number": m.group(2),
            "law": (m.group(3) or "").strip(),
        })
    return refs


# ---------------------------------------------------------------------------
# Additional utilities for task compliance
# ---------------------------------------------------------------------------

def is_persian_text(text: str, threshold: float = 0.5) -> bool:
    """Check if text is predominantly Persian."""
    if not text:
        return False
    persian_count = len(re.findall(rf"[{_PERSIAN_CHARS}]", text))
    total_letters = len(re.findall(r"[A-Za-z\u0600-\u06FF]", text))
    if total_letters == 0:
        return False
    return (persian_count / total_letters) >= threshold


def clean_persian_text(text: str) -> str:
    """Full cleaning pipeline: normalize + remove diacritics + fix spaces."""
    text = normalize_persian(text)
    text = remove_diacritics(text)
    # Fix common spacing issues around ZWNJ
    text = re.sub(r"\s*‌\s*", "‌", text)  # ZWNJ should not have spaces around
    text = re.sub(r" +", " ", text)
    return text.strip()
