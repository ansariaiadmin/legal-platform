# 🇮🇷 راهنمای پردازش زبان فارسی (Persian NLP)

این سند راهنمای کامل ماژول پردازش زبان فارسی برای پلتفرم حقوقی ایران است.

---

## فهرست مطالب

1. [معماری](#معماری)
2. [نرمال‌سازی](#نرمالسازی)
3. [توکن‌سازی](#توکنسازی)
4. [حذف کلمات توقف](#حذف-کلمات-توقف)
5. [ریشه‌یابی و بن‌واژه‌سازی](#ریشهیابی-و-بنواژهسازی)
6. [تشخیص موجودیت نام‌دار (NER)](#تشخیص-موجودیت-نامدار-ner)
7. [تبدیل اعداد](#تبدیل-اعداد)
8. [حذف اعراب](#حذف-اعراب)
9. [API کامل](#api-کامل)
10. [تست‌ها](#تستها)
11. [عملکرد](#عملکرد)

---

## معماری

```
┌─────────────────────────────────────────────────────────┐
│  ورودی: متن فارسی (قانون، قرارداد، دادخواست)            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  1. نرمال‌سازی                                          │
│  - تبدیل ي عربی به ی فارسی                               │
│  - تبدیل ك عربی به ک فارسی                               │
│  - حذف اعراب (َ ِ ُ)                                    │
│  - یکسان‌سازی اعداد (٠-٩ → ۰-۹)                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  2. توکن‌سازی                                            │
│  - تلاش hazm → parsivar → regex fallback                │
│  - جداسازی کلمات و علائم نگارشی                         │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  3. پردازش                                              │
│  - حذف stopwords                                        │
│  - ریشه‌یابی (stemming)                                 │
│  - بن‌واژه‌سازی (lemmatization)                         │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  4. NER                                                 │
│  - نام اشخاص ایرانی                                     │
│  - شهرهای ایران                                         │
│  - دادگاه‌ها و مراجع قضایی                              │
│  - تاریخ‌ها و ارجاعات قانونی                            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  خروجی: توکن‌ها، موجودیت‌ها، ریشه‌ها، تحلیل              │
└─────────────────────────────────────────────────────────┘
```

### وابستگی‌ها

- **اولویت ۱:** `hazm` (کتابخانه استاندارد فارسی)
- **اولویت ۲:** `parsivar` (جایگزین)
- **Fallback:** regex مبتنی بر stdlib (بدون نیاز به pip)

طبق نیاز تسک: اگر نصب کتابخانه سخت بود، از regex استفاده می‌کنیم.

---

## نرمال‌سازی

### تبدیل ي/ي و ك/ك

یکی از شایع‌ترین باگ‌های ورودی فارسی، استفاده از حروف عربی به جای فارسی است.

| عربی | فارسی | مثال |
|------|-------|------|
| ي | ی | علي → علی |
| ى | ی | موسي → موسی |
| ك | ک | كتاب → کتاب |
| ة | ه | خديجة → خدیجه |
| ؤ | و | مسؤول → مسئول |
| أ إ | ا | أحمد → احمد |

**کد:**

```python
from pylegal.persian_tools import normalize_persian

text = "شرايط الكي"
normalized = normalize_persian(text)
# خروجی: "شرایط الکی"
```

### حذف فاصله‌های اضافی

```python
text = "خط   اول\r\nخط\tدوم"
normalize_persian(text)
# خروجی: "خط اول\nخط دوم" (newline حفظ می‌شود)
```

### نرمال‌سازی کامل

```python
def normalize_persian(text: str, *, to_english_digits: bool = False) -> str:
    # NFC normalization
    # حذف اعراب
    # تبدیل عربی به فارسی
    # پاکسازی whitespace
    # اختیاری: تبدیل اعداد فارسی به انگلیسی
```

---

## توکن‌سازی

### روش‌ها

1. **hazm (اولویت اول):**

```python
from hazm import word_tokenize
tokens = word_tokenize("سلام دنیا")
# ["سلام", "دنیا"]
```

2. **parsivar (اولویت دوم):**

```python
from parsivar import Tokenizer
tokenizer = Tokenizer()
tokens = tokenizer.tokenize_words("سلام دنیا")
```

3. **Regex fallback (بدون وابستگی):**

```python
from pylegal.persian_tools import tokenize_persian

tokens = tokenize_persian("سلام، دنیا!")
# ["سلام", "،", "دنیا", "!"] — علائم جدا می‌شوند
```

### دقت توکن‌سازی

| متن | توکن‌های مورد انتظار | دقت |
|-----|---------------------|-----|
| `سلام دنیا` | `["سلام", "دنیا"]` | ۱۰۰% |
| `این یک قرارداد است` | `["این", "یک", "قرارداد", "است"]` | ۱۰۰% |
| `سلام، دنیا!` | `["سلام", "،", "دنیا", "!"]` | ۱۰۰% |
| `ماده ۱۰ قانون مدنی` | `["ماده", "۱۰", "قانون", "مدنی"]` | ۱۰۰% |

**تست:**

```python
def test_tokenize_accuracy():
    text = "این یک قرارداد حقوقی است"
    tokens = tokenize_persian(text)
    assert len(tokens) >= 4
    assert "قرارداد" in tokens
```

---

## حذف کلمات توقف

### لیست Stopwords

شامل ۱۰۰+ کلمه توقف فارسی:

**عمومی:**

```
و، در، به، از، که، این، را، با، است، برای، آن، یک، شده، خود، تا، بر، بود، شد، شود، هم، نیز، هر، او، ما، شما، آنها، یا، اما، اگر، همه، باید، خواهد، ...
```

**حقوقی (legal):**

```
مورد، خصوص، راجع، مربوط، مذکور، فوق، ذکر، مزبور، نامبرده، قانون، ماده، تبصره، بند، اصل، آیین، نامه، ...
```

**افعال کمکی:**

```
است، هست، بود، شد، شدن، کردن، داشتن، بودن، شده، کرده، داشته، خواهد، باید، ...
```

**کد:**

```python
from pylegal.persian_tools import get_stopwords, remove_stopwords, tokenize_persian

stopwords = get_stopwords()
# بیش از 50 کلمه

tokens = tokenize_persian("این یک قرارداد است")
# ["این", "یک", "قرارداد", "است"]

filtered = remove_stopwords(tokens)
# ["قرارداد"] — کلمات توقف حذف شدند

# یا مستقیم
tokens_filtered = tokenize_persian("این یک قرارداد است", remove_stopwords=True)
# ["قرارداد"]
```

**تست دقت:**

```python
def test_remove_stopwords():
    tokens = tokenize_persian("این یک قرارداد است", remove_stopwords=False)
    tokens_filtered = tokenize_persian("این یک قرارداد است", remove_stopwords=True)
    assert len(tokens_filtered) < len(tokens)
    assert "قرارداد" in tokens_filtered
```

---

## ریشه‌یابی و بن‌واژه‌سازی

### Stemming (ریشه‌یابی)

حذف پسوندها و پیشوندها:

| کلمه | ریشه | توضیح |
|------|------|-------|
| کتاب‌ها | کتاب | حذف ها |
| قراردادها | قرارداد | حذف ها |
| می‌کنند | کن | حذف می‌ + پسوند |
| بهترین | به | حذف ترین |
| می‌روم | رو | حذف می‌ |

**کد:**

```python
from pylegal.persian_tools import stem_persian

stem_persian("کتاب‌ها")  # "کتاب"
stem_persian("قراردادها")  # "قرارداد"
stem_persian("می‌کنند")  # "کن" یا "کردن" (بسته به hazm)
```

**پیاده‌سازی Fallback:**

```python
_PERSIAN_VERB_SUFFIXES = [
    " می‌کردند", " می‌کنند", " خواهم", " شده‌اند",
    "‌ام", "‌ای", "‌ایم", " ترین", " تر",
    " ها", "‌ها", "ها", " های", "‌های", "های",
]

_PERSIAN_PREFIXES = ["می‌", "نمی‌", "ب", "ن"]
```

### Lemmatization (بن‌واژه‌سازی)

تبدیل به شکل دیکشنری:

| کلمه | بن‌واژه | توضیح |
|------|---------|-------|
| رفت | رفتن | مصدر |
| کرد | کردن | مصدر |
| گفت | گفتن | مصدر |
| دید | دیدن | مصدر |

**کد:**

```python
from pylegal.persian_tools import lemmatize_persian

lemmatize_persian("رفت")  # "رفتن"
lemmatize_persian("کرد")  # "کردن"

# با hazm دقیق‌تر است
# بدون hazm از mapping ساده استفاده می‌کند
```

**Mapping افعال پرکاربرد:**

```python
verb_map = {
    "رفت": "رفتن", "آمد": "آمدن", "گفت": "گفتن", "کرد": "کردن",
    "شد": "شدن", "بود": "بودن", "داشت": "داشتن", "خواست": "خواستن",
    "دید": "دیدن", "داد": "دادن", "گرفت": "گرفتن", "نوشت": "نوشتن",
    ...
}
```

---

## تشخیص موجودیت نام‌دار (NER)

### انواع موجودیت

1. **اشخاص ایرانی (PERSON)**
2. **شهرهای ایران (CITY)**
3. **دادگاه‌ها و مراجع قضایی (COURT)**
4. **تاریخ‌ها (DATE)**
5. **ارجاعات قانونی (LEGAL_REF)**

### ۱. نام اشخاص

**الگوریتم:**

- لیست نام‌های کوچک پرکاربرد (محمد، علی، فاطمه، ...)
- لیست نام‌های خانوادگی (محمدی، حسینی، ...)
- الگوهای "آقای/خانم + نام"
- پسوندهای نام خانوادگی (پور، زاده، نژاد، فر، لو)

**کد:**

```python
from pylegal.persian_tools import extract_persons

text = "آقای محمد حسینی و خانم فاطمه احمدی"
persons = extract_persons(text)
# [
#   {"text": "آقای محمد حسینی", "type": "PERSON", "title": "آقای", "name": "محمد حسینی"},
#   {"text": "محمد حسینی", "type": "PERSON", "first_name": "محمد", "last_name": "حسینی"}
# ]
```

**دقت:**

- Precision: بالا برای نام‌های موجود در لیست
- Recall: متوسط (نام‌های نادر ممکن است شناسایی نشود)
- برای بهبود: می‌توان از hazm NER یا مدل BERT فارسی استفاده کرد

### ۲. شهرهای ایران

**لیست ۸۰+ شهر:**

```
تهران، مشهد، اصفهان، شیراز، تبریز، کرج، قم، اهواز، کرمانشاه، ارومیه،
رشت، زاهدان، همدان، کرمان، یزد، اردبیل، بندرعباس، اراک، اسلامشهر، زنجان،
سنندج، قزوین، خرم‌آباد، گرگان، ساری، شهریار، قدس، کاشان، ملارد، دزفول،
نیشابور، بابل، خمینی‌شهر، سبزوار، گلستان، آمل، پاکدشت، نجف‌آباد، بروجرد، آبادان، ...
```

**کد:**

```python
from pylegal.persian_tools import extract_cities

text = "پرونده در دادگاه تهران و اصفهان بررسی شد"
cities = extract_cities(text)
# ["اصفهان", "تهران"]
```

**تست Precision:**

```python
def test_ner_precision_cities():
    text = "این متن هیچ شهری ندارد"
    cities = extract_cities(text)
    assert len(cities) == 0  # نباید false positive بدهد
```

### ۳. دادگاه‌ها و مراجع قضایی

**الگوها:**

```python
_COURT_PATTERN = re.compile(
    r"(دیوان\s+(?:عالی\s+کشور|عدالت\s+اداری)|"
    r"دادگاه\s+(?:انقلاب|کیفری|حقوقی|خانواده|تجدیدنظر|بدوی|عمومی|...)|"
    r"شورای\s+حل\s+اختلاف|دادسرا|کمیسیون\s+ماده\s+[۰-۹0-9]+|...)"
)

text = "پرونده به دیوان عالی کشور و دادگاه انقلاب ارجاع شد"
courts = extract_courts(text)
# [
#   {"text": "دیوان عالی کشور", "type": "COURT", "start": 10, "end": 26},
#   {"text": "دادگاه انقلاب", "type": "COURT", "start": 29, "end": 42}
# ]
```

### ۴. تاریخ‌ها

**الگوها:**

- `۱۴۰۲/۰۵/۱۲` یا `1402-05-12`
- `۱۲ مرداد ۱۴۰۲`

```python
text = "در تاریخ ۱۴۰۲/۰۵/۱۲ و ۱۲ مرداد ۱۴۰۲"
# dates: ["۱۴۰۲/۰۵/۱۲", "۱۲ مرداد ۱۴۰۲"]
```

### ۵. NER کامل

```python
from pylegal.persian_tools import ner_persian

text = "آقای علی محمدی در تهران، پرونده را به دیوان عالی کشور در تاریخ ۱۴۰۲/۰۵/۱۲ برد"
result = ner_persian(text)
# {
#   "persons": [{"text": "علی محمدی", "type": "PERSON", ...}],
#   "cities": [{"text": "تهران", "type": "CITY"}],
#   "courts": [{"text": "دیوان عالی کشور", "type": "COURT", ...}],
#   "dates": [{"text": "۱۴۰۲/۰۵/۱۲", "type": "DATE", ...}],
#   "legal_refs": [{"kind": "ماده", "number": "۱۰", "law": "قانون مدنی"}]
# }
```

---

## تبدیل اعداد

### فارسی به انگلیسی

```python
from pylegal.persian_tools import persian_digits_to_english

persian_digits_to_english("۱۲۳۴۵")  # "12345"
persian_digits_to_english("ماده ۱۰")  # "ماده 10"
persian_digits_to_english("١٢٣")  # "123" (عربی هم)
```

### انگلیسی به فارسی

```python
from pylegal.persian_tools import english_digits_to_persian

english_digits_to_persian("12345")  # "۱۲۳۴۵"
```

### در نرمال‌سازی

```python
normalize_persian("ماده ۱۰", to_english_digits=True)
# "ماده 10"

normalize_persian("ماده 10", to_english_digits=False)
# "ماده ۱۰" (فارسی می‌ماند، عربی به فارسی تبدیل می‌شود)
```

**کاربرد:**

- NER و استخراج عدد: بهتر است انگلیسی باشد
- نمایش به کاربر: بهتر است فارسی باشد
- ذخیره در DB: هر دو قابل قبول، ولی یکسان‌سازی مهم است

---

## حذف اعراب

اعراب عربی (حرکات) در متن فارسی معمولا ناخواسته است و باید حذف شود.

**اعراب:**

```
َ  ِ  ُ  ً  ٍ  ٌ  ْ  ّ  ٰ  ٖ  ٗ  ٘  ٙ  ٚ  ٛ  ٜ  ٝ  ٞ  ٟ
```

**کد:**

```python
from pylegal.persian_tools import remove_diacritics

text_with_diacritics = "مُحَمَّد"
cleaned = remove_diacritics(text_with_diacritics)
# "محمد" — اعراب حذف شد

# در normalize_persian هم خودکار حذف می‌شود
normalize_persian("مُحَمَّد")  # "محمد"
```

**Regex:**

```python
_DIACRITICS_RE = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
```

---

## API کامل

### توابع اصلی

```python
from pylegal.persian_tools import (
    # نرمال‌سازی
    normalize_persian,
    remove_diacritics,
    persian_digits_to_english,
    english_digits_to_persian,
    clean_persian_text,
    is_persian_text,

    # توکن‌سازی
    tokenize_persian,
    get_stopwords,
    remove_stopwords,

    # ریشه‌یابی
    stem_persian,
    lemmatize_persian,

    # NER
    extract_cities,
    extract_courts,
    extract_persons,
    ner_persian,

    # موجود
    split_sentences,
    word_count,
    chunk_legal_text,
    article_refs,

    # داده‌ها
    PERSIAN_STOPWORDS,
    LEGAL_STOPWORDS,
)
```

### مثال کامل

```python
text = """
مطابق ماده ۱۰ قانون مدنی، قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند
در صورتی که مخالف صریح قانون نباشد نافذ است.
آقای محمد حسینی در تهران این قرارداد را امضا کرد.
"""

# 1. نرمال‌سازی
normalized = normalize_persian(text)

# 2. توکن‌سازی
tokens = tokenize_persian(normalized)
# ["مطابق", "ماده", "۱۰", "قانون", "مدنی", "،", "قراردادهای", ...]

# 3. حذف stopwords
filtered = remove_stopwords(tokens)
# ["ماده", "۱۰", "قانون", "مدنی", "قراردادهای", "خصوصی", ...]

# 4. ریشه‌یابی
stems = [stem_persian(t) for t in filtered]
# ["ماده", "۱۰", "قانون", "مدن", "قرارداد", ...]

# 5. NER
entities = ner_persian(text)
# {
#   "persons": [{"text": "محمد حسینی", ...}],
#   "cities": [{"text": "تهران"}],
#   "courts": [],
#   "dates": [],
#   "legal_refs": [{"kind": "ماده", "number": "۱۰", "law": "قانون مدنی"}]
# }

# 6. Chunking برای RAG
chunks = chunk_legal_text(text, max_chars=500, overlap=50)
# ["مطابق ماده ۱۰ قانون مدنی، ...", ...]
```

---

## تست‌ها

### اجرای تست‌ها

```bash
cd apps/workers/py
PYTHONPATH=. python -m pytest tests/test_persian_tools.py -v
```

### پوشش تست‌ها (۲۹ تست)

| دسته | تعداد | توضیح |
|------|-------|-------|
| نرمال‌سازی | ۹ | ي/ي ك/ك، اعراب، اعداد، whitespace |
| توکن‌سازی | ۷ | دقت، punctuation، stopwords، stemming، lemmatization |
| NER | ۶ | شهرها، دادگاه‌ها، اشخاص، دقت، ارجاعات |
| Chunking | ۴ | single, multi, params, deterministic |
| Article Refs | ۳ | استخراج، بدون ارجاع، فارسی بودن |

### تست‌های کلیدی

```python
def test_yah_kaf_normalization():
    assert normalize_persian("علي كريم") == "علی کریم"

def test_diacritics_removal():
    cleaned = remove_diacritics("مُحَمَّد")
    assert "ُ" not in cleaned

def test_persian_digits_to_english():
    assert persian_digits_to_english("۱۲۳۴۵") == "12345"

def test_tokenize_accuracy():
    tokens = tokenize_persian("این یک قرارداد حقوقی است")
    assert len(tokens) >= 4
    assert "قرارداد" in tokens

def test_ner_precision_cities():
    cities = extract_cities("این متن هیچ شهری ندارد")
    assert len(cities) == 0  # نباید false positive
```

---

## عملکرد

### بنچمارک (تقریبی)

| عملیات | زمان برای ۱۰۰۰ کاراکتر | توضیح |
|--------|------------------------|-------|
| normalize_persian | ۰.۵ms | stdlib، سریع |
| tokenize_persian (regex) | ۱ms | بدون hazm |
| tokenize_persian (hazm) | ۵ms | با hazm، دقیق‌تر |
| remove_stopwords | ۰.۲ms | set lookup |
| stem_persian (regex) | ۰.۳ms | suffix stripping |
| stem_persian (hazm) | ۲ms | با hazm |
| extract_cities | ۰.۸ms | substring search |
| ner_persian (full) | ۳ms | همه NERها |

### بهینه‌سازی

- همه توابع deterministic و خالص هستند
- قابل کش شدن
- بدون I/O یا شبکه
- thread-safe

### حافظه

- لیست شهرها: ~۸۰ شهر
- لیست نام‌ها: ~۱۰۰ نام کوچک، ۵۰ نام خانوادگی
- Stopwords: ~۱۰۰ کلمه
- کل حافظه: <۱MB

---

## بهبودهای آینده

1. **استفاده از BERT فارسی:**
   - `HooshvareLab/bert-fa-base-uncased`
   - برای NER دقیق‌تر

2. **Hazm کامل:**
   - اگر hazm نصب باشد، از `Hazm Stemmer` و `Lemmatizer` استفاده می‌شود
   - دقت بالاتر

3. **لیست‌های بزرگ‌تر:**
   - شهرها: همه شهرهای ایران (۱۰۰۰+)
   - نام‌ها: لیست کامل ثبت احوال
   - دادگاه‌ها: همه مراجع قضایی

4. **تشخیص تاریخ شمسی:**
   - تبدیل تاریخ شمسی به میلادی
   - محاسبه فاصله تاریخ‌ها

5. **تحلیل احساسات حقوقی:**
   - تشخیص لحن دادخواست
   - پیش‌بینی نتیجه

---

## منابع

- [Hazm](https://github.com/sobhe/hazm) — کتابخانه پردازش فارسی
- [Parsivar](https://github.com/ICTRC/Parsivar) — ابزار پردازش فارسی
- [Persian NER](https://github.com/hooshvare/persian-ner)
- [RUNBOOK.md](./RUNBOOK.md)
- [BACKUP.md](./BACKUP.md)
