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
