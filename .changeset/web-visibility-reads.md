---
"@e2e-dev/web": patch
---

Web visibility and reads follow what renders, as Playwright reads them: an `aria-hidden` node that paints is visible, so `toBeHidden()` on a decorative spinner waits until it leaves; content under `content-visibility: hidden` is hidden; a child that sets `visibility: visible` under a hidden parent is visible and in the agent's observation; text under a `display: contents` element with `visibility: hidden` is hidden, where Playwright calls it visible, since it paints nothing. `boundingBox()` is `null` for a node with no layout box. `inputValue()` and `toHaveValue` read a checkbox's or radio's value (`on` by default) whatever its checked state. An accessible name reads an embedded control's value: `<button>Flash the screen <input value="3"> times</button>` is "Flash the screen 3 times".
