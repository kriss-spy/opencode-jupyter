const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { JupyterApi } = require('../out/jupyterApi');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
exports.run=async function(){
  const config=vscode.workspace.getConfiguration('opencode-jupyter');
  const port=await freePort();
  await config.update('autoStartServer',false,vscode.ConfigurationTarget.Global);
  await config.update('mcpPort',port,vscode.ConfigurationTarget.Global);
  const extension=vscode.extensions.getExtension('KrisspyWang.opencode-jupyter');
  const client=new Client({name:'extension-host-test',version:'1'});
  let controller;
  const executionEvents=[];
  const observer=vscode.workspace.onDidChangeNotebookDocument(event=>{
    for(const change of event.cellChanges) executionEvents.push({index:change.cell.index,summary:change.executionSummary,
      current:change.cell.executionSummary,outputsChanged:change.outputs!==undefined});
  });
  try{
    await extension.activate();
    await Promise.all([vscode.commands.executeCommand('opencode-jupyter.startServer'),vscode.commands.executeCommand('opencode-jupyter.startServer')]);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    assert.equal((await client.listTools()).tools.length,12);
    const historicalCell=new vscode.NotebookCellData(vscode.NotebookCellKind.Code,'print(42)','python');
    historicalCell.executionSummary={executionOrder:9};
    const notebook=await vscode.workspace.openNotebookDocument('jupyter-notebook',new vscode.NotebookData([
      historicalCell,
      new vscode.NotebookCellData(vscode.NotebookCellKind.Markup,'# Keep','markdown')]));
    await vscode.window.showNotebookDocument(notebook);
    controller=vscode.notebooks.createNotebookController('opencode-jupyter-test','jupyter-notebook','OpenCode Jupyter Test Kernel');
    controller.supportedLanguages=['python'];controller.supportsExecutionOrder=true;
    controller.updateNotebookAffinity(notebook,vscode.NotebookControllerAffinity.Preferred);
    let order=0;
    controller.executeHandler=async cells=>{
      for(const cell of cells){const execution=controller.createNotebookCellExecution(cell);execution.executionOrder=++order;execution.start(Date.now());
        await new Promise(resolve=>setTimeout(resolve,30));
        await execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(`run ${order}`)])]);
        execution.end(true,Date.now());}
    };
    await vscode.commands.executeCommand('notebook.selectKernel',{id:controller.id,extension:'KrisspyWang.opencode-jupyter'});
    const uri=notebook.uri.toString();
    const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:10000});assert.notEqual(r.isError,true,r.content[0]?.text);return JSON.parse(r.content[0].text);};
    const listed=await call('jupyter_list_cells',{uri});assert.equal(listed.cells.length,2);
    assert.equal(listed.cells[0].execution_order,9,'The host fixture must restore a historical execution count without success metadata.');
    const cellId=listed.cells[0].cell_id;
    await call('jupyter_edit_cell',{uri,index:0,source:'print(43)'});
    assert.equal((await call('jupyter_read_cell_input',{uri,cell_id:cellId})).source,'print(43)');
    const first=await call('jupyter_run_cell',{uri,index:0});assert.equal(first.executionSummary.executionOrder,1);
    const second=await call('jupyter_run_cell',{uri,index:0});assert.equal(second.executionSummary.executionOrder,2);
    const output=await call('jupyter_read_cell_output',{uri,cell_id:cellId});assert.match(output.outputs[0].items[0].data,/run 2/);
    await call('jupyter_insert_cell',{uri,index:0,kind:'markdown',source:'# Above'});
    assert.equal((await call('jupyter_read_cell_input',{uri,cell_id:cellId})).index,1);
    // Also use the adapter directly against the actual extension-host API boundary.
    assert.equal((await new JupyterApi().getNotebook(uri)).cells.length,3);
    await fs.writeFile(process.env.OPENCODE_JUPYTER_HOST_RESULTS,JSON.stringify({vscode:vscode.version,jupyter:vscode.extensions.getExtension('ms-toolsai.jupyter')?.packageJSON.version,controller:'deterministic test controller; no Python kernel claimed',passed:true,workflow:'native MCP → list → edit → run twice → read output → insert → retain cell identity',executionEvents},null,2));
  }finally{
    await client.close();controller?.dispose();observer.dispose();
    await vscode.commands.executeCommand('opencode-jupyter.stopServer');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
};
