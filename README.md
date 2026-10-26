# OpenCode Jupyter

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/KrisspyWang.opencode-jupyter)](https://marketplace.visualstudio.com/items?itemName=KrisspyWang.opencode-jupyter)
[![OpenCode](https://img.shields.io/badge/OpenCode-MCP-8A2BE2)](https://opencode.ai)

Operate Jupyter notebooks open in VS Code from OpenCode or another MCP client. The extension runs a loopback MCP server in the VS Code workspace extension host.

## What's new in 0.2.1

- Connect OpenCode v2 directly through `/mcp`, with generated v2 configuration and no bridge process.
- Inspect individual cells with `jupyter_list_cells`, `jupyter_read_cell_input`, and `jupyter_read_cell_output`, including text, errors and images.
- Preserve cell identity, metadata and historical output when editing, and wait for fresh execution results when running cells.
- Fix the execution guard that rejected saved notebooks with an execution count but no success metadata, affecting both local and Colab kernel requests.

See the [changelog](CHANGELOG.md) and [0.2.1 release notes](docs/releases/0.2.1.md) for migration details, validation results and known limitations. The Marketplace badge and version history reflect the public catalog; a newly uploaded version can remain under Marketplace verification before it appears there.

## Install and connect

Requires VS Code **1.90 or newer**, the **Jupyter** extension (`ms-toolsai.jupyter`, installed as a dependency), and a selected notebook kernel for execution. Older VS Code releases need a compatible older Jupyter extension. This extension is a desktop/workspace extension; it does not run in a browser-only extension host.

```sh
code --install-extension KrisspyWang.opencode-jupyter
```

For the locally built 0.2.1 artifact:

```sh
npm ci
npm run package
code --install-extension artifacts/opencode-jupyter-0.2.1.vsix
```

Install into the **profile used by the notebook window**. For example, when using a profile named `AI`:

```sh
code --profile AI --install-extension artifacts/opencode-jupyter-0.2.1.vsix --force
code --profile AI --list-extensions --show-versions
```

After upgrading, run **Developer: Reload Window**. Check the installed extension version in that profile; installing into the default profile does not upgrade other profiles automatically.

1. Open a `.ipynb` notebook in VS Code and select/start its kernel. The MCP server starts automatically, or use **OpenCode Jupyter: Start MCP Server**.
2. Run **OpenCode Jupyter: Show MCP Configuration**, choose **OpenCode v2**, and copy the result into the appropriate project `opencode.json`/`opencode.jsonc`. Configuration is available even while the server is stopped.
3. Connect OpenCode on the same machine/workspace host. The default configuration is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "jupyter-vscode": {
        "type": "remote",
        "url": "http://127.0.0.1:9123/mcp",
        "oauth": false,
        "protocol": "legacy"
      }
    }
  }
}
```

OpenCode **v2** requires the `mcp.servers` nesting. Servers are enabled by default; use `disabled: true` to disable one. Here `protocol: "legacy"` selects the initialization-era MCP handshake **over Streamable HTTP**. It does not mean the old HTTP+SSE transport. The 2026-07-28 protocol era is not advertised by this server. See [OpenCode v2 MCP configuration](https://opencode.ai/v2/docs/mcp-servers/).

Use OpenCode's `/mcps` view or `opencode mcp list` to inspect connection state. Open the notebook/start this server before connecting. If a client connected while the server was stopped, use its reconnect controls or restart/reload the OpenCode instance, then check status again. The extension does not control an external OpenCode daemon's retry policy. In v2's default Code Mode the tools may be exposed through Code Mode rather than twelve separate top-level tools.

If an existing OpenCode v2 background service still shows the old 404 after correcting the configuration, reconnect the named server in the intended project. This was verified against a real 2.0.26 daemon after upgrading this extension:

```sh
opencode api experimental.mcp.connect --param server=jupyter-vscode --param 'location[directory]=/absolute/path/to/project'
opencode mcp list
```

Close any previously opened error modal and reopen `/mcps` to inspect the refreshed state.

Ask OpenCode to list open notebooks, list cells in the chosen URI, inspect a cell, edit it, run it, and read its new output. With several open notebooks, supply the URI returned by `jupyter_list_open_notebooks` on subsequent calls.

## Tools

The original nine tool names remain available. All notebook-specific tools accept an optional `uri`; it selects an **already-open Jupyter notebook**, including remote and untitled notebook URIs. An omitted URI uses the active Jupyter notebook, or the sole open Jupyter notebook. Ambiguous or invalid targets return an error.

| Tool | Behavior |
| --- | --- |
| `jupyter_list_open_notebooks` | Notebook URIs, names and cell counts. |
| `jupyter_get_notebook` | Source, metadata and bounded outputs for the notebook. Prefer targeted reads for large notebooks. |
| `jupyter_list_cells` | Cell descriptors without source/output; `offset` and `limit` (default 100, maximum 500), notebook `version` and `next_offset`. Pass the returned `version` on later pages to reject a changed notebook. |
| `jupyter_read_cell_input` | Source, kind, language and current index for a required `cell_id`. |
| `jupyter_read_cell_output` | Grouped MIME-aware outputs and execution summary for a required `cell_id`. Optional `max_bytes` (default 262144, maximum 1048576) and `include_images` (default false). |
| `jupyter_run_cell` | Run a zero-based code cell `index` and wait for a fresh execution summary. An execution error remains visible in the returned summary/output. |
| `jupyter_insert_cell` | Insert at `index`, with `kind` (`code`/`markdown`), `source` and optional `language`. |
| `jupyter_edit_cell` | Change source in place; preserve identity, metadata and existing outputs. Existing outputs remain historical until the cell is rerun. |
| `jupyter_get_errors` | Cells with failed execution or notebook error MIME output. |
| `jupyter_get_kernel_status` | `idle`/`busy` from Jupyter's public kernel API when available; `unknown` if unavailable, not started or in another state. |
| `jupyter_get_variables` | Explicit unsupported error: the public Jupyter API does not provide variable inspection. |
| `jupyter_restart_kernel` | Explicit unsupported error: no verified public targeted restart/completion API. Restart through VS Code's notebook toolbar. |

`cell_id` is an opaque identifier for the **current open notebook instance**. It survives insertions above a cell and source edits, but is invalid after that cell is removed or the notebook is closed/reopened. List cells again after reopening. Numeric indices are positions, not stable identities.

Output items retain `outputType`, `mimeType` and `data`, and add `encoding` (`text` or `base64`), original `byteLength`, `returnedBytes` and `truncated`. Binary output is now base64, correcting the previous UTF-8 corruption. Targeted reads preserve output grouping and return aggregate limits/truncation fields. The byte budget covers encoded payload across a read; binary items are omitted in full if they do not fit. Text is cut at complete UTF-8 characters. Reads cap output/item descriptors at 1000 and set `total_bytes_complete: false` when that cap prevents a complete count.

With `include_images: true`, supported complete PNG/JPEG/GIF/WebP items are delivered as MCP image content. Their text descriptors have empty `data` and `delivered_as_image: true` to avoid sending the same payload twice. Oversized/partial images are never emitted. Read-only tool annotations describe read operations; they do not change the client's own permission controls.

Execution requests are limited to one active request per notebook. The default wait is 30 seconds, configurable up to 10 minutes. Set the client's tool execution timeout higher than the extension's wait. A timeout/cancelled request returns an explicit error and **does not interrupt the kernel**; check the notebook before retrying. The extension requires a fresh start and matching completion, and does not treat saved execution counts as evidence of a running cell. After an indeterminate run, wait for a new completed result; if the provider never supplies one, stop the kernel and close/reopen the notebook before another request. Cancellation before dispatch prevents execution.

## Remote workspaces, ports and lifecycle

The extension uses `extensionKind: workspace` so it runs beside Jupyter in Remote-WSL/SSH. `127.0.0.1` refers to **that workspace host**. Run OpenCode there too. If OpenCode runs on a different host, use an explicitly configured local port forward and its matching loopback endpoint; forwarding must preserve an allowed localhost Host header. Cross-host forwarding and WSL require platform verification before being claimed as tested.

The server binds only to `127.0.0.1`, validates Host/Origin, limits request bodies to 1 MiB, and isolates up to 32 MCP client sessions. Idle sessions expire after 30 minutes; reconnect after expiry. There is no wildcard browser CORS access. The service is intended for trusted local MCP clients, not public hosting.

Multiple VS Code windows using port 9123 will conflict. Set a different port per workspace/window; an occupied-port error is visible in the **OpenCode Jupyter** output channel and a later Start can retry. Changing the setting requires Stop then Start, followed by updating the client snippet. The generated snippet uses the running endpoint until restart.

Auto-start checks already-open Jupyter documents when activated and newly opened documents afterward. It does not depend on which editor is focused. Manual Start is available before opening a notebook. Stop closes active sessions; clients must reconnect after restart. Closing all notebooks does not stop the server automatically.

| Setting | Default | Meaning |
| --- | --- | --- |
| `opencode-jupyter.mcpPort` | `9123` | Loopback port, integer 1–65535. |
| `opencode-jupyter.autoStartServer` | `true` | Start when a Jupyter notebook opens. |
| `opencode-jupyter.executionTimeoutMs` | `30000` | Wait for fresh completion, integer 1–600000 ms. |

## Migration from 0.1.x / OpenCode v1

0.2.1 includes the unpublished 0.2.0 development work: `/mcp` support and **`GET /sse` + `POST /message`** for legacy clients through 0.2.x. Responses are now routed only to the requesting session. OpenCode v2 cannot use the old `/sse` URL directly; change both the configuration schema and endpoint. No `mcp-remote` bridge is required.

For **OpenCode v1**, choose that format in Show MCP Configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jupyter-vscode": {
      "type": "remote",
      "url": "http://127.0.0.1:9123/mcp",
      "oauth": false,
      "enabled": true
    }
  }
}
```

