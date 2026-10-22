# SGPA & CGPA Calculator PWA

A Progressive Web App for B.Tech students to track semester performance, calculate SGPA and cumulative CGPA, and export academic reports. It runs as a web app, an installable PWA, and an optional Electron desktop wrapper.

## Features

- Multiple semester management with editable subject names, grades, and credit values
- Real-time SGPA per semester and credit-weighted CGPA across all semesters
- Selectable grading systems: Standard B.Tech, VTU 10-point, Anna University, JNTU Pattern, and a custom 7-point scale
- Premium-navy glassmorphism dashboard with eight selectable themes (Premium Navy, Light, Red Black Neon, Electric Blue, Cyber Magenta, Acid Green, Violet Grid, Orange Pulse)
- Hand-built inline SVG trend chart with a screen-reader accessible data table
- PWA install support and offline caching through a service worker
- Automatic `localStorage` persistence of the academic plan
- PDF export and clipboard summary sharing (the report is printed through the browser's own print dialog, so "Save as PDF" is a destination the user chooses)
- JSON backup export and a validated, confirmed import that keeps a recoverable copy of the plan it replaces
- An optional email/password account screen backed by Supabase when configured, and a fully usable guest mode when it is not
- Toast notifications for grading changes, exports, and validation feedback, with the stack capped at three so the dashboard stays readable on small screens
- Accessible confirmation dialog (glass, `role="alertdialog"`) for destructive and grading-changing actions, with a trapped focus, Escape to cancel, and the focus restored to the control that opened it
- A restrictive Content Security Policy delivered by the page and by the local development server, with no external script, style or data source; a configured account adds only the exact Supabase project origin to `connect-src`

## Requirements

- Node.js 22 or newer for the test suite and `npm run verify:browser`; both are verified on Node 22, and the browser check needs the global `WebSocket` API
- The application and development server use only browser APIs and the Node standard library
- No runtime dependencies; the optional Supabase browser SDK is vendored under `vendor/`
- Node.js 22 or newer for `npm run verify:browser`, because the browser-verification script uses the global `WebSocket` API

## Installation

```bash
git clone <REPO_URL>
cd "SGPA-CGPA CALCULATOR"
```

`npm install` is optional and only required for the Electron desktop wrapper.

## Running the app

```bash
npm start          # development server on http://127.0.0.1:8080
npm run electron   # optional desktop wrapper (requires npm install)
```

Open `http://127.0.0.1:8080` in a browser. For full PWA behaviour (installability, service worker) serve the folder over HTTPS or from `localhost`.

## Tests

```bash
npm test           # node --test
```

The suite runs with `node --test` and covers the calculation engine, credit validation, grading-system switching, saved-state repair, incomplete-result reporting, XSS-safe rendering, accessibility wiring, the development server, the service-worker asset contract, and the optional authentication adapter.

### Browser verification

```bash
npm run verify:browser                                  # uses the local Chrome or Edge
node tools/browser-verify.js --contrast-only             # only the theme contrast measurements
node tools/browser-verify.js --out ./browser-report     # write the report and screenshots here
node tools/browser-verify.js --browser "C:\path\to\chrome.exe"
```

This is a **separate** path from `node --test` and needs no installation: it drives a locally installed Chromium-family browser through the DevTools Protocol using Node's built-in `WebSocket`. It starts its own development server on port 8123, blocks every non-local request, and changes no source file.

It checks: dashboard startup and critical rendering; theme switching across all eight themes at 375, 768 and 1440 px (including horizontal-overflow detection); that the hero title and its supporting copy never overlap the header controls, measured as the intersection of the rendered text runs with the visible control rectangles across eight themes and nine widths; recovery when `localStorage` refuses writes, including the single session-only warning; the add/remove-subject safeguards and save/restore across a reload; service-worker registration, cache contents, the web app manifest and a genuine offline reload with the origin server stopped; keyboard focus visibility plus accessible names from the browser's accessibility tree; the account interface (focus moved into the view, Tab kept inside it, Escape closing it with focus restored, masked password, labelled fields, inline validation, the honest "no provider configured" failure when auth is disabled, a guest state that never becomes a session, no password in storage, and, with a mocked provider, a failed sign-out that keeps the session plus a safely explained callback error); the confirmation dialog (role, accessible name and description, focus that cannot leave it while Tab is pressed, Escape to cancel, focus restored to the trigger, and a confirmed deletion that really deletes); the printable report and the print stylesheet (every summary metric, every semester, every subject, an unsupported grade printed as zero points, the interface hidden in print media, the report itself visible, and a captured PDF); a real backup export and import round trip including a rejected malformed file that changes nothing; the contrast of the floating toast surface; the content security policy (declared in the head of both documents, delivered by the local server, no external resource, and no violation reported by the browser); and theme contrast, including the hovered primary, outline and secondary button labels that are measured with the real pointer over the control.

Exit codes: `0` all checks passed, `1` a check failed (including a measured contrast violation), `2` no usable browser was found and nothing ran. Screenshots, `report.json` and `contrast.json` are written to a temporary directory by default (`--out` overrides it).

### Contrast measurement

The contrast check measures the **rendered pixels** of the page, not CSS colour values, so gradients, alpha and glass surfaces are measured as they are actually painted:

- **Text (WCAG 1.4.3)** — 24 visible text samples per theme at 1440 px and 375 px. The target is 4.5:1, or 3:1 where the text qualifies as large (24 px, or 18.66 px bold), determined from the computed font size and weight.
- **Hovered button labels (WCAG 1.4.3)** — the primary, outline and secondary action labels with the real pointer over the control in every theme at 1440 px, measured after `:hover` is confirmed. The target is the same 4.5:1 (or 3:1 for large text).
- **Component boundaries (WCAG 1.4.11)** — the subject input and select borders against their field background, the outline button border against the panel, and the invalid-input border. The target is 3:1.
- **Focus indicators (WCAG 1.4.11 / 2.4.11)** — five controls per theme, reached with real Tab key presses so `:focus-visible` applies, then compared against the surrounding pixels. The target is 3:1.
- **Toast text (WCAG 1.4.3)** — the success and error toast variants in every theme. The clipboard is stubbed so each variant is produced on demand, and the message is measured against the composited pixels of the floating glass sheet. The target is 4.5:1.

How it is measured, and what it cannot do:

- The background behind text is the median colour of the rendered pixels that are not the glyph itself, so it already includes any gradient, translucency or backdrop filter underneath. Where a gradient runs behind the text, the median over the text's own box is a representative value rather than a worst case.
- A control can show more than one focus cue (a solid border plus a soft ring). The changed pixels are grouped by colour and the strongest significant group is reported, so a faint ring cannot mask a strong border.
- A measurement that cannot be resolved reliably is reported as `UNVERIFIED` with the element and the reason, and an unverified measurement is never counted as a pass.
- A pass therefore means "no measured violation", not "WCAG conformant": the script does not evaluate every criterion and cannot speak for untested engines.

The current application state is recorded by the run itself: at the time of writing every measurement passes (496 of 496 page measurements plus 16 toast measurements, with no unverified results) in all eight themes.

## Release verification

The checks below were run locally against this workspace. They are grouped by how they were executed, because the three groups prove different things.

### Automated tests — `node --test`

**222 tests, 222 passing, 0 failing**, across twelve suites (calculation, credit validation, grading switch, saved state, incomplete results, sanitising, accessibility/UI, account and backup, backup format, authentication adapter, development server, service-worker assets). These are unit and static-source assertions. Part of the accessibility suite runs the real `script.js` inside a `node:vm` DOM stub; that stub has no layout engine and no CSS matching, so it verifies wiring, state and DOM contracts — never appearance. The authentication suite uses a fake Supabase client; it does not contact a live project.

### Genuine browser checks — headless Chrome 155.0.8059.85 (Edge 155.0.4283.62 used as a second Chromium build)

- **Themes** — all eight themes rendered at 1440 px and 375 px, with per-theme foreground/background contrast measured on rendered pixels.
- **Viewports** — 320, 375, 768, 1024 and 1440 px: no horizontal overflow and no element crossing the viewport edge in any theme.
- **Keyboard** — 30 tab stops, every control matching `:focus-visible`, and no unnamed interactive element in the Chrome accessibility tree.
- **Confirmation dialog** — the dialog is an `alertdialog` with `aria-modal="true"`, a linked title and description, and a dimmed, blurred backdrop; six Tab presses never leave the dialog, Escape closes it, the focus returns to the button that opened it, and confirming really deletes the semester.
- **Hero layout** — the title and the supporting copy are measured against the visible header controls in all eight themes at 320, 375, 900, 920, 960, 1024, 1160, 1280 and 1440 px. The check compares the rendered text runs with the control rectangles and also reports text that overflows its own box, and it fails with the theme, the width and the overlapping control named.
- **Account interface** — the account view opens as a dialog, the calculator is hidden behind it and returns afterwards, the focus moves to the view heading, Tab never leaves the view, Escape closes it and restores the focus, the password field is masked and can be revealed, an empty form reports the missing fields, a complete form reports that no authentication provider is configured, the session chip stays on "guest", no sign-out control is offered, and the typed password never reaches `localStorage`.
- **Backup round trip** — a backup file is downloaded in the browser, its name and contents are checked, the plan is changed, the file is imported again, the plan is restored through the confirmation dialog, and a malformed file is rejected with the plan left untouched.
- **Reduced motion** — with `prefers-reduced-motion: reduce` emulated, the decorative animations and hover transforms are suppressed while the active and focus states stay intact.
- **Storage failure** — with `localStorage.setItem` throwing, the app still initialises, renders and edits in memory, warns once, and raises no uncaught error.
- **PWA** — the service worker activates, the cache holds the expected assets, the manifest parses without errors, and a reload performed while the origin server was stopped was served entirely from the cache; the offline fallback page and recovery were checked as well.
- **Contrast** — 496 rendered-pixel measurements across the eight themes (text, hovered button labels, component boundaries and focus indicators) plus 16 toast measurements (the success and error variants in every theme) are produced by `npm run verify:browser`; the outcome is written to `contrast.json` and summarised in the terminal.
- **Evidence** — the checks above are repeatable with `npm run verify:browser`; each run writes screenshots, `report.json` and `contrast.json` to a local temporary folder outside the repository (`%LOCALAPPDATA%\Temp\sgpa-cgpa-browser-verify\` by default, `--out` overrides it). They are not part of the repository and are not preserved across machines.

### Not verified

- **Safari/WebKit and Firefox** — neither engine is installed on the verification machine and installing one was out of scope. The storage-failure path has therefore only been exercised against a simulated `QuotaExceededError` in Chromium, not in a real WebKit private window.
- **A physical printer and a visible print dialog** — the report is verified through Chromium's print emulation and a captured PDF. Choosing "Save as PDF" in the dialog and the paper output were not observed.
- **Electron's visible print preview** — no display server is available, so the wrapper was verified at the process and console level only.
- **GitHub Pages response headers** — the project contains no hosting configuration, and the hosting mode is unspecified, so whether arbitrary response headers can be set for a deployment is unverified.
- **A live Supabase project** — no project URL, publishable key, email template or redirect allowlist exists in this repository, so sign-in, registration, confirmation-email delivery, PKCE callback handling, token refresh and online `getUser()` verification were exercised only with the fake client in the automated suite. No real credential was sent or stored.
- **Provider configuration in the deployed page** — both meta tags are empty by default. Adding a project URL and publishable key in the HTML is visible to every visitor, as intended for a publishable key, but the exact CSP origin must be updated at the same time.
- **Any cloud storage or synchronisation** — none exist. The plan is local only, and the backup file is the only way to move it.
- **Screen-reader speech, physical touch input, and launching the installed PWA standalone.**
- **Runtime execution of the `@supports` glass fallback** — Chromium supports `backdrop-filter`, so that branch is verified by source inspection only.

### Known harness limitation

The DOM stub stores `innerHTML` as a string and hands out one cached element per queried selector, so a control must be reached through the element the application itself queried. It is not parsed into a real child tree: doing so would change the identity of every queried node and invalidate the existing toast-message assertions. Assertions that need a control therefore use the application's own query path, and appearance is always confirmed in a real browser instead.

## Printing the report

The **Print / Save as PDF** action builds a report from the current plan and opens the browser's own print dialog. The application does **not** download a file: the user chooses the destination, either "Save as PDF" or a physical printer, and the browser writes the file. The application never claims that a PDF was saved, because the browser does not report the outcome — the print dialog is dismissed in the same way whether the user printed or cancelled.

The report contains:

- the report title and the date it was generated;
- the selected grading system;
- the overall CGPA and the estimated percentage (the existing ×9.5 rule);
- total credits, total subjects, the latest semester SGPA, the best, lowest and average SGPA, and the performance note — all from the same summary logic the dashboard uses;
- every semester in the plan, not only the one selected on screen, with its subject count, SGPA and percentage;
- every subject of every semester with its name, grade, credits and grade-point value, where a grade that the active grading system does not contain is marked "(unsupported)" and counted as zero points, exactly as the calculator counts it;
- the incomplete-results warning, with the same counts the dashboard shows.

The report is a separate element that is hidden while the application is on screen, so printing never disturbs the dashboard. It is removed when the print dialog closes (`afterprint`) and after a deliberately long fallback timeout for an engine that never delivers that event; the fallback timer is cancelled as soon as the normal cleanup runs, so the report is never removed while a print dialog is still open. Printing again replaces the previous report instead of adding a second one. A dedicated `@media print` stylesheet gives the report A4 portrait pages with white backgrounds, dark text, repeating table headings, and rows that are not split across pages, and hides the navigation, buttons, toasts, dialogs and the account screen.

## Content Security Policy

The application runs under one restrictive policy. With authentication left unconfigured, that policy is:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'
```

To enable Supabase authentication, replace the single `connect-src` source with `'self'` plus the exact project origin, for example:

```
connect-src 'self' https://<PROJECT_REF>.supabase.co
```

Do **not** use a wildcard such as `https://*.supabase.co`. Add the exact origin to the `<meta http-equiv="Content-Security-Policy">` element in `index.html` only. Do **not** change `offline.html`: it is auth-free and must keep `connect-src 'self'`. The local server reads the policy from `index.html` and uses the auth-free default for `offline.html` and error documents, so the server does not need a second edit. The vendored SDK and `auth-provider.js` remain local scripts, so `script-src 'self'` does not need to change.

It is delivered twice:

- as a `<meta http-equiv="Content-Security-Policy">` element in the `<head>` of `index.html` and `offline.html` (the latter always auth-free), so every environment is covered, including a static host and the Electron wrapper;
- as a response header from the local development server (`server.js`) for HTML documents only, so the policy is in force before the document is parsed.

There is no `unsafe-eval`, no `unsafe-inline`, no remote script source and no `file:` source. The application loads no external script, style, font or image: the Supabase SDK is vendored locally, and the `html2pdf.js` CDN dependency was removed with the old export, so the report is produced by the browser's own print pipeline. The only permitted cross-origin connection is the exact Supabase project origin when authentication is configured.

Two limitations are known and are not worked around:

- **`frame-ancestors` is not enforced.** A policy delivered in a `<meta>` element cannot express that directive — the browser logs "the directive 'frame-ancestors' is ignored when delivered via a `<meta>` element". It can only be sent as a response header, which this repository cannot currently configure because the hosting mode is unspecified. The application therefore does not claim to be protected against framing.
- **The Electron wrapper runs from `file://`.** A document policy is enforced there, and `script-src 'self'` already covers the application's own local files, so no `file:` allowance was added. With the policy in place the wrapper starts without Electron's own content-security warning and without any unhandled service-worker rejection. The visible print preview could not be inspected here, because no display server is available.

## Academic grading guide — source-gap analysis (read-only assessment)

No grading guide is implemented. This section records what the source can and cannot support, so that a future guide is written from evidence rather than from assumption. **It is a source-gap analysis, not an academic certification.**

**Grading systems the code actually supports** (`calculator.js`):

| Identifier | Label in the app | Grade → points |
|---|---|---|
| `standard-btech` | Standard B.Tech | S=10 A=9 B=8 C=7 D=6 E=5 F=0 |
| `vtu` | VTU 10-point | S=10 A=9 B=8 C=7 D=6 E=5 F=0 |
| `anna-university` | Anna University | O=10 A+=9 A=8 B+=7 B=6 C=5 F=0 |
| `jntu` | JNTU Pattern | A+=10 A=9 B+=8 B=7 C=6 D=5 F=0 |
| `custom-7point` | Custom 7-point | A=7 B=6 C=5 D=4 E=3 F=0 |

**What the source can document on its own:** the grade labels and point values above; the credit-weighted SGPA and CGPA definitions; the ×9.5 percentage rule; the rule that a grade missing from the active scale counts as zero points and is reported as incomplete; and the credit rules (a non-numeric or negative credit is rejected and excluded from the totals).

**What the subject model actually stores:** `id`, `name`, `grade` and `credit`. There is no subject code, no internal mark, no external mark, no total mark and no result or pass/fail field anywhere in the application. A guide must say so rather than implying the calculator handles those columns.

**What is generic academic terminology and can be defined safely:** serial number, subject code, subject name, internal assessment mark, external examination mark, total mark, result, grade and credits, explained as the usual meaning of a result or memo column.

**What requires an authoritative document and must not be written from the source:** the official column headings of a particular result sheet or memo, the pass-mark rule, the grade boundaries a regulation prescribes, the credit weights a regulation prescribes, the result classification, and the semester-wise layout. The labels in the table above are the app's own names; "JNTU Pattern" is not evidence about any specific JNTUK regulation (including R23), and none of the maps is institution-certified.

**Documents needed before an official guide:** for each system a guide intends to cover, the relevant institution's official regulations and grading rules for the intended programme and regulation year — the credit structure, the internal/external assessment split and weightings, the pass marks, and the grade-to-point mapping — obtained from the institution itself.

## Accounts and authentication

The account screen is an optional email/password interface backed by Supabase. Authentication is **disabled by default**: both configuration meta tags are empty, the guest state is kept, the calculator remains fully usable, and a submitted form reports honestly that no provider is configured.

When configured, the following behaviour applies:

- **Authorization Code Flow with PKCE** is used. The client is created with `flowType: 'pkce'`, `detectSessionInUrl: true`, `autoRefreshToken: true`, `persistSession: true` and `skipAutoInitialize: true`.
- **One client and one initialization.** The provider subscribes to `onAuthStateChange` before calling the SDK's `initialize()` once, then reads the stored session and verifies it. It never performs a manual code exchange.
- **The callback URL is verified.** The provider computes the application directory, for example `https://gopi-the-coder.github.io/sgpa-cgpa-calculator/` or `http://127.0.0.1:8080/`, and rejects any configured redirect that does not match it exactly.
- **A session is not proof by itself.** A stored session is reported as signed in only after an online `getUser()` succeeds. While offline, a stored session is shown as `offline-unverified` with the email for context, and the interface explicitly says it could not be verified.
- **A completed auth callback URL is cleaned** after initialization: `code`, `sb_flow_id`, `error`, `error_code` and `error_description` are removed while unrelated query parameters and the hash are preserved.
- **Sign-out is local** (`scope: 'local'`). It ends this browser's session and leaves the plan untouched.
- **The plan stays local.** Signing in does not upload, download or sync the plan. Backup export/import remains the only way to move it.
- **No password is stored or compared locally.** Supabase stores its own session token in browser storage; the application never reads it as proof of sign-in and never puts a password or token in a backup or log.

### Enabling authentication

1. Create a Supabase project and enable the Email provider under Authentication.
2. Set the project Site URL and Redirect URLs to the exact application directory:
   - `https://gopi-the-coder.github.io/sgpa-cgpa-calculator/`
   - `http://127.0.0.1:8080/` for local development
3. Fill both meta tags in `index.html`:
   ```html
   <meta name="sgpa-supabase-url" content="https://<PROJECT_REF>.supabase.co" />
   <meta name="sgpa-supabase-publishable-key" content="sb_publishable_..." />
   ```
   A legacy anon JWT is also accepted. A secret key (`sb_secret_...`) or a JWT with the `service_role` role is rejected.
4. Add the exact project origin to `connect-src` in `index.html` only, as described under **Content Security Policy**. Keep `offline.html` at `connect-src 'self'`.
5. Keep the SDK pinned and verified. The vendored bundle is `@supabase/supabase-js@2.118.0`; CI checks that `vendor/supabase.js` has SHA-256 `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3`.

The Electron wrapper opens the application from `file://`; authentication is disabled there, because no allowed Supabase origin can be configured for that origin and PKCE requires a secure browser context.

### Security boundaries

- Only a publishable key or anon JWT may reach the browser. A `service_role` key grants server-side privileges and must never be committed or deployed in client code.
- This build has no database tables, no plan upload and no row-level security to configure. If plan synchronization is added later, every table must use row-level security restricted to `auth.uid()` before any data is sent.
- The authentication adapter is exercised with a fake client in the automated suite. Live sign-in, confirmation-email delivery, PKCE callback handling and online user verification require a real Supabase project and are not claimed as tested here.

The following are still not implemented: cloud plan storage, synchronization, password-reset UI, OAuth providers, account deletion, and multi-device conflict handling.

## Backup format

`Export backup` writes a JSON document that contains the saved plan and nothing else:

```json
{
  "format": "sgpa-cgpa-backup",
  "version": 1,
  "exportedAt": "2026-10-21T09:00:00.000Z",
  "plan": {
    "semesters": [{ "id": "s1", "title": "Semester 1", "subjects": [{ "id": "a1", "name": "Mathematics", "grade": "S", "credit": 4 }] }],
    "selectedSemesterId": "s1",
    "selectedGradingSystem": "standard-btech"
  }
}
```

- `plan` keeps the exact structure that is stored on the device, so a restore needs no conversion and the saved-data schema is unchanged.
- No token, password, secret or unrelated browser data is included.
- `Import backup` parses defensively, rejects an unknown format or version, a broken plan, or an unknown grading system without touching the current data, previews the contents, and asks for confirmation.
- Before anything is replaced, the current plan is copied verbatim to `sgpaCgpaPwaStateRecovery`. If that copy cannot be written, the import is stopped. If the restore cannot be saved, the previous plan is put back and the failure is reported.

## Project structure

- `index.html` — application shell, theme picker, KPI cards, semester editor, report panel, bottom navigation, and empty Supabase configuration meta tags
- `styles.css` — design tokens, theme definitions, glass surfaces, responsive layout, and motion
- `script.js` — application state, rendering, trend chart, PDF export, clipboard sharing, account UI, and service-worker registration
- `auth-provider.js` — optional Supabase PKCE adapter, configuration checks, session verification, and URL cleanup
- `vendor/supabase.js` — pinned Supabase browser SDK (`@supabase/supabase-js@2.118.0`) with its MIT license alongside it
- `calculator.js` — pure calculation engine: grade maps, SGPA/CGPA math, sanitising, and HTML escaping
- `manifest.json` — Progressive Web App metadata
- `sw.js` — service worker caching logic (network-first for app assets, cache-first for the offline page, auth-bypass for callbacks and Supabase traffic)
- `server.js` — local development server built on `node:http`
- `offline.html` — offline fallback page
- `main.js` / `preload.js` — Electron wrapper (context isolation enabled, no bridge exposed; authentication is disabled on `file://`)
- `icons/` — SVG application icons
- `tests/` — `node --test` suites, including `tests/auth-provider.test.js` with a fake Supabase client
- `tools/` — browser-verification scripts (`browser-verify.js` and its `png.js` helper) used by `npm run verify:browser`

## Implementation notes

- Data is stored in `localStorage` under `sgpaCgpaPwaState`, `sgpaCgpaGradingSystem`, and `sgpaCgpaTheme`. A payload that cannot be read is copied verbatim to `sgpaCgpaPwaStateRecovery` before the app starts with a fresh plan, so it is never lost silently.
- When authentication is configured, Supabase stores its own session in browser storage. The application never treats a cached token as proof of a valid session: it verifies online with `getUser()`, and an offline cached session is labelled `offline-unverified`.
- The service worker bypasses authentication callback requests and all `.supabase.co` requests, so auth responses and tokens are not written into the application cache.
- The service worker needs an http(s) origin. The Electron wrapper opens the app from the file system, where the Cache API cannot store the local files, so the worker is not registered there and the renderer stays free of unhandled rejections.
- The trend chart is generated as inline SVG in `script.js`; no charting library is used.
- The development server and the service worker use only the Node standard library and browser APIs.
- All motion is decorative, transform/opacity based, and disabled under `prefers-reduced-motion: reduce`.

## Future improvements

- Cloud backup and cross-device sync of semester data
- Per-university credit-system presets
- Semester notes and goal tracking
- A dedicated printable report page with print styles
- Dynamic document theme colour that follows the selected theme
- Localisation for wider accessibility
