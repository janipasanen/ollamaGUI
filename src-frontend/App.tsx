import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Message, fetchOllamaChatStream, fetchOllamaModels, pullOllamaModel, deleteOllamaModel, fetchCloudModels, SUGGESTED_MODELS, GenerationOptions, ModelInfo, assembleModelfile, createOllamaModel } from './services/ollama';
import { classifyFit, fitLabel, fitColor, formatBytes, SystemMemory } from './services/modelFit';
import { ChatSession, Folder, Project, storage, searchSessions, orderSessions } from './services/storage';
import { composeSystemPrompt } from './services/systemPrompt';
import {
  MemoryEntry,
  loadMemory, addMemoryEntry, removeMemoryEntry, composeMemoryBlock,
} from './services/memory';
import {
  shouldCompact, compactConversation, makeSummarizeFn,
} from './services/compaction';
import { toolRegistry, registerBuiltInTools, registerCliTool, cliAllowlist, persistCliAllowlist } from './services/tools';
import { agenticChatStream } from './services/agent';
import { McpServerConfig, mcpConfigStore } from './services/mcpConfig';
import { MCP_SERVER_PRESETS, McpServerPreset, McpPresetVariant } from './services/mcpPresets';
import {
  OpenApiServerConfig,
  loadOpenApiServers, saveOpenApiServers,
  registerOpenApiServer, unregisterOpenApiServer,
} from './services/openapiTools';
import {
  CustomTool, FunctionDef,
  loadCustomTools, saveCustomTools, initCustomTools,
  addCustomTool, updateCustomTool, removeCustomTool,
  loadFunctionDefs, saveFunctionDefs,
  addFunctionDef, updateFunctionDef, removeFunctionDef,
  applyFilterInlet, applyFilterOutlet,
  getEnabledActions, runAction,
  STARTER_EXAMPLES,
} from './services/customTools';
import {
  ModelPreset,
  loadPresets, savePresets, addPreset, updatePreset, removePreset,
  loadActivePresetId, setActivePreset, clearActivePreset, getActivePreset, applyPreset,
} from './services/presets';
import {
  ModelConnection, ConnectedModel,
  loadConnections, saveConnections, addConnection, updateConnection, removeConnection,
  fetchAllConnectionModels, streamOpenAiChat,
} from './services/connections';
import { hasSameHostConflict, runManyModels, type ModelGroup } from './services/manyModels';
import { performOAuthFlow } from './services/mcpAuth';
import { mcpServerManager, registerMcpShutdownHandler } from './services/mcp';
import { estimateConversationTokens, estimateTokens, formatTokenCount, formatCost } from './services/tokenEstimate';
import { validateMcpServer, isNonEmptySubmission } from './services/requestValidation';
import {
  MlxAvailability, MlxSettings, DEFAULT_MLX_SETTINGS,
  checkMlxAvailable, loadMlxSettings, saveMlxSettings, applyMlxHierarchy,
  isMlxActive, startMlxServer, stopMlxServer, fetchMlxChatStream,
} from './services/mlx';
import { runCloudBrainLocalWorker } from './services/orchestrator';
import { pickDirectory, appendPathArg, getSystemMemory } from './services/platform';
import { ThemeSettings, DEFAULT_THEME, ACCENTS, loadThemeSettings, saveThemeSettings, resolveDark, applyTheme } from './services/theme';
import { parseSchemaInput, classifyResponse } from './services/structuredOutput';
import {
  ImageGenConfig,
  loadImageGenConfig, saveImageGenConfig,
  generateImage, registerImageGenTool,
} from './services/imagegen';
import {
  SttConfig,
  loadSttConfig, saveSttConfig,
  startDictation, stopDictation, transcribeBlob, checkWhisperAvailable,
} from './services/stt';
import {
  startVoiceCall, defaultSpeak, defaultRecordUtterance,
  type CallState, type VoiceCallHandle,
} from './services/voiceCall';
import {
  VoiceSettings,
  loadVoiceSettings, saveVoiceSettings,
  recognize, speak, stopSpeaking, isSpeechRecognitionAvailable, isTtsAvailable,
} from './services/voice';
import {
  SlashCommand,
  filterCommands, findCommand, runCommand,
  loadUserCommands, addUserCommand, updateUserCommand, removeUserCommand,
} from './services/commands';
import {
  SavedPrompt,
  loadPrompts, addPrompt, updatePrompt, removePrompt,
} from './services/promptLibrary';
import {
  BranchState,
  createBranch, navigateBranch, getForkInfo, getForkPoints,
  emptyBranchState, migrateToBranchState,
} from './services/branching';
import { registerMcpTools, unregisterMcpTools, getRegisteredToolNames } from './services/mcpBridge';
import {
  Artifact,
  detectArtifacts, pickPrimaryArtifact, exportArtifact,
} from './services/artifacts';

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI Error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-100 p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-zinc-400 text-sm font-mono">{(this.state.error as Error).message}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => window.location.reload()} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                Reload
              </button>
              <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm">
                Clear cache &amp; reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Cloud model detection
const isCloudModel = (modelName: string): boolean => {
  const CLOUD_SUFFIXES = ['-cloud', ':cloud'];
  return CLOUD_SUFFIXES.some(suffix => modelName.includes(suffix));
};

const DEFAULT_BASE_URL = 'http://localhost:11434';

// Reusable on/off switch matching the app's toggle styling.
const Toggle: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; dark: boolean; label?: string }> = ({ checked, onChange, disabled, dark, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`relative w-12 h-6 rounded-full transition-colors flex items-center shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${dark ? 'bg-zinc-700' : 'bg-zinc-300'}`}
  >
    <span className={`absolute w-5 h-5 rounded-full transition-transform ${checked ? 'translate-x-6 bg-blue-500' : 'translate-x-1 bg-white'}`} />
  </button>
);

