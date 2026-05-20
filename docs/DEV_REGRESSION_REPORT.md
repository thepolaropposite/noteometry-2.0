# Dev Regression Report — Noteometry OS

**Run date:** 2026-05-18
**Test target:** http://localhost:5173/ (live Vite dev server)
**Runner:** Playwright 1.60 · chromium-headless-shell 148
**Spec file:** [`tests/e2e/regression.spec.ts`](../tests/e2e/regression.spec.ts)
**How to re-run:** `npm run test:e2e` (dev server must already be running)

---

## Headline

| Total | Passed | Failed |
|------:|-------:|-------:|
|   22  |   21   |   1    |

**Pre-flight:**
- `curl -I http://localhost:5173/` → `HTTP/1.1 200 OK` ✅
- `curl http://localhost:5173/lmstudio/v1/models` → `HTTP 200` (LM Studio proxy reachable) ✅
- `npm run build` → `tsc -b && vite build` succeeded in 248 ms ✅

---

## The one failure — real product gap

### ❌ Settings has Provider / Base URL / API Key / Model / Test Connection / Save

> `expect.soft(saveButton.count(), 'a "Save" button is not present in settings').toBeGreaterThan(0)` — Received `0`.

**Product behavior observed:** the AI Settings drawer (gear icon in the AI pane) exposes Provider, Base URL, Model, API key (when needed), Test Provider, and Refresh Models, but there is **no explicit `Save` button**. Every field commits on edit through the `onChange` handler → the per-store `markSaving` / `markSaved` pipeline → localStorage.

**Why this is flagged:** the most recent task spec listed `Save` as one of the required fields:
> *Fields: Provider dropdown … Base URL … API Key … Model … Test Connection … **Save***

So the test treats this as a missing affordance.

**Not fixed yet** (per the user's directive: report failures before fixing anything).

**Recommended remediation** (when authorized):
1. Either add an explicit `Save` button that re-emits the current config via `onChange(config)` and triggers a toast (no behavior change — fields already persist on edit; the button serves as a visible commit affordance for users who expect form-style submission), **or**
2. Update `NOTEOMETRY_OS_FEATURE_CONTRACT.md` Law 10 to clarify that settings auto-save, and amend the assertion in the test.

---

## Notes on tests that initially failed and were corrected

Four other tests failed on the first run for reasons unrelated to the product. The product was **not** modified; the tests were refined so the regression signal is honest.

| Initial failure | Cause | Resolution |
|---|---|---|
| Math Palette stamp count | tldraw renders multiple DOM nodes per shape; `.tl-text-content` matched 2 | Switched to counting `[data-shape-type="text"]` ≥ 1 and verified the glyph via `.tl-text-content` |
| Copy for Word never fired | chromium-headless-shell lacks `ClipboardItem`, so `copyForWord` takes the `writeText` fallback path — original test only monkey-patched `clipboard.write` | Patched **both** `write` and `writeText`; assert against whichever the runtime resolves; `expect.poll` to handle the non-awaited click handler |
| Persistence: section survives reload | `addInitScript(localStorage.clear)` ran on every navigation, wiping state between user action and `reload()` | Switched `openApp` helper to one-shot clear on initial visit, then `reload()`; reloads now keep state |
| Persistence: Drop-In survives reload | Same as above | Same fix |

These are test infrastructure refinements, not product changes.

---

## Environment notes

- LM Studio's `/lmstudio/v1/models` endpoint returns 200, so any test that talks to the proxy can work — but **no test in this suite actually depends on LM Studio**. Provider tests verify UI surfaces only.
- `chromium-headless-shell` does not implement `ClipboardItem`, so `copyForWord` falls back to `writeText(plain)`. In a real macOS browser the primary `text/html` MathML path runs. The test accepts either path, so this caveat doesn't affect the regression signal — but it's worth noting for the Word-paste manual verification, which must be done in a real browser.
- Tests assume a 1440×900 viewport. Mobile/touch layouts are not covered by this sweep.

---

## Full per-test results

See [`FEATURE_TEST_MATRIX.md`](./FEATURE_TEST_MATRIX.md) for the assertion-by-assertion table.

---

## Reproducing this report

```bash
# 1. Start the dev server (in one terminal)
cd ~/Documents/noteometry-os
npm run dev

# 2. In another terminal, run the suite
cd ~/Documents/noteometry-os
npm run test:e2e

# Optional — drill into a single assertion:
npx playwright test -g "Settings has Provider"

# Optional — open the trace viewer for a failure:
npx playwright show-trace test-results/<run-dir>/trace.zip
```

The suite uses a stable viewport and a permissioned browser context (clipboard read/write granted). It does not depend on any external network call. The only prerequisite outside the repo is a running Vite dev server at `http://localhost:5173/`.
