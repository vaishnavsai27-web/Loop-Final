import { useEffect, useRef } from 'react';
import { Link } from '../lib/router';

export function Loading({ label = 'Loading' }) {
  return <div className="loading" role="status"><span className="pulse" aria-hidden="true" />{label}…</div>;
}

export function ErrorState({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice notice-error" role="alert">
      <strong>{error.message || 'Something went wrong.'}</strong>
      {onRetry && <div><button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button></div>}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3 className="h3">{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function PageHead({ title, children, actions }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="h1">{title}</h1>
        {actions}
      </div>
      {children && <p className="lede">{children}</p>}
    </header>
  );
}

/** A labelled control. Errors sit outside the <label> so they never change the field's accessible name. */
export function Field({ label, hint, error, errorId, children }) {
  const field = (
    <label className="field">
      <span>{label}{hint && <span className="hint"> — {hint}</span>}</span>
      {children}
    </label>
  );
  if (!error) return field;
  return <div className="field-group">{field}<span className="field-error" id={errorId}>{error}</span></div>;
}

export function Meter({ label, value, text }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  return (
    <div className="meter">
      <div className="meter-label"><span>{label}</span><b>{text ?? `${pct}%`}</b></div>
      {value !== null && value !== undefined && (
        <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Native <dialog> so focus trapping, Escape and the backdrop come from the browser. */
export function Dialog({ open, onClose, title, children, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      {open && (
        <div className="dialog-body">
          <h2 id="dialog-title" className="h3">{title}</h2>
          {children}
          {actions && <div className="dialog-actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs({ value, onChange, items, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}

export const StatusBadge = ({ status }) => {
  const tone = { APPROVED: 'ok', PUBLISHED: 'ok', RESOLVED: 'ok', ACTIVE: 'ok', CLEAN: 'ok',
    PENDING: 'warn', PENDING_REVIEW: 'warn', QUARANTINED: 'warn', PROCESSING: 'warn', UPLOADING: 'warn', OPEN: 'warn', UNDER_REVIEW: 'warn',
    REJECTED: 'danger', TAKEN_DOWN: 'danger', PROCESSING_FAILED: 'danger', INFECTED: 'danger', HIDDEN: 'danger' }[status] || '';
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{String(status || '').replace(/_/g, ' ').toLowerCase()}</span>;
};

export { Link };
