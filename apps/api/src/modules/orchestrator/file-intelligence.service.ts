import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { PythonWorkerService } from './python-worker.service';
import { InProcessAgentEventBus } from './agent-event-bus';

export interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type AnalysisStatus = 'completed' | 'completed_inline' | 'queued';

export interface FileRecord {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  sha256: string;
  storageKey: string;
  uploadedBy: string;
  uploadedAt: string;
  /**
   * FIELD REVIEW 2026-09-05 #10: sensitivity moves WITH the file, not only
   * with the upload call. A privileged brief later attached to a chat must
   * force the task local-only — the caller's default 'normal' must never
   * silently downshift it.
   */
  sensitivity: 'privileged' | 'normal';
  /** filled once analysis lands (python or inline pre-read) */
  analysis: {
    status: AnalysisStatus;
    kindGuess?: string;
    chars?: number;
    needsOcr?: boolean;
    preview?: string; // first 400 chars — safe for chat UI
    languageHint?: 'fa' | 'en' | 'mixed' | 'unknown';
  } | null;
}

const PREVIEW_LEN = 400;
const POLL_TIMEOUT_MS = 1800;
const POLL_INTERVAL_MS = 150;

/**
 * The Leader's file reader (P1e). Uploads land in the StorageProvider (SPEC §8
 * ports only — never raw fs outside the adapter), get sha256'd, then analyzed
 * by the python sidecar when reachable; otherwise an honest INLINE pre-read for
 * text files keeps the conversation flowing (SPEC §2 failure domains).
 */
