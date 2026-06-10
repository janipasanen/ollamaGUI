import React, { useState, useEffect, useCallback } from 'react';
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

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('llama3');
  const [models, setModels] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [modelPullInput, setModelPullInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string>('');

  useEffect(() => {
    async function loadInitialData() {
      try {
        const availableModels = await fetchOllamaModels();
        const combinedModels = [
          ...availableModels.map(m => ({ name: m.name, cloud: false })),
          ...CLOUD_MODELS.map(m => ({ name: m, cloud: true }))
        ];
        setModels(combinedModels);
        if (combinedModels.length > 0) {
          setModel(combinedModels[0].name);
        }
      } catch (e) {
        console.error('Failed to load models', e);
      }
      
      const savedSessions = storage.getSessions();
      setSessions(savedSessions);
      
      const savedPrompt = localStorage.getItem('ollama_gui_system_prompt');
      if (savedPrompt) setSystemPrompt(savedPrompt);

      const savedTheme = localStorage.getItem('ollama_gui_theme');
      if (savedTheme !== null) setIsDarkMode(savedTheme === 'dark');
    }
    loadInitialData();
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setCurrentSessionId(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewChat]);

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    localStorage.setItem('ollama_gui_theme', newMode ? 'dark' : 'light');
  };

  const updateSystemPrompt = (newPrompt: string) => {
    setSystemPrompt(newPrompt);
    localStorage.setItem('ollama_gui_system_prompt', newPrompt);
  };

  const handlePullModel = async () => {
    if (!modelPullInput.trim()) return;
    setIsPulling(true);
    setPullProgress('Starting pull...');
    try {
      await pullOllamaModel(modelPullInput, (progress) => {
        setPullProgress(progress.status || 'Pulling...');
      });
      setPullProgress('Pull complete!');
      setModelPullInput('');
      const updatedModels = await fetchOllamaModels();
      setModels(updatedModels);
    } catch (e) {
      setPullProgress(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsPulling(false);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (CLOUD_MODELS.includes(modelName)) {
      alert('Cloud models cannot be deleted.');
      return;
    }
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) return;
    try {
      await deleteOllamaModel(modelName);
      const updatedModels = await fetchOllamaModels();
      const combinedModels = [
        ...updatedModels.map(m => ({ name: m.name, cloud: false })),
        ...CLOUD_MODELS.map(m => ({ name: m, cloud: true }))
      ];
      setModels(combinedModels);
      if (model === modelName) {
        setModel(combinedModels[0]?.name || 'llama3');
      }
    } catch (e) {
      alert(`Error deleting model: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setModel(session.model);
  };

  const deleteSession = (id: string) => {
    storage.deleteSession(id);
    setSessions(storage.getSessions());
    if (currentSessionId === id) {
      startNewChat();
    }
  };

  const saveCurrentSession = (currentMessages: Message[]) => {
    if (currentSessionId === null) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: currentMessages[0]?.content.slice(0, 30) + '...' || 'New Chat',
        messages: currentMessages,
        createdAt: Date.now(),
        model: model,
      };
      storage.saveSession(newSession);
      setCurrentSessionId(newSession.id);
      setSessions(storage.getSessions());
    } else {
      const session = storage.getSessions().find(s => s.id === currentSessionId);
      if (session) {
        storage.saveSession({
          ...session,
          messages: currentMessages,
          title: session.messages[0]?.content.slice(0, 30) + '...' || session.title,
        });
        setSessions(storage.getSessions());
      }
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    
    const chatHistory: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
      userMessage
    ];

    setMessages([...messages, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let assistantContent = '';
      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages([...messages, userMessage, assistantMessage]);

      await fetchOllamaChatStream(
        model,
        chatHistory,
        (chunk) => {
          if (chunk.message && chunk.message.content) {
            assistantContent += chunk.message.content;
            const updatedMessages = [
              ...messages,
              userMessage,
              { role: 'assistant', content: assistantContent },
            ];
            setMessages(updatedMessages);
            saveCurrentSession(updatedMessages);
          }
        }
      );
    } catch (e) {
      setMessages([
        ...messages,
        userMessage,
        { role: 'assistant', content: 'Error: Could not connect to Ollama.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`flex h-screen font-sans transition-colors duration-300 ${
      isDarkMode ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
    }`}>
      {/* Sidebar */}
      <div className={`transition-all duration-300 border-r flex flex-col p-4 ${
        isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden p-0 border-none'
      } ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
        <h1 className="text-xl font-bold mb-8">Ollama GUI</h1>
        <button 
          onClick={startNewChat}
          className={`w-full py-2 px-4 rounded-lg transition-colors mb-4 ${
            isDarkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'
          }`}
        >
          + New Chat
        </button>
        <div className="flex-1 overflow-y-auto space-y-2">
          <p className={`text-xs uppercase font-semibold mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>History</p>
          {sessions.length === 0 && (
            <div className={`text-sm italic ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>No past conversations</div>
          )}
          {sessions.map((s) => (
            <div 
              key={s.id} 
              onClick={() => loadSession(s)}
              className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                currentSessionId === s.id 
                ? (isDarkMode ? 'bg-zinc-700 text-white' : 'bg-zinc-300 text-zinc-900') 
                : (isDarkMode ? 'hover:bg-zinc-700/50 text-zinc-300' : 'hover:bg-zinc-200 text-zinc-600')
              }`}
            >
              <span className="truncate text-sm flex-1">{s.title}</span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <button 
            onClick={toggleTheme}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              isDarkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              isDarkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className={`h-14 border-b flex items-center justify-between px-6 transition-colors duration-300 ${
          isDarkMode ? 'border-zinc-700 bg-zinc-900/50 text-zinc-100' : 'border-zinc-300 bg-white/50 text-zinc-900'
        } backdrop-blur-sm`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
            >
              ☰
            </button>
             <select 
               value={model} 
               onChange={(e) => setModel(e.target.value)}
               className={`text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 ${
                 isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
               }`}
             >
               {models.map((m) => (
                 <option key={m.name} value={m.name}>{m.name} {m.cloud ? '(Cloud)' : ''}</option>
               ))}
             </select>

          </div>
          <div className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Ollama API: localhost:11434</div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className={`h-full flex items-center justify-center italic ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              Start a conversation with your local AI.
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl p-4 rounded-2xl ${
                msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : (isDarkMode ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
              }`}>
                <div className={`text-xs font-bold mb-1 opacity-50 uppercase ${msg.role === 'user' ? 'text-white' : (isDarkMode ? 'text-zinc-400' : 'text-zinc-600')}`}>
                  {msg.role === 'system' ? 'System' : msg.role}
                </div>
                <div className={`prose max-w-none ${isDarkMode ? 'prose-invert' : 'prose-zinc'}`}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({node, inline, className, children, ...props}) {
                        const match = String(children).replace(/`([^`]*)\n/gm, '');
                        return !inline ? (
                          <SyntaxHighlighter
                            style={isDarkMode ? vscDarkPlus : oneLight}
                            language={match || 'ts'}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/`([^`]*)\n/gm, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={`px-1 rounded ${isDarkMode ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
                            {children}
                          </code>
                        )
                      }
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
              <div className={`p-4 rounded-2xl rounded-tl-none animate-pulse ${
                isDarkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-200 text-zinc-900'
              }`}>
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className={`p-6 transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-t from-zinc-900 to-transparent' : 'bg-gradient-to-t from-zinc-100 to-transparent'}`}>
          <div className="max-w-3xl mx-auto flex gap-4">
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Message Ollama..."
              className={`flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 ${
                isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
              }`}
            />
            <button 
              onClick={sendMessage}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white px-6 py-3 rounded-xl transition-colors font-semibold"
            >
              Send
            </button>
          </div>
          <div className={`text-center text-[10px] mt-3 ${isDarkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
            Ollama GUI - Built for speed and privacy.
          </div>
        </div>

        {/* Settings Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-md rounded-2xl p-6 shadow-2xl transition-colors duration-300 ${
              isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className={`hover:text-zinc-100 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>✕</button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>System Prompt</label>
                  <textarea 
                    value={systemPrompt}
                    onChange={(e) => updateSystemPrompt(e.target.value)}
                    className={`w-full h-32 border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-colors duration-300 ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                    }`}
                    placeholder="Enter the AI's persona..."
                  />
                  <p className={`text-[10px] mt-2 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    This prompt sets the behavior and personality of the AI for all new messages in a session.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
                >
                  Save & Close
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

              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <button 
            onClick={toggleTheme}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              isDarkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              isDarkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className={`h-14 border-b flex items-center justify-between px-6 transition-colors duration-300 ${
          isDarkMode ? 'border-zinc-700 bg-zinc-900/50 text-zinc-100' : 'border-zinc-300 bg-white/50 text-zinc-900'
        } backdrop-blur-sm`}>
          <select 
            value={model} 
            onChange={(e) => setModel(e.target.value)}
            className={`text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 ${
              isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
            }`}
          >
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          <div className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Ollama API: localhost:11434</div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className={`h-full flex items-center justify-center italic ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              Start a conversation with your local AI.
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl p-4 rounded-2xl ${
                msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : (isDarkMode ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
              }`}>
                <div className={`text-xs font-bold mb-1 opacity-50 uppercase ${msg.role === 'user' ? 'text-white' : (isDarkMode ? 'text-zinc-400' : 'text-zinc-600')}`}>
                  {msg.role === 'system' ? 'System' : msg.role}
                </div>
                <div className={`prose max-w-none ${isDarkMode ? 'prose-invert' : 'prose-zinc'}`}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({node, inline, className, children, ...props}) {
                        const match = String(children).replace(/`([^`]*)\n/gm, '');
                        return !inline ? (
                          <SyntaxHighlighter
                            style={isDarkMode ? vscDarkPlus : oneLight}
                            language={match || 'ts'}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/`([^`]*)\n/gm, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={`px-1 rounded ${isDarkMode ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
                            {children}
                          </code>
                        )
                      }
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
              <div className={`p-4 rounded-2xl rounded-tl-none animate-pulse ${
                isDarkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-200 text-zinc-900'
              }`}>
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className={`p-6 transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-t from-zinc-900 to-transparent' : 'bg-gradient-to-t from-zinc-100 to-transparent'}`}>
          <div className="max-w-3xl mx-auto flex gap-4">
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Message Ollama..."
              className={`flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 ${
                isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
              }`}
            />
            <button 
              onClick={sendMessage}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white px-6 py-3 rounded-xl transition-colors font-semibold"
            >
              Send
            </button>
          </div>
          <div className={`text-center text-[10px] mt-3 ${isDarkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
            Ollama GUI - Built for speed and privacy.
          </div>
        </div>

        {/* Settings Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-md rounded-2xl p-6 shadow-2xl transition-colors duration-300 ${
              isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className={`hover:text-zinc-100 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>✕</button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>System Prompt</label>
                  <textarea 
                    value={systemPrompt}
                    onChange={(e) => updateSystemPrompt(e.target.value)}
                    className={`w-full h-32 border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-colors duration-300 ${
                      isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                    }`}
                    placeholder="Enter the AI's persona..."
                  />
                  <p className={`text-[10px] mt-2 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    This prompt sets the behavior and personality of the AI for all new messages in a session.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
                >
                  Save & Close
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



