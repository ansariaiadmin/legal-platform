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
