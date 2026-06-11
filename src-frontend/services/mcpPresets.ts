// Curated catalog of common MCP servers for one-click setup.
//
// Each preset pre-fills the "Add MCP server" form (name, type, command/url, and
// any required env-var keys). The user supplies the path/token/URL placeholders,
// then connects. stdio presets run a local process; http presets connect to a
// remote MCP endpoint (with OAuth where required). Presets reflect the current
// (2026) maintained servers; legacy/unsafe options are offered as flagged variants.

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

/** An alternate way to run the same logical connector (remote vs Docker vs legacy). */
export interface McpPresetVariant {
  label: string;
  type: McpServerType;
  command?: string;
  url?: string;
  env?: McpEnvField[];
  authRequired?: boolean;
  /** Marks an outdated/discouraged option. */
  deprecated?: boolean;
  /** Security caveat shown as a warning when this option is selected. */
  securityNote?: string;
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
  /** Transport type (the default/recommended option). */
  type: McpServerType;
  /** stdio command line (with placeholders the user edits). */
  command?: string;
  /** http endpoint URL (with placeholders the user edits). */
  url?: string;
  /** Whether the server needs OAuth / auth (http servers). */
  authRequired?: boolean;
  /** Env-var fields to collect for stdio credential-based servers. */
  env?: McpEnvField[];
  /** Security caveat shown as a warning in the form. */
  securityNote?: string;
  /** Marks the default option as outdated/discouraged. */
  deprecated?: boolean;
  /** Alternate run options (remote vs local Docker vs legacy npm, etc.). */
  variants?: McpPresetVariant[];
  /** Link to the server's documentation. */
  docsUrl: string;
}

const GITHUB_PAT: McpEnvField = { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub personal access token', placeholder: 'ghp_…', secret: true };
const GITLAB_ENV: McpEnvField[] = [
  { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'GitLab personal access token', placeholder: 'glpat-…', secret: true },
  { key: 'GITLAB_API_URL', label: 'GitLab API URL', placeholder: 'https://gitlab.com/api/v4' },
];

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
    // Default: the maintained official remote server (OAuth/PAT).
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    authRequired: true,
    docsUrl: 'https://github.com/github/github-mcp-server',
    variants: [
      {
        label: 'Local (Docker)',
        type: 'stdio',
        command: 'docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
        env: [GITHUB_PAT],
      },
      {
        label: 'Legacy npm server (deprecated)',
        type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-github',
        env: [GITHUB_PAT],
        deprecated: true,
        securityNote: 'The npm @modelcontextprotocol/server-github is deprecated; prefer the official remote or Docker server.',
      },
    ],
  },
  {
    key: 'gitlab',
    name: 'GitLab',
    icon: '🦊',
    description: 'Access GitLab projects, issues, and merge requests.',
    // Default: GitLab's in-product HTTP MCP (OAuth).
    type: 'http',
    url: 'https://gitlab.com/api/v4/mcp',
    authRequired: true,
    docsUrl: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/',
    variants: [
      {
        label: 'Legacy npm server (deprecated)',
        type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-gitlab',
        env: GITLAB_ENV,
        deprecated: true,
        securityNote: 'The @modelcontextprotocol/server-gitlab npm server is archived; prefer GitLab’s built-in HTTP MCP.',
      },
    ],
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
    url: 'https://mcp.atlassian.com/v1/mcp/authv2',
    authRequired: true,
    docsUrl: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
  },
  {
    key: 'database',
    name: 'Database (PostgreSQL)',
    icon: '🗄️',
    description: 'Inspect schema and run read-only queries against PostgreSQL.',
    // Default: maintained postgres-mcp (Crystal DBA) in restricted/read-only mode.
    type: 'stdio',
    command: 'uvx postgres-mcp --access-mode=restricted',
    env: [
      { key: 'DATABASE_URI', label: 'PostgreSQL connection URI', placeholder: 'postgresql://user:pass@localhost/db', secret: true },
    ],
    docsUrl: 'https://github.com/crystaldba/postgres-mcp',
    variants: [
      {
        label: 'Archived reference server (discouraged)',
        type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
        deprecated: true,
        securityNote: 'The archived @modelcontextprotocol/server-postgres can be escaped out of its read-only transaction (SQL-injection); use postgres-mcp instead.',
      },
    ],
  },
  {
    key: 'supabase',
    name: 'Supabase',
    icon: '🟢',
    description: 'Manage a Supabase project — DB, edge functions, storage, logs — over OAuth.',
    // Default: project-scoped + read-only (safest). Edit <PROJECT_REF> to your project ref.
    type: 'http',
    url: 'https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>&read_only=true',
    authRequired: true,
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
    variants: [
      {
        label: 'Read-write (project-scoped)',
        type: 'http',
        url: 'https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>',
        authRequired: true,
        securityNote: 'Read-write grants full project access including destructive SQL. Prefer read_only unless you need writes.',
      },
      {
        label: 'All projects (no scope)',
        type: 'http',
        url: 'https://mcp.supabase.com/mcp',
        authRequired: true,
        securityNote: 'No project_ref — the agent can access ALL your Supabase projects. Scope to one project when possible.',
      },
    ],
  },
  {
    key: 'faq',
    name: 'Custom / FAQ knowledge base',
    icon: '❓',
    description: 'Connect any custom MCP server — a FAQ/KB or your own (set URL or command).',
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
