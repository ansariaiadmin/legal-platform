import { ConfigService } from '@nestjs/config';
import { CommsSettingsService } from '../../src/modules/notifications/comms-settings.service';
import { EncryptionService } from '../../src/security/encryption.service';
import { RoutingSmsProvider } from '../../src/providers/sms/routing-sms.provider';
import type { SmsProvider } from '../../src/providers/sms/sms.provider';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

function memoryStorage(): StorageProvider & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(input: { key: string; content: Buffer }) {
      files.set(input.key, Buffer.from(input.content));
      return { key: input.key } as never;
    },
    async get(key: string) {
      const v = files.get(key);
      if (!v) throw new Error('not found');
      return v;
    },
    async delete(key: string) {
      files.delete(key);
    },
  } as unknown as StorageProvider & { files: Map<string, Buffer> };
}

const encryption = new EncryptionService(
  new ConfigService({ ENCRYPTION_MASTER_KEY: 'a'.repeat(64), NODE_ENV: 'test' }),
);

describe('office SMS panel', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('stores the API key encrypted and reads it back after a restart', async () => {
    const storage = memoryStorage();
    const first = new CommsSettingsService(storage, encryption);
    await first.setSmsPanel({ provider: 'kavenegar', apiKey: 'SECRET-KEY-1234', senderLine: '10008663' }, 'owner');

    const raw = storage.files.get('runtime/comms-config.json')!.toString('utf8');
    expect(raw).not.toContain('SECRET-KEY-1234');
    expect(raw).toContain('enc:v1:');

    // A fresh instance (API restart) loads without any dashboard call first.
    const second = new CommsSettingsService(storage, encryption);
    expect((await second.getSms())?.apiKey).toBe('SECRET-KEY-1234');
    expect((await second.view()).sms.apiKeyMasked).toBe('••••1234');
  });

  it('still reads credentials stored in plain text by older versions', async () => {
    const storage = memoryStorage();
    storage.files.set(
      'runtime/comms-config.json',
      Buffer.from(JSON.stringify({ sms: { provider: 'ghasedak', baseUrl: '', apiKey: 'OLD-PLAIN' }, call: null })),
    );
    const svc = new CommsSettingsService(storage, encryption);
    expect((await svc.getSms())?.apiKey).toBe('OLD-PLAIN');
  });

  it('routes SMS through the connected panel, and through the env adapter otherwise', async () => {
    const storage = memoryStorage();
    const comms = new CommsSettingsService(storage, encryption);
    const envSent: string[] = [];
    const envProvider: SmsProvider = {
      sendSms: async (i) => {
        envSent.push(i.phone);
        return { success: true, messageId: 'env-1' };
      },
      verifyConfig: async () => ({ valid: true }),
    };
    const router = new RoutingSmsProvider(envProvider, () => comms.panelSmsProvider());

    await router.sendSms({ phone: '+989120000001', message: 'code' });
    expect(envSent).toEqual(['+989120000001']);

    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ return: { status: 200 }, entries: [{ messageid: 77 }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await comms.setSmsPanel({ provider: 'kavenegar', apiKey: 'KAVE-KEY', baseUrl: 'https://api.kavenegar.com' }, 'owner');
    const r = await router.sendSms({ phone: '+989120000002', message: 'hello' });
    expect(r).toEqual({ success: true, messageId: '77' });
    expect(calls).toEqual(['https://api.kavenegar.com/v1/KAVE-KEY/sms/send.json']);
    expect(envSent).toHaveLength(1);
  });

  it('the test button uses the same adapter and reports gateway errors', async () => {
    const comms = new CommsSettingsService(memoryStorage(), encryption);
    expect((await comms.testSms('09120000001', 'x')).ok).toBe(false);

    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ IsSuccess: false, StatusCode: 401, Message: 'bad key' }), { status: 401 }),
    ) as unknown as typeof fetch;
    await comms.setSmsPanel({ provider: 'ghasedak', apiKey: 'G-KEY' }, 'owner');
    const r = await comms.testSms('09120000001', 'x');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
