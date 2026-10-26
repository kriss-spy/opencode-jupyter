import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { NotebookOperations } from './jupyterApi';
import { imageContent, MAX_OUTPUT_BYTES } from './outputs';

const uri = z.string().min(1).optional().describe('URI from jupyter_list_open_notebooks. Omit only when the target is unambiguous.');
const index = z.number().int().nonnegative().describe('Zero-based cell index.');
const cellId = z.string().min(1).describe('Opaque live cell_id from jupyter_list_cells.');
const base = z.object({ uri }).strict();
interface Definition {
  name: string;
  description: string;
  schema: z.ZodObject;
  readOnly: boolean;
  call: (args: any, signal: AbortSignal) => unknown | Promise<unknown>;
}

export function createToolServer(api: NotebookOperations, version: string): Server {
  const definitions: Definition[] = [
    { name: 'jupyter_list_open_notebooks', description: 'List open Jupyter notebook URIs and cell counts.', schema: z.object({}).strict(), readOnly: true, call: () => api.listOpenNotebooks() },
    { name: 'jupyter_get_notebook', description: 'Read the notebook source, metadata and bounded outputs. Prefer cell tools for targeted work.', schema: base, readOnly: true, call: a => api.getNotebook(a.uri) },
    { name: 'jupyter_run_cell', description: 'Run one code cell and wait for a fresh completion; timeout/cancellation do not interrupt the kernel.', schema: base.extend({ index }), readOnly: false, call: (a, signal) => api.executeCell(a.index, a.uri, signal) },
    { name: 'jupyter_insert_cell', description: 'Insert a code or markdown cell at the given index.', schema: base.extend({ index, kind: z.enum(['code', 'markdown']), source: z.string(), language: z.string().min(1).optional() }), readOnly: false, call: a => api.insertCell(a.index, a.kind, a.source, a.language, a.uri) },
    { name: 'jupyter_edit_cell', description: 'Change cell source in place, preserving cell identity, metadata and existing outputs.', schema: base.extend({ index, source: z.string() }), readOnly: false, call: a => api.editCell(a.index, a.source, a.uri) },
    { name: 'jupyter_get_variables', description: 'Reports unsupported variable inspection when the public Jupyter API cannot provide it.', schema: base, readOnly: true, call: a => api.getVariables(a.uri) },
    { name: 'jupyter_get_errors', description: 'Read cells with failed execution summaries or notebook error outputs.', schema: base, readOnly: true, call: a => api.getErrorCells(a.uri) },
    { name: 'jupyter_restart_kernel', description: 'Requests a targeted kernel restart, or reports unsupported when no public restart API exists.', schema: base, readOnly: false, call: a => api.restartKernel(a.uri) },
    { name: 'jupyter_get_kernel_status', description: 'Return idle/busy from the public Jupyter kernel API, or unknown if unavailable/not started.', schema: base, readOnly: true, call: a => api.getKernelStatus(a.uri) },
    { name: 'jupyter_list_cells', description: 'List bounded cell descriptors without source/output. IDs last only for this open notebook instance; include version on later pages.', schema: base.extend({ offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(500).optional(), version: z.number().int().nonnegative().optional() }), readOnly: true, call: a => api.listCells(a.uri, a.offset, a.limit, a.version) },
    { name: 'jupyter_read_cell_input', description: 'Read one live cell source by opaque cell_id.', schema: base.extend({ cell_id: cellId }), readOnly: true, call: a => api.readCellInput(a.cell_id, a.uri) },
    { name: 'jupyter_read_cell_output', description: 'Read grouped MIME-aware output for one live cell. max_bytes limits aggregate encoded payload (default 256 KiB); images are opt-in.', schema: base.extend({ cell_id: cellId, max_bytes: z.number().int().min(1).max(MAX_OUTPUT_BYTES).optional(), include_images: z.boolean().optional() }), readOnly: true, call: a => api.readCellOutput(a.cell_id, a.uri, a.max_bytes) },
  ];
  const server = new Server({ name: 'opencode-jupyter', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions.map(definition => ({
    name: definition.name, description: definition.description,
    inputSchema: z.toJSONSchema(definition.schema, { target: 'draft-7' }) as Tool['inputSchema'],
    annotations: { readOnlyHint: definition.readOnly, destructiveHint: !definition.readOnly, openWorldHint: false },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    try {
      const definition = definitions.find(value => value.name === request.params.name);
      if (!definition) { throw new Error(`Unknown tool: ${request.params.name}`); }
      const args = definition.schema.parse(request.params.arguments ?? {});
      const result = await definition.call(args, extra.signal);
      const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
      if (definition.name === 'jupyter_read_cell_output' && args.include_images) {
        const output = result as ReturnType<NotebookOperations['readCellOutput']>;
        // Avoid duplicating image payload in both text and image content.
        const images = imageContent(output.outputs);
        if (images.length) {
          const textResult = { ...output, outputs: output.outputs.map(group => ({ ...group,
            items: group.items.map(item => images.some(image => image.mimeType === item.mimeType && image.data === item.data)
              ? { ...item, data: '', delivered_as_image: true } : item) })) };
          content[0] = { type: 'text', text: JSON.stringify(textResult, null, 2) };
          content.push(...images);
        }
      }
      return { content };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
    }
  });
  return server;
}
