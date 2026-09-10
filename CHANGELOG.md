# Changelog

## [0.3.26] — 2026-09-10 — Interactive CCTV viewer controls

- Moved the enlarged CCTV dialog outside the non-interactive left panel stack,
  preventing the stack's intentional pointer-input suppression from disabling
  Close, Multi View, Fit, and 1:1 Pixels.
- Made the modal an explicit pointer-input surface and added regression checks
  for both its independent placement and interactive CSS contract.
- Advanced ThunderLink Oblivion to public build `0.3.26` and kernel
  `TBSGE-KERNEL-030.027`; legal acceptance remains `0.3.02`.

## [0.3.25] — 2026-09-10 — Six-state 511 camera expansion

- Added official Rhode Island, New Hampshire, Maine, West Virginia, and
  Kentucky traveler-camera catalogs, including statewide RIDOT and WV511
  placement data plus statewide and Lexington-Fayette Kentucky snapshots.
- Replaced Missouri's 12-camera legacy snapshot file with MoDOT's current
  880-placement statewide catalog, retaining live stream endpoints when MoDOT
  reports them available and placement-only markers for unavailable streams.
- Added the new state providers to the default catalog, state filters, provider
  health reporting, source credits, and normalization regression coverage.
- Advanced ThunderLink Oblivion to public build `0.3.25` and kernel
  `TBSGE-KERNEL-030.026`; legal acceptance remains `0.3.02`.

## [0.3.24] — 2026-09-10 — Owner-only vehicle classification

- Added an owner-only vehicle analytics workspace with state/camera selection,
  single-frame analysis, bounded ten-camera sweeps, confidence readouts, and
  searchable Railway Postgres observations.
- Added optional server-side Gemini image classification for vehicle type,
  exterior color, likely make/model, and a broad possible model-year range.
  Frames are processed transiently and never written to the database; license
  plates, faces, occupants, unique vehicle identifiers, and cross-camera
  movement histories are explicitly excluded from prompts and stored records.
- Added duplicate-frame suppression, a 30-frame/minute owner rate limit,
  4.8 MB frame cap, 90-day metadata retention, and a default-off owner control.
- Advanced ThunderLink Oblivion to public build `0.3.24` and kernel
  `TBSGE-KERNEL-030.025`; legal acceptance remains `0.3.02`.

## [0.3.23] — 2026-09-10 — Native-resolution CCTV viewing

- Stopped the enlarged CCTV viewer from stretching low-resolution provider
  snapshots beyond their native pixel dimensions. FIT now scales down only,
  while 1:1 PIXELS exposes the original frame in a scrollable inspection view.
- Added the provider frame's decoded source resolution and current scale mode
  to the large-view status line, making source limitations explicit instead of
  presenting browser interpolation as additional visual detail.
- Advanced ThunderLink Oblivion to public build `0.3.23` and kernel
  `TBSGE-KERNEL-030.024`; legal acceptance remains `0.3.02`.

## [0.3.22] — 2026-09-10 — Live CCTV projection and watch routes

- Changed the Cesium CCTV monitor material to a callback-backed texture. The
  plane now reads the current decoded frame during every material update instead
  of allowing PlaneGraphics to retain its initial black/default texture.
- Added a full-size CCTV viewer with single-feed and selected-feed mosaic modes.
  The compact panel preview now exposes an ENLARGE action whenever a frame is
  available.
- Added a 12-camera watch-route builder with ordered camera selection, removal,
  configurable 6/10/15-second cycling, route tracking, and multi-camera viewing.
- Added regression coverage for dynamic texture replacement and the enlarged,
  multi-feed, bounded-route interface.
- Advanced ThunderLink Oblivion to public build `0.3.22` and kernel
  `TBSGE-KERNEL-030.023`; legal acceptance remains `0.3.02`.

## [0.3.21] — 2026-09-10 — CCTV monitor-plane frame recovery

- Fixed CCTV frames appearing normally in the sidebar while the corresponding
  Cesium monitor plane remained black. Snapshot projections now bind the exact
  newly decoded image object directly to the plane material instead of routing
  it through an additional pair of full-size canvas copies.
- Hardened projection refreshes so stale image completions cannot replace a
  newer request, a failed refresh preserves the last good frame, and an async
  decode explicitly requests the Cesium texture-upload render.
- Added regression coverage for decoded-frame promotion, stale-request
  rejection, last-good-frame retention, and the monitor texture-source gate.
- Advanced ThunderLink Oblivion to public build `0.3.21` and kernel
  `TBSGE-KERNEL-030.022`; legal acceptance remains `0.3.02`.

## [0.3.20] — 2026-09-10 — Central U.S. 511 expansion and state controls

- Added current public 511/DOT camera catalogs for Colorado, New Mexico,
  Kansas, Oklahoma, Arkansas, Missouri, Iowa, Nebraska, South Dakota,
  Minnesota, Wisconsin, and Illinois. The release audit accepted more than
  11,800 additional views/placements across those twelve providers.
