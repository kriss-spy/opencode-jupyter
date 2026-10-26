import * as vscode from 'vscode';
import { JupyterApi } from './jupyterApi';
import { McpServerManager } from './mcpServer';
import { mcpConfiguration, validatePort } from './config';

let manager: McpServerManager | undefined;
let output: vscode.OutputChannel;
let actions: Promise<unknown> = Promise.resolve();
let extensionVersion = 'unknown';

function configuredPort() { return validatePort(vscode.workspace.getConfiguration('opencode-jupyter').get<number>('mcpPort', 9123)); }
function serialize(task: () => Promise<void>) {
  const next = actions.then(task);
  actions = next.catch(() => undefined);
  return next;
}
function report(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  output.appendLine(message);
  void vscode.window.showErrorMessage(`OpenCode Jupyter: ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('OpenCode Jupyter');
  context.subscriptions.push(output);
  extensionVersion = context.extension.packageJSON.version;
  const api = new JupyterApi(() => vscode.workspace.getConfiguration('opencode-jupyter').get<number>('executionTimeoutMs', 30000));
  const start = () => serialize(async () => {
    if (manager?.state === 'running') { return; }
    const candidate = new McpServerManager(api, configuredPort(), extensionVersion);
    try {
      await candidate.start();
      manager = candidate;
      output.appendLine(`MCP running at ${candidate.getEndpoint()}/mcp (workspace host: ${vscode.env.remoteName ?? 'local'}).`);
    } catch (error) { await candidate.stop(); throw error; }
  });
  const stop = () => serialize(async () => {
    await manager?.stop();
    manager = undefined;
    output.appendLine('MCP stopped.');
  });
  const autoStart = () => {
    if (vscode.workspace.getConfiguration('opencode-jupyter').get<boolean>('autoStartServer', true)) {
      void start().catch(report);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-jupyter.startServer', () => start().catch(report)),
    vscode.commands.registerCommand('opencode-jupyter.stopServer', () => stop().catch(report)),
    vscode.commands.registerCommand('opencode-jupyter.showMcpConfig', async () => {
      try {
        const selection = await vscode.window.showQuickPick([
          { label: 'OpenCode v2', version: 'v2' as const, description: 'Native Streamable HTTP (recommended)' },
          { label: 'OpenCode v1', version: 'v1' as const, description: 'Migration configuration' },
        ], { title: 'MCP configuration format' });
        if (!selection) { return; }
        const port = manager?.state === 'running' ? Number(new URL(manager.getEndpoint()).port) : configuredPort();
        const json = JSON.stringify(mcpConfiguration(port, selection.version), null, 2);
        output.appendLine(`${selection.label}; server ${manager?.state ?? 'stopped'}; workspace host ${vscode.env.remoteName ?? 'local'}`);
        output.appendLine(json);
        output.show(true);
        const action = await vscode.window.showInformationMessage('MCP configuration is in the OpenCode Jupyter output channel.', 'Copy to Clipboard');
        if (action) { await vscode.env.clipboard.writeText(json); }
      } catch (error) { report(error); }
    }),
    vscode.workspace.onDidOpenNotebookDocument(notebook => { if (notebook.notebookType === 'jupyter-notebook') { autoStart(); } }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('opencode-jupyter.mcpPort') && manager?.state === 'running') {
        output.appendLine('MCP port changed. Stop and start the server to apply it, then update the client configuration.');
      }
      if (event.affectsConfiguration('opencode-jupyter.autoStartServer')
        && vscode.workspace.notebookDocuments.some(doc => doc.notebookType === 'jupyter-notebook')) { autoStart(); }
    }),
  );
  if (vscode.workspace.notebookDocuments.some(doc => doc.notebookType === 'jupyter-notebook')) { autoStart(); }
}

export async function deactivate() {
  await serialize(async () => { await manager?.stop(); manager = undefined; });
}
