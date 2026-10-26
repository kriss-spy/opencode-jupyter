const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const mock=require('mock-require');
const commands=new Map();let settings;let notebooks;let open;let change;let starts;let stops;let failure;let copied;let messages;
class Manager {
  constructor(api,port,version){this.port=port;this.version=version;this.state='stopped';}
  async start(){starts++;if(failure){failure=false;throw Error('occupied');}await new Promise(resolve=>setTimeout(resolve,1));this.state='running';}
  async stop(){stops++;this.state='stopped';}
  getEndpoint(){return `http://127.0.0.1:${this.port}`;}
}
const output={appendLine:line=>messages.push(line),show:()=>{},dispose:()=>{}};
const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback}),get notebookDocuments(){return notebooks;},onDidOpenNotebookDocument:fn=>{open=fn;return{dispose(){}};},onDidChangeConfiguration:fn=>{change=fn;return{dispose(){}};}},
window:{createOutputChannel:()=>output,showQuickPick:async items=>items[0],showInformationMessage:async()=> 'Copy to Clipboard',showErrorMessage:async line=>messages.push(line)},
commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return{dispose(){}};}},env:{clipboard:{writeText:async value=>{copied=value;}}}};
mock('vscode',vscode);mock(require.resolve('../out/mcpServer'),{McpServerManager:Manager});
const extension=require('../out/extension');
beforeEach(()=>{settings={mcpPort:9123,autoStartServer:false};notebooks=[];starts=0;stops=0;failure=false;copied=undefined;messages=[];commands.clear();});
afterEach(()=>extension.deactivate());
function activate(){extension.activate({extension:{packageJSON:{version:'0.2.0'}},subscriptions:[]});}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

test('config can be generated/copied while stopped, without starting a listener',async()=>{activate();await commands.get('opencode-jupyter.showMcpConfig')();assert.equal(starts,0);assert.equal(JSON.parse(copied).mcp.servers['jupyter-vscode'].url,'http://127.0.0.1:9123/mcp');assert.ok(messages.some(x=>x.includes('stopped')));});
test('concurrent start/start/stop/start serialize and deactivation awaits stop',async()=>{activate();await Promise.all(['startServer','startServer','stopServer','startServer'].map(name=>commands.get(`opencode-jupyter.${name}`)()));assert.equal(starts,2);assert.equal(stops,1);await extension.deactivate();assert.equal(stops,2);});
test('failed bind retries and config reports actual running port until restart',async()=>{activate();failure=true;await commands.get('opencode-jupyter.startServer')();assert.ok(messages.some(x=>x.includes('occupied')));await commands.get('opencode-jupyter.startServer')();settings.mcpPort=8123;await commands.get('opencode-jupyter.showMcpConfig')();assert.match(copied,/9123/);await commands.get('opencode-jupyter.stopServer')();await commands.get('opencode-jupyter.startServer')();await commands.get('opencode-jupyter.showMcpConfig')();assert.match(copied,/8123/);});
test('already-open and newly opened notebooks auto-start independently of focused editor',async()=>{settings.autoStartServer=true;notebooks=[{notebookType:'jupyter-notebook'}];activate();await tick();assert.equal(starts,1);await commands.get('opencode-jupyter.stopServer')();open({notebookType:'other'});await tick();assert.equal(starts,1);open({notebookType:'jupyter-notebook'});await tick();assert.equal(starts,2);});
test('auto-start respects disabled setting and config changes can enable it',async()=>{notebooks=[{notebookType:'jupyter-notebook'}];activate();open(notebooks[0]);await tick();assert.equal(starts,0);settings.autoStartServer=true;change({affectsConfiguration:key=>key==='opencode-jupyter.autoStartServer'});await tick();assert.equal(starts,1);});
