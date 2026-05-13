import * as vscode from 'vscode';
import { JupyterApi } from './jupyterApi';
import { McpServerManager } from './mcpServer';

let mcpServerManager: McpServerManager | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('OpenCode Jupyter');
  outputChannel.appendLine('OpenCode Jupyter extension activated');

  const jupyterApi = new JupyterApi(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-jupyter.startServer', async () => {
      await startMcpServer(jupyterApi);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-jupyter.stopServer', async () => {
      await stopMcpServer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-jupyter.showMcpConfig', () => {
      showMcpConfig();
    })
  );

  // Auto-start server when a notebook is opened, if configured
  const config = vscode.workspace.getConfiguration('opencode-jupyter');
  if (config.get<boolean>('autoStartServer', true)) {
    // If a notebook is already active, start immediately
    if (vscode.window.activeNotebookEditor) {
      startMcpServer(jupyterApi).catch((err) => {
        outputChannel.appendLine(`Auto-start failed: ${err}`);
      });
    }

    // Also listen for notebook editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveNotebookEditor(async (editor) => {
        if (editor && !mcpServerManager) {
          await startMcpServer(jupyterApi);
        }
      })
    );
  }

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      stopMcpServer();
    },
  });
}

export function deactivate() {
  stopMcpServer();
}

async function startMcpServer(jupyterApi: JupyterApi): Promise<void> {
  if (mcpServerManager) {
    vscode.window.showInformationMessage(
      `OpenCode Jupyter MCP server is already running at ${mcpServerManager.getEndpoint()}`
    );
    return;
  }

  const config = vscode.workspace.getConfiguration('opencode-jupyter');
  const port = config.get<number>('mcpPort', 9123);

  try {
    mcpServerManager = new McpServerManager(jupyterApi, port);
    await mcpServerManager.start();

    const endpoint = mcpServerManager.getEndpoint();
    outputChannel.appendLine(`MCP server started at ${endpoint}`);
    outputChannel.show(true);

    vscode.window.showInformationMessage(
      `OpenCode Jupyter MCP server started at ${endpoint}`,
      'Show Config'
    ).then((selection) => {
      if (selection === 'Show Config') {
        showMcpConfig();
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Failed to start MCP server: ${message}`);
    vscode.window.showErrorMessage(`Failed to start OpenCode Jupyter MCP server: ${message}`);
    mcpServerManager = undefined;
  }
}

async function stopMcpServer(): Promise<void> {
  if (!mcpServerManager) {
    return;
  }

  try {
    await mcpServerManager.stop();
    outputChannel.appendLine('MCP server stopped');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Error stopping MCP server: ${message}`);
  } finally {
    mcpServerManager = undefined;
  }
}

function showMcpConfig(): void {
  if (!mcpServerManager) {
    vscode.window.showWarningMessage('MCP server is not running. Start it first to see the configuration.');
    return;
  }

  const endpoint = mcpServerManager.getEndpoint();
  const config = {
    mcp: {
      'jupyter-vscode': {
        type: 'remote',
        url: `${endpoint}/sse`,
        enabled: true,
      },
    },
  };

  const configJson = JSON.stringify(config, null, 2);

  outputChannel.appendLine('--- OpenCode MCP Configuration ---');
  outputChannel.appendLine(configJson);
  outputChannel.show(true);

  vscode.window.showInformationMessage(
    'MCP configuration printed to OpenCode Jupyter output channel.',
    'Copy to Clipboard'
  ).then((selection) => {
    if (selection === 'Copy to Clipboard') {
      vscode.env.clipboard.writeText(configJson);
    }
  });
}
