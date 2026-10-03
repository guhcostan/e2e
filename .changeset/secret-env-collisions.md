---
"e2e": patch
---

Two credentials or two secrets whose names map to the same override variable (`api-key` and `api_key` both read `E2E_SECRET_API_KEY`) now fail the config load with `INVALID_CONFIG` instead of both silently taking one value.
