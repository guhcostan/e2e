---
'e2e': patch
---

A forced interrupt (a second Ctrl-C, or a CI cancel that sends SIGINT and then SIGTERM) still writes `junit.xml` and `summary.md`. The runner used to abandon them along with every other reporter, which left the previous run's files beside the new `report.json`. Custom reporters are still abandoned on force.
