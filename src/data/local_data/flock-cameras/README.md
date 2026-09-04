# Flock camera placement snapshot

This folder contains only a compact, derived camera-placement dataset from
[Ringmast4r/FLOCK](https://github.com/Ringmast4r/FLOCK). No upstream map,
Leaflet interface, police-precinct layer, or camera-network visualization is
included.

- Source file: `CAMERAS_WITH_NETWORK_DATA.geojson`
- Source commit: `9387a188d7996f8c5fdadcc765bbc9074774406b`
- Upstream update date: 2025-11-14
- Imported placements: 36,750 unique coordinates
- Runtime schema: versioned compact JSON; field order is declared in the file

The importer accepts only point features whose manufacturer, brand, dedicated
surveillance-brand field, or exact operator identifies Flock/Flock Safety.
Incidental free-text mentions, external-organization lists, portal URLs,
sharing-network fields, images, and unrelated surveillance cameras are
discarded. Exact-coordinate duplicates are collapsed and the richer placement
record is retained.

Refresh from a checked-out upstream repository with:

```text
node scripts/import-flock-cameras.mjs <path-to-master.geojson> <source-commit>
```

The upstream project states that OpenStreetMap-derived data is available under
the Open Database License (ODbL 1.0), while other public records retain their
source-specific/public-domain terms. Keep the in-app attribution and this
provenance notice with redistributed copies. This derived database is not
covered by the application's MIT code license.

