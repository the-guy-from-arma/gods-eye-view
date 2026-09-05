# Changelog

## [0.3.09] — 2026-09-05 — Multiplayer activity globe

- Replaced Steam's oversized regional heat circles and clustered count badges
  with a globe-hugging field of small, deterministic white and green activity
  points inspired by classic multiplayer population globes.
- Added pointer hover cards with regional concurrency estimates, observed public
  server/slot counts, and an explicit warning that dots are visualization samples
  rather than individual players or player locations.
- Raised the client/server response window to cover the complete bounded Steam
  catalog returned for all configured games, eliminating the artificial 1,200-row
  truncation and its misleading `PARTIAL` state.
- Added a direct Steam global-statistics directory link and renamed visualization
  controls around activity points, regional spread, and exact server points.
- Advanced ThunderLink Oblivion to public build `0.3.09` and kernel
  `TBSGE-KERNEL-030.010`; the legal acceptance bundle remains `0.3.02`.

## [0.3.08] — 2026-09-05 — Steam regional game activity

- Added a server-only Steam Web API provider for global per-game activity totals
  and population-weighted public dedicated-server activity grouped into Steam's
  eight coarse regions.
- Kept the privacy boundary explicit: the provider never requests or exposes
  individual Steam IDs, profiles, friends, ownership, histories, or player
  locations, and server-region activity is not presented as a player's location.
- Made Steam the preferred Gaming Data provider with BattleMetrics retained as an
  optional fallback, five-minute caching, and a 24-hour last-good response path.
- Added Railway-ready `STEAM_WEB_API_KEY`, optional bounded app-ID configuration,
  dynamic provider attribution, and fixed missing numeric filters being parsed as
  zero rather than their documented defaults.
- Advanced ThunderLink Oblivion to public build `0.3.08` and kernel
  `TBSGE-KERNEL-030.009`; the legal acceptance bundle remains `0.3.02`.

## [0.3.07] — 2026-09-05 — Gaming Data fail-soft activation

- Fixed Gaming Data activation rolling itself back to OFF when BattleMetrics is
  unconfigured, rejects a token, or is temporarily unavailable.
- Isolated BattleMetrics provider failures inside the Gaming Data panel as an
  `UNAVAILABLE` degraded state, preventing the optional source from changing the
  console-wide boot indicator to `LOAD FAILED`.
- Kept automatic/manual recovery armed so a later valid Railway subscriber token
  or restored provider response can populate the already-active layer.
- Advanced ThunderLink Oblivion to public build `0.3.07` and kernel
  `TBSGE-KERNEL-030.008`; the legal acceptance bundle remains `0.3.02`.

## [0.3.06] — 2026-09-05 — Gaming Data left-rail panel

- Moved Gaming Data into the adaptive left-side accordion as its own collapsible
  card directly beneath Scenes, preventing the expanded filter controls from
  inheriting the Context rail and bleeding through the center HUD.
- Matched the existing glass panel frame, collapsed title treatment, scroll
  allocation, focus mode, recording mode, and narrow-screen stack behavior.
- Advanced ThunderLink Oblivion to public build `0.3.06` and kernel
  `TBSGE-KERNEL-030.007`; the legal acceptance bundle remains `0.3.02`.

## [0.3.05] — 2026-09-05 — BattleMetrics production authentication

- Verified the deployed integration against the live provider and now reports a
  clear, isolated setup message instead of repeatedly calling BattleMetrics when
  the required subscriber Personal Access Token is absent.
- Updated setup guidance for the provider's enforced subscription requirement;
  the token remains server-only as `BATTLEMETRICS_API_TOKEN` in Railway.
- Advanced ThunderLink Oblivion to public build `0.3.05` and kernel
  `TBSGE-KERNEL-030.006`; the legal acceptance bundle remains `0.3.02`.

## [0.3.04] — 2026-09-05 — BattleMetrics Gaming Data

- Added an isolated, default-off Gaming Data layer and dedicated Gaming Data
  Filters panel with dynamic game selection, server filters, clustered markers,
  population-weighted globe heatmap, details cards, live overview, cache/freshness
  state, manual/automatic refresh, and owner availability control.
- Added a server-only BattleMetrics JSON:API provider with pagination, validation,
  normalization, request coalescing, bounded retries, five-minute caching, and a
  24-hour last-good fallback. The server-only `BATTLEMETRICS_API_TOKEN` never
  enters client code.
- Added privacy wording that distinguishes approximate server/datacenter locations
  from player locations, BattleMetrics attribution, documentation, and regression
  coverage for provider and visualization behavior.
- Advanced ThunderLink Oblivion to public build `0.3.04` and kernel
  `TBSGE-KERNEL-030.005`; legal acceptance remains on bundle `0.3.02` because this
  release adds a disclosed public data source without changing the legal contract.

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased]

- Add a keyless **Live Global Events** globe layer backed by NASA EONET and
  GDACS, including severity-colored source cards, cached/partial/stale proxy
  behavior, share-link persistence, voice aliases, analyst records, and
  complete in-app attribution.

### Changed

- Rebranded the public application, package metadata, setup messaging, and
  project documentation as ThunderLink God's Eye while preserving the original
  MIT license, upstream attribution, and stable internal protocol identifiers.

## [0.3.03] — 2026-09-05 — Owner maintenance recovery

### Fixed

- Promoted the owner authentication dialog above the site-wide shutdown gate
  after the discreet information control is selected, restoring owner sign-in
  during Maintenance, Feed Disconnected, and Restricted modes.
