# coordalign

[Open the app](https://stanfordnqp.github.io/coordalign/)

A small, browser-only tool for transferring coordinates between two frames.
It fits translation only: no rotation, scaling, or axis inversion.
No installation, account, server computation, or data upload is required.

## Use

1. Enter corresponding measurements in **Alignment points**, in mm.
   Paste four spreadsheet columns into the first coordinate cell:
   Frame 1 X, Frame 1 Y, Frame 2 X, Frame 2 Y.
   Two-column pastes into either frame also work. Rows expand automatically.
2. Uncheck rows to exclude them from analysis. Blank rows are ignored;
   incomplete checked rows must be completed or excluded.
3. Enter or paste two-column Frame 1 coordinates in **Points to transform**.
   Their Frame 2 coordinates appear to the right. **Copy Frame 2** copies
   those outputs as spreadsheet-ready text.

Everything recalculates on input. The first plot shows alignment points and
targets labeled P1, P2, etc. The second shows row-labeled residuals in µm,
or raw displacement in mm. Both plots use equal scales and rounded ticks.

**Inputs are not saved across reloads.** Preserve your data before refreshing.
**Copy rows** copies alignment coordinates, including excluded rows, but not
checkbox states. **Copy Frame 2** copies target outputs, not target inputs.
Copy confirmations disappear after five seconds.

## Model and uncertainty

For checked alignment pairs, the least-squares translation is the mean of
`Frame 2 − Frame 1`. Each target output is its Frame 1 position plus that mean.
Target rows never influence the fit or statistics.

For n > 1 pairs with residuals r:

```text
SE_X = sqrt(sum(r_x²) / (n × (n − 1)))
SE_Y = sqrt(sum(r_y²) / (n × (n − 1)))
2D RMS uncertainty = sqrt(SE_X² + SE_Y²)
```

The same translation uncertainty applies to every target, assuming exact
target inputs. It is a shared error, not an independent error per target.
These estimates assume independent, unbiased alignment measurements of
comparable precision. They exclude systematic errors and uncertainty in target
coordinates. One pair gives no uncertainty estimate. The 2D value is not a 95%
confidence radius. At fixed scatter, uncertainty falls as 1/√n; adding a noisy
measurement can still increase it.

Readouts preserve the maximum decimal resolution typed in the used alignment
rows, including trailing zeros. Each target also honors its own input precision.
Copied outputs match displayed values. Calculations retain full precision.

## Development and deployment

Open `index.html` directly to use the app offline. Only `index.html`,
`app.js`, and `styles.css` are needed at runtime.

```sh
npm ci
npm test
```

Node 22 is used in CI. Development dependencies are only for tests.
Tests cover the numerical model, spreadsheet input, exclusion, precision,
multiple targets, plot ticks, and clipboard interactions with jsdom.

GitHub Pages is configured with **GitHub Actions** as its build source.
Pushes to `main` run tests and publish only the three runtime files.
Pull requests run tests without deploying. The workflow can also be run manually.

This standalone app was extracted from `tools/ebl_alignment` in gds-studio
at commit `409d077`. This repository is the maintained source for the hosted app.
The original Python CLI remains in gds-studio and is not needed here.
