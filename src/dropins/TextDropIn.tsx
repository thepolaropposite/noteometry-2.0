/**
 * TextDropIn — Phase 1 body for the text Drop-In™.
 *
 * Editable textarea persisting through the Drop-In™ store. Crucially
 * this is NOT a raw tldraw text shape — text content lives in the
 * Drop-In™ record (Law 2 / Law 3).
 */
import type { TextState } from './types';
import { updateTextState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: TextState;
}

export default function TextDropIn({ pageId, dropInId, state }: Props) {
  return (
    <textarea
      className="noteometry-dropin-text"
      value={state.text}
      onChange={(e) => updateTextState(pageId, dropInId, { text: e.target.value })}
      placeholder="Type here…"
      spellCheck={false}
    />
  );
}
