'use client';

import { useRef, useState } from 'react';
import { t } from '@/i18n';
import { api, type FileRecordView } from '@/lib/api';

interface Done {
  record: FileRecordView;
}

export function FilesTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Array<{ name: string; progress: 'reading' | 'done'; result?: Done }>>([]);

  async function upload(fileList: FileList | null) {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      setQueue((q) => [...q, { name: f.name, progress: 'reading' }]);
      try {
        const form = new FormData();
        form.append('file', f);
        const r = await api.postForm<{ file: FileRecordView }>('/dashboard/orchestrator/files', form);
        setQueue((q) => q.map((x) => (x.name === f.name && x.progress === 'reading' ? { ...x, progress: 'done', result: { record: r.file } } : x)));
      } catch {
        setQueue((q) => q.map((x) => (x.name === f.name ? { ...x, progress: 'done' } : x)));
      }
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <div style={{ fontSize: 42 }}>📥</div>
        <div style={{ fontSize: 15, marginTop: 6 }}>{t('files.drop')}</div>
        <p className="hint" style={{ marginTop: 4 }}>pdf، docx، txt — لیدر خودش می‌فهمد چی است</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void upload(e.currentTarget.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="grid" style={{ gap: 12 }}>
          {queue.map((f, i) => (
            <div key={i} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{f.progress === 'done' ? '✅' : '⏳'}</span>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 14 }}>{f.name}</b>
                  {f.progress === 'reading' && (
                    <>
                      <p className="hint" style={{ margin: '4px 0 0' }}>{t('files.analyzing')}</p>
                      <div className="progressbar"><i style={{ width: '45%' }} /></div>
                    </>
                  )}
                </div>
              </div>
              {f.progress === 'done' && f.result && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="pill teal">{f.result.record.analysis?.kindGuess ?? 'unknown'}</span>
                    <span className="pill">{f.result.record.analysis?.chars ?? 0} کاراکتر</span>
                    {f.result.record.analysis?.needsOcr && <span className="pill bad">نیاز به OCR</span>}
                    {f.result.record.analysis?.languageHint === 'fa' && <span className="pill gold">فارسی</span>}
                  </div>
                  {f.result.record.analysis?.preview && (
                    <p className="hint" style={{ marginTop: 8, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
                      {f.result.record.analysis.preview.slice(0, 220)}…
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
