// A private server and isolated config/data directories never use the user's running daemon.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { McpServerManager } = require('../out/mcpServer');
const { mcpConfiguration } = require('../out/config');
async function freePort() { return new Promise((resolve,reject) => { const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}); }); }
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-jupyter-check-'));
  const binary = process.env.OPENCODE_BINARY || 'opencode';
  const server = new McpServerManager({ listOpenNotebooks: () => [] }, 0, require('../package.json').version);
  let child; let logs='';
  try {
    await server.start();
    const config = mcpConfiguration(Number(new URL(server.getEndpoint()).port));
    config.mcp.servers['jupyter-vscode'].codemode = false;
    await fs.writeFile(path.join(directory, 'opencode.json'), JSON.stringify(config));
    const env = { ...process.env };
    for (const key of Object.keys(env)) { if (key.startsWith('OPENCODE_')) { delete env[key]; } }
    Object.assign(env, { OPENCODE_CONFIG_DIR: directory, OPENCODE_CONFIG: path.join(directory, 'opencode.json'),
      XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_DATA_HOME: path.join(directory, 'data'),
      XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_STATE_HOME: path.join(directory, 'state') });
    const port = await freePort();
    child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env});
    child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
    let childError;child.on('error',error=>{childError=error;});
    const query = new URLSearchParams({ 'location[directory]': directory });
    let result; let lastResponse;
    const deadline=Date.now()+45000;
    while(Date.now()<deadline) {
      if(childError) throw childError;
      if(child.exitCode!==null) throw Error('Private OpenCode server exited before validation.');
      try {
        const password=logs.match(/server password (\S+)/)?.[1];
        if (!password) { await new Promise(resolve=>setTimeout(resolve,100)); continue; }
        const response=await fetch(`http://127.0.0.1:${port}/api/mcp?${query}`,{
          headers:{Authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`},signal:AbortSignal.timeout(2000)});
        const data=await response.json();
        lastResponse={status:response.status,body:data};
        if(response.ok && data.data?.some(server => server.name === 'jupyter-vscode' && server.status?.status === 'connected')) { result=data;break; }
      } catch { /* Server is still starting. */ }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!result) throw Error(`No MCP status from private OpenCode server: ${JSON.stringify(lastResponse)}`);
    if(!JSON.stringify(result).includes('connected')) throw Error(`MCP did not connect: ${JSON.stringify(result)}`);
    const version=execFileSync(binary,['--version'],{encoding:'utf8'}).trim();
    console.log(JSON.stringify({version,generatedConfigAccepted:true,mcpStatus:result},null,2));
    await fs.mkdir('artifacts',{recursive:true});
    await fs.writeFile(`artifacts/opencode-${version.replace(/[^\d.]/g,'')}.json`,JSON.stringify({version,passed:true,status:result},null,2));
  } finally {
    if(child && child.exitCode===null) {
      await new Promise(resolve=>{child.once('close',resolve);child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);timer.unref();});
    }
    await server.stop();
    await fs.rm(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
