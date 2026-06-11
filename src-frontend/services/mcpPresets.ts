// Curated catalog of common MCP servers for one-click setup.
//
// Each preset pre-fills the "Add MCP server" form (name, type, command/url, and
// any required env-var keys). The user supplies the path/token/URL placeholders,
// then connects. stdio presets run a local process; http presets connect to a
// remote MCP endpoint (with OAuth where required).

import { McpServerType } from './mcpConfig';

export interface McpEnvField {
  /** Environment variable name passed to the stdio process. */
  key: string;
  /** Human-friendly label shown in the form. */
  label: string;
  /** Placeholder / example value. */
  placeholder: string;
  /** Mask the value as a secret in the UI. */
  secret?: boolean;
}

export interface McpServerPreset {
  /** Stable catalog key. */
  key: string;
  /** Display name (also pre-fills the server name). */
  name: string;
  /** Emoji icon for the catalog row. */
  icon: string;
  /** Short description of what the server exposes. */
  description: string;
  /** Transport type. */
  type: McpServerType;
  /** stdio command line (with placeholders the user edits). */
  command?: string;
  /** http endpoint URL (with placeholders the user edits). */
  url?: string;
  /** Whether the server needs OAuth / auth (http servers). */
  authRequired?: boolean;
  /** Env-var fields to collect for stdio credential-based servers. */
  env?: McpEnvField[];
  /** Link to the server's documentation. */
  docsUrl: string;
}

export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    key: 'filesystem',
    name: 'Filesystem',
    icon: '📁',
    description: 'Read and write files within a directory you allow.',
    type: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-filesystem /path/to/project',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    key: 'github',
    name: 'GitHub',
    icon: '🐙',
    description: 'Browse repos, issues, PRs, and code on GitHub.',
    type: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-github',
    env: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub personal access token', placeholder: 'ghp_…', secret: true },
    ],
    docsUrl: 'https://github.com/github/github-mcp-server',
  },
  {
    key: 'gitlab',
    name: 'GitLab',
    icon: '🦊',
    description: 'Access GitLab projects, issues, and merge requests.',
    type: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-gitlab',
    env: [
      { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'GitLab personal access token', placeholder: 'glpat-…', secret: true },
      { key: 'GITLAB_API_URL', label: 'GitLab API URL', placeholder: 'https://gitlab.com/api/v4' },
    ],
    docsUrl: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/',
  },
  {
    key: 'jira',
    name: 'Jira (self-hosted token)',
    icon: '📋',
    description: 'Jira issues & projects via the mcp-atlassian server (API token).',
    type: 'stdio',
    command: 'uvx mcp-atlassian',
    env: [
      { key: 'JIRA_URL', label: 'Jira URL', placeholder: 'https://your-org.atlassian.net' },
      { key: 'JIRA_USERNAME', label: 'Jira username/email', placeholder: 'you@example.com' },
      { key: 'JIRA_API_TOKEN', label: 'Jira API token', placeholder: 'ATATT…', secret: true },
    ],
    docsUrl: 'https://github.com/sooperset/mcp-atlassian',
  },
  {
    key: 'atlassian-rovo',
    name: 'Atlassian Rovo (Jira + Confluence)',
    icon: '🧭',
    description: 'Official Atlassian remote MCP — Jira, Confluence & Compass over OAuth.',
    type: 'http',
    url: 'https://mcp.atlassian.com/v1/mcp',
    authRequired: true,
    docsUrl: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
  },
  {
    key: 'database',
    name: 'Database (PostgreSQL)',
    icon: '🗄️',
    description: 'Inspect schema and run read-only queries against PostgreSQL.',
    type: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    key: 'faq',
    name: 'FAQ / Knowledge base',
    icon: '❓',
    description: 'Connect a FAQ / knowledge-base MCP server (set its URL or command).',
    type: 'http',
    url: 'https://your-faq-server.example.com/mcp',
    authRequired: false,
    docsUrl: 'https://modelcontextprotocol.io/examples',
  },
];

/** Look up a preset by its catalog key. */
export function getMcpPreset(key: string): McpServerPreset | undefined {
  return MCP_SERVER_PRESETS.find(p => p.key === key);
}
