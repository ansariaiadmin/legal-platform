import { createHash, generateKeyPairSync } from 'node:crypto';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';
import { internationalExpert } from '@legal-platform/agent-international-expert';
import { SignatureService } from '../../src/modules/signature/signature.service';

/**
 * Everyday lawyer scenarios run through the expert agents and the signature
 * service. No database or network is needed, so these always run.
 */

const ask = (agent: { executeExpert(task: never): Promise<{ ok: boolean; output: string }> }, query: string) =>
  agent.executeExpert({ taskId: 't', query, context: [] } as never);

describe('Lawyer scenarios — expert agents', () => {
  it('consensual divorce: counselling, arbitration and the certificate of irreconcilability', async () => {
    const r = await ask(familyExpert, 'طلاق توافقی مراحلش چیه؟');
    expect(r.ok).toBe(true);
    expect(r.output).toContain('تصمیم');
    expect(r.output).toContain('دادخواست');
    expect(r.output).toContain('داوری');
    expect(r.output).toContain('گواهی عدم امکان سازش');
    expect(r.output).toContain('ماده ۳۳ قانون حمایت خانواده');
  });

  it('mahr: article 22 threshold, enforcement routes and the correct civil-code articles', async () => {
    const r = await ask(familyExpert, 'مهریه ۱۱۰ سکه رو چطور بگیرم؟ شوهر نمی‌ده');
    expect(r.output).toContain('ماده ۲۲ قانون حمایت خانواده');
    expect(r.output).toContain('۱۱۰ سکه');
    expect(r.output).toContain('اجرای ثبت');
    expect(r.output).toContain('ماده ۱۰۸۲');
    expect(r.output).toContain('ماده ۱۰۷۸');
    expect(r.output).not.toContain('ماده ۱۰۹۰');
  });

  it('alimony: failure to pay maintenance cites the Family Protection Act, not article 642', async () => {
    const r = await ask(familyExpert, 'شوهرم نفقه نمی‌ده چکار کنم؟');
    expect(r.output).toContain('ماده ۵۳ قانون حمایت خانواده');
    expect(r.output).not.toContain('۶۴۲');
  });

  it('property transfer: official registration act, four inquiries and the 5% transfer tax', async () => {
    const r = await ask(registrationExpert, 'انتقال سند آپارتمان چطوره؟ قولنامه کافیه؟');
    expect(r.output).toContain('قانون الزام به ثبت رسمی');
    expect(r.output).toContain('ماده ۲۲ قانون ثبت');
    for (const office of ['شهرداری', 'دارایی', 'تامین اجتماعی']) expect(r.output).toContain(office);
    expect(r.output).toContain('۵٪ ارزش معاملاتی');
    expect(r.output).not.toMatch(/میلیون تومان/);
  });

  it('export under sanctions: sanctions clause, force majeure and payment routes', async () => {
    const r = await ask(internationalExpert, 'صادرات به ترکیه در شرایط تحریم چطوره؟ پول چطور بگیرم؟');
    expect(r.output).toContain('تحریم');
    expect(r.output).toContain('صرافی');
    expect(r.output).toContain('Sanctions Clause');
    expect(r.output).toContain('فورس ماژور');
  });

  it('arbitration: ICC and the New York Convention, without invented fee figures', async () => {
    const r = await ask(internationalExpert, 'داوری ICC چقدر هزینه دارد؟ کجا بگذارم؟');
    expect(r.output).toContain('ICC');
    expect(r.output).toContain('کنوانسیون نیویورک');
    expect(r.output).not.toContain('۵۰ هزار دلار');
  });
});

describe('Lawyer scenarios — draft signatures', () => {
  const password = 'test-password-123';
  const storage = {
    get: async () => {
      throw new Error('not found');
    },
    put: async () => undefined,
  } as never;

  function serviceWithKey(): SignatureService {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password },
    });
    const svc = new SignatureService(storage);
    const internals = svc as unknown as { keys: Map<string, unknown>; loaded: boolean };
    internals.keys.set('lawyer-1', {
      userId: 'lawyer-1',
      publicKey,
      privateKeyEncrypted: privateKey,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      revoked: false,
    });
    internals.loaded = true;
    return svc;
  }

  it('generates an RSA-2048 key pair', async () => {
    const svc = new SignatureService(storage);
    const keypair = await svc.generateKeyPair('test-lawyer-1', 'strong-password-123');
    expect(keypair.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(keypair.keyId).toBe('test-lawyer-1');
  });

  it('signs with the key generated on the server', async () => {
    const svc = new SignatureService(storage);
    await svc.generateKeyPair('lawyer-2', 'strong-password-123');
    const signed = await svc.sign({
      documentId: 'doc-1',
      documentContent: 'متن نمونه',
      signerId: 'lawyer-2',
      signerName: 'وکیل نمونه',
      password: 'strong-password-123',
      ip: '127.0.0.1',
      userAgent: 'jest',
    });
    expect((await svc.verify(signed.signatureId, 'متن نمونه')).valid).toBe(true);
  });

  it('refuses to sign with a wrong key password or without a key', async () => {
    const svc = serviceWithKey();
    const base = { documentId: 'd', documentContent: 'x', signerName: 'n', ip: 'i', userAgent: 'u' };
    await expect(svc.sign({ ...base, signerId: 'lawyer-1', password: 'wrong-password' })).rejects.toMatchObject({
      response: { code: 'WRONG_KEY_PASSWORD' },
    });
    await expect(svc.sign({ ...base, signerId: 'nobody', password })).rejects.toMatchObject({
      response: { code: 'KEY_NOT_FOUND' },
    });
  });

  it('signs, verifies and detects tampering', async () => {
    const svc = serviceWithKey();
    const content = 'پیش‌نویس قرارداد بیع — ماده ۳۳۸ قانون مدنی';
    const signed = await svc.sign({
      documentId: 'doc-123',
      documentContent: content,
      signerId: 'lawyer-1',
      signerName: 'وکیل نمونه',
      password,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });
    expect(signed.documentHash).toBe(createHash('sha256').update(content, 'utf8').digest('hex'));
    expect((await svc.verify(signed.signatureId, content)).valid).toBe(true);
    expect((await svc.verify(signed.signatureId, `${content} (edited)`)).valid).toBe(false);
  });

  it('rejects a signature after revocation', async () => {
    const svc = serviceWithKey();
    const content = 'قرارداد اجاره — ماده ۴۶۶ قانون مدنی';
    const signed = await svc.sign({
      documentId: 'doc-456',
      documentContent: content,
      signerId: 'lawyer-1',
      signerName: 'وکیل نمونه',
      password,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });
    const revoked = await svc.revoke(signed.signatureId, 'key compromised');
    expect(revoked.revokedAt).toBeDefined();
    expect((await svc.verify(signed.signatureId, content)).valid).toBe(false);
  });
});
