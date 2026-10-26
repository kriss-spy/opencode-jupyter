export function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP port must be an integer between 1 and 65535.');
  }
  return port;
}

export function mcpConfiguration(port: number, version: 'v2' | 'v1' = 'v2') {
  const url = `http://127.0.0.1:${validatePort(port)}/mcp`;
  return version === 'v2'
    ? { $schema: 'https://opencode.ai/config.json', mcp: { servers: {
      'jupyter-vscode': { type: 'remote', url, oauth: false, protocol: 'legacy' },
    } } }
    : { $schema: 'https://opencode.ai/config.json', mcp: {
      'jupyter-vscode': { type: 'remote', url, oauth: false, enabled: true },
    } };
}
