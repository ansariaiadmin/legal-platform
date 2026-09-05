import type { MigrationBuilder } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

/**
 * Migration 006: RAG Corpus & Marketplace Billing — SPEC §5 (ai/corpus)
 * + SPEC §9 trust tiers + ADR-015 money stores.
 *
 * Corpus:
 *   knowledge_sources     — what feeds the shelf (official / approved / general)
 *   ingestion_jobs        — every fetch attempt, honest partial_success
 *   legal_documents       — ONE law/version per row; valid_from/valid_to own
 *                           time, never UPDATE history (SPEC §9 temporal)
 *   document_chunks       — embed-ready, Persian-first segment kept forever
 *   corpus_versions       — the updater agent's temporal ledger
 *
 * Marketplace:
 *   wallets / wallet_txns                 — the wallet ledger (idempotent refs)
 *   purchases / subscriptions             — what the client BOUGHT
 *   consultation_tickets                  — the queue rows (SPEC phone-flow)
 *   comms_panels                          — lawyer-wired SMS/call endpoints
 *   notifications                         — in-app alerts mirrored on SMS
 */

export const up = (pgm: MigrationBuilder) => {
  // ---------- corpus -----------------------------------------------
  pgm.createTable('knowledge_sources', {
    id: { type: 'uuid', notNull: true },
    source_key: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    base_url: { type: 'text' },
    trust_tier: { type: 'smallint', notNull: true },
    enabled: { type: 'boolean', notNull: true },
    quality_score: { type: 'numeric(5,2)', notNull: true },
    last_synced_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('knowledge_sources', 'knowledge_sources_source_key_unique', 'UNIQUE (source_key)');
  pgm.addConstraint(
    'knowledge_sources',
    'knowledge_sources_tier_range',
    'CHECK (trust_tier BETWEEN 1 AND 3)',
  );

  pgm.createTable('ingestion_jobs', {
    id: { type: 'uuid', notNull: true },
    source_id: { type: 'uuid', notNull: true, references: 'knowledge_sources(id)', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true }, // full_sync | manual_file | reindex
    status: { type: 'text', notNull: true }, // running | succeeded | partial_success | failed
    attempted: { type: 'int', notNull: true },
    succeeded: { type: 'int', notNull: true },
    failed: { type: 'int', notNull: true },
    error_detail: { type: 'text' },
    started_at: { type: 'timestamptz', notNull: true },
    finished_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('ingestion_jobs', 'ingestion_jobs_status_domain', "CHECK (status IN ('running','succeeded','partial_success','failed'))");

  pgm.createTable('legal_documents', {
    id: { type: 'uuid', notNull: true },
    source_id: { type: 'uuid', notNull: true, references: 'knowledge_sources(id)' },
    canonical_title: { type: 'text', notNull: true }, // نقش «شناسه‌ی قانون»
    body_raw: { type: 'text', notNull: true },
    body_normalized: { type: 'text', notNull: true }, // حروف یکدست‌شده فارسی
    sha256: { type: 'text', notNull: true },
    trust_tier: { type: 'smallint', notNull: true },
    language: { type: 'text', notNull: true },
    valid_from: { type: 'timestamptz', notNull: true },
    valid_to: { type: 'timestamptz' },
    supersedes_id: { type: 'uuid', references: 'legal_documents(id)' },
    verified_at: { type: 'timestamptz' }, // validator green tick — readonly by collectors!
    verified_by: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('legal_documents', 'legal_documents_sha256_unique', 'UNIQUE (sha256)');
  pgm.addConstraint('legal_documents', 'legal_documents_tier_range', 'CHECK (trust_tier BETWEEN 1 AND 3)');
  pgm.createIndex('legal_documents', 'canonical_title');
  pgm.createIndex('legal_documents', ['trust_tier', 'verified_at']);

  pgm.createTable('document_chunks', {
    id: { type: 'uuid', notNull: true },
    document_id: { type: 'uuid', notNull: true, references: 'legal_documents(id)', onDelete: 'CASCADE' },
    position: { type: 'int', notNull: true },
    content: { type: 'text', notNull: true },
    start_offset: { type: 'int', notNull: true },
    end_offset: { type: 'int', notNull: true },
    embedding: 'vector(1536)', // provisioning in 001 extensions; app treats as opaque for now
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('document_chunks', 'document_chunks_position_unique', 'UNIQUE (document_id, position)');
  pgm.createIndex('document_chunks', 'document_id');

  pgm.createTable('corpus_versions', {
    id: { type: 'uuid', notNull: true },
    canonical_title: { type: 'text', notNull: true },
    incoming_id: { type: 'uuid', notNull: true, references: 'legal_documents(id)' },
    supersedes_id: { type: 'uuid', references: 'legal_documents(id)' },
    valid_from: { type: 'timestamptz', notNull: true },
    valid_to: { type: 'timestamptz' },
    diff_summary: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('corpus_versions', 'canonical_title');

  // ---------- money & queue -----------------------------------------
  pgm.createTable('wallets', {
    id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    balance_toman: { type: 'bigint', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('wallets', 'wallets_user_unique', 'UNIQUE (user_id)');
  pgm.addConstraint('wallets', 'wallets_balance_never_negative', 'CHECK (balance_toman >= 0)');

  pgm.createTable('wallet_txns', {
    id: { type: 'uuid', notNull: true },
    wallet_id: { type: 'uuid', notNull: true, references: 'wallets(id)', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true }, // topup | purchase | refund | subscription
    amount_toman: { type: 'bigint', notNull: true }, // signed: credit +, debit −
    external_ref: { type: 'text' },
    note: { type: 'text' },
    at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('wallet_txns', 'wallet_txns_kind_domain', "CHECK (kind IN ('topup','purchase','refund','subscription'))");
  pgm.createIndex('wallet_txns', ['wallet_id', 'at']);
  // idempotency honor: same external_ref+kind can't land twice
  pgm.createIndex('wallet_txns', ['external_ref', 'kind'], { name: 'wallet_txns_ref_kind_unique_partially', unique: true, where: "external_ref IS NOT NULL" });

  pgm.createTable('purchases', {
    id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    kind: { type: 'text', notNull: true }, // consultation | subscription
    label: { type: 'text', notNull: true },
    minutes: { type: 'smallint' },
    feature: { type: 'text' },
    price_toman: { type: 'bigint', notNull: true },
    paid_via: { type: 'text', notNull: true },
    consumed: { type: 'boolean', notNull: true, default: false },
    refunded: { type: 'boolean', notNull: true, default: false },
    purchased_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('purchases', 'purchases_minutes_domain', "CHECK (minutes IS NULL OR minutes IN (10,20,30))");

  pgm.createTable('subscriptions', {
    id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    feature: { type: 'text', notNull: true }, // ai_chat | ai_filelab | ai_kitchen | ai_voice
    months: { type: 'smallint', notNull: true },
    price_toman: { type: 'bigint', notNull: true },
    started_at: { type: 'timestamptz', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('subscriptions', 'subscriptions_period_domain', "CHECK (months IN (1,3,12))");
  pgm.createIndex('subscriptions', ['user_id', 'feature']);

  pgm.createTable('consultation_tickets', {
    id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    phone: { type: 'text', notNull: true },
    purchase_id: { type: 'uuid', notNull: true, references: 'purchases(id)' },
    minutes: { type: 'smallint', notNull: true },
    status: { type: 'text', notNull: true, default: "'waiting'" },
    joined_at: { type: 'timestamptz', notNull: true },
    up_next_at: { type: 'timestamptz' },
    in_call_at: { type: 'timestamptz' },
    ended_at: { type: 'timestamptz' },
    cancelled_at: { type: 'timestamptz' },
    refund_issued: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('consultation_tickets', 'consultation_tickets_status_domain', "CHECK (status IN ('waiting','up_next','in_call','done','no_show','cancelled'))");
  pgm.createIndex('consultation_tickets', ['status', 'joined_at']);

  pgm.createTable('comms_panels', {
    id: { type: 'uuid', notNull: true },
    kind: { type: 'text', notNull: true }, // sms | call
    owner_id: { type: 'text', notNull: true }, // lawyer who wired it
    base_url: { type: 'text', notNull: true },
    credential_encrypted: { type: 'text' }, // AES at rest — never plaintext in SQL
    from_number: { type: 'text' },
    provider_label: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('comms_panels', 'comms_panels_kind_domain', "CHECK (kind IN ('sms','call'))");
  pgm.addConstraint('comms_panels', 'comms_panels_kind_unique', 'UNIQUE (kind)'); // one panel per kind per office (v1)

  pgm.createTable('notifications', {
    id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true },
    kind: { type: 'text', notNull: true },
    title_fa: { type: 'text', notNull: true },
    body_fa: { type: 'text', notNull: true },
    channels: { type: 'jsonb', notNull: true },
    delivered: { type: 'jsonb', notNull: true },
    read: { type: 'boolean', notNull: true, default: false },
    at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('notifications', ['user_id', 'read', 'at']);

  pgm.sql('CREATE INDEX IF NOT EXISTS legal_documents_body_normalized_trgm ON legal_documents USING gin (body_normalized gin_trgm_ops)');
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('notifications');
  pgm.dropTable('comms_panels');
  pgm.dropTable('consultation_tickets');
  pgm.dropTable('subscriptions');
  pgm.dropTable('purchases');
  pgm.dropTable('wallet_txns');
  pgm.dropTable('wallets');
  pgm.dropTable('corpus_versions');
  pgm.dropTable('document_chunks');
  pgm.dropTable('legal_documents');
  pgm.dropTable('ingestion_jobs');
  pgm.dropTable('knowledge_sources');
};
