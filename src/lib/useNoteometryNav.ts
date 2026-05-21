/**
 * useNoteometryNav
 *
 * OneNote-style navigation state: notebook → sections → pages.
 * Persists to localStorage so refresh keeps the same active page.
 *
 * Each page's canvas content lives in App.tsx as Noteometry-owned ink
 * records plus localStorage. Switching the active page loads that page's
 * records, so page content stays separate without tldraw's production
 * license gate or async IndexedDB persistence path.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { markError, markSaved, markSaving } from './saveStatus';

export interface NavSection {
  id: string;
  name: string;
  pageIds: string[];
}

export interface NavPage {
  id: string;
  title: string;
  sectionId: string;
  createdAt: number;
}

export interface NavState {
  notebookName: string;
  sections: NavSection[];
  pages: Record<string, NavPage>;
  activeSectionId: string;
  activePageId: string;
}

const STORAGE_KEY = 'noteometry-os:nav:v1';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function seedState(): NavState {
  const s1Id = makeId('s');
  const s2Id = makeId('s');
  const s3Id = makeId('s');
  const p1Id = makeId('p');
  const now = Date.now();
  return {
    notebookName: 'Noteometry',
    sections: [
      { id: s1Id, name: 'Noteometry', pageIds: [p1Id] },
      { id: s2Id, name: 'APUS', pageIds: [] },
      { id: s3Id, name: 'ELEN 202', pageIds: [] },
    ],
    pages: {
      [p1Id]: { id: p1Id, title: 'Untitled 1', sectionId: s1Id, createdAt: now },
    },
    activeSectionId: s1Id,
    activePageId: p1Id,
  };
}

function loadState(): NavState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as NavState;
    if (!parsed.sections?.length || !parsed.pages || !parsed.activePageId) return seedState();
    return parsed;
  } catch {
    return seedState();
  }
}

function saveState(state: NavState) {
  markSaving();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markSaved();
  } catch (e) {
    markError('nav', e);
  }
}

export interface NoteometryNav {
  state: NavState;
  activeSection: NavSection;
  activePage: NavPage;
  pagesInActiveSection: NavPage[];
  breadcrumb: string;
  setActiveSection: (sectionId: string) => void;
  setActivePage: (pageId: string) => void;
  addSection: (name: string) => string;
  addPage: () => string;
  renamePage: (pageId: string, title: string) => void;
  renameSection: (sectionId: string, name: string) => void;
  deletePage: (pageId: string) => void;
}

export function useNoteometryNav(): NoteometryNav {
  const [state, setState] = useState<NavState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const activeSection = useMemo(
    () => state.sections.find((s) => s.id === state.activeSectionId) ?? state.sections[0]!,
    [state.sections, state.activeSectionId]
  );
  const activePage = useMemo(
    () => state.pages[state.activePageId] ?? Object.values(state.pages)[0]!,
    [state.pages, state.activePageId]
  );
  const pagesInActiveSection = useMemo(
    () => activeSection.pageIds.map((id) => state.pages[id]).filter((p): p is NavPage => !!p),
    [activeSection, state.pages]
  );
  const breadcrumb = `${state.notebookName} / ${activeSection.name} / ${activePage.title}`;

  const setActiveSection = useCallback((sectionId: string) => {
    setState((prev) => {
      const target = prev.sections.find((s) => s.id === sectionId);
      if (!target) return prev;
      const firstPageId = target.pageIds[0];
      if (firstPageId) {
        return { ...prev, activeSectionId: sectionId, activePageId: firstPageId };
      }
      // Section has no pages — create one and activate it so the canvas
      // never lands on a non-existent page reference.
      const newPageId = makeId('p');
      const newPage: NavPage = {
        id: newPageId,
        title: 'Untitled 1',
        sectionId: sectionId,
        createdAt: Date.now(),
      };
      return {
        ...prev,
        activeSectionId: sectionId,
        activePageId: newPageId,
        sections: prev.sections.map((s) => s.id === sectionId ? { ...s, pageIds: [newPageId] } : s),
        pages: { ...prev.pages, [newPageId]: newPage },
      };
    });
  }, []);

  const setActivePage = useCallback((pageId: string) => {
    setState((prev) => {
      const page = prev.pages[pageId];
      if (!page) return prev;
      return { ...prev, activeSectionId: page.sectionId, activePageId: pageId };
    });
  }, []);

  const addSection = useCallback((name: string) => {
    const sectionId = makeId('s');
    setState((prev) => ({
      ...prev,
      sections: [...prev.sections, { id: sectionId, name, pageIds: [] }],
    }));
    return sectionId;
  }, []);

  const addPage = useCallback(() => {
    const pageId = makeId('p');
    setState((prev) => {
      const section = prev.sections.find((s) => s.id === prev.activeSectionId) ?? prev.sections[0]!;
      const idx = section.pageIds.length + 1;
      const title = `Untitled ${idx}`;
      const page: NavPage = { id: pageId, title, sectionId: section.id, createdAt: Date.now() };
      return {
        ...prev,
        activePageId: pageId,
        sections: prev.sections.map((s) => s.id === section.id ? { ...s, pageIds: [...s.pageIds, pageId] } : s),
        pages: { ...prev.pages, [pageId]: page },
      };
    });
    return pageId;
  }, []);

  const renamePage = useCallback((pageId: string, title: string) => {
    setState((prev) => {
      const page = prev.pages[pageId];
      if (!page) return prev;
      return { ...prev, pages: { ...prev.pages, [pageId]: { ...page, title } } };
    });
  }, []);

  const renameSection = useCallback((sectionId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => s.id === sectionId ? { ...s, name } : s),
    }));
  }, []);

  const deletePage = useCallback((pageId: string) => {
    setState((prev) => {
      const page = prev.pages[pageId];
      if (!page) return prev;
      const sections = prev.sections.map((s) => s.id === page.sectionId
        ? { ...s, pageIds: s.pageIds.filter((id) => id !== pageId) }
        : s
      );
      const remaining = { ...prev.pages };
      delete remaining[pageId];
      // If we just removed the active page, fall back to the first
      // remaining page in the same section, else any page anywhere, else
      // synthesize a fresh blank.
      let nextActivePage = prev.activePageId;
      let nextActiveSection = prev.activeSectionId;
      if (prev.activePageId === pageId) {
        const sameSection = sections.find((s) => s.id === page.sectionId);
        const fallback = sameSection?.pageIds[0] ?? Object.keys(remaining)[0];
        if (fallback) {
          nextActivePage = fallback;
          nextActiveSection = remaining[fallback]!.sectionId;
        } else {
          const newPageId = makeId('p');
          const newPage: NavPage = {
            id: newPageId,
            title: 'Untitled 1',
            sectionId: page.sectionId,
            createdAt: Date.now(),
          };
          remaining[newPageId] = newPage;
          const idx = sections.findIndex((s) => s.id === page.sectionId);
          if (idx >= 0) sections[idx] = { ...sections[idx]!, pageIds: [newPageId] };
          nextActivePage = newPageId;
          nextActiveSection = page.sectionId;
        }
      }
      return {
        ...prev,
        sections,
        pages: remaining,
        activePageId: nextActivePage,
        activeSectionId: nextActiveSection,
      };
    });
  }, []);

  return {
    state,
    activeSection,
    activePage,
    pagesInActiveSection,
    breadcrumb,
    setActiveSection,
    setActivePage,
    addSection,
    addPage,
    renamePage,
    renameSection,
    deletePage,
  };
}
