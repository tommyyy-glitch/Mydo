# Mydo UI/UX and repository research

Checked 2026-09-27, using the user's requested find-skills and git-find workflows. Cola Skill was the initial catalog, followed by original GitHub repositories and exact source locations. These are references, not code imported into Mydo. No third-party skill was installed or executed, and no third-party implementation was copied.

## Ranked skill candidates

1. **UI UX Pro Max** — [Cola Skill listing](https://colaskill.com/ui-ux-pro-max-skill/), [original repository](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [UX data](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/data/ux-guidelines.csv). The source is MIT and advertises multi-agent support including Codex. Relevant as a design checklist for focus visibility, text contrast, small screens, labels and motion preferences. Its generator involves a separate setup; we used the published guidance as research, not an installed workflow. API metadata showed activity on 2026-09-27. Popularity is not a quality or safety guarantee.
2. **Frontend Design (Anthropic)** — [original skill file](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md). Useful for a coherent visual direction and deliberate typography/spacing. Its metadata points to a separate license file; that file's terms were not verified for this task, so it is an ideas-only candidate. Instructions target Claude and would need review for Codex. No reliable matching Cola detail page was located in the catalog search.
3. **Already installed: vibe-debug-pr-loop** — used for acceptance checks, model tests, actual browser interaction, screenshot review, and final diff review. It adds delivery discipline rather than a visual style.

## Ranked Git references

1. **xyflow / React Flow** — [repository](https://github.com/xyflow/xyflow), [validation example](https://github.com/xyflow/xyflow/tree/main/examples/react/src/examples/Validation), [React examples setup](https://github.com/xyflow/xyflow/blob/main/examples/react/README.md), [MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE). Best future starting point if Mydo needs draggable nodes, zoom/pan or interactive connection drawing. It requires React (or the separate Svelte implementation) and replacing the static SVG relationship view. The examples are part of a larger workspace; do not transplant the workspace package file blindly. API metadata showed activity on 2026-09-24.
2. **Super Productivity** — [repository](https://github.com/super-productivity/super-productivity), [task feature directory](https://github.com/super-productivity/super-productivity/tree/master/src/app/features/tasks). Useful reference for task interactions and an established productivity workflow. GitHub identifies an MIT license; activity was reported on 2026-09-27. Its Angular-based application and wider integration/state architecture are substantially larger than Mydo's static-browser scope. Copying its task module would require adapting framework dependencies, store architecture and persistence. Used as interaction research only.

## Resulting choices

- Original HTML/CSS/JavaScript implementation, zero runtime dependencies and no external fonts or scripts. It fits the existing static-hosting pattern with a separate repository.
- Soft charcoal surfaces, mint for actions/readiness, amber for deadline pressure, text/icon labels alongside color. Warm, restrained contrast; no decorative animation.
- Four views of the same data: actionable list, priority matrix, prerequisite diagram, complete inventory. A dedicated form keeps the distinction between motivation, urgency and real deadlines visible.
- Empty first-run state, with optional explicitly temporary examples. Language switching never rewrites user data.
- JSON portability and clear local-storage boundaries. Cloud sync is deferred until a separate authenticated data design is requested.

License observations are not security audits. Source activity dates are point-in-time API metadata, not proof of code quality.
