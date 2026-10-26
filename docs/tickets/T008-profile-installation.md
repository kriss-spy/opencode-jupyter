# T008 — Correct installation in the active VS Code profile

Priority: P0. Status: Done. Active profile, listener and OpenCode connection verified.

Reported during the first real-user check in the `d2l` workspace on 2026-10-26.

## Reproduction and root cause

- The default profile had 0.2.0, but `d2l` is associated with the named **AI** profile, whose extension list still referenced 0.1.3.
- The running `d2l` extension host owned port 9123 on all interfaces. `POST /sse` and `POST /mcp` both returned 404 `Not found`; `GET /sse` returned the old `client-1` endpoint format. This identifies the legacy implementation rather than a new transport regression.
- The project configuration used the v1 `mcp.jupyter-vscode` shape with `http://localhost:9123/sse`.

## Correction

- [x] Install the 0.2.0 VSIX using `code --profile AI --install-extension <local-vsix> --force`.
- [x] Verify the AI profile's own extension list and CLI output now identify version 0.2.0.
- [x] Migrate the project's MCP section to `mcp.servers`, `/mcp`, `oauth: false`, and initialization-era `protocol: legacy`, preserving unrelated settings.
- [x] Reload the active `d2l` VS Code window; the listener now binds to `127.0.0.1` and reports server version 0.2.0.
- [x] Rerun initialize + tools/list on the real `/mcp` endpoint: all twelve tools are present, and `gd.ipynb` is listed with 26 cells.
- [x] Reconnect the named MCP server in OpenCode's existing background service; the real `d2l` `opencode mcp list` now reports connected. See T009.

This is an installation/profile/configuration error, not a failure of the tested 0.2.0 transport implementation. No new shallow unit test substitutes for checking the actual active profile and live listener. Future local-install verification must resolve the workspace's profile and check the live server version, rather than relying on default-profile `code --list-extensions` alone.
