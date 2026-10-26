const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { McpServerManager } = require('../out/mcpServer');
const { mcpConfiguration, validatePort } = require('../out/config');

const api = {
  listOpenNotebooks: () => [{ uri: 'file:///a.ipynb', cellCount: 1 }],
  getNotebook: async uri => { await new Promise(r => setTimeout(r, uri === 'slow' ? 35 : 1)); return { uri }; },
  getVariables: async () => { throw Error('unsupported'); },
  listCells: () => ({ cells: [{ cell_id: 'opaque', index: 0 }], next_offset: null }),
  readCellInput: id => ({ cell_id: id, source: 'print(42)' }),
  readCellOutput: () => ({ outputs: [{ output_index: 0, items: [{ mimeType: 'image/png', encoding: 'base64', data: 'iVBORw0KGgo=', truncated: false }] }] }),
};
async function setup(t) {
  const server = new McpServerManager(api, 0, '0.2.0');
  await server.start();
  t.after(() => server.stop());
  return server;
}
async function client(t, server, legacy = false) {
  const c = new Client({ name: 'test', version: '1' });
  const Transport = legacy ? SSEClientTransport : StreamableHTTPClientTransport;
  const transport = new Transport(new URL(server.getEndpoint() + (legacy ? '/sse' : '/mcp')));
  await c.connect(transport);
  t.after(() => c.close());
  return { c, transport };
}
function request(base, path, { method = 'POST', body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      let result = ''; res.on('data', chunk => result += chunk); res.on('end', () => resolve({ status: res.statusCode, body: result, headers: res.headers }));
    });
    req.on('error', reject); req.end(method === 'GET' || method === 'DELETE' ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

test('native SDK client negotiates, lists twelve tools and calls new/old tools', async t => {
  const server = await setup(t); const { c, transport } = await client(t, server);
  assert.equal(c.getServerVersion().version, '0.2.0');
  const tools = (await c.listTools()).tools;
  assert.equal(tools.length, 12);
  assert.equal(tools.find(x => x.name === 'jupyter_list_cells').annotations.readOnlyHint, true);
  assert.equal(tools.find(x => x.name === 'jupyter_run_cell').inputSchema.properties.index.type, 'integer');
  assert.ok(transport.sessionId);
  const result = await c.callTool({ name: 'jupyter_list_open_notebooks', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text)[0].uri, 'file:///a.ipynb');
  const output = await c.callTool({ name: 'jupyter_read_cell_output', arguments: { cell_id: 'opaque', include_images: true } });
  assert.equal(output.content[1].type, 'image');
  assert.equal(JSON.parse(output.content[0].text).outputs[0].items[0].data, '');
  await transport.terminateSession();
  assert.equal((await request(server.getEndpoint(), '/mcp', { headers: { 'mcp-session-id': transport.sessionId ?? 'expired' } })).status, 404);
});

test('legacy SDK client handshakes and receives isolated responses', async t => {
  const server = await setup(t);
  const a = await client(t, server, true); const b = await client(t, server, true);
  const results = await Promise.all([
    a.c.callTool({ name: 'jupyter_get_notebook', arguments: { uri: 'slow' } }),
    b.c.callTool({ name: 'jupyter_get_notebook', arguments: { uri: 'fast' } }),
  ]);
  assert.deepEqual(results.map(r => JSON.parse(r.content[0].text).uri), ['slow', 'fast']);
  assert.equal((await request(server.getEndpoint(), '/message?sessionId=unknown')).status, 404);
});

test('concurrent native clients with identical request sequences never see another result', async t => {
  const server = await setup(t); const a = await client(t, server); const b = await client(t, server);
  const results = await Promise.all(['slow', 'fast'].map((uri, i) => [a,b][i].c.callTool({ name: 'jupyter_get_notebook', arguments: { uri } })));
  assert.deepEqual(results.map(r => JSON.parse(r.content[0].text).uri), ['slow', 'fast']);
});

test('schema errors and unsupported capabilities are tool errors without dispatch', async t => {
  const server = await setup(t); const { c } = await client(t, server);
  for (const args of [{ index: 1.2 }, { index: -1 }, { index: 0, uri: 4 }, { index: 0, extra: true }]) {
    assert.equal((await c.callTool({ name: 'jupyter_run_cell', arguments: args })).isError, true);
  }
  assert.equal((await c.callTool({ name: 'jupyter_get_variables', arguments: {} })).isError, true);
  assert.equal((await c.callTool({ name: 'jupyter_missing', arguments: {} })).isError, true);
});

test('loopback, hostile headers, malformed input, body limits and method handling', async t => {
  const server = await setup(t); const base = server.getEndpoint();
  assert.match(base, /^http:\/\/127\.0\.0\.1:/);
  for (const path of ['/mcp', '/sse', '/message']) {
    assert.equal((await request(base, path, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request(base, path, { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await request(base, path, { headers: { Origin: 'null' } })).status, 403);
  }
  assert.equal((await request(base, '/mcp', { body: '{' })).status, 400);
  assert.equal((await request(base, '/mcp', { body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal((await request(base, '/mcp', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request(base, '/absent')).status, 404);
  assert.equal((await request(base, '/sse')).status, 405);
  assert.equal((await request(base, '/mcp', { method: 'GET' })).status, 405);
  assert.equal((await request(base, '/mcp', { method: 'PUT' })).status, 405);
  assert.equal((await request(base, '/mcp', { headers: { 'mcp-session-id': 'unknown' } })).status, 404);
});

test('start/stop serialize, occupied-port failure is recoverable and same manager restarts', async t => {
  const server = await setup(t);
  const blocked = new McpServerManager(api, Number(new URL(server.getEndpoint()).port), '0.2.0');
  t.after(() => blocked.stop());
  await assert.rejects(blocked.start(), /EADDRINUSE/); assert.equal(blocked.state, 'stopped');
  await server.stop(); await blocked.start(); assert.equal(blocked.state, 'running'); await blocked.stop();
  await Promise.all([server.start(), server.start(), server.stop(), server.start()]);
  assert.equal(server.state, 'running');
  const { c } = await client(t, server); assert.equal((await c.listTools()).tools.length, 12);
});

test('configuration uses correct v2/v1 schemas and rejects invalid ports', () => {
  assert.equal(mcpConfiguration(9123).mcp.servers['jupyter-vscode'].url, 'http://127.0.0.1:9123/mcp');
  assert.equal(mcpConfiguration(9123).mcp.servers['jupyter-vscode'].oauth, false);
  assert.equal(mcpConfiguration(8123,'v1').mcp['jupyter-vscode'].enabled, true);
  for (const value of [0, -1, 1.2, 65536, NaN]) { assert.throws(() => validatePort(value)); }
});

test('stopping aborts in-flight tool observers and closes native client connections', async t => {
  let aborted=false; let started;
  const began=new Promise(resolve=>{started=resolve;});
  const server=new McpServerManager({...api,executeCell:(_index,_uri,signal)=>new Promise((resolve,reject)=>{
    started();signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});
  })},0,'0.2.0');
  await server.start();t.after(()=>server.stop());const {c}=await client(t,server);
  const pending=c.callTool({name:'jupyter_run_cell',arguments:{index:0}}).catch(error=>error);
  await began;await server.stop();await pending;assert.equal(aborted,true);assert.equal(server.state,'stopped');
});
