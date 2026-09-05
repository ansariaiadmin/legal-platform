import { parseConfigIntent, isConfigConfirmation } from '../../src/modules/orchestrator/config-intent';

describe('conversational config — the owner TALKS the platform into shape (P1f)', () => {
  it('«به مدل محلی وصل شو، آدرس ... » → connect_local proposal with URL', () => {
    const p = parseConfigIntent('لطفاً به مدل محلی وصل شو آدرس http://gpu-box:8080');
    expect(p?.kind).toBe('connect_local');
    expect(p?.params.baseUrl).toBe('http://gpu-box:8080');
    expect(p?.summaryFa).toContain('gpu-box');
  });

  it('«مدل محلی رو بزن روی http://x با مدل qwen2.5:14b» captures the model', () => {
    const p = parseConfigIntent('مدل محلی رو وصل کن به http://10.0.0.2:8080 مدل: qwen2.5:14b');
    expect(p?.kind).toBe('connect_local');
    expect(p?.params.model).toBe('qwen2.5:14b');
  });

  it('cloud key pasted → connect_cloud, key masked in summary', () => {
    const p = parseConfigIntent('کلید api ابری رو تنظیم کن: sk-XyZ987654321longTOKEN');
    expect(p?.kind).toBe('connect_cloud');
    expect(p?.params.apiKey).toBe('sk-XyZ987654321longTOKEN');
    expect(p?.summaryFa).not.toContain('sk-XyZ987654321longTOKEN');
    expect(p?.summaryFa).toContain('••••');
  });

  it('tier switch by name («تیر سناتور رو فعال کن»)', () => {
    expect(parseConfigIntent('تیر سناتور رو فعال کن')?.params.preset).toBe('senator');
    expect(parseConfigIntent('حالت اسپارتان رو فعال کن')?.params.preset).toBe('spartan');
    expect(parseConfigIntent('پلن کانسل رو فعال کن')?.params.preset).toBe('counsel');
  });

  it('ordinary legal questions do NOT become config proposals', () => {
    expect(parseConfigIntent('فسخ قرارداد اجاره چطور انجام میشه؟')).toBeNull();
    expect(parseConfigIntent('این سند اجاره مه ه؟')).toBeNull();
  });

  it('confirmation tokens — only plain agreement applies a proposal', () => {
    expect(isConfigConfirmation('بله')).toBe(true);
    expect(isConfigConfirmation('تأیید')).toBe(true);
    expect(isConfigConfirmation('بله انجام بده لطفاً')).toBe(false); // not a bare yes
    expect(isConfigConfirmation('نه')).toBe(false);
  });
});
