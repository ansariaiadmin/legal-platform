# AGENT FLEET — ناوگان ایجنت‌ها، نقش‌ها و کانفیگ‌های پیشنهادی

The Leader-led fleet (SPEC §11a). Each row = one deployable agent under
`apps/agents/{branch}` with its own `capabilities.ts`. **You buy per capability,
you configure everything, and the Leader—governed by grants—runs the show.**

## نقشه ناوگان (کدام ایجنت چه نقشی)

| ایجنت | نقش | رئیس | نوع | اسکیل‌های کلیدی (capabilities.ts) |
|---|---|---|---|---|
| `orchestrator` (**The Leader**) | تشخیص قصد، مسیریابی، صدور/ابطال grant، پاسخ صوتی به مدیر | مدیر دفتر (LAWYER_OWNER) | leader (داخل api) | intent:classify، route:tree، grant:issue، voice:session |
| `legal-expert-base` ✅ | اسکلت مرجع — جایگزین نمی‌شود، الگوست | Leader | expert | base:civil-qa، base:criminal-qa، base:family-qa |
| `civil-expert` ✅ | امور مدنی؛ قرارداد، مالکیت، مسئولیت مدنی، ارث | Leader | expert | civil:contracts، civil:property، civil:tort، civil:inheritance — «کارشناس ارشد امور مدنی» |
| `criminal-expert` ✅ | کیفری؛ دادرسی، مجازات‌ها، دفاع | Leader | expert | crim:defense، crim:procedure، crim:sentencing، crim:crimes — «کارشناس ارشد امور کیفری» |
| `family-expert` ✅ | خانواده؛ طلاق، حضانت، مهریه | Leader | expert | fam:divorce، fam:custody، fam:dowry، fam:support — «کارشناس ارشد امور خانواده» |
| `registration-expert` ✅ | ثبتی؛ سند، شرکت، علامت تجاری، احوال شخصیه | Leader | expert | reg:deeds، reg:companies، reg:trademark، reg:vital — «کارشناس ارشد امور ثبتی» |
| `collector-rooznameh` | جمع‌آوری روزنامه رسمی و پایگاه‌های رسمی | Leader | collector | collect:rss، collect:http-fetch |
| `validator-green-tick` | صدور «تیک سبز» — checksum+provenance | Leader | validator | validate:checksum، validate:trust-tier |
| `updater-temporal` | نسخه‌گذاری زمانی قوانین (valid_from/to) | Leader | updater | diff:law-version، chain:supersede |
| `retriever-rag` | بازیابی برداری pgvector + rerank | Leader | expert (internal) | rag:retrieve، rag:rerank |
| `drafter-cited` | تنظیم پیش‌نویس با استناد اجباری | Leader | expert (internal) | draft:petition، draft:contract-طبق-قانون |
| `notifier-smart` | اعلان‌ها: یادآوری جلسه، پی قرارداد | Leader | expert (ops) | notify:sms، notify:reminder |

> قانون: هیچ ایجنت خارج از این جدول بدون ورود به این سند + ثبت در registry
> کار نمی‌کند. این جدول = منبع حقیقت ناوگان.

## گرنت‌ها (دسترسی امن رهبر → ساب‌ایجنت)

هر `capability` فقط وقتی اجرا می‌شود که grant فعال داشته باشد (ADR-005):
- `expert:{field}:execute` → اجرای مهارت خبره‌ی آن رشته
- `collector:official:ingest` → جمع‌آوری از منابع رسمی
- `validator:corpus:verify` → تیک سبز روی داده تازه
- `updater:corpus:version` → ثبت نسخه جدید قانون
- `voice:leader:session` → نشست صوتی مدیر↔رهبر (پیش‌فرض: فقط LAWYER_OWNER)

همه‌ی grantها `expiresAt` اجباری دارند؛ بدون مجوز = `AI_AGENT_NOT_AUTHORIZED`.

## تیرها و کانفیگ پیشنهادی (۳ مدل: ضعیف / متوسط / قوی)

هر مشتری هر ترکیبی می‌تواند بزند؛ این‌ها **پیش‌نهادِ تست‌شده‌ی** ماست:

### 🟢 SPARTAN (اقتصادی — حداقل‌گر، لوکال‌محور)
```env
AGENT_TIER=spartan
AI_HYBRID_POLICY=local_only
AI_LOCAL_BASE_URL=http://localhost:11434   # Ollama، مدل 7B-8B فارسی‌دوست
AI_MONTHLY_BUDGET_USD=                     # بدون سقف ابری → ابری قطع است
AI_EMBEDDING_DIMENSION=768                 # bge-m3 / مدل‌های کوچک، نه 1536!
```
- ایجنت‌های فعال: base + civil + family + collector (دستی) + validator. بقیه disabled.
- صوتی: خاموش. Rerank: فقط deterministic. هزینه ماهانه: ~۰ تومان زیرساخت ابری.

### 🟡 COUNSEL (متعادل — پیش‌فرضِ پیشنهادی ما)
```env
AGENT_TIER=counsel
AI_HYBRID_POLICY=hybrid_local_first
AI_LOCAL_BASE_URL=http://localhost:11434
AI_BASE_URL=<درگاه ایرانی/وی‌پی‌اس طبق SPEC §8>
AI_MONTHLY_BUDGET_USD=25                   # سقف؛ تمام شد → خودکار لوکال (ADR-004)
AI_EMBEDDING_DIMENSION=1024
```
- ایجنت‌های فعال: همه‌ی expertها + collector/validator/updater + retriever.
- drafter فقط با تراست‌تیر ۱. صوتی: فقط نشست مدیر. LLM tiebreak: روشن (ADR-003).

### 🔴 SENATOR (قدرتمند — حداکثر کیفیت، ابری‌محور با fallback لوکال)
```env
AGENT_TIER=senator
AI_HYBRID_POLICY=hybrid_cloud_first
AI_LOCAL_BASE_URL=http://localhost:11434   # fallback همچنان حاضر
AI_MONTHLY_BUDGET_USD=150
AI_EMBEDDING_DIMENSION=1536                # مدل بزرگ ابری؛ قابل تغییر (SPEC §5)
```
- همه‌ی ناوگان فعال. صوتی تمام‌وقت. موازی‌سازی ingest بالا. rerank عمیق‌تر.
- توصیه‌ی سخت‌گیرانه: `sensitivity=privileged` برای داده‌ی موکل — حتی داخل
  SENATOR هم این تَسک‌ها هرگز ابری نمی‌شوند (ADR-004، غیرقابل‌خریدن است).

## ماتریس امنیت کانفیگ (غیرقابل معاوضه، بدون توجه به تیر)

| قانون | SPARTAN | COUNSEL | SENATOR |
|---|---|---|---|
| privileged هرگز cloud | ✅ | ✅ | ✅ |
| draft بدون citation = reject | ✅ | ✅ | ✅ |
| lawyer review اجباری | ✅ | ✅ | ✅ |
| mock در production ممنوع | ✅ | ✅ | ✅ |
| grant بدون expiresAt | ❌ | ❌ | ❌ |
