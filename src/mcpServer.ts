import { JupyterApi, NotebookCellInfo, KernelVariable } from './jupyterApi';
import { SseTransport, JSONRPCMessage } from './sseTransport';

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const TOOLS: Tool[] = [
  {
    name: 'jupyter_list_open_notebooks',
    description: 'List all currently open Jupyter notebooks in VS Code, with their URIs and cell counts. Useful when no notebook is "active" but one is open.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'jupyter_get_notebook',
    description: 'Get the full content of the active or specified Jupyter notebook, including all cells, their source code, and outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
    },
  },
  {
    name: 'jupyter_run_cell',
    description: 'Execute a specific cell in a Jupyter notebook by its index and return the updated cell with outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'Zero-based index of the cell to execute.',
        },
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
      required: ['index'],
    },
  },
  {
    name: 'jupyter_insert_cell',
    description: 'Insert a new cell into a Jupyter notebook at the specified index.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'Zero-based index where the new cell should be inserted.',
        },
        kind: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'Type of cell to insert.',
        },
        source: {
          type: 'string',
          description: 'Source content of the new cell.',
        },
        language: {
          type: 'string',
          description: 'Language identifier (e.g., python). Defaults to python for code cells.',
        },
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
      required: ['index', 'kind', 'source'],
    },
  },
  {
    name: 'jupyter_edit_cell',
    description: 'Modify the source content of an existing cell in a Jupyter notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'Zero-based index of the cell to edit.',
        },
        source: {
          type: 'string',
          description: 'New source content for the cell.',
        },
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
      required: ['index', 'source'],
    },
  },
  {
    name: 'jupyter_get_variables',
    description: 'Query the current kernel variables for a Jupyter notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
    },
  },
  {
    name: 'jupyter_get_errors',
    description: 'Get all cells in a Jupyter notebook that have error outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
    },
  },
  {
    name: 'jupyter_restart_kernel',
    description: 'Restart the kernel for a Jupyter notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
    },
  },
  {
    name: 'jupyter_get_kernel_status',
    description: 'Get the current kernel status (idle or busy) for a Jupyter notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional URI of the notebook. If omitted, uses the active notebook.',
        },
      },
    },
  },
];

export class McpServerManager {
  private transport?: SseTransport;
  private requestId = 0;

  constructor(
    private jupyterApi: JupyterApi,
    private port: number
  ) {}

  async start(): Promise<void> {
    if (this.transport) {
      throw new Error('MCP server is already running');
    }

    this.transport = new SseTransport(this.port);
    this.transport.onMessage((message) => this.handleMessage(message));

    await this.transport.start();

    // Send initialization notification to all connected clients
    await this.sendNotification('notifications/tools/list_changed', {});
  }

  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }

  getEndpoint(): string {
    return `http://localhost:${this.port}`;
  }

  private async handleMessage(message: JSONRPCMessage): Promise<void> {
    if (!message.method || message.method.startsWith('notifications/')) {
      return;
    }

    const id = message.id;

    try {
      switch (message.method) {
        case 'initialize': {
          await this.sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'opencode-jupyter',
              version: '0.1.0',
            },
          });
          break;
        }

        case 'tools/list': {
          await this.sendResponse(id, { tools: TOOLS });
          break;
        }

        case 'tools/call': {
          const params = message.params as { name: string; arguments?: Record<string, unknown> } | undefined;
          if (!params?.name) {
            throw new Error('Missing tool name');
          }
          const result = await this.handleToolCall(params.name, params.arguments);
          await this.sendResponse(id, result);
          break;
        }

        default: {
          await this.sendError(id, -32601, `Method not found: ${message.method}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.sendError(id, -32603, msg);
    }
  }

  private async sendResponse(id: string | number | undefined, result: unknown): Promise<void> {
    if (id === undefined || !this.transport) {
      return;
    }
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private async sendError(
    id: string | number | undefined,
    code: number,
    message: string
  ): Promise<void> {
    if (id === undefined || !this.transport) {
      return;
    }
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  private async sendNotification(method: string, params: unknown): Promise<void> {
    if (!this.transport) {
      return;
    }
    await this.transport.send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private async handleToolCall(name: string, args: Record<string, unknown> | undefined): Promise<ToolCallResult> {
    const uri = args?.uri as string | undefined;

    try {
      let result: unknown;

      switch (name) {
        case 'jupyter_list_open_notebooks': {
          result = this.jupyterApi.listOpenNotebooks();
          break;
        }

        case 'jupyter_get_notebook': {
          const cells = await this.jupyterApi.getNotebookCells(uri);
          const metadata = await this.jupyterApi.getNotebookMetadata(uri);
          result = { cells, metadata };
          break;
        }

        case 'jupyter_run_cell': {
          const index = args?.index as number;
          if (typeof index !== 'number') {
            throw new Error('Missing required argument: index');
          }
          result = await this.jupyterApi.executeCell(index, uri);
          break;
        }

        case 'jupyter_insert_cell': {
          const idx = args?.index as number;
          const kind = args?.kind as 'code' | 'markdown';
          const source = args?.source as string;
          const language = args?.language as string | undefined;
          if (typeof idx !== 'number' || !kind || typeof source !== 'string') {
            throw new Error('Missing required arguments: index, kind, source');
          }
          result = await this.jupyterApi.insertCell(idx, kind, source, language, uri);
          break;
        }

        case 'jupyter_edit_cell': {
          const editIndex = args?.index as number;
          const editSource = args?.source as string;
          if (typeof editIndex !== 'number' || typeof editSource !== 'string') {
            throw new Error('Missing required arguments: index, source');
          }
          result = await this.jupyterApi.editCell(editIndex, editSource, uri);
          break;
        }

        case 'jupyter_get_variables': {
          result = await this.jupyterApi.getVariables(uri);
          break;
        }

        case 'jupyter_get_errors': {
          result = await this.jupyterApi.getErrorCells(uri);
          break;
        }

        case 'jupyter_restart_kernel': {
          await this.jupyterApi.restartKernel(uri);
          result = { success: true, message: 'Kernel restarted' };
          break;
        }

        case 'jupyter_get_kernel_status': {
          result = await this.jupyterApi.getKernelStatus(uri);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }
}
