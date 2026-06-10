import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, fetchOllamaChatStream, fetchOllamaModels, pullOllamaModel, deleteOllamaModel } from './services/ollama';
import { ChatSession, storage } from './services/storage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

const CLOUD_MODELS = [
  'gemma4:31b-cloud',
  'nemotron-3-ultra:cloud',
  'gpt-oss:20b-cloud',
  'gpt-oss:120b-cloud',
  'ministral-3:14b-cloud',
  'devstral-small-2:24b-cloud',
  'devstral-2:123b-cloud',
  'deepseek-v4-pro:cloud',
];

const DEFAULT_BASE_URL = 'http://localhost:11434';

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

  // Model management state
  const [modelPullInput, setModelPullInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState('');

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
    const combined = [
      ...availableModels.map(m => ({ name: m.name, cloud: false })),
      ...CLOUD_MODELS.map(m => ({ name: m, cloud: true })),
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

  // Model management
  const handlePullModel = async () => {
    if (!modelPullInput.trim()) return;
    setIsPulling(true);
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
    } finally {
      setIsPulling(false);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (CLOUD_MODELS.includes(modelName)) { alert('Cloud models cannot be deleted.'); return; }
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

  const saveCurrentSession = (currentMessages: Message[]) => {
    if (currentSessionId === null) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: currentMessages[0]?.content.slice(0, 40) || 'New Chat',
        messages: currentMessages,
        createdAt: Date.now(),
        model,
      };
      storage.saveSession(newSession);
      setCurrentSessionId(newSession.id);
      setSessions(storage.getSessions());
    } else {
      const session = storage.getSessions().find(s => s.id === currentSessionId);
      if (session) {
        storage.saveSession({ ...session, messages: currentMessages });
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

  // M5 Issue 20: Image attachments
  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        setAttachedImages(prev => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // Send message
  const sendMessage = async () => {
    if (!input.trim() && attachedImages.length === 0) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      ...(attachedImages.length > 0 ? { images: [...attachedImages] } : {}),
    };

    const chatHistory: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
      userMessage,
    ];

    setMessages([...messages, userMessage]);
    setInput('');
    setAttachedImages([]);
    setIsLoading(true);

    try {
      let assistantContent = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const isCloudModel = CLOUD_MODELS.includes(model);

      await fetchOllamaChatStream(model, chatHistory, (chunk) => {
        if (chunk.message?.content) {
          assistantContent += chunk.message.content;
          setMessages(prev => {
            const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }] as Message[];
            saveCurrentSession(updated);
            return updated;
          });
        }
      }, url('/api/chat'), isCloudModel);
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: 'Error: Could not connect to Ollama. Check your endpoint in Settings.' },
      ]);
    } finally {
      setIsLoading(false);
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
              className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
            >
              ☰
            </button>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={`text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
              }`}
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}{m.cloud ? ' (Cloud)' : ''}</option>
              ))}
            </select>
           </div>
           <div className="flex items-center gap-3">
             {/* On mobile, show only essential buttons; others go in mobile menu */}
             {!isMobile ? (
               <>
                 <div className={`text-xs font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{ollamaBaseUrl}</div>
                 <button
                   onClick={() => setIsSettingsOpen(true)}
                   title="Settings (Ctrl+,)"
                   className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                 >
                   ⚙️
                 </button>
                 <button
                   onClick={() => setShowHelp(prev => !prev)}
                   title="Keyboard shortcuts (?)"
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
                   : (dark ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
               }`}>
                <div className="text-xs font-bold mb-2 opacity-50 uppercase">{msg.role}</div>

                {/* M5 Issue 20: Show attached images */}
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={`data:image/jpeg;base64,${img}`}
                        alt="attachment"
                        className="max-h-48 rounded-lg object-contain border border-white/20"
                      />
                    ))}
                  </div>
                )}

                <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const lang = (className || '').replace('language-', '') || 'text';
                        return !inline ? (
                          <SyntaxHighlighter
                            style={dark ? vscDarkPlus : oneLight}
                            language={lang}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
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
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className={`p-4 rounded-2xl rounded-tl-none animate-pulse ${dark ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area - Responsive: full width on mobile, constrained on desktop */}
        <div className={`p-4 md:p-6 pb-6 pt-2 shrink-0 ${
          dark ? 'bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-transparent' : 'bg-gradient-to-t from-zinc-100 via-zinc-100/80 to-transparent'
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
                    onClick={async () => {
                      try { await refreshModels(); alert('Connected successfully.'); }
                      catch { alert('Could not connect to endpoint.'); }
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
                    <p className={`text-xs mb-2 ${pullProgress.startsWith('Error') ? 'text-red-400' : (dark ? 'text-zinc-400' : 'text-zinc-500')}`}>
                      {pullProgress}
                    </p>
                  )}
                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
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
    </div>
  );
};

export default App;
