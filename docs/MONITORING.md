# 📊 راهنمای مانیتورینگ و هشداردهی

این سند راهنمای کامل سیستم مانیتورینگ، متریک‌ها، هشدارها و داشبورد برای پلتفرم حقوقی است.

---

## فهرست مطالب

1. [معماری مانیتورینگ](#معماری-مانیتورینگ)
2. [اندپوینت‌های سلامت](#اندپوینتهای-سلامت)
3. [متریک‌های Prometheus](#متریکهای-prometheus)
4. [قوانین هشدار](#قوانین-هشدار)
5. [یکپارچه‌سازی تلگرام و اسلک](#یکپارچهسازی-تلگرام-و-اسلک)
6. [داشبورد](#داشبورد)
7. [Grafana](#grafana)
8. [عیب‌یابی](#عیب‌یابی)

---

## معماری مانیتورینگ

```
┌─────────────────────────────────────────────────────────────┐
│                    API Server (NestJS)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Health Check │  │   Metrics    │  │    Alerting      │  │
│  │ /health      │  │   /metrics   │  │  Telegram/Slack  │  │
│  │ /ready       │  │              │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│           │                 │                    │          │
└───────────┼─────────────────┼────────────────────┼──────────┘
            │                 │                    │
            ▼                 ▼                    ▼
    ┌──────────────┐  ┌──────────────┐    ┌──────────────┐
    │  Load        │  │ Prometheus   │    │  Telegram    │
    │  Balancer    │  │  Scraper     │    │  Slack       │
    │  /health     │  │  :9090       │    │  Webhooks    │
    └──────────────┘  └──────┬───────┘    └──────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Grafana    │
                      │   :3000      │
                      │  Dashboards  │
                      └──────────────┘
```

---

## اندپوینت‌های سلامت

### 1. `/api/health` — Liveness Probe

بررسی سلامت کلی سرویس و وابستگی‌ها.

**پاسخ موفق (200):**

```json
{
  "status": "ok",
  "service": "api",
  "uptimeSeconds": 3600,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": {
    "database": { "status": "up", "latencyMs": 5 },
    "redis": { "status": "up", "latencyMs": 2 },
    "storage": { "status": "up" },
    "disk": { "status": "up" }
  },
  "version": "1.0.0"
}
```

**پاسخ خطا (503):**

```json
{
  "status": "error",
  "service": "api",
  "uptimeSeconds": 3600,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": {
    "database": { "status": "down", "error": "Connection timeout" },
    "redis": { "status": "up", "latencyMs": 2 }
  }
}
```

**وضعیت‌ها:**

- `ok`: همه چیز سالم
- `degraded`: دیتابیس سالم ولی Redis یا Storage مشکل دارد
- `error`: دیتابیس down (503)

### 2. `/api/ready` — Readiness Probe

برای Kubernetes و Load Balancer — آیا آماده دریافت ترافیک است؟

**پاسخ (200 آماده، 503 نا آماده):**

```json
{
  "ready": true,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": {
    "database": { "status": "up", "latencyMs": 5 },
    "redis": { "status": "up" },
    "migrations": { "status": "up" }
  }
}
```

**استفاده در K8s:**

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 30
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /api/ready
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10
```

### 3. `/api/metrics` — Prometheus Metrics

متریک‌ها در فرمت OpenMetrics/Prometheus.

**نمونه خروجی:**

```
# HELP legal_platform_uptime_seconds Application uptime in seconds
# TYPE legal_platform_uptime_seconds gauge
legal_platform_uptime_seconds 3600

# HELP legal_platform_http_requests_total Total HTTP requests
# TYPE legal_platform_http_requests_total counter
legal_platform_http_requests_total 1250

# HELP legal_platform_http_errors_total Total HTTP errors (4xx, 5xx)
# TYPE legal_platform_http_errors_total counter
legal_platform_http_errors_total 25

# HELP legal_platform_http_error_rate_percent HTTP error rate percentage
# TYPE legal_platform_http_error_rate_percent gauge
legal_platform_http_error_rate_percent 2.00

# HELP legal_platform_db_failures_total Total DB connection/query failures
# TYPE legal_platform_db_failures_total counter
legal_platform_db_failures_total 0

# HELP legal_platform_agent_failures_total Total agent failures
# TYPE legal_platform_agent_failures_total counter
legal_platform_agent_failures_total 2
legal_platform_agent_failures_total{agent="civil-expert"} 1
legal_platform_agent_failures_total{agent="criminal-expert"} 1
```

### 4. `/api/health/dashboard` — داشبورد HTML

داشبورد زیبای فارسی برای مشاهده سریع وضعیت.

**ویژگی‌ها:**

- وضعیت سرویس‌ها (DB، Redis، Storage، Disk)
- متریک‌های HTTP (تعداد درخواست، خطا، نرخ خطا، میانگین زمان)
- وضعیت دیتابیس و Redis
- وضعیت ایجنت‌ها و بکاپ‌ها
- هشدارهای اخیر
- لینک به Prometheus metrics

### 5. `/api/health/alerts` — هشدارهای اخیر

```json
{
  "alerts": [
    {
      "rule": "high_error_rate",
      "message": "نرخ خطا بالا: 7.5% در 5 دقیقه گذشته",
      "severity": "critical",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "value": 7.5
    }
  ]
}
```

### 6. `/api/health/stats` — آمار JSON

```json
{
  "uptimeSeconds": 3600,
  "http": {
    "requestsTotal": 1250,
    "errorsTotal": 25,
    "errorRatePercent": 2.0,
    "avgDurationMs": 45.5
  },
  "db": {
    "queriesTotal": 5000,
    "failuresTotal": 0,
    "avgDurationMs": 5.2
  },
  "agents": {
    "executionsTotal": 100,
    "failuresTotal": 2,
    "failuresByAgent": {
      "civil-expert": 1,
      "criminal-expert": 1
    }
  }
}
```

---

## متریک‌های Prometheus

### لیست کامل متریک‌ها

| نام متریک | نوع | توضیح |
|-----------|-----|-------|
| `legal_platform_uptime_seconds` | gauge | آپتایم اپلیکیشن |
| `legal_platform_http_requests_total` | counter | کل درخواست‌های HTTP |
| `legal_platform_http_errors_total` | counter | خطاهای HTTP (4xx, 5xx) |
| `legal_platform_http_error_rate_percent` | gauge | نرخ خطا به درصد |
| `legal_platform_http_request_duration_seconds_sum` | counter | مجموع زمان درخواست‌ها |
| `legal_platform_http_request_duration_seconds_count` | counter | تعداد درخواست‌های اندازه‌گیری شده |
| `legal_platform_http_request_duration_avg_ms` | gauge | میانگین زمان پاسخ |
| `legal_platform_db_query_duration_seconds_sum` | counter | مجموع زمان کوئری‌های DB |
| `legal_platform_db_failures_total` | counter | خطاهای DB |
| `legal_platform_redis_operations_total` | counter | عملیات Redis |
| `legal_platform_redis_failures_total` | counter | خطاهای Redis |
| `legal_platform_agent_executions_total` | counter | اجراهای ایجنت |
| `legal_platform_agent_failures_total` | counter | خطاهای ایجنت (با لیبل agent) |
| `legal_platform_backup_jobs_total` | counter | جاب‌های بکاپ |
| `legal_platform_backup_failures_total` | counter | خطاهای بکاپ |
| `legal_platform_http_endpoint_requests_total` | counter | درخواست‌ها per endpoint |
| `legal_platform_http_endpoint_errors_total` | counter | خطاها per endpoint |

### نحوه جمع‌آوری

```typescript
// در هر درخواست HTTP
metrics.recordHttpRequest(method, route, statusCode, durationMs);

// در هر کوئری DB
metrics.recordDbQuery(durationMs, failed);

// در هر عملیات Redis
metrics.recordRedisOperation(failed);

// در هر اجرای ایجنت
metrics.recordAgentExecution(agentId, failed);

// در هر بکاپ
metrics.recordBackupJob(failed);
```

---

## قوانین هشدار

### فایل `infra/prometheus/alert.rules.yml`

#### 1. نرخ خطای بالا >5% برای 5 دقیقه

```yaml
- alert: HighErrorRate
  expr: legal_platform_http_error_rate_percent > 5
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "نرخ خطای بالا - {{ $value }}% در 5 دقیقه"
```

**اقدام:** بررسی لاگ‌ها، وضعیت DB، حملات DDoS

#### 2. خطاهای اتصال دیتابیس

```yaml
- alert: DatabaseConnectionFailures
  expr: increase(legal_platform_db_failures_total[5m]) > 5
  for: 2m
  labels:
    severity: critical
```

**اقدام:** بررسی PostgreSQL، اتصالات، منابع

#### 3. فضای دیسک <10%

```yaml
- alert: DiskSpaceLow
  expr: (1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100 > 90
  for: 5m
  labels:
    severity: critical
```

**اقدام:** پاکسازی لاگ‌ها، بکاپ‌های قدیمی، افزایش دیسک

#### 4. خطای ایجنت‌ها

```yaml
- alert: AgentFailuresHigh
  expr: increase(legal_platform_agent_failures_total[10m]) > 10
  for: 5m
  labels:
    severity: warning
```

**اقدام:** بررسی لاگ ایجنت‌ها، وضعیت AI provider

#### 5. خطای بکاپ

```yaml
- alert: BackupFailures
  expr: increase(legal_platform_backup_failures_total[1h]) > 0
  for: 1m
  labels:
    severity: critical
```

**اقدام:** بررسی لاگ بکاپ، فضای دیسک، اتصال S3

#### 6. API Down

```yaml
- alert: APIDown
  expr: up{job="legal-api"} == 0
  for: 1m
  labels:
    severity: critical
```

**اقدام:** بررسی کانتینر api، لاگ‌ها، restart

---

## یکپارچه‌سازی تلگرام و اسلک

### تنظیم تلگرام

1. **ساخت ربات:**

```
- به @BotFather در تلگرام پیام دهید
- /newbot را بفرستید
- نام و username ربات را انتخاب کنید
- توکن ربات را دریافت کنید
```

2. **دریافت Chat ID:**

```
- ربات را به گروه یا کانال اضافه کنید
- پیامی بفرستید
- به https://api.telegram.org/bot<TOKEN>/getUpdates بروید
- chat_id را بردارید
```

3. **تنظیم در `.env`:**

```bash
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
TELEGRAM_ALERT_CHAT_ID="-1001234567890"
```

### تنظیم اسلک

1. **ساخت Webhook:**

```
- به https://api.slack.com/messaging/webhooks بروید
- یک webhook برای کانال مورد نظر بسازید
- URL را کپی کنید
```

2. **تنظیم در `.env`:**

```bash
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX"
```

### تست هشدار

```bash
# تست تلگرام
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"$TELEGRAM_ALERT_CHAT_ID\", \"text\": \"تست هشدار مانیتورینگ\"}"

# تست اسلک
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text": "تست هشدار مانیتورینگ"}'
```

### فرمت پیام‌ها

**تلگرام:**

```
🚨 CRITICAL: high_error_rate
نرخ خطا بالا: 7.5% در 5 دقیقه گذشته (آستانه 5%)
Time: 2024-01-01T12:00:00.000Z
```

**اسلک:**

```
🚨 CRITICAL: high_error_rate
Rule: high_error_rate
Severity: critical
Message: نرخ خطا بالا: 7.5% در 5 دقیقه
Time: 2024-01-01T12:00:00.000Z
```

---

## داشبورد

### داشبورد داخلی (`/api/health/dashboard`)

داشبورد HTML فارسی که بدون نیاز به Grafana کار می‌کند.

**ویژگی‌ها:**

- طراحی RTL فارسی
- نمایش وضعیت سرویس‌ها با رنگ (سبز، زرد، قرمز)
- متریک‌های لحظه‌ای
- هشدارهای اخیر
- لینک به Prometheus و JSON endpoints

**دسترسی:**

```bash
# از مرورگر
http://localhost:8080/api/health/dashboard

# یا مستقیم از API
http://localhost:3001/api/health/dashboard
```

### نمونه خروجی Prometheus

```
GET /api/metrics
Content-Type: text/plain; version=0.0.4

# HELP legal_platform_http_requests_total Total HTTP requests
legal_platform_http_requests_total 1250
...
```

---

## Grafana

### راه‌اندازی

```bash
# فعال‌سازی پروفایل monitoring
docker compose --profile monitoring up -d

# یا در prod
docker compose -f docker-compose.prod.yml --profile monitoring up -d prometheus grafana
```

### دسترسی

- **Prometheus:** http://localhost:9090
- **Grafana:** http://localhost:3000
  - Username: admin
  - Password: از `GRAFANA_PASSWORD` در `.env` یا `admin` پیش‌فرض

### تنظیم Datasource

Datasource به صورت خودکار از `infra/grafana/datasources/prometheus.yml` تنظیم می‌شود.

### داشبوردهای پیشنهادی

1. **Legal Platform Overview:**
   - Uptime
   - HTTP requests/sec
   - Error rate
   - Avg latency
   - DB failures
   - Agent failures

2. **System Resources:**
   - CPU usage
   - Memory usage
   - Disk space
   - Network I/O

3. **Business Metrics:**
   - Active users
   - Bookings per hour
   - AI credit usage
   - Backup success rate

### نمونه کوئری‌های PromQL

```promql
# نرخ درخواست در ثانیه
rate(legal_platform_http_requests_total[5m])

# نرخ خطا
legal_platform_http_error_rate_percent

# میانگین زمان پاسخ
legal_platform_http_request_duration_avg_ms

# خطاهای DB در 5 دقیقه
increase(legal_platform_db_failures_total[5m])

# خطاهای ایجنت per agent
sum by (agent) (legal_platform_agent_failures_total)
```

---

## عیب‌یابی

### چک‌لیست مانیتورینگ

- [ ] `/api/health` پاسخ 200 می‌دهد
- [ ] `/api/ready` پاسخ 200 و ready=true
- [ ] `/api/metrics` متریک‌ها را برمی‌گرداند
- [ ] Prometheus به api متصل است (Targets UP)
- [ ] Alert rules لود شده (Rules در Prometheus UI)
- [ ] تلگرام/اسلک تست شده
- [ ] Grafana به Prometheus متصل است
- [ ] داشبورد HTML کار می‌کند

### دستورات مفید

```bash
# بررسی سلامت
curl -s http://localhost:8080/api/health | jq

# بررسی متریک‌ها
curl -s http://localhost:8080/api/metrics | head -20

# بررسی Prometheus targets
curl -s http://localhost:9090/api/v1/targets | jq

# بررسی لاگ API
docker compose logs api | grep -i "metric\|alert\|health"

# تست هشدار دستی
curl -X POST http://localhost:3001/api/health/alerts/test -H "Authorization: Bearer TOKEN"
```

### مشکلات شایع

| مشکل | دلیل | راه حل |
|------|------|--------|
| `/health` 503 | DB down | بررسی postgres container |
| `/metrics` خالی | MetricsService مقداردهی نشده | بررسی setup.ts |
| Prometheus target DOWN | api در دسترس نیست | بررسی network و healthcheck |
| هشدار ارسال نمی‌شود | TELEGRAM/SLACK تنظیم نشده | بررسی .env |
| Grafana No Data | Datasource اشتباه | بررسی prometheus.yml |

---

## تنظیمات تولید

### متغیرهای محیطی

```bash
# Monitoring
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_ALERT_CHAT_ID="..."
SLACK_WEBHOOK_URL="..."

# Prometheus (optional)
PROMETHEUS_ENABLED=true
GRAFANA_PASSWORD="strong-password"

# Log level
LOG_LEVEL=info
```

### امنیت

- `/metrics` را پشت فایروال یا با احراز هویت محدود کنید
- توکن تلگرام و webhook اسلک را امن نگه دارید
- Grafana را با پسورد قوی محافظت کنید
- Prometheus را فقط از localhost در دسترس قرار دهید (یا با VPN)

---

## منابع

- [Prometheus Docs](https://prometheus.io/docs/)
- [Grafana Docs](https://grafana.com/docs/)
- [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [RUNBOOK.md](./RUNBOOK.md)
- [BACKUP.md](./BACKUP.md)
