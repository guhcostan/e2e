---
'@e2e-dev/web': patch
---

`check()` and `uncheck()`, and the agent's `check` tool, pass when the click removes the control or navigates away from it, such as a radio the app replaces with its selected view. The click landed, so the action is recorded and replays. What replaced the control is not read, so a test that needs it asserts on it. They used to fail: an agent step reported `LOCATOR_NOT_FOUND` and left the action out of its recording, so the next run handed off with `end-mismatch`, and a locator `check()` timed out. Unchecking a checked radio and a click that leaves the state unchanged now fail with `NOT_ACTIONABLE` instead of `ENGINE_FAILURE`.
