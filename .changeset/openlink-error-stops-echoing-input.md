---
"@e2e-dev/mobile": patch
---

`device.openLink` no longer echoes the string it refused in its `INVALID_ARGUMENT` message. A malformed link can carry a magic-link token in its query, path, or userinfo, so the message names no part of the input, matching what `device.openApp` already does.
