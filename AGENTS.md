# Agent guide

Use a dedicated Git worktree before editing. Validate and commit there;
leave the worktree clean when done. Keep the default checkout coordination-only.

This repository owns the hosted coordinate-alignment app:
https://stanfordnqp.github.io/kordaline/

- index.html: plain two-column UI.
- app.js: numerical model, spreadsheet interactions, SVG plots.
- styles.css: minimal styling.
- tests/: Node numerical tests and jsdom interaction tests.
- .github/workflows/deploy.yml: test and deploy main to GitHub Pages.

Run npm ci and npm test before committing. No build or dependencies are needed
at runtime. Deployment explicitly packages only the three runtime files.
Do not publish research data, private parent-repository files, or sample inputs
containing real measurements.

Preserve translation-only fitting, full internal precision, checked-row
selection, typed decimal display precision, and standard errors using sample
variance. One pair cannot estimate uncertainty. Target inputs do not affect
alignment statistics. The shared translation uncertainty assumes exact targets.
Preserve spreadsheet block pasting, P1/P2 target labels, equal plot scales, and
round 1–2–5 ticks. Inputs currently do not persist across reloads.

Keep public UI generic: Frame 1 and Frame 2, not instrument or GDS terminology.
This repository, rather than the original gds-studio copy, owns future hosted
app changes. Do not add a backend or upload user coordinates without approval.
