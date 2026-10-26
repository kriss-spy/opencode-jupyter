# T005 — Targeted cell inspection (#2)

Priority: P1. Status: Done (local implementation). Dependencies: T002, T004.

GitHub [#2](https://github.com/kriss-spy/opencode-jupyter/issues/2) closed as completed on 2026-10-26; 0.2.1 publication remains tracked in T006.

- [x] Add `jupyter_list_cells`, `jupyter_read_cell_input`, `jupyter_read_cell_output`.
- [x] Opaque live-cell identities, notebook version and bounded pagination.
- [x] MIME-aware text/base64, images, output grouping, byte limits and explicit truncation.
- [x] Preserve nine old tool names; read-only annotations and strict input schemas.
- [x] Test insert-above identity, removed identity, binary/image/error/large outputs and real MCP calls.

Acceptance: inspect one cell without fetching the entire notebook; no binary output is UTF-8 corrupted or returned as a partial image.

Evidence: [validation record](../0.2.0-validation.md) and focused/extension-host tests. Remaining platform and real-kernel release checks are tracked in T006.
