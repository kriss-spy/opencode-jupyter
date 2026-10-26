# T004 — Reliable notebook operations (#3)

Priority: P0. Status: Done (local implementation). Dependencies: T001.

- [x] Resolve/retain Jupyter URI and validate arguments, indices and cell kinds.
- [x] Edit text in place, check edit success and preserve metadata/outputs/identity.
- [x] Correlate new execution changes; serialize runs; explicit timeout, cancellation, removed/closed cell outcomes.
- [x] Public Jupyter kernel status capability; restart and variables explicitly report unsupported because no verified public contract exists.
- [x] Adapter regression tests plus extension-host execution verification where available.

Acceptance: reruns cannot return old summaries, focus changes cannot redirect edits, and unavailable kernel capabilities cannot return fabricated success.

Evidence: [validation record](../0.2.0-validation.md) and focused/extension-host tests. Remaining platform and real-kernel release checks are tracked in T006.
