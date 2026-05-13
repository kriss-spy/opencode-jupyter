# OpenCode Jupyter

A Visual Studio Code extension that bridges [OpenCode](https://github.com/opencode) with Jupyter notebooks via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Overview

This extension exposes Jupyter notebook interaction as MCP tools, allowing OpenCode (or any MCP-compatible client) to:

- Read notebook cells and outputs
- Execute cells
- Insert and edit cells
- Query kernel variables
- Detect error cells
- Restart kernels

## Architecture

```
OpenCode (TUI/IDE)
    | MCP protocol (HTTP/SSE)
    v
Local MCP Server (runs inside VSCode extension on localhost:9123)
    | vscode.* APIs
    v
Jupyter notebook cells, outputs, kernel state (via ms-toolsai.jupyter)
```

## Prerequisites

- VS Code ^1.90.0
- [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) (`ms-toolsai.jupyter`) installed

## Installation

1. Clone this repository.
2. Run `npm install`.
3. Press `F5` in VS Code to launch the Extension Development Host, or run `vsce package` to build a `.vsix`.

## Configuration

The extension starts an MCP HTTP server automatically when you open a Jupyter notebook. You can configure the port in VS Code settings (`opencode-jupyter.mcpPort`).

### Connect OpenCode

After the server starts, run the command **"OpenCode Jupyter: Show MCP Configuration"** to get the JSON snippet for your `opencode.json`:

```json
{
  "mcp": {
    "jupyter-vscode": {
      "type": "remote",
      "url": "http://localhost:9123/sse",
      "enabled": true
    }
  }
}
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `jupyter_get_notebook` | Get all cells, source, and outputs |
| `jupyter_run_cell` | Execute a cell by index |
| `jupyter_insert_cell` | Insert a new code/markdown cell |
| `jupyter_edit_cell` | Modify an existing cell's source |
| `jupyter_get_variables` | Query kernel variables |
| `jupyter_get_errors` | Get cells with error outputs |
| `jupyter_restart_kernel` | Restart the notebook kernel |
| `jupyter_get_kernel_status` | Check if kernel is idle or busy |

## Development

- `npm run compile` — compile TypeScript
- `npm run watch` — watch mode
- `npm run lint` — run ESLint

## References

- [VS Code Jupyter Extension](https://github.com/microsoft/vscode-jupyter)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Notebook API](https://code.visualstudio.com/api/extension-guides/notebook)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

MIT