- Added compact, scrollable per-state camera controls to the CCTV panel. Every
  loaded state can be independently shown or hidden, with ALL/NONE actions and
  browser-local persistence; hidden states are excluded from camera selection,
  cycling, nearest-camera focus, ambient cards, coverage, and detection.
- New York and other paginated catalogs now preserve and serve valid partial
  refreshes with an accurate degraded status instead of discarding visible
  cameras when a provider omits one or more pages.
- Added provider-native images or HLS where publicly exposed. Oklahoma remains
  placement-only; Illinois follows Travel Midwest's attribution requirement and
  five-minute minimum image-refresh cadence. Raised the safe aggregate catalog
  cap to 60,000 so the expanded catalog is not truncated.
- Advanced ThunderLink Oblivion to public build `0.3.20` and kernel
  `TBSGE-KERNEL-030.021`; legal acceptance remains `0.3.02`.

## [0.3.19] — 2026-09-10 — Southeast and New England 511 expansion

- Added complete current camera catalogs for Tennessee SmartWay, South Carolina
  511, Alabama ALGO Traffic, Ohio OHGO, Vermont through New England 511, and
  Connecticut CTroads. The release audit accepted 3,677 additional placements:
  668 Tennessee, 772 South Carolina, 639 Alabama, 1,162 Ohio, 89 Vermont, and
  347 Connecticut records, bringing the merged CCTV endpoint to 31,723 sources.
- Added provider-native HLS playback for Tennessee and South Carolina and live
  snapshots for Ohio, Vermont, and Connecticut. Alabama is placement-only because
  ALGO's published camera notice prohibits unauthorized retransmission of imagery.
- Confirmed New York's complete 1,874-camera 511NY catalog and changed legacy
  `CCTV_STATE_511_PROVIDERS` handling so an old Railway value cannot silently hide
  newly shipped states. Operators can deliberately suppress providers with the
  new `CCTV_STATE_511_EXCLUDE_PROVIDERS` list.
- Added public-session pagination for the Vermont and Connecticut camera lists,
  provider-specific media headers, normalized state/local jurisdiction labels,
  source credits, and regression coverage for every new schema and media policy.
- Advanced ThunderLink Oblivion to public build `0.3.19` and kernel
  `TBSGE-KERNEL-030.020`; legal acceptance remains `0.3.02`.

## [0.3.18] — 2026-09-10 — Mid-Atlantic and Northeast 511 expansion

- Added complete official 511 camera catalogs for Virginia, Pennsylvania,
  New Jersey, New York, and Massachusetts, including provider-native HLS or
  snapshot media where authorized, state/local jurisdiction labels, and
  isolated health status. Massachusetts is placement-only pending the
  provider-authorized developer image feed required by MassDOT. The release
  audit loaded 5,978 new state records and 28,034 merged CCTV sources.
- Added adapters for VDOT's current map service, 511NJ's explicit public-role
  service, and Massachusetts 511's CARS map schema while reusing verified IBI
  pagination for 511PA and 511NY.
- Reduced paged-catalog concurrency with bounded retries to prevent upstream
  throttling, validated raw pagination independently of disabled camera rows,
  and raised the merged camera ceiling to 40,000 so no state is truncated.
- Added opaque HLS manifest rewriting for provider-relative child playlists,
  segments, encryption keys, and init maps so Virginia and New Jersey streams
  remain playable through the bounded server proxy without exposing an SSRF URL.
- Advanced ThunderLink Oblivion to public build `0.3.18` and kernel
  `TBSGE-KERNEL-030.019`; legal acceptance remains `0.3.02`.

## [0.3.17] — 2026-09-10 — Complete supported U.S. 511 camera network

- Added complete live state 511/DOT camera catalogs for Arizona, Florida,
  Georgia, North Carolina, Utah, Nevada, Louisiana, Oregon, Michigan, and
  Indiana, totaling 16,485 verified camera placements at release time.
- Expanded Caltrans from four metro-focused districts to all 12 districts and
  retained the complete Washington 511 catalog, bringing the CCTV layer above
  20,000 public placements while preserving provider-specific attribution.
- Added provider-isolated catalog health reporting, gated-stream detection,
  bounded catalog requests, and a nearest-camera UI/terrain warm cohort so the
  complete map does not create a 20,000-option dropdown or terrain workload.
- Advanced ThunderLink Oblivion to public build `0.3.17` and kernel
  `TBSGE-KERNEL-030.018`; legal acceptance remains `0.3.02`.

## [0.3.16] — 2026-09-09 — Live fusion schematic + Washington 511 cameras

- Rebuilt the Intelligence Console overview around a ThunderLink-style live
  aggregation schematic: provider nodes, fusion totals, current source-backed
  signal queue, channel health, real request latency, and a visible 60-second
  refresh cadence. Every node opens its corresponding detailed feed.
- Added the complete current 1,705-record Washington 511/WSDOT public camera catalog from
  WSDOT's official keyless ArcGIS FeatureServer, including validated geometry,
  HTTPS snapshot URLs, provider attribution, 15-minute catalog caching, and
  bounded frame loading through the existing CCTV scheduler.
