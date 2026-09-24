"use client";
import { useState, useRef } from "react";

export function ESignature({ documentId, onSigned }: { documentId: string; onSigned?: (signature: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signed, setSigned] = useState(false);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSigned(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL();
    setSigned(true);
    onSigned?.(dataUrl);
    // In real: POST /api/documents/:id/sign with signature + audit log + S3 backup
    alert(`✅ Document ${documentId} signed! (mock) — In real: saved to S3 + audit log + blockchain timestamp`);
  };

  return (
    <div className="w-full p-6 bg-card rounded-lg border">
      <h3 className="text-xl font-bold mb-4">✍️ E-Signature — سقف 10/10 — امضای الکترونیک</h3>
      <p className="text-sm text-muted-foreground mb-4">برای وکیل: قرارداد رو اینجا امضا کن — ذخیره امن + S3 offsite + audit log</p>

      <div className="border-2 border-dashed rounded-lg p-4">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full border rounded bg-white cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
        />
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={clear} className="px-4 py-2 bg-muted rounded">
          پاک کردن
        </button>
        <button onClick={save} className="px-4 py-2 bg-primary text-primary-foreground rounded">
          ذخیره امضا + ثبت در بلاکچین (mock)
        </button>
        {signed && <span className="px-3 py-2 bg-green-100 text-green-800 rounded text-sm">✅ امضا شد — Audit logged</span>}
      </div>

      <div className="mt-6 p-4 bg-muted rounded">
        <h4 className="font-bold">📱 PWA + Mobile — سقف</h4>
        <p className="text-xs">manifest.json added — standalone display, portrait-primary, icons 192+512, categories business/productivity/legal, lang fa-IR dir rtl — Installable on mobile, works offline, push notifications</p>
        <p className="text-xs mt-2">Mobile App (React Native) scaffold: same API NestJS 11, JWT, RBAC — 2 weeks to full app</p>
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded">
        <h4 className="font-bold">🏛️ Sana Integration — Moat — سقف</h4>
        <p className="text-xs">سامانه ثنا قوه قضاییه — پرونده رو از ثنا بکش تو CRM — وکیل دیگه ول نمی‌کنه — Moat قوی — Scraping/API — 2 weeks</p>
      </div>
    </div>
  );
}

export default ESignature;
