/**
 * P10 — the REAL SMTP adapter against an in-test SMTP stub speaking actual
 * wire protocol (node socket). Same seam discipline as P9: real I/O, stub we
 * control, no vendor, no private-field poking.
 */
import * as net from 'node:net';
import { ConfigService } from '@nestjs/config';
import { SmtpEmailAdapter } from '../../src/providers/email/smtp-email.adapter';
import { ProviderError, PROVIDER_ERROR_CODES } from '../../src/providers/provider.error';

interface Captured { commands: string[]; data: string }

function fakeSmtpServer(opts: { rejectRcpt?: boolean; rejectAuth?: boolean } = {}) {
  const captured: Captured = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false;
    let dataBuf = '';
    let authStage = 0; // 0: none, 1: username sent → prompt password, 2: pass sent → final
    sock.write('220 stub.example ESMTP ready\r\n');
    sock.on('data', (d) => {
      const text = d.toString('utf8');
      for (const raw of text.split('\r\n')) {
        if (!raw) continue;
        if (inData) {
          if (raw === '.') { inData = false; captured.data = dataBuf; sock.write('250 queued as stub-1\r\n'); }
          else { dataBuf += raw + '\n'; }
          continue;
        }
        captured.commands.push(raw);
        const cmd = raw.split(' ')[0].toUpperCase();
        const rcptRejected = opts.rejectRcpt && cmd === 'RCPT';
        const authRejected = opts.rejectAuth && (cmd === 'AUTH' || /^[A-Za-z0-9+/=]+$/.test(raw));
        if (cmd === 'EHLO') sock.write('250-stub.example\r\n250 AUTH LOGIN\r\n');
        else if (cmd === 'MAIL') sock.write('250 ok\r\n');
        else if (cmd === 'RCPT') sock.write(rcptRejected ? '550 mailbox unavailable\r\n' : '250 ok\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 end with <CRLF>.<CRLF>\r\n'); }
        else if (cmd === 'AUTH') { authStage = 1; sock.write(opts.rejectAuth ? '535 bad creds\r\n' : '334 VXNlcm5hbWU6\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else if (authStage === 1 && /^[A-Za-z0-9+/=]{4,}$/.test(raw)) { authStage = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (authStage === 2 && /^[A-Za-z0-9+/=]{4,}$/.test(raw)) { authStage = 0; sock.write(authRejected ? '535 bad creds\r\n' : '235 auth ok\r\n'); }
        else sock.write('502 unimplemented\r\n');
      }
    });
  });
  return { server, captured };
}

function makeCfg(port: number, extra: Record<string, string> = {}) {
  return new ConfigService({
    EMAIL_DRIVER: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_USER: 'postmaster',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'no-reply@legal.local',
    SMTP_STARTTLS: '0',
    ...extra,
  });
}

describe('P10 SmtpEmailAdapter (real SMTP wire)', () => {
  let server: net.Server; let port: number; let captured: Captured;

  beforeAll(async () => {
    ({ server, captured } = fakeSmtpServer());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it('sends a full RFC dialogue: EHLO→AUTH→MAIL→RCPT→DATA→.→QUIT, Persian subject intact', async () => {
    const smtp = new SmtpEmailAdapter(makeCfg(port));
    const res = await smtp.sendMail({ to: 'vakil@example.com', subject: 'کد ورود شما', text: 'کد تأیید شما: ۱۲۳۴۵۶' });
    expect(res).toMatchObject({ success: true });
    expect(res.messageId).toContain('@legal-platform');
    const names = captured.commands.map((c) => c.split(' ')[0].toUpperCase());
    for (const step of ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']) {
      expect(names).toContain(step);
    }
    expect(captured.commands.find((c) => c.startsWith('MAIL FROM'))).toBe('MAIL FROM:<no-reply@legal.local>');
    expect(captured.commands.find((c) => c.startsWith('RCPT TO'))).toBe('RCPT TO:<vakil@example.com>');
    // DATA (base64) decodes back to the exact Persian body — no mojibake
    const bodyB64 = captured.data.trim().split('\n').pop()!;
    expect(Buffer.from(bodyB64, 'base64').toString('utf8')).toContain('۱۲۳۴۵۶');
    // subject header is RFC 2047 base64-UTF-8
    const subjLine = captured.data.split('\n').find((l) => l.startsWith('Subject:'))!;
    const subjB64 = subjLine.match(/B\?(.+?)\?=/)![1];
    expect(Buffer.from(subjB64, 'base64').toString('utf8')).toBe('کد ورود شما');
  });

  it('a 550 RCPT rejection is a typed ProviderError — never reported success', async () => {
    const { server: s2 } = fakeSmtpServer({ rejectRcpt: true });
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
    const p2 = (s2.address() as { port: number }).port;
    const smtp = new SmtpEmailAdapter(makeCfg(p2));
    await expect(smtp.sendMail({ to: 'x@y.z', subject: 's', text: 'b' }))
      .rejects.toMatchObject({ code: PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, retryable: true });
    s2.close();
  });

  it('a 535 AUTH rejection is CONFIG-level, NON-retryable (credentials, not weather)', async () => {
    const { server: s3 } = fakeSmtpServer({ rejectAuth: true });
    await new Promise<void>((r) => s3.listen(0, '127.0.0.1', r));
    const p3 = (s3.address() as { port: number }).port;
    const smtp = new SmtpEmailAdapter(makeCfg(p3));
    await expect(smtp.sendMail({ to: 'x@y.z', subject: 's', text: 'b' })).rejects.toBeInstanceOf(ProviderError);
    s3.close();
  });

  it('verifyConfig performs no magic: connect + EHLO + close', async () => {
    const smtp = new SmtpEmailAdapter(makeCfg(port));
    await expect(smtp.verifyConfig()).resolves.toEqual({ valid: true });
  });

  it('unreachable relay fails fast and loudly ({success:false}), never a fake send', async () => {
    const smtp = new SmtpEmailAdapter(makeCfg(1)); // port 1 = closed
    const res = await smtp.sendMail({ to: 'x@y.z', subject: 's', text: 'b' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('ECONNREFUSED');
  });
});
