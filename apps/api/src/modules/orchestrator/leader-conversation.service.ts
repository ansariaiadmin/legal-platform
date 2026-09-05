import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrchestratorService } from './orchestrator.service';
import { LeaderVoiceService } from './leader-voice.service';
import { FileIntelligenceService, type FileRecord } from './file-intelligence.service';
import { PlacementService, type PlacementSuggestion } from './placement.service';
import { InProcessAgentEventBus } from './agent-event-bus';

export interface ConvTurn {
  role: 'lawyer' | 'leader';
  text: string;
  at: string;
  attachments?: string[]; // fileIds
  inference?: { target: string; model?: string; assignmentSource?: string };
}

export interface LeaderReply {
  text: string;
  /** file placement advice, computed from attached files (ADR-013) */
  placements: Array<{ fileId: string; filename: string; suggestion: PlacementSuggestion }>;
  routing: { agentId: string | null; skillId: string | null; confidence: number };
  grounded: boolean;
}

export interface Conversation {
  conversationId: string;
  ownerId: string;
  openedAt: string;
  turns: ConvTurn[];
}

const MAX_TURNS_KEPT = 100;

/**
 * The Leader conversation surface (ADR-013): continuous chat + voice with the
 * office owner/manager over ATTACHED FILES. A turn = lawyer text + optional
 * fileIds; the Leader reads files first (FileIntelligence), builds grounded
 * context, recommends placement for every attached file, then answers through
 * the existing governed dispatch path (grants, hybrid, events — no bypass).
 */
@Injectable()
export class LeaderConversationService {
  private readonly conversations = new Map<string, Conversation>();

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly voice: LeaderVoiceService,
    private readonly files: FileIntelligenceService,
    private readonly placement: PlacementService,
    private readonly bus: InProcessAgentEventBus,
  ) {}

  open(ownerId: string): Conversation {
    const conv: Conversation = {
      conversationId: randomUUID(),
      ownerId,
      openedAt: new Date().toISOString(),
      turns: [],
    };
    this.conversations.set(conv.conversationId, conv);
    return conv;
  }

  get(id: string): Conversation | null {
    return this.conversations.get(id) ?? null;
  }

  listByOwner(ownerId: string): Conversation[] {
    return [...this.conversations.values()]
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  async chat(input: {
    conversationId: string;
    text: string;
    fileIds?: string[];
    sensitivity?: 'privileged' | 'normal';
  }, user: { id: string; role: string }): Promise<LeaderReply> {
    const conv = this.needOwn(input.conversationId, user.id);
    const now = new Date().toISOString();

    const attachments: FileRecord[] = (input.fileIds ?? [])
      .map((id) => this.files.get(id))
      .filter((r): r is FileRecord => Boolean(r));

    // 1) The Leader READS before answering (per the product law):
    for (const f of attachments) {
      if (!f.analysis) await this.files.analyze(f.fileId);
    }

    // 2) Placement advice per file (content-aware)
    const placements: LeaderReply['placements'] = [];
    for (const f of attachments) {
      const suggestion = await this.placement.suggest(f);
      placements.push({ fileId: f.fileId, filename: f.filename, suggestion });
    }

    // 3) Build grounded context: file previews become context lines handed to
    // the routed expert, trimmed and attributed ("File X says: …").
    const context: string[] = attachments.map((f) => {
      const words = f.analysis?.preview?.split(/\s+/).filter(Boolean) ?? [];
      const clipped = words.slice(0, 120).join(' ');
      return `فایل «${f.filename}» (${f.analysis?.kindGuess ?? 'unknown'}، ${f.analysis?.chars ?? 0} کاراکتر): ${clipped}${words.length > 120 ? '…' : ''}`;
    });

    // 4) Dispatch through the normal governed path — chat never bypasses
    // grants/governance (SPEC §11a laws).
    const text = input.text.trim() || (attachments.length ? `تحلیل فایل(های) پیوست‌شده` : '');
    const routing = await this.orchestrator.route(text, `conv-${conv.conversationId}`);
    const { result, inference } = await this.orchestrator.dispatch({
      taskId: randomUUID(),
      query: text,
      context,
      requestedBy: { userId: user.id, role: user.role },
      sensitivity: input.sensitivity ?? 'normal',
    });

    const leaderText = composeLeaderText(result.output, attachments, placements, routing.agentId);

    conv.turns.push({ role: 'lawyer', text, at: now, attachments: attachments.map((a) => a.fileId) });
    conv.turns.push({
      role: 'leader',
      text: leaderText,
      at: new Date().toISOString(),
      inference: inference
        ? { target: inference.target, model: inference.model, assignmentSource: inference.assignmentSource }
        : undefined,
    });
    if (conv.turns.length > MAX_TURNS_KEPT) {
      conv.turns.splice(0, conv.turns.length - MAX_TURNS_KEPT);
    }

    this.bus.emit({
      kind: 'conversation.turn',
      at: new Date().toISOString(),
      taskId: `conv-${conv.conversationId}`,
      agentId: routing.agentId,
      detail: `conversation turn files=${attachments.length}`,
    });

    const grounded = Boolean(
      (result.meta as { grounded?: boolean } | undefined)?.grounded,
    );

    return {
      text: leaderText,
      placements,
      routing: {
        agentId: routing.agentId,
        skillId: routing.skillId,
        confidence: routing.classification.confidence,
      },
      grounded,
    };
  }

  /** Voice variant: transcribe → chat → speak reply back (ADR-013). */
  async voiceChat(input: {
    sessionId: string;
    conversationId: string;
    transcriptHint?: string;
    fileIds?: string[];
  }, user: { id: string; role: string }) {
    const turn = await this.voice.hear(input.sessionId, Buffer.alloc(0), input.transcriptHint);
    const reply = await this.chat(
      { conversationId: input.conversationId, text: turn.text, fileIds: input.fileIds },
      user,
    );
    const spoken = await this.voice.speak(
      input.sessionId,
      reply.text /* voice must carry the leader's actual text */,
    );
    return { heardText: turn.text, reply, speech: spoken };
  }

  private needOwn(conversationId: string, userId: string): Conversation {
    const c = this.conversations.get(conversationId);
    if (!c) throw new Error(`conversation not found: ${conversationId}`);
    if (c.ownerId !== userId) throw new Error('conversation belongs to another user');
    return c;
  }
}

function composeLeaderText(
  agentOutput: string,
  attachments: FileRecord[],
  placements: LeaderReply['placements'],
  agentId: string | null,
): string {
  const parts: string[] = [];
  if (attachments.length > 0) {
    const names = attachments.map((f) => `«${f.filename}» (${f.analysis?.kindGuess ?? '?'})`).join(' و ');
    const ocrNotes = attachments
      .filter((f) => f.analysis?.needsOcr)
      .map((f) => f.filename);
    parts.push(`فایل‌های ${names} را خواندم.`);
    if (ocrNotes.length > 0) {
      parts.push(
        `توجه: ${ocrNotes.join(' و ')} تصویری/اسکن‌شده هستند و لایهٔ متنی ندارند — برای تحلیل کامل OCR لازم است (نقشهٔ راه فاز ۴).`,
      );
    }
  }
  if (placements.length > 0) {
    for (const p of placements) parts.push(p.suggestion.rationaleFa);
  }
  parts.push(agentOutput);
  if (!agentId) parts.push('(در حال حاضر هیچ کارشناسی متن گفت‌وگو را پوشش نمی‌دهد.)');
  return parts.join('\n');
}
