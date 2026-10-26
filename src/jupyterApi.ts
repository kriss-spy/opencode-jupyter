import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { serializeOutputs, DEFAULT_OUTPUT_BYTES } from './outputs';

interface PublicJupyterApi {
  kernels?: { getKernel(uri: vscode.Uri): Promise<{ readonly status: string } | undefined> };
}

export class JupyterApi {
  private executing = new Set<string>();
  private indeterminate = new WeakMap<vscode.NotebookCell, string>();
  private instances = new WeakMap<vscode.NotebookDocument, string>();
  constructor(private readonly executionTimeout: () => number = () => 30000) {}

  listOpenNotebooks() {
    return vscode.workspace.notebookDocuments.filter(doc => doc.notebookType === 'jupyter-notebook')
      .map(doc => ({ uri: doc.uri.toString(), name: doc.uri.path.split('/').pop() || 'untitled', cellCount: doc.cellCount }));
  }

  private resolve(uri?: string): vscode.NotebookDocument {
    if (uri !== undefined && (typeof uri !== 'string' || !uri)) { throw new Error('uri must be a non-empty notebook URI.'); }
    const notebooks = vscode.workspace.notebookDocuments.filter(doc => doc.notebookType === 'jupyter-notebook' && !doc.isClosed);
    const active = vscode.window.activeNotebookEditor?.notebook;
    const notebook = uri !== undefined ? notebooks.find(doc => doc.uri.toString() === uri)
      : notebooks.find(doc => doc === active) ?? (notebooks.length === 1 ? notebooks[0] : undefined);
    if (!notebook) {
      throw new Error(`No unambiguous open Jupyter notebook${uri ? ` for ${uri}` : ''}. Supply uri from jupyter_list_open_notebooks. Open: ${notebooks.map(doc => doc.uri.toString()).join(', ') || 'none'}`);
    }
    return notebook;
  }

  private cell(notebook: vscode.NotebookDocument, index: number, insert = false) {
    if (!Number.isInteger(index) || index < 0 || index >= notebook.cellCount + (insert ? 1 : 0)) {
      throw new Error(`Cell index must be an integer in ${insert ? '[0, cellCount]' : '[0, cellCount)'}, cellCount=${notebook.cellCount}.`);
    }
    return insert ? undefined : notebook.cellAt(index);
  }

  private identifiedCell(notebook: vscode.NotebookDocument, cellId: string) {
    const cell = notebook.getCells().find(value => this.descriptor(value).cell_id === cellId);
    if (!cell) { throw new Error('Cell not found. Cell IDs are valid only while this notebook remains open; list cells again.'); }
    return cell;
  }

  private descriptor(cell: vscode.NotebookCell) {
    if (!this.instances.has(cell.notebook)) { this.instances.set(cell.notebook, randomUUID()); }
    return { cell_id: `${this.instances.get(cell.notebook)}:${cell.document.uri.toString()}`, index: cell.index,
      kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
      language: cell.document.languageId, execution_order: cell.executionSummary?.executionOrder ?? null };
  }

  private cellInfo(cell: vscode.NotebookCell) {
    const output = serializeOutputs(cell.outputs);
    return { ...this.descriptor(cell), source: cell.document.getText(),
      outputs: output.outputs.flatMap(group => group.items), outputs_truncated: output.truncated,
      executionSummary: cell.executionSummary, metadata: cell.metadata };
  }

  async getNotebookCells(uri?: string) { return this.resolve(uri).getCells().map(cell => this.cellInfo(cell)); }
  async getNotebookMetadata(uri?: string) { return this.resolve(uri).metadata; }
  async getNotebook(uri?: string) {
    const notebook = this.resolve(uri);
    return { uri: notebook.uri.toString(), version: notebook.version,
      cells: notebook.getCells().map(cell => this.cellInfo(cell)), metadata: notebook.metadata };
  }