- Advanced ThunderLink Oblivion to public build `0.3.03` and kernel
  `TBSGE-KERNEL-030.004`; legal acceptance remains on bundle `0.3.02` because
  this release does not change the governing terms.

## [0.3.02] — 2026-09-05 — Trust, consent, and operational truth

### Added

- Added a versioned legal bundle covering the EULA, Terms of Service, Privacy
  Policy, Acceptable Use Policy, and Data & AI Disclaimer, with persistent
  footer access from the public console.
- Added explicit, recorded legal acceptance to sign-in and registration, plus
  a renewal gate that blocks existing sessions until the current bundle is
  accepted.
- Added real owner telemetry sourced from Railway Postgres: active and recent
  sessions, failed logins, searches, audit activity, policy acceptances, locked
  accounts, layer governance, and snapshot freshness.

### Changed

- Removed the owner dashboard's simulated relay mesh, invented latency and
  threat level, animated spectrum, and decorative telemetry canvas.
- Added 180-day activity-event cleanup and expired-session cleanup during
  account schema maintenance.
- Advanced ThunderLink Oblivion to public build `0.3.02` and kernel
  `TBSGE-KERNEL-030.003`.

## [0.3.01] — 2026-09-05 — Release discipline

### Changed

- Advanced ThunderLink Oblivion to public build `0.3.01` and kernel
  `TBSGE-KERNEL-030.002`.
- Added a repository-level rule requiring every future update to increment both
  identifiers while reserving `0.4.0` for explicit owner authorization.

## [0.3.0] — 2026-09-05 — ThunderLink Oblivion command system

### Added

- Added owner-governed Enabled, Coming Soon, Maintenance, and Hidden states for
  the public Display, CCTV, and Context interface modules.
- Rebuilt Owner Command with an animated telemetry field, relay-mesh and
  security-spectrum modules, richer tactical framing, and grouped governance
  controls.
- Added the ThunderLink Oblivion OS, version, and `TBSGE-KERNEL-030.001`
  identity readout while retaining the required map-provider attribution.
- Made site-wide Maintenance, Feed Disconnected, and Restricted modes apply to
  owner globe sessions as well as public operators, stop an already-running
  globe after propagation, and synchronize open consoles within five seconds.
- Kept the owner-only command route available as the recovery surface during
  every shutdown mode, with direct owner routing and no dashboard-content flash
  before the role check succeeds.
- Replaced the prominent shutdown-screen owner button with a discreet,
  accessible information control in the bottom-right corner.

## [0.1.1] — 2026-09-01 — Installation and live-data fixes

### Changed

- Tightened the README opening around keyless setup, source freshness, modeled
  experiences, and the accessibility of the provider stack.

### Fixed

- Pinokio now recognizes its nested successful-install marker, so a completed
  one-click install exposes Start instead of returning to Install.
- The keyless `dev-fresh.sh` startup summary now names Esri World Imagery with
  keyless terrain and identifies OpenStreetMap as the fallback.
- All three VIIRS sources now reach the Active Fires layer. Merging a source's
  detections used argument spread, which exceeds the engine's argument limit on
  the two largest sources and dropped them entirely — leaving roughly a third of
  global detections while reporting each dropped source twice, once as
  successful with its real count and once as failed.
- `./scripts/dev-fresh.sh` no longer crashes on stock macOS bash 3.2 when no
  provider keys are exported: expanding the empty external-keys provenance
  array under `set -u` was fatal there. Launches with exported keys are
  unchanged.

### Security

- GBFS proxy body-size cap now measures the response in bytes
  (`Buffer.byteLength`) instead of JavaScript string length, so the
  `GBFS_MAX_BODY_BYTES` limit holds for multi-byte payloads and cannot be
  overrun by non-ASCII upstream responses.

## [0.1.0] — 2026-08-31 — One-click install, keyless boot, Provider Settings

### Added
- **One-click install** via Pinokio. Keyless boot lands on a live Esri World
  Imagery satellite globe with keyless terrain; OSM takes over automatically if
  Esri is unreachable, and the globe continues without terrain if its source is
  unavailable.
- **Provider Settings** (the POWER UP panel): add, replace, or remove API keys
  inside the app. Credential files are made owner-only before any secret is
  written — verified on macOS and Windows — and keys configured outside the
  panel are shown read-only, never rewritten.
- **Keyless capability responses**: the optional HUD summary and place-search
  endpoints return a deliberate "not configured" success instead of errors, and
  never consume rate-limit quota.
- `.gitattributes` normalizes line endings, so Windows clones pass the full
  test suite out of the box (#81 — thanks @ethanstoner).

### Changed
- README rewritten keyless-first around the provider ladder: zero keys → free
  Cesium ion (eligible personal, non-commercial use) → billing-enabled Google
  Maps.
- Browser-built data modules no longer import `node:fs`; a repo-wide boundary
  scan test keeps it that way (#83 — thanks @ethanstoner).
- Aircraft-identity voice answers explicitly cover operator, type, and route,
  and say so plainly when enrichment is unavailable instead of guessing.

### Security
- Provider Settings answers only local, unproxied requests and disables itself
  entirely whenever the server is shared. Public datacenter and dam datasets
  omit contact-oriented fields (see the dataset READMEs).

## Pre-release development history

The dated entries and internal milestone numbers below predate the first
tagged GitHub Release. They are retained as project history and do not
represent previously published GitHub Releases.

## [Unreleased] — 2026-08-24

### Added

- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.

### Fixed

- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