@Injectable()
export class FileIntelligenceService {
  private readonly logger = new Logger(FileIntelligenceService.name);
  private readonly records = new Map<string, FileRecord>();

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly pyj: PythonWorkerService,
    @Optional() private readonly bus?: InProcessAgentEventBus,
  ) {}

  async register(
    file: UploadedFilePayload,
    uploadedBy: string,
    sensitivity: 'privileged' | 'normal' = 'normal',
  ): Promise<FileRecord> {
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const safeName = file.originalname.replace(/[^\w.\-آ-ی]+/g, '_').slice(0, 120);
    const key = `uploads/${sha256}/${safeName}`;
    await this.storage.put({
      key,
      content: file.buffer,
      contentType: file.mimetype,
      metadata: { uploadedBy, sha256 },
    });

    const record: FileRecord = {
      fileId: sha256.slice(0, 16),
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      sha256,
      storageKey: key,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      sensitivity,
      analysis: null,
    };
    this.records.set(record.fileId, record);
    this.bus?.emit({
      kind: 'file.uploaded',
      at: new Date().toISOString(),
      taskId: record.fileId,
      agentId: 'legal-leader',
      detail: `uploads/${record.fileId} (${record.size} bytes, ${record.mimetype})`,
    });
    return record;
  }

  get(fileId: string): FileRecord | undefined {
    return this.records.get(fileId);
  }

  listByUser(userId: string): FileRecord[] {
    return [...this.records.values()].filter((r) => r.uploadedBy === userId);
  }

  /** Analyze a stored file. Python sidecar preferred; inline fallback for
   *  plain text keeps the Leader responsive when the queue is down. */
  async analyze(fileId: string): Promise<FileRecord> {
    const record = this.need(fileId);
    const buffer = await this.storage.get(record.storageKey);

    const dataB64 = buffer.toString('base64');
    const digestJob = await this.pyj.enqueue('file_digest', { data_b64: dataB64, filename: record.filename });
    const extractJob = await this.pyj.enqueue('extract_any', { data_b64: dataB64, filename: record.filename });

    if (digestJob.queued && extractJob.queued) {
      const [digest, extract] = await Promise.all([
        this.poll(digestJob.jobId),
        this.poll(extractJob.jobId),
      ]);
      if (digest?.ok && extract?.ok) {
        record.analysis = {
          status: 'completed',
          kindGuess: String(digest.output?.kindGuess ?? 'unknown'),
          chars: Number(extract.output?.chars ?? 0),
          needsOcr: Boolean(extract.output?.needs_ocr),
          preview: String(extract.output?.text ?? '').slice(0, PREVIEW_LEN),
          languageHint: detectLanguageHint(String(extract.output?.text ?? '')),
        };
        this.bus?.emit({
          kind: 'file.analyzed',
          at: new Date().toISOString(),
          taskId: record.fileId,
          agentId: 'legal-leader',
          detail: `via python sidecar: kind=${record.analysis.kindGuess}`,
        });
        return record;
      }
    }

    // Queue down / worker absent → honest inline pre-read for text, or a
    // truthful digest-only analysis for binary (no invented content!).
    const inline = inlinePreRead(buffer, record.filename, record.mimetype);
    record.analysis = inline;
    this.logger.log(`file ${fileId} analyzed inline (status=${inline!.status})`);
    this.bus?.emit({
      kind: 'file.analyzed',
      at: new Date().toISOString(),
      taskId: record.fileId,
      agentId: 'legal-leader',
      detail: `inline fallback: kind=${record.analysis!.kindGuess}`,
    });
    return record;
  }

  /**
   * FULL text extraction for the corpus shelf (P2-T5). Unlike `analyze`
   * which keeps a 400-char preview for chat, this returns the whole body —
   * or nothing, honestly, when the file kind cannot be read now. Returns
   * {text|null, reason} so the caller never shelves imagined content.
   */
  async shelfText(fileId: string): Promise<{ text: string | null; reason: string; filename: string }> {
    const record = this.records.get(fileId);
    if (!record) return { text: null, reason: 'فایل یافت نشد', filename: '' };
    const buffer = await this.storage.get(record.storageKey);

    const texty =
      record.mimetype.startsWith('text/') ||
      ['.txt', '.md', '.json', '.csv'].some((ext) => record.filename.toLowerCase().endsWith(ext));
    if (texty) {
      return { text: buffer.toString('utf8'), reason: 'ok', filename: record.filename };
    }

    // binary → the python sidecar is the only honest extractor
    const job = await this.pyj.enqueue('extract_any', {
      data_b64: buffer.toString('base64'),
      filename: record.filename,
    });
    if (job.queued) {
      const result = await this.poll(job.jobId);
      if (result?.ok) {
        const text = String(result.output?.text ?? '');
        if (text.trim().length > 0) {
          return {
            text,
            reason: 'ok',
            filename: record.filename,
          };
        }
        return { text: null, reason: 'استخراج متن خالی برگشت', filename: record.filename };
      }
    }
    return {
      text: null,
      reason:
        record.analysis?.needsOcr ?? record.mimetype.includes('image')
          ? 'فایل نیاز به OCR دارد؛ ابتدا OCR را روشن کنید'
          : 'کارگر پایتون در دسترس نیست؛ فعلاً نمی‌توان متن را استخراج کرد',
      filename: record.filename,
    };
  }

  /** existence probe for the corpus controller (read-only). */
  probe(fileId: string): { uploadedBy: string; filename: string } | null {
    const r = this.records.get(fileId);
    return r ? { uploadedBy: r.uploadedBy, filename: r.filename } : null;
  }

  private async poll(jobId: string): Promise<Awaited<ReturnType<PythonWorkerService['result']>>> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const r = await this.pyj.result(jobId);
      if (r) return r;
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    }
    return null;
  }

  private need(fileId: string): FileRecord {
    const r = this.records.get(fileId);
    if (!r) throw new Error(`file not found: ${fileId}`);
    return r;
  }
}

function detectLanguageHint(text: string): 'fa' | 'en' | 'mixed' | 'unknown' {
  if (!text) return 'unknown';
  const fa = (text.match(/[ء-ی]/g) ?? []).length;
  const en = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (fa === 0 && en === 0) return 'unknown';
  const ratio = fa / (fa + en);
  if (ratio > 0.7) return 'fa';
  if (ratio < 0.3) return 'en';
  return 'mixed';
}

function inlinePreRead(buffer: Buffer, filename: string, mimetype: string): FileRecord['analysis'] {
  const looksTexty =
    mimetype.startsWith('text/') ||
    ['.txt', '.md', '.json', '.csv'].some((ext) => filename.toLowerCase().endsWith(ext));
  if (looksTexty) {
    const text = buffer.toString('utf8');
    return {
      status: 'completed_inline',
      kindGuess: 'text',
      chars: text.length,
      preview: text.slice(0, PREVIEW_LEN),
      languageHint: detectLanguageHint(text),
    };
  }
  const head = buffer.slice(0, 8);
  const magic = head.toString('latin1').startsWith('%PDF')
    ? 'pdf'
    : head[0] === 0x50 && head[1] === 0x4b
      ? 'docx-or-zip'
      : 'binary';
  return {
    status: 'completed_inline',
    kindGuess: magic,
    preview: '',
    languageHint: 'unknown',
  };
}
