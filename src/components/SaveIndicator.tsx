/**
 * SaveIndicator — colored dot that reflects the global persistence
 * status. No words unless something is wrong; tooltip carries the
 * detail. Sits inside the top notebook bar so Dan glances up and
 * confirms.
 */
import { useSaveStatus } from '../lib/saveStatus';

export default function SaveIndicator() {
  const { status, lastError, lastSavedAt } = useSaveStatus();

  const dotClass = (() => {
    switch (status) {
      case 'saving': return 'is-saving';
      case 'error': return 'is-error';
      case 'saved': return 'is-saved';
      default: return 'is-idle';
    }
  })();

  const title = (() => {
    if (status === 'error' && lastError) return `Save error (${lastError.label}): ${lastError.message}`;
    if (status === 'saving') return 'Saving…';
    if (status === 'saved') return 'Saved.';
    if (lastSavedAt) return `Saved · ${new Date(lastSavedAt).toLocaleTimeString()}`;
    return 'Saved locally.';
  })();

  return (
    <div className={`noteometry-save-dot ${dotClass}`} role="status" aria-live="polite" title={title}>
      <span className="noteometry-save-dot-circle" aria-hidden="true" />
      {status === 'error' && <span className="noteometry-save-dot-label">Save error</span>}
    </div>
  );
}
