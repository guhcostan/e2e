---
"e2e": patch
"@e2e-dev/mobile": patch
"@e2e-dev/web": patch
---

Explicit navigation now uses an allowlist instead of a denylist: `app.open`, `browser.goto`, and the agent's `navigate` verb admit `http:`, `https:`, and the exact `about:blank`, and every other scheme (`chrome:`, `blob:`, `about:srcdoc`, ...) is `POLICY_DENIED`. A wrapped scheme such as `view-source:file:///...` no longer loads a local file; it is `POLICY_DENIED` like `file:` itself. `device.openLink` and `device.openApp` also refuse `view-source:`, `blob:`, and `filesystem:` links. `browser.setCookies` refuses an `about:blank` cookie URL with `POLICY_DENIED`.
