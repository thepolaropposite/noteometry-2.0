/**
 * TableDropIn — Phase 1 body for the table Drop-In™.
 *
 * Fixed 3×3 editable grid. Not a raw tldraw shape — every cell is just
 * a string in the Drop-In™ state. Phase 2 can add row/column add/delete
 * and richer cell types.
 */
import type { TableState } from './types';
import { updateTableState } from './dropInStore';

interface Props {
  pageId: string;
  dropInId: string;
  state: TableState;
}

export default function TableDropIn({ pageId, dropInId, state }: Props) {
  const setCell = (r: number, c: number, value: string) => {
    const rows = state.rows.map((row) => row.slice());
    if (!rows[r]) return;
    rows[r][c] = value;
    updateTableState(pageId, dropInId, { rows });
  };

  return (
    <div className="noteometry-dropin-table">
      {state.rows.map((row, r) => (
        <div key={r} className="noteometry-dropin-table-row">
          {row.map((cell, c) => (
            <input
              key={c}
              type="text"
              className="noteometry-dropin-table-cell"
              value={cell}
              onChange={(e) => setCell(r, c, e.target.value)}
              spellCheck={false}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
