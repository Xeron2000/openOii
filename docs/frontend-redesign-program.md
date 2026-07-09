# Frontend Redesign Program (C2 + C3)

Agreed via grill session. Domain language: root `CONTEXT.md`. Decisions: `docs/adr/0001`–`0003`.

## Goals

- Full warehouse visual/density consistency (scope C).
- High information density, KISS layout.
- Dense Comic Workbench aesthetic (D2).
- Soft Interaction Freeze (F2).

## Non-goals

- Big-bang single PR.
- Cold SaaS / dual theme.
- Changing selection binding, agent-column role, cell regenerate semantics, or reintroducing document scroll.

## Authority

- **SSOT**: `frontend/app/styles/tokens.css` (+ minimal Tailwind/daisy).
- **Same PR**: update `DESIGN.md` when tokens change (light T3).

## Domain batches (O1)

| # | Domain | Surfaces | Status |
|---|--------|----------|--------|
| 0 | Design Contract | tokens, DESIGN.md §0, shared utilities | **done** |
| 1 | Workbench Shell | PageShell, TopBar, StagePipeline, App root, list chrome-row | **done** |
| 2 | Home | HomePage, SkillWall, create form density | **done** |
| 3 | Director Desk | ProjectPage, WorkspaceSidebar, Chat*, canvas shapes/layout, Inspector | **done** |
| 4 | Lists | ProjectsPage, Universes*, cards | **done** |
| 5 | Chrome extras | Settings, drawers, toast, remaining ui/* | **done** |

## Acceptance (G2)

Per batch:

1. `pnpm exec vitest` (touched + related) green  
2. `pnpm build` / tsc green  
3. Manual: open project → observe run/recovery chrome → select shot cell → feedback shows binding → cell regenerate  
4. Shell/contract batches: **no document-level scrollbar**

### Program close-out evidence (2026-07-09)

| Check | Result |
|-------|--------|
| Frontend full vitest | 47 files / 374 tests green |
| `pnpm build` (tsc + vite) | green |
| Backend `tests/test_skills_and_reimagine.py` | 7 passed |
| Batches 0–5 | all **done** |
| F2 interaction freeze | no rebind of selection / generate / confirm / cancel / resume / viewport lock |
| Manual G2 (project `/projects/3`) | viewport lock (`html/body/#root` overflow hidden, `.page-shell`); StagePipeline + regenerate chrome; canvas 九宫格; select S01 → chat shows `绑定 · shot · S01`; inspector 操作 has `重做本格 · 首帧图/视频` |
| Git | pushed `main` (`53f258f` + `f199998`) |

## Interaction freeze (F2) checklist

Must keep meaning:

- Agent Column = conversation + binding surface  
- Canvas selection binds entity to feedback/inspector  
- Cell regenerate image/video  
- Generate / confirm / cancel / resume  
- Viewport-locked Workbench Shell  

May change: defaults, label length, secondary entry folding, visual density only.
