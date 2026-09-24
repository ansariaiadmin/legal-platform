import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Leader Voice (SPEC §11a): the law-office manager talks to the Leader out
 * loud; the Leader answers with voice. STT/TTS go through pluggable engines
 * — exactly ONE engine implementation exists today, and it is an honest mock
 * (SPEC §12 forbidden-list compliant: it never claims real transcription).
 *
 * Design: VoiceSession { id, turns[] } → transcript → orchestrator.dispatch
 * → spoken reply. Real engines (Whisper local / cloud TTS) slot behind
 * VoiceEngine without touching controllers (roadmap P3-T6).
 */

export interface VoiceTurn {
  role: 'manager' | 'leader';
  text: string;
  at: string;
}

export interface VoiceEngine {
  readonly engineId: string;
  /** audio bytes -> transcript. Mock returns the provided hint verbatim. */
  transcribe(audio: Buffer, hint?: string): Promise<string>;
  /** leader text -> audio. Mock returns silence-length metadata, no bytes. */
  synthesize(text: string): Promise<{ audio: Buffer; mimeType: string; mocked: boolean }>;
  healthy(): Promise<boolean>;
}

export class MockVoiceEngine implements VoiceEngine {
  readonly engineId = 'mock-voice';
  async transcribe(_audio: Buffer, hint?: string): Promise<string> {
    return hint ?? '';
  }
  async synthesize(_text: string): Promise<{ audio: Buffer; mimeType: string; mocked: boolean }> {
    // Honest placeholder: callers MUST surface `mocked: true` to the UI.
    return { audio: Buffer.alloc(0), mimeType: 'audio/wav', mocked: true };
  }
  async healthy(): Promise<boolean> {
    return true;
  }
}

export interface VoiceSession {
  sessionId: string;
  engine: string;
  turns: VoiceTurn[];
  openedAt: string;
}

@Injectable()
export class LeaderVoiceService {
  private readonly sessions = new Map<string, VoiceSession>();

  /** Field-initialised, NOT constructor-injected: Nest's `emitDecoratorMetadata`
   *  cannot resolve the `VoiceEngine` interface type (same token problem as
   *  provider.category interfaces, see providers/provider.tokens.ts), and a
   *  default-value constructor arg breaks DI. P3-T6 replaces this field with a
   *  VOICE_ENGINE token factory once real engines exist. */
  private readonly engine: VoiceEngine = new MockVoiceEngine();

  openSession(): VoiceSession {
    const session: VoiceSession = {
      sessionId: randomUUID(),
      engine: this.engine.engineId,
      turns: [],
      openedAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /** Manager turn: audio in, transcript out (engine decides the text). */
  async hear(sessionId: string, audio: Buffer, transcriptHint?: string): Promise<VoiceTurn> {
    const session = this.need(sessionId);
    const turn: VoiceTurn = {
      role: 'manager',
      text: await this.engine.transcribe(audio, transcriptHint),
      at: new Date().toISOString(),
    };
    session.turns.push(turn);
    return turn;
  }

  /** Leader turn: the orchestrator's answer becomes speech. */
  async speak(sessionId: string, leaderText: string) {
    const session = this.need(sessionId);
    session.turns.push({ role: 'leader', text: leaderText, at: new Date().toISOString() });
    const spoken = await this.engine.synthesize(leaderText);
    return { ...spoken, sessionId };
  }

  getSession(sessionId: string): VoiceSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  engineHealth() {
    return this.engine.healthy();
  }

  private need(sessionId: string): VoiceSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`voice session not found: ${sessionId}`);
    return session;
  }
}
