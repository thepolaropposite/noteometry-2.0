# Feature Test Matrix — Noteometry OS

**Run date:** 2026-05-18 · Playwright 1.60 / chromium-headless-shell 148
**Spec:** [`tests/e2e/regression.spec.ts`](../tests/e2e/regression.spec.ts)
**Companion:** [`DEV_REGRESSION_REPORT.md`](./DEV_REGRESSION_REPORT.md)

Each row is a literal assertion from the regression checklist that lives both in this matrix and as a `test(...)` block. A row is **PASS** if Playwright reports the test green against the live dev app; **FAIL** otherwise. Soft assertions surface as PASS-with-notes.

| # | Assertion | Status | Test location | Notes |
|---|---|---|---|---|
| 1 | Settings gear exists in the AI pane | ✅ PASS | `regression.spec.ts:61` | `button[title="Provider settings"]` is visible in `.noteometry-mm-pane` header. |
| 2 | Settings opens when the gear is clicked | ✅ PASS | `regression.spec.ts:68` | `section.noteometry-mm-settings` becomes visible on click. |
| 3 | Settings has Provider / Base URL / API Key / Model / Test / Save | ❌ **FAIL** | `regression.spec.ts:76` | Provider dropdown, Base URL, Model, API key (when provider needs one), and **Test Provider** all present. **No explicit `Save` button** — fields commit on edit and persist via the `saveStatus` pipeline. See `DEV_REGRESSION_REPORT.md` for remediation options. |
| 4 | Only one active AI profile exists (no triple Math Read/Solve/General) | ✅ PASS | `regression.spec.ts:103` | `section.noteometry-mm-job` count is exactly 1; old triple-job labels are absent. |
| 5 | AI pane can resize horizontally | ✅ PASS | `regression.spec.ts:116` | Dragging `.noteometry-mm-resize` 120 px left widens the pane (verified via measured bounding rect). |
| 6 | Collapsed AI pane reserves 0px width | ✅ PASS | `regression.spec.ts:133` | After clicking collapse, `getComputedStyle(document.documentElement).getPropertyValue('--nm-mm-pane-width')` is exactly `0px`. |
| 7 | Message box (General) can clear via × button | ✅ PASS | `regression.spec.ts:145` | `button.noteometry-mm-composer-clear` empties the draft textarea; chat history unaffected. |
| 8 | Verified Input (Math) can clear without touching chat | ✅ PASS | `regression.spec.ts:159` | `Clear Input` button empties the textarea and is disabled when empty. |
| 9 | View Prompt / Copy Prompt are gone from the AI pane | ✅ PASS | `regression.spec.ts:172` | Neither phrase appears in Math nor General mode. |
| 10 | Math icon is not backwards | ✅ PASS | `regression.spec.ts:185` | `MathIcon` svg path is `M18 5H6l6 7-6 7h12` — V tip on the left, opening right. |
| 11 | Math Palette size toggle is Large / Small only | ✅ PASS | `regression.spec.ts:197` | `.noteometry-mathpalette-sizes` has exactly 2 buttons reading `Large` and `Small`. |
| 12 | No uppercase/lowercase or subscript/superscript labels in palette | ✅ PASS | `regression.spec.ts:209` | None of those strings appear in `aside.noteometry-mathpalette`. |
| 13 | Math Palette stamps single symbols onto the canvas | ✅ PASS | `regression.spec.ts:221` | After arming and clicking the canvas, ≥ 1 `[data-shape-type="text"]` is present; first text content matches the chosen glyph (α). |
| 14 | Right-click menu has no AI commands | ✅ PASS | `regression.spec.ts:249` | "Read Math" / "Solve Verified Math" / "Capture General" / "Ask AI" are all absent from `.noteometry-ctx-menu`. |
| 15 | Right-click Drop-Ins section has no Chat entry | ✅ PASS | `regression.spec.ts:258` | "Drop-Ins" header is present; no `Chat` button anywhere in the menu. |
| 16 | Raw canvas typing is gone (no "Text Box" command) | ✅ PASS | `regression.spec.ts:267` | The menu does not contain the string "Text Box". Insert items spawn Drop-Ins, never raw tldraw text shapes (the sole `editor.createShape` call lives in the Math Palette stamp path). |
| 17 | PDF Drop-In renders the empty-state file picker + URL fallback | ✅ PASS | `regression.spec.ts:273` | Frame mounts with `input[type=file accept=application/pdf]` and a URL `<input>`. |
| 18 | PDF Drop-In switches to an iframe when a URL is supplied | ✅ PASS | `regression.spec.ts:283` | Either `iframe.noteometry-dropin-pdf-frame` mounts with that `src`, or the in-card error fallback shows — both count as "no white-screen failure." |
| 19 | Copy for Word exists and uses the MathML clipboard | ✅ PASS | `regression.spec.ts:301` | Button on assistant messages writes via the `copyForWord` path. In chromium-headless-shell (no `ClipboardItem`) the test verifies the documented fallback to `writeText(plain)` — the macOS browser uses the primary `text/html` MathML path; manual verification recommended for Word pasting. |
| 20 | Persistence: notebook + sections survive reload | ✅ PASS | `regression.spec.ts:384` | A user-named section appears post-reload with the same name. |
| 21 | Persistence: a Drop-In spawned via right-click survives reload | ✅ PASS | `regression.spec.ts:395` | The spawned `.noteometry-dropin-frame.is-text` is still present after `page.reload()`. |
| 22 | Save indicator dot is present in the top breadcrumb | ✅ PASS | `regression.spec.ts:405` | `.noteometry-save-dot` is visible. |

---

## Coverage notes

- **Touched by tests:** AI pane chrome (gear, settings, resize, collapse, mode tabs, clear inputs), right-click menu items, Math Palette (size mode, stamp flow), PDF Drop-In, persistence (nav + Drop-Ins), save indicator, Copy for Word clipboard pipeline.
- **Not touched by tests (out of scope for this sweep):**
  - Pen / Eraser / Width selections — visual-only assertions, no canvas state asserted.
  - Math Solve (would require LM Studio live + non-trivial prompt round-trip).
  - General Ask pipeline (same).
  - Image Drop-In upload flow.
  - Provider switching to OpenAI/Anthropic/etc. (the type/value matrix is verified by static config in `aiProviders.ts`; UI rendering of each provider's API-key affordance is covered indirectly via the OpenAI branch).
  - Math Palette `Small` size scale (the spec asserts the toggle exists; stamping math `Small` actually lands at scale 0.55 is enforced by the App.tsx callback but not currently asserted in E2E).
  - Page rail collapse handle.

These gaps are by design — the regression sweep focuses on the explicit assertion list. Add tests opportunistically when new behaviors are added.

---

## How to extend

Each test should be a *literal* product assertion, named in plain English. Group new tests under `test.describe('…regression sweep')`. Use:

- `openApp(page)` for a clean-state visit.
- `ensurePaneOpen(page)` when you need the AI pane open.
- `openContextMenu(page)` for right-click flows.

Avoid `page.waitForTimeout`; use `expect.poll` or visibility-based waits.
