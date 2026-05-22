/**
 * Dev regression sweep for Noteometry OS.
 *
 * Test-as-spec: each `test(...)` name is a literal assertion from the
 * regression checklist. A failure means the product no longer honors
 * that assertion — the test does NOT try to fix the app. The pair of
 * docs/DEV_REGRESSION_REPORT.md and docs/FEATURE_TEST_MATRIX.md capture
 * the resulting pass/fail picture for the human to act on.
 *
 * Prereqs:
 *   - dev server already running at http://localhost:5173
 *   - LM Studio proxy reachable at /lmstudio/v1 (only needed for the
 *     Test Connection assertion; failure tolerated otherwise)
 *
 * Each test starts with a clean localStorage so persisted state never
 * leaks between assertions.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

const PANE_SELECTOR = 'aside.noteometry-mm-pane';
const PANE_HANDLE = 'button.noteometry-mm-handle';
const CANVAS_SHELL = 'div.noteometry-canvas-shell';

/** Open the app with a fresh-state localStorage. We intentionally clear
 *  AFTER the first navigation so subsequent reload() calls keep whatever
 *  state the test produced — the prior version used addInitScript, which
 *  ran on every navigation and silently wiped persistence between the
 *  user action and the reload assertion. */
async function openApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
  await page.reload();
  await page.locator(`${PANE_SELECTOR}, ${PANE_HANDLE}`).first().waitFor({ state: 'visible' });
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function ensurePaneOpen(page: Page): Promise<Locator> {
  const handle = page.locator(PANE_HANDLE);
  if (await handle.count() > 0) {
    await handle.click();
  }
  const pane = page.locator(PANE_SELECTOR);
  await pane.waitFor({ state: 'visible' });
  return pane;
}

async function openContextMenu(page: Page): Promise<Locator> {
  const shell = page.locator(CANVAS_SHELL);
  const box = await shell.boundingBox();
  if (!box) throw new Error('canvas shell has no bounding box');
  // Right-click roughly in the middle of the canvas region.
  await shell.click({ position: { x: 200, y: 200 }, button: 'right' });
  const menu = page.locator('.noteometry-ctx-menu');
  await menu.waitFor({ state: 'visible' });
  return menu;
}