// Renders a ```mermaid block as an SVG diagram (lazy-loads mermaid), with a
// source toggle and a graceful fallback to the raw code on parse errors.
let _mermaidId = 0;
const Mermaid: React.FC<{ code: string; dark: boolean }> = ({ code, dark }) => {
  const [svg, setSvg] = React.useState<string>('');
  const [error, setError] = React.useState(false);
  const [showSource, setShowSource] = React.useState(false);
  const idRef = React.useRef(`mmd-${_mermaidId++}`);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) { setSvg(svg); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [code, dark]);

  if (error) {
    // Invalid diagram → show the raw code rather than crashing.
    return <pre className={`my-2 p-3 rounded-md text-xs overflow-x-auto ${dark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-700'}`}>{code}</pre>;
  }

  return (
    <div className="relative group my-2">
      <button
        onClick={() => setShowSource(s => !s)}
        className={`absolute top-1 right-1 z-10 text-[10px] px-2 py-0.5 rounded transition-opacity opacity-0 group-hover:opacity-100 ${dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}
      >
        {showSource ? 'Diagram' : 'Source'}
      </button>
      {showSource
        ? <pre className={`p-3 rounded-md text-xs overflow-x-auto ${dark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-700'}`}>{code}</pre>
        : <div className="mermaid-diagram overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
};

// Issue 22: standalone component so useState works per code block instance
const CodeBlock: React.FC<{ lang: string; code: string; dark: boolean; props: any }> = React.memo(({ lang, code, dark, props }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group my-2">
      <div className={`flex items-center justify-between px-4 py-1.5 rounded-t-md text-xs ${
        dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-300 text-zinc-600'
      }`}>
        <span className="font-mono">{lang}</span>
        <button
          onClick={handleCopy}
          className={`transition-all px-2 py-0.5 rounded ${
            copied
              ? 'text-green-400'
              : (dark ? 'text-zinc-400 hover:text-zinc-200 opacity-0 group-hover:opacity-100' : 'text-zinc-500 hover:text-zinc-800 opacity-0 group-hover:opacity-100')
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        style={dark ? vscDarkPlus : oneLight}
        language={lang}
        PreTag="div"
        customStyle={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        {...props}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});

// Renders an assistant/user message as markdown with GFM, LaTeX math (KaTeX),
// syntax-highlighted code, and Mermaid diagrams. Exported for isolated testing.
export const MarkdownMessage: React.FC<{ content: string; dark: boolean }> = ({ content, dark }) => (
  <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const lang = (className || '').replace('language-', '') || 'text';
          const code = String(children).replace(/\n$/, '');
          if (!inline) {
            if (lang === 'mermaid') return <Mermaid code={code} dark={dark} />;
            return <CodeBlock lang={lang} code={code} dark={dark} props={props} />;
          }
          return (
            <code className={`px-1 rounded ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const App: React.FC = () => {
  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('llama3');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [systemMemory, setSystemMemory] = useState<SystemMemory | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // Inline session rename (#52)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Transient toast notification (#58 and general feedback)
  const [notification, setNotification] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Organization (#133)
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  // Projects (#92)
  const [projects, setProjects] = useState<Project[]>(() => storage.getProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Memory (#95)
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>(() => loadMemory());
  const [newMemoryText, setNewMemoryText] = useState('');

  // Compaction (#95)
  const [autoCompact, setAutoCompact] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_auto_compact') ?? 'false'); } catch { return false; }
  });
  const [compactionThreshold, setCompactionThreshold] = useState(() => {
    const v = parseInt(localStorage.getItem('ollama_gui_compact_threshold') ?? '3000', 10);
    return isNaN(v) ? 3000 : v;
  });

  // Settings / UI state
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  // Generation options — num_ctx defaults modest for 8 GB machines.
  const [genOptions, setGenOptions] = useState<GenerationOptions>({ num_ctx: 4096 });
  // Structured output (Ollama `format`): JSON mode or a JSON Schema (#148).
  const [structuredOutput, setStructuredOutput] = useState<{ enabled: boolean; schema: string }>({ enabled: false, schema: '' });
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(DEFAULT_BASE_URL);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME);
  // Temporary/incognito chat: held in memory only, never persisted (#134).
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isAgenticMode, setIsAgenticMode] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    command: string;
    cwd?: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // MCP server management state
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [showAddMcpServer, setShowAddMcpServer] = useState(false);
  const [showMcpCatalog, setShowMcpCatalog] = useState(false);
  const [newMcpServer, setNewMcpServer] = useState<{ name: string; type: 'stdio' | 'http'; command: string; url: string; authRequired: boolean; env: { key: string; value: string }[]; note: string }>({
    name: '', type: 'stdio', command: '', url: '', authRequired: false, env: [], note: '',
  });
  const [mcpAuthError, setMcpAuthError] = useState<string | null>(null);

  // OpenAPI tool servers (#129)
  const [openApiServers, setOpenApiServers] = useState<OpenApiServerConfig[]>(() => loadOpenApiServers());
  const [showAddOpenApi, setShowAddOpenApi] = useState(false);
  const [newOpenApi, setNewOpenApi] = useState({ name: '', specUrl: '', apiKey: '', apiKeyHeader: '' });
  const [openApiTestStatus, setOpenApiTestStatus] = useState<Record<string, 'testing' | 'ok' | 'error'>>({});

  // Custom Tools & Functions (#127)
  const [customTools, setCustomTools] = useState<CustomTool[]>(() => loadCustomTools());
  const [functionDefs, setFunctionDefs] = useState<FunctionDef[]>(() => loadFunctionDefs());
  const [showAddCustomTool, setShowAddCustomTool] = useState(false);
  const [showAddFunction, setShowAddFunction] = useState(false);
  const [newCustomTool, setNewCustomTool] = useState({ name: '', description: '', code: 'return { result: params.input };', paramsJson: '{"input":{"type":"string","description":"Input"}}' });
  const [newFunction, setNewFunction] = useState<{ kind: 'filter' | 'action'; name: string; code: string; priority: string }>({ kind: 'filter', name: '', code: '', priority: '100' });

  // Model presets (#124)
  const [presets, setPresets] = useState<ModelPreset[]>(() => loadPresets());
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadActivePresetId());
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPreset, setNewPreset] = useState({ name: '', icon: '', systemPrompt: '', temperature: '', numCtx: '' });

  // Modelfile builder (#125)
  const [modelfileFields, setModelfileFields] = useState({ name: '', system: '', temperature: '', numCtx: '', stop: '', template: '' });
  const [modelfilePreview, setModelfilePreview] = useState('');
  const [modelfileProgress, setModelfileProgress] = useState('');
  const [modelfileError, setModelfileError] = useState('');
  const [isCreatingModel, setIsCreatingModel] = useState(false);

  // Model connections (#123): extra OpenAI-compatible / Ollama endpoints
  const [connections, setConnections] = useState<ModelConnection[]>(() => loadConnections());
  const [connectedModels, setConnectedModels] = useState<ConnectedModel[]>([]);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [newConn, setNewConn] = useState({ name: '', kind: 'openai' as 'openai' | 'ollama', baseUrl: '', apiKey: '' });
  const [connTestStatus, setConnTestStatus] = useState<Record<string, 'testing' | 'ok' | 'error'>>({});

  // Many-models conversation (#126)
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);

  // Image generation (#130)
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenConfig>(() => loadImageGenConfig());

  // Speech-to-text (#131)
  const [sttConfig, setSttConfig] = useState<SttConfig>(() => loadSttConfig());
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [whisperAvailable, setWhisperAvailable] = useState<boolean | null>(null);

  // Prompt library (#97)
  const [prompts, setPrompts] = useState<SavedPrompt[]>(() => loadPrompts());
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');

  // Conversation branching (#98)
  const [branchState, setBranchState] = useState<BranchState>(emptyBranchState());
  // Trunk messages always hold the full canonical history; branchState tracks alternatives
  const trunkMessagesRef = useRef<Message[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  // Artifact canvas (#99)
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactTab, setArtifactTab] = useState<'preview' | 'code'>('preview');
  const [artifactCopied, setArtifactCopied] = useState(false);

  // Slash commands (#96)
  const [commandSuggestions, setCommandSuggestions] = useState<SlashCommand[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [userCommands, setUserCommands] = useState<SlashCommand[]>(() => loadUserCommands());
  const [newCmd, setNewCmd] = useState({ name: '', description: '', template: '' });

  // Web Speech API voice (#101)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Voice call mode (#132)
  const [voiceCallActive, setVoiceCallActive] = useState(false);
  const [voiceCallState, setVoiceCallState] = useState<CallState>('idle');
  const [voiceCallTranscript, setVoiceCallTranscript] = useState('');
  const [voiceCallResponse, setVoiceCallResponse] = useState('');
  const voiceCallHandleRef = useRef<VoiceCallHandle | null>(null);

  // MLX acceleration state (Apple Silicon)
  const [mlxAvailability, setMlxAvailability] = useState<MlxAvailability | null>(null);
  const [mlxSettings, setMlxSettings] = useState<MlxSettings>(DEFAULT_MLX_SETTINGS);

  // Streaming cancel support
  const abortControllerRef = useRef<AbortController | null>(null);

  // Message queue: enqueue prompts while a reply streams; auto-send FIFO (#137).
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const messageQueueRef = useRef<string[]>([]);
  useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);

  // Storage quota warning
  const [storageWarning, setStorageWarning] = useState(false);

  // Model management state
  const [modelPullInput, setModelPullInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState('');
  const [pullError, setPullError] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [lastPullTarget, setLastPullTarget] = useState('');

  // M5: Image attachments (Issue 20)
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derived: filtered sessions for search (Issue 18)
  // Search across title/tags/folder/content, then apply archive + folder filters,
  // ordered pinned-first (#133).
  const filteredSessions = orderSessions(
    searchSessions(sessions, searchQuery, folders)
      .filter(s => (showArchived ? !!s.archived : !s.archived))
      .filter(s => folderFilter === null || s.folderId === folderFilter)
      // Filter by active project (#92): null = no project = show unscoped sessions
      .filter(s => activeProjectId === null ? !s.projectId : s.projectId === activeProjectId)
  );

  const url = (path: string) => `${ollamaBaseUrl}${path}`;

  const refreshModels = useCallback(async () => {
    const availableModels = await fetchOllamaModels(url('/api/tags'));
    const cloudModels = await fetchCloudModels();
    const combined: ModelInfo[] = [
      ...availableModels.map(m => ({ ...m, cloud: isCloudModel(m.name) })), // preserve size/quant
      ...cloudModels,
    ];
    setModels(combined);
    // Fetch extra connection models in parallel (#123)
    fetchAllConnectionModels(loadConnections()).then(setConnectedModels).catch(() => {});
    return combined;
  }, [ollamaBaseUrl]);

  useEffect(() => {
    async function loadInitialData() {
      const savedUrl = localStorage.getItem('ollama_gui_base_url');
      if (savedUrl) setOllamaBaseUrl(savedUrl);

      const savedPrompt = localStorage.getItem('ollama_gui_system_prompt');
      if (savedPrompt) setSystemPrompt(savedPrompt);

      const savedGenOptions = localStorage.getItem('ollama_gui_gen_options');
      if (savedGenOptions) {
        try { setGenOptions(JSON.parse(savedGenOptions)); } catch { /* keep defaults */ }
      }

      const savedStructured = localStorage.getItem('ollama_gui_structured');
      if (savedStructured) {
        try { setStructuredOutput(JSON.parse(savedStructured)); } catch { /* keep defaults */ }
      }

      const ts = loadThemeSettings();
      setThemeSettings(ts);
      setIsDarkMode(resolveDark(ts.mode));
      applyTheme(ts);

      setSessions(storage.getSessions());
      setFolders(storage.getFolders());
      getSystemMemory().then(setSystemMemory).catch(() => setSystemMemory(null));

      // Load persisted MCP servers
      setMcpServers(mcpConfigStore.list());

      // Reap spawned stdio MCP processes when the app window closes (#54)
      registerMcpShutdownHandler();

      // Auto-reconnect HTTP MCP servers that were connected before (#55). Runs in
      // the background so a slow/unreachable server never blocks startup.
      void (async () => {
        for (const cfg of mcpConfigStore.reconnectCandidates()) {
          try {
            const env = await mcpConfigStore.loadSecrets(cfg.id);
            mcpServerManager.addServer({
              id: cfg.id, name: cfg.name, type: cfg.type,
              command: cfg.command, url: cfg.url, env,
              enabled: true, toolsEnabled: true,
            });
            await mcpServerManager.connectToServer(cfg.id);
            mcpConfigStore.markConnected(cfg.id);
            const registeredNames = await registerMcpTools(cfg, true);
            const client = mcpServerManager.getActiveConnection(cfg.id)!;
            const tools = await client.listTools();
            setMcpServers(prev => prev.map(s => s.id === cfg.id ? {
              ...s, status: 'connected',
              tools: tools.map(t => ({ ...t, enabled: registeredNames.includes(`mcp_${cfg.id}_${t.name}`) })),
              errorMessage: undefined,
            } : s));
          } catch {
            // Leave disconnected; the user can reconnect manually.
          }
        }
      })();

      // Load MLX settings + detect availability (graceful no-op if unavailable)
      const loadedMlx = loadMlxSettings();
      setMlxSettings(loadedMlx);
      try {
        const avail = await checkMlxAvailable();
        setMlxAvailability(avail);
        // If MLX is available and full inference was previously enabled, start the server.
        if (avail.available && loadedMlx.fullInference && loadedMlx.localModel) {
          startMlxServer(loadedMlx.localModel, loadedMlx.serverPort).catch(() => {});
        }
      } catch {
        setMlxAvailability(null);
      }

      // Initialize built-in tools and user-defined tools/functions (#127)
      registerBuiltInTools();
      initCustomTools();
      registerImageGenTool(() => loadImageGenConfig());
      // Register spawn_subagent tool (#104) — isolated sub-agent with scoped context
      toolRegistry.registerTool({
        name: 'spawn_subagent',
        description: 'Spawn an isolated sub-agent with a fresh context to complete a focused task. Only the final result returns to the parent context. Depth is bounded to prevent recursion.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task for the sub-agent to complete.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Optional list of tool names to give the sub-agent. Leave empty for all tools.' },
          },
          required: ['task'],
        },
        execute: async (params: { task: string; tools?: string[] }) => {
          let result = '';
          const subMessages: Message[] = [
            { role: 'system', content: 'You are a focused sub-agent. Complete the given task and return only your final answer.' },
            { role: 'user', content: params.task },
          ];
          const gen = agenticChatStream({
            model,
            messages: subMessages,
            maxIterations: 3, // bounded depth
            endpoint: url('/api/chat'),
            toolFilter: params.tools && params.tools.length > 0 ? params.tools : undefined,
            onAssistantMessage: (msg) => { result = msg; },
          });
          for await (const _m of gen) { /* consume */ }
          return { result };
        },
      });
      // Register remember tool (#95) — agent can persist facts across sessions
      toolRegistry.registerTool({
        name: 'remember',
        description: 'Store a fact or preference in persistent memory for future sessions.',
        parameters: { type: 'object', properties: { fact: { type: 'string', description: 'The fact or preference to remember.' } }, required: ['fact'] },
        execute: async (params: { fact: string }) => {
          addMemoryEntry(params.fact);
          setMemoryEntries(loadMemory());
          return { stored: params.fact };
        },
      });
      registerCliTool(async (command: string, cwd?: string) => {
        return new Promise<boolean>((resolve) => {
          setPendingApproval({ command, cwd, resolve });
        });
      });

      try {
        const combined = await refreshModels();
        if (combined.length > 0) setModel(combined[0].name);
      } catch (e) {
        console.error('Failed to load models', e);
      }
    }
    loadInitialData();
  }, []);

  // Keep trunk in sync with messages during normal (non-branch-navigating) operation.
  useEffect(() => {
    const onBranch = branchState.forkNav.some(n => n.activeIndex !== -1);
    if (!onBranch) trunkMessagesRef.current = messages;
  }, [messages, branchState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Focus input on initial load for better accessibility
    if (messages.length === 0) {
      const input = document.getElementById('chat-input');
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }
  }, [messages]);

  // Responsive design - handle window resize
  useEffect(() => {
    const handleResize = () => {
      const mobileBreakpoint = 768; // Typical tablet breakpoint
      const isMobileDevice = window.innerWidth < mobileBreakpoint;
      setIsMobile(isMobileDevice);
      
      // On mobile devices, automatically collapse sidebar for more screen space
      if (isMobileDevice) {
        setIsSidebarOpen(false);
      }
    };

    // Initial check
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const startNewChat = useCallback((projectId?: string | null) => {
    setMessages([]);
    trunkMessagesRef.current = [];
    setBranchState(emptyBranchState());
    setCurrentSessionId(null);
    setAttachedImages([]);
    setInput('');
    setIsTemporary(false);
    setMessageQueue([]);
    if (projectId !== undefined) setActiveProjectId(projectId);
  }, []);

  // Start a temporary chat — messages live only in state, never persisted.
  const startTemporaryChat = useCallback(() => {
    setMessages([]);
    trunkMessagesRef.current = [];
    setBranchState(emptyBranchState());
    setCurrentSessionId(null);
    setAttachedImages([]);
    setInput('');
    setIsTemporary(true);
    setMessageQueue([]);
  }, []);

  // Promote the current temporary chat into a persisted session.
  const saveTemporaryChat = () => {
    if (!isTemporary || messages.length === 0) return;
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: generateTitle(messages),
      messages,
      createdAt: Date.now(),
      model,
    };
    const result = storage.saveSession(newSession);
    if (result.ok === false && result.error === 'quota') setStorageWarning(true);
    setIsTemporary(false);
    setCurrentSessionId(newSession.id);
    setSessions(storage.getSessions());
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
      if (isTyping) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        startNewChat();
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        if (isSettingsOpen) setIsSettingsOpen(false);
        else if (showHelp) setShowHelp(false);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewChat, isSettingsOpen, showHelp]);

  // Update appearance settings: persist, re-apply accent/density, re-resolve dark.
  const updateTheme = (patch: Partial<ThemeSettings>) => {
    setThemeSettings(prev => {
      const next = saveThemeSettings({ ...prev, ...patch });
      setIsDarkMode(resolveDark(next.mode));
      applyTheme(next);
      return next;
    });
  };

  const toggleTheme = () => updateTheme({ mode: isDarkMode ? 'light' : 'dark' });

  // When mode is 'system', track OS light/dark changes live.
  useEffect(() => {
    if (themeSettings.mode !== 'system') return;
    let mq: MediaQueryList;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return; }
    const onChange = () => setIsDarkMode(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeSettings.mode]);

  // Pre-fill the Add-server form from a catalog preset (or one of its variants),
  // then open it for editing.
  const useMcpPreset = (preset: McpServerPreset, variant?: McpPresetVariant) => {
    const src = variant ?? preset;
    setNewMcpServer({
      name: variant ? `${preset.name} (${variant.label})` : preset.name,
      type: src.type,
      command: src.command ?? '',
      url: src.url ?? '',
      authRequired: src.authRequired ?? false,
      env: (src.env ?? []).map(f => ({ key: f.key, value: '' })),
      note: src.securityNote ?? (src.deprecated ? 'This option is deprecated — prefer the default.' : ''),
    });
    setShowMcpCatalog(false);
    setShowAddMcpServer(true);
  };

  const updateSystemPrompt = (val: string) => {
    setSystemPrompt(val);
    localStorage.setItem('ollama_gui_system_prompt', val);
  };

  const updateGenOptions = (patch: Partial<GenerationOptions>) => {
    setGenOptions(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem('ollama_gui_gen_options', JSON.stringify(next));
      return next;
    });
  };

  const updateStructuredOutput = (patch: Partial<{ enabled: boolean; schema: string }>) => {
    setStructuredOutput(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem('ollama_gui_structured', JSON.stringify(next));
      return next;
    });
    setSchemaError(null);
  };

  const updateBaseUrl = (val: string) => {
    setOllamaBaseUrl(val);
    localStorage.setItem('ollama_gui_base_url', val);
  };

  // Update MLX settings: enforce the toggle hierarchy, persist, and manage the
  // MLX server lifecycle (start when full inference turns on, stop when off).
  const updateMlxSettings = (patch: Partial<MlxSettings>) => {
    setMlxSettings(prev => {
      const next = saveMlxSettings(applyMlxHierarchy({ ...prev, ...patch }));
      const available = mlxAvailability?.available ?? false;
      if (available) {
        const wasInference = prev.fullInference;
        const modelChanged = prev.localModel !== next.localModel || prev.serverPort !== next.serverPort;
        if (next.fullInference && (!wasInference || modelChanged) && next.localModel) {
          startMlxServer(next.localModel, next.serverPort).catch(() => {});
        } else if (!next.fullInference && wasInference) {
          stopMlxServer().catch(() => {});
        }
      }
      return next;
    });
  };

  // Model management
  // Pull a model. Pass an explicit name (e.g. from a suggested-model button),
  // otherwise pulls whatever is typed in the input box.
  const handlePullModel = async (explicitModel?: string) => {
    const target = (explicitModel ?? modelPullInput).trim();
    if (!target || isPulling) return;
    setLastPullTarget(target);
    setIsPulling(true);
    setPullingModel(target);
    setPullError(false);
    setPullProgress(`Starting pull: ${target}…`);
    try {
      await pullOllamaModel(target, (p) => {
        const pct = p.total ? ` (${Math.round(((p.completed ?? 0) / p.total) * 100)}%)` : '';
        setPullProgress(`${target}: ${p.status || 'Pulling…'}${pct}`);
      }, url('/api/pull'));
      setPullProgress(`Pull complete: ${target}`);
      if (!explicitModel) setModelPullInput('');
      const updated = await refreshModels();
      // Auto-select the freshly pulled model if nothing valid is selected.
      if (!updated.find(m => m.name === model)) setModel(target);
    } catch (e) {
      setPullProgress(`Error pulling ${target}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setPullError(true);
    } finally {
      setIsPulling(false);
      setPullingModel(null);
    }
  };

  // Show a transient toast that auto-dismisses (#58 and general feedback).
  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(prev => (prev === msg ? null : prev)), 4000);
  };

  const handleDeleteModel = async (modelName: string) => {
    const selectedModel = models.find(m => m.name === modelName);
    if (selectedModel?.cloud) { alert('Cloud models cannot be deleted.'); return; }
    if (!confirm(`Delete ${modelName}?`)) return;
    try {
      await deleteOllamaModel(modelName, url('/api/delete'));
      const updated = await refreshModels();
      // If the deleted model was the active one, auto-switch and tell the user (#58).
      if (model === modelName) {
        const next = updated[0]?.name || 'llama3';
        setModel(next);
        notify(`Model removed — switched to ${next}.`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // Session management
  const loadSession = (session: ChatSession) => {
    const bs = session.branchState ?? migrateToBranchState(session.messages);
    setMessages(session.messages);
    trunkMessagesRef.current = session.messages;
    setBranchState(bs);
    setCurrentSessionId(session.id);
    setModel(session.model);
    setAttachedImages([]);
    setMessageQueue([]);
    setIsTemporary(false);
  };

  // ─── Organization actions (#133) ─────────────────────────────────────────
  const togglePin = (id: string) => {
    const s = sessions.find(x => x.id === id);
    storage.updateSession(id, { pinned: !s?.pinned });
    setSessions(storage.getSessions());
  };
  // Inline rename (#52)
  const startRename = (id: string, currentTitle: string) => {
    setRenamingSessionId(id);
    setRenameDraft(currentTitle);
  };
  const commitRename = () => {
    if (!renamingSessionId) return;
    const title = renameDraft.trim();
    if (title) {
      storage.updateSession(renamingSessionId, { title });
      setSessions(storage.getSessions());
    }
    setRenamingSessionId(null);
    setRenameDraft('');
  };
  const cancelRename = () => {
    setRenamingSessionId(null);
    setRenameDraft('');
  };
  const toggleArchive = (id: string) => {
    const s = sessions.find(x => x.id === id);
    storage.updateSession(id, { archived: !s?.archived });
    setSessions(storage.getSessions());
  };
  const addTagToSession = (id: string) => {
    const tag = window.prompt('Add a tag')?.trim();
    if (!tag) return;
    const s = sessions.find(x => x.id === id);
    storage.updateSession(id, { tags: Array.from(new Set([...(s?.tags ?? []), tag])) });
    setSessions(storage.getSessions());
  };
  const removeTagFromSession = (id: string, tag: string) => {
    const s = sessions.find(x => x.id === id);
    storage.updateSession(id, { tags: (s?.tags ?? []).filter(t => t !== tag) });
    setSessions(storage.getSessions());
  };
  const moveToFolder = (id: string, folderId: string) => {
    storage.updateSession(id, { folderId: folderId || undefined });
    setSessions(storage.getSessions());
  };
  const createFolder = () => {
    const name = window.prompt('Folder name')?.trim();
    if (!name) return;
    storage.saveFolder({ id: `f_${Date.now()}`, name, order: folders.length });
    setFolders(storage.getFolders());
  };
  const removeFolder = (id: string) => {
    storage.deleteFolder(id);
    setFolders(storage.getFolders());
    setSessions(storage.getSessions());
    if (folderFilter === id) setFolderFilter(null);
  };

  const deleteSession = (id: string) => {
    storage.deleteSession(id);
    setSessions(storage.getSessions());
    if (currentSessionId === id) startNewChat();
  };

  const generateTitle = (msgs: Message[]): string => {
    const first = msgs.find(m => m.role === 'user')?.content ?? '';
    if (!first.trim()) return 'New Chat';
    // Use first sentence up to 60 chars, fall back to word boundary truncation
    const sentence = first.split(/[.!?\n]/)[0].trim();
    if (sentence.length > 0 && sentence.length <= 60) return sentence;
    const words = first.split(' ');
    let title = '';
    for (const w of words) {
      if ((title + ' ' + w).trim().length > 55) break;
      title = (title + ' ' + w).trim();
    }
    return title || first.slice(0, 55);
  };

  const saveCurrentSession = (currentMessages: Message[], bs?: BranchState) => {
    if (isTemporary) return; // temporary chats are never written to storage
    const activeBranchState = bs ?? branchState;
    if (currentSessionId === null) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: generateTitle(currentMessages),
        messages: currentMessages,
        createdAt: Date.now(),
        model,
        branchState: activeBranchState,
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
      };
      const result = storage.saveSession(newSession);
      if (result.ok === false && result.error === 'quota') setStorageWarning(true);
      setCurrentSessionId(newSession.id);
      setSessions(storage.getSessions());
    } else {
      const session = storage.getSessions().find(s => s.id === currentSessionId);
      if (session) {
        const result = storage.saveSession({ ...session, messages: currentMessages, branchState: activeBranchState });
        if (result.ok === false && result.error === 'quota') setStorageWarning(true);
        setSessions(storage.getSessions());
      }
    }
  };

  // M5 Issue 19: Export/import conversations
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(storage.getSessions(), null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'ollama_gui_sessions.json';
    a.click();
    URL.revokeObjectURL(href);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported: ChatSession[] = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(imported)) throw new Error('Expected array');
        imported.forEach(s => storage.saveSession(s));
        setSessions(storage.getSessions());
        alert(`Imported ${imported.length} conversation(s).`);
      } catch {
        alert('Invalid session file — expected JSON array of sessions.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Issue 24: helpers for MIME-safe image handling
  // attachedImages / Message.images store full data URLs; API receives only the raw base64 part
  const toApiBase64 = (img: string) => img.startsWith('data:') ? (img.split(',')[1] ?? '') : img;
  const toDisplayUrl = (img: string) => img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;

  // M5 Issue 20: Image attachments
  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxSize = 5 * 1024 * 1024; // 5 MB
    const errors: string[] = [];
    const valid = Array.from(files).filter(file => {
      if (attachedImages.length >= 5) { errors.push('Max 5 images per message.'); return false; }
      if (!allowed.includes(file.type)) { errors.push(`${file.name}: unsupported format (use JPEG, PNG, WebP, or GIF).`); return false; }
      if (file.size > maxSize) { errors.push(`${file.name}: exceeds 5 MB limit.`); return false; }
      return true;
    });
    if (errors.length > 0) alert(errors.join('\n'));
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) setAttachedImages(prev => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const cancelStream = () => {
    abortControllerRef.current?.abort();
  };

  // Send message
  const sendMessage = async (textOverride?: string) => {
    const text = textOverride ?? input;
    if (!text.trim() && attachedImages.length === 0) return;

    // Slash commands (#96) — dispatch before /image special case
    if (text.trimStart().startsWith('/') && !text.trimStart().startsWith('/image ')) {
      const result = runCommand(text.trim());
      if (result.kind === 'builtin') {
        setInput('');
        setCommandSuggestions([]);
        if (result.action === 'clear') { startNewChat(); return; }
        if (result.action === 'help') { setShowHelp(true); return; }
        return;
      }
      if (result.kind === 'prompt') {
        setInput('');
        setCommandSuggestions([]);
        void sendMessage(result.text);
        return;
      }
      if (result.kind === 'unknown') {
        setInput('');
        setCommandSuggestions([]);
        // Unknown slash command — fall through to send as normal message
      }
    }

    // /image <prompt> — generate image directly without LLM (#130)
    if (text.trimStart().startsWith('/image ')) {
      const prompt = text.trimStart().slice('/image '.length).trim();
      if (!prompt) return;
      setInput('');
      setIsLoading(true);
      setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: 'Generating image…' }]);
      try {
        const results = await generateImage({ prompt }, imageGenConfig);
        const imgs = results.map(r => `data:${r.mimeType};base64,${r.image}`);
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Generated image for: "${prompt}"`, images: imgs };
          return copy;
        });
      } catch (e) {
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Image generation failed: ${e instanceof Error ? e.message : String(e)}` };
          return copy;
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // While a reply streams, enqueue user submissions instead of dropping them.
    if (isLoading && textOverride === undefined) {
      setMessageQueue(q => [...q, text]);
      setInput('');
      return;
    }

    // Structured output: validate the schema client-side and build the Ollama `format`.
    let format: 'json' | object | undefined;
    if (structuredOutput.enabled) {
      const parsed = parseSchemaInput(structuredOutput.schema);
      if (!parsed.ok) { setSchemaError(parsed.error ?? 'Invalid schema'); return; }
      setSchemaError(null);
      format = parsed.schema ?? 'json';
    }

    const userMessage: Message = {
      role: 'user',
      content: text,
      ...(attachedImages.length > 0 ? { images: [...attachedImages] } : {}),
    };

    // Strip data-URL prefix before sending — API expects raw base64 only
    const toApiMsg = (m: Message): Message =>
      m.images ? { ...m, images: m.images.map(toApiBase64) } : m;

    // Compose system prompt from all context sources (#92/#93/#95)
    const activeProject = projects.find(p => p.id === activeProjectId);
    const memBlock = composeMemoryBlock(activeProjectId ?? undefined);
    const composedSystem = composeSystemPrompt({
      systemPrompt,
      projectInstructions: activeProject?.instructions,
      memoryBlock: memBlock || undefined,
    });

    // Apply filter inlets before dispatch (#127)
    let rawHistory: Message[] = [
      { role: 'system', content: composedSystem },
      ...messages.map(toApiMsg),
      toApiMsg(userMessage),
    ];

    // Auto-compact when history approaches context limit (#95)
    if (autoCompact && shouldCompact(rawHistory, compactionThreshold)) {
      rawHistory = await compactConversation(rawHistory, {
        thresholdTokens: compactionThreshold,
        summarizeFn: makeSummarizeFn(model, url('/api/chat')),
      });
    }

    const chatHistory = await applyFilterInlet(rawHistory);

    setMessages([...messages, userMessage]);
    if (textOverride === undefined) setInput(''); // keep in-progress typing for queued auto-sends
    setAttachedImages([]);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const isCloudModel = models.some(m => m.name === model && m.cloud);
      const endpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : url('/api/chat');
      const cloudEndpoint = 'https://cloud.ollama.ai/api/chat';
      const mlxActive = !!mlxAvailability && isMlxActive(mlxSettings, mlxAvailability);

      if (mlxAvailability?.available && mlxSettings.cloudBrainLocalWorker && mlxSettings.brainModel && mlxSettings.workerModel) {
        // Multi-agent: cloud model is the brain, local model is the worker.
        let header = '';
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        try {
          await runCloudBrainLocalWorker({
            brainModel: mlxSettings.brainModel,
            workerModel: mlxSettings.workerModel,
            messages: chatHistory,
            ollamaEndpoint: url('/api/chat'),
            cloudEndpoint,
            mlx: { active: mlxActive, port: mlxSettings.serverPort },
            signal: abortControllerRef.current?.signal,
            onPhase: (_phase, label) => {
              header = `_${label}…_\n\n`;
              setMessages(prev => [...prev, { role: 'assistant', content: header }] as Message[]);
            },
            onDelta: (_phase, fullText) => {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { role: 'assistant', content: header + fullText }] as Message[];
                }
                return prev;
              });
            },
          });
          setMessages(prev => { saveCurrentSession(prev); return prev; });
        } catch (e) {
          setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : 'Orchestration failed'}` }] as Message[]);
        }
        setIsLoading(false);
      } else if (mlxActive && !isAgenticMode) {
        // Direct MLX inference (full inference backend).
        let assistantContent = '';
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        try {
          await fetchMlxChatStream(mlxSettings.localModel, chatHistory, (delta) => {
            assistantContent += delta;
            setMessages(prev => {
              const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }] as Message[];
              saveCurrentSession(updated);
              return updated;
            });
          }, mlxSettings.serverPort, { signal: abortControllerRef.current?.signal });
        } catch (streamError) {
          if (abortControllerRef.current?.signal.aborted) {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*(generation cancelled)*' }] as Message[];
              }
              return prev;
            });
          } else {
            setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: `Error: ${streamError instanceof Error ? streamError.message : 'MLX stream failed'} (is the MLX model loaded?)` }] as Message[]);
          }
        }
        setIsLoading(false);
      } else if (isAgenticMode) {
        // Use agentic loop with tool calling
        const agentStream = agenticChatStream({
          model,
          messages: chatHistory,
          endpoint,
          maxIterations: 5,
          options: genOptions,
          format,
          onAssistantMessage: (message) => {
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage.role === 'assistant') {
                const updated = [...prev.slice(0, -1), { role: 'assistant', content: message }] as Message[];
                saveCurrentSession(updated);
                return updated;
              } else {
                const updated = [...prev, { role: 'assistant', content: message }] as Message[];
                saveCurrentSession(updated);
                return updated;
              }
            });
          },
          onToolCall: (toolCall) => {
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: `Calling tool: ${toolCall.function.name}`,
                tool_calls: [toolCall],
              },
            ]);
          },
          onToolResult: (toolResult) => {
            setMessages(prev => [
              ...prev,
              {
                role: 'tool',
                content: toolResult.content,
                name: toolResult.name,
              },
            ]);
          },
          onComplete: () => {
            setIsLoading(false);
          },
          onError: (error) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: `Error: ${error.message}` },
            ]);
            setIsLoading(false);
          },
        });

        for await (const message of agentStream) {
          // Messages are already handled by the callbacks
        }
      } else if (extraModels.length > 0) {
        // Many-models fan-out (#126)
        const allModelIds = [model, ...extraModels];
        const sameHost = hasSameHostConflict(allModelIds, ollamaBaseUrl, connectedModels, connections);
        const groupIndex = messages.length; // user turn index after userMessage is added

        // Initialize group with all pending replies
        const initGroup: ModelGroup = {
          userTurnIndex: groupIndex,
          replies: allModelIds.map(mid => ({
            modelId: mid,
            label: connectedModels.find(m => m.id === mid)?.name ?? mid,
            content: '',
            state: 'pending' as const,
          })),
        };
        setModelGroups(prev => [...prev, initGroup]);

        if (sameHost) {
          setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Memory warning: multiple models share the same Ollama host — running sequentially to avoid OOM.` } as Message]);
        }

        await runManyModels(
          allModelIds,
          chatHistory,
          (modelId, delta, state, error) => {
            setModelGroups(prev => prev.map((g, i) => {
              if (i !== prev.length - 1) return g;
              return {
                ...g,
                replies: g.replies.map(r => r.modelId !== modelId ? r : {
                  ...r,
                  content: state === 'streaming' ? r.content + delta : r.content,
                  state,
                  error,
                }),
              };
            }));
          },
          {
            defaultBaseUrl: ollamaBaseUrl,
            connectedModels,
            connections,
            genOptions,
            signal: abortControllerRef.current?.signal,
            streamOllama: fetchOllamaChatStream as any,
            streamOpenAi: streamOpenAiChat as any,
          }
        );
        setExtraModels([]);
      } else {
        // Route through OpenAI-compatible connection when model belongs to one (#123)
        const connectedModel = connectedModels.find(m => m.id === model);
        const connForModel = connectedModel ? connections.find(c => c.id === connectedModel.connectionId && c.kind === 'openai') : undefined;

        // Use regular chat stream
        let assistantContent = '';
        let streamOk = false;
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
          if (connForModel && connectedModel) {
            // OpenAI-compatible SSE stream (#123)
            await streamOpenAiChat(
              connForModel,
              connectedModel.name,
              chatHistory,
              (delta) => {
                assistantContent += delta;
                setMessages(prev => {
                  const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }] as Message[];
                  saveCurrentSession(updated);
                  return updated;
                });
              },
              { temperature: genOptions?.temperature },
              abortControllerRef.current?.signal
            );
          } else {
          await fetchOllamaChatStream(model, chatHistory, (chunk) => {
            if (chunk.message?.content) {
              assistantContent += chunk.message.content;
              setMessages(prev => {
                const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }] as Message[];
                saveCurrentSession(updated);
                return updated;
              });
            }
          }, endpoint, false, genOptions, abortControllerRef.current?.signal, format);
          }
          streamOk = true;
          // Apply filter outlets after stream completes (#127)
          const filtered = await applyFilterOutlet(assistantContent);
          // Stamp producedByModel (#97) and apply filtered content in one update
          setMessages(prev => {
            const last = prev[prev.length - 1];
            const updatedMsg: Message = { ...last, content: filtered, producedByModel: model };
            const updated = [...prev.slice(0, -1), updatedMsg] as Message[];
            saveCurrentSession(updated);
            return updated;
          });
          // Detect artifacts (#99) and surface in the canvas panel
          const arts = detectArtifacts(filtered);
          const primary = pickPrimaryArtifact(arts);
          if (primary) {
            setCurrentArtifact(primary);
            setShowArtifacts(true);
            setArtifactTab(primary.kind === 'html' || primary.kind === 'svg' ? 'preview' : 'code');
          }
          // Auto-speak after response if enabled (#101)
          if (voiceSettings.autoSpeak && isTtsAvailable() && filtered) {
            speak(filtered, voiceSettings).catch(() => {});
          }
        } catch (streamError) {
          if (abortControllerRef.current?.signal.aborted) {
            // User cancelled — keep partial content, append note
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*(generation cancelled)*' }] as Message[];
              }
              return prev;
            });
          } else {
            // Network/server failure — roll back partial message
            setMessages(prev => {
              const withoutPartial = prev.slice(0, -1);
              return [...withoutPartial, { role: 'assistant', content: `Error: ${streamError instanceof Error ? streamError.message : 'Stream failed'}` }] as Message[];
            });
          }
        }
        setIsLoading(false);
        if (streamOk) void streamOk; // used for future tracking
      }
    } catch (error) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      ]);
      setIsLoading(false);
    } finally {
      // Cancelling the active turn halts the queue (the user resumes/clears it).
      const wasAborted = abortControllerRef.current?.signal.aborted ?? false;
      abortControllerRef.current = null;
      if (!wasAborted && messageQueueRef.current.length > 0) {
        const [next, ...rest] = messageQueueRef.current;
        messageQueueRef.current = rest;
        setMessageQueue(rest);
        setTimeout(() => { void sendMessage(next); }, 0);
      }
    }
  };

  // Local thumbs feedback on an assistant message (#137).
  const setMessageFeedback = (index: number, thumbs: 'up' | 'down') => {
    setMessages(prev => {
      const updated = prev.map((m, i) => {
        if (i !== index || m.role !== 'assistant') return m;
        const existing = m.feedback;
        // Toggle off if the same thumb is clicked again.
        const feedback = existing && existing.thumbs === thumbs
          ? undefined
          : { thumbs, comment: existing?.comment, model, ts: Date.now() };
        return { ...m, feedback };
      });
      saveCurrentSession(updated);
      return updated;
    });
  };

  const removeQueuedMessage = (index: number) => {
    setMessageQueue(q => q.filter((_, i) => i !== index));
  };

  // ─── Conversation branching (#98) ─────────────────────────────────────────
  // Edit a user message at index: save the current tail as a branch, truncate,
  // and re-send the edited content.
  const editMessage = (index: number, newContent: string) => {
    if (isLoading) return;
    const { branch, updated } = createBranch(messages, index, branchState);
    void branch; // stored inside updated
    const newTrunk = messages.slice(0, index);
    trunkMessagesRef.current = newTrunk;
    setBranchState(updated);
    setMessages(newTrunk);
    void sendMessage(newContent);
    saveCurrentSession(newTrunk, updated);
  };

  // Regenerate the last assistant reply: save the current tail starting at the
  // last user message index as a branch, truncate, and re-stream.
  const regenerateMessage = (assistantIndex: number) => {
    if (isLoading) return;
    // Walk back to find the user message that preceded this assistant turn.
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
    if (userIndex < 0) return;
    const { updated } = createBranch(messages, userIndex, branchState);
    const newTrunk = messages.slice(0, userIndex);
    trunkMessagesRef.current = newTrunk;
    setBranchState(updated);
    setMessages(newTrunk);
    void sendMessage(messages[userIndex].content);
    saveCurrentSession(newTrunk, updated);
  };

  // Navigate to the previous or next sibling branch at a fork point.
  const navigateFork = (forkAt: number, direction: 1 | -1) => {
    const { messages: newMsgs, updated } = navigateBranch(
      trunkMessagesRef.current,
      branchState,
      forkAt,
      direction
    );
    setBranchState(updated);
    setMessages(newMsgs);
    saveCurrentSession(newMsgs, updated);
  };

  const dark = isDarkMode;

  return (
    <div className={`flex h-screen font-sans transition-colors duration-300 ${
      dark ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
    }`}>

      {/* Sidebar - Responsive: hidden on mobile by default, toggleable */}
      <div className={`transition-all duration-300 border-r flex flex-col absolute md:relative z-40 ${
        isSidebarOpen ? 'w-64 p-4' : 'w-0 overflow-hidden p-0 border-none'
      } ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'} ${
        isMobile && !isSidebarOpen ? 'hidden' : ''
      }`}>
        <h1 className="text-xl font-bold mb-4">Ollama GUI</h1>

             <button
               onClick={startNewChat}
               aria-label="Start new chat"
               className={`w-full py-2 px-4 rounded-lg transition-colors mb-2 text-sm font-semibold ${
                 dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'
               }`}
             >
               + New Chat
             </button>
             <button
               onClick={startTemporaryChat}
               aria-label="Start temporary chat"
               title="A scratch chat that is never saved to history"
               className={`w-full py-1.5 px-4 rounded-lg transition-colors mb-3 text-xs border ${
                 dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-200'
               }`}
             >
               🕶 Temporary chat
             </button>

        {/* Project switcher (#92) */}
        <div className={`mb-2 rounded-lg border overflow-hidden ${dark ? 'border-zinc-700' : 'border-zinc-300'}`}>
          <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-semibold ${dark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
            <span>📁 Project</span>
            <button onClick={() => setShowAddProject(v => !v)} className="hover:opacity-70">+</button>
          </div>
          <button
            onClick={() => { setActiveProjectId(null); startNewChat(null); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${activeProjectId === null ? (dark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100')}`}
          >🌐 No project</button>
          {projects.map(p => (
            <div key={p.id} className="group/proj flex items-center">
              <button
                onClick={() => { setActiveProjectId(p.id); startNewChat(p.id); }}
                className={`flex-1 text-left px-3 py-1.5 text-xs transition-colors truncate ${activeProjectId === p.id ? (dark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-100')}`}
              >📂 {p.name}</button>
              <button
                onClick={() => {
                  if (confirm(`Delete project "${p.name}"?`)) {
                    storage.deleteProject(p.id);
                    setProjects(storage.getProjects());
                    setSessions(storage.getSessions());
                    if (activeProjectId === p.id) setActiveProjectId(null);
                  }
                }}
                className="opacity-0 group-hover/proj:opacity-100 px-2 text-[10px] text-red-400 hover:text-red-300"
                aria-label={`Delete project ${p.name}`}
              >✕</button>
            </div>
          ))}
          {showAddProject && (
            <div className={`p-2 border-t ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
              <input
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newProjectName.trim()) {
                    const proj: Project = { id: `proj_${Date.now()}`, name: newProjectName.trim(), workspaceRoot: '', instructions: '', createdAt: Date.now() };
                    storage.saveProject(proj);
                    setProjects(storage.getProjects());
                    setNewProjectName('');
                    setShowAddProject(false);
                    setActiveProjectId(proj.id);
                  } else if (e.key === 'Escape') {
                    setShowAddProject(false);
                  }
                }}
                placeholder="Project name…"
                autoFocus
                className={`w-full text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400'}`}
              />
              <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Press Enter to create</p>
            </div>
          )}
        </div>

        {/* M5 Issue 18: Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search conversations..."
          className={`w-full text-xs border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'bg-zinc-100 border-zinc-300 text-zinc-900 placeholder-zinc-400'
          }`}
        />

        {/* Folder chips + archived toggle (#133) */}
        <div className="flex items-center flex-wrap gap-1 mb-2">
          <button
            onClick={() => { setFolderFilter(null); setShowArchived(false); }}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${folderFilter === null && !showArchived ? 'bg-blue-600 text-white border-blue-600' : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
          >All</button>
          {folders.map(f => (
            <button
              key={f.id}
              onClick={() => { setFolderFilter(f.id); setShowArchived(false); }}
              title={`Folder: ${f.name} (long-press the ✕ to delete)`}
              className={`group/folder text-[10px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${folderFilter === f.id ? 'bg-blue-600 text-white border-blue-600' : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
            >
              🗂 {f.name}
              <span onClick={(e) => { e.stopPropagation(); if (confirm(`Delete folder "${f.name}"? Chats stay, just ungrouped.`)) removeFolder(f.id); }} className="opacity-0 group-hover/folder:opacity-100 hover:text-red-300">✕</span>
            </button>
          ))}
          <button onClick={createFolder} className={`text-[10px] px-2 py-0.5 rounded-full border ${dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-200'}`}>+ folder</button>
          <button
            onClick={() => { setShowArchived(v => !v); setFolderFilter(null); }}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${showArchived ? 'bg-amber-600 text-white border-amber-600' : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
          >🗄 Archived</button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          <p className={`text-xs uppercase font-semibold mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {searchQuery ? `Results (${filteredSessions.length})` : showArchived ? 'Archived' : folderFilter ? folders.find(f => f.id === folderFilter)?.name : 'History'}
          </p>
          {filteredSessions.length === 0 && (
            <div className={`text-sm italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {searchQuery ? 'No matches.' : showArchived ? 'No archived chats.' : 'No past conversations.'}
            </div>
          )}
          {filteredSessions.map((s) => (
                   <div
                     key={s.id}
                     onClick={() => loadSession(s)}
                     role="button"
                     tabIndex={0}
                     onKeyDown={(e) => e.key === 'Enter' && loadSession(s)}
                     aria-label={`Load session: ${s.title}`}
                     className={`group p-2 rounded-md cursor-pointer transition-colors ${
                       currentSessionId === s.id
                         ? (dark ? 'bg-zinc-700 text-white' : 'bg-zinc-300 text-zinc-900')
                         : (dark ? 'hover:bg-zinc-700/50 text-zinc-300' : 'hover:bg-zinc-200 text-zinc-600')
                     }`}
                   >
              <div className="flex items-center justify-between">
                {renamingSessionId === s.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename();
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={commitRename}
                    aria-label="Rename conversation"
                    className={`flex-1 text-sm px-1 py-0.5 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                  />
                ) : (
                  <span className="truncate text-sm flex-1">{s.pinned ? '📌 ' : ''}{s.title}</span>
                )}
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); startRename(s.id, s.title); }} title="Rename" aria-label={`Rename session: ${s.title}`} className="p-1 text-xs hover:text-blue-400">✏️</button>
                  <button onClick={(e) => { e.stopPropagation(); togglePin(s.id); }} title={s.pinned ? 'Unpin' : 'Pin'} className="p-1 text-xs hover:text-blue-400">📌</button>
                  <button onClick={(e) => { e.stopPropagation(); addTagToSession(s.id); }} title="Add tag" className="p-1 text-xs hover:text-blue-400">🏷</button>
                  <button onClick={(e) => { e.stopPropagation(); toggleArchive(s.id); }} title={s.archived ? 'Unarchive' : 'Archive'} className="p-1 text-xs hover:text-amber-400">🗄</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} title="Delete" className="p-1 text-xs hover:text-red-400">✕</button>
                </div>
              </div>
              {/* tags + folder controls */}
              {((s.tags && s.tags.length > 0) || folders.length > 0) && (
                <div className="flex items-center flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                  {(s.tags ?? []).map(tag => (
                    <span key={tag} className={`text-[9px] px-1 rounded inline-flex items-center gap-0.5 ${dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}>
                      {tag}<button onClick={() => removeTagFromSession(s.id, tag)} className="hover:text-red-400">×</button>
                    </span>
                  ))}
                  {folders.length > 0 && (
                    <select
                      value={s.folderId ?? ''}
                      onChange={(e) => moveToFolder(s.id, e.target.value)}
                      className={`text-[9px] rounded border bg-transparent ${dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500'} opacity-0 group-hover:opacity-100`}
                    >
                      <option value="">No folder</option>
                      {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div className={`mt-4 space-y-1 border-t pt-3 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
          {/* M5 Issue 19: Export / Import */}
          <div className="flex gap-1">
            <button
              onClick={handleExport}
              className={`flex-1 py-1.5 px-3 text-xs rounded-lg transition-all text-center ${
                dark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
              }`}
            >
              Export
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className={`flex-1 py-1.5 px-3 text-xs rounded-lg transition-all text-center ${
                dark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
              }`}
            >
              Import
            </button>
            <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          </div>

          <button
            onClick={toggleTheme}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              dark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            {dark ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              dark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Main Chat Area - Responsive: full width on mobile, adjusts for sidebar on desktop */}
      <div className={`flex-1 flex flex-col relative overflow-hidden ${
        isMobile && isSidebarOpen ? 'ml-64' : ''
      }`}>
        {/* Header */}
        <header className={`h-14 border-b flex items-center justify-between px-6 transition-colors duration-300 shrink-0 ${
          dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-300 bg-white/50'
        } backdrop-blur-sm`}>
            <div className="flex items-center gap-4">
             <button
               onClick={() => setIsSidebarOpen(prev => !prev)}
               title="Toggle sidebar (Ctrl+\)"
               aria-label="Toggle sidebar"
               className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
             >
               ☰
             </button>
              <select
                value={activePresetId ? `preset:${activePresetId}` : model}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith('preset:')) {
                    const id = val.slice(7);
                    const preset = presets.find(p => p.id === id);
                    if (preset) {
                      applyPreset(preset, { setModel, setSystemPrompt, setGenOptions });
                      setActivePresetId(id);
                      setActivePreset(id);
                    }
                  } else {
                    setModel(val);
                    setActivePresetId(null);
                    clearActivePreset();
                  }
                }}
                aria-label="Select AI model"
                className={`text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                }`}
              >
                {presets.length > 0 && (
                  <optgroup label="— Presets —">
                    {presets.map(p => (
                      <option key={`preset:${p.id}`} value={`preset:${p.id}`}>
                        {p.icon ? `${p.icon} ` : ''}{p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="— Local / Cloud —">
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.cloud ? ' ⛅' : ''}
                    </option>
                  ))}
                </optgroup>
                {/* Extra connection models grouped by connection (#123) */}
                {connections.filter(c => c.enabled).map(conn => {
                  const connModels = connectedModels.filter(m => m.connectionId === conn.id);
                  if (!connModels.length) return null;
                  return (
                    <optgroup key={conn.id} label={`— ${conn.name} —`}>
                      {connModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {models.find(m => m.name === model)?.cloud && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                  ⛅ Cloud
                </span>
              )}
              {isAgenticMode && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                  🤖 Agent
                </span>
              )}
              {mlxAvailability?.available && mlxSettings.cloudBrainLocalWorker && mlxSettings.brainModel && mlxSettings.workerModel && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
                  🧠 Brain·Worker
                </span>
              )}
              {mlxAvailability?.available && (mlxSettings.fullInference || mlxSettings.detectIndicate) && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                  ⚡ MLX{mlxSettings.fullInference ? '' : ' detected'}
                </span>
              )}
             </div>
           <div className="flex items-center gap-3">
             {/* On mobile, show only essential buttons; others go in mobile menu */}
             {!isMobile ? (
               <>
                 <div className={`text-xs font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{ollamaBaseUrl}</div>
                 <button
                   onClick={() => setIsSettingsOpen(prev => !prev)}
                   title="Settings (Ctrl+,)"
                   aria-label="Open settings"
                   className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                 >
                   ⚙️
                 </button>
                 {sttConfig.enabled && (
                   <button
                     onClick={() => {
                       if (voiceCallActive) {
                         voiceCallHandleRef.current?.stop();
                         setVoiceCallActive(false);
                       } else {
                         setVoiceCallActive(true);
                         setVoiceCallTranscript('');
                         setVoiceCallResponse('');
                         const handle = startVoiceCall(
                           {
                             transcribeFn: (blob) => transcribeBlob(blob, sttConfig),
                             speakFn: defaultSpeak,
                             recordUtteranceFn: defaultRecordUtterance,
                             chatFn: async (text, onChunk, signal) => {
                               const history: import('./services/ollama').Message[] = [
                                 { role: 'system', content: systemPrompt },
                                 ...messages,
                                 { role: 'user', content: text },
                               ];
                               let full = '';
                               await import('./services/ollama').then(({ fetchOllamaChatStream }) =>
                                 fetchOllamaChatStream(model, history, (chunk) => {
                                   const delta = chunk.message?.content ?? '';
                                   full += delta;
                                   onChunk(delta);
                                 }, url('/api/chat'), false, {}, signal)
                               );
                               setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: full }]);
                               return full;
                             },
                           },
                           {
                             onStateChange: setVoiceCallState,
                             onTranscript: setVoiceCallTranscript,
                             onResponseChunk: (delta) => setVoiceCallResponse(prev => prev + delta),
                             onResponseComplete: () => setVoiceCallResponse(''),
                             onError: (e) => console.error('Voice call error', e),
                           }
                         );
                         voiceCallHandleRef.current = handle;
                       }
                     }}
                     title={voiceCallActive ? 'End voice call' : 'Start voice call'}
                     aria-label={voiceCallActive ? 'End voice call' : 'Start voice call'}
                     className={`p-2 rounded-md transition-colors ${voiceCallActive ? 'text-red-500 animate-pulse' : dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                   >
                     📞
                   </button>
                 )}
                 {/* Artifact canvas toggle (#99) */}
                 {currentArtifact && (
                   <button
                     onClick={() => setShowArtifacts(v => !v)}
                     title={showArtifacts ? 'Close artifacts panel' : 'Open artifacts panel'}
                     aria-label={showArtifacts ? 'Close artifacts panel' : 'Open artifacts panel'}
                     className={`p-2 rounded-md transition-colors ${showArtifacts ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                   >
                     🖼
                   </button>
                 )}
                 <button
                   onClick={() => setShowHelp(prev => !prev)}
                   title="Keyboard shortcuts (?)"
                   aria-label="Show keyboard shortcuts"
                   className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                 >
                   ❓
                 </button>
               </>
             ) : (
               <button
                 onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                 className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                 title="Menu"
               >
                 ⋯
               </button>
             )}
           </div>
        </header>

        {/* Messages - Responsive: full width on mobile, padded on desktop */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.length === 0 && (
            <div className={`h-full flex items-center justify-center italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              Start a conversation with your local AI.
            </div>
          )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col gap-0.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
               <div className={`group/msg w-full md:max-w-3xl p-4 rounded-2xl ${
                 msg.role === 'user'
                   ? 'bg-blue-600 text-white rounded-tr-none'
                   : msg.role === 'tool'
                     ? (dark ? 'bg-zinc-700 text-zinc-100 rounded-tl-none border-l-2 border-blue-500' : 'bg-zinc-100 text-zinc-900 rounded-tl-none border-l-2 border-blue-500')
                     : (dark ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
               }`}>
                <div className="text-xs font-bold mb-2 opacity-50 uppercase flex items-center gap-1">
                  {msg.role}
                  {msg.role === 'tool' && <span className="text-blue-400">🔧</span>}
                  {/* Per-message model label (#97) */}
                  {msg.role === 'assistant' && msg.producedByModel && (
                    <span className="normal-case font-normal text-[10px] opacity-70 ml-1">{msg.producedByModel}</span>
                  )}
                </div>

                {/* M5 Issue 20: Show attached images */}
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={toDisplayUrl(img)}
                        alt="attachment"
                        className="max-h-48 rounded-lg object-contain border border-white/20"
                      />
                    ))}
                  </div>
                )}

                {/* Tool call rendering */}
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="mb-2 p-2 rounded bg-blue-900/20 border border-blue-500/30">
                    <div className="text-xs font-mono text-blue-300 mb-1">Tool Call</div>
                    {msg.tool_calls.map((toolCall: any, idx: number) => (
                      <div key={idx} className="text-xs font-mono">
                        <span className="text-yellow-300">{toolCall.function.name}</span>(
                        <span className="text-green-300">{toolCall.function.arguments}</span>
                        )
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline edit (#98): show textarea when editing this user message */}
                {editingIndex === i ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          setEditingIndex(null);
                          editMessage(i, editContent);
                        } else if (e.key === 'Escape') {
                          setEditingIndex(null);
                        }
                      }}
                      autoFocus
                      rows={3}
                      className="w-full rounded-lg p-2 text-sm bg-white/20 text-white placeholder-white/50 resize-none focus:outline-none focus:ring-2 focus:ring-white/40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingIndex(null); editMessage(i, editContent); }}
                        className="text-xs px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold"
                      >Send edit</button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20"
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <MarkdownMessage content={msg.content} dark={dark} />
                )}
 
                {/* Issue 23: streaming cursor on last assistant message */}
                {isLoading && i === messages.length - 1 && msg.role === 'assistant' && msg.content === '' && (
                  <div className={`flex items-center gap-1 mt-1 text-sm ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
                  </div>
                )}
                {isLoading && i === messages.length - 1 && msg.role === 'assistant' && msg.content !== '' && (
                  <span className="inline-block w-0.5 h-4 bg-current opacity-75 animate-pulse ml-0.5 align-middle" />
                )}
                {msg.role === 'tool' && (
                  <div className={`text-xs text-blue-400 mt-1 italic`}>
                    Tool execution result
                  </div>
                )}
                {/* Structured-output validity badge (#148) */}
                {msg.role === 'assistant' && msg.content !== '' && structuredOutput.enabled && !(isLoading && i === messages.length - 1) && (() => {
                  const verdict = classifyResponse(msg.content, parseSchemaInput(structuredOutput.schema).schema);
                  return (
                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 ${verdict === 'valid' ? (dark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700') : (dark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')}`}>
                      {verdict === 'valid' ? '✓ valid JSON' : '✗ does not match schema'}
                    </span>
                  );
                })()}
                {/* Thumbs feedback on completed assistant replies (#137) */}
                {msg.role === 'assistant' && msg.content !== '' && !(isLoading && i === messages.length - 1) && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <button
                      onClick={() => setMessageFeedback(i, 'up')}
                      aria-label="Thumbs up"
                      className={`text-xs px-1 rounded transition-colors ${msg.feedback?.thumbs === 'up' ? 'text-green-400' : (dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700')}`}
                    >👍</button>
                    <button
                      onClick={() => setMessageFeedback(i, 'down')}
                      aria-label="Thumbs down"
                      className={`text-xs px-1 rounded transition-colors ${msg.feedback?.thumbs === 'down' ? 'text-red-400' : (dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700')}`}
                    >👎</button>
                    {/* Speak button — per-message TTS (#101) */}
                    {isTtsAvailable() && (
                      <button
                        aria-label={speakingMsgId === `msg-${i}` ? 'Stop speaking' : 'Speak message'}
                        onClick={() => {
                          if (speakingMsgId === `msg-${i}`) {
                            stopSpeaking();
                            setSpeakingMsgId(null);
                          } else {
                            setSpeakingMsgId(`msg-${i}`);
                            speak(msg.content, voiceSettings).then(() => setSpeakingMsgId(null)).catch(() => setSpeakingMsgId(null));
                          }
                        }}
                        className={`text-xs px-1 rounded transition-colors ${speakingMsgId === `msg-${i}` ? 'text-blue-400' : (dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700')}`}
                      >{speakingMsgId === `msg-${i}` ? '⏹' : '🔊'}</button>
                    )}
                    {/* Regenerate button (#98) */}
                    {!isLoading && (
                      <button
                        onClick={() => regenerateMessage(i)}
                        aria-label="Regenerate response"
                        title="Regenerate (creates a branch)"
                        className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                      >↺</button>
                    )}
                    {/* Action function buttons (#127) */}
                    {getEnabledActions().map(action => (
                      <button
                        key={action.id}
                        aria-label={`Action: ${action.name}`}
                        onClick={async () => {
                          const result = await runAction(action.id, msg);
                          if (result) sendMessage(result);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                      >{action.name}</button>
                    ))}
                  </div>
                )}
                {/* Edit button on user messages (#98) */}
                {msg.role === 'user' && !isLoading && editingIndex !== i && (
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => { setEditingIndex(i); setEditContent(msg.content); }}
                      aria-label="Edit message"
                      title="Edit (creates a branch)"
                      className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover/msg:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white/70"
                    >✏ Edit</button>
                  </div>
                )}
               </div>
               {/* Branch navigation row (#98) — shown below the message at fork points */}
               {(() => {
                 const forkPoints = getForkPoints(branchState);
                 if (!forkPoints.includes(i)) return null;
                 const { current, total } = getForkInfo(i, branchState);
                 const label = current === -1 ? `original` : `edit ${current + 1}`;
                 return (
                   <div className={`flex items-center gap-1.5 text-[10px] self-${msg.role === 'user' ? 'end' : 'start'} ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     <button
                       onClick={() => navigateFork(i, -1)}
                       aria-label="Previous branch"
                       className={`px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-700 hover:bg-zinc-700' : 'border-zinc-300 hover:bg-zinc-200'}`}
                     >‹</button>
                     <span>{label} ({current === -1 ? 1 : current + 2}/{total})</span>
                     <button
                       onClick={() => navigateFork(i, 1)}
                       aria-label="Next branch"
                       className={`px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-700 hover:bg-zinc-700' : 'border-zinc-300 hover:bg-zinc-200'}`}
                     >›</button>
                   </div>
                 );
               })()}
             </div>
           ))}

          {/* Many-models reply groups (#126) */}
          {modelGroups.map((group, gi) => (
            <div key={`group-${gi}`} className="mb-4">
              <div className="flex flex-wrap gap-2">
                {group.replies.map((reply, ri) => (
                  <div key={reply.modelId} className={`flex-1 min-w-[220px] rounded-xl border p-3 ${dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-white'}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>{reply.label}</span>
                      {reply.state === 'streaming' && <span className="text-[9px] text-blue-400 animate-pulse">●</span>}
                      {reply.state === 'error' && <span className="text-[9px] text-red-400">✗</span>}
                      {reply.state === 'done' && group.chosenIndex === ri && <span className="text-[9px] text-green-400">✓ chosen</span>}
                    </div>
                    <div className={`text-sm whitespace-pre-wrap ${reply.state === 'error' ? 'text-red-400' : ''}`}>
                      {reply.state === 'error' ? reply.error : reply.content || <span className="opacity-30">Waiting…</span>}
                    </div>
                    {reply.state === 'done' && group.chosenIndex === undefined && (
                      <button
                        onClick={() => {
                          setModelGroups(prev => prev.map((g, i) => i === gi ? { ...g, chosenIndex: ri } : g));
                          setMessages(prev => [...prev, { role: 'assistant', content: reply.content } as Message]);
                        }}
                        className={`mt-2 text-[10px] px-2 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                      >Continue with this</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Queued messages waiting for the current reply to finish (#137) */}
          {messageQueue.map((q, qi) => (
            <div key={`queued-${qi}`} className="flex justify-end mb-2">
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm flex items-center gap-2 border border-dashed ${dark ? 'border-zinc-600 text-zinc-400 bg-zinc-800/40' : 'border-zinc-300 text-zinc-500 bg-zinc-100'}`}>
                <span className="text-[10px] uppercase tracking-wide opacity-70">queued</span>
                <span className="truncate">{q}</span>
                <button onClick={() => removeQueuedMessage(qi)} aria-label="Remove queued message" className="ml-1 hover:text-red-400">✕</button>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Storage quota warning */}
        {storageWarning && (
          <div className="mx-4 mb-2 flex items-center justify-between rounded-lg bg-amber-900/60 border border-amber-700 px-3 py-2 text-xs text-amber-200">
            <span>⚠️ Chat history is nearly full. Export and delete old conversations to free space.</span>
            <button onClick={() => setStorageWarning(false)} className="ml-3 text-amber-400 hover:text-amber-200">✕</button>
          </div>
        )}

        {/* Temporary chat banner (#134) */}
        {isTemporary && (
          <div className={`mx-4 mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs ${dark ? 'bg-purple-900/40 border border-purple-700 text-purple-200' : 'bg-purple-100 border border-purple-300 text-purple-700'}`}>
            <span>🕶 Temporary chat — won't be saved to history.</span>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {messages.length > 0 && (
                <button onClick={saveTemporaryChat} className="px-2 py-0.5 rounded border border-current hover:opacity-80">Save this chat</button>
              )}
              <button onClick={startNewChat} className="px-2 py-0.5 rounded border border-current hover:opacity-80">Discard</button>
            </div>
          </div>
        )}

        {/* Input Area - Responsive: full width on mobile, constrained on desktop */}
        <div className={`p-4 md:p-6 pb-6 pt-2 shrink-0 ${
          dark ? 'bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-transparent' : 'bg-gradient-to-t from-zinc-100 via-zinc-100/80 to-transparent'
        }`}>
          {/* M5 Issue 20: Image thumbnails preview */}
          {attachedImages.length > 0 && (
            <div className="max-w-3xl mx-auto flex flex-wrap gap-2 mb-2">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={img}
                    alt="pending attachment"
                    className="h-16 w-16 object-cover rounded-lg border border-zinc-600"
                  />
                  <button
                    onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-w-3xl mx-auto flex gap-2 relative">
            {/* M5 Issue 20: Attach image button */}
             <button
               onClick={() => fileInputRef.current?.click()}
               title="Attach image"
               aria-label="Attach image"
               className={`px-3 py-3 rounded-xl transition-colors ${
                 dark ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-400' : 'bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-500'
               }`}
             >
               📎
             </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageAttach} />

             {/* Prompt library button (#97) */}
             {prompts.length > 0 && (
               <div className="relative">
                 <button
                   type="button"
                   title="Prompt library"
                   aria-label="Open prompt library"
                   onClick={() => setShowPromptPicker(p => !p)}
                   className={`px-3 py-3 rounded-xl transition-colors ${dark ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-400' : 'bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-500'}`}
                 >📋</button>
                 {showPromptPicker && (
                   <div className={`absolute bottom-full mb-1 left-0 w-56 rounded-xl border shadow-lg overflow-hidden z-20 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                     {prompts.map(p => (
                       <button
                         key={p.id}
                         type="button"
                         onMouseDown={(e) => { e.preventDefault(); setInput(p.body); setShowPromptPicker(false); }}
                         className={`w-full text-left px-3 py-2 text-xs truncate ${dark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-800'}`}
                       >{p.name}</button>
                     ))}
                   </div>
                 )}
               </div>
             )}

             {/* Slash command autocomplete dropdown (#96) */}
             {commandSuggestions.length > 0 && (
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                 {commandSuggestions.map((cmd, idx) => (
                   <button
                     key={cmd.name}
                     type="button"
                     onMouseDown={(e) => {
                       e.preventDefault();
                       const args = input.includes(' ') ? input.slice(input.indexOf(' ') + 1) : '';
                       setInput(`/${cmd.name}${args ? ' ' + args : ' '}`);
                       setCommandSuggestions([]);
                     }}
                     className={`w-full text-left px-3 py-2 text-sm flex gap-2 items-baseline ${
                       idx === selectedSuggestion
                         ? (dark ? 'bg-zinc-700' : 'bg-blue-50')
                         : (dark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50')
                     }`}
                   >
                     <span className={`font-mono font-semibold ${dark ? 'text-blue-400' : 'text-blue-600'}`}>/{cmd.name}</span>
                     <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{cmd.description}</span>
                   </button>
                 ))}
               </div>
             )}
             <input
               id="chat-input"
               type="text"
               value={input}
               onChange={(e) => {
                 const val = e.target.value;
                 setInput(val);
                 // Show slash command suggestions when input starts with /
                 if (val.startsWith('/')) {
                   const query = val.split(' ')[0];
                   const suggestions = filterCommands(query);
                   setCommandSuggestions(suggestions.slice(0, 6));
                   setSelectedSuggestion(0);
                 } else {
                   setCommandSuggestions([]);
                 }
               }}
               onKeyDown={(e) => {
                 if (commandSuggestions.length > 0) {
                   if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSuggestion(s => Math.min(s + 1, commandSuggestions.length - 1)); return; }
                   if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSuggestion(s => Math.max(s - 1, 0)); return; }
                   if (e.key === 'Tab' || (e.key === 'Enter' && commandSuggestions.length > 0)) {
                     e.preventDefault();
                     const cmd = commandSuggestions[selectedSuggestion];
                     const args = input.includes(' ') ? input.slice(input.indexOf(' ') + 1) : '';
                     setInput(`/${cmd.name}${args ? ' ' + args : ' '}`);
                     setCommandSuggestions([]);
                     return;
                   }
                   if (e.key === 'Escape') { setCommandSuggestions([]); return; }
                 }
                 if (e.key === 'Enter' && !e.shiftKey) {
                   e.preventDefault();
                   setCommandSuggestions([]);
                   sendMessage();
                 }
               }}
               placeholder="Message Ollama..."
               aria-label="Type your message here"
               className={`flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                 dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
               }`}
             />
             {/* Many-models extra-model picker (#126) */}
             {[...models, ...connectedModels].length > 1 && (
               <select
                 multiple
                 aria-label="Compare with additional models"
                 value={extraModels}
                 onChange={e => setExtraModels(Array.from(e.target.selectedOptions, o => o.value))}
                 title="Ctrl/Cmd+click to select 1-2 additional models for comparison"
                 className={`hidden sm:block w-28 text-xs border rounded-xl px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-400' : 'bg-white border-zinc-300 text-zinc-600'}`}
                 style={{ height: '3rem' }}
               >
                 {models.filter(m => m.name !== model).map(m => (
                   <option key={m.name} value={m.name}>{m.name}</option>
                 ))}
                 {connectedModels.filter(m => m.id !== model).map(m => (
                   <option key={m.id} value={m.id}>{m.name}</option>
                 ))}
               </select>
             )}
             {extraModels.length > 0 && hasSameHostConflict([model, ...extraModels], ollamaBaseUrl, connectedModels, connections) && (
               <span className={`text-[9px] shrink-0 ${dark ? 'text-amber-400' : 'text-amber-600'}`} title="These models share a local host and will run sequentially">⚠️ seq</span>
             )}
             {isSpeechRecognitionAvailable() && (
               <button
                 type="button"
                 aria-label={isListening ? 'Stop listening' : 'Dictate with microphone'}
                 onClick={async () => {
                   if (isListening) { setIsListening(false); return; }
                   setIsListening(true);
                   try {
                     const text = await recognize();
                     if (text) setInput(prev => prev ? `${prev} ${text}` : text);
                   } catch (e) {
                     console.error('Speech recognition error', e);
                   } finally {
                     setIsListening(false);
                   }
                 }}
                 className={`px-3 py-3 rounded-xl transition-colors text-sm ${
                   isListening
                     ? 'bg-blue-600 hover:bg-blue-500 text-white animate-pulse'
                     : dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'
                 }`}
               >
                 {isListening ? '⏹' : '🎤'}
               </button>
             )}
             {sttConfig.enabled && (
               <button
                 type="button"
                 aria-label={isRecordingAudio ? 'Stop recording' : 'Start dictation'}
                 onClick={async () => {
                   if (isRecordingAudio) {
                     stopDictation();
                     setIsRecordingAudio(false);
                   } else {
                     setIsRecordingAudio(true);
                     try {
                       const blob = await startDictation(sttConfig);
                       const text = await transcribeBlob(blob, sttConfig);
                       if (text) setInput(prev => prev ? `${prev} ${text}` : text);
                     } catch (e) {
                       console.error('STT error', e);
                     } finally {
                       setIsRecordingAudio(false);
                     }
                   }
                 }}
                 className={`px-3 py-3 rounded-xl transition-colors text-sm font-semibold ${
                   isRecordingAudio
                     ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
                     : dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'
                 }`}
               >
                 {isRecordingAudio ? '⏹' : '🎙'}
               </button>
             )}
             {isLoading ? (
               <button
                 onClick={cancelStream}
                 aria-label="Cancel generation"
                 className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl transition-colors font-semibold"
               >
                 Cancel
               </button>
             ) : (
               <button
                 onClick={() => sendMessage()}
                 disabled={isLoading || !isNonEmptySubmission(input, attachedImages.length)}
                 aria-label="Send message"
                 title={!isNonEmptySubmission(input, attachedImages.length) ? 'Type a message or attach an image first' : 'Send message'}
                 className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl transition-colors font-semibold"
               >
                 Send
               </button>
             )}
          </div>
          <div className={`text-center text-[10px] mt-2 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            {(() => {
              const convoTokens = estimateConversationTokens(messages) + (input ? estimateTokens(input) : 0);
              const cost = formatCost(convoTokens);
              return (
                <span title="Approximate token usage for this conversation (and current draft)">
                  ≈ {formatTokenCount(convoTokens)} tokens{cost ? ` · ${cost}` : ''}
                </span>
              );
            })()}
            {' · '}Ollama GUI — Built for speed and privacy. · Cmd+K new chat · ? for shortcuts
          </div>

        {/* Voice Call Overlay (#132) */}
        {voiceCallActive && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-6 p-8 text-white">
            <div className="text-6xl">{voiceCallState === 'listening' ? '🎙' : voiceCallState === 'transcribing' ? '✍️' : voiceCallState === 'responding' ? '🤔' : voiceCallState === 'speaking' ? '🔊' : '📞'}</div>
            <div className={`text-lg font-semibold capitalize ${voiceCallState === 'listening' ? 'text-green-400 animate-pulse' : 'text-zinc-200'}`}>
              {voiceCallState === 'listening' ? 'Listening…' : voiceCallState === 'transcribing' ? 'Transcribing…' : voiceCallState === 'responding' ? 'Thinking…' : voiceCallState === 'speaking' ? 'Speaking…' : voiceCallState}
            </div>
            {voiceCallTranscript && (
              <div className={`max-w-md text-center text-sm rounded-xl px-4 py-2 ${dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-100 text-zinc-800'}`}>
                <span className="text-zinc-400 text-xs block mb-1">You said</span>
                {voiceCallTranscript}
              </div>
            )}
            {voiceCallResponse && (
              <div className={`max-w-md text-center text-sm rounded-xl px-4 py-2 ${dark ? 'bg-blue-900/50 text-blue-100' : 'bg-blue-50 text-blue-900'}`}>
                <span className="text-blue-400 text-xs block mb-1">Assistant</span>
                {voiceCallResponse}
              </div>
            )}
            <div className="flex gap-4">
              <button
                onClick={() => { voiceCallHandleRef.current?.mute ? (voiceCallHandleRef.current.muted ? voiceCallHandleRef.current.unmute() : voiceCallHandleRef.current.mute()) : null; }}
                className="px-5 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm font-semibold"
              >
                {voiceCallHandleRef.current?.muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={() => { voiceCallHandleRef.current?.stop(); setVoiceCallActive(false); setVoiceCallState('idle'); }}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold"
              >
                End Call
              </button>
            </div>
          </div>
        )}

        {/* Settings Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
              </div>

              <div className="space-y-6">
                {/* Appearance (#136) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Appearance</label>
                  <div className="flex items-center gap-2 mb-3">
                    {(['light', 'dark', 'system'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => updateTheme({ mode: m })}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors capitalize ${
                          themeSettings.mode === m
                            ? 'bg-blue-600 text-white border-blue-600'
                            : (dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100')
                        }`}
                      >
                        {m === 'light' ? '☀️ Light' : m === 'dark' ? '🌙 Dark' : '🖥 System'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Accent</span>
                    {Object.entries(ACCENTS).map(([name, hex]) => (
                      <button
                        key={name}
                        onClick={() => updateTheme({ accent: hex })}
                        aria-label={`Accent ${name}`}
                        title={name}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${themeSettings.accent === hex ? 'scale-110 border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Density</span>
                    {(['cozy', 'compact'] as const).map(d => (
                      <button
                        key={d}
                        onClick={() => updateTheme({ density: d })}
                        className={`text-xs px-3 py-1 rounded-lg border transition-colors capitalize ${
                          themeSettings.density === d
                            ? 'bg-blue-600 text-white border-blue-600'
                            : (dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100')
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* M5 Issue 17: Configurable endpoint */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Ollama Endpoint</label>
                  <input
                    type="text"
                    value={ollamaBaseUrl}
                    onChange={(e) => updateBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-colors ${
                      dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                    }`}
                  />
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Change this to connect to a remote Ollama instance.
                  </p>
                  <button
                    onClick={async (e) => {
                      const btn = e.currentTarget;
                      btn.textContent = 'Testing...';
                      btn.disabled = true;
                      const timeout = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Connection timed out after 5 s — is Ollama running?')), 5000)
                      );
                      try {
                        const models = await Promise.race([refreshModels(), timeout]);
                        btn.textContent = `✓ Connected (${models.length} model${models.length !== 1 ? 's' : ''})`;
                        setTimeout(() => { btn.textContent = 'Test connection'; btn.disabled = false; }, 3000);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : 'Unknown error';
                        btn.textContent = `✕ ${msg}`;
                        btn.classList.add('text-red-400');
                        setTimeout(() => { btn.textContent = 'Test connection'; btn.classList.remove('text-red-400'); btn.disabled = false; }, 5000);
                      }
                    }}
                    className={`mt-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                    }`}
                  >
                    Test connection
                   </button>
                 </div>

                 {/* System Prompt */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>System Prompt</label>
                   <textarea
                     value={systemPrompt}
                     onChange={(e) => updateSystemPrompt(e.target.value)}
                     className={`w-full h-28 border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-colors ${
                       dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                     }`}
                     placeholder="Enter the AI's persona..."
                   />
                 </div>

                 {/* Generation options — num_ctx is the key lever on 8 GB machines */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Generation options</label>
                   <div className="grid grid-cols-2 gap-2">
                     <div>
                       <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Context window (num_ctx)</div>
                       <input
                         type="number"
                         min={512}
                         step={512}
                         value={genOptions.num_ctx ?? ''}
                         onChange={(e) => updateGenOptions({ num_ctx: e.target.value === '' ? undefined : Number(e.target.value) })}
                         placeholder="4096"
                         className={`w-full border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'}`}
                       />
                     </div>
                     <div>
                       <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Temperature</div>
                       <input
                         type="number"
                         min={0}
                         max={2}
                         step={0.1}
                         value={genOptions.temperature ?? ''}
                         onChange={(e) => updateGenOptions({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
                         placeholder="model default"
                         className={`w-full border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'}`}
                       />
                     </div>
                   </div>
                   <details className="mt-2">
                     <summary className={`text-[11px] cursor-pointer ${dark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}>
                       Advanced sampling (top_p, top_k, max tokens)
                     </summary>
                     <div className="grid grid-cols-3 gap-2 mt-2">
                       <div>
                         <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>top_p</div>
                         <input
                           type="number" min={0} max={1} step={0.05}
                           value={genOptions.top_p ?? ''}
                           onChange={(e) => updateGenOptions({ top_p: e.target.value === '' ? undefined : Number(e.target.value) })}
                           placeholder="default"
                           aria-label="top_p nucleus sampling"
                           className={`w-full border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'}`}
                         />
                       </div>
                       <div>
                         <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>top_k</div>
                         <input
                           type="number" min={0} step={1}
                           value={genOptions.top_k ?? ''}
                           onChange={(e) => updateGenOptions({ top_k: e.target.value === '' ? undefined : Number(e.target.value) })}
                           placeholder="default"
                           aria-label="top_k sampling"
                           className={`w-full border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'}`}
                         />
                       </div>
                       <div>
                         <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>max tokens</div>
                         <input
                           type="number" min={-1} step={64}
                           value={genOptions.num_predict ?? ''}
                           onChange={(e) => updateGenOptions({ num_predict: e.target.value === '' ? undefined : Number(e.target.value) })}
                           placeholder="default"
                           aria-label="max tokens to generate (num_predict)"
                           className={`w-full border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'}`}
                         />
                       </div>
                     </div>
                   </details>
                   <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     A modest context window (e.g. 4096) avoids swapping/OOM on 8 GB machines. Leave a field blank to use the model default.
                   </p>
                 </div>

                 {/* Structured output (#148) */}
                 <div>
                   <div className="flex items-center justify-between">
                     <div className="min-w-0 pr-3">
                       <div className="text-sm font-medium">Structured output (JSON)</div>
                       <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Constrain replies to valid JSON via Ollama's <code>format</code>. Add a JSON Schema, or leave blank for plain JSON mode.</div>
                     </div>
                     <Toggle dark={dark} label="Structured output"
                       checked={structuredOutput.enabled}
                       onChange={() => updateStructuredOutput({ enabled: !structuredOutput.enabled })} />
                   </div>
                   {structuredOutput.enabled && (
                     <div className="mt-2">
                       <textarea
                         value={structuredOutput.schema}
                         onChange={(e) => updateStructuredOutput({ schema: e.target.value })}
                         placeholder={'{\n  "type": "object",\n  "properties": { "name": { "type": "string" } },\n  "required": ["name"]\n}'}
                         className={`w-full h-28 border rounded-lg p-2 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'} ${schemaError ? 'border-red-500' : ''}`}
                       />
                       {schemaError && <p className="text-[10px] text-red-400 mt-1">⚠️ {schemaError}</p>}
                     </div>
                   )}
                 </div>

                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Agentic Mode</label>
                   <div className="flex items-center gap-3">
                     <span className={`text-sm ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Enable tool calling</span>
                     <button
                       onClick={() => setIsAgenticMode(!isAgenticMode)}
                       className={`relative w-12 h-6 rounded-full transition-colors flex items-center ${dark ? 'bg-zinc-700' : 'bg-zinc-300'}`}
                     >
                       <span className={`absolute w-5 h-5 rounded-full transition-transform ${isAgenticMode ? 'translate-x-6 bg-blue-500' : 'translate-x-1 bg-white'}`} />
                     </button>
                     <span className={`text-sm ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>{isAgenticMode ? 'Enabled' : 'Disabled'}</span>
                   </div>
                   <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     When enabled, the AI can use tools for advanced functionality
                   </p>
                 </div>

                 {/* MLX Acceleration (Apple Silicon) */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>MLX Acceleration</label>
                     <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                       mlxAvailability?.available
                         ? (dark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700')
                         : (dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500')
                     }`}>
                       {mlxAvailability === null ? 'checking…' : mlxAvailability.available ? `available${mlxAvailability.version ? ` · ${mlxAvailability.version}` : ''}` : 'unavailable'}
                     </span>
                   </div>

                   {mlxAvailability && !mlxAvailability.available ? (
                     <p className={`text-[11px] rounded-lg border px-3 py-2 ${dark ? 'border-zinc-700 bg-zinc-900/50 text-zinc-500' : 'border-zinc-200 bg-zinc-50 text-zinc-500'}`}>
                       {mlxAvailability.reason} MLX features are disabled.
                     </p>
                   ) : (
                     <div className={`rounded-lg border p-3 space-y-3 ${dark ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-200 bg-zinc-50'} ${!mlxAvailability?.available ? 'opacity-50' : ''}`}>
                       {/* 1. Full inference backend (master) */}
                       <div>
                         <div className="flex items-center justify-between">
                           <div className="min-w-0 pr-3">
                             <div className="text-sm">Full inference backend</div>
                             <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Route chat through the local MLX server. Enabling this also enables the options below.</div>
                           </div>
                           <Toggle dark={dark} label="Full inference backend"
                             disabled={!mlxAvailability?.available}
                             checked={mlxSettings.fullInference}
                             onChange={() => updateMlxSettings({ fullInference: !mlxSettings.fullInference })} />
                         </div>
                         {mlxSettings.fullInference && (
                           <div className="mt-2 flex gap-2">
                             <input
                               type="text"
                               value={mlxSettings.localModel}
                               onChange={(e) => updateMlxSettings({ localModel: e.target.value })}
                               placeholder="mlx-community/Llama-3.2-3B-Instruct-4bit"
                               className={`flex-1 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                             />
                             <input
                               type="number"
                               value={mlxSettings.serverPort}
                               onChange={(e) => updateMlxSettings({ serverPort: Number(e.target.value) || 8080 })}
                               className={`w-20 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                             />
                           </div>
                         )}
                       </div>

                       {/* 2. Accelerate embeddings / aux */}
                       <div className="flex items-center justify-between">
                         <div className="min-w-0 pr-3">
                           <div className="text-sm">Accelerate embeddings / aux</div>
                           <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Use MLX for embeddings (search, titles). Auto-enabled by full inference.</div>
                         </div>
                         <Toggle dark={dark} label="Accelerate embeddings"
                           disabled={!mlxAvailability?.available || mlxSettings.fullInference}
                           checked={mlxSettings.accelerateEmbeddings}
                           onChange={() => updateMlxSettings({ accelerateEmbeddings: !mlxSettings.accelerateEmbeddings })} />
                       </div>

                       {/* 3. Detect + indicate (base opt-in) */}
                       <div className="flex items-center justify-between">
                         <div className="min-w-0 pr-3">
                           <div className="text-sm">Detect &amp; indicate</div>
                           <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Show the MLX accelerator indicator. Auto-enabled by the options above.</div>
                         </div>
                         <Toggle dark={dark} label="Detect and indicate"
                           disabled={!mlxAvailability?.available || mlxSettings.accelerateEmbeddings || mlxSettings.fullInference}
                           checked={mlxSettings.detectIndicate}
                           onChange={() => updateMlxSettings({ detectIndicate: !mlxSettings.detectIndicate })} />
                       </div>

                       {/* 4. Cloud brain / local worker (multi-agent) */}
                       <div className="pt-1 border-t border-dashed border-zinc-700/50">
                         <div className="flex items-center justify-between pt-2">
                           <div className="min-w-0 pr-3">
                             <div className="text-sm">Cloud brain · local worker</div>
                             <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Multi-agent: a cloud model plans, the local model executes.</div>
                           </div>
                           <Toggle dark={dark} label="Cloud brain local worker"
                             disabled={!mlxAvailability?.available}
                             checked={mlxSettings.cloudBrainLocalWorker}
                             onChange={() => updateMlxSettings({ cloudBrainLocalWorker: !mlxSettings.cloudBrainLocalWorker })} />
                         </div>
                         {mlxSettings.cloudBrainLocalWorker && (
                           <div className="mt-2 grid grid-cols-2 gap-2">
                             <div>
                               <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Brain (cloud)</div>
                               <select
                                 value={mlxSettings.brainModel}
                                 onChange={(e) => updateMlxSettings({ brainModel: e.target.value })}
                                 className={`w-full border rounded px-2 py-1.5 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                               >
                                 <option value="">Select cloud model…</option>
                                 {models.filter(m => m.cloud).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                               </select>
                             </div>
                             <div>
                               <div className={`text-[10px] mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Worker (local)</div>
                               <select
                                 value={mlxSettings.workerModel}
                                 onChange={(e) => updateMlxSettings({ workerModel: e.target.value })}
                                 className={`w-full border rounded px-2 py-1.5 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                               >
                                 <option value="">Select local model…</option>
                                 {mlxSettings.fullInference && mlxSettings.localModel && (
                                   <option value={mlxSettings.localModel}>{mlxSettings.localModel} (MLX)</option>
                                 )}
                                 {models.filter(m => !m.cloud).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                               </select>
                             </div>
                           </div>
                         )}
                       </div>
                     </div>
                   )}
                 </div>

                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Available Tools ({toolRegistry.getAllTools().length})</label>
                   <div className={`rounded-lg border divide-y overflow-hidden max-h-48 overflow-y-auto ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                     {toolRegistry.getAllTools().length === 0 && (
                       <p className={`text-xs p-3 italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No tools available.</p>
                     )}
                     {toolRegistry.getAllTools().map((tool) => {
                       const props = (tool.parameters?.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[] }>;
                       const required = (tool.parameters?.required ?? []) as string[];
                       const paramNames = Object.keys(props);
                       return (
                         <details key={tool.name} className={`${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                           <summary className="flex items-center justify-between px-3 py-2 cursor-pointer list-none">
                             <div className="min-w-0">
                               <div className="font-mono text-xs truncate">{tool.name}</div>
                               <div className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'} truncate`}>{tool.description}</div>
                             </div>
                             <span className="ml-3 text-xs shrink-0 flex items-center gap-1.5">
                               {paramNames.length > 0 && (
                                 <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>{paramNames.length} param{paramNames.length === 1 ? '' : 's'}</span>
                               )}
                               <span className="text-green-400">✓</span>
                             </span>
                           </summary>
                           {paramNames.length > 0 ? (
                             <div className={`px-3 pb-2 space-y-1 ${dark ? 'bg-zinc-800/40' : 'bg-zinc-100/60'}`}>
                               {paramNames.map((name) => {
                                 const p = props[name] || {};
                                 return (
                                   <div key={name} className="text-[11px]">
                                     <span className="font-mono">{name}</span>
                                     <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>
                                       : {p.type || 'any'}{p.enum ? ` (${p.enum.join(' | ')})` : ''}
                                     </span>
                                     {required.includes(name)
                                       ? <span className="text-amber-500 ml-1">required</span>
                                       : <span className={`ml-1 ${dark ? 'text-zinc-600' : 'text-zinc-500'}`}>optional</span>}
                                     {p.description && (
                                       <div className={`ml-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{p.description}</div>
                                     )}
                                   </div>
                                 );
                               })}
                             </div>
                           ) : (
                             <div className={`px-3 pb-2 text-[11px] italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No parameters.</div>
                           )}
                         </details>
                       );
                     })}
                   </div>
                 </div>

                {/* Model Connections — OpenAI-compatible endpoints (#123) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Connections ({connections.length})</label>
                    <button onClick={() => setShowAddConnection(v => !v)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}>
                      {showAddConnection ? 'Cancel' : '+ Add'}
                    </button>
                  </div>
                  {showAddConnection && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                      <div className="flex gap-1.5">
                        <select value={newConn.kind} onChange={e => setNewConn(v => ({ ...v, kind: e.target.value as 'openai' | 'ollama' }))}
                          className={`border rounded px-2 py-1 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}>
                          <option value="openai">OpenAI-compat</option>
                          <option value="ollama">Ollama</option>
                        </select>
                        <input placeholder="Name (e.g. LM Studio)" value={newConn.name} onChange={e => setNewConn(v => ({ ...v, name: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      </div>
                      <input placeholder="Base URL (e.g. http://localhost:1234)" value={newConn.baseUrl} onChange={e => setNewConn(v => ({ ...v, baseUrl: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      {newConn.kind === 'openai' && (
                        <input placeholder="API key (optional)" value={newConn.apiKey} onChange={e => setNewConn(v => ({ ...v, apiKey: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      )}
                      <button onClick={() => {
                        if (!newConn.name.trim() || !newConn.baseUrl.trim()) return;
                        const conn = addConnection({ name: newConn.name.trim(), kind: newConn.kind, baseUrl: newConn.baseUrl.trim(), apiKey: newConn.apiKey.trim() || undefined, enabled: true });
                        const updated = loadConnections();
                        setConnections(updated);
                        fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {});
                        setNewConn({ name: '', kind: 'openai', baseUrl: '', apiKey: '' });
                        setShowAddConnection(false);
                        void conn;
                      }} className="w-full text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Add Connection</button>
                    </div>
                  )}
                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {connections.length === 0
                      ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No extra connections. Add an OpenAI-compatible (LM Studio, llama.cpp) or a second Ollama host.</p>
                      : connections.map(conn => {
                        const modelCount = connectedModels.filter(m => m.connectionId === conn.id).length;
                        return (
                          <div key={conn.id} className={`flex items-center gap-2 px-3 py-2 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conn.enabled ? 'bg-green-400' : 'bg-zinc-500'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium truncate">{conn.name}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>{conn.kind}</span>
                              </div>
                              <div className={`text-[10px] truncate font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{conn.baseUrl} {modelCount > 0 ? `· ${modelCount} model${modelCount !== 1 ? 's' : ''}` : ''}</div>
                              {connTestStatus[conn.id] && (
                                <div className={`text-[10px] ${connTestStatus[conn.id] === 'ok' ? 'text-green-400' : connTestStatus[conn.id] === 'error' ? 'text-red-400' : 'text-zinc-400'}`}>
                                  {connTestStatus[conn.id] === 'testing' ? 'Fetching models…' : connTestStatus[conn.id] === 'ok' ? `✓ ${modelCount} model${modelCount !== 1 ? 's' : ''} found` : '✗ Could not fetch models'}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={async () => {
                                setConnTestStatus(s => ({ ...s, [conn.id]: 'testing' }));
                                const all = loadConnections();
                                const fresh = await fetchAllConnectionModels(all);
                                setConnectedModels(fresh);
                                const count = fresh.filter(m => m.connectionId === conn.id).length;
                                setConnTestStatus(s => ({ ...s, [conn.id]: count > 0 ? 'ok' : 'error' }));
                              }} className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>
                                {connTestStatus[conn.id] === 'testing' ? '…' : 'Test'}
                              </button>
                              <button onClick={() => {
                                const updated = connections.map(c => c.id === conn.id ? { ...c, enabled: !c.enabled } : c);
                                saveConnections(updated); setConnections(updated);
                                fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {});
                              }} className={`text-[10px] px-1.5 py-0.5 rounded border ${conn.enabled ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600') : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}>
                                {conn.enabled ? 'On' : 'Off'}
                              </button>
                              <button onClick={() => { removeConnection(conn.id); const updated = loadConnections(); setConnections(updated); fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {}); }}
                                className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}>✕</button>
                            </div>
                          </div>
                        );
                      })
                    }
                  </div>
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Models from extra connections appear in the model selector grouped by connection.
                  </p>
                </div>

                {/* MCP Servers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      MCP Servers ({mcpServers.length})
                    </label>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { setShowMcpCatalog(v => !v); setShowAddMcpServer(false); }}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          showMcpCatalog
                            ? (dark ? 'border-blue-600 text-blue-400' : 'border-blue-500 text-blue-600')
                            : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100')
                        }`}
                      >
                        {showMcpCatalog ? 'Close' : '📚 Catalog'}
                      </button>
                      <button
                        aria-label="Add MCP server"
                        onClick={() => { setShowAddMcpServer(v => !v); setShowMcpCatalog(false); }}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        {showAddMcpServer ? 'Cancel' : '+ Add'}
                      </button>
                    </div>
                  </div>

                  {/* MCP server catalog — one-click presets */}
                  {showMcpCatalog && (
                    <div className={`rounded-lg border divide-y mb-2 overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700 bg-zinc-900/50' : 'border-zinc-200 divide-zinc-200 bg-zinc-50'}`}>
                      {MCP_SERVER_PRESETS.map(preset => (
                        <div key={preset.key} className={`px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-100'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 pr-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{preset.icon}</span>
                                <span className="text-xs font-medium truncate">{preset.name}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>{preset.type}</span>
                                {preset.authRequired && (
                                  <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>OAuth</span>
                                )}
                                {preset.deprecated && (
                                  <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700'}`}>deprecated</span>
                                )}
                              </div>
                              <div className={`text-[10px] mt-0.5 truncate ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{preset.description}</div>
                            </div>
                            <button
                              onClick={() => useMcpPreset(preset)}
                              aria-label={`Use ${preset.name} preset`}
                              className="shrink-0 text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                            >
                              Use
                            </button>
                          </div>
                          {preset.variants && preset.variants.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5 pl-5">
                              {preset.variants.map(v => (
                                <button
                                  key={v.label}
                                  onClick={() => useMcpPreset(preset, v)}
                                  aria-label={`Use ${preset.name} variant ${v.label}`}
                                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                    v.deprecated
                                      ? (dark ? 'border-red-800 text-red-300 hover:bg-red-900/30' : 'border-red-300 text-red-600 hover:bg-red-50')
                                      : (dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100')
                                  }`}
                                >
                                  {v.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <p className={`text-[10px] px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Presets pre-fill the form — edit paths/tokens, then Add Server.
                      </p>
                    </div>
                  )}

                  {showAddMcpServer && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                      {newMcpServer.note && (
                        <div className={`flex items-start gap-2 rounded px-2 py-1.5 text-[10px] ${dark ? 'bg-red-900/30 border border-red-800 text-red-300' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                          <span>⚠️</span><span>{newMcpServer.note}</span>
                        </div>
                      )}
                      <input
                        placeholder="Server name"
                        value={newMcpServer.name}
                        onChange={e => setNewMcpServer(s => ({ ...s, name: e.target.value }))}
                        className={`w-full border rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      />
                      <div className="flex gap-2">
                        <select
                          value={newMcpServer.type}
                          onChange={e => setNewMcpServer(s => ({ ...s, type: e.target.value as 'stdio' | 'http' }))}
                          className={`border rounded px-2 py-1.5 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        >
                          <option value="stdio">stdio</option>
                          <option value="http">HTTP</option>
                        </select>
                        {newMcpServer.type === 'stdio' ? (
                          <>
                            <input
                              placeholder="Command (e.g. npx my-mcp-server)"
                              value={newMcpServer.command}
                              onChange={e => setNewMcpServer(s => ({ ...s, command: e.target.value }))}
                              className={`flex-1 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                            />
                            <button
                              onClick={async () => {
                                const dir = await pickDirectory();
                                if (dir) setNewMcpServer(s => ({ ...s, command: appendPathArg(s.command, dir) }));
                              }}
                              title="Add an allowed directory"
                              aria-label="Browse for a directory"
                              className={`shrink-0 text-xs px-2 py-1.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                            >
                              📂
                            </button>
                          </>
                        ) : (
                          <input
                            placeholder="URL (e.g. https://mcp.example.com)"
                            value={newMcpServer.url}
                            onChange={e => setNewMcpServer(s => ({ ...s, url: e.target.value }))}
                            className={`flex-1 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                          />
                        )}
                      </div>

                      {/* Environment variables (credentials) for stdio servers */}
                      {newMcpServer.type === 'stdio' && (
                        <div className="space-y-1.5">
                          {newMcpServer.env.map((pair, idx) => (
                            <div key={idx} className="flex gap-1.5">
                              <input
                                placeholder="ENV_KEY"
                                value={pair.key}
                                onChange={e => setNewMcpServer(s => ({ ...s, env: s.env.map((p, i) => i === idx ? { ...p, key: e.target.value } : p) }))}
                                className={`w-2/5 border rounded px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                              />
                              <input
                                placeholder="value"
                                type="password"
                                value={pair.value}
                                onChange={e => setNewMcpServer(s => ({ ...s, env: s.env.map((p, i) => i === idx ? { ...p, value: e.target.value } : p) }))}
                                className={`flex-1 border rounded px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                              />
                              <button
                                onClick={() => setNewMcpServer(s => ({ ...s, env: s.env.filter((_, i) => i !== idx) }))}
                                className="text-red-400 hover:text-red-300 text-xs px-1"
                                aria-label="Remove env var"
                              >✕</button>
                            </div>
                          ))}
                          <button
                            onClick={() => setNewMcpServer(s => ({ ...s, env: [...s.env, { key: '', value: '' }] }))}
                            className={`text-[10px] px-2 py-0.5 rounded border ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                          >
                            + Env var
                          </button>
                        </div>
                      )}

                      <button
                        onClick={async () => {
                              // Centralized validation: name, http(s)-scheme URLs, and
                              // injection-free stdio commands (#36/#31).
                              const check = validateMcpServer({
                                name: newMcpServer.name,
                                type: newMcpServer.type,
                                command: newMcpServer.command,
                                url: newMcpServer.url,
                              });
                              if (!check.valid) {
                                alert(check.error);
                                return;
                              }

                              // Collect non-empty env pairs into a record (stdio only).
                              const envEntries = newMcpServer.env
                                .filter(p => p.key.trim() && p.value.trim())
                                .map(p => [p.key.trim(), p.value] as [string, string]);
                              const env = newMcpServer.type === 'stdio' && envEntries.length
                                ? Object.fromEntries(envEntries)
                                : undefined;

                              const server: McpServerConfig = {
                                id: mcpConfigStore.generateId(),
                                name: newMcpServer.name.trim(),
                                type: newMcpServer.type,
                                command: newMcpServer.type === 'stdio' ? newMcpServer.command.trim() : undefined,
                                url: newMcpServer.type === 'http' ? newMcpServer.url.trim() : undefined,
                                env,
                                status: 'disconnected',
                                tools: [],
                                authRequired: newMcpServer.type === 'http' ? newMcpServer.authRequired : false,
                                authenticated: false,
                              };
                          await mcpConfigStore.save(server);
                          setMcpServers(mcpConfigStore.list());
                          setNewMcpServer({ name: '', type: 'stdio', command: '', url: '', authRequired: false, env: [], note: '' });
                          setShowAddMcpServer(false);
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded font-semibold transition-colors"
                      >
                        Add Server
                      </button>
                    </div>
                  )}

                  {mcpAuthError && (
                    <p className="text-xs text-red-400 mb-2">{mcpAuthError}</p>
                  )}

                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {mcpServers.length === 0 && (
                      <p className={`text-xs p-3 italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        No MCP servers configured.
                      </p>
                    )}
                    {mcpServers.map(server => (
                      <div key={server.id} className={`px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              server.status === 'connected' ? 'bg-green-400' :
                              server.status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                              server.status === 'error' ? 'bg-red-400' : 'bg-zinc-500'
                            }`} />
                            <span className="font-mono text-xs truncate">{server.name}</span>
                            <span className={`text-[10px] px-1 rounded ${dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>
                              {server.type}
                            </span>
                          </div>
                           <div className="flex items-center gap-1 shrink-0 ml-2">
                             <button
                               onClick={async () => {
                                 try {
                                   setMcpServers(prev =>
                                     prev.map(s => s.id === server.id ? { ...s, status: 'connecting' } : s)
                                   );

                                   // Rehydrate secret env values from the keychain just-in-time.
                                   const env = await mcpConfigStore.loadSecrets(server.id);
                                   // Ensure server is registered in the manager before connecting
                                   mcpServerManager.addServer({
                                     id: server.id, name: server.name, type: server.type,
                                     command: server.command, url: server.url, env,
                                     enabled: true, toolsEnabled: true,
                                   });

                                   await mcpServerManager.connectToServer(server.id);
                                   // Record connection time so this server auto-reconnects next launch (#55)
                                   mcpConfigStore.markConnected(server.id);
                                   // Register MCP tools via service bridge (#102)
                                   const registeredNames = await registerMcpTools(server, server.toolsEnabled !== false);
                                   const client = mcpServerManager.getActiveConnection(server.id)!;
                                   const tools = await client.listTools();

                                   setMcpServers(prev =>
                                     prev.map(s => s.id === server.id ? {
                                       ...s,
                                       status: 'connected',
                                       tools: tools.map(t => ({ ...t, enabled: registeredNames.includes(`mcp_${server.id}_${t.name}`) })),
                                       errorMessage: undefined,
                                     } : s)
                                   );
                                  } catch (e) {
                                    const errorMsg = e instanceof Error ? e.message : 'Connection failed';
                                    const friendlyMessage = errorMsg.includes('failed') ? 
                                      `Connection error: ${errorMsg}. Please check server URL and try again.` :
                                      `Connection error: ${errorMsg}`;
                                    setMcpServers(prev =>
                                      prev.map(s => s.id === server.id ? {
                                        ...s,
                                        status: 'error',
                                        errorMessage: friendlyMessage
                                      } : s)
                                    );
                                  }
                               }}
                               className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                 server.status === 'connected'
                                   ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600')
                                   : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100')
                               }`}
                               title={server.status === 'connected' ? 'Connected' : 'Connect to server'}
                             >
                               {server.status === 'connected' ? '🔗' : 'Connect'}
                             </button>
                             {server.type === 'http' && (
                               <button
                                 onClick={async () => {
                                   setMcpAuthError(null);
                                   try {
                                     await performOAuthFlow(server.id, server.url!);
                                     setMcpServers(prev =>
                                       prev.map(s => s.id === server.id ? { ...s, authenticated: true } : s)
                                     );
                                   } catch (e) {
                                     setMcpAuthError(e instanceof Error ? e.message : 'Auth failed');
                                   }
                                 }}
                                 className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                   server.authenticated
                                     ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600')
                                     : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100')
                                 }`}
                                 title={server.authenticated ? 'Authenticated' : 'Authenticate with OAuth'}
                               >
                                 {server.authenticated ? '🔑 auth' : 'Auth'}
                               </button>
                             )}
                             <button
                               onClick={async () => {
                                 // Unregister tools and disconnect via bridge (#102)
                                 const existing = mcpServers.find(s => s.id === server.id);
                                 if (existing) {
                                   unregisterMcpTools(server.id, getRegisteredToolNames(existing));
                                 }
                                 await mcpServerManager.disconnectFromServer(server.id);
                                 await mcpConfigStore.delete(server.id);
                                 setMcpServers(mcpConfigStore.list());
                               }}
                               className="text-red-400 hover:text-red-300 text-xs px-1"
                             >
                               ✕
                             </button>
                           </div>
                        </div>
                        {server.status === 'error' && server.errorMessage && (
                          <p className="text-[10px] text-red-400 mt-1 truncate">{server.errorMessage}</p>
                        )}
                        {server.tools.length > 0 && (
                          <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            {server.tools.filter(t => t.enabled).length}/{server.tools.length} tools enabled
                          </p>
                        )}
                        {server.status !== 'connected' && server.lastConnected && (
                          <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                            Last connected {new Date(server.lastConnected).toLocaleString()} — use Connect to reconnect.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                   <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     Manage MCP servers for tool discovery and remote execution.
                   </p>
                </div>

                {/* OpenAPI Tool Servers (#129) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      OpenAPI Servers ({openApiServers.length})
                    </label>
                    <button
                      onClick={() => setShowAddOpenApi(v => !v)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                    >
                      {showAddOpenApi ? 'Cancel' : '+ Add'}
                    </button>
                  </div>

                  {showAddOpenApi && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                      <input
                        type="text"
                        placeholder="Name (e.g. My REST API)"
                        value={newOpenApi.name}
                        onChange={e => setNewOpenApi(v => ({ ...v, name: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      />
                      <input
                        type="url"
                        placeholder="Spec URL (https://…/openapi.json)"
                        value={newOpenApi.specUrl}
                        onChange={e => setNewOpenApi(v => ({ ...v, specUrl: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      />
                      <input
                        type="text"
                        placeholder="API key (optional)"
                        value={newOpenApi.apiKey}
                        onChange={e => setNewOpenApi(v => ({ ...v, apiKey: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      />
                      <input
                        type="text"
                        placeholder="API key header (default: Authorization)"
                        value={newOpenApi.apiKeyHeader}
                        onChange={e => setNewOpenApi(v => ({ ...v, apiKeyHeader: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      />
                      <button
                        onClick={async () => {
                          if (!newOpenApi.name.trim() || !newOpenApi.specUrl.trim()) return;
                          const cfg: OpenApiServerConfig = {
                            id: crypto.randomUUID(),
                            name: newOpenApi.name.trim(),
                            specUrl: newOpenApi.specUrl.trim(),
                            apiKey: newOpenApi.apiKey.trim() || undefined,
                            apiKeyHeader: newOpenApi.apiKeyHeader.trim() || undefined,
                            enabled: true,
                          };
                          const updated = [...openApiServers, cfg];
                          setOpenApiServers(updated);
                          saveOpenApiServers(updated);
                          registerOpenApiServer(cfg).catch(() => {});
                          setNewOpenApi({ name: '', specUrl: '', apiKey: '', apiKeyHeader: '' });
                          setShowAddOpenApi(false);
                        }}
                        className="w-full text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                      >
                        Add Server
                      </button>
                    </div>
                  )}

                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {openApiServers.length === 0 ? (
                      <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No OpenAPI servers added.</p>
                    ) : openApiServers.map(srv => (
                      <div key={srv.id} className={`flex items-center justify-between gap-2 px-3 py-2 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${srv.enabled ? 'bg-green-400' : 'bg-zinc-500'}`} />
                            <span className="text-xs font-medium truncate">{srv.name}</span>
                          </div>
                          <div className={`text-[10px] truncate mt-0.5 font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{srv.specUrl}</div>
                          {openApiTestStatus[srv.id] && (
                            <div className={`text-[10px] mt-0.5 ${openApiTestStatus[srv.id] === 'ok' ? 'text-green-400' : openApiTestStatus[srv.id] === 'error' ? 'text-red-400' : 'text-zinc-400'}`}>
                              {openApiTestStatus[srv.id] === 'testing' ? 'Testing…' : openApiTestStatus[srv.id] === 'ok' ? '✓ Spec loaded' : '✗ Failed to fetch spec'}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={async () => {
                              setOpenApiTestStatus(s => ({ ...s, [srv.id]: 'testing' }));
                              try {
                                await registerOpenApiServer(srv);
                                setOpenApiTestStatus(s => ({ ...s, [srv.id]: 'ok' }));
                              } catch {
                                setOpenApiTestStatus(s => ({ ...s, [srv.id]: 'error' }));
                              }
                            }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                          >
                            {openApiTestStatus[srv.id] === 'testing' ? '…' : 'Test'}
                          </button>
                          <button
                            onClick={() => {
                              const updated = openApiServers.map(s => s.id === srv.id ? { ...s, enabled: !s.enabled } : s);
                              setOpenApiServers(updated);
                              saveOpenApiServers(updated);
                              const toggled = updated.find(s => s.id === srv.id)!;
                              if (toggled.enabled) registerOpenApiServer(toggled).catch(() => {});
                              else unregisterOpenApiServer(srv.id);
                            }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                              srv.enabled
                                ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600')
                                : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')
                            }`}
                          >
                            {srv.enabled ? 'On' : 'Off'}
                          </button>
                          <button
                            onClick={() => {
                              const updated = openApiServers.filter(s => s.id !== srv.id);
                              setOpenApiServers(updated);
                              saveOpenApiServers(updated);
                              unregisterOpenApiServer(srv.id);
                            }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-red-400 hover:bg-zinc-700' : 'border-zinc-300 text-red-500 hover:bg-zinc-50'}`}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Point at any OpenAPI 3.x spec URL — operations become callable tools for the agent.
                  </p>
                </div>

                {/* Custom Tools & Functions (#127) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Tools & Functions</label>

                  {/* Custom Tools */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Custom Tools ({customTools.length})</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            const ex = STARTER_EXAMPLES.find(e => e.tool);
                            if (ex?.tool) {
                              const t = addCustomTool(ex.tool);
                              setCustomTools(loadCustomTools());
                              void t;
                            }
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                        >Example</button>
                        <button
                          onClick={() => setShowAddCustomTool(v => !v)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                        >{showAddCustomTool ? 'Cancel' : '+ Add'}</button>
                      </div>
                    </div>
                    {showAddCustomTool && (
                      <div className={`rounded-lg border p-2.5 mb-2 space-y-1.5 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                        <input placeholder="Tool name (alphanumeric, _)" value={newCustomTool.name} onChange={e => setNewCustomTool(v => ({ ...v, name: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input placeholder="Description" value={newCustomTool.description} onChange={e => setNewCustomTool(v => ({ ...v, description: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <textarea placeholder='Parameters JSON: {"key":{"type":"string","description":"desc"}}' rows={2} value={newCustomTool.paramsJson} onChange={e => setNewCustomTool(v => ({ ...v, paramsJson: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <textarea placeholder="JS body — use params.x to access parameters. Must return/resolve a value." rows={3} value={newCustomTool.code} onChange={e => setNewCustomTool(v => ({ ...v, code: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <button onClick={() => {
                          if (!newCustomTool.name.trim()) return;
                          let props: Record<string, { type: string; description: string }> = {};
                          try { props = JSON.parse(newCustomTool.paramsJson); } catch {}
                          addCustomTool({ name: newCustomTool.name.trim(), description: newCustomTool.description.trim(), parameters: { type: 'object', properties: props }, code: newCustomTool.code, enabled: true });
                          setCustomTools(loadCustomTools());
                          setNewCustomTool({ name: '', description: '', code: 'return { result: params.input };', paramsJson: '{"input":{"type":"string","description":"Input"}}' });
                          setShowAddCustomTool(false);
                        }} className="w-full text-xs py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Add Tool</button>
                      </div>
                    )}
                    <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                      {customTools.length === 0
                        ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No custom tools.</p>
                        : customTools.map(t => (
                          <div key={t.id} className={`flex items-center gap-2 px-3 py-1.5 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.enabled ? 'bg-green-400' : 'bg-zinc-500'}`} />
                            <span className="text-xs font-medium flex-1 truncate font-mono">{t.name}</span>
                            <span className={`text-[10px] truncate flex-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{t.description}</span>
                            <button onClick={() => { updateCustomTool(t.id, { enabled: !t.enabled }); setCustomTools(loadCustomTools()); }}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${t.enabled ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600') : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}>
                              {t.enabled ? 'On' : 'Off'}
                            </button>
                            <button onClick={() => { removeCustomTool(t.id); setCustomTools(loadCustomTools()); }}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}>✕</button>
                          </div>
                        ))
                      }
                    </div>
                  </div>

                  {/* Filters + Actions */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Filters & Actions ({functionDefs.length})</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            const ex = STARTER_EXAMPLES.find(e => e.fn);
                            if (ex?.fn) { addFunctionDef(ex.fn); setFunctionDefs(loadFunctionDefs()); }
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                        >Example</button>
                        <button onClick={() => setShowAddFunction(v => !v)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                        >{showAddFunction ? 'Cancel' : '+ Add'}</button>
                      </div>
                    </div>
                    {showAddFunction && (
                      <div className={`rounded-lg border p-2.5 mb-2 space-y-1.5 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                        <div className="flex gap-1.5">
                          <select value={newFunction.kind} onChange={e => setNewFunction(v => ({ ...v, kind: e.target.value as 'filter' | 'action' }))}
                            className={`border rounded px-2 py-1 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}>
                            <option value="filter">Filter</option>
                            <option value="action">Action</option>
                          </select>
                          <input placeholder="Name" value={newFunction.name} onChange={e => setNewFunction(v => ({ ...v, name: e.target.value }))}
                            className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                          {newFunction.kind === 'filter' && (
                            <input placeholder="Priority" value={newFunction.priority} onChange={e => setNewFunction(v => ({ ...v, priority: e.target.value }))}
                              className={`w-16 border rounded px-2 py-1 text-xs ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                          )}
                        </div>
                        <textarea placeholder={newFunction.kind === 'filter' ? 'function inlet(messages){return messages;} // and/or function outlet(text){return text;}' : 'function action(message){return "Prompt: "+message.content;}'}
                          rows={4} value={newFunction.code} onChange={e => setNewFunction(v => ({ ...v, code: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <button onClick={() => {
                          if (!newFunction.name.trim()) return;
                          addFunctionDef({ kind: newFunction.kind, name: newFunction.name.trim(), code: newFunction.code, priority: parseInt(newFunction.priority) || 100, enabled: true });
                          setFunctionDefs(loadFunctionDefs());
                          setNewFunction({ kind: 'filter', name: '', code: '', priority: '100' });
                          setShowAddFunction(false);
                        }} className="w-full text-xs py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Add</button>
                      </div>
                    )}
                    <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                      {functionDefs.length === 0
                        ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No filters or actions.</p>
                        : functionDefs.map(f => (
                          <div key={f.id} className={`flex items-center gap-2 px-3 py-1.5 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.enabled ? 'bg-green-400' : 'bg-zinc-500'}`} />
                            <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${f.kind === 'filter' ? (dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700')}`}>{f.kind}</span>
                            <span className="text-xs font-medium flex-1 truncate">{f.name}</span>
                            <button onClick={() => { updateFunctionDef(f.id, { enabled: !f.enabled }); setFunctionDefs(loadFunctionDefs()); }}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${f.enabled ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600') : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}>
                              {f.enabled ? 'On' : 'Off'}
                            </button>
                            <button onClick={() => { removeFunctionDef(f.id); setFunctionDefs(loadFunctionDefs()); }}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}>✕</button>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Tools run in a sandboxed Web Worker. Filters mutate messages; Actions add buttons to replies.
                  </p>
                </div>

                {/* Model Presets (#124) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Model Presets ({presets.length})</label>
                    <button onClick={() => setShowAddPreset(v => !v)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}>
                      {showAddPreset ? 'Cancel' : '+ Add'}
                    </button>
                  </div>
                  {showAddPreset && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                      <div className="flex gap-1.5">
                        <input placeholder="Icon (emoji)" value={newPreset.icon} onChange={e => setNewPreset(v => ({ ...v, icon: e.target.value }))}
                          className={`w-14 border rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input placeholder="Preset name" value={newPreset.name} onChange={e => setNewPreset(v => ({ ...v, name: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      </div>
                      <textarea placeholder="System prompt" rows={2} value={newPreset.systemPrompt} onChange={e => setNewPreset(v => ({ ...v, systemPrompt: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <div className="flex gap-1.5">
                        <input placeholder="Temp (0-1)" value={newPreset.temperature} onChange={e => setNewPreset(v => ({ ...v, temperature: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input placeholder="Context window" value={newPreset.numCtx} onChange={e => setNewPreset(v => ({ ...v, numCtx: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      </div>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Base model: currently selected model ({model})</p>
                      <button onClick={() => {
                        if (!newPreset.name.trim()) return;
                        const params: Record<string, number> = {};
                        const t = parseFloat(newPreset.temperature);
                        if (!isNaN(t)) params.temperature = t;
                        const nc = parseInt(newPreset.numCtx);
                        if (!isNaN(nc)) params.num_ctx = nc;
                        addPreset({ name: newPreset.name.trim(), icon: newPreset.icon.trim() || undefined, baseModel: model, systemPrompt: newPreset.systemPrompt, params, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
                        setPresets(loadPresets());
                        setNewPreset({ name: '', icon: '', systemPrompt: '', temperature: '', numCtx: '' });
                        setShowAddPreset(false);
                      }} className="w-full text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Save Preset</button>
                    </div>
                  )}
                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {presets.length === 0
                      ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No presets. Add one to bundle a model + system prompt + params.</p>
                      : presets.map(p => (
                        <div key={p.id} className={`flex items-center gap-2 px-3 py-2 ${activePresetId === p.id ? (dark ? 'bg-blue-900/20' : 'bg-blue-50') : (dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50')}`}>
                          <span className="text-base shrink-0">{p.icon ?? '🤖'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium truncate">{p.name}</span>
                              {activePresetId === p.id && <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-600'}`}>active</span>}
                            </div>
                            <div className={`text-[10px] truncate ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{p.baseModel}{p.systemPrompt ? ` · ${p.systemPrompt.slice(0, 40)}…` : ''}</div>
                          </div>
                          <button onClick={() => {
                            applyPreset(p, { setModel, setSystemPrompt, setGenOptions });
                            setActivePresetId(p.id); setActivePreset(p.id);
                          }} className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>Apply</button>
                          <button onClick={() => { removePreset(p.id); setPresets(loadPresets()); if (activePresetId === p.id) { setActivePresetId(null); } }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}>✕</button>
                        </div>
                      ))
                    }
                  </div>
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Select a preset from the model dropdown to apply it to the current chat.
                  </p>
                </div>

                {/* Model Management */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Model Management</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={modelPullInput}
                      onChange={(e) => setModelPullInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handlePullModel()}
                      placeholder="e.g. ministral-3:3b"
                      className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-colors ${
                        dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                      }`}
                    />
                    <button
                      onClick={() => handlePullModel()}
                      disabled={isPulling}
                      className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                    >
                      {isPulling ? 'Pulling...' : 'Pull'}
                    </button>
                  </div>
                  {pullProgress && (
                    <div className="flex items-center gap-2 mb-2">
                      <p className={`text-xs flex-1 ${pullError ? 'text-red-400' : (dark ? 'text-zinc-400' : 'text-zinc-500')}`}>
                        {pullProgress}
                      </p>
                      {pullError && (
                        <button
                          onClick={() => { setPullProgress(''); setPullError(false); handlePullModel(lastPullTarget); }}
                          className="text-xs px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 shrink-0"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {/* Suggested models — one-click download */}
                  <div className={`rounded-lg border divide-y overflow-hidden mb-2 ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    <div className={`px-3 py-2 font-semibold text-xs ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>Suggested models</div>
                    {SUGGESTED_MODELS.map((s) => {
                      const installed = models.some(m => m.name === s.name);
                      const pulling = pullingModel === s.name;
                      return (
                        <div
                          key={s.name}
                          className={`flex items-center justify-between gap-2 px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'} ${s.recommended ? (dark ? 'bg-amber-900/10' : 'bg-amber-50') : ''}`}
                        >
                          <div className="min-w-0 pr-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-xs truncate">{s.name}</span>
                              {s.recommended && (
                                <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${dark ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>⭐ 8GB RAM</span>
                              )}
                              <span className={`text-[9px] px-1 py-0.5 rounded ${dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'}`}>~{s.sizeGB} GB · {s.minRamGB} GB RAM</span>
                            </div>
                            <div className={`text-[10px] mt-0.5 truncate ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{s.description}</div>
                          </div>
                          {installed ? (
                            <span className="text-green-400 text-xs shrink-0">Installed ✓</span>
                          ) : (
                            <button
                              onClick={() => handlePullModel(s.name)}
                              disabled={isPulling}
                              aria-label={`Download ${s.name}`}
                              className="shrink-0 text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white font-semibold transition-colors"
                            >
                              {pulling ? 'Pulling…' : 'Download'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                   <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                     <div className={`flex items-center justify-between px-3 py-2 font-semibold text-xs ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                       <span>Local Models</span>
                       {systemMemory && (
                         <span className={`font-normal ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{formatBytes(systemMemory.available_bytes)} free / {formatBytes(systemMemory.total_bytes)} RAM</span>
                       )}
                     </div>
                     {models.filter(m => !m.cloud).length === 0 && (
                       <p className={`text-xs p-3 italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No local models installed.</p>
                     )}
                     {models.filter(m => !m.cloud).map((m) => {
                       const fit = classifyFit(m.size, systemMemory?.available_bytes);
                       return (
                       <div key={m.name} className={`flex items-center justify-between px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                         <div className="flex items-center gap-2 min-w-0">
                           {systemMemory && fit !== 'unknown' && (
                             <span className={fitColor(fit)} title={`${fitLabel(fit)} · ${formatBytes(m.size)}${m.quantization ? ` · ${m.quantization}` : ''} · ${formatBytes(systemMemory.available_bytes)} free`}>●</span>
                           )}
                           <span className="font-mono text-xs truncate">{m.name}</span>
                           {m.size != null && <span className={`text-[10px] shrink-0 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{formatBytes(m.size)}</span>}
                         </div>
                         <button onClick={() => handleDeleteModel(m.name)} className="ml-3 text-red-400 hover:text-red-300 text-xs shrink-0">
                           Remove
                         </button>
                       </div>
                       );
                     })}
                   </div>
                   
                   <div className={`rounded-lg border divide-y overflow-hidden mt-3 ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                     <div className={`px-3 py-2 font-semibold text-xs ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>Cloud Models ⛅</div>
                     {models.filter(m => m.cloud).length === 0 && (
                       <p className={`text-xs p-3 italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No cloud models available.</p>
                     )}
                     {models.filter(m => m.cloud).map((m) => (
                       <div key={m.name} className={`flex items-center justify-between px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                         <span className="font-mono text-xs truncate">{m.name}</span>
                         <span className="ml-3 text-blue-400 text-xs shrink-0">Cloud</span>
                       </div>
                     ))}
                   </div>
                </div>

                {/* Modelfile Builder (#125) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Create Model (Modelfile)</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="flex gap-1.5">
                      <input placeholder="New model name (e.g. my-assistant:latest)" value={modelfileFields.name} onChange={e => {
                        const f = { ...modelfileFields, name: e.target.value };
                        setModelfileFields(f);
                        setModelfilePreview(assembleModelfile({ from: model, system: f.system, temperature: f.temperature ? parseFloat(f.temperature) : undefined, numCtx: f.numCtx ? parseInt(f.numCtx) : undefined, stop: f.stop || undefined, template: f.template || undefined }));
                      }}
                        className={`flex-1 border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    </div>
                    <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Base: <span className="font-mono">{model}</span> (currently selected)</p>
                    <textarea placeholder="SYSTEM prompt (optional)" rows={2} value={modelfileFields.system} onChange={e => {
                      const f = { ...modelfileFields, system: e.target.value };
                      setModelfileFields(f);
                      setModelfilePreview(assembleModelfile({ from: model, system: f.system, temperature: f.temperature ? parseFloat(f.temperature) : undefined, numCtx: f.numCtx ? parseInt(f.numCtx) : undefined }));
                    }}
                      className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    <div className="flex gap-1.5">
                      <input placeholder="Temperature" value={modelfileFields.temperature} onChange={e => setModelfileFields(v => ({ ...v, temperature: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <input placeholder="num_ctx" value={modelfileFields.numCtx} onChange={e => setModelfileFields(v => ({ ...v, numCtx: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    </div>
                    {modelfilePreview && (
                      <div className={`rounded border p-2 text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-auto ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-400' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                        {modelfilePreview}
                      </div>
                    )}
                    {modelfileProgress && (
                      <p className={`text-xs ${modelfileError ? 'text-red-400' : 'text-green-400'}`}>{modelfileProgress}</p>
                    )}
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          const mf = assembleModelfile({ from: model, system: modelfileFields.system || undefined, temperature: modelfileFields.temperature ? parseFloat(modelfileFields.temperature) : undefined, numCtx: modelfileFields.numCtx ? parseInt(modelfileFields.numCtx) : undefined });
                          setModelfilePreview(mf);
                        }}
                        className={`flex-1 text-xs py-1.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                      >Preview</button>
                      <button
                        onClick={async () => {
                          if (!modelfileFields.name.trim()) { setModelfileError('Enter a model name'); return; }
                          const mf = assembleModelfile({ from: model, system: modelfileFields.system || undefined, temperature: modelfileFields.temperature ? parseFloat(modelfileFields.temperature) : undefined, numCtx: modelfileFields.numCtx ? parseInt(modelfileFields.numCtx) : undefined });
                          setIsCreatingModel(true);
                          setModelfileError('');
                          setModelfileProgress('Starting…');
                          try {
                            await createOllamaModel(modelfileFields.name.trim(), mf, (p) => {
                              setModelfileProgress(p.status ?? 'Working…');
                              if (p.error) setModelfileError(p.error);
                            }, url('/api/create'));
                            setModelfileProgress('✓ Model created');
                            refreshModels().catch(() => {});
                          } catch (e) {
                            setModelfileError(e instanceof Error ? e.message : 'Create failed');
                            setModelfileProgress('');
                          } finally {
                            setIsCreatingModel(false);
                          }
                        }}
                        disabled={isCreatingModel}
                        className="flex-1 text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white font-semibold transition-colors"
                      >{isCreatingModel ? 'Creating…' : 'Create Model'}</button>
                    </div>
                  </div>
                </div>

                {/* Image Generation (#130) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Image Generation</label>
                    <Toggle
                      checked={imageGenConfig.enabled}
                      onChange={() => { const cfg = { ...imageGenConfig, enabled: !imageGenConfig.enabled }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                      dark={dark}
                      label="Enable image generation"
                    />
                  </div>
                  {imageGenConfig.enabled && (
                    <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                      <div className="flex gap-1.5">
                        <select
                          value={imageGenConfig.backend}
                          onChange={e => { const cfg = { ...imageGenConfig, backend: e.target.value as any }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        >
                          <option value="a1111">A1111 / Forge</option>
                          <option value="comfyui">ComfyUI</option>
                          <option value="openai">OpenAI DALL-E</option>
                        </select>
                      </div>
                      {imageGenConfig.backend !== 'openai' && (
                        <input
                          placeholder="Base URL (e.g. http://127.0.0.1:7860)"
                          value={imageGenConfig.baseUrl}
                          onChange={e => { const cfg = { ...imageGenConfig, baseUrl: e.target.value }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      )}
                      {(imageGenConfig.backend === 'a1111' || imageGenConfig.backend === 'openai') && (
                        <input
                          placeholder={imageGenConfig.backend === 'openai' ? 'OpenAI API key (sk-…)' : 'Password (optional)'}
                          type="password"
                          value={imageGenConfig.apiKey ?? ''}
                          onChange={e => { const cfg = { ...imageGenConfig, apiKey: e.target.value || undefined }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                          className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      )}
                      <div className="flex gap-1.5">
                        <input
                          placeholder="Default size (e.g. 512x512)"
                          value={imageGenConfig.size ?? ''}
                          onChange={e => { const cfg = { ...imageGenConfig, size: e.target.value || undefined }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                        <input
                          placeholder="Steps (e.g. 20)"
                          type="number"
                          value={imageGenConfig.steps ?? ''}
                          onChange={e => { const cfg = { ...imageGenConfig, steps: e.target.value ? parseInt(e.target.value) : undefined }; setImageGenConfig(cfg); saveImageGenConfig(cfg); }}
                          className={`w-28 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      </div>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Use <span className="font-mono">/image &lt;prompt&gt;</span> in the chat to generate an image. The <span className="font-mono">generate_image</span> tool is also available to models.
                      </p>
                    </div>
                  )}
                </div>

                {/* Web Speech API voice settings (#101) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Voice (Web Speech API)</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Auto-speak responses</span>
                      <Toggle
                        checked={voiceSettings.autoSpeak}
                        onChange={() => { const s = { ...voiceSettings, autoSpeak: !voiceSettings.autoSpeak }; setVoiceSettings(s); saveVoiceSettings(s); }}
                        dark={dark}
                        label="Auto-speak responses"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <div className="flex-1">
                        <label className={`text-[10px] block mb-0.5 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Rate</label>
                        <input type="range" min="0.5" max="2" step="0.1" value={voiceSettings.rate}
                          onChange={e => { const s = { ...voiceSettings, rate: parseFloat(e.target.value) }; setVoiceSettings(s); saveVoiceSettings(s); }}
                          className="w-full" />
                      </div>
                      <div className="flex-1">
                        <label className={`text-[10px] block mb-0.5 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Pitch</label>
                        <input type="range" min="0" max="2" step="0.1" value={voiceSettings.pitch}
                          onChange={e => { const s = { ...voiceSettings, pitch: parseFloat(e.target.value) }; setVoiceSettings(s); saveVoiceSettings(s); }}
                          className="w-full" />
                      </div>
                    </div>
                    <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {isTtsAvailable() ? '✓ TTS available.' : '✗ TTS not available.'} {isSpeechRecognitionAvailable() ? '✓ Dictation available (🎤 in composer).' : '✗ SpeechRecognition not available.'}
                    </p>
                  </div>
                </div>

                {/* Prompt library (#97) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Prompt Library ({prompts.length})</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    {prompts.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <span className={`flex-1 text-xs font-medium truncate ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>{p.name}</span>
                        <span className={`text-[10px] truncate max-w-[120px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{p.body.slice(0, 40)}</span>
                        <button onClick={() => { removePrompt(p.id); setPrompts(loadPrompts()); }} className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-400 hover:text-red-500'}`}>✕</button>
                      </div>
                    ))}
                    <div className="flex gap-1.5">
                      <input placeholder="Prompt name" value={newPromptName} onChange={e => setNewPromptName(e.target.value)}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <button
                        onClick={() => {
                          if (!newPromptName.trim() || !input.trim()) return;
                          addPrompt({ name: newPromptName.trim(), body: input.trim() });
                          setPrompts(loadPrompts());
                          setNewPromptName('');
                        }}
                        title="Save current input as a prompt"
                        className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white whitespace-nowrap"
                      >Save input</button>
                    </div>
                    <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Prompts appear in the 📋 picker next to the composer when saved.</p>
                  </div>
                </div>

                {/* User-defined slash commands (#96) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Custom Slash Commands ({userCommands.length})</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    {userCommands.map(cmd => (
                      <div key={cmd.name} className="flex items-center gap-1.5">
                        <span className={`font-mono text-xs ${dark ? 'text-blue-400' : 'text-blue-600'}`}>/{cmd.name}</span>
                        <span className={`flex-1 text-xs truncate ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>{cmd.description}</span>
                        <button onClick={() => { removeUserCommand(cmd.name); setUserCommands(loadUserCommands()); }} className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-400 hover:text-red-500'}`}>✕</button>
                      </div>
                    ))}
                    <div className="flex gap-1.5 pt-1">
                      <input placeholder="name" value={newCmd.name} onChange={e => setNewCmd(v => ({ ...v, name: e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() }))}
                        className={`w-24 border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <input placeholder="description" value={newCmd.description} onChange={e => setNewCmd(v => ({ ...v, description: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    </div>
                    <input placeholder="Template — use $ARGUMENTS or $1 $2 for substitution" value={newCmd.template} onChange={e => setNewCmd(v => ({ ...v, template: e.target.value }))}
                      className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    <button
                      onClick={() => {
                        if (!newCmd.name || !newCmd.description || !newCmd.template) return;
                        addUserCommand({ name: newCmd.name, description: newCmd.description, template: newCmd.template });
                        setUserCommands(loadUserCommands());
                        setNewCmd({ name: '', description: '', template: '' });
                      }}
                      className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >+ Add Command</button>
                  </div>
                </div>

                {/* Speech-to-Text / Dictation (#131) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Speech-to-Text (Whisper)</label>
                    <Toggle
                      checked={sttConfig.enabled}
                      onChange={() => { const cfg = { ...sttConfig, enabled: !sttConfig.enabled }; setSttConfig(cfg); saveSttConfig(cfg); setIsRecordingAudio(false); }}
                      dark={dark}
                      label="Enable speech-to-text"
                    />
                  </div>
                  {sttConfig.enabled && (
                    <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                      <div className="flex gap-1.5 items-center">
                        <input
                          placeholder="Whisper server URL (e.g. http://127.0.0.1:8080)"
                          value={sttConfig.whisperUrl}
                          onChange={e => { const cfg = { ...sttConfig, whisperUrl: e.target.value }; setSttConfig(cfg); saveSttConfig(cfg); setWhisperAvailable(null); }}
                          className={`flex-1 border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                        <button
                          onClick={async () => { const ok = await checkWhisperAvailable(sttConfig); setWhisperAvailable(ok); }}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                        >Test</button>
                        {whisperAvailable === true && <span className="text-green-400 text-xs">✓</span>}
                        {whisperAvailable === false && <span className="text-red-400 text-xs">✗</span>}
                      </div>
                      <div className="flex gap-1.5">
                        <select
                          value={sttConfig.language}
                          onChange={e => { const cfg = { ...sttConfig, language: e.target.value }; setSttConfig(cfg); saveSttConfig(cfg); }}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        >
                          <option value="auto">Auto-detect language</option>
                          <option value="en">English</option>
                          <option value="fi">Finnish</option>
                          <option value="sv">Swedish</option>
                          <option value="de">German</option>
                          <option value="fr">French</option>
                          <option value="es">Spanish</option>
                          <option value="zh">Chinese</option>
                          <option value="ja">Japanese</option>
                        </select>
                        <input
                          placeholder="Max sec"
                          type="number"
                          min="5"
                          max="300"
                          value={Math.round(sttConfig.maxDurationMs / 1000)}
                          onChange={e => { const cfg = { ...sttConfig, maxDurationMs: parseInt(e.target.value) * 1000 }; setSttConfig(cfg); saveSttConfig(cfg); }}
                          className={`w-24 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      </div>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Run <span className="font-mono">./server --port 8080</span> from whisper.cpp. A 🎙 button appears in the chat composer to record and transcribe.
                      </p>
                    </div>
                  )}
                </div>

              </div>

                {/* Projects (#92) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Projects ({projects.length})</label>
                  {projects.length === 0 && <p className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No projects. Create one from the sidebar.</p>}
                  {projects.map(p => (
                    <div key={p.id} className={`mb-3 rounded-lg p-3 border ${dark ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-white'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{p.name}</span>
                        {activeProjectId === p.id && <span className="text-[10px] text-blue-400">active</span>}
                      </div>
                      <label className={`block text-xs mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Instructions (prepended to system prompt)</label>
                      <textarea
                        value={p.instructions}
                        onChange={e => {
                          const updated = { ...p, instructions: e.target.value };
                          storage.saveProject(updated);
                          setProjects(storage.getProjects());
                        }}
                        rows={3}
                        placeholder="e.g. Always respond in TypeScript. Prefer functional patterns."
                        className={`w-full text-xs px-2 py-1.5 rounded border resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                      />
                    </div>
                  ))}
                </div>

                {/* Memory (#95) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Persistent Memory ({memoryEntries.length})</label>
                  <p className={`text-xs mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Facts and preferences injected into every conversation. The model can also call <span className="font-mono">remember</span> to store facts automatically.</p>
                  <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                    {memoryEntries.map(e => (
                      <div key={e.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1 ${dark ? 'bg-zinc-800 text-zinc-300' : 'bg-white text-zinc-700'}`}>
                        <span className="flex-1 break-words">{e.text}</span>
                        {e.scope !== 'global' && <span className={`shrink-0 text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{e.scope}</span>}
                        <button onClick={() => { removeMemoryEntry(e.id); setMemoryEntries(loadMemory()); }} className="shrink-0 text-red-400 hover:text-red-300">✕</button>
                      </div>
                    ))}
                    {memoryEntries.length === 0 && <p className={`text-xs italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No memory entries.</p>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newMemoryText}
                      onChange={e => setNewMemoryText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newMemoryText.trim()) {
                          addMemoryEntry(newMemoryText.trim(), activeProjectId ?? 'global');
                          setMemoryEntries(loadMemory());
                          setNewMemoryText('');
                        }
                      }}
                      placeholder="New fact or preference…"
                      className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                    <button
                      onClick={() => { if (newMemoryText.trim()) { addMemoryEntry(newMemoryText.trim(), activeProjectId ?? 'global'); setMemoryEntries(loadMemory()); setNewMemoryText(''); } }}
                      className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >Add</button>
                  </div>
                </div>

                {/* Compaction (#95) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Context Compaction</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Automatically summarise old messages when the conversation approaches the context limit. Keeps recent turns intact.</p>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Auto-compact</span>
                    <Toggle checked={autoCompact} onChange={() => { const v = !autoCompact; setAutoCompact(v); localStorage.setItem('ollama_gui_auto_compact', JSON.stringify(v)); }} dark={dark} label="Toggle auto-compact" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Threshold (tokens)</label>
                    <input
                      type="number"
                      min={500}
                      max={32000}
                      value={compactionThreshold}
                      onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) { setCompactionThreshold(v); localStorage.setItem('ollama_gui_compact_threshold', String(v)); } }}
                      className={`w-24 text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                    />
                  </div>
                </div>

              <div className="mt-6 flex justify-end">
                <button onClick={() => setIsSettingsOpen(false)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-colors">
                  Close
                </button>
               </div>
             </div>
           </div>
         )}
       </div>

        {/* Help Overlay (keyboard shortcuts) */}
        {showHelp && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-md rounded-2xl p-6 shadow-2xl ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Keyboard Shortcuts</h2>
                <button onClick={() => setShowHelp(false)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
              </div>
              <div className="space-y-1">
                {[
                  ['New Chat', 'Ctrl+K'],
                  ['Toggle Sidebar', 'Ctrl+\\'],
                  ['Open Settings', 'Ctrl+,'],
                  ['Close Modal', 'Escape'],
                  ['Show Help', '?'],
                ].map(([label, key]) => (
                  <div key={key} className={`flex justify-between items-center py-3 border-b last:border-b-0 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                    <span className={dark ? 'text-zinc-300' : 'text-zinc-700'}>{label}</span>
                    <kbd className={`px-2 py-1 rounded text-sm font-mono ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-200 text-zinc-800'}`}>{key}</kbd>
                  </div>
                ))}
              </div>
              <p className={`text-[10px] mt-4 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                Shortcuts work when not typing in an input field.
              </p>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setShowHelp(false)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Transient toast notification (#58) */}
        {notification && (
          <div
            role="status"
            aria-live="polite"
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm border ${
              dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
            }`}
          >
            {notification}
          </div>
        )}
        {/* CLI Command Approval Modal */}
        {pendingApproval && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span>🔧</span> Command Approval Required
                </h2>
              </div>
              <p className={`text-sm mb-3 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                The AI wants to run a shell command on your machine:
              </p>
              <div className={`rounded-lg px-4 py-3 font-mono text-sm mb-2 border ${
                dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-200 text-zinc-900'
              }`}>
                {pendingApproval.command}
              </div>
              {pendingApproval.cwd && (
                <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Working directory: <span className="font-mono">{pendingApproval.cwd}</span>
                </p>
              )}
              <p className={`text-xs mb-5 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                Review the command carefully before allowing. "Always Allow" remembers this exact command for the session.
              </p>
              <div className="flex gap-2 justify-end flex-wrap">
                <button
                  onClick={() => {
                    pendingApproval.resolve(false);
                    setPendingApproval(null);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'
                  }`}
                >
                  Deny
                </button>
                <button
                  onClick={() => {
                    cliAllowlist.add(pendingApproval.command);
                    persistCliAllowlist();
                    pendingApproval.resolve(true);
                    setPendingApproval(null);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    dark ? 'border-blue-600 text-blue-400 hover:bg-blue-600/20' : 'border-blue-500 text-blue-600 hover:bg-blue-50'
                  }`}
                >
                  Always Allow
                </button>
                <button
                  onClick={() => {
                    pendingApproval.resolve(true);
                    setPendingApproval(null);
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  Allow Once
                </button>
               </div>
             </div>
           </div>
         )}
    </div>

      {/* Artifact canvas panel (#99) — docks to the right of the chat area */}
      {showArtifacts && currentArtifact && (
        <div className={`w-96 shrink-0 border-l flex flex-col overflow-hidden transition-all ${
          dark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
        }`}>
          {/* Panel header */}
          <div className={`h-14 flex items-center justify-between px-4 shrink-0 border-b ${
            dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-xs font-mono px-2 py-0.5 rounded shrink-0 ${dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}>
                {currentArtifact.language}
              </span>
              <span className={`text-sm font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-700'}`}>
                Artifact
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Tab toggle for html/svg */}
              {(currentArtifact.kind === 'html' || currentArtifact.kind === 'svg') && (
                <div className={`flex rounded-lg overflow-hidden border text-xs mr-1 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                  <button
                    onClick={() => setArtifactTab('preview')}
                    className={`px-2 py-1 transition-colors ${artifactTab === 'preview' ? (dark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-800') : (dark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100')}`}
                  >Preview</button>
                  <button
                    onClick={() => setArtifactTab('code')}
                    className={`px-2 py-1 transition-colors ${artifactTab === 'code' ? (dark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-800') : (dark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100')}`}
                  >Code</button>
                </div>
              )}
              {/* Copy button */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentArtifact.code);
                  setArtifactCopied(true);
                  setTimeout(() => setArtifactCopied(false), 2000);
                }}
                aria-label="Copy artifact code"
                title="Copy"
                className={`text-xs px-2 py-1 rounded transition-colors ${artifactCopied ? 'text-green-400' : (dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100')}`}
              >{artifactCopied ? '✓' : '⎘'}</button>
              {/* Export button */}
              <button
                onClick={() => exportArtifact(currentArtifact)}
                aria-label="Export artifact to file"
                title="Export to file"
                className={`text-xs px-2 py-1 rounded transition-colors ${dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100'}`}
              >↓</button>
              {/* Close */}
              <button
                onClick={() => setShowArtifacts(false)}
                aria-label="Close artifacts panel"
                className={`text-xs px-2 py-1 rounded transition-colors ${dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100'}`}
              >✕</button>
            </div>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-auto">
            {(currentArtifact.kind === 'html' || currentArtifact.kind === 'svg') && artifactTab === 'preview' ? (
              <iframe
                srcDoc={currentArtifact.code}
                title="Artifact preview"
                sandbox="allow-scripts"
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <div className="p-2">
                <SyntaxHighlighter
                  style={dark ? vscDarkPlus : oneLight}
                  language={currentArtifact.language}
                  PreTag="div"
                  customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.75rem' }}
                >
                  {currentArtifact.code}
                </SyntaxHighlighter>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
