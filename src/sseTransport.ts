import * as http from 'http';
import * as url from 'url';

export interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function isJSONRPCMessage(obj: unknown): obj is JSONRPCMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as JSONRPCMessage).jsonrpc === '2.0'
  );
}

export class SseTransport {
  private clients: Map<string, http.ServerResponse> = new Map();
  private clientIdCounter = 0;
  private messageHandler?: (message: JSONRPCMessage) => void;
  private closeHandler?: () => void;
  private httpServer?: http.Server;

  constructor(private port: number) {}

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = url.parse(req.url || '', true);

      if (parsedUrl.pathname === '/sse' && req.method === 'GET') {
        await this.handleSseConnection(req, res);
      } else if (parsedUrl.pathname === '/message' && req.method === 'POST') {
        await this.handlePostMessage(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, () => resolve());
      this.httpServer!.on('error', reject);
    });
  }

  async close(): Promise<void> {
    for (const res of this.clients.values()) {
      res.end();
    }
    this.clients.clear();

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  onMessage(handler: (message: JSONRPCMessage) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const data = JSON.stringify(message);
    for (const [clientId, res] of this.clients.entries()) {
      if (!res.writableEnded) {
        res.write(`event: message\ndata: ${data}\n\n`);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  private async handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientId = `client-${++this.clientIdCounter}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    this.clients.set(clientId, res);

    // Send endpoint info as first event per MCP spec
    res.write(`event: endpoint\ndata: ${encodeURI(`/message?sessionId=${clientId}`)}\n\n`);

    req.on('close', () => {
      this.clients.delete(clientId);
      if (this.clients.size === 0 && this.closeHandler) {
        this.closeHandler();
      }
    });
  }

  private async handlePostMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    try {
      const rawMessage = JSON.parse(body);
      if (!isJSONRPCMessage(rawMessage)) {
        throw new Error('Invalid JSON-RPC message');
      }

      if (this.messageHandler) {
        this.messageHandler(rawMessage);
      }

      res.writeHead(202);
      res.end('Accepted');
    } catch (error) {
      res.writeHead(400);
      res.end(`Invalid message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
