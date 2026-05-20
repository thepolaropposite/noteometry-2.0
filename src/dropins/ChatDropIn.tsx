/**
 * ChatDropIn — Phase 1 body for the chat Drop-In™.
 *
 * Local-only message log + composer. NO AI wiring yet (per the Phase 1
 * spec). Messages persist through the Drop-In™ store. When the AI
 * pipeline lands for canvas-anchored chat, it routes through the same
 * provider layer the AI Pane uses (Law 10) — not a parallel client.
 *
 * Note: the persistent AI Pane (Law 4) is the primary AI surface. A
 * Chat Drop-In™ is a *secondary* canvas-anchored conversation, not a
 * replacement for the pane.
 */
import { useEffect, useRef } from 'react';
import type { ChatState } from './types';
import { appendChatMessage, updateChatState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: ChatState;
}

export default function ChatDropIn({ pageId, dropInId, state }: Props) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length]);

  const send = () => {
    const text = state.draft.trim();
    if (!text) return;
    appendChatMessage(pageId, dropInId, { role: 'user', text });
    updateChatState(pageId, dropInId, { draft: '' });
  };

  return (
    <div className="noteometry-dropin-chat">
      <div className="noteometry-dropin-chat-log" ref={logRef}>
        {state.messages.length === 0 && (
          <div className="noteometry-dropin-empty">
            Local chat shell. Phase 2 wires this into the AI provider layer.
          </div>
        )}
        {state.messages.map((m) => (
          <div key={m.id} className={`noteometry-dropin-chat-msg is-${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="noteometry-dropin-chat-composer">
        <textarea
          value={state.draft}
          onChange={(e) => updateChatState(pageId, dropInId, { draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          rows={2}
          spellCheck={false}
        />
        <button type="button" onClick={send} className="noteometry-dropin-chat-send">Send</button>
      </div>
    </div>
  );
}
