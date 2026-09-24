// State machines as per SPEC section 6

export enum BookingState {
  PENDING = 'pending',
  RESERVED = 'reserved',
  PAID = 'paid',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
  NO_SHOW = 'no_show',
}

export enum PaymentIntentState {
  CREATED = 'created',
  PENDING_GATEWAY = 'pending_gateway',
  PAID = 'paid',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

export enum IngestionJobState {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL_SUCCESS = 'partial_success',
}

export enum DraftRequestState {
  CREATED = 'created',
  RETRIEVING = 'retrieving',
  GENERATING = 'generating',
  AWAITING_REVIEW = 'awaiting_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUPERSEDED = 'superseded',
}

export enum BackupJobState {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum UserRole {
  LAWYER_OWNER = 'lawyer_owner',
  STAFF = 'staff',
  CLIENT = 'client',
  OPERATOR = 'operator',
}

// Agentic Layer (SPEC §11a): single home for the legal-field taxonomy.
// Nothing else may redefine these strings (SPEC §4: no duplicated enums).
export enum LegalField {
  CIVIL = 'civil',
  CRIMINAL = 'criminal',
  FAMILY = 'family',
  REGISTRATION = 'registration',
  COMMERCIAL = 'commercial',
  LABOR = 'labor',
  GENERAL = 'general',
}

export enum IntentKind {
  QUESTION = 'question',
  DRAFT_REQUEST = 'draft_request',
  REVIEW_DOCUMENT = 'review_document',
  SEARCH_LAW = 'search_law',
  UNKNOWN = 'unknown',
}

// Purchasable AI tiers (SPEC §1 "Tiers as feature flags" refined for the
// agentic layer): everyone picks what their budget allows; presets in
// docs/AGENT_FLEET.md map each tier to concrete per-agent config.
export enum AgentTier {
  SPARTAN = 'spartan', // اقتصادی — local-first, mock/minimal cloud
  COUNSEL = 'counsel', // متعادل — hybrid, cloud fallback
  SENATOR = 'senator', // قدرتمند — cloud-first, full fleet, voice
}

// ─── Commerce & consultation (SPEC §11a business layer, P2a) ───────────────
// Every purchasable thing on the public site is an ENUM here — no drifting
// strings, no inventing prices inside UI code (SPEC §4).

/** AI capabilities sold as subscriptions "for every part of the app" */
export enum SubscriptionFeature {
  AI_CHAT = 'ai_chat',
  AI_FILE_LAB = 'ai_filelab', // upload + Leader analysis (P1e)
  AI_KITCHEN = 'ai_kitchen', // live agent visualization (P1f)
  AI_VOICE = 'ai_voice', // talk to the Leader
}

export type SubscriptionMonths = 1 | 3 | 12;

/** Consultation slot lengths the lawyer chooses between (ملت می‌خرند) */
export type ConsultationMinutes = 10 | 20 | 30;

export interface ConsultationPlan {
  minutes: ConsultationMinutes;
  /** Toman. The LAWYER sets these from the telecoms box; these are the
   *  factory defaults, editable — not hard-coded revenue. */
  priceToman: number;
  active: boolean;
}

export const DEFAULT_CONSULTATION_PLANS: ConsultationPlan[] = [
  { minutes: 10, priceToman: 250_000, active: true },
  { minutes: 20, priceToman: 450_000, active: true },
  { minutes: 30, priceToman: 650_000, active: true },
];

/** Queue ticket lifecycle — never machines without honest states. */
export type TicketStatus = 'waiting' | 'up_next' | 'in_call' | 'done' | 'no_show' | 'cancelled';

export type WalletTxnKind = 'topup' | 'purchase' | 'refund' | 'subscription';

/** Lawyer telecoms state — «مخابرات»: دکمه‌های روشن/خاموش/باز/بسته */
export interface TelecomsState {
  online: boolean;
  queueOpen: boolean;
  closeReason?: string; // Persian, shown to clients when closed
  updatedAt: string;
}
