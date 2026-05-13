import * as vscode from 'vscode';

export interface NotebookCellInfo {
  index: number;
  kind: 'code' | 'markdown';
  language: string;
  source: string;
  outputs: CellOutput[];
  executionSummary?: {
    executionOrder?: number;
    success?: boolean;
    timing?: { startTime: number; endTime: number };
  };
  metadata?: Record<string, unknown>;
}

export interface CellOutput {
  outputType: string;
  mimeType: string;
  data: string;
}

export interface KernelVariable {
  name: string;
  type: string;
  value: string;
  size?: number;
}

export class JupyterApi {
  constructor(private context: vscode.ExtensionContext) {}

  getActiveNotebook(): vscode.NotebookDocument | undefined {
    const editor = vscode.window.activeNotebookEditor;
    if (editor?.notebook) {
      return editor.notebook;
    }
    // Fallback: if no notebook editor is focused, return the first open notebook
    const notebooks = vscode.workspace.notebookDocuments;
    if (notebooks.length === 1) {
      return notebooks[0];
    }
    return undefined;
  }

  listOpenNotebooks(): { uri: string; name: string; cellCount: number }[] {
    return vscode.workspace.notebookDocuments.map((doc) => ({
      uri: doc.uri.toString(),
      name: doc.uri.path.split('/').pop() || 'untitled',
      cellCount: doc.getCells().length,
    }));
  }

  getNotebookByUri(uri: string): vscode.NotebookDocument | undefined {
    return vscode.workspace.notebookDocuments.find(
      (doc) => doc.uri.toString() === uri
    );
  }

  async getNotebookCells(uri?: string): Promise<NotebookCellInfo[]> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      const open = this.listOpenNotebooks();
      throw new Error(
        `No notebook found. ${open.length} notebook(s) open: ` +
        (open.length > 0 ? open.map((n) => `${n.name} (${n.uri})`).join(', ') : 'none')
      );
    }

    return notebook.getCells().map((cell, index) => this.cellToInfo(cell, index));
  }

  async getNotebookMetadata(uri?: string): Promise<Record<string, unknown>> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }
    return notebook.metadata;
  }

  async executeCell(index: number, uri?: string): Promise<NotebookCellInfo> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    const cell = notebook.cellAt(index);
    if (!cell) {
      throw new Error(`Cell at index ${index} not found`);
    }

    // Execute the cell using VS Code's built-in command
    await vscode.commands.executeCommand(
      'notebook.cell.execute',
      { start: index, end: index + 1 },
      notebook.uri
    );

    // Wait a bit for execution to complete (basic approach)
    await this.waitForExecution(cell);

    return this.cellToInfo(cell, index);
  }

  async insertCell(
    index: number,
    kind: 'code' | 'markdown',
    source: string,
    language?: string,
    uri?: string
  ): Promise<NotebookCellInfo> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    const cellKind = kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup;
    
    const edit = new vscode.WorkspaceEdit();
    const newCell = new vscode.NotebookCellData(
      cellKind,
      source,
      language || (kind === 'code' ? 'python' : 'markdown')
    );
    
    edit.set(notebook.uri, [
      vscode.NotebookEdit.insertCells(index, [newCell])
    ]);

    await vscode.workspace.applyEdit(edit);

    // Refresh notebook reference after edit
    const updatedNotebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!updatedNotebook) {
      throw new Error('Notebook not found after edit');
    }

    return this.cellToInfo(updatedNotebook.cellAt(index), index);
  }

  async editCell(index: number, source: string, uri?: string): Promise<NotebookCellInfo> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    const cell = notebook.cellAt(index);
    if (!cell) {
      throw new Error(`Cell at index ${index} not found`);
    }

    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
      vscode.NotebookEdit.updateCellMetadata(index, cell.metadata),
      vscode.NotebookEdit.replaceCells(
        new vscode.NotebookRange(index, index + 1),
        [new vscode.NotebookCellData(cell.kind, source, cell.document.languageId)]
      ),
    ]);

    await vscode.workspace.applyEdit(edit);

    // Refresh and return
    const updatedNotebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!updatedNotebook) {
      throw new Error('Notebook not found after edit');
    }

    return this.cellToInfo(updatedNotebook.cellAt(index), index);
  }

  async getVariables(uri?: string): Promise<KernelVariable[]> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    // Try to use Jupyter extension's variable viewer if available
    try {
      const variables = await vscode.commands.executeCommand<KernelVariable[]>(
        'jupyter.getVariables',
        notebook.uri
      );
      return variables || [];
    } catch {
      // Fallback: return empty list if command not available
      return [];
    }
  }

  async getErrorCells(uri?: string): Promise<NotebookCellInfo[]> {
    const cells = await this.getNotebookCells(uri);
    return cells.filter(
      (cell) =>
        cell.executionSummary?.success === false ||
        cell.outputs.some((o) => o.outputType === 'error' || o.mimeType === 'application/vnd.code.notebook.error')
    );
  }

  async restartKernel(uri?: string): Promise<void> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    await vscode.commands.executeCommand('notebook.kernel.restart', notebook.uri);
  }

  async getKernelStatus(uri?: string): Promise<'idle' | 'busy' | 'unknown'> {
    const notebook = uri ? this.getNotebookByUri(uri) : this.getActiveNotebook();
    if (!notebook) {
      throw new Error('No notebook found');
    }

    // VS Code doesn't expose kernel status directly in stable API
    // We can infer from cell execution states
    const isExecuting = notebook.getCells().some(
      (cell) => cell.executionSummary && !cell.executionSummary.success && cell.executionSummary.executionOrder === undefined
    );

    return isExecuting ? 'busy' : 'idle';
  }

  private cellToInfo(cell: vscode.NotebookCell, index: number): NotebookCellInfo {
    const outputs: CellOutput[] = [];

    for (const output of cell.outputs) {
      for (const item of output.items) {
        const decoder = new TextDecoder();
        const data = decoder.decode(item.data);
        outputs.push({
          outputType: output.metadata?.outputType as string || 'unknown',
          mimeType: item.mime,
          data: data.length > 10000 ? data.substring(0, 10000) + '... [truncated]' : data,
        });
      }
    }

    return {
      index,
      kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
      language: cell.document.languageId,
      source: cell.document.getText(),
      outputs,
      executionSummary: cell.executionSummary
        ? {
            executionOrder: cell.executionSummary.executionOrder,
            success: cell.executionSummary.success,
            timing: cell.executionSummary.timing,
          }
        : undefined,
      metadata: cell.metadata,
    };
  }

  private async waitForExecution(cell: vscode.NotebookCell, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Check if execution summary is available
      if (cell.executionSummary && typeof cell.executionSummary.success !== 'undefined') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Timeout - execution may still be running
  }
}
