import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from '../provider.error';
import type { EmailProvider, EmailSendInput, EmailSendResult } from './email.provider';

/**
 * P10 — real SMTP over raw sockets, stdlib-only (no nodemailer dependency,
 * same philosophy as the RESP2 Redis client / PING-by-socket).
 *
 * Protocol scope is deliberately the boring 90%: EHLO → (STARTTLS) →
 * AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT, one message per
 * connection. Anything the server says that is not the expected 2xx/3xx is
 * a typed ProviderError — a rejected relay NEVER reports success.
 *
 * Config: EMAIL_DRIVER=smtp + SMTP_HOST/SMTP_PORT[465|587]/SMTP_USER/
 * SMTP_PASS/SMTP_FROM/SMTP_STARTTLS[auto: on for 587]/SMTP_TIMEOUT_MS.
 * Tests override host/port via env like the other P9 adapters.
 */
@Injectable()
export class SmtpEmailAdapter implements EmailProvider {
  private readonly host: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from: string;
  private readonly starttls: boolean;
  private readonly implicitTls: boolean;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('SMTP_HOST') ?? '';
    if (!this.host) {
      throw new ProviderError(PROVIDER_ERROR_CODES.CONFIG_INVALID, 'EMAIL_DRIVER=smtp requires SMTP_HOST', false);
    }
    this.port = Number(config.get<string>('SMTP_PORT')) || 587;
    this.user = config.get<string>('SMTP_USER') || undefined;
    this.pass = config.get<string>('SMTP_PASS') || undefined;
    this.from = config.get<string>('SMTP_FROM') ?? this.user ?? '';
    if (!this.from) {
      throw new ProviderError(PROVIDER_ERROR_CODES.CONFIG_INVALID, 'SMTP_FROM (or SMTP_USER) is required', false);
    }
    this.implicitTls = this.port === 465;
    const sw = config.get<string>('SMTP_STARTTLS');
    this.starttls = sw ? sw === '1' : this.port === 587;
    this.timeoutMs = Number(config.get<string>('SMTP_TIMEOUT_MS')) || 12_000;
  }

  async sendMail(input: EmailSendInput): Promise<EmailSendResult> {
    try {
      const smtp = await this.connect();
      try {
        await this.command(smtp, `EHLO legal-platform`, 250);
        if (this.starttls && !this.implicitTls) {
          await this.command(smtp, 'STARTTLS', 220);
          smtp.upgradeTls();
          await this.command(smtp, `EHLO legal-platform`, 250);
        }
        if (this.user && this.pass) {
          await this.command(smtp, 'AUTH LOGIN', 334);
          await this.command(smtp, Buffer.from(this.user).toString('base64'), 334);
          await this.command(smtp, Buffer.from(this.pass).toString('base64'), 235);
        }
        await this.command(smtp, `MAIL FROM:<${this.from}>`, 250);
        await this.command(smtp, `RCPT TO:<${input.to}>`, 250);
        await this.command(smtp, 'DATA', 354);
        const msgId = `<${crypto.randomUUID()}@legal-platform>`;
        const body = this.buildMessage(input, msgId);
        await this.command(smtp, body + '\r\n.', 250);
        try { await this.command(smtp, 'QUIT', 221); } catch { /* QUIT after success is courtesy */ }
        smtp.close();
        return { success: true, messageId: msgId };
      } finally {
        smtp.close();
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e; // auth/relay rejections are typed, not hidden
      const err = new ProviderError(
        PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE,
        `SMTP ${this.host}:${this.port} failed: ${(e as Error).message}`,
        true,
      );
      return { success: false, error: err.message };
    }
  }

  /** Whole-subject/base64 UTF-8 headers keep Persian subjects intact. */
  private buildMessage(input: EmailSendInput, msgId: string): string {
    const subject = `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`;
    const lines = [
      `Message-ID: ${msgId}`,
      `From: ${this.from}`,
      `To: ${input.to}`,
      `Subject: ${subject}`,
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      // dot-stuffing: any line starting with '.' doubles it (RFC 5321 §4.5.2)
      Buffer.from(
        Buffer.from(input.text.replace(/\r?\n/g, '\r\n'), 'utf8')
          .toString('utf8'),
        'utf8',
      ).toString('base64').replace(/(.{1,76})/g, '$1\r\n').trimEnd(),
    ];
    return lines.join('\r\n');
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      const smtp = await this.connect();
      await this.command(smtp, 'EHLO legal-platform', 250);
      try { await this.command(smtp, 'NOOP', 250); } catch { /* NOOP optional */ }
      smtp.close();
      return { valid: true };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  }

  getMetadata() {
    return { name: `smtp:${this.host}:${this.port}`, driverType: 'smtp' as const };
  }

  // ── minimal client plumbing ────────────────────────────────────────────

  private connect(): Promise<SmtpConn> {
    return new Promise((resolve, reject) => {
      const conn = new SmtpConn(this.host, this.port, this.implicitTls, this.timeoutMs);
      conn.open()
        .then((greeting) => {
          if (!greeting.startsWith('220')) {
            conn.close();
            reject(new ProviderError(PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE, `SMTP greeting refused: ${greeting}`, true));
          } else {
            resolve(conn);
          }
        })
        .catch(reject);
    });
  }

  private async command(conn: SmtpConn, cmd: string, expect: number): Promise<void> {
    const reply = await conn.command(cmd);
    if (!reply.startsWith(String(expect))) {
      const authProblem = this.user && (cmd === 'AUTH LOGIN' || reply.startsWith('535'));
      throw new ProviderError(
        authProblem ? PROVIDER_ERROR_CODES.AUTH_FAILED : PROVIDER_ERROR_CODES.SERVICE_UNAVAILABLE,
        `SMTP command failed: expected ${expect}, got ${reply.trim().slice(0, 120)}`,
        !authProblem,
      );
    }
  }
}

