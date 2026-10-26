const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const { serializeOutputs, imageContent } = require('../out/outputs');
function emitter() { const listeners = new Set(); return { event: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: e => [...listeners].forEach(fn => fn(e)), get size() { return listeners.size; } }; }
const changes = emitter(); const closes = emitter();
let apply = async () => true; let execute = async () => {}; let extension;
class NotebookRange { constructor(start,end) { this.start=start;this.end=end; } }
class WorkspaceEdit { set(uri, edits) { this.notebookEdits = { uri, edits }; } replace(uri,range,source) { this.textEdit = {uri,range,source}; } }
const vscode = { NotebookCellKind: { Code:2, Markup:1 }, NotebookRange, WorkspaceEdit,
  Range: class { constructor(start,end) { this.start=start;this.end=end; } },
  NotebookCellData: class { constructor(kind,value,languageId) { Object.assign(this,{kind,value,languageId}); } },
  NotebookEdit: { insertCells: (index,cells) => ({index,cells}) },
  workspace: { notebookDocuments: [], onDidChangeNotebookDocument: changes.event, onDidCloseNotebookDocument: closes.event, applyEdit: (...args) => apply(...args) },
  window: {}, commands: { executeCommand: (...args) => execute(...args) }, extensions: { getExtension: () => extension } };
mock('vscode',vscode);
const { JupyterApi } = require('../out/jupyterApi');
let serial=0;
function notebook(name='a', kind='jupyter-notebook') {
  const uri={toString:()=>`file:///${name}.ipynb`,path:`/${name}.ipynb`};
  const doc={uri,notebookType:kind,version:1,isClosed:false,cells:[],get cellCount(){return this.cells.length;},getCells(range){return range?this.cells.slice(range.start,range.end):this.cells;},cellAt(i){return this.cells[i];}};
  addCell(doc,'print(1)');return doc;
}
function addCell(doc, source, index=doc.cells.length) {
  const id=serial++; const cell={notebook:doc,kind:2,outputs:[],metadata:{keep:true},document:{uri:{toString:()=>`vscode-notebook-cell:${doc.uri}#${id}`},languageId:'python',getText:()=>source,positionAt:n=>({line:0,character:n})}};
  Object.defineProperty(cell,'index',{get:()=>doc.cells.indexOf(cell)});doc.cells.splice(index,0,cell);return cell;
}
beforeEach(()=>{vscode.workspace.notebookDocuments=[];vscode.window.activeNotebookEditor=undefined;extension=undefined;apply=async()=>true;execute=async()=>{};assert.equal(changes.size,0);assert.equal(closes.size,0);});

test('only Jupyter notebooks resolve; explicit inactive URI survives focus changes and preserves edits',async()=>{
  const a=notebook('a'), b=notebook('b'), foreign=notebook('foreign','other');vscode.workspace.notebookDocuments=[a,b,foreign];
  const api=new JupyterApi();assert.equal(api.listOpenNotebooks().length,2);assert.throws(()=>api.listCells(),/unambiguous/);
  const cell=a.cells[0];cell.outputs=[{items:[{mime:'text/plain',data:Buffer.from('old')}]}];
  const id=api.listCells(a.uri.toString()).cells[0].cell_id;
  apply=async edit=>{assert.equal(edit.textEdit.uri,cell.document.uri);assert.equal(edit.notebookEdits,undefined);cell.document.getText=()=>edit.textEdit.source;vscode.window.activeNotebookEditor={notebook:b};return true;};
  const result=await api.editCell(0,'new',a.uri.toString());assert.equal(result.source,'new');assert.equal(result.metadata.keep,true);assert.equal(result.outputs[0].data,'old');assert.equal(result.cell_id,id);
  apply=async()=>false;await assert.rejects(api.editCell(0,'rejected',a.uri.toString()),/rejected/);
  assert.throws(()=>api.listCells(foreign.uri.toString()),/Jupyter/);
});

test('cell IDs survive insertions and fail after removal/reopen; pagination detects changes',()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const api=new JupyterApi();const id=api.listCells().cells[0].cell_id;
  addCell(a,'above',0);a.version++;assert.equal(api.readCellInput(id).index,1);
  assert.throws(()=>api.listCells(undefined,0,100,1),/changed/);assert.equal(api.listCells(undefined,0,1).next_offset,1);
  a.cells.pop();assert.throws(()=>api.readCellInput(id),/not found/);
  const reopened=notebook();reopened.cells[0].document.uri=a.cells[0].document.uri;vscode.workspace.notebookDocuments=[reopened];assert.throws(()=>api.readCellInput(id),/not found/);
});

test('validation rejects invalid indices/kind, failed insertion and markdown execution',async()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const api=new JupyterApi();
  for(const index of [-1,.5,1,NaN]) await assert.rejects(api.editCell(index,'x'),/index/);
  await assert.rejects(api.insertCell(0,'invalid','x'),/kind/);
  apply=async()=>false;await assert.rejects(api.insertCell(1,'code','x'),/rejected/);
  a.cells[0].kind=1;await assert.rejects(api.executeCell(0),/code cells/);
});