  listCells(uri?: string, offset = 0, limit = 100, expectedVersion?: number) {
    const notebook = this.resolve(uri);
    if (!Number.isInteger(offset) || offset < 0 || offset > notebook.cellCount
      || !Number.isInteger(limit) || limit < 1 || limit > 500) { throw new Error('Invalid pagination: offset must be within the notebook; limit is 1–500.'); }
    if (expectedVersion !== undefined && notebook.version !== expectedVersion) {
      throw new Error('Notebook changed during pagination. Restart listing from offset 0.');
    }
    const end = Math.min(offset + limit, notebook.cellCount);
    return { uri: notebook.uri.toString(), version: notebook.version, cell_count: notebook.cellCount,
      cells: notebook.getCells(new vscode.NotebookRange(offset, end)).map(cell => this.descriptor(cell)),
      next_offset: end < notebook.cellCount ? end : null };
  }

  readCellInput(cellId: string, uri?: string) {
    const notebook = this.resolve(uri);
    const cell = this.identifiedCell(notebook, cellId);
    return { uri: notebook.uri.toString(), version: notebook.version, ...this.descriptor(cell), source: cell.document.getText() };
  }

  readCellOutput(cellId: string, uri?: string, maxBytes = DEFAULT_OUTPUT_BYTES) {
    const notebook = this.resolve(uri);
    const cell = this.identifiedCell(notebook, cellId);
    return { uri: notebook.uri.toString(), version: notebook.version, ...this.descriptor(cell),
      executionSummary: cell.executionSummary, ...serializeOutputs(cell.outputs, maxBytes) };
  }

