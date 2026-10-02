---
"e2e": patch
"@e2e-dev/web": patch
---

`locator.waitFor` adds Playwright's `attached` and `detached` states and refuses any other state, or an option key besides `state` and `timeout`, with `INVALID_ARGUMENT`. Before, every state but `visible` ran as `hidden`, so `waitFor({ state: 'attached' })` and a misspelled state passed at once on an absent node. `toBeHidden`, `toBeVisible({ visible: false })`, `toBeAttached({ attached: false })`, and `waitFor` `detached` and `hidden` read a locator under a frame missing from the document as zero matches instead of timing out waiting for the frame. `toHaveProperty` reads a primitive on the path through its wrapper, as Jest does, so `toHaveProperty('label.length', 3)` passes. `expect(browser).toHaveURL` takes `ignoreCase`, and `urlMatches` in `e2e/engine` takes it as an optional fourth argument.