- Raised CCTV catalog and health bounds to accommodate the 1,705
  Washington records alongside Austin, Caltrans, and TfL without silently
  dropping a provider; added schema regression tests and browser interaction QA.
- Advanced ThunderLink Oblivion to public build `0.3.16` and kernel
  `TBSGE-KERNEL-030.017`; legal acceptance remains `0.3.02`.

## [0.3.15] — 2026-09-07 — Interactive intelligence channels

- Rebuilt the four Global Overview panels as keyboard-accessible live channel
  controls, with matching interactive provider-health shortcuts.
- Replaced raw feed JSON with a God’s Eye-styled operational workspace containing
  real provider metrics, timestamped records, status tags, refresh/back controls,
  and source drill-down links for space weather, CISA cyber threats, IODA internet
  outages, and market telemetry.
- Made NOAA space weather fail soft when only one upstream product is unavailable,
  exposing partial provider health instead of discarding usable observations.
- Added a deterministic headless-browser interaction check covering owner access,
  overview-card activation, structured feed rendering, and source drill-down UI.
- Advanced ThunderLink Oblivion to public build `0.3.15` and kernel
  `TBSGE-KERNEL-030.016`; legal acceptance remains `0.3.02`.

## [0.3.14] — 2026-09-07 — Intelligence gate visibility hotfix

- Restored the authenticated Intelligence Console for every permitted account,
  including the owner, by explicitly honoring the shell and access gate's
  `hidden` state above their grid display rules.
- Added a regression contract proving successful authentication removes the
  access gate and reveals the console shell.
- Advanced ThunderLink Oblivion to public build `0.3.14` and kernel
  `TBSGE-KERNEL-030.015`; legal acceptance remains `0.3.02`.

## [0.3.13] — 2026-09-06 — Weather plugin startup hotfix

- Fixed the weather API plugin setup hook so it registers middleware without
  returning Vite's middleware application as an invalid post-start callback.
- Added a regression test covering both development and preview server hooks.
- Advanced ThunderLink Oblivion to public build `0.3.13` and kernel
  `TBSGE-KERNEL-030.014`; legal acceptance remains `0.3.02`.

## [0.3.12] — 2026-09-06 — Geospatial weather operations

- Moved severe-weather presentation out of the Intelligence Console list view
  and into two independent, owner-governed globe data filters.
- Added a translucent NOAA/NWS MRMS base-reflectivity radar overlay with a
  five-minute refresh, bounded proxy cache, and one-hour last-good fallback.
- Added active NWS Polygon/MultiPolygon warning areas, severity coloring,
  total-versus-mapped telemetry, two-minute refreshes, and stale-state honesty.
- Kept tropical cyclones and severe natural events in the existing NASA EONET
  and GDACS Live Global Events layer, so radar, official warning areas, and
  event markers can be combined without turning weather into a text feed.
- Advanced ThunderLink Oblivion to public build `0.3.12` and kernel
  `TBSGE-KERNEL-030.013`; legal acceptance remains `0.3.02`.

## [0.3.11] — 2026-09-06 — ThunderLink Intelligence Console

- Added a separate authenticated intelligence console without displacing the
  Cesium operations map, with a searchable capability rail, live provider
  health, passive source queries, and explicit degraded/not-configured states.
- Added Railway PostgreSQL identity-verification and intelligence-access fields,
  owner controls for verified and analyst roles, and inherited per-module
  live/coming-soon/maintenance/hidden governance.
- Added source-bounded defensive lookups for DNS, RDAP, certificate
  transparency, CVEs, GitHub, IP/ASN context, MAC vendors, Shodan InternetDB,
  personal breach checks, public chains, and configured phone metadata.
- Added live overview feeds for NOAA space weather, CISA KEV, Georgia Tech
  IODA, URLhaus, market context, and optional OpenAQ/Cloudflare Radar sources.
- Added DNS TXT ownership challenges and a gated scanner bridge. Active checks
  require analyst access, a verified asset, and an explicitly configured HTTPS
  backend; spoofed headers, TLS bypasses, and simulated incidents were excluded.
- Imported the Osiris capability model under its MIT terms while reimplementing
  the production boundaries for God’s Eye. Advanced ThunderLink Oblivion to
  public build `0.3.11` and kernel `TBSGE-KERNEL-030.012`; legal acceptance
  remains `0.3.02`.

## [0.3.10] — 2026-09-05 — Steam request hardening

- Added a provider-wide three-request concurrency ceiling so simultaneous game
  totals and server-catalog refreshes cannot burst Steam with sixteen cold-start
  requests.
- Added one bounded retry for a transient Steam HTTP 403 before reporting an
  authentication restriction, while preserving the existing timeout, rate-limit,
  cache, and server-only-key boundaries.
- Added regression coverage that proves a cold all-games refresh never exceeds
  the concurrency ceiling.
- Advanced ThunderLink Oblivion to public build `0.3.10` and kernel
  `TBSGE-KERNEL-030.011`; the legal acceptance bundle remains `0.3.02`.

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
