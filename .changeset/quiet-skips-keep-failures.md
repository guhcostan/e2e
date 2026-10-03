---
"e2e": minor
---

Keep soft assertion failures in the report when a test skips itself, and show
them in the CLI under `Skipped After Failure`. A failed attempt followed by a
skip on retry also appears there with its original error.

Add `failOnSkippedFailure: true` to fail the run with exit code 1 for these
tests. The default is `false`, preserving the existing exit code. Tests retain
their skipped status and reason, teardown still runs, and a skip does not
trigger another retry.
