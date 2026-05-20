/**
 * PageRail — right-side page list with collapse handle.
 *
 * Visible affordances (no text labels):
 *   + icon         → add a new page
 *   ‹ handle       → collapse the rail to a thin spine
 *
 * Collapsed state lives in localStorage so the layout choice survives
 * reload.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import type { NoteometryNav } from '../lib/useNoteometryNav';
import { ChevronRightIcon, ChevronLeftIcon, PlusIcon } from './Icons';
import { markError, markSaved, markSaving } from '../lib/saveStatus';

const COLLAPSE_KEY = 'noteometry-os:page-rail-collapsed:v1';

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

function writeCollapsed(v: boolean) {
  markSaving();
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); markSaved(); }
  catch (e) { markError('nav', e); }
}

interface Props {
  nav: NoteometryNav;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const RAIL_WIDTH_OPEN = '200px';
const RAIL_WIDTH_COLLAPSED = '0px';

export default function PageRail({ nav, onCollapsedChange }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => { writeCollapsed(collapsed); }, [collapsed]);

  // Publish the rail's reserved width before paint so a collapsed rail
  // cannot leave a one-frame or persistent 200 px dark strip. Also notify
  // the app shell so canvas inset classes reflect the actual rail state
  // instead of assuming navigation always reserves layout space.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      '--nm-page-rail-width',
      collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_OPEN
    );
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  const onAddPage = () => { nav.addPage(); };
  const onRenamePage = (pageId: string, currentTitle: string) => {
    const next = window.prompt('Rename page', currentTitle);
    if (!next || !next.trim()) return;
    nav.renamePage(pageId, next.trim());
  };
  const onDeletePage = (pageId: string, title: string) => {
    if (!window.confirm(`Delete page "${title}"?`)) return;
    nav.deletePage(pageId);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="noteometry-page-rail-handle"
        title="Show pages"
        aria-label="Show pages"
        onClick={() => setCollapsed(false)}
      >
        <ChevronLeftIcon />
      </button>
    );
  }

  return (
    <aside className="noteometry-page-rail" aria-label="Pages">
      <header className="noteometry-page-rail-head">
        <button
          type="button"
          className="noteometry-page-rail-icon noteometry-page-rail-icon-primary"
          onClick={onAddPage}
          title="New page"
          aria-label="New page"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="noteometry-page-rail-icon"
          onClick={() => setCollapsed(true)}
          title="Hide pages"
          aria-label="Hide pages"
        >
          <ChevronRightIcon />
        </button>
      </header>
      <ul className="noteometry-page-rail-list">
        {nav.pagesInActiveSection.map((p) => {
          const active = p.id === nav.activePage.id;
          return (
            <li
              key={p.id}
              className={`noteometry-page-rail-item${active ? ' is-active' : ''}`}
              onClick={() => nav.setActivePage(p.id)}
              onDoubleClick={() => onRenamePage(p.id, p.title)}
              title={p.title}
            >
              <span className="noteometry-page-rail-title">{p.title}</span>
              <button
                type="button"
                className="noteometry-page-rail-delete"
                onClick={(e) => { e.stopPropagation(); onDeletePage(p.id, p.title); }}
                title={`Delete ${p.title}`}
                aria-label={`Delete ${p.title}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
