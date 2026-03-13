const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('stdio MCP server lists tools and serves search results', async () => {
  const serverEntry = path.resolve(__dirname, '..', 'auto-researcher-mcp-server.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverEntry],
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env: {
      ...process.env,
      AUTO_RESEARCHER_MCP_TEST_FIXTURE: '1',
    },
  });

  const client = new Client({
    name: 'auto-researcher-mcp-test-client',
    version: '1.0.0',
  });

  try {
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, [
      'export_citation',
      'get_document',
      'get_document_notes',
      'get_reading_history',
      'get_user_notes',
      'list_tags',
      'search_library',
    ]);

    const searchResult = await client.callTool({
      name: 'search_library',
      arguments: {
        query: 'diffusion',
        userId: 'czk',
        limit: 5,
      },
    });

    assert.equal(searchResult.content[0].type, 'text');
    const payload = JSON.parse(searchResult.content[0].text);
    assert.equal(payload.items[0].title, 'Fixture Diffusion Paper');
  } finally {
    await client.close();
  }
});
