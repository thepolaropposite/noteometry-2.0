# Porting Map — `noteometry-obsidian` → `noteometry-os`

**Purpose:** for every recoverable domain in the old Obsidian-shelled prototypes, this document declares whether to **port verbatim**, **rewrite clean**, or **ignore**, and names the target file(s) in the standalone `noteometry-os` tree.

**Source anchors:**

| Anchor | Commit | Use for |
|---|---|---|
| **v1.6.6** | `79cfb740903c9908c0b0b1d53f1afc7958cc64b5` | AI Pane, Panel, ChatPanel, MathML/Word export, Math v12 prompt/preset, provider call shapes. |
| **v1.10.0** | `a37ee67125f0547955f4df548053a63a13ed3860` | Drop-In™ philosophy, "dumb pipe" rasterizer doctrine, vision-only lasso rule. **Do not** copy v1.10's removal of the AI Pane — that is a regression. |
| **noteometry-os (current)** | working tree | Standalone tldraw v5 shell, OneNote-style nav, LM Studio Vite proxy, flat right-click menu, engineering-paper grid. |

**Decision codes:**

- **PORT** — bring the code over with minimal change. Strip Obsidian imports; otherwise keep behavior byte-similar.
- **REWRITE** — keep the *idea* but rebuild for the standalone web shell.
- **IGNORE** — do not bring this over. Reference only.
- **ALREADY PORTED** — done in current `noteometry-os` tree.

**Read alongside:** [`NOTEOMETRY_OS_FEATURE_CONTRACT.md`](./NOTEOMETRY_OS_FEATURE_CONTRACT.md) — the Laws are authoritative; this doc is execution detail.

**Last revised:** 2026-05-18

---

## A. AI Pane (right-side persistent chrome)

| Field | Value |
|---|---|
| **Old domain** | AI panel, recognition panel, chat panel |
| **Source anchor** | v1.6.6 |
| **Old files** | `src/components/Panel.tsx`, `src/components/ChatPanel.tsx`, `src/components/KaTeXRenderer.tsx`, `src/components/MathPalette.tsx` |
| **v1.10 status** | **Removed.** v1.10 deleted Panel.tsx and re-homed chat into ChatDropin. We deliberately rejected this in Law 4. |
| **Decision** | **REWRITE** (already done — keep iterating) |
| **New target** | `src/components/MathMessagePane.tsx`, `src/components/ProviderJobEditor.tsx` |
| **Risk notes** | The temptation to re-collapse this into a single "chat with vision" view is real and constant. Law 4 + Law 5 prevent it. The Math pipeline's two-hop structure is the entire reason this pane exists separately from a generic chat. |

---

## B. MathML / Word export

| Field | Value |
|---|---|
| **Old domain** | Copy-for-Word, MathML conversion |
| **Source anchor** | v1.6.6 |
| **Old files** | `src/lib/mathml.ts`, `tests/unit/mathml.test.ts` |
| **Decision** | **PORT** (verbatim; KaTeX `output: 'mathml'`, bare `<math>` extraction, `<p>`-wrapped clipboard HTML) |
| **New target** | `src/lib/mathml.ts` ✅ ALREADY PORTED |
| **Risk notes** | The `<p>`-per-non-empty-line wrapper matters: Word treats `<br>` as a soft break and merges paragraphs; we need real `<p>` separation. The bare-`<math>` extraction regex must survive — without it, KaTeX's wrapper spans block Word from picking up the MathML. Re-port the v1.6.6 unit test next to this file when feasible. |

---

## C. Math v12 prompt / Solve preset

| Field | Value |
|---|---|
| **Old domain** | Solve preset, deterministic linear protocol |
| **Source anchor** | v1.6.6 |
| **Old files** | `src/features/pipeline/presets.ts` (entry `id: 'solve'`) |
| **Decision** | **PORT** (full preset body, verbatim) |
| **New target** | `src/prompts/mathV12.ts` ✅ ALREADY PORTED · `MATH_V12_PROMPT_VERSION = 'math-v12-2026-03-09'` |
| **Risk notes** | The other v1.6.6 presets (`explain`, `transcribe`, `circuit`, …) are **not** required for v0 of Noteometry OS. They land later as additional prompt templates with their own versions. Do **not** import them as a preset list / dropdown — that's a different feature. |

---

## D. Math Read transcription prompt

