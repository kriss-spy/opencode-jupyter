# T002 — Restore native MCP connectivity (#4)

Priority: P0. Status: Done (local implementation). Dependencies: T001.

GitHub [#4](https://github.com/kriss-spy/opencode-jupyter/issues/4) closed as completed on 2026-10-26; 0.2.1 publication and platform validation remain tracked in T006.

- [x] SDK Streamable HTTP `/mcp`, initialize-era negotiation and errors.
- [x] SDK legacy `/sse` + `/message`, requester-only responses and session validation.
- [x] Loopback binding, Host/Origin checks, bounded bodies and session/resource cleanup.
- [x] Real SDK clients exercise concurrent calls, same request IDs, malformed input, disconnect and restart.

Acceptance: native and legacy clients can list/call tools; results never leak across clients; occupied ports and stop/restart recover.

Evidence: [validation record](../0.2.0-validation.md) and focused/extension-host tests. Remaining platform and real-kernel release checks are tracked in T006.