test('rerun ignores old summary/output changes and waits for new completion on exact document',async()=>{
  const a=notebook(), b=notebook('b');vscode.workspace.notebookDocuments=[a,b];const cell=a.cells[0];cell.executionSummary={executionOrder:1,success:true};const api=new JupyterApi(()=>200);
  execute=async(command,args)=>{assert.equal(command,'notebook.cell.execute');assert.equal(args.document,a.uri);assert.deepEqual(args.ranges,[{start:0,end:1}]);
    changes.fire({notebook:a,cellChanges:[{cell,outputs:[]}]});
    cell.executionSummary={executionOrder:2};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:cell.executionSummary}]});
    changes.fire({notebook:b,cellChanges:[{cell:b.cells[0],executionSummary:{success:true}}]});
    setTimeout(()=>{cell.executionSummary={executionOrder:2,success:false};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:cell.executionSummary}]});},25);
  };
  const result=await api.executeCell(0,a.uri.toString());assert.equal(result.executionSummary.executionOrder,2);assert.equal(result.executionSummary.success,false);assert.equal(changes.size,0);
});

test('timeouts, concurrent execution, cancellation, closed/removed cells and command errors clean observers',async()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const api=new JupyterApi(()=>20);
  const first=api.executeCell(0);await assert.rejects(api.executeCell(0),/already in progress/);await assert.rejects(first,/timed out/);assert.equal(changes.size,0);
  await assert.rejects(api.executeCell(0),/completion is unknown/);
  a.cells[0].executionSummary={executionOrder:1,success:true};
  const controller=new AbortController();const cancelled=api.executeCell(0,undefined,controller.signal);controller.abort();await assert.rejects(cancelled,/cancelled/);
  const closed=api.executeCell(0);closes.fire(a);await assert.rejects(closed,/closed/);
  const removed=api.executeCell(0);a.cells=[];changes.fire({notebook:a,cellChanges:[]});await assert.rejects(removed,/removed/);addCell(a,'again');
  execute=async()=>{throw Error('kernel unavailable');};await assert.rejects(api.executeCell(0),/kernel unavailable/);assert.equal(changes.size,0);assert.equal(closes.size,0);
});

test('kernel capabilities return real state or unknown, with explicit unsupported tool errors',async()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const api=new JupyterApi();assert.equal(await api.getKernelStatus(),'unknown');
  extension={isActive:false,activate:async()=>({kernels:{getKernel:async uri=>{assert.equal(uri,a.uri);return{status:'busy'};}}})};
  assert.equal(await api.getKernelStatus(),'busy');await assert.rejects(api.getVariables(),/unsupported/);await assert.rejects(api.restartKernel(),/unsupported/);
});

test('output encoding preserves binary, error grouping and limits without partial images/UTF8',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);const data=[{items:[{mime:'image/png',data:png},{mime:'application/vnd.code.notebook.error',data:Buffer.from('{"name":"Error"}')}]}];
  const full=serializeOutputs(data);assert.equal(full.outputs[0].items[0].data,png.toString('base64'));assert.equal(full.outputs[0].items[1].outputType,'error');assert.equal(imageContent(full.outputs).length,1);
  const tiny=serializeOutputs(data,5);assert.equal(tiny.outputs[0].items[0].data,'');assert.equal(imageContent(tiny.outputs).length,0);assert.equal(tiny.truncated,true);assert.ok(tiny.returned_bytes<=5);
  const utf8=serializeOutputs([{items:[{mime:'text/plain',data:Buffer.from('中中')}]}],4);assert.equal(utf8.outputs[0].items[0].data,'中');assert.equal(utf8.returned_bytes,3);
  assert.throws(()=>serializeOutputs(data,0),/max_bytes/);
});

test('a previously running cell cannot complete a new request and pre-dispatch cancellation never runs code',async()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const api=new JupyterApi(()=>20);const cell=a.cells[0];
  cell.executionSummary={executionOrder:1};let commands=0;
  execute=async()=>{commands++;cell.executionSummary={executionOrder:1,success:true};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:cell.executionSummary}]});};
  await assert.rejects(api.executeCell(0),/timed out/);assert.equal(commands,1);
  cell.executionSummary={executionOrder:1,success:true};
  const controller=new AbortController();const cancelled=api.executeCell(0,undefined,controller.signal);controller.abort();await assert.rejects(cancelled,/cancelled/);await Promise.resolve();assert.equal(commands,1);
  execute=async()=>{commands++;cell.executionSummary={executionOrder:2,success:true};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:cell.executionSummary}]});};
  await assert.rejects(api.executeCell(0),/timed out/);assert.equal(commands,2);
});

test('persisted execution order without success is historical, and does not block a fresh run',async()=>{
  const a=notebook();vscode.workspace.notebookDocuments=[a];const cell=a.cells[0];
  // Real ipynb execution_count is restored even when success metadata is absent.
  cell.executionSummary={executionOrder:1};
  const api=new JupyterApi(()=>100);let dispatched=false;
  execute=async()=>{dispatched=true;cell.executionSummary={};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:{}}]});
    cell.executionSummary={executionOrder:2,success:true};changes.fire({notebook:a,cellChanges:[{cell,executionSummary:cell.executionSummary}]});};
  const result=await api.executeCell(0);assert.equal(dispatched,true);assert.equal(result.executionSummary.executionOrder,2);
});
