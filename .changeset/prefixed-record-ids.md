---
"e2e": patch
---

The replay cache abstracts short prefixed record ids as minted segments. A route segment of letters, a dash, and a digit tail of two or more (`PROJ-016`, `INV-2041`) now reduces to `:id`, so a step recorded on one record replays on the next instead of missing with `wrong-context` and running live every time. A single trailing digit (`page-2`) stays a route word.
