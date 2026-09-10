# Privacy redaction worker

This optional Railway sidecar is intentionally detector-only. It follows the plate-detector pattern used by FastALPR but imports `open-image-models` directly; no OCR class is imported or executed.

The worker is dormant until the main application has all three private variables configured and the owner enables Protected Archive in Owner Command. It accepts a frame in memory, irreversibly pixelates and blurs detected plate regions, strips metadata by re-encoding the image, and returns only a verified JPEG plus a region count. If no region is verified, it returns HTTP 422 and no frame is retained.

Required sidecar variable:

- `PRIVACY_REDACTION_WORKER_TOKEN` — a long random secret shared only with the main service.

Main-service variables are documented in `.env.example`. Do not expose the sidecar publicly; use Railway private networking and keep Protected Archive off until deployment has been tested.