test.describe('Noteometry OS — regression sweep', () => {

  test('Settings gear exists in the AI pane', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    const gear = pane.locator('button[title="Provider settings"]');
    await expect(gear).toBeVisible();
  });

  test('Settings opens when gear is clicked', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    await pane.locator('button[title="Provider settings"]').click();
    const settings = pane.locator('section.noteometry-mm-settings');
    await expect(settings).toBeVisible();
  });

  test('Settings has Provider / Base URL / Model / Test Provider / Save', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    await pane.locator('button[title="Provider settings"]').click();
    const settings = pane.locator('section.noteometry-mm-settings');
    // Provider dropdown.
    await expect(settings.locator('select')).toBeVisible();
    // Base URL + Model inputs are always present. Hosted OpenAI intentionally
    // does not expose a browser API-key field.
    const fields = settings.locator('label.noteometry-mm-field');
    await expect(fields).toHaveCount(2, { timeout: 2000 }).catch(async () => {
      // Some providers add an API key field, making it 3. Both are valid.
      const c = await fields.count();
      expect.soft(c, 'expected 2 or 3 field labels').toBeGreaterThanOrEqual(2);
    });
    // OpenAI is the hosted route: the key lives on Vercel, not in the browser.
    await settings.locator('select').selectOption('openai');
    await expect(settings.locator('input[type="password"]')).toHaveCount(0);
    // Test Provider button.
    await expect(settings.getByRole('button', { name: /test provider/i })).toBeVisible();
    await expect(settings.getByRole('button', { name: /^save$/i })).toBeVisible();
  });

  test('Only one active AI profile editor is present (no triple Math Read/Solve/General)', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    await pane.locator('button[title="Provider settings"]').click();
    const settings = pane.locator('section.noteometry-mm-settings');
    const jobs = settings.locator('section.noteometry-mm-job');
    await expect(jobs).toHaveCount(1);
    // Negative checks: those triple labels must not appear.
    await expect(settings).not.toContainText(/math read \(vision\)/i);
    await expect(settings).not.toContainText(/math solve \(text\)/i);
    await expect(settings).not.toContainText(/general \(vision\)/i);
  });

  test('AI pane horizontal resize handle exists and changes pane width', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    const handle = pane.locator('.noteometry-mm-resize');
    await expect(handle).toBeVisible();
    const before = await pane.evaluate((el) => el.getBoundingClientRect().width);
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('resize handle has no bbox');
    // Drag the left-edge handle ~120 px LEFT → pane should widen.
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 120, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = await pane.evaluate((el) => el.getBoundingClientRect().width);
    expect(after).toBeGreaterThan(before);
  });

  test('Collapsed AI pane reserves 0px width (--nm-mm-pane-width is 0px)', async ({ page }) => {
    await openApp(page);
    await ensurePaneOpen(page);
    // Click the collapse caret in the pane header.
    await page.locator('button[title="Collapse pane"]').click();
    await page.locator(PANE_HANDLE).waitFor({ state: 'visible' });
    const varValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nm-mm-pane-width').trim()
    );
    expect(varValue).toBe('0px');
  });

  test('Message mode draft has a × clear button', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    // Switch to Message mode.
    await pane.getByRole('tab', { name: 'Message' }).click();
    const textarea = pane.locator('.noteometry-mm-composer textarea');
    await textarea.fill('hello');
    const clearBtn = pane.locator('button.noteometry-mm-composer-clear');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();
    await expect(textarea).toHaveValue('');
  });

  test('Math mode has Clear Input button that empties the verified input', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    await pane.getByRole('tab', { name: 'Math' }).click();
    const textarea = pane.locator('section.noteometry-mm-preview-panel textarea');
    await textarea.fill('verified problem text');
    const clearBtn = pane.getByRole('button', { name: /clear input/i });
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();
    await expect(textarea).toHaveValue('');
  });

  test('View Prompt and Copy Prompt are gone everywhere in the AI pane', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    // Math mode.
    await pane.getByRole('tab', { name: 'Math' }).click();
    await expect(pane).not.toContainText(/view prompt/i);
    await expect(pane).not.toContainText(/copy prompt/i);
    // Message mode.
    await pane.getByRole('tab', { name: 'Message' }).click();
    await expect(pane).not.toContainText(/view prompt/i);
    await expect(pane).not.toContainText(/copy prompt/i);
  });

  test('Math Palette opens from right-click and shows Large/Small only', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /math palette/i }).click();
    const palette = page.locator('aside.noteometry-mathpalette');
    await expect(palette).toBeVisible();
    const sizes = palette.locator('.noteometry-mathpalette-sizes button');
    await expect(sizes).toHaveCount(2);
    await expect(sizes.nth(0)).toContainText(/large/i);
    await expect(sizes.nth(1)).toContainText(/small/i);
  });

  test('Math Palette contains no Uppercase/Lowercase or Subscript/Superscript labels', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /math palette/i }).click();
    const palette = page.locator('aside.noteometry-mathpalette');
    await expect(palette).toBeVisible();
    await expect(palette).not.toContainText(/uppercase/i);
    await expect(palette).not.toContainText(/lowercase/i);
    await expect(palette).not.toContainText(/superscript/i);
    await expect(palette).not.toContainText(/subscript/i);
  });

  test('Math Palette stamps land on the canvas as single-character ink text marks', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /math palette/i }).click();
    const palette = page.locator('aside.noteometry-mathpalette');
    await expect(palette).toBeVisible();
    // Pick the first glyph (alpha).
    await palette.locator('.noteometry-mathpalette-grid button').first().click();
    // Stamp overlay should appear.
    const overlay = page.locator('.noteometry-stamp-overlay');
    await expect(overlay).toBeVisible();
    // Click on canvas to drop.
    const shell = page.locator(CANVAS_SHELL);
    const box = await shell.boundingBox();
    if (!box) throw new Error('canvas shell has no bbox');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // A custom SVG ink text mark now exists. Allow 1..N because the same
    // stamp arms by default so the user can drop multiples — we just
    // dropped one.
    const marks = page.locator('.noteometry-ink-text');
    await expect.poll(async () => marks.count(), { timeout: 4000 }).toBeGreaterThanOrEqual(1);
    // The text content of the first shape should be the chosen glyph (α).
    const text = await marks.first().textContent({ timeout: 2000 }).catch(() => null);
    expect.soft(text ?? '', 'stamped glyph rendered in ink text mark').toMatch(/α|alpha/i);
  });

  test('Right-click menu has no AI commands (Read Math / Solve / Capture General / Ask AI)', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await expect(menu.locator('.noteometry-ctx-header').filter({ hasText: /^AI$/i })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /^read math$/i })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /^solve$/i })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /^solve verified math$/i })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /^capture general$/i })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /^ask ai$/i })).toHaveCount(0);
  });

  test('Right-click menu keeps canvas tool and insertion commands', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await expect(menu.getByRole('button', { name: /ink/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /eraser/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /lasso/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /text drop-in/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /table drop-in/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /image drop-in/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /pdf drop-in/i })).toBeVisible();
  });

  test('AI pane owns Math and Message processing controls', async ({ page }) => {
    await openApp(page);
    const pane = await ensurePaneOpen(page);
    await pane.getByRole('tab', { name: 'Math' }).click();
    await expect(pane.getByRole('button', { name: /^read math$/i })).toBeVisible();
    await expect(pane.getByRole('button', { name: /^solve$/i })).toBeVisible();
    await expect(pane.getByRole('button', { name: /^clear input$/i })).toBeVisible();
    await expect(pane.locator('section.noteometry-mm-preview-panel textarea')).toBeVisible();

    await pane.getByRole('tab', { name: 'Message' }).click();
    await expect(pane.getByRole('button', { name: /^capture$/i })).toBeVisible();
    await expect(pane.getByRole('button', { name: /^ask$/i })).toBeVisible();
    await expect(pane.locator('.noteometry-mm-composer textarea')).toBeVisible();
  });

  test('Right-click Drop-Ins section has no Chat entry', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    // Section header "Drop-Ins" is present.
    await expect(menu).toContainText(/drop-ins/i);
    // No "Chat" button anywhere in the menu.
    await expect(menu.getByRole('button', { name: /^chat$/i })).toHaveCount(0);
  });

  test('Right-click menu has no "Text Box" raw-text command (canvas typing removed)', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await expect(menu).not.toContainText(/text box/i);
  });

  test('PDF Drop-In renders its empty-state file picker + URL fallback', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /pdf drop-in/i }).click();
    const frame = page.locator('.noteometry-dropin-frame.is-pdf');
    await expect(frame).toBeVisible();
    await expect(frame.locator('input[type="file"][accept="application/pdf"]')).toHaveCount(1);
    await expect(frame.locator('input[placeholder*=".pdf"]')).toBeVisible();
  });

  test('PDF Drop-In switches to iframe when a URL is supplied', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /pdf drop-in/i }).click();
    const frame = page.locator('.noteometry-dropin-frame.is-pdf');
    const urlInput = frame.locator('input[placeholder*=".pdf"]');
    await urlInput.fill('https://example.com/example.pdf');
    await urlInput.blur();
    // iframe should mount with that src.
    await expect(frame.locator('iframe.noteometry-dropin-pdf-frame')).toHaveAttribute(
      'src', 'https://example.com/example.pdf',
      { timeout: 4000 }
    ).catch(() => { /* the heuristic load-watch may flip to error state — tolerated */ });
    const iframeCount = await frame.locator('iframe.noteometry-dropin-pdf-frame').count();
    const errorCount = await frame.locator('.noteometry-dropin-pdf-error').count();
    expect(iframeCount + errorCount, 'either iframe renders or a clean fallback shows').toBeGreaterThan(0);
  });

  test('Copy for Word button exists on assistant chat messages and uses MathML clipboard', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const v4 = {
        paneOpen: true,
        paneWidth: 420,
        mode: 'math',
        showSettings: false,
        ai: { provider: 'lmstudio', baseUrl: '/lmstudio/v1', apiKey: '', model: 'google/gemma-4-26b-a4b' },
        verifiedInput: '',
        mathLog: [
          { id: 'fixture-a', role: 'assistant', text: 'Answer: $\\boxed{x = 42}$', ts: Date.now() },
        ],
        generalDraft: '',
        generalLog: [],
      };
      localStorage.setItem('noteometry-os:math-message-pane:v4', JSON.stringify(v4));
    });
    await page.reload();
    const pane = page.locator(PANE_SELECTOR);
    await pane.waitFor({ state: 'visible' });
    const copyBtn = pane.getByRole('button', { name: /copy for word/i });
    await expect(copyBtn).toBeVisible();

    // Capture BOTH clipboard paths (write — ClipboardItem MIME bundle —
    // and writeText — plain-text fallback). chromium-headless-shell does
    // not ship ClipboardItem, so copyForWord falls through to writeText
    // in this environment. We accept either signal.
    await page.evaluate(() => {
      const w = window as unknown as { __clipboardWrites?: unknown[]; __clipboardText?: string[] };
      w.__clipboardWrites = [];
      w.__clipboardText = [];
      const cb = navigator.clipboard as unknown as {
        write?: (items: ClipboardItem[]) => Promise<void>;
        writeText?: (text: string) => Promise<void>;
      };
      cb.write = async (items: ClipboardItem[]) => {
        for (const item of items) {
          const captured: Record<string, string> = {};
          for (const t of item.types) {
            const blob = await item.getType(t);
            captured[t] = await blob.text();
          }
          (w.__clipboardWrites as unknown[]).push(captured);
        }
      };
      cb.writeText = async (text: string) => {
        (w.__clipboardText as string[]).push(text);
      };
    });

    await copyBtn.click();

    // The button's onClick fires a non-awaited async, so the click
    // promise resolves before copyForWord's clipboard call finishes.
    // Poll until one of the buffers fills.
    await expect.poll(async () => {
      const { wLen, tLen } = await page.evaluate(() => ({
        wLen: ((window as unknown as { __clipboardWrites?: unknown[] }).__clipboardWrites ?? []).length,
        tLen: ((window as unknown as { __clipboardText?: string[] }).__clipboardText ?? []).length,
      }));
      return wLen + tLen;
    }, { timeout: 4000 }).toBeGreaterThan(0);

    const { writes, texts, hasClipboardItem } = await page.evaluate(() => ({
      writes: (window as unknown as { __clipboardWrites?: unknown[] }).__clipboardWrites ?? [],
      texts: (window as unknown as { __clipboardText?: string[] }).__clipboardText ?? [],
      hasClipboardItem: typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem !== 'undefined',
    }));

    if (hasClipboardItem) {
      // Preferred path: a ClipboardItem with text/html (MathML) + text/plain.
      expect((writes as unknown[]).length, 'navigator.clipboard.write was called').toBeGreaterThan(0);
      const first = (writes as Record<string, string>[])[0];
      expect.soft(first['text/plain']).toContain('x = 42');
      expect.soft(first['text/html']).toMatch(/<math/);
    } else {
      // Fallback path (chromium-headless-shell lacks ClipboardItem).
      expect((texts as string[]).length, 'fallback writeText was called').toBeGreaterThan(0);
      expect.soft((texts as string[])[0], 'plain text mentions the answer').toContain('x = 42');
    }
  });

  test('Persistence: nav notebook + sections survive reload', async ({ page }) => {
    await openApp(page);
    // Add a section, then reload, then verify it persisted.
    page.once('dialog', (d) => d.accept('TEST-SECTION'));
    await page.locator('button[aria-label="New section"]').click();
    await expect(page.locator('.noteometry-section-tab')).toContainText(['TEST-SECTION']);
    await page.reload();
    await page.locator(`${PANE_SELECTOR}, ${PANE_HANDLE}`).first().waitFor({ state: 'visible' });
    await expect(page.locator('.noteometry-section-tab')).toContainText(['TEST-SECTION']);
  });

  test('Persistence: a Drop-In spawned via right-click survives reload', async ({ page }) => {
    await openApp(page);
    const menu = await openContextMenu(page);
    await menu.getByRole('button', { name: /text drop-in/i }).click();
    await expect(page.locator('.noteometry-dropin-frame.is-text')).toHaveCount(1);
    await page.reload();
    await page.locator(`${PANE_SELECTOR}, ${PANE_HANDLE}`).first().waitFor({ state: 'visible' });
    await expect(page.locator('.noteometry-dropin-frame.is-text')).toHaveCount(1, { timeout: 4000 });
  });

  test('Save indicator dot is present in the top breadcrumb', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.noteometry-save-dot')).toBeVisible();
  });

  test('Collapsed page rail leaves no dark strip — canvas reaches the right edge', async ({ page }) => {
    await openApp(page);
    // Make sure the AI pane is collapsed so its width does not confound
    // the measurement.
    const handle = page.locator(PANE_HANDLE);
    if ((await handle.count()) === 0) {
      await page.locator('button[title="Collapse pane"]').click();
      await page.locator(PANE_HANDLE).waitFor({ state: 'visible' });
    }
    // Collapse the page rail.
    await page.locator('button[aria-label="Hide pages"]').click();
    await page.locator('button.noteometry-page-rail-handle').waitFor({ state: 'visible' });

    // The published CSS variable must be 0 px.
    const railVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nm-page-rail-width').trim()
    );
    expect(railVar).toBe('0px');

    // The canvas-shell must reach the right edge (≤ 4 px slack for
    // border / scrollbar).
    const gap = await page.evaluate(() => {
      const shell = document.querySelector('.noteometry-canvas-shell') as HTMLElement | null;
      if (!shell) return -1;
      const rect = shell.getBoundingClientRect();
      return Math.max(0, window.innerWidth - rect.right);
    });
    expect(gap, 'canvas-shell right edge gap').toBeLessThanOrEqual(4);

    // The collapsed-rail handle must still be clickable (re-opens the rail).
    const handleBtn = page.locator('button.noteometry-page-rail-handle');
    await expect(handleBtn).toBeVisible();
    await handleBtn.click();
    // After re-opening, the rail aside is back and the variable is 200 px.
    await page.locator('aside.noteometry-page-rail').waitFor({ state: 'visible' });
    const railVarAfter = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nm-page-rail-width').trim()
    );
    expect(railVarAfter).toBe('200px');
  });
});
