/**
 * TableDropIn — editable grid with math-aware preview.
 *
 * Cells stay plain strings in Drop-In™ state. Edit mode behaves like a
 * compact spreadsheet; preview mode renders mixed text, LaTeX, and raw
 * MathML through KaTeX for vision capture.
 */
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { TableState } from './types';
import { updateTableState } from './dropInStore';
import { renderAsKatexHtml } from '../lib/mathml';

interface Props {
  pageId: string;
  dropInId: string;
  state: TableState;
}

interface CellPoint {
  row: number;
  col: number;
}

function getColumnCount(rows: string[][]): number {
  return Math.max(1, ...rows.map((row) => row.length));
}

function normalizeRows(rows: string[][]): string[][] {
  const source = rows.length > 0 ? rows : [['']];
  const colCount = getColumnCount(source);
  return source.map((row) => {
    const next = row.slice(0, colCount);
    while (next.length < colCount) next.push('');
    return next;
  });
}

function emptyRow(colCount: number): string[] {
  return Array.from({ length: colCount }, () => '');
}

function parseClipboardMatrix(text: string): string[][] {
  const cleaned = text.replace(/\r/g, '').replace(/\n$/, '');
  if (!cleaned) return [['']];
  const lines = cleaned.split('\n');
  const hasTabs = cleaned.includes('\t');
  return lines.map((line) => {
    if (hasTabs) return line.split('\t');
    if (lines.length > 1 && line.includes(',')) return line.split(',');
    return [line];
  });
}

export default function TableDropIn({ pageId, dropInId, state }: Props) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [activeCell, setActiveCell] = useState<CellPoint>({ row: 0, col: 0 });
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rows = useMemo(() => normalizeRows(state.rows), [state.rows]);
  const colCount = getColumnCount(rows);

  const commitRows = (nextRows: string[][]) => {
    updateTableState(pageId, dropInId, { rows: normalizeRows(nextRows) });
  };

  const focusCell = (row: number, col: number) => {
    window.requestAnimationFrame(() => {
      const clampedRow = Math.max(0, Math.min(row, rows.length - 1));
      const clampedCol = Math.max(0, Math.min(col, colCount - 1));
      const target = cellRefs.current.get(`${row}:${col}`)
        ?? cellRefs.current.get(`${clampedRow}:${clampedCol}`);
      target?.focus();
      target?.select();
      setActiveCell({ row: Math.max(0, row), col: Math.max(0, col) });
    });
  };

  const setCell = (row: number, col: number, value: string) => {
    const nextRows = rows.map((r) => r.slice());
    nextRows[row][col] = value;
    commitRows(nextRows);
  };

  const addRow = () => {
    const insertAt = Math.min(activeCell.row + 1, rows.length);
    const nextRows = [
      ...rows.slice(0, insertAt),
      emptyRow(colCount),
      ...rows.slice(insertAt),
    ];
    commitRows(nextRows);
    focusCell(insertAt, activeCell.col);
  };

  const addColumn = () => {
    const insertAt = Math.min(activeCell.col + 1, colCount);
    const nextRows = rows.map((row) => [
      ...row.slice(0, insertAt),
      '',
      ...row.slice(insertAt),
    ]);
    commitRows(nextRows);
    focusCell(activeCell.row, insertAt);
  };

  const deleteRow = () => {
    if (rows.length <= 1) return;
    const nextRows = rows.filter((_, index) => index !== activeCell.row);
    commitRows(nextRows);
    focusCell(Math.min(activeCell.row, nextRows.length - 1), activeCell.col);
  };

  const deleteColumn = () => {
    if (colCount <= 1) return;
    const nextRows = rows.map((row) => row.filter((_, index) => index !== activeCell.col));
    commitRows(nextRows);
    focusCell(activeCell.row, Math.min(activeCell.col, colCount - 2));
  };

  const clearTable = () => {
    commitRows(rows.map((row) => row.map(() => '')));
    focusCell(activeCell.row, activeCell.col);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    e.preventDefault();
    const direction = e.shiftKey ? -1 : 1;
    let nextRow = row;
    let nextCol = col;
    if (e.key === 'Tab') {
      nextCol += direction;
      if (nextCol >= colCount) {
        nextCol = 0;
        nextRow += 1;
      } else if (nextCol < 0) {
        nextCol = colCount - 1;
        nextRow -= 1;
      }
    } else {
      nextRow += direction;
    }

    if (nextRow >= rows.length) {
      commitRows([...rows, emptyRow(colCount)]);
      focusCell(rows.length, nextCol);
      return;
    }
    focusCell(nextRow, nextCol);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    const matrix = parseClipboardMatrix(text);
    if (matrix.length === 1 && matrix[0].length === 1) return;
    e.preventDefault();
    const neededRows = row + matrix.length;
    const neededCols = col + Math.max(...matrix.map((r) => r.length));
    const nextRows = rows.map((r) => r.slice());
    while (nextRows.length < neededRows) nextRows.push(emptyRow(colCount));
    for (const nextRow of nextRows) {
      while (nextRow.length < neededCols) nextRow.push('');
    }
    matrix.forEach((sourceRow, rOffset) => {
      sourceRow.forEach((value, cOffset) => {
        nextRows[row + rOffset][col + cOffset] = value;
      });
    });
    commitRows(nextRows);
    focusCell(row, col);
  };

  const rememberCell = (row: number, col: number) => (node: HTMLInputElement | null) => {
    const key = `${row}:${col}`;
    if (node) cellRefs.current.set(key, node);
    else cellRefs.current.delete(key);
  };

  return (
    <div className="noteometry-dropin-table">
      <div className="noteometry-dropin-toolbar" role="toolbar" aria-label="Table tools">
        <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>Edit</button>
        <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}>Preview</button>
        <span className="noteometry-dropin-toolbar-divider" />
        <button type="button" onClick={addRow}>+ Row</button>
        <button type="button" onClick={addColumn}>+ Col</button>
        <button type="button" onClick={deleteRow} disabled={rows.length <= 1}>- Row</button>
        <button type="button" onClick={deleteColumn} disabled={colCount <= 1}>- Col</button>
        <button type="button" onClick={clearTable}>Clear</button>
      </div>

      {mode === 'edit' ? (
        <div
          className="noteometry-dropin-table-grid"
          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(96px, 1fr))` }}
        >
          {rows.map((rowValues, row) => rowValues.map((cell, col) => (
            <input
              key={`${row}:${col}`}
              ref={rememberCell(row, col)}
              type="text"
              className="noteometry-dropin-table-cell"
              value={cell}
              onFocus={() => setActiveCell({ row, col })}
              onChange={(e) => setCell(row, col, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, row, col)}
              onPaste={(e) => handlePaste(e, row, col)}
              spellCheck={false}
              aria-label={`Cell ${row + 1}, ${col + 1}`}
            />
          )))}
        </div>
      ) : (
        <div className="noteometry-dropin-table-preview-wrap">
          <table className="noteometry-dropin-table-preview">
            <tbody>
              {rows.map((rowValues, row) => (
                <tr key={row}>
                  {rowValues.map((cell, col) => (
                    <td
                      key={`${row}:${col}`}
                      dangerouslySetInnerHTML={{
                        __html: cell.trim() ? renderAsKatexHtml(cell) : '&nbsp;',
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