A legacy HTTP+SSE-only client can instead use `http://127.0.0.1:9123/sse`. Kernel operations that previously returned misleading empty/success results now return explicit unsupported errors where no public API exists. There is no automatic mutation of user OpenCode configuration.

## Development and validation

```sh
npm ci
npm run check          # lint, typecheck, HTTP/SSE + notebook regression tests, bundle
npm run package        # bundled VSIX with runtime notices
npm run verify:package # inspect contents and load without runtime node_modules
npm run test:host      # isolated installed VS Code + released Jupyter + deterministic notebook controller
npm run test:opencode  # isolated real OpenCode server/config + native MCP connection
```

`VSCODE_TEST_VERSION=1.90.0 JUPYTER_TEST_VERSION=2024.5.0 npm run test:host` exercises the compatibility floor. `VSCODE_TEST_VERSION=stable` downloads the current VS Code stable release. `OPENCODE_BINARY=/absolute/path/to/opencode npm run test:opencode` selects another CLI version. Host tests install Jupyter only into an isolated `.vscode-test` directory, not the user's normal extensions.

See [release validation](docs/0.2.0-validation.md), [local tickets](docs/tickets/README.md), and the [release plan](docs/0.2.0-plan.md). The host controller tests actual VS Code notebook events and commands; they do not establish real Python-kernel or WSL behavior.

## License

MIT. Bundled dependencies retain their licenses in `THIRD_PARTY_NOTICES.txt` in the VSIX.
