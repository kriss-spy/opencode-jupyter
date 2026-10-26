# T003 — Lifecycle and generated configuration (#4)

Priority: P0. Status: Done (local implementation). Dependencies: T002.

- [x] Serialize stopped/starting/running/stopping and await deactivation.
- [x] Generate v2 config from one helper; provide explicitly labeled v1 migration config.
- [x] Config works while stopped; validate port; use actual package version.
- [x] Detect already-open/new Jupyter notebooks, respect auto-start, place extension with workspace/Jupyter host.
- [x] Test activation/commands, failed start retry and notebook-triggered behavior.

Acceptance: generated native config is usable, simultaneous lifecycle calls cannot create orphan listeners, and config/diagnostics identify the effective host/port.

Evidence: [validation record](../0.2.0-validation.md) and focused/extension-host tests. Remaining platform and real-kernel release checks are tracked in T006.
