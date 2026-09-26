'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2, XCircle } from 'lucide-react';
import { num, t, tx } from '@/i18n';
import { api, ApiError, type FileRecordView } from '@/lib/api';

/** Must match the API upload limit (orchestrator.controller FileInterceptor). */
const MAX_BYTES = 10 * 1024 * 1024;

interface Item {
  key: number;
  name: string;
  state: 'reading' | 'done' | 'failed';
  record?: FileRecordView;
  error?: string;
}

let seq = 1;

function kindLabel(kind: string | undefined): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'docx-or-zip':
      return 'DOCX';
    case 'text':
      return tx('متن', 'Text');
    case 'binary':
      return tx('فایل دودویی', 'Binary file');
    default:
      return kind && kind !== 'unknown' ? kind : tx('نوع نامشخص', 'Unknown type');
  }
}

export function FilesTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = (key: number, next: Partial<Item>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...next } : x)));

  async function upload(fileList: FileList | null) {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      const key = seq++;
      if (f.size > MAX_BYTES) {
        setItems((list) => [
          { key, name: f.name, state: 'failed', error: tx('حجم فایل بیش از ۱۰ مگابایت است.', 'The file is larger than 10 MB.') },
          ...list,
        ]);
        continue;
      }
      setItems((list) => [{ key, name: f.name, state: 'reading' }, ...list]);
      try {
        const form = new FormData();
        form.append('file', f);
        const r = await api.postForm<{ file: FileRecordView }>('/dashboard/orchestrator/files', form);
        patch(key, { state: 'done', record: r.file });
      } catch (e) {
        patch(key, {
          state: 'failed',
          error: e instanceof ApiError || e instanceof Error ? e.message : tx('بارگذاری انجام نشد.', 'Upload failed.'),
        });
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <FileUp size={40} strokeWidth={1.5} aria-hidden="true" />
        <div style={{ fontSize: 15, marginTop: 8 }}>{t('files.drop')}</div>
        <p className="hint" style={{ marginTop: 4 }}>
          {tx('PDF، DOCX یا متن؛ حداکثر ۱۰ مگابایت. نوع فایل خودکار تشخیص داده می‌شود.', 'PDF, DOCX or text, up to 10 MB. The file type is detected automatically.')}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf,text/*"
          onChange={(e) => void upload(e.currentTarget.files)}
        />
      </label>

      {items.length > 0 && (
        <div className="grid" style={{ gap: 12 }}>
          {items.map((f) => {
            const a = f.record?.analysis;
            return (
              <div key={f.key} className="card">
                <div className="title-row">
                  {f.state === 'reading' && <Loader2 size={20} className="spin" aria-hidden="true" />}
                  {f.state === 'done' && <CheckCircle2 size={20} className="ok-text" aria-hidden="true" />}
                  {f.state === 'failed' && <XCircle size={20} className="bad-text" aria-hidden="true" />}
                  <b style={{ fontSize: 14, flex: 1, overflowWrap: 'anywhere' }}>{f.name}</b>
                </div>
                {f.state === 'reading' && (
                  <>
                    <p className="hint" style={{ margin: '6px 0 0' }}>{t('files.analyzing')}</p>
                    <div className="progressbar indeterminate"><i /></div>
                  </>
                )}
                {f.state === 'failed' && <p className="form-error" role="alert" style={{ marginBottom: 0 }}>{f.error}</p>}
                {f.state === 'done' && a && (
                  <div style={{ marginTop: 10 }}>
                    <div className="row-actions">
                      <span className="pill teal">{kindLabel(a.kindGuess)}</span>
                      {typeof a.chars === 'number' && a.chars > 0 && <span className="pill">{tx(`${num(a.chars)} نویسه`, `${num(a.chars)} characters`)}</span>}
                      {a.needsOcr && <span className="pill bad">{tx('نیاز به تبدیل تصویر به متن (OCR)', 'Needs OCR')}</span>}
                      {a.languageHint === 'fa' && <span className="pill gold">{tx('فارسی', 'Persian')}</span>}
                      {a.languageHint === 'en' && <span className="pill gold">{tx('انگلیسی', 'English')}</span>}
                    </div>
                    {a.preview && (
                      <p className="hint" style={{ marginTop: 10, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
                        {a.preview.slice(0, 220)}…
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
