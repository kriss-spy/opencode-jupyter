# T001 — Establish the 0.2.0 baseline

Priority: P0. Status: Done (local implementation). Dependencies: none.

- [x] Reconcile repository/published version evidence without dropping local changes.
- [x] Pin a released initialize-era MCP SDK compatible with the extension runtime.
- [x] Pin VS Code API types to the declared minimum.
- [x] Add focused test and bundled VSIX build commands; fix baseline lint.

Acceptance: clean install, compile, lint, tests and bundled packaging work. Record exact dependency/runtime versions and artifact discrepancy evidence.

Evidence: [validation record](../0.2.0-validation.md) and focused/extension-host tests. Remaining platform and real-kernel release checks are tracked in T006.
