import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Message, fetchOllamaChatStream, fetchOllamaModels, pullOllamaModel, deleteOllamaModel, fetchCloudModels } from './services/ollama';
import { ChatSession, storage } from './services/storage';
import { toolRegistry, registerBuiltInTools, registerCliTool, cliAllowlist, persistCliAllowlist } from './services/tools';
import { agenticChatStream } from './services/agent';
import { McpServerConfig, mcpConfigStore } from './services/mcpConfig';
import { performOAuthFlow } from './services/mcpAuth';
import { mcpServerManager } from './services/mcp';
import {
  MlxAvailability, MlxSettings, DEFAULT_MLX_SETTINGS,
  checkMlxAvailable, loadMlxSettings, saveMlxSettings, applyMlxHierarchy,
  isMlxActive, startMlxServer, stopMlxServer, fetchMlxChatStream,
} from './services/mlx';
import { runCloudBrainLocalWorker } from './services/orchestrator';

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

const App: React.FC = () => {
  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('llama3');
  const [models, setModels] = useState<{ name: string; cloud: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Settings / UI state
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(DEFAULT_BASE_URL);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
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
  const [newMcpServer, setNewMcpServer] = useState<{ name: string; type: 'stdio' | 'http'; command: string; url: string }>({
    name: '', type: 'stdio', command: '', url: '',
  });
  const [mcpAuthError, setMcpAuthError] = useState<string | null>(null);

  // MLX acceleration state (Apple Silicon)
  const [mlxAvailability, setMlxAvailability] = useState<MlxAvailability | null>(null);
  const [mlxSettings, setMlxSettings] = useState<MlxSettings>(DEFAULT_MLX_SETTINGS);

  // Streaming cancel support
  const abortControllerRef = useRef<AbortController | null>(null);

  // Storage quota warning
  const [storageWarning, setStorageWarning] = useState(false);

  // Model management state
  const [modelPullInput, setModelPullInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState('');
  const [pullError, setPullError] = useState(false);

  // M5: Image attachments (Issue 20)
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derived: filtered sessions for search (Issue 18)
  const filteredSessions = sessions.filter(s =>
    searchQuery.trim() === '' ||
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const url = (path: string) => `${ollamaBaseUrl}${path}`;

  const refreshModels = useCallback(async () => {
    const availableModels = await fetchOllamaModels(url('/api/tags'));
    const cloudModels = await fetchCloudModels();
    const combined = [
      ...availableModels.map(m => ({ name: m.name, cloud: isCloudModel(m.name) })),
      ...cloudModels,
    ];
    setModels(combined);
    return combined;
  }, [ollamaBaseUrl]);

  useEffect(() => {
    async function loadInitialData() {
      const savedUrl = localStorage.getItem('ollama_gui_base_url');
      if (savedUrl) setOllamaBaseUrl(savedUrl);

      const savedPrompt = localStorage.getItem('ollama_gui_system_prompt');
      if (savedPrompt) setSystemPrompt(savedPrompt);

      const savedTheme = localStorage.getItem('ollama_gui_theme');
      if (savedTheme !== null) setIsDarkMode(savedTheme === 'dark');

      setSessions(storage.getSessions());

      // Load persisted MCP servers
      setMcpServers(mcpConfigStore.list());

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

      // Initialize built-in tools
      registerBuiltInTools();
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

  const startNewChat = useCallback(() => {
    setMessages([]);
    setCurrentSessionId(null);
    setAttachedImages([]);
    setInput('');
  }, []);

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

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    localStorage.setItem('ollama_gui_theme', next ? 'dark' : 'light');
  };

  const updateSystemPrompt = (val: string) => {
    setSystemPrompt(val);
    localStorage.setItem('ollama_gui_system_prompt', val);
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
  const handlePullModel = async () => {
    if (!modelPullInput.trim()) return;
    setIsPulling(true);
    setPullError(false);
    setPullProgress('Starting pull...');
    try {
      await pullOllamaModel(modelPullInput, (p) => {
        const pct = p.total ? ` (${Math.round(((p.completed ?? 0) / p.total) * 100)}%)` : '';
        setPullProgress((p.status || 'Pulling...') + pct);
      }, url('/api/pull'));
      setPullProgress('Pull complete!');
      setModelPullInput('');
      const updated = await refreshModels();
      if (!updated.find(m => m.name === model)) setModel(updated[0]?.name || 'llama3');
    } catch (e) {
      setPullProgress(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setPullError(true);
    } finally {
      setIsPulling(false);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    const selectedModel = models.find(m => m.name === modelName);
    if (selectedModel?.cloud) { alert('Cloud models cannot be deleted.'); return; }
    if (!confirm(`Delete ${modelName}?`)) return;
    try {
      await deleteOllamaModel(modelName, url('/api/delete'));
      const updated = await refreshModels();
      if (model === modelName) setModel(updated[0]?.name || 'llama3');
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // Session management
  const loadSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setModel(session.model);
    setAttachedImages([]);
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

  const saveCurrentSession = (currentMessages: Message[]) => {
    if (currentSessionId === null) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: generateTitle(currentMessages),
        messages: currentMessages,
        createdAt: Date.now(),
        model,
      };
      const result = storage.saveSession(newSession);
      if (result.ok === false && result.error === 'quota') setStorageWarning(true);
      setCurrentSessionId(newSession.id);
      setSessions(storage.getSessions());
    } else {
      const session = storage.getSessions().find(s => s.id === currentSessionId);
      if (session) {
        const result = storage.saveSession({ ...session, messages: currentMessages });
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
  const sendMessage = async () => {
    if (!input.trim() && attachedImages.length === 0) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      ...(attachedImages.length > 0 ? { images: [...attachedImages] } : {}),
    };

    // Strip data-URL prefix before sending — API expects raw base64 only
    const toApiMsg = (m: Message): Message =>
      m.images ? { ...m, images: m.images.map(toApiBase64) } : m;

    const chatHistory: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(toApiMsg),
      toApiMsg(userMessage),
    ];

    setMessages([...messages, userMessage]);
    setInput('');
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
      } else {
        // Use regular chat stream
        let assistantContent = '';
        let streamOk = false;
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
          await fetchOllamaChatStream(model, chatHistory, (chunk) => {
            if (chunk.message?.content) {
              assistantContent += chunk.message.content;
              setMessages(prev => {
                const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }] as Message[];
                saveCurrentSession(updated);
                return updated;
              });
            }
          }, endpoint);
          streamOk = true;
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
      abortControllerRef.current = null;
    }
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
               className={`w-full py-2 px-4 rounded-lg transition-colors mb-3 text-sm font-semibold ${
                 dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'
               }`}
             >
               + New Chat
             </button>

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

        {/* Session list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          <p className={`text-xs uppercase font-semibold mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {searchQuery ? `Results (${filteredSessions.length})` : 'History'}
          </p>
          {filteredSessions.length === 0 && (
            <div className={`text-sm italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {searchQuery ? 'No matches.' : 'No past conversations.'}
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
                     className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                       currentSessionId === s.id
                         ? (dark ? 'bg-zinc-700 text-white' : 'bg-zinc-300 text-zinc-900')
                         : (dark ? 'hover:bg-zinc-700/50 text-zinc-300' : 'hover:bg-zinc-200 text-zinc-600')
                     }`}
                   >
              <span className="truncate text-sm flex-1">{s.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity text-xs"
              >
                ✕
              </button>
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
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Select AI model"
                className={`text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                }`}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{m.cloud ? ' ⛅' : ''}
                  </option>
                ))}
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
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
               <div className={`w-full md:max-w-3xl p-4 rounded-2xl ${
                 msg.role === 'user'
                   ? 'bg-blue-600 text-white rounded-tr-none'
                   : msg.role === 'tool'
                     ? (dark ? 'bg-zinc-700 text-zinc-100 rounded-tl-none border-l-2 border-blue-500' : 'bg-zinc-100 text-zinc-900 rounded-tl-none border-l-2 border-blue-500')
                     : (dark ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
               }`}>
                <div className="text-xs font-bold mb-2 opacity-50 uppercase flex items-center gap-1">
                  {msg.role}
                  {msg.role === 'tool' && <span className="text-blue-400">🔧</span>}
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
 
                <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const lang = (className || '').replace('language-', '') || 'text';
                        const code = String(children).replace(/\n$/, '');
                        if (!inline) {
                          // Issue 22: language label + copy button
                          return (
                            <CodeBlock lang={lang} code={code} dark={dark} props={props} />
                          );
                        }
                        return (
                          <code className={`px-1 rounded ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
 
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

          <div className="max-w-3xl mx-auto flex gap-2">
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

             <input
               id="chat-input"
               type="text"
               value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && !e.shiftKey) {
                   e.preventDefault();
                   sendMessage();
                 }
               }}
               placeholder="Message Ollama..."
               aria-label="Type your message here"
               className={`flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                 dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
               }`}
             />
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
                 onClick={sendMessage}
                 disabled={isLoading}
                 aria-label="Send message"
                 className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white px-6 py-3 rounded-xl transition-colors font-semibold"
               >
                 Send
               </button>
             )}
          </div>
          <div className={`text-center text-[10px] mt-2 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            Ollama GUI — Built for speed and privacy. · Cmd+K new chat · ? for shortcuts
          </div>

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
                     {toolRegistry.getAllTools().map((tool) => (
                       <div key={tool.name} className={`flex items-center justify-between px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                         <div>
                           <div className="font-mono text-xs truncate">{tool.name}</div>
                           <div className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'} truncate`}>{tool.description}</div>
                         </div>
                         <span className={`ml-3 text-green-400 text-xs shrink-0`}>✓</span>
                       </div>
                     ))}
                   </div>
                 </div>

                {/* MCP Servers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      MCP Servers ({mcpServers.length})
                    </label>
                    <button
                      onClick={() => setShowAddMcpServer(v => !v)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                      }`}
                    >
                      {showAddMcpServer ? 'Cancel' : '+ Add'}
                    </button>
                  </div>

                  {showAddMcpServer && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
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
                          <input
                            placeholder="Command (e.g. npx my-mcp-server)"
                            value={newMcpServer.command}
                            onChange={e => setNewMcpServer(s => ({ ...s, command: e.target.value }))}
                            className={`flex-1 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                          />
                        ) : (
                          <input
                            placeholder="URL (e.g. https://mcp.example.com)"
                            value={newMcpServer.url}
                            onChange={e => setNewMcpServer(s => ({ ...s, url: e.target.value }))}
                            className={`flex-1 border rounded px-2 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                          />
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (!newMcpServer.name.trim()) return;
                              // Validate inputs
                              if (!newMcpServer.name.trim()) {
                                alert('Please enter a server name');
                                return;
                              }
                              
                              if (newMcpServer.type === 'stdio' && !newMcpServer.command?.trim()) {
                                alert('Please enter a command for stdio server');
                                return;
                              }
                              
                              if (newMcpServer.type === 'http' && !newMcpServer.url?.trim()) {
                                alert('Please enter a URL for HTTP server');
                                return;
                              }
                              
                              // Validate URL format for HTTP servers
                              if (newMcpServer.type === 'http') {
                                try {
                                  new URL(newMcpServer.url.trim());
                                } catch {
                                  alert('Please enter a valid URL (e.g., https://example.com)');
                                  return;
                                }
                              }
                              
                              const server: McpServerConfig = {
                                id: mcpConfigStore.generateId(),
                                name: newMcpServer.name.trim(),
                                type: newMcpServer.type,
                                command: newMcpServer.type === 'stdio' ? newMcpServer.command.trim() : undefined,
                                url: newMcpServer.type === 'http' ? newMcpServer.url.trim() : undefined,
                                status: 'disconnected',
                                tools: [],
                                authRequired: newMcpServer.type === 'http',
                                authenticated: false,
                              };
                          mcpConfigStore.save(server);
                          setMcpServers(mcpConfigStore.list());
                          setNewMcpServer({ name: '', type: 'stdio', command: '', url: '' });
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

                                   // Ensure server is registered in the manager before connecting
                                   mcpServerManager.addServer({
                                     id: server.id, name: server.name, type: server.type,
                                     command: server.command, url: server.url,
                                     enabled: true, toolsEnabled: true,
                                   });

                                   const client = await mcpServerManager.connectToServer(server.id);
                                   const tools = await client.listTools();

                                   // Register MCP tools into toolRegistry so agentic mode can call them
                                   for (const tool of tools) {
                                     toolRegistry.registerTool({
                                       name: `mcp_${server.id}_${tool.name}`,
                                       description: `[MCP:${server.name}] ${tool.description}`,
                                       parameters: tool.parameters ?? { type: 'object', properties: {} },
                                       execute: async (params) => {
                                         const c = mcpServerManager.getActiveConnection(server.id);
                                         if (!c) throw new Error(`MCP server ${server.name} not connected`);
                                         return c.callTool(tool.name, params);
                                       },
                                     });
                                   }

                                   setMcpServers(prev =>
                                     prev.map(s => s.id === server.id ? {
                                       ...s,
                                       status: 'connected',
                                       tools: tools.map(t => ({ ...t, enabled: true })),
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
                               onClick={() => {
                                 // Unregister tools and disconnect
                                 const existing = mcpServers.find(s => s.id === server.id);
                                 if (existing) {
                                   for (const t of existing.tools) {
                                     toolRegistry.unregisterTool(`mcp_${server.id}_${t.name}`);
                                   }
                                 }
                                 mcpServerManager.disconnectFromServer(server.id);
                                 mcpConfigStore.delete(server.id);
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
                      </div>
                    ))}
                  </div>
                   <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     Manage MCP servers for tool discovery and remote execution.
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
                      placeholder="e.g. llama3:latest"
                      className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-colors ${
                        dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                      }`}
                    />
                    <button
                      onClick={handlePullModel}
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
                          onClick={() => { setPullProgress(''); setPullError(false); handlePullModel(); }}
                          className="text-xs px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 shrink-0"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                   <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                     <div className={`px-3 py-2 font-semibold text-xs ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>Local Models</div>
                     {models.filter(m => !m.cloud).length === 0 && (
                       <p className={`text-xs p-3 italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No local models installed.</p>
                     )}
                     {models.filter(m => !m.cloud).map((m) => (
                       <div key={m.name} className={`flex items-center justify-between px-3 py-2 ${dark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}>
                         <span className="font-mono text-xs truncate">{m.name}</span>
                         <button onClick={() => handleDeleteModel(m.name)} className="ml-3 text-red-400 hover:text-red-300 text-xs shrink-0">
                           Remove
                         </button>
                       </div>
                     ))}
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
    </div>
  );
}

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
