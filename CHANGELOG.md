# Changelog

## 0.2.1 — 2026-10-26

Published to the Visual Studio Marketplace after verification; the previous public version was 0.1.3. It includes the unpublished 0.2.0 development work and the saved-cell execution correction below.

- Fix execution of saved notebooks whose cells have an `executionOrder` but no `success` field. Persisted execution counts are historical metadata, not a running-state signal. This could reject both local and Colab cells before contacting their kernels.
- Keep fresh post-dispatch start/completion correlation, timeout uncertainty tracking, and cancellation protection.
- Add a regression using the exact persisted-summary shape and exercise a restored execution count in the real VS Code host workflow.

- Add native Streamable HTTP `/mcp` support for OpenCode v2; retain legacy SSE endpoints for 0.2.x migration.
- Generate correct, separately labeled v2 and v1 configuration, including while the server is stopped.
- Isolate MCP sessions, bind to loopback, validate Host/Origin and bound HTTP request bodies/session resources.
- Serialize start/stop, recover from port conflicts and detect open notebooks without relying on editor focus.
- Preserve cell text identity, metadata and historical outputs when editing; validate notebook targeting and cell inputs.
- Wait for new execution summaries, with explicit timeout/cancellation/closed-cell errors instead of stale success.
- Add `jupyter_list_cells`, `jupyter_read_cell_input`, and `jupyter_read_cell_output` with live cell identities, pagination and MIME-aware bounded output.
- Correct binary output to base64 and optionally deliver complete images as MCP image content.
- Use public Jupyter kernel status where available; explicitly report unsupported variables/restart capabilities.
- Pin VS Code API types to 1.90.0; bundle runtime dependencies and add transport, adapter, extension-host and packaging checks.

## 0.1.3 — 2026-05-13

Published Marketplace package. Artifact comparison during 0.2.0 work confirmed its four compiled modules match repository HEAD `01781f0`; package metadata differs only in version.

## 0.1.2 — 2026-05-13

Initial published bridge and packaging updates.
