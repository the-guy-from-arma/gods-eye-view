# Northern U.S. 511 live-view expansion — build 0.3.34

Checked against official public services on 2026-09-13. Counts are camera
**views**, not unique physical locations, and can change with upstream catalogs.

| State toggle | Official catalog | Accepted views | Live check |
| --- | --- | ---: | --- |
| MT — Montana | MDT traffic cameras plus RWIS map catalogs | 419 | Two current images fetched successfully |
| WY — Wyoming | WYDOT 511 public map camera feed | 755 | Two current images fetched successfully |
| ND — North Dakota | NDDOT published camera GeoJSON | 808 | Two current images fetched successfully |
| ID — Idaho | Idaho 511 public camera-page catalog | 697 | Two current images fetched successfully |

These 2,679 views are provider-refreshed snapshots, not guaranteed continuous
video. Sampling two images per state does **not** prove every camera is online.
Upstream timestamps, outages, darkness and image quality still apply.

## Sources and formats

- [Montana official traveler map](https://www.511mt.net/) references
  `https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson`
  and `https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.rwis.geojson`.
  Each map feature can contain multiple `properties.cameras` views. Neighboring
  state cameras are excluded from the Montana layer. Failure of one catalog
  preserves the other and reports partial coverage.
- [Wyoming official 511 map](https://map.wyoroad.info/511-map/) loads
  `https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf`. Its public
  `webcameras_v1_pkg` schema contains site ID/name, repeated image ID/name/URL,
  longitude and latitude. The adapter reads only those bounded fields. The
  string-format mask is published in the unauthenticated map client; it is not
  a private account credential. Images use the same `/web-cam/cache?ref=...`
  links displayed on [WYDOT's camera page](https://www.wyoroad.info/pls/Browse/WRR.Cameras).
  No provider JavaScript is executed. A changed feed filename/schema will
  report an unavailable provider until the adapter is updated. The live check
  returned 226 sites with 755 directional views.
- [NDDOT's web-map services page](https://www.dot.nd.gov/construction-and-planning/planning-process/gis-and-mapping/web-map-services)
  explicitly publishes `https://travelfiles.dot.nd.gov/geojson_nc/cameras.json`.
  It returned 189 locations and 809 image references. One supplied Verona East
  path was malformed (`/travel-info/camerasND13...`, missing the directory
  separator), so it was excluded rather than guessing a replacement. The other
  808 views passed normalization. **NDDOT data is provided as-is, without
  liability to NDDOT.** This notice also appears in the in-app credits.
- [Idaho's public camera page](https://511.idaho.gov/cctv) uses
  `/List/GetData/Cameras?query=...&lang=en`. The adapter follows its 100-location
  pagination and preserves all enabled, unblocked `images` views. The live
  check returned all 457 catalog locations. This is separate from the
  [developer Cameras API](https://511.idaho.gov/help/endpoint/cameras), which
  requires a key. No developer key or authenticated video stream is used.

Each provider retains its own image/data terms. No third-party imagery is
licensed by this repository's MIT code license. Provider credits remain in the
in-app Data attribution panel and `DATA_SOURCES.md`.

## Controls and delivery

- Available under CCTV → Regional Camera Layers → United States. Each state
  has its own persisted on/off selection and full-name tooltip.
- Default-enabled through the existing 511 provider group. Set
  `CCTV_STATE_511_EXCLUDE_PROVIDERS=mt,wy,nd,id` to exclude any combination;
  `CCTV_STATE_511_ENABLED=0` disables the whole group. No new Railway secrets
  are required. Existing catalog overrides/global caps still apply.
- Catalog metadata refreshes through the existing 15-minute provider loader.
  Idaho has a 45-second total pagination deadline, duplicate detection and
  explicit partial-result warnings. Provider failures are isolated.
- Images are fetched on demand and shared across viewers: five-minute cache
  cadence for MT/WY/ND, one minute for ID. At most 64 latest frames / 32 MiB
  remain in RAM, with 12 concurrent fetches. Expired frames are removed.
- Up to 6 MiB per decoded image accommodates Idaho's full-size PNGs. Known
  provider image responses are checked for JPEG/PNG/WebP binary signatures;
  Montana PNGs mislabeled `image/jpeg` receive the correct PNG content type.
  Other content, unregistered hosts, redirects and oversized bodies fail closed.
- `live-traffic-*` IDs and `framePolicy: live-only` keep these views out of
  owner analytics and protected-retention paths. No image database, replay,
  plate OCR, persistent vehicle identity or cross-camera matching is added.

## Verification

`node --test server/cctvNorthern511.test.mjs server/cctvLiveTrafficProviders.test.mjs server/cctv511Providers.test.mjs`

Tests exercise provider parsing, multi-view records, Idaho pagination failures,
malformed Wyoming binary data, geography/URL restrictions, image signatures,
size limits and live-only behavior. Live endpoint checks are separate from
these deterministic tests. Railway deployment must be verified independently.

Release checks: 78 targeted camera/account/access/release tests passed and the
Vite production build passed (existing large-chunk warning only). The full
source unit suite reported 2,819 passed, two skipped and one pre-existing
Windows native-DACL failure at `src/keySetupHardening.test.mjs:263`; that code
was not changed by this release.
