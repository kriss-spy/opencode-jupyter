import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { NotebookOperations } from './jupyterApi';
import { createToolServer } from './tools';

const BODY_LIMIT = 1024 * 1024;
const SESSION_LIMIT = 32;
const SESSION_IDLE_MS = 30 * 60 * 1000;
type Session = { server: Server; transport: StreamableHTTPServerTransport | SSEServerTransport; touched: number };

export class McpServerManager {
  private httpServer?: http.Server;
  private sessions = new Map<string, Session>();
  private connections = new Set<Session>();
  private timer?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();
  private phase: 'stopped' | 'starting' | 'running' | 'stopping' = 'stopped';

  constructor(private readonly api: NotebookOperations, private readonly port: number, private readonly version: string) {}
  get state() { return this.phase; }
  getEndpoint() {
    const address = this.httpServer?.address();
    return `http://127.0.0.1:${address && typeof address === 'object' ? address.port : this.port}`;
  }
  private enqueue(task: () => Promise<void>) {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  start(): Promise<void> { return this.enqueue(() => this.startNow()); }
  stop(): Promise<void> { return this.enqueue(() => this.stopNow()); }

  private async startNow() {
    if (this.phase === 'running') { return; }
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) { throw new Error('Invalid MCP port.'); }
    this.phase = 'starting';
    const server = http.createServer((req, res) => {
      void this.route(req, res).catch(() => { if (!res.headersSent) { this.reply(res, 500, 'MCP request failed.'); } else { res.end(); } });
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    this.httpServer = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      this.phase = 'running';
      this.timer = setInterval(() => {
        for (const session of this.connections) {
          if (Date.now() - session.touched > SESSION_IDLE_MS) { void session.server.close().catch(() => undefined); }
        }
      }, 60000);
      this.timer.unref();
    } catch (error) {
      this.httpServer = undefined;
      this.phase = 'stopped';
      server.close();
      throw error;
    }
  }

  private async stopNow() {
    if (!this.httpServer) { this.phase = 'stopped'; return; }
    this.phase = 'stopping';
    clearInterval(this.timer);
    const server = this.httpServer;
    await Promise.allSettled([...this.connections].map(session => session.server.close()));
    this.sessions.clear();
    this.connections.clear();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    this.httpServer = undefined;
    this.phase = 'stopped';
  }

  private reply(res: http.ServerResponse, status: number, message: string) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
  }

  private validHeaders(req: http.IncomingMessage) {
    const port = new URL(this.getEndpoint()).port;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!req.headers.host || !allowed.has(req.headers.host.toLowerCase())) { return false; }
    const origin = req.headers.origin;
    if (origin === undefined) { return true; }
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' && allowed.has(parsed.host.toLowerCase()) && parsed.origin === origin;
    } catch { return false; }
  }

  private async body(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      this.reply(res, 415, 'Expected application/json.'); return undefined;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    // Non-destroying iterator lets the server send a 413 before closing the connection.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += Buffer.byteLength(chunk);
      if (size > BODY_LIMIT) {
        res.setHeader('Connection', 'close');
        this.reply(res, 413, 'Request exceeds 1 MiB.'); req.resume(); return undefined;
      }
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { this.reply(res, 400, 'Invalid JSON.'); return undefined; }
  }

  private session(transport: Session['transport']): Session {
    const server = createToolServer(this.api, this.version);
    const session = { server, transport, touched: Date.now() };
    this.connections.add(session);
    server.onclose = () => {
      this.connections.delete(session);
      if (transport.sessionId) { this.sessions.delete(transport.sessionId); }
    };
    return session;
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.validHeaders(req)) { this.reply(res, 403, 'Invalid Host or Origin.'); return; }
    const url = new URL(req.url ?? '/', this.getEndpoint());
    if (url.pathname !== '/mcp' && url.pathname !== '/sse' && url.pathname !== '/message') {
      this.reply(res, 404, 'Not found.'); return;
    }
    let body: unknown;
    if (req.method === 'POST') {
      body = await this.body(req, res);
      if (res.writableEnded) { return; }
    }
    if (this.phase !== 'running') { this.reply(res, 503, 'MCP server is stopping.'); return; }
    if (url.pathname === '/sse' && req.method === 'GET') {
      if (this.connections.size >= SESSION_LIMIT) { this.reply(res, 503, 'Too many MCP clients.'); return; }
      const transport = new SSEServerTransport('/message', res);
      const session = this.session(transport);
      this.sessions.set(transport.sessionId, session);
      try { await session.server.connect(transport); }
      catch (error) { await session.server.close(); throw error; }
      return;
    }
    if (url.pathname === '/message' && req.method === 'POST') {
      const session = this.sessions.get(url.searchParams.get('sessionId') ?? '');
      if (!session || !(session.transport instanceof SSEServerTransport)) { this.reply(res, 404, 'Unknown legacy session.'); return; }
      session.touched = Date.now();
      await session.transport.handlePostMessage(req, res, body);
      return;
    }
    if (url.pathname !== '/mcp') { res.setHeader('Allow', url.pathname === '/sse' ? 'GET' : 'POST'); this.reply(res, 405, 'Method not allowed.'); return; }
    if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
      res.setHeader('Allow', 'POST, GET, DELETE'); this.reply(res, 405, 'Method not allowed.'); return;
    }
    const id = req.headers['mcp-session-id'];
    if (id !== undefined) {
      const session = typeof id === 'string' ? this.sessions.get(id) : undefined;
      if (!session || !(session.transport instanceof StreamableHTTPServerTransport)) { this.reply(res, 404, 'Unknown MCP session. Reconnect the client.'); return; }
      session.touched = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); }
      this.reply(res, req.method === 'POST' ? 400 : 405, 'Initialize a session with POST /mcp first.'); return;
    }
    if (this.connections.size >= SESSION_LIMIT) { this.reply(res, 503, 'Too many MCP clients.'); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID,
      enableJsonResponse: true, onsessioninitialized: sessionId => { this.sessions.set(sessionId, session); } });
    const session = this.session(transport);
    try {
      await session.server.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally { if (!transport.sessionId) { await session.server.close(); } }
  }
}
