# T009 — Recover the existing OpenCode daemon's failed MCP connection

Priority: P0. Status: Done.

After correcting T008 and reloading VS Code, the user still saw the original HTTP 404 in OpenCode 2.0.26.

## Feedback loop

From the affected notebook project, `opencode mcp list` reproduced `jupyter-vscode failed: Error POSTing to endpoint: Not found (HTTP 404)`.

In parallel, a new real SDK client initialized against `http://127.0.0.1:9123/mcp`, read server version 0.2.0, listed twelve tools, and called `jupyter_list_open_notebooks`, returning the open `gd.ipynb` with 26 cells. The project config already contained the v2 schema and correct endpoint. This isolated the remaining failure to the existing OpenCode service's cached connection state, rather than the installed extension or current configuration.

## Fix and verification

Reconnect only the affected MCP server, using the real background service and an explicit project location:

```sh
opencode api experimental.mcp.connect --param server=jupyter-vscode --param 'location[directory]=/absolute/path/to/project'
opencode mcp list
```

Result: `jupyter-vscode connected`. Other MCP servers remain disabled as configured. No daemon-wide restart, model request, or notebook mutation was required. Closing the old TUI error modal and reopening `/mcps` displays current state.

No extension-code regression test can exercise a separate daemon's already-cached runtime state. The red/green real-service commands above are the relevant verification seam. The README now records the verified v2 reconnect operation for this situation.