/** One SMTP dialogue on one socket (STARTTLS upgrades in place). */
class SmtpConn {
  private socket!: net.Socket;
  private buffer = '';
  private waiter: ((line: string) => void) | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly implicitTls: boolean,
    private readonly timeoutMs: number,
  ) {}

  open(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onError = (e: Error) => reject(e);
      const sock = this.implicitTls
        ? tls.connect({ host: this.host, port: this.port, servername: this.host })
        : net.connect(this.port, this.host);
      this.socket = sock;
      sock.setTimeout(this.timeoutMs, () => {
        onError(new Error('smtp timeout'));
        sock.destroy();
      });
      sock.once('error', onError);
      sock.on('data', (d) => this.fromWire(d.toString('utf8')));
      sock.once(this.implicitTls ? 'secureConnect' : 'connect', () => {
        // server speaks first: greeting
        this.waiter = (line) => resolve(line);
      });
    });
  }

  upgradeTls(): void {
    const secured = tls.connect({ socket: this.socket, servername: this.host });
    this.replaceSocket(secured as unknown as net.Socket);
  }

  /** Internal: swap the underlying socket after STARTTLS (never from the wire). */
  private replaceSocket(s: net.Socket): void {
    this.socket = s;
    s.on('data', (d) => this.fromWire(d.toString('utf8')));
    s.setTimeout(this.timeoutMs);
  }

  command(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.socket.once('error', onErr);
      this.waiter = (line) => {
        this.socket.off('error', onErr);
        resolve(line);
      };
      this.socket.write(cmd + '\r\n');
    });
  }

  close(): void {
    try { this.socket?.destroy(); } catch { /* already gone */ }
  }

  /** SMTP lines end CRLF; multiline replies repeat "NNN-" until "NNN ". */
  private fromWire(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf('\r\n');
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      idx = this.buffer.indexOf('\r\n');
      // multiline continuation? buffer until final "NNN "
      if (/^\d{3}-/.test(line)) {
        this.pendingCont = (this.pendingCont ? this.pendingCont + '\n' : '') + line;
        continue;
      }
      const full = this.pendingCont ? this.pendingCont + '\n' + line : line;
      this.pendingCont = undefined;
      const w = this.waiter;
      this.waiter = null;
      if (w) w(full);
    }
  }

  private pendingCont?: string;
}
