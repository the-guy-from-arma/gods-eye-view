# Public traffic-camera coverage — build 0.3.33

This expansion is **current road-condition viewing**, not a recording or vehicle
search system. The catalogs below publish periodically refreshed snapshots, not
necessarily continuous video. Read the timestamp embedded in each provider image.
Camera availability and counts change; no provider promises every physical camera.

## Connected catalogs

Checks below were performed on 2026-09-12. Counts represent available catalog
views, not a guarantee that every camera is online at any given moment.

| Region | Provider | Catalog views | Verification |
| --- | --- | ---: | --- |
| Texas | [TxDOT ITS](https://www.txdot.gov/discover/live-traffic-cameras.html) | 3,404 | Queried all 25 published district catalogs; sample JPEG decoded successfully |
| British Columbia | [DriveBC](https://www.drivebc.ca/cameras/) | 1,050 | Public, enabled camera views; sample image verified |
| Ontario | [Ontario 511](https://511on.ca/help/endpoint/cameras) | 1,672 | Every enabled camera view, including multiple directions; sample image verified |
| Newfoundland and Labrador | [Provincial highway cameras](https://www.gov.nl.ca/ti/roads/cameras/) | 45 | Provider-published map pins/current images; sample image verified |
| Queensland | [QLDTraffic](https://qldtraffic.qld.gov.au/cameras.html) | 136 | Official webcam API; sample image verified |
| New South Wales | [Live Traffic NSW](https://www.livetraffic.com/traffic-cameras) | 217 | Current catalog connected; four sampled image URLs returned the provider's temporary-unavailability page |

Texas supplements the existing Austin municipal cameras. TxDOT's public district
inventory is discovered at each catalog refresh, not a handpicked city subset.
Offline/no-snapshot records are not presented as working live cameras. Failed
district refreshes retain their last-good **location metadata** and report a
partial/stale district warning. A metadata cache is not a footage archive.

NSW uses the official site's `/datajson/all-feeds-web.json`, filtered strictly to
`liveCams`, with its [official open-data mirror](https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/TfNSW_Traffic_Cameras_Public/FeatureServer)
as a fallback. HTML error pages are rejected rather than displayed as camera images.
The connector will use the current images when the provider serves them again.

## Canadian developer access still required

These documented adapters are implemented, but **not connected without the
owner's provider-issued credentials**. Set credentials in Railway service
variables, not GitHub, client bundles, or source files. Redeploy after setting them.

| Province/territory | Railway variable | Official registration/documentation |
| --- | --- | --- |
| Alberta | `CCTV_ALBERTA_511_API_KEY` | [511 Alberta](https://511.alberta.ca/developers/doc) |
| Manitoba | `CCTV_MANITOBA_511_API_KEY` | [Manitoba 511](https://www.manitoba511.ca/developers/doc) |
| New Brunswick | `CCTV_NEW_BRUNSWICK_511_API_KEY` | [New Brunswick 511](https://511.gnb.ca/developers/doc) |
| Yukon | `CCTV_YUKON_511_API_KEY` | [511 Yukon](https://511yukon.ca/developers/doc) |

Unconfigured providers make no upstream requests and report `Developer access
required` in `/api/cctv/sources` → `catalogs`. A key appearing in an environment
variable is not proof of approval; the upstream still validates it. Request URLs
and credential values are excluded from logs and public responses.

## Remaining coverage — not represented as connected

There is no claim of complete Canada or Australia coverage in this release.
Public traveler pages are not automatically reusable image feeds.

| Region | Current integration status |
| --- | --- |
| Québec | [Open camera locations](https://www.donneesquebec.ca/recherche/dataset/camera-de-circulation) exist (678 at check); linked Québec 511 player returned HTTP 403. No access-control workaround or live imagery connector added. |
| Saskatchewan | [Highway Hotline](https://hotline.gov.sk.ca/) has public cameras; reusable developer catalog access remains unverified. |
| Nova Scotia | [Public camera page](https://novascotia.ca/tran/cameras/) exists; tested 511 developer endpoint requires a key, and a reusable geolocated connector remains pending. |
| Prince Edward Island | [511 PEI](https://511.gov.pe.ca/) has public camera viewing; tested developer endpoint rejects requests without a key. No unverified adapter enabled. |
| Northwest Territories | [DriveNWT](https://drivenwt.ca/) road-condition system; a reusable public camera-image catalog has not been verified. |
| Nunavut | No territory-wide reusable public highway-camera catalog verified in this work. This does not assert that no cameras exist. |
| Victoria | [VicTraffic](https://traffic.transport.vic.gov.au/) publishes traffic/disruption information; a current reusable image catalog remains unverified. |
| Western Australia | [Main Roads Travel Map](https://travelmap.mainroads.wa.gov.au/Home/Map) reviewed; a reusable current-image catalog remains unverified. |
| South Australia | [Traffic SA](https://www.traffic.sa.gov.au/) publishes incidents/roadworks; no reusable current-image catalog verified. |
| Tasmania | [Transport Services](https://www.transport.tas.gov.au/) describes traffic-management CCTV; no public reusable camera catalog verified. |
| Northern Territory (Australia) | [Road Report NT](https://roadreport.nt.gov.au/) publishes road conditions; no reusable public camera catalog verified. |
| Australian Capital Territory | [City Services](https://www.cityservices.act.gov.au/) operates traffic-monitoring cameras; no public reusable live-image catalog verified. |

## Runtime and controls

- CCTV → **Regional Camera Layers** groups the existing U.S. controls with Canada
  and Australia. Province/state selections persist on the device. `CA` remains
  California; Canadian codes use `CA-ON`, `CA-BC`, etc. Australian codes use `AU-NSW`
  and `AU-QLD`. Only regions with registered cameras appear in the toggles.
- Catalogs share the existing 15-minute refresh and per-provider failure isolation.
  The existing file/env catalog override behavior and global camera cap still apply.
- `CCTV_STATE_511_EXCLUDE_PROVIDERS` accepts `tx,ca-bc,ca-on,ca-nl,ca-ab,ca-mb,ca-nb,ca-yt,au-nsw,au-qld`
  in addition to existing state codes. `CCTV_STATE_511_ENABLED=0` disables this provider group.
- Queensland uses the explicitly public developer key from its
  [API specification §2.1.1.1](https://qldtraffic.qld.gov.au/media/moreDevelopers-and-Data/qldtraffic-website-api-specification-v1-10.pdf?lang=en-AU).
  It is **not a private account credential**. The shared key is rate-limited;
  optional `CCTV_QUEENSLAND_API_KEY` supplies a registered server-side replacement.
- Images are fetched on demand only. Up to 64 latest images / 32 MiB are held in
  RAM to coalesce viewers and respect provider cadence, with at most 12 concurrent
  image fetches. Expired frames are removed; no disk/database image archive is added.
  BC follows the provider's published update interval; NL refreshes at 20 minutes;
  the other new sources at one minute. Failure retries are briefly throttled.
- Only registered HTTPS provider hosts are accepted. Redirects, excessive response
  bodies, non-image responses and malformed TxDOT base64 are rejected. Unavailable
  images return 503, never Street View or fabricated traffic imagery.
- New `live-traffic-*` cameras are omitted from the owner analytics picker and
  rejected by its analysis/motion endpoints. No recording, plate OCR or
  cross-camera matching is connected by this change.
- Provider attribution is in **Data attribution** and `DATA_SOURCES.md`.

## Verification

`node --test server/cctvLiveTrafficProviders.test.mjs server/cctv511Providers.test.mjs`
exercises the adapters without network calls. It covers district discovery,
multi-view records, geography validation, key requirements, provider URL checks,
snapshot decoding, refresh caching, NSW pagination, and exclusion from analytics.
The live sample checks above are separate; they do not imply continuous monitoring.
