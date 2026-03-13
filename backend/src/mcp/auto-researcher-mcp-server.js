const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { createMcpPaperLibraryService } = require('../services/mcp-paper-library.service');

const TOOL_DEFINITIONS = [
  {
    name: 'search_library',
    description: 'Search the Auto Researcher paper library for saved documents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        userId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_document',
    description: 'Get a saved document with processed notes, user notes, reading history, and citation summary.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        userId: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tags',
    description: 'List saved library tags for the current user.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
    },
  },
  {
    name: 'get_document_notes',
    description: 'Fetch processed paper and code notes for a saved document.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        userId: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_user_notes',
    description: 'Fetch personal notes attached to a saved document.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        userId: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_reading_history',
    description: 'Fetch reading history entries for a saved document.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        userId: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'export_citation',
    description: 'Export a citation for a saved document.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        userId: { type: 'string' },
        format: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

function createFixtureService() {
  return {
    async searchLibrary({ query = '' }) {
      return {
        query,
        total: 1,
        items: [
          {
            id: 'document:101',
            documentId: 101,
            title: 'Fixture Diffusion Paper',
            type: 'paper',
            authors: ['Fixture Author'],
            year: '2025',
            venue: 'ICLR',
            tags: ['diffusion'],
            sourceUrl: 'https://example.com/fixture-diffusion',
          },
        ],
      };
    },
    async getDocument({ id }) {
      return {
        id: `document:${id}`,
        documentId: id,
        title: 'Fixture Diffusion Paper',
        type: 'paper',
        tags: ['diffusion'],
        sourceUrl: 'https://example.com/fixture-diffusion',
        processedNotes: {
          paper: '# Summary',
          code: '# Code',
        },
        userNotes: [],
        readingHistory: [],
        citation: {
          authors: ['Fixture Author'],
          date: '2025',
          venue: 'ICLR',
          bibtex: '@article{fixture}',
        },
      };
    },
    async listTags() {
      return { tags: [{ id: 1, name: 'diffusion', color: '#3b82f6' }] };
    },
    async getDocumentNotes({ id }) {
      return {
        id: `document:${id}`,
        documentId: id,
        processedNotes: {
          paper: '# Summary',
          code: '# Code',
        },
      };
    },
    async getUserNotes({ id }) {
      return {
        id: `document:${id}`,
        documentId: id,
        notes: [],
      };
    },
    async getReadingHistory({ id }) {
      return {
        id: `document:${id}`,
        documentId: id,
        history: [],
      };
    },
    async exportCitation({ id, format = 'bibtex' }) {
      return {
        id: `document:${id}`,
        documentId: id,
        format,
        citation: '@article{fixture}',
        metadata: {
          authors: ['Fixture Author'],
          date: '2025',
          venue: 'ICLR',
        },
      };
    },
  };
}

function createToolHandlers(service) {
  return {
    search_library: (args = {}) => service.searchLibrary(args),
    get_document: (args = {}) => service.getDocument(args),
    list_tags: (args = {}) => service.listTags(args),
    get_document_notes: (args = {}) => service.getDocumentNotes(args),
    get_user_notes: (args = {}) => service.getUserNotes(args),
    get_reading_history: (args = {}) => service.getReadingHistory(args),
    export_citation: (args = {}) => service.exportCitation(args),
  };
}

function buildTextResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function createServer(service = createMcpPaperLibraryService()) {
  const server = new Server(
    {
      name: 'auto-researcher-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const handlers = createToolHandlers(service);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const handler = handlers[toolName];

    if (!handler) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${toolName}`,
          },
        ],
      };
    }

    try {
      const payload = await handler(request.params.arguments || {});
      return buildTextResult(payload);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error.message || 'Tool execution failed',
          },
        ],
      };
    }
  });

  return server;
}

async function startServer() {
  const service = process.env.AUTO_RESEARCHER_MCP_TEST_FIXTURE === '1'
    ? createFixtureService()
    : createMcpPaperLibraryService();
  const server = createServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[auto-researcher-mcp] failed to start:', error);
    process.exit(1);
  });
}

module.exports = {
  TOOL_DEFINITIONS,
  createFixtureService,
  createServer,
  createToolHandlers,
  startServer,
};
