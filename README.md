# OpenCode Jupyter

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/KrisspyWang.opencode-jupyter)](https://marketplace.visualstudio.com/items?itemName=KrisspyWang.opencode-jupyter)
[![OpenCode](https://img.shields.io/badge/OpenCode-MCP-8A2BE2)](https://opencode.ai)

A Visual Studio Code extension that bridges [OpenCode](https://opencode.ai) with Jupyter notebooks via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Overview

This extension runs a local MCP server inside VS Code that exposes Jupyter notebook operations as MCP tools. Any MCP-compatible client (like OpenCode) can then read, edit, and execute notebook cells, query kernel variables, and more.

## Prerequisites

- VS Code ^1.90.0
- [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) (`ms-toolsai.jupyter`) — installed automatically as a dependency

## Installation

### From VS Code Marketplace

Search for **"OpenCode Jupyter"** in the VS Code extensions panel, or install via CLI:

```
code --install-extension KrisspyWang.opencode-jupyter
```

### From VSIX

```
vsce package --skip-license
code --install-extension opencode-jupyter-0.1.0.vsix
```

## Quick Start

1. Install the extension and open any `.ipynb` file in VS Code.
2. The MCP server starts automatically on port **9123** (configurable via `opencode-jupyter.mcpPort`).
3. Run the command **"OpenCode Jupyter: Show MCP Configuration"** to get the configuration snippet.
4. Add it to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jupyter-vscode": {
      "type": "remote",
      "url": "http://localhost:9123/sse",
      "enabled": true
    }
  }
}
```

5. Restart OpenCode — the tools appear automatically.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `jupyter_list_open_notebooks` | List all currently open Jupyter notebooks with URIs and cell counts |
| `jupyter_get_notebook` | Get all cells, source, and outputs (optionally by notebook URI) |
| `jupyter_run_cell` | Execute a cell by index (optionally by notebook URI) |
| `jupyter_insert_cell` | Insert a new code/markdown cell at a given index |
| `jupyter_edit_cell` | Modify an existing cell's source (optionally by notebook URI) |
| `jupyter_get_variables` | Query kernel variables (optionally by notebook URI) |
| `jupyter_get_errors` | Get cells with error outputs (optionally by notebook URI) |
| `jupyter_restart_kernel` | Restart the notebook kernel (optionally by notebook URI) |
| `jupyter_get_kernel_status` | Check if kernel is idle or busy (optionally by notebook URI) |

Most tools accept an optional `uri` parameter to target a specific notebook when multiple are open.

## Architecture

```
OpenCode (TUI/IDE)
    | MCP protocol (HTTP/SSE)
    v
Local MCP Server (runs inside VS Code extension on localhost:9123)
    | vscode.* APIs
    v
Jupyter notebook cells, outputs, kernel state (via ms-toolsai.jupyter)
```

The server uses **HTTP + Server-Sent Events (SSE)** transport with JSON-RPC 2.0 messages, following the MCP specification.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `opencode-jupyter.mcpPort` | `9123` | Port for the local MCP server |
| `opencode-jupyter.autoStartServer` | `true` | Automatically start the server when a notebook is opened |

## Commands

| Command | Description |
|---------|-------------|
| **OpenCode Jupyter: Start MCP Server** | Manually start the MCP server |
| **OpenCode Jupyter: Stop MCP Server** | Stop the running MCP server |
| **OpenCode Jupyter: Show MCP Configuration** | Display the JSON snippet for `opencode.json` |

## Development

- `npm run compile` — compile TypeScript
- `npm run watch` — watch mode and recompile
- `npm run lint` — run ESLint

## References

- [OpenCode](https://opencode.ai)
- [VS Code Jupyter Extension](https://github.com/microsoft/vscode-jupyter)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

MIT
