#!/usr/bin/env node
// Minimal spec-compliant MCP stdio server for manual end-to-end testing.
// Exposes one trivial tool: echo({ message }) -> { echo: message }
// Usage: node scripts/fixture-mcp-server.mjs
// Then add a stdio MCP server in Ollama GUI with that command.

import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
const tools = [
  {
    name: 'echo',
    description: 'Returns the message unchanged.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo back.' } },
      required: ['message'],
    },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', line => {
  let req;
  try { req = JSON.parse(line); } catch { return; }

  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '0.0.1' } } });
  } else if (req.method === 'notifications/initialized') {
    // no response for notifications
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools } });
  } else if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    if (name === 'echo') {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify({ echo: args.message }) }] } });
    } else {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    }
  } else {
    if (req.id != null) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } });
    }
  }
});