  async insertCell(index: number, kind: 'code' | 'markdown', source: string, language?: string, uri?: string) {
    const notebook = this.resolve(uri);
    this.cell(notebook, index, true);
    if ((kind !== 'code' && kind !== 'markdown') || typeof source !== 'string'
      || (language !== undefined && (typeof language !== 'string' || !language))) { throw new Error('Invalid cell kind, source or language.'); }
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [vscode.NotebookEdit.insertCells(index, [new vscode.NotebookCellData(
      kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
      source, language ?? (kind === 'code' ? 'python' : 'markdown'))])]);
    if (!await vscode.workspace.applyEdit(edit)) { throw new Error('VS Code rejected the notebook insertion.'); }
    if (notebook.isClosed) { throw new Error('Notebook closed during insertion.'); }
    return this.cellInfo(notebook.cellAt(index));
  }

  async editCell(index: number, source: string, uri?: string) {
    const notebook = this.resolve(uri);
    const cell = this.cell(notebook, index)!;
    if (typeof source !== 'string') { throw new Error('source must be a string.'); }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(cell.document.uri, new vscode.Range(cell.document.positionAt(0), cell.document.positionAt(cell.document.getText().length)), source);
    if (!await vscode.workspace.applyEdit(edit)) { throw new Error('VS Code rejected the cell text edit.'); }
    if (notebook.isClosed || !notebook.getCells().includes(cell)) { throw new Error('Cell closed or removed during editing.'); }
    return this.cellInfo(cell);
  }

  async executeCell(index: number, uri?: string, signal?: AbortSignal) {
    const notebook = this.resolve(uri);
    const cell = this.cell(notebook, index)!;
    if (cell.kind !== vscode.NotebookCellKind.Code) { throw new Error('Only code cells can be executed.'); }
    const key = notebook.uri.toString();
    if (this.executing.has(key)) { throw new Error('An execution request is already in progress for this notebook. Wait for it to finish.'); }
    if (signal?.aborted) { throw new Error('Execution request cancelled.'); }
    const prior = cell.executionSummary;
    const priorFingerprint = JSON.stringify(prior) ?? 'undefined';
    const uncertainRun = this.indeterminate.get(cell);
    if (uncertainRun !== undefined) {
      if (typeof prior?.success === 'boolean' && priorFingerprint !== uncertainRun) { this.indeterminate.delete(cell); }
      else { throw new Error('Prior execution completion is unknown. Wait for a completed result, or stop the kernel and reopen the notebook before requesting another run.'); }
    }
    // Persisted ipynb execution_count becomes executionOrder without success.
    // That is historical metadata, not evidence that the cell is currently running.
    // Only fresh post-dispatch events may establish this request's execution.
    const timeoutMs = this.executionTimeout();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) { throw new Error('executionTimeoutMs must be 1–600000.'); }
    this.executing.add(key);
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let dispatched = false;
        let started = false;
        let executionOrder: number | undefined;
        const subscriptions: vscode.Disposable[] = [];
        const finish = (error?: Error, uncertain = false) => {
          if (settled) { return; }
          settled = true;
          if (uncertain && dispatched) { this.indeterminate.set(cell, priorFingerprint); }
          clearTimeout(timer);
          subscriptions.forEach(subscription => subscription.dispose());
          signal?.removeEventListener('abort', abort);
          if (error) { reject(error); } else { resolve(); }
        };
        const abort = () => finish(new Error('Execution request cancelled; the kernel may still be running.'), true);
        const timer = setTimeout(() => finish(new Error(`Execution timed out after ${timeoutMs}ms; completion is unknown and the kernel may still be running.`), true), timeoutMs);
        subscriptions.push(vscode.workspace.onDidChangeNotebookDocument(event => {
          if (event.notebook !== notebook) { return; }
          if (!notebook.getCells().includes(cell)) { finish(new Error('Cell removed during execution.')); return; }
          for (const change of event.cellChanges) {
            const summary = change.executionSummary;
            if (change.cell !== cell || !summary || !dispatched) { continue; }
            if (summary.success === undefined) {
              started = true;
              executionOrder = summary.executionOrder ?? executionOrder;
            } else if (started && (executionOrder === undefined || executionOrder === summary.executionOrder)) {
              finish();
            }
          }
        }), vscode.workspace.onDidCloseNotebookDocument(closed => {
          if (closed === notebook) { finish(new Error('Notebook closed during execution.')); }
        }));
        signal?.addEventListener('abort', abort, { once: true });
        // A single options object targets the notebook even when another editor has focus.
        void Promise.resolve().then(() => {
          if (settled || signal?.aborted) { return; }
          if (notebook.isClosed || !notebook.getCells().includes(cell)) { throw new Error('Cell closed or removed before execution dispatch.'); }
          dispatched = true;
          return vscode.commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: cell.index, end: cell.index + 1 }], document: notebook.uri,
          });
        }).catch(error => finish(error instanceof Error ? error : new Error(String(error)), started));
      });
      return this.cellInfo(cell);
    } finally { this.executing.delete(key); }
  }

  async getErrorCells(uri?: string) {
    return (await this.getNotebookCells(uri)).filter(cell => cell.executionSummary?.success === false
      || cell.outputs.some(output => output.outputType === 'error'));
  }

  async getVariables(uri?: string): Promise<never> {
    this.resolve(uri);
    throw new Error('Variable inspection is unsupported: the public Jupyter extension API does not provide variables. Inspect explicit notebook cell output instead.');
  }

  private async kernel(notebook: vscode.NotebookDocument) {
    const extension = vscode.extensions.getExtension<PublicJupyterApi>('ms-toolsai.jupyter');
    if (!extension) { return undefined; }
    const api = extension.isActive ? extension.exports : await extension.activate();
    return api?.kernels?.getKernel ? await api.kernels.getKernel(notebook.uri) : undefined;
  }

  async getKernelStatus(uri?: string): Promise<'idle' | 'busy' | 'unknown'> {
    const kernel = await this.kernel(this.resolve(uri));
    return kernel?.status === 'idle' || kernel?.status === 'busy' ? kernel.status : 'unknown';
  }

  async restartKernel(uri?: string): Promise<never> {
    const notebook = this.resolve(uri);
    // No stable public targeting/completion contract: retain the tool with an honest error.
    throw new Error(`Programmatic kernel restart is unsupported by the public Jupyter API. Restart the kernel in VS Code for ${notebook.uri.toString()}.`);
  }
}

export type NotebookOperations = Pick<JupyterApi, 'listOpenNotebooks' | 'getNotebook' | 'executeCell' | 'insertCell'
  | 'editCell' | 'getVariables' | 'getErrorCells' | 'restartKernel' | 'getKernelStatus' | 'listCells' | 'readCellInput' | 'readCellOutput'>;
