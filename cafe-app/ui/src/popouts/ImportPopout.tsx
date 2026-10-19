import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ApiError } from '../api';
import { Modal } from './Modal';
import { importReportLines, type ImportReport } from './titleHelpers';

export function ImportPopout() {
  const { closePopout, refresh } = useStore();
  const [report, setReport] = useState<{ file: string; r: ImportReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true); setError(null); setReport(null);
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error ?? `Import failed (${res.status})`);
      setReport({ file: file.name, r: data });
      await refresh(); // new ideas, new stars
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  return (
    <Modal title={<><div className="pop-id">Import</div><h2>Bring in ideas from the Café form</h2></>} label="Import" onClose={closePopout} width={860} height={760} className="small-pop">
      <div className="pop-single">
        <div
          className={`dropzone${over ? ' over' : ''}`} data-testid="dropzone"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files[0]); }}
        >
          <div className="dz-t">{busy ? 'Reading the export…' : 'Drop the export here'}</div>
          <div className="hint">A .csv or .xlsx from Microsoft Forms. Rows already in the Café are skipped, so importing the same file twice is safe.</div>
          <input ref={input} type="file" accept=".csv,.xlsx" data-autofocus data-testid="import-file" aria-label="Choose an export file" disabled={busy}
            onChange={(e) => void send(e.target.files?.[0])} />
        </div>
        {error && <div className="pop-notice error" role="status">{error}</div>}
        {report && (
          <section className="sec" data-testid="import-report">
            <h3>Imported <span className="sec-n">{report.file}</span></h3>
            <ul className="report">
              {importReportLines(report.r).map((l, i) => <li key={i} className={`rp-${l.kind}`}>{l.text}</li>)}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