| Field | Value |
|---|---|
| **Old domain** | Vision transcription |
| **Source anchor** | conceptually v1.6.6's `VISION_SYSTEM` + new tightening (JSON output) |
| **Old files** | implicit in `src/lib/ai.ts` / pipeline |
| **Decision** | **REWRITE** (clean, JSON-returning, named version) |
| **New target** | `src/prompts/mathRead.ts` ✅ ALREADY PORTED · `MATH_READ_PROMPT_VERSION = 'math-read-v1'` |
| **Risk notes** | Models occasionally wrap JSON in ``` fences or add prose. `parseTranscription` in MathMessagePane handles this; keep it robust if/when we switch providers. |

---

## E. General Vision prompt

| Field | Value |
|---|---|
| **Old domain** | Mixed-media chat |
| **Source anchor** | new (v1.6.6 had no exact equivalent; closest is `explain` preset) |
| **Old files** | n/a |
| **Decision** | **REWRITE** (clean, vision-only contract) |
| **New target** | `src/prompts/generalVision.ts` ✅ ALREADY PORTED · `GENERAL_VISION_PROMPT_VERSION = 'general-vision-v1'` |
| **Risk notes** | The prompt explicitly forbids invoking Math v12 unless the user asks — keep that clause. |

---

## F. Provider adapters / chat API

| Field | Value |
|---|---|
| **Old domain** | Multi-provider AI client |
| **Source anchor** | v1.6.6 |
| **Old files** | `src/lib/ai.ts` (Claude, Perplexity Agent, etc.) |
| **Decision** | **REWRITE** (drop Obsidian's `requestUrl`; use `fetch`; unify around OpenAI `/chat/completions` schema for wired providers; leave Anthropic/Gemini as visible-but-unimplemented adapters) |
| **New target** | `src/lib/aiTypes.ts`, `src/lib/aiProviders.ts` ✅ ALREADY PORTED |
| **Risk notes** | v1.6.6's `callClaude` uses `x-api-key` and the `/messages` schema; v1.6.6's Perplexity client speaks a custom Agent input format. Today's `aiProviders.ts` treats both as "not implemented" / "OpenAI-compatible" respectively — when we wire them properly, branch in `sendChat` rather than collapsing to one schema. **API keys never appear in logs** (Law 10). |

---

## G. Lasso rasterizer ("dumb pipe")

| Field | Value |
|---|---|
| **Old domain** | Selection-to-PNG capture |
| **Source anchor** | v1.10.0 |
| **Old files** | `src/features/lasso/rasterize.ts`, `src/features/lasso/composite.ts`, `src/features/lasso/selection.ts`, `src/features/lasso/useLassoStack.ts`, `src/components/LassoOverlay.tsx`, `tests/unit/lassoSelection.test.ts` |
| **Decision** | **IGNORE** code; **PORT the doctrine** |
| **New target** | tldraw v5's `editor.toImageDataUrl(ids, {format:'png', …})` already gives us a "dumb pipe" with no interpretive layer. There is no analog for `html2canvas`-style DOM rasterization in noteometry-os today because the canvas is tldraw, not a DOM tree. |
| **Risk notes** | When Drop-Ins™ land that aren't tldraw shapes (Table, PDF, Circuit Sniper, etc.), the rasterizer story will need a second pass: tldraw's exporter doesn't know about non-tldraw cards. Likely target: composite-snapshot lib that renders tldraw export *and* DOM-rasterizes Drop-In™ frames, then stitches. Capture the doctrine — *the rasterizer never interprets, the model does* — before writing that lib. |

---

## H. Drop-In™ shapes

| Field | Value |
|---|---|
| **Old domain** | Canvas-anchored mini-apps |
| **Source anchor** | v1.10.0 |
| **Old files** | `src/components/dropins/ChatDropin.tsx`, `src/components/dropins/MathDropin.tsx`, `src/lib/dropinExport.ts`, `tests/unit/dropinExport.test.ts` |
| **Decision** | **PORT the doctrine; REWRITE the implementation** |
| **New target** | `src/components/dropins/` (to be created); per Law 3, each Drop-In™ declares identity, title, position, size, state, UI, lifecycle. Likely backed by custom tldraw `ShapeUtil`s (cf. the stashed `src/DropInShape.tsx.bak`). |
| **Risk notes** | v1.10's ChatDropin replaced the right-side AI Pane — Noteometry OS will have **both**: AI Pane (Law 4) **and** a future Chat Drop-In™. They're different surfaces, not alternatives. Resist the temptation to delete the AI Pane "now that we have ChatDropin." |

---

## I. Math Palette

| Field | Value |
|---|---|
| **Old domain** | Symbol/character insertion |
| **Source anchor** | v1.6.6 |
| **Old files** | `src/components/MathPalette.tsx` |
| **Decision** | **REWRITE** (not yet built in noteometry-os; right-click → Math → Math Palette is currently a stub toast) |
| **New target** | `src/components/MathPalette.tsx` (new). Per Law 2, Math Palette marks are one of the two things allowed to land directly on the canvas (no Drop-In™ wrapping). |
| **Risk notes** | The "drop a single glyph stamp at a point" behavior is the canvas-affecting half of the palette. Inserting LaTeX into the AI Pane composer is a different affordance and should not be conflated. Decide which behavior is invoked from where before writing. |

---

## J. Notebook / section / page navigation

| Field | Value |
|---|---|
| **Old domain** | OneNote-style hierarchy |
| **Source anchor** | new in noteometry-os (no exact Obsidian-shell analog — Obsidian's vault tree was the analog) |
| **Old files** | n/a |
| **Decision** | **ALREADY BUILT** (`src/lib/useNoteometryNav.ts`, `src/components/SectionTabs.tsx`, `src/components/PageRail.tsx`) |
| **Risk notes** | Persistence is `localStorage`. Per-page canvas content uses tldraw's IndexedDB store keyed by `nm-page-<id>`. Deleting a page does *not* currently delete the IndexedDB store for that page — orphan tldraw data accumulates. Add cleanup when this matters. |

---

## K. Context menu (flat right-click palette)

| Field | Value |
|---|---|
| **Old domain** | Right-click commands |
| **Source anchor** | new in noteometry-os; Obsidian had no equivalent |
| **Decision** | **ALREADY BUILT** (`src/components/ContextMenu.tsx` — submenu support removed; headers added) |
| **Risk notes** | Per Law 7, **adding `submenu` back is a regression**. The Anti-Regression Checklist enforces this. |

---

## L. Engineering-paper grid

| Field | Value |
|---|---|
| **Old domain** | Canvas background |
| **Source anchor** | new in noteometry-os |
| **Decision** | **ALREADY BUILT** (`.noteometry-canvas-shell` in `src/index.css`; tldraw bg forced transparent) |
| **Risk notes** | Pan/zoom does **not** move the CSS background. This is an accepted limitation of CSS-gradient grids. Switching to a tldraw-rendered grid is allowed only if it stays battleship grey + 12 px / 96 px and Law 8 is amended first. |

---

## M. Zoom control

| Field | Value |
|---|---|
| **Old domain** | Canvas zoom UI |
| **Source anchor** | new in noteometry-os |
| **Decision** | **ALREADY BUILT** (`src/components/ZoomControl.tsx`) |
| **Risk notes** | Lives bottom-right per Law 7. Do not move it into a toolbar. |

---

## N. Persistence layer (app state + canvas state)

| Field | Value |
|---|---|
| **Old domain** | Obsidian plugin settings + vault notes |
| **Source anchor** | n/a (Obsidian-specific) |
| **Decision** | **IGNORE** (Obsidian's plugin settings APIs do not apply) |
| **New target** | `localStorage` for app state (with versioned keys), tldraw IndexedDB for canvas content. |
| **Risk notes** | Migrations must be explicit (Law 12). No silent in-place key mutation. |

---

## O. Tldraw shape utils / DropInShape

| Field | Value |
|---|---|
| **Old domain** | Earlier scratch work, partially in this repo |
| **Source anchor** | current noteometry-os (`src/DropInShape.tsx.bak`) |
| **Decision** | **REWRITE** when Drop-Ins™ land (Law 3). The `.bak` file is unreferenced today; it is a starting sketch, not the spec. |
| **Risk notes** | tldraw v5 ShapeUtil API differs from older versions; verify against current docs before reviving. |

---

## P. Tests

| Field | Value |
|---|---|
| **Old files** | `tests/unit/mathml.test.ts`, `tests/unit/lassoSelection.test.ts`, `tests/unit/dropinExport.test.ts` (v1.10) |
| **Decision** | **REWRITE** under whichever runner we pick for noteometry-os (vitest is the natural default) |
| **New target** | `tests/` (to be created) |
| **Risk notes** | The v1.6.6 `mathml.test.ts` is the most valuable port — it pins the clipboard payload shape. Worth re-porting **before** future MathML changes so the contract has a tripwire. |

---

## Q. Anything not on this list

If a v1.6.6 or v1.10 file isn't enumerated above, the default is **IGNORE** — Obsidian shells, settings tabs, plugin manifests, modal dialogs, vault file handlers, hotkey registrars, command palette integrations, etc.

When in doubt: read the relevant Law in `NOTEOMETRY_OS_FEATURE_CONTRACT.md`. If the file enables behavior that no Law calls for, do not port it.
