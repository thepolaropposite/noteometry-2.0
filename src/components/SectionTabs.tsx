/**
 * SectionTabs — top OneNote-style breadcrumb + section strip.
 *
 * Right-side slot of the breadcrumb hosts the save dot so persistence
 * status is visible without taking up real estate.
 */
import type { NoteometryNav } from '../lib/useNoteometryNav';
import { PlusIcon } from './Icons';
import SaveIndicator from './SaveIndicator';

interface Props {
  nav: NoteometryNav;
}

export default function SectionTabs({ nav }: Props) {
  const onAddSection = () => {
    const name = window.prompt('New section name', `Section ${nav.state.sections.length + 1}`);
    if (!name || !name.trim()) return;
    nav.addSection(name.trim());
  };
  const onRenameSection = (id: string, currentName: string) => {
    const name = window.prompt('Rename section', currentName);
    if (!name || !name.trim()) return;
    nav.renameSection(id, name.trim());
  };
  const onRenamePage = () => {
    const name = window.prompt('Rename current page', nav.activePage.title);
    if (!name || !name.trim()) return;
    nav.renamePage(nav.activePage.id, name.trim());
  };

  return (
    <header className="noteometry-topbar" aria-label="Notebook navigation">
      <div className="noteometry-breadcrumb-row">
        <div className="noteometry-breadcrumb" onDoubleClick={onRenamePage} title="Double-click to rename current page">
          <span className="noteometry-breadcrumb-notebook">{nav.state.notebookName}</span>
          <span className="noteometry-breadcrumb-sep">/</span>
          <span className="noteometry-breadcrumb-section">{nav.activeSection.name}</span>
          <span className="noteometry-breadcrumb-sep">/</span>
          <span className="noteometry-breadcrumb-page">{nav.activePage.title}</span>
        </div>
        <SaveIndicator />
      </div>

      <nav className="noteometry-section-tabs" aria-label="Sections">
        {nav.state.sections.map((s) => {
          const active = s.id === nav.activeSection.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`noteometry-section-tab${active ? ' is-active' : ''}`}
              onClick={() => nav.setActiveSection(s.id)}
              onDoubleClick={() => onRenameSection(s.id, s.name)}
              title={`${s.name} — double-click to rename`}
            >
              <span className="noteometry-section-tab-name">{s.name}</span>
              <span className="noteometry-section-tab-count">{s.pageIds.length}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="noteometry-section-tab-add"
          onClick={onAddSection}
          title="New section"
          aria-label="New section"
        >
          <PlusIcon />
        </button>
      </nav>
    </header>
  );
}
