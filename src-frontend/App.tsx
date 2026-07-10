import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Message, fetchOllamaChatStream, fetchOllamaModels, pullOllamaModel, deleteOllamaModel, fetchCloudModels, SUGGESTED_MODELS, GenerationOptions, ModelInfo, assembleModelfile, createOllamaModel, computeGenStats, type GenStats } from './services/ollama';
import { classifyFit, fitLabel, fitColor, formatBytes, SystemMemory } from './services/modelFit';
import { ChatSession, Folder, Project, storage, searchSessions, orderSessions, sortSessions, SortMode, parseSessionImport } from './services/storage';
import { composeSystemPrompt } from './services/systemPrompt';
import {
  MemoryEntry,
  loadMemory, addMemoryEntry, removeMemoryEntry, composeMemoryBlock, getRelevantEntries,
} from './services/memory';
import {
  shouldCompact, compactConversation, makeSummarizeFn,
} from './services/compaction';
import { toolRegistry, registerBuiltInTools, registerCliTool, cliAllowlist, persistCliAllowlist, toolCallName, runCliOnce } from './services/tools';
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
import { performOAuthFlow, tokenStore } from './services/mcpAuth';
import { mcpServerManager, registerMcpShutdownHandler } from './services/mcp';
import { estimateConversationTokens, estimateTokens, formatTokenCount, formatCost } from './services/tokenEstimate';
import { validateMcpServer, isNonEmptySubmission, validateImageAttachments } from './services/requestValidation';
import { formatErrorLine } from './services/errorMessages';
import { secureWipeAll } from './services/secureStorage';
import Sources, { renderWithCitations } from './components/Sources';
import BrowserToolResult, { isBrowserToolName } from './components/BrowserToolResult';
import { registerBrowserTools, stopBrowserEngine } from './services/browser-tools';
import { setBrowserApprovalCallback, clearBrowserApprovalCallback, allowHost } from './services/browserApproval';
import { PanelShell, togglePanel, isPanelOpen, closeAllPanels } from './components/PanelShell';
import { registerDocumentTools, readDocument, detectDocumentFormat } from './services/documentTools';
import ArtifactPanel, { showArtifact, type AnyArtifact, type DocumentArtifactData } from './components/ArtifactPanel';
import './components/BrowserPane';
import './components/FileTreePanel';
import './components/TerminalPanel';
import { registerFileTreePanel } from './components/FileTreePanel';
import { registerTerminalPanel } from './components/TerminalPanel';
import LibreOfficeOnboarding from './components/LibreOfficeOnboarding';
import WelcomeScreen from './components/WelcomeScreen';
import { checkLibreOffice, convertDocument } from './services/documents';
import { needsOnboarding, markDismissed } from './services/libreOfficeOnboarding';
import { openSource } from './services/citations';
import {
  MlxAvailability, MlxSettings, DEFAULT_MLX_SETTINGS,
  checkMlxAvailable, loadMlxSettings, saveMlxSettings, applyMlxHierarchy,
  isMlxActive, startMlxServer, stopMlxServer, fetchMlxChatStream,
} from './services/mlx';
import { runCloudBrainLocalWorker } from './services/orchestrator';
import { pickDirectory, appendPathArg, getSystemMemory, safeSetItem } from './services/platform';
import { ThemeSettings, DEFAULT_THEME, ACCENTS, loadThemeSettings, saveThemeSettings, resolveDark, applyTheme, syncWindowTheme } from './services/theme';
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
  filterCommands, findCommand, runCommand, getAllCommands,
  loadUserCommands, addUserCommand, updateUserCommand, removeUserCommand,
} from './services/commands';
import {
  SavedPrompt,
  loadPrompts, addPrompt, removePrompt,
} from './services/promptLibrary';
import {
  BrowserScenario, ScenarioResult,
  listScenarios, saveScenario, deleteScenario, generateScenarioId, runScenario,
} from './services/scenario';
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
import { registerFileTools, readFile, listDir, writeFile } from './services/fileTools';
import { openWorkspace, getActiveRoot } from './services/workspace';

import { registerGitTools, gitDiff, gitStatus, gitStage, gitCommit } from './services/git';
import {
  AgentAutonomySettings, AutonomyLevel,
  loadSettings as loadAutonomySettings, saveSettings as saveAutonomySettings,
  isPlanMode,
} from './services/agentAutonomy';
import { registerHook, makeReadOnlyHook } from './services/toolHooks';
import { getEnabledToolFilter, listToolStatuses, setToolEnabled, loadDisabledTools } from './services/toolConfig';
import { registerMemoryTools } from './services/crossSessionMemory';
import { registerPythonTool } from './services/pyodide';
import { registerCheckpointTools } from './services/checkpoints';
import { registerTerminalTool } from './services/terminal';
import { registerImageDiffTool } from './services/imageDiff';
import { secretSet, secretDelete, secretListRefs, type SecretRef } from './services/secrets';
import { isAtTrigger, atQuery, getAtOptions, resolveAtMention, type AtOption } from './services/atCommand';
import { loadPinnedFiles, savePinnedFiles, addPinnedFile, dropPinnedFile, findPinnedFile, pinnedContextBlock, pinnedFilesSummary, type PinnedFile } from './services/pinnedFiles';
import { toggleTaskInMarkdown, reactChildrenToText } from './services/taskList';
import { openExternalUrl, isExternalUrl } from './services/openExternal';
import { isHashTrigger, hashQuery, getAutocompleteOptions, resolveContextRef, buildContextBlock, type AutocompleteOption, type ContextRef } from './services/hashCommand';
import { setDiffReviewCallback, clearDiffReviewCallback, type PendingEdit, type EditDecision } from './services/diffReview';
import { DiffReviewModal } from './components/DiffReviewModal';
import { setBatchReviewCallback, clearBatchReviewCallback } from './services/diffReview';
import { setEditAppliedCallback, clearEditAppliedCallback } from './services/diffReview';
import { autoCommitEdit, loadAutoCommitEdits, saveAutoCommitEdits, undoLastAutoCommit } from './services/autoCommit';
import { DiffReviewBatchModal } from './components/DiffReviewBatchModal';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { registerPlanTool, getPlan, setPlan, clearPlan, subscribe as subscribePlan, _resetPlanStore, type PlanItem } from './services/planStore';
import PlanPanel from './components/PlanPanel';
import { ChatSearch, findMessageMatches } from './components/ChatSearch';
import { CommandPalette, filterCommands as filterPaletteCommands, type PaletteCommand } from './components/CommandPalette';
import { formatMessageTime, formatDayLabel, isSameDay, conversationDateBucket } from './services/formatTime';
import { chatToMarkdown, messageToMarkdown, chatToPlainText, messageToPlainText, chatToHtml } from './services/chatToMarkdown';
import { computeConversationStats } from './services/conversationStats';
import { ConversationStatsButton } from './components/ConversationStatsButton';

import { listCollections, createCollection, deleteCollection, addFile, removeFile, getFilesForCollection, type KnowledgeCollection, type KnowledgeFile } from './services/knowledge';
import { loadProjectRules } from './services/projectRules';
import { initOpenApiServers } from './services/openapiTools';
import { registerWorkspaceRagTools } from './services/workspaceRag';
import { webSearch, loadWebSearchConfig, saveWebSearchConfig, formatResultsAsContext, type WebSearchConfig } from './services/websearch';

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

// Robustly focus an element by id once it exists in the DOM. The sidebar
// search input is conditionally mounted after the `/search` slash command flips
// `isSidebarOpen`/`searchQuery`; a fixed `setTimeout` can race the React commit
// and leave focus on the composer (#395). We poll on each animation frame with
// a small attempt cap so focus lands even under slow re-renders (macOS CI).
function focusElementWhenReady(id: string, attempts = 20): void {
  const el = document.getElementById(id);
  if (el) {
    (el as HTMLInputElement).focus({ preventScroll: true });
    // If focus was stolen back by a re-render, keep retrying until it sticks.
    if (document.activeElement === el || attempts <= 0) return;
    requestAnimationFrame(() => focusElementWhenReady(id, attempts - 1));
  } else if (attempts > 0) {
    setTimeout(() => focusElementWhenReady(id, attempts - 1), 16);
  }
}

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

// Code word-wrap toggle (#336): global setting shared with every CodeBlock
// via Context so it can be read/toggled without prop-drilling through
// MarkdownMessage.
const CodeWordWrapContext = React.createContext<{ wordWrap: boolean; toggle: () => void }>({ wordWrap: false, toggle: () => {} });

// Issue 22: standalone component so useState works per code block instance
const CODE_COLLAPSE_THRESHOLD = 20; // lines before collapse kicks in (#312)
const CodeBlock: React.FC<{ lang: string; code: string; dark: boolean; props: any; onApplyCode?: (code: string, lang: string) => void }> = React.memo(({ lang, code, dark, props, onApplyCode }) => {
  const { wordWrap, toggle } = React.useContext(CodeWordWrapContext);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const lineCount = code.split('\n').length;
  const shouldCollapse = lineCount > CODE_COLLAPSE_THRESHOLD;
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const [applied, setApplied] = React.useState(false);
  const handleApply = () => {
    if (onApplyCode) { onApplyCode(code, lang); setApplied(true); setTimeout(() => setApplied(false), 2000); }
  };
  return (
    <div className="relative group my-2">
      <div className={`flex items-center justify-between px-4 py-1.5 rounded-t-md text-xs ${
        dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-300 text-zinc-600'
      }`}>
        <span className="font-mono">{lang}{shouldCollapse && <span className="opacity-60 ml-1">({lineCount} lines)</span>}</span>
        <div className="flex items-center gap-2">
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
          {onApplyCode && (
            <button
              onClick={handleApply}
              aria-label="Apply code to file"
              title="Apply code to file"
              className={`transition-all px-2 py-0.5 rounded ${
                applied
                  ? 'text-green-400'
                  : (dark ? 'text-zinc-400 hover:text-zinc-200 opacity-0 group-hover:opacity-100' : 'text-zinc-500 hover:text-zinc-800 opacity-0 group-hover:opacity-100')
              }`}
            >
              {applied ? 'Applied!' : 'Apply'}
            </button>
          )}
          <button
            onClick={toggle}
            aria-label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            aria-pressed={wordWrap}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            className={`transition-all px-2 py-0.5 rounded ${
              wordWrap
                ? 'text-blue-400'
                : (dark ? 'text-zinc-400 hover:text-zinc-200 opacity-0 group-hover:opacity-100' : 'text-zinc-500 hover:text-zinc-800 opacity-0 group-hover:opacity-100')
            }`}
          >
            {wordWrap ? 'Wrap ✓' : 'Wrap'}
          </button>
        </div>
      </div>
      <div className={shouldCollapse && !expanded ? 'max-h-96 overflow-hidden relative' : ''}>
        <SyntaxHighlighter
          style={dark ? vscDarkPlus : oneLight}
          language={lang}
          PreTag="div"
          customStyle={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, whiteSpace: wordWrap ? 'pre-wrap' : 'pre', wordBreak: wordWrap ? 'break-word' : 'normal', overflowWrap: wordWrap ? 'break-word' : 'normal' }}
          {...props}
        >
          {code}
        </SyntaxHighlighter>
        {shouldCollapse && !expanded && (
          <div className={`absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t ${dark ? 'from-zinc-900' : 'from-white'} to-transparent flex items-end justify-center pb-1`}>
            <button
              onClick={() => setExpanded(true)}
              className={`text-xs px-3 py-1 rounded-full ${dark ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'}`}
            >Show all {lineCount} lines</button>
          </div>
        )}
      </div>
      {shouldCollapse && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className={`w-full text-xs py-1 ${dark ? 'bg-zinc-700 text-zinc-400 hover:text-zinc-200' : 'bg-zinc-300 text-zinc-600 hover:text-zinc-800'}`}
        >Collapse</button>
      )}
    </div>
  );
});

// Highlight search-query matches within React children by wrapping them in <mark> (#366).
function highlightChildren(children: React.ReactNode, query: string): React.ReactNode {
  if (!query || !query.trim()) return children;
  const q = query.trim();
  const re = new RegExp(`(${q.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const process = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      const parts = node.split(re);
      if (parts.length <= 1) return node;
      return parts.map((part, idx) =>
        idx % 2 === 1
          ? <mark key={idx} className="rounded bg-yellow-300/80 dark:bg-yellow-500/50 text-inherit">{part}</mark>
          : part
      );
    }
    if (Array.isArray(node)) return node.map(process);
    if (React.isValidElement(node)) {
      return React.cloneElement(node as any, {}, React.Children.map((node as any).props.children, process));
    }
    return node;
  };
  return process(children);
}

// Renders an assistant/user message as markdown with GFM, LaTeX math (KaTeX),
// syntax-highlighted code, and Mermaid diagrams. Exported for isolated testing.
export const MarkdownMessage: React.FC<{ content: string; dark: boolean; onToggleTask?: (itemText: string, checked: boolean) => void; highlightQuery?: string; onApplyCode?: (code: string, lang: string) => void }> = ({ content, dark, onToggleTask, highlightQuery, onApplyCode }) => (
  <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p({ children, ...rest }: any) { return <p {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</p>; },
        td({ children, ...rest }: any) { return <td {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</td>; },
        strong({ children, ...rest }: any) { return <strong {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</strong>; },
        em({ children, ...rest }: any) { return <em {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</em>; },
        h1({ children, ...rest }: any) { return <h1 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h1>; },
        h2({ children, ...rest }: any) { return <h2 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h2>; },
        h3({ children, ...rest }: any) { return <h3 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h3>; },
        h4({ children, ...rest }: any) { return <h4 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h4>; },
        code({ node, inline, className, children, ...props }: any) {
          const lang = (className || '').replace('language-', '') || 'text';
          const code = String(children).replace(/\n$/, '');
          if (!inline) {
            if (lang === 'mermaid') return <Mermaid code={code} dark={dark} />;
            return <CodeBlock lang={lang} code={code} dark={dark} props={props} onApplyCode={onApplyCode} />;
          }
          return (
            <code className={`px-1 rounded ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
              {children}
            </code>
          );
        },
        li({ className, children, ...rest }: any) {
          // Interactive GFM task-list checkboxes (#352).
          if (className !== 'task-list-item' || !onToggleTask) return <li className={className} {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</li>;
          const arr = React.Children.toArray(children);
          const inputIdx = arr.findIndex((c: any) => c?.type === 'input');
          const inputChild = inputIdx >= 0 ? (arr[inputIdx] as any) : null;
          const currentChecked = !!inputChild?.props?.checked;
          const labelKids = inputIdx >= 0 ? arr.filter((_, i) => i !== inputIdx) : arr;
          const itemText = reactChildrenToText(labelKids).trim();
          return (
            <li className={className} {...rest} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.25rem', listStyle: 'none' }}>
              <input type="checkbox" checked={currentChecked} onChange={() => onToggleTask(itemText, currentChecked)} aria-label={`Task: ${itemText}`} style={{ marginTop: '0.3em' }} />
              <span>{labelKids}</span>
            </li>
          );
        },
        a({ href, children, ...rest }: any) {
          // Open external http(s) links in the system browser (#354).
          if (!isExternalUrl(href)) return <a href={href} {...rest}>{children}</a>;
          return (
            <a href={href} {...rest} onClick={(e) => { e.preventDefault(); void openExternalUrl(href); }}>{children}</a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

// Collapsible tool-result block with a status header (#240).
// Mirrors agentic GUIs (Codex/Claude) that collapse tool output behind a
// summary showing the tool name + running/success/error state.
const TOOL_ERROR_RE = /^(error|tool blocked)/i;
export const ToolResultBlock: React.FC<{ name?: string; content: string; dark: boolean }> = ({ name, content, dark }) => {
  const isError = TOOL_ERROR_RE.test(content.trim());
  const lineCount = content.split('\n').length;
  const defaultOpen = lineCount <= 12;
  const preview = (content.split('\n').find(l => l.trim().length > 0) ?? '').slice(0, 80);
  return (
    <details open={defaultOpen} className={`rounded-lg border ${dark ? 'border-zinc-600' : 'border-zinc-300'}`}>
      <summary className={`cursor-pointer select-none px-3 py-1.5 text-xs flex items-center gap-2 ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
        <span aria-label={isError ? 'Tool error' : 'Tool success'} className={isError ? 'text-red-400' : 'text-emerald-400'}>
          {isError ? '✗' : '✓'}
        </span>
        <span className="font-mono font-semibold text-blue-400">{name ?? 'tool'}</span>
        {preview && <span className={`truncate opacity-70 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{preview}</span>}
      </summary>
      <div className="px-3 pb-2 pt-1">
        <MarkdownMessage content={content} dark={dark} />
      </div>
    </details>
  );
};

// Collapsible reasoning/thinking trace from Ollama reasoning models (#241).
export const ReasoningBlock: React.FC<{ reasoning: string; dark: boolean }> = ({ reasoning, dark }) => {
  if (!reasoning.trim()) return null;
  return (
    <details className={`mb-2 rounded-lg border ${dark ? 'border-zinc-600 bg-zinc-900/40' : 'border-zinc-300 bg-zinc-50'}`}>
      <summary className={`cursor-pointer select-none px-3 py-1.5 text-xs flex items-center gap-1.5 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
        <span aria-hidden="true">💭</span>
        <span className="font-semibold">Thinking</span>
      </summary>
      <div className={`px-3 pb-2 pt-1 text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
        <MarkdownMessage content={reasoning} dark={dark} />
      </div>
    </details>
  );
};

// Context-budget indicator: conversation tokens vs num_ctx (#242).
export const ContextBudget: React.FC<{ tokens: number; numCtx?: number; dark: boolean }> = ({ tokens, numCtx, dark }) => {
  const window = numCtx && numCtx > 0 ? numCtx : 4096;
  const pct = Math.min(100, Math.round((tokens / window) * 100));
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={`Context: ${tokens} / ${window} tokens (${pct}%)`}
      aria-label={`Context usage ${pct} percent`}
    >
      <span className={`inline-block w-16 h-1.5 rounded-full overflow-hidden ${dark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
        <span className={`block h-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>{pct}%</span>
    </span>
  );
};

const App: React.FC = () => {
  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('llama3');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [systemMemory, setSystemMemory] = useState<SystemMemory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Live agentic phase indicator: 'Thinking…' / 'Running: <tool>' / 'Waiting for approval' (#394).
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  // Agentic step/iteration progress (Codex CLI / Claude Code parity, #398).
  const [agentStep, setAgentStep] = useState<{ iteration: number; max: number } | null>(null);
  // Per-tool enable/disable (Claude Code parity, #399).
  const [disabledTools, setDisabledTools] = useState<Set<string>>(() => loadDisabledTools());
  // Auto-commit after agentic edits (Aider parity, #401).
  const [autoCommitEdits, setAutoCommitEdits] = useState<boolean>(() => loadAutoCommitEdits());
  // Agentic "Continue past max-iterations" affordance (Codex/Claude parity, #403).
  const [agentHitMax, setAgentHitMax] = useState(false);

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // Inline session rename (#52)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Transient toast notification (#58 and general feedback)
  const [notification, setNotification] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Organization (#133)
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Projects (#92)
  const [projects, setProjects] = useState<Project[]>(() => storage.getProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Agent autonomy settings (#88, #89, #146)
  const [autonomySettings, setAutonomySettings] = useState<AgentAutonomySettings>(() => loadAutonomySettings());

  // Memory (#95)
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>(() => loadMemory());
  const [newMemoryText, setNewMemoryText] = useState('');
  // Secret store UI state (#173)
  const [secretKeys, setSecretKeys] = useState<SecretRef[]>(() => secretListRefs());

  // Knowledge collection UI state (#117/#188)
  const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollection[]>([]);
  const [knowledgeFilesMap, setKnowledgeFilesMap] = useState<Record<string, KnowledgeFile[]>>({});
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);
  const [newSecretService, setNewSecretService] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');

  // Compaction (#95)
  const [autoCompact, setAutoCompact] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_auto_compact') ?? 'false'); } catch { return false; }
  });
  // Opt-in: resume the most recent conversation on startup (#356).
  const [resumeLastSession, setResumeLastSession] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_resume_last_session') ?? 'false'); } catch { return false; }
  });
  // Code word-wrap toggle (#336) — global setting shared with every CodeBlock.
  const [codeWordWrap, setCodeWordWrap] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_code_wordwrap') ?? 'false'); } catch { return false; }
  });
  // Send on Ctrl+Enter instead of Enter (#374) — ChatGPT/Claude/Slack parity.
  const [sendOnCtrlEnter, setSendOnCtrlEnter] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_send_on_ctrl_enter') ?? 'false'); } catch { return false; }
  });
  const toggleCodeWordWrap = useCallback(() => {
    setCodeWordWrap(prev => {
      const next = !prev;
      safeSetItem('ollama_gui_code_wordwrap', JSON.stringify(next));
      return next;
    });
  }, []);
  // Font-size / zoom control (#342) — scales the document root font-size.
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('ollama_gui_font_scale') ?? '1');
    return Number.isFinite(v) ? Math.min(1.5, Math.max(0.8, v)) : 1;
  });
  const adjustFontScale = useCallback((delta: number) => {
    setFontScale(prev => {
      const next = Math.min(1.5, Math.max(0.8, Math.round((prev + delta) * 10) / 10));
      safeSetItem('ollama_gui_font_scale', String(next));
      return next;
    });
  }, []);
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
  // Composed system-prompt preview overlay (#376).
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  // In-conversation search (#247)
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  // Command palette (#251)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME);
  // Temporary/incognito chat: held in memory only, never persisted (#134).
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [contextWarningDismissed, setContextWarningDismissed] = useState(false);
  const [recentModels, setRecentModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_recent_models') ?? '[]'); } catch { return []; }
  });
 // Starred/favourite models (#339) — pinned to the top of the selector.
 const [starredModels, setStarredModels] = useState<string[]>(() => {
   try { return JSON.parse(localStorage.getItem('ollama_gui_starred_models') ?? '[]'); } catch { return []; }
 });
  // Models currently loaded in Ollama memory (#478) — refreshed periodically
  // so the selector shows a ● badge next to warm models (LM Studio / Codex parity).
  const [runningModels, setRunningModels] = useState<Set<string>>(new Set());
  const toggleStarModel = useCallback((name: string) => {
    setStarredModels(prev => {
      const next = prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name];
      safeSetItem('ollama_gui_starred_models', JSON.stringify(next));
      return next;
    });
  }, []);
  const [playSoundOnComplete, setPlaySoundOnComplete] = useState<boolean>(() => {
    try { return localStorage.getItem('ollama_gui_sound_complete') === 'true'; } catch { return false; }
  });
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(() => {
    try { return localStorage.getItem('ollama_gui_notify_complete') === 'true'; } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(false);
  const [isAgenticMode, setIsAgenticMode] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    command: string;
    cwd?: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // Plan/ask tool-approval modal (#88/#89/#189)
  const [pendingToolApproval, setPendingToolApproval] = useState<{
    toolName: string;
    args: Record<string, unknown>;
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

  // Browser scenarios (#78/#200)
  const [scenarios, setScenarios] = useState<BrowserScenario[]>(() => listScenarios());
  const [scenarioResults, setScenarioResults] = useState<Record<string, ScenarioResult>>({});
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [newScenarioName, setNewScenarioName] = useState('');

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
  // Remote Ollama quick-add state
  const [newRemoteOllamaUrl, setNewRemoteOllamaUrl] = useState('');
  const [newRemoteOllamaName, setNewRemoteOllamaName] = useState('');

  // Many-models conversation (#126)
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);

  // Image generation (#130)
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenConfig>(() => loadImageGenConfig());

  // Speech-to-text (#131)
  const [sttConfig, setSttConfig] = useState<SttConfig>(() => loadSttConfig());

  // Web search config (#121/#192)
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(() => loadWebSearchConfig());
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [whisperAvailable, setWhisperAvailable] = useState<boolean | null>(null);

  // Prompt library (#97)
  const [prompts, setPrompts] = useState<SavedPrompt[]>(() => loadPrompts());
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptBody, setNewPromptBody] = useState('');

  // Conversation branching (#98)
  const [branchState, setBranchState] = useState<BranchState>(emptyBranchState());
  // Trunk messages always hold the full canonical history; branchState tracks alternatives
  const trunkMessagesRef = useRef<Message[]>([]);
  // /redo stack: stores exchanges dropped by /undo so they can be restored (#389).
  const redoStackRef = useRef<{ messages: Message[]; branch: BranchState }[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  // Artifact canvas (#99)
  // The panel itself is owned by PanelShell; App only tracks whether an
  // artifact is available so the toolbar toggle can appear/disappear.
  const [latestArtifact, setLatestArtifact] = useState<AnyArtifact | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null); // full-size image preview (#351)
  const [showLoOnboarding, setShowLoOnboarding] = useState(false); // LibreOffice onboarding (#145)

  // Slash commands (#96)
  const [commandSuggestions, setCommandSuggestions] = useState<SlashCommand[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // @-mention file autocomplete (#86/#183)
  const [atSuggestions, setAtSuggestions] = useState<AtOption[]>([]);
  const [atSelected, setAtSelected] = useState(0);

  // #-knowledge context injection (#119/#184)
  const [hashSuggestions, setHashSuggestions] = useState<AutocompleteOption[]>([]);
  const [hashSelected, setHashSelected] = useState(0);
  const [pendingContextBlocks, setPendingContextBlocks] = useState<string[]>([]);
  // Aider-style pinned file context (#350)
  const [pinnedFiles, setPinnedFiles] = useState<PinnedFile[]>(() => loadPinnedFiles());

  // Project rules file content (#93/#190)
  const [projectRulesContent, setProjectRulesContent] = useState<string | null>(null);

  // Diff review modal (#84/#185)
  const [pendingDiffEdit, setPendingDiffEdit] = useState<PendingEdit | null>(null);
  const diffReviewResolveRef = useRef<((d: EditDecision) => void) | null>(null);
  // Batch (multi-file) diff review modal (#400)
  const [pendingDiffEdits, setPendingDiffEdits] = useState<PendingEdit[] | null>(null);
  const batchDiffResolveRef = useRef<((d: EditDecision[]) => void) | null>(null);

  // Live plan checklist (#239) — rendered when the agent calls update_plan.
  const [plan, setPlanState] = useState<PlanItem[]>(() => getPlan());

  const [userCommands, setUserCommands] = useState<SlashCommand[]>(() => loadUserCommands());
  const [newCmd, setNewCmd] = useState({ name: '', description: '', template: '' });

  // Web Speech API voice (#101)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [copiedMdMsgIdx, setCopiedMdMsgIdx] = useState<number | null>(null);
  const [copiedPtMsgIdx, setCopiedPtMsgIdx] = useState<number | null>(null);
  const [regenMenuIdx, setRegenMenuIdx] = useState<number | null>(null);
  // Right-click context menu on chat messages (#378).
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  // Right-click context menu on sidebar session items (#381).
  const [sessionContextMenu, setSessionContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [rawView, setRawView] = useState<Record<number, boolean>>({});
  const [collapsedMsg, setCollapsedMsg] = useState<Record<number, boolean>>({});
  const [copiedChat, setCopiedChat] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

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

  // Session-only auto-approve list for general agent tools (#406, Codex/Claude
  // "Yes, and don't ask again" parity). Not persisted — resets on reload, like
  // the CLI `cliAllowlist`.
  const sessionToolAllowlistRef = useRef<Set<string>>(new Set());

  // Plan-mode gating (#408, Codex/Claude plan-mode parity): until the user
  // approves the published plan, mutating tools are blocked; after approval
  // the agent executes the plan without per-tool prompts for the rest of the
  // run. Resets each run.
  const planApprovedRef = useRef(false);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<{
    toolName: string;
    resolve: (approved: boolean) => void;
  } | null>(null);
  // Plan-approval edit mode (#409): lets the user tweak the published plan
  // steps before approving (Codex plan-edit parity).
  const [planEditDraft, setPlanEditDraft] = useState<string[] | null>(null);

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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  // New-messages unread badge while the user is scrolled up (#255)
  const [unreadCount, setUnreadCount] = useState(0);
  // Live tick so relative timestamps ("just now" / "5m ago") stay fresh (#260)
  const [nowTick, setNowTick] = useState(() => Date.now());
  const prevMsgCountRef = useRef(0);
  // Force a scroll-to-bottom when loading a session so the latest messages show (#258)
  const scrollToEndOnLoadRef = useRef(false);
  // Per-session composer drafts (#273): sessionId -> unsent input text.
  const draftsRef = useRef<Record<string, string>>({});
  // Prompt history for Alt+Up/Alt+Down recall (#332)
  const promptHistoryRef = useRef<string[]>([]);
  const historyNavIndexRef = useRef<number>(-1);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string; title: string }>({ open: false, id: '', title: '' });
  // Bulk selection / bulk archive-delete (#338)
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
 const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Drag-and-drop folder assignment (#364)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // Derived: filtered sessions for search (Issue 18)
  // Search across title/tags/folder/content, then apply archive + folder filters,
  // ordered pinned-first (#133). Memoized so sidebar filtering doesn't re-run on
  // every unrelated render (#32).
  const filteredSessions = React.useMemo(() => sortSessions(
    searchSessions(sessions, searchQuery, folders)
      .filter(s => (showArchived ? !!s.archived : !s.archived))
      .filter(s => folderFilter === null || s.folderId === folderFilter)
      // Filter by tag (#306): null = no tag filter
      .filter(s => tagFilter === null || (s.tags ?? []).includes(tagFilter))
      // Filter by active project (#92): null = no project = show unscoped sessions
      .filter(s => activeProjectId === null ? !s.projectId : s.projectId === activeProjectId),
    sortMode
  ), [sessions, searchQuery, folders, showArchived, folderFilter, tagFilter, activeProjectId, sortMode]);

  // Conversation token estimate, memoized so it only recomputes when the
  // messages or current draft change (#32, #62).
  const conversationTokens = React.useMemo(
    () => estimateConversationTokens(messages) + (input ? estimateTokens(input) : 0),
    [messages, input],
  );

  // Context limit warning (#319) — show a banner when usage exceeds 80%.
  const contextPct = genOptions.num_ctx ? Math.round((conversationTokens / genOptions.num_ctx) * 100) : 0;
  const showContextWarning = contextPct >= 80 && !contextWarningDismissed;
  // Auto-reset the dismissed flag when usage drops below 80%.
  useEffect(() => { if (contextPct < 80) setContextWarningDismissed(false); }, [contextPct]);

  // In-conversation search matches (#247)
  const chatSearchMatches = React.useMemo(
    () => findMessageMatches(messages, chatSearchQuery),
    [messages, chatSearchQuery],
  );
  const chatSearchCurrent = chatSearchMatches.length > 0
    ? chatSearchMatches[Math.min(chatSearchIndex, chatSearchMatches.length - 1)]
    : -1;

  // Scroll the current search match into view (#247)
  useEffect(() => {
    if (!chatSearchOpen || chatSearchCurrent < 0) return;
    const el = document.querySelector(`[data-msg-index="${chatSearchCurrent}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [chatSearchOpen, chatSearchCurrent]);

  const goChatSearch = (dir: 1 | -1) => {
    if (chatSearchMatches.length === 0) return;
    setChatSearchIndex(prev => {
      const n = prev + dir;
      if (n < 0) return chatSearchMatches.length - 1;
      if (n >= chatSearchMatches.length) return 0;
      return n;
    });
  };

  const url = (path: string) => `${ollamaBaseUrl}${path}`;

  const refreshModels = useCallback(async () => {
    const availableModels = await fetchOllamaModels(url('/api/tags'));
    setOllamaConnected(true);
    const cloudModels = await fetchCloudModels();
    const combined: ModelInfo[] = [
      ...availableModels.map(m => ({ ...m, cloud: isCloudModel(m.name) })), // preserve size/quant
      ...cloudModels,
    ];
   setModels(combined);
   // Fetch extra connection models in parallel (#123)
   fetchAllConnectionModels(loadConnections()).then(setConnectedModels).catch(() => {});
    // Refresh running models list (#478)
    fetchRunningModels(url('/api/ps'))
      .then(r => setRunningModels(new Set(r.map(m => m.name))))
      .catch(() => {});
   return combined;
 }, [ollamaBaseUrl]);

  // Poll running models every 30s so the warm indicator stays current (#478).
  useEffect(() => {
    const id = setInterval(() => {
      fetchRunningModels(url('/api/ps'))
        .then(r => setRunningModels(new Set(r.map(m => m.name))))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [ollamaBaseUrl]);

  useEffect(() => {
    async function loadInitialData() {
      const savedUrl = localStorage.getItem('ollama_gui_base_url');
      if (savedUrl) setOllamaBaseUrl(savedUrl);

      const savedSortMode = localStorage.getItem('ollama_gui_sort_mode');
    if (savedSortMode === 'recent' || savedSortMode === 'name' || savedSortMode === 'messages') {
      setSortMode(savedSortMode as SortMode);
    }
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

      // Token hygiene: purge expired, non-refreshable OAuth tokens (#34)
      void tokenStore.cleanupAllExpired(mcpConfigStore.list().map(s => s.id)).catch(() => {});

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
      // File & git tools (#83, #103) — must be called once; workspace root is
      // set separately when a project is activated (see activeProjectId effect).
      registerFileTools();
      // Diff review callback (#84/#185) — intercepts write_file/apply_edit for user approval
      setDiffReviewCallback((edit: PendingEdit) =>
       new Promise<EditDecision>(resolve => {
         setPendingDiffEdit(edit);
         diffReviewResolveRef.current = resolve;
       })
     );
     // Batch (multi-file) diff review callback (#400) — intercepts apply_patch
     // with several ops for a single combined review.
     setBatchReviewCallback((edits: PendingEdit[]) =>
      new Promise<EditDecision[]>(resolve => {
        setPendingDiffEdits(edits);
        batchDiffResolveRef.current = resolve;
      })
    );
     // Auto-commit after an edit is applied to disk (#401). Reads the setting
     // fresh from localStorage so toggling it takes effect immediately.
     setEditAppliedCallback((path, label) => { void autoCommitEdit(path, label, loadAutoCommitEdits()); });
     // Wire the read-only mode hook (#146) so the hook chain enforces it.
      registerHook('builtin:read-only', makeReadOnlyHook());
      // Cross-session memory tools (#95/#178) — memory_set/get/list/delete
      registerMemoryTools();
      // In-browser Python execution via Pyodide (#128/#179)
      registerPythonTool();
      // File-state checkpoints (#91/#180) — create_checkpoint / rewind_checkpoint
      registerCheckpointTools();
      // Live plan/todo checklist tool (#239) — update_plan
      registerPlanTool();
      // Streaming terminal sessions (#87/#186) — run_terminal
      registerTerminalTool();
      registerTerminalPanel();
      registerFileTreePanel();
      // Visual screenshot diffing (#79/#187) — diff_screenshots
      registerImageDiffTool();
      // Workspace RAG tools (#94/#194) — index_workspace / query_workspace
      registerWorkspaceRagTools();
      // Re-register saved OpenAPI tool servers (#129/#191)
      void initOpenApiServers();
      // Web search agent tool (#121/#192) — search_web
      if (!toolRegistry.getTool('search_web')) {
        toolRegistry.registerTool({
          name: 'search_web',
          description: 'Search the web using DuckDuckGo (or SearXNG if configured). Returns titles, URLs, and snippets.',
          readOnly: true,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query.' },
              count: { type: 'number', description: 'Number of results (default 5).' },
            },
            required: ['query'],
          },
          execute: async (args: unknown) => {
            const { query, count } = args as { query: string; count?: number };
            const cfg = loadWebSearchConfig();
            const results = await webSearch(query, { ...cfg, enabled: true, resultCount: count ?? cfg.resultCount });
            return { results };
          },
        });
      }
      // Multi-format document tools (read/create/convert/formats) — #144
      registerDocumentTools();
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
      // Register AI browser-control tools (#74); sensitive actions reuse the
      // same approval modal as CLI tools.
      registerBrowserTools(async (action: string, detail: string) => {
        return new Promise<boolean>((resolve) => {
          setPendingApproval({ command: `Browser ${action}: ${detail}`, resolve });
        });
      });
      // Browser approval callback for host allow-listing (#77/#193)
      setBrowserApprovalCallback(async (req) => {
        const approved = await new Promise<boolean>(resolve =>
          setPendingApproval({ command: `Browser ${req.action}: ${req.detail}`, resolve })
        );
        if (approved && req.url) allowHost(req.url);
        return { approved };
      });

      try {
        const combined = await refreshModels();
        if (combined.length > 0) setModel(combined[0].name);
      } catch (e) {
        console.error('Failed to load models', e);
        setOllamaConnected(false);
      }
    }
    loadInitialData();
  }, []);

  // Cleanup diff review and browser approval callbacks on unmount (#185, #193)
  useEffect(() => () => { clearDiffReviewCallback(); clearBatchReviewCallback(); clearEditAppliedCallback(); clearBrowserApprovalCallback(); }, []);
  // Refresh relative timestamps every minute (#260)
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Apply font-scale zoom to the document root so rem-based Tailwind scales uniformly (#342)
  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round(16 * fontScale)}px`;
  }, [fontScale]);

  // Reset the composer height when the input is cleared after sending (#259)
  useEffect(() => {
    if (input === '') {
      const ta = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (ta) ta.style.height = 'auto';
    }
  }, [input]);

  // Subscribe to the plan store so the checklist re-renders on update_plan (#239).
  useEffect(() => subscribePlan(setPlanState), []);

  // Load knowledge collections when Settings panel opens (#117/#188)
  useEffect(() => {
    if (isSettingsOpen) void listCollections().then(setKnowledgeCollections);
  }, [isSettingsOpen]);

  // Keep trunk in sync with messages during normal (non-branch-navigating) operation.
  useEffect(() => {
    const onBranch = branchState.forkNav.some(n => n.activeIndex !== -1);
    if (!onBranch) trunkMessagesRef.current = messages;
  }, [messages, branchState]);

  const isNearBottom = useCallback((): boolean => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 60; // px
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollButton(false);
    setUnreadCount(0);
  }, []);

  const scrollToTop = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
    setShowScrollTopButton(false);
  }, []);

  useEffect(() => {
    // Keep relative timestamps fresh whenever messages change (#260)
    setNowTick(Date.now());
    // Loading a session: jump to the bottom so the latest messages show (#258)
    if (scrollToEndOnLoadRef.current) {
      scrollToEndOnLoadRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      setUnreadCount(0);
      prevMsgCountRef.current = messages.length;
      return;
    }
    const added = Math.max(0, messages.length - prevMsgCountRef.current);
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    } else if (added > 0) {
      // New messages arrived while the user is scrolled up (#255)
      setUnreadCount(c => c + added);
    }
    prevMsgCountRef.current = messages.length;
    // Focus the composer on initial load for accessibility (#259). Only grab
    // focus when nothing else has it — a slash command such as `/search` may
    // have moved focus to the sidebar search; don't steal it back (#395).
    if (messages.length === 0) {
      const input = document.getElementById('chat-input');
      if (input) {
        setTimeout(() => {
          const ae = document.activeElement;
          if (ae === null || ae === document.body) input.focus();
        }, 100);
      }
    }
  }, [messages, isNearBottom]);

  // Show/hide the scroll-to-bottom button based on scroll position.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const near = isNearBottom();
      setShowScrollButton(!near);
      setShowScrollTopButton(container.scrollTop > 300);
      if (near) setUnreadCount(0);
    };
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, [isNearBottom]);

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

  // Stop the CDP engine when the app unmounts / user closes the window (#176).
  useEffect(() => {
    const handler = () => { void stopBrowserEngine(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void stopBrowserEngine();
    };
  }, []);

  // Sync workspace root, git tools, project rules, and per-project model bindings when the active project changes (#83, #93, #103, #171, #190, #194).
  useEffect(() => {
    const project = projects.find(p => p.id === activeProjectId);
    if (project?.workspaceRoot) {
      void openWorkspace(project.workspaceRoot);
      registerGitTools(project.workspaceRoot);
      // Load AGENTS.md / CLAUDE.md for system-prompt injection (#93/#190)
      void loadProjectRules(project.workspaceRoot).then(setProjectRulesContent);
    } else {
      setProjectRulesContent(null);
    }
    // Apply per-project model overrides if they are set (#171).
    if (project?.model) setModel(project.model);
    if (project?.brainModel || project?.workerModel) {
      setMlxSettings(prev => ({
        ...prev,
        ...(project.brainModel ? { brainModel: project.brainModel } : {}),
        ...(project.workerModel ? { workerModel: project.workerModel } : {}),
      }));
    }
 }, [activeProjectId, projects]);

  // Wire file-tree clicks into the composer — pin the selected file into
  // context (#363). FileTreePanel dispatches this event but nothing consumed
  // it before, so clicking a file did nothing.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { entry: { path: string; name: string; is_dir: boolean } } | undefined;
      if (!detail?.entry || detail.entry.is_dir) return;
      const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
      const fullPath = detail.entry.path;
      const relPath = wsRoot && fullPath.startsWith(wsRoot)
        ? fullPath.slice(wsRoot.replace(/\/$/, '').length + 1)
        : detail.entry.name;
      void (async () => {
        try {
          const content = await readFile(fullPath);
          if (!content) { showStatusBanner(`File "${relPath}" is empty`); return; }
          const next = addPinnedFile(pinnedFiles, { path: relPath, label: detail.entry.name, content });
          setPinnedFiles(next);
          savePinnedFiles(next);
          showStatusBanner(`Pinned "${relPath}" (${content.length} chars) — ${next.length} file${next.length > 1 ? 's' : ''} in context`);
        } catch (err) {
          showStatusBanner(`Could not read "${relPath}": ${formatErrorLine(err)}`);
        }
      })();
    };
    window.addEventListener('ollama-gui:select-file', handler);
    return () => window.removeEventListener('ollama-gui:select-file', handler);
  }, [activeProjectId, projects, pinnedFiles]);

  const startNewChat = useCallback((projectId?: string | null) => {
    setMessages([]);
    trunkMessagesRef.current = [];
    setBranchState(emptyBranchState());
    setCurrentSessionId(null);
    setAttachedImages([]);
    setInput('');
    setIsTemporary(false);
    setMessageQueue([]);
    setLatestArtifact(null);
    setPinnedFiles([]);
    savePinnedFiles([]);
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
    setLatestArtifact(null);
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

  // Play a short beep via Web Audio API (#320).
  const playCompletionSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch { /* AudioContext may be blocked — silently ignore */ }
  }, []);

  // Zen/Focus mode (#309): hides sidebar, closes panels, simplifies header.
  const toggleZenMode = () => {
    setZenMode(prev => {
      const next = !prev;
      if (next) {
        setIsSidebarOpen(false);
        closeAllPanels();
      } else {
        setIsSidebarOpen(true);
      }
      return next;
    });
  };
  // Ref for conversation-switch fn (defined after loadSession, called from the
  // keyboard handler that runs earlier) — avoids use-before-declaration (#300).
  const switchConversationRef = useRef<(direction: 1 | -1) => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;

      // Escape closes the in-conversation search even while focused in its input (#247)
      if (e.key === 'Escape' && chatSearchOpen) {
        e.preventDefault();
        setChatSearchOpen(false);
        return;
      }
      // Escape closes the image lightbox (#351)
      if (e.key === 'Escape' && lightboxImage) {
        e.preventDefault();
        setLightboxImage(null);
        return;
      }
      // Escape closes the command palette even while focused in its input (#251)
      if (e.key === 'Escape' && paletteOpen) {
        e.preventDefault();
        setPaletteOpen(false);
        return;
      }
      // Escape cancels an in-progress generation when no overlay is open (#257),
      // mirroring Codex CLI / Claude Code interrupt behaviour.
      if (e.key === 'Escape' && isLoading && !chatSearchOpen && !paletteOpen && !isSettingsOpen && !showHelp && !pendingToolApproval && !pendingApproval && !pendingPlanApproval) {
        e.preventDefault();
        abortControllerRef.current?.abort();
        return;
      }
      // Escape closes the settings/help overlays even while focused in an input (#257)
      if (e.key === 'Escape' && (isSettingsOpen || showHelp || promptPreview)) {
        e.preventDefault();
        if (isSettingsOpen) setIsSettingsOpen(false);
        else if (showHelp) setShowHelp(false);
        else setPromptPreview(null);
        return;
      }
      // Command palette works even while focused in the chat input (#251)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        return;
      }
      // In-conversation search works even while focused in the chat input (#247)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setChatSearchOpen(prev => !prev);
        setChatSearchIndex(0);
        return;
      }
      // File-tree panel toggle moved to Ctrl/Cmd+Shift+F (#248)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        if (isTyping) return;
        e.preventDefault();
        togglePanel('files');
        return;
      }

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
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        togglePanel('browser'); // toggle browser preview via PanelShell (#71)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        togglePanel('terminal'); // toggle terminal panel via PanelShell (#87)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'End') {
        e.preventDefault();
        scrollToBottom(); // Ctrl/Cmd+End jumps to the latest message (#278)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toggleTheme(); // Ctrl/Cmd+Shift+D toggles dark/light (#275)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        // Copy the last assistant reply to the clipboard (#272)
        for (let j = messages.length - 1; j >= 0; j--) {
          if (messages[j].role === 'assistant' && messages[j].content) {
            navigator.clipboard.writeText(messages[j].content);
            notify('Copied last reply');
            break;
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        regenerateLastResponse(); // Ctrl/Cmd+R regenerates the last reply (#264)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        document.getElementById('chat-input')?.focus(); // Ctrl/Cmd+L focuses the composer (#265)
      } else if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        switchConversationRef.current(1); // Next conversation (#300)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        switchConversationRef.current(-1); // Previous conversation (#300)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        toggleZenMode(); // Zen/Focus mode (#309)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        togglePanel('artifacts'); // Toggle artifacts panel (#372)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (currentSessionId) {
          const wasPinned = !!sessions.find(x => x.id === currentSessionId)?.pinned;
          togglePin(currentSessionId);
          showStatusBanner(wasPinned ? 'Unpinned conversation' : 'Pinned conversation');
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        adjustFontScale(0.1);
        showStatusBanner(`Zoom: ${Math.round(fontScale * 100)}%`);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        adjustFontScale(-0.1);
        showStatusBanner(`Zoom: ${Math.round(fontScale * 100)}%`);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        setFontScale(1);
        safeSetItem('ollama_gui_font_scale', '1');
        showStatusBanner('Zoom reset to 100%');
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewChat, isSettingsOpen, showHelp, chatSearchOpen, paletteOpen, isLoading, messages, toggleTheme, scrollToBottom, currentSessionId, sessions, promptPreview, pendingToolApproval, pendingApproval, pendingPlanApproval]);

  // Keyboard shortcuts for the CLI approval modal (#361) — Enter = Allow Once,
  // Escape = Deny, A = Always Allow.
  useEffect(() => {
    if (!pendingApproval) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pendingApproval) return;
      const active = document.activeElement;
      const isButton = active instanceof HTMLButtonElement;
      if (e.key === 'Escape') {
        e.preventDefault();
        pendingApproval.resolve(false);
        setPendingApproval(null);
      } else if (e.key === 'Enter' && !isButton) {
        e.preventDefault();
        pendingApproval.resolve(true);
        setPendingApproval(null);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        cliAllowlist.add(pendingApproval.command);
        persistCliAllowlist();
        pendingApproval.resolve(true);
        setPendingApproval(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingApproval]);

  // Keyboard shortcuts for the agent tool approval modal (#407, Codex/Claude
  // parity with the CLI approval modal #361): Escape = Deny, Enter = Allow,
  // A = Allow for session.
  useEffect(() => {
    if (!pendingToolApproval) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pendingToolApproval) return;
      const active = document.activeElement;
      const isButton = active instanceof HTMLButtonElement;
      if (e.key === 'Escape') {
        e.preventDefault();
        pendingToolApproval.resolve(false);
        setPendingToolApproval(null);
      } else if (e.key === 'Enter' && !isButton) {
        e.preventDefault();
        pendingToolApproval.resolve(true);
        setPendingToolApproval(null);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sessionToolAllowlistRef.current.add(pendingToolApproval.toolName);
        pendingToolApproval.resolve(true);
        setPendingToolApproval(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingToolApproval]);

  // Keyboard shortcuts for the plan-mode approval modal (#408): Escape =
  // Deny, Enter = Approve plan.
  useEffect(() => {
    if (!pendingPlanApproval) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pendingPlanApproval) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        pendingPlanApproval.resolve(false);
        setPendingPlanApproval(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        planApprovedRef.current = true;
        pendingPlanApproval.resolve(true);
        setPendingPlanApproval(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPlanApproval]);

  // When mode is 'system', track OS light/dark changes live.
  useEffect(() => {
    if (themeSettings.mode !== 'system') return;
    let mq: MediaQueryList;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return; }
    const onChange = () => setIsDarkMode(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeSettings.mode]);

  // Keep the native OS window chrome (macOS title bar / traffic lights) in sync
  // with the in-app theme so it isn't stuck light while the app is dark.
  useEffect(() => {
    void syncWindowTheme(isDarkMode);
  }, [isDarkMode]);

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
    safeSetItem('ollama_gui_system_prompt', val);
  };

  const updateGenOptions = (patch: Partial<GenerationOptions>) => {
    setGenOptions(prev => {
      const next = { ...prev, ...patch };
      safeSetItem('ollama_gui_gen_options', JSON.stringify(next));
      return next;
    });
  };

  const updateStructuredOutput = (patch: Partial<{ enabled: boolean; schema: string }>) => {
    setStructuredOutput(prev => {
      const next = { ...prev, ...patch };
      safeSetItem('ollama_gui_structured', JSON.stringify(next));
      return next;
    });
    setSchemaError(null);
  };

  const updateBaseUrl = (val: string) => {
    setOllamaBaseUrl(val);
    safeSetItem('ollama_gui_base_url', val);
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
    // Restore this session's saved composer draft (#273)
    setInput(draftsRef.current[session.id] ?? '');
    // Loading a chat should show the latest messages and never a false unread badge (#258)
    prevMsgCountRef.current = session.messages.length;
    setUnreadCount(0);
    scrollToEndOnLoadRef.current = true;
  };

  // Opt-in: resume the most recent conversation on startup (#356).
  useEffect(() => {
    if (!resumeLastSession) return;
    const all = storage.getSessions();
    if (all.length === 0) return;
    const recent = all
      .filter(s => !s.archived)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    if (recent) loadSession(recent);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the in-progress composer text to the active session's draft (#273).
  useEffect(() => {
    if (currentSessionId) draftsRef.current[currentSessionId] = input;
  }, [input, currentSessionId]);

  // Cycle to the next/previous conversation in the filtered session list (#300).
  // Parity with ChatGPT / Discord / Slack keyboard navigation (Ctrl+] / Ctrl+[).
  // Stored in a ref so the keyboard handler (declared earlier) can call it.
  useEffect(() => {
    switchConversationRef.current = (direction: 1 | -1) => {
      if (filteredSessions.length === 0) return;
      const currentIdx = filteredSessions.findIndex(s => s.id === currentSessionId);
      let nextIdx: number;
      if (currentIdx === -1) {
        nextIdx = direction === 1 ? 0 : filteredSessions.length - 1;
      } else {
        nextIdx = (currentIdx + direction + filteredSessions.length) % filteredSessions.length;
      }
      loadSession(filteredSessions[nextIdx]);
    };
  }, [filteredSessions, currentSessionId]);

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

  // Duplicate a conversation into a new session (#286).
  const duplicateSession = (id: string) => {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    const copy: ChatSession = {
      ...s,
      id: Date.now().toString(),
      title: `Copy of ${s.title}`,
      createdAt: Date.now(),
      pinned: false,
      archived: false,
    };
    const result = storage.saveSession(copy);
    if (result.ok === false && result.error === 'quota') setStorageWarning(true);
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
  const renameFolder = (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    const name = window.prompt('Rename folder', folder.name)?.trim();
    if (!name || name === folder.name) return;
    storage.saveFolder({ ...folder, name });
    setFolders(storage.getFolders());
  };

  const deleteSession = (id: string, title?: string) => {
    if (confirmDelete.open) return;
    setConfirmDelete({ open: true, id, title: title ?? 'this chat' });
  };
  const confirmDeleteSession = () => {
    const { id } = confirmDelete;
    if (!id) return;
    storage.deleteSession(id);
    setSessions(storage.getSessions());
    if (currentSessionId === id) startNewChat();
    setConfirmDelete({ open: false, id: '', title: '' });
  };

  const closeConfirmDelete = useCallback(() => {
    setConfirmDelete({ open: false, id: '', title: '' });
  }, []);

  // ─── Bulk selection / bulk archive-delete (#338) ─────────────────────────
  const toggleBulkSelected = (id: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const enterBulkSelect = () => { setBulkSelectMode(true); setBulkSelectedIds(new Set()); };
  const exitBulkSelect = () => { setBulkSelectMode(false); setBulkSelectedIds(new Set()); };
  const bulkArchiveSelected = () => {
    bulkSelectedIds.forEach(id => {
      const sess = sessions.find(x => x.id === id);
      storage.updateSession(id, { archived: !sess?.archived });
    });
    setSessions(storage.getSessions());
    exitBulkSelect();
  };
  const bulkDeleteSelected = () => { setConfirmBulkDelete(true); };
  const confirmBulkDeleteSession = () => {
    bulkSelectedIds.forEach(id => storage.deleteSession(id));
    setSessions(storage.getSessions());
    if (currentSessionId && bulkSelectedIds.has(currentSessionId)) startNewChat();
    setConfirmBulkDelete(false);
    exitBulkSelect();
  };

  // Close the delete confirmation on Escape (#202). The global keydown handler
  // only covers Settings/Help, so this dedicated effect handles the modal.
  useEffect(() => {
    if (!confirmDelete.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmDelete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDelete.open, closeConfirmDelete]);

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

  // Export the current conversation as a Markdown file (#256)
  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
    const md = chatToMarkdown(messages, { title });
    const blob = new Blob([md], { type: 'text/markdown' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    const safe = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat';
    a.download = `${safe}.md`;
    a.click();
    URL.revokeObjectURL(href);
  };

  // Export a single message as a Markdown file (#304).
  const handleExportMessage = (msg: Message, index: number) => {
    const md = messageToMarkdown(msg);
    const blob = new Blob([md], { type: 'text/markdown' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    const role = msg.role || 'message';
    a.download = `${role}_${index + 1}.md`;
    a.click();
    URL.revokeObjectURL(href);
  };

  // Copy the current conversation as Markdown to the clipboard (#261)
  const handleCopyMarkdown = async () => {
    if (messages.length === 0) return;
    const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
    const md = chatToMarkdown(messages, { title });
    try {
      await navigator.clipboard.writeText(md);
      setCopiedChat(true);
      setTimeout(() => setCopiedChat(false), 1500);
    } catch {
      // Clipboard may be unavailable (permissions/old browsers) — no-op.
    }
  };

  // Show a brief ephemeral status banner (used by /model, #263).
  const showStatusBanner = (text: string) => {
    setStatusBanner(text);
    window.setTimeout(() => setStatusBanner(null), 2500);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = parseSessionImport(ev.target?.result as string);
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

  // M5 Issue 20: Image attachments — shared attach pipeline used by the
  // file picker, drag-and-drop, and clipboard paste (#250).
  const attachImageFiles = (files: File[]) => {
    // Shared validation: count cap, MIME allowlist, size limit (#31/#59).
    const { valid, errors } = validateImageAttachments(files, attachedImages.length);
    if (errors.length > 0) alert(errors.join('\n'));
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) setAttachedImages(prev => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    attachImageFiles(Array.from(files));
    e.target.value = '';
  };

  // Drag-and-drop image attachment onto the composer (#250)
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length > 0) attachImageFiles(images);
    // Drag a file from the file tree into the composer to pin it (#388).
    const dt = e.dataTransfer;
    const droppedPath = typeof dt?.getData === 'function' ? dt.getData('text/file-path') : '';
    if (droppedPath) {
      const droppedName = (typeof dt?.getData === 'function' ? dt.getData('text/file-name') : '') || droppedPath.split(/[\\/]/).pop() || droppedPath;
      window.dispatchEvent(new CustomEvent('ollama-gui:select-file', { detail: { entry: { path: droppedPath, name: droppedName, is_dir: false } } }));
    }
  };

  // Paste image from clipboard into the composer (#250)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length > 0) {
      e.preventDefault();
      attachImageFiles(images);
    }
  };

  const cancelStream = () => {
    abortControllerRef.current?.abort();
    // If the agent is blocked on an approval prompt (CLI command #361, agent
    // tool #88, or plan #408), the AbortSignal alone can't unblock the awaited
    // promise — resolve it as denied so the loop reaches its top-of-iteration
    // abort guard and completes cleanly, and close the modal immediately.
    if (pendingApproval) { pendingApproval.resolve(false); setPendingApproval(null); }
    if (pendingToolApproval) { pendingToolApproval.resolve(false); setPendingToolApproval(null); }
    if (pendingPlanApproval) { pendingPlanApproval.resolve(false); setPendingPlanApproval(null); setPlanEditDraft(null); }
    setIsLoading(false);
    setAgentStatus(null);
    setAgentStep(null);
  };

  // Send message
  const sendMessage = async (textOverride?: string, modelOverride?: string, continueMode: boolean = false) => {
    let text = textOverride ?? input;
    // Agentic "Continue past max-iterations" (#403): re-run the agentic loop with
    // the current context (no new user message). Reset the hit-max flag on entry.
    setAgentHitMax(false);
    // Each run starts with the plan un-approved (#408).
    planApprovedRef.current = false;
    setPendingPlanApproval(null);
    if (continueMode) text = '';
    // Record non-slash-command prompts for Alt+Up/Alt+Down recall (#332)
    if (!text.trimStart().startsWith('/') && text.trim()) {
      promptHistoryRef.current = [...promptHistoryRef.current.filter(t => t !== text), text].slice(-50);
      historyNavIndexRef.current = promptHistoryRef.current.length;
    }
    // Prepend resolved # context blocks (#119/#184). Always clear them after
    // any send so stale chips don't persist across slash-command / action paths.
    if (pendingContextBlocks.length > 0) {
      text = pendingContextBlocks.join('\n\n') + '\n\n' + text;
      setPendingContextBlocks([]);
    }
    if (!continueMode && !text.trim() && attachedImages.length === 0) return;

    // Slash commands (#96) — dispatch before /image special case
    if (text.trimStart().startsWith('/') && !text.trimStart().startsWith('/image ')) {
      const result = runCommand(text.trim());
      if (result.kind === 'builtin') {
        setInput('');
        setCommandSuggestions([]);
        if (result.action === 'clear') {
          // /clear clears the messages of the current conversation in place
          // (keeping the session entry), distinct from /new which starts a
          // fresh session (#345).
          if (messages.length === 0 && currentSessionId === null) { showStatusBanner('Nothing to clear'); return; }
          const cleared: Message[] = [];
          setMessages(cleared);
          trunkMessagesRef.current = cleared;
          setBranchState(emptyBranchState());
          setAttachedImages([]);
          setInput('');
          setMessageQueue([]);
          setLatestArtifact(null);
          setPinnedFiles([]);
          savePinnedFiles([]);
          if (currentSessionId && !isTemporary) {
            saveCurrentSession(cleared, emptyBranchState());
            showStatusBanner('Cleared messages in this conversation');
          } else {
            showStatusBanner('Cleared messages');
          }
          return;
        }
        if (result.action === 'help') { setShowHelp(true); return; }
        if (result.action === 'model') {
          const arg = (result.arg ?? '').trim();
          if (!arg) {
            showStatusBanner(`Current model: ${model}`);
          } else if (models.some(m => m.name === arg)) {
            setModel(arg);
            showStatusBanner(`Switched model to ${arg}`);
          } else {
            showStatusBanner(`Model "${arg}" not found`);
          }
          return;
        }
        if (result.action === 'rename') {
          const arg = (result.arg ?? '').trim();
          if (!arg) {
            showStatusBanner('Usage: /rename <title>');
          } else if (currentSessionId) {
            storage.updateSession(currentSessionId, { title: arg });
            setSessions(storage.getSessions());
            showStatusBanner(`Renamed conversation to "${arg}"`);
          } else {
            showStatusBanner('Save the chat first to rename it');
          }
          return;
        }
        if (result.action === 'export') {
          const arg = (result.arg ?? '').trim().toLowerCase();
          if (messages.length === 0) {
            showStatusBanner('Nothing to export — the conversation is empty');
          } else if (arg === 'json') {
            // Export the current conversation as a JSON file (#323)
            const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
            const session = currentSessionId ? sessions.find(s => s.id === currentSessionId) : null;
            const exportData = session ?? { id: currentSessionId ?? 'temp', title, messages, model, createdAt: Date.now() };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            const safe = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat';
            a.download = `${safe}.json`;
            a.click();
            URL.revokeObjectURL(href);
            showStatusBanner('Exported conversation as JSON');
          } else if (arg === 'txt') {
            // Export the current conversation as plain text (#333)
            const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
            const txt = chatToPlainText(messages, { title });
            const blob = new Blob([txt], { type: 'text/plain' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            const safe = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat';
            a.download = `${safe}.txt`;
            a.click();
            URL.revokeObjectURL(href);
            showStatusBanner('Exported conversation as plain text');
          } else if (arg === 'html') {
            // Export the current conversation as a self-contained HTML file (#343)
            const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
            const html = chatToHtml(messages, { title });
            const blob = new Blob([html], { type: 'text/html' });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            const safe = title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat';
            a.download = `${safe}.html`;
            a.click();
            URL.revokeObjectURL(href);
            showStatusBanner('Exported conversation as HTML');
          } else {
            handleExportMarkdown();
            showStatusBanner('Exported conversation as Markdown');
          }
          return;
        }
        if (result.action === 'new') {
          startNewChat();
          return;
        }
        if (result.action === 'undo') {
          // /undo drops the last user+assistant exchange (#346) and pushes it
          // onto the redo stack so /redo can restore it (#389).
          if (messages.length === 0) { showStatusBanner('Nothing to undo'); return; }
          if (isLoading) { showStatusBanner('Cannot undo while generating'); return; }
          let cut = messages.length;
          if (messages[cut - 1]?.role === 'assistant') cut -= 1;
          if (cut - 1 >= 0 && messages[cut - 1]?.role === 'user') cut -= 1;
          if (cut === messages.length) { showStatusBanner('Nothing to undo'); return; }
          const removed = messages.length - cut;
          const remaining = messages.slice(0, cut);
          redoStackRef.current.push({ messages: messages.slice(cut), branch: branchState });
          setMessages(remaining);
          trunkMessagesRef.current = remaining;
          setBranchState(emptyBranchState());
          setLatestArtifact(null);
          saveCurrentSession(remaining, emptyBranchState());
          showStatusBanner(`Undid last exchange (${removed} message${removed > 1 ? 's' : ''})`);
          return;
        }
        if (result.action === 'redo') {
          // /redo restores the most recently undone exchange (#389).
          if (isLoading) { showStatusBanner('Cannot redo while generating'); return; }
          const popped = redoStackRef.current.pop();
          if (!popped || popped.messages.length === 0) { showStatusBanner('Nothing to redo'); return; }
          const restored = [...messages, ...popped.messages];
          setMessages(restored);
          trunkMessagesRef.current = restored;
          setBranchState(popped.branch);
          saveCurrentSession(restored, popped.branch);
          showStatusBanner(`Redid last exchange (${popped.messages.length} message${popped.messages.length > 1 ? 's' : ''})`);
          return;
        }
        if (result.action === 'diff') {
          // /diff feeds the current git diff into the chat as context (#347).
          const arg = (result.arg ?? '').trim().toLowerCase();
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          if (isLoading) { showStatusBanner('Cannot run /diff while generating'); return; }
          const staged = arg === 'staged';
          void (async () => {
            try {
              const res = await gitDiff(wsRoot, undefined, staged);
              const diff = res?.diff?.trim() ?? '';
              if (!diff) { showStatusBanner(staged ? 'No staged changes' : 'No uncommitted changes'); return; }
              const content = `${staged ? 'Staged' : 'Unstaged'} uncommitted changes for review:\n\n\`\`\`diff\n${diff}\n\`\`\``;
              void sendMessage(content);
              showStatusBanner(`Injected ${staged ? 'staged' : 'working-tree'} diff (${diff.length} chars)`);
            } catch (err) {
              showStatusBanner(`git diff failed: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'reset') {
          // /reset restores generation parameters to defaults (#348).
          const defaults = { num_ctx: 4096 };
          setGenOptions(defaults);
          safeSetItem('ollama_gui_gen_options', JSON.stringify(defaults));
          showStatusBanner('Reset generation parameters to defaults');
          return;
        }
        if (result.action === 'tokens') {
          // /tokens per-source context breakdown (#349).
          const activeProject = projects.find(p => p.id === activeProjectId);
          const memBlock = composeMemoryBlock(activeProjectId ?? undefined);
          const pinnedBlock = pinnedContextBlock(pinnedFiles);
          const rulesTokens = estimateTokens(projectRulesContent ?? '');
          const instrTokens = estimateTokens(activeProject?.instructions ?? '');
          const memTokens = estimateTokens(memBlock ?? '');
          const sysTokens = estimateTokens(systemPrompt);
          const pinnedTokens = estimateTokens(pinnedBlock);
          const convTokens = estimateConversationTokens(messages);
          const inputTokens = estimateTokens(input);
          const total = rulesTokens + instrTokens + memTokens + sysTokens + pinnedTokens + convTokens + inputTokens;
          const ctx = genOptions.num_ctx ?? 4096;
          const pct = Math.round((total / ctx) * 100);
          showStatusBanner(
            `Context tokens (est.): rules ${formatTokenCount(rulesTokens)} · instructions ${formatTokenCount(instrTokens)} · memory ${formatTokenCount(memTokens)} · system ${formatTokenCount(sysTokens)} · pinned ${formatTokenCount(pinnedTokens)} · conversation ${formatTokenCount(convTokens)} · input ${formatTokenCount(inputTokens)} · total ${formatTokenCount(total)} (${pct}% of ${ctx})`,
          );
          return;
        }
        if (result.action === 'add') {
          // /add pins a file into the chat context across turns (#350).
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /add <file-path>'); return; }
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          const isAbs = arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg);
          const fullPath = isAbs ? arg : wsRoot.replace(/\/$/, '') + '/' + arg;
          const label = arg.split(/[\\/]/).pop() ?? arg;
          void (async () => {
            try {
              const content = await readFile(fullPath);
              if (!content) { showStatusBanner(`File "${arg}" is empty`); return; }
              const next = addPinnedFile(pinnedFiles, { path: arg, label, content });
              setPinnedFiles(next);
              savePinnedFiles(next);
              showStatusBanner(`Pinned "${arg}" (${content.length} chars) — ${next.length} file${next.length > 1 ? 's' : ''} in context`);
            } catch (err) {
              showStatusBanner(`Could not read "${arg}": ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'drop') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /drop <file-path>'); return; }
          if (!findPinnedFile(pinnedFiles, arg)) { showStatusBanner(`"${arg}" is not pinned`); return; }
          const next = dropPinnedFile(pinnedFiles, arg);
          setPinnedFiles(next);
          savePinnedFiles(next);
          showStatusBanner(`Dropped "${arg}" — ${next.length} file${next.length === 1 ? '' : 's'} remaining`);
          return;
        }
        if (result.action === 'files') {
          showStatusBanner(pinnedFilesSummary(pinnedFiles));
          return;
        }
        if (result.action === 'run') {
          // /run executes a shell command and feeds its output into chat (#353).
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /run <command>'); return; }
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          void (async () => {
            try {
              showStatusBanner(`Running: ${arg}…`);
              const res = await runCliOnce(arg, wsRoot);
              const output = res.timed_out
                ? `[TIMED OUT]\n${res.stderr || ''}`
                : `${res.stdout || ''}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`.trim() || '(no output)';
              const content = `Output of \`${arg}\` (exit ${res.exit_code}${res.timed_out ? ', timed out' : ''}):\n\n\`\`\`\n${output}\n\`\`\``;
              void sendMessage(content);
              showStatusBanner(`Ran "${arg}" — exit ${res.exit_code}`);
            } catch (err) {
              showStatusBanner(`Run failed: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'commit') {
          // /commit stages all changes and commits, generating a message if
          // none is supplied (#357).
          const arg = (result.arg ?? '').trim();
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          if (isLoading) { showStatusBanner('Cannot commit while generating'); return; }
          void (async () => {
            try {
              const status = await gitStatus(wsRoot);
              const files = [...(status.unstaged ?? []), ...(status.untracked ?? [])];
              if (files.length === 0) { showStatusBanner('Nothing to commit — working tree clean'); return; }
              let message = arg;
              if (!message) {
                showStatusBanner('Generating commit message…');
                const diff = (await gitDiff(wsRoot)).diff || files.join(', ');
                const genMessages: Message[] = [
                  { role: 'user', content: `Write a concise conventional commit message (<=72 char subject, no body) for the following changes. Reply with ONLY the commit message, nothing else:\n\n${diff.slice(0, 8000)}` },
                ];
                const isCloudModel = models.some(m => m.name === model && m.cloud);
                const commitEndpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : url('/api/chat');
                await fetchOllamaChatStream(model, genMessages, (chunk) => {
                  if (chunk.message?.content) message += chunk.message.content;
                }, commitEndpoint, false, genOptions, undefined);
                message = message.trim().split('\n')[0].slice(0, 72);
                if (!message) { showStatusBanner('Could not generate a commit message — provide one with /commit <message>'); return; }
              }
              await gitStage(wsRoot, files);
              const result2 = await gitCommit(wsRoot, message);
              showStatusBanner(`Committed ${result2.hash}: ${message}`);
            } catch (err) {
              showStatusBanner(`Commit failed: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'tests') {
          // /tests runs a test command and feeds failures to the model (#359).
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /tests <command>'); return; }
          if (isLoading) { showStatusBanner('Cannot run /tests while generating'); return; }
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          void (async () => {
            try {
              showStatusBanner(`Running tests: ${arg}…`);
              const res = await runCliOnce(arg, wsRoot);
              const output = `${res.stdout || ''}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`.trim() || '(no output)';
              if (res.exit_code === 0) {
                showStatusBanner('Tests passed');
                return;
              }
              const content = `The following tests are failing (exit ${res.exit_code}${res.timed_out ? ', timed out' : ''}). Please investigate and fix them:\n\n\`\`\`\n${output}\n\`\`\``;
              void sendMessage(content);
              showStatusBanner(`Tests failed (exit ${res.exit_code}) — fed to model`);
            } catch (err) {
              showStatusBanner(`Tests failed to run: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'init') {
          // /init generates an AGENTS.md project-rules file from the workspace (#365).
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          if (isLoading) { showStatusBanner('Cannot run /init while generating'); return; }
          void (async () => {
            try {
              showStatusBanner('Generating AGENTS.md…');
              const entries = await listDir(wsRoot);
              const fileList = entries
                .map(e => e.is_dir ? `${e.name}/` : e.name)
                .slice(0, 60)
                .join('\n');
              let generated = '';
              const initMessages: Message[] = [
                { role: 'user', content: `You are analysing a codebase to produce an AGENTS.md file. Below is the top-level directory listing of the project root. Write a concise AGENTS.md with: (1) a one-paragraph project summary, (2) coding conventions (language, style, naming), (3) build/test/run commands (infer from common files like package.json, Cargo.toml, Makefile, etc.), (4) project structure notes. Reply with ONLY the AGENTS.md content in Markdown, no commentary.

Directory listing:
${fileList}` },
              ];
              const isCloudModel = models.some(m => m.name === model && m.cloud);
              const initEndpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : url('/api/chat');
              await fetchOllamaChatStream(model, initMessages, (chunk) => {
                if (chunk.message?.content) generated += chunk.message.content;
              }, initEndpoint, false, genOptions, undefined);
              generated = generated.trim();
              if (!generated) { showStatusBanner('Could not generate AGENTS.md — try again or write one manually'); return; }
              await writeFile(`${wsRoot.replace(/\/$/, '')}/AGENTS.md`, generated);
              void loadProjectRules(wsRoot).then(setProjectRulesContent);
              showStatusBanner('AGENTS.md created — project rules loaded');
            } catch (err) {
              showStatusBanner(`Failed to create AGENTS.md: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'web') {
          // /web searches the web and feeds results into the chat (#371).
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /web <query>'); return; }
          if (isLoading) { showStatusBanner('Cannot search while generating'); return; }
          void (async () => {
            try {
              showStatusBanner(`Searching the web: ${arg}…`);
              const results = await webSearch(arg, { ...webSearchConfig, enabled: true });
              if (results.length === 0) { showStatusBanner('No web search results — check your web search settings'); return; }
              const block = formatResultsAsContext(results);
              const content = `Web search results for "${arg}":

${block}`;
              void sendMessage(content);
              showStatusBanner(`Found ${results.length} result${results.length > 1 ? 's' : ''} — fed to model`);
            } catch (err) {
              showStatusBanner(`Web search failed: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'settings') {
          // /settings opens the settings overlay (#375).
          setIsSettingsOpen(true);
          return;
        }
        if (result.action === 'prompt') {
          // /prompt previews the full composed system prompt (#376).
          const activeProject = projects.find(p => p.id === activeProjectId);
          const memBlock = composeMemoryBlock(activeProjectId ?? undefined);
          const composed = composeSystemPrompt({
            systemPrompt,
            rulesFileContent: projectRulesContent ?? undefined,
            projectInstructions: activeProject?.instructions,
            memoryBlock: memBlock || undefined,
          });
          setPromptPreview(composed);
          return;
        }
        if (result.action === 'search') {
          const arg = (result.arg ?? '').trim();
          setIsSidebarOpen(true);
          if (arg) setSearchQuery(arg);
          // Focus the sidebar search once it is rendered. A retry loop is used
          // instead of a fixed timeout so focus sticks across React commits
          // (the sidebar input mounts asynchronously after the state updates).
          focusElementWhenReady('sidebar-search');
          return;
        }
        if (result.action === 'copy') {
          const arg = (result.arg ?? '').trim().toLowerCase();
          if (messages.length === 0) {
            showStatusBanner('Nothing to copy — the conversation is empty');
          } else if (arg === 'txt') {
            const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
            const txt = chatToPlainText(messages, { title });
            navigator.clipboard?.writeText(txt).then(() => showStatusBanner('Copied conversation as plain text')).catch(() => showStatusBanner('Clipboard unavailable'));
          } else {
            void handleCopyMarkdown();
            showStatusBanner('Copied conversation as Markdown');
          }
          return;
        }
        if (result.action === 'pin') {
          if (!currentSessionId) { showStatusBanner('Save the chat first to pin it'); return; }
          const wasPinned = !!sessions.find(x => x.id === currentSessionId)?.pinned;
          togglePin(currentSessionId);
          showStatusBanner(wasPinned ? 'Unpinned conversation' : 'Pinned conversation');
          return;
        }
        if (result.action === 'archive') {
          if (!currentSessionId) { showStatusBanner('Save the chat first to archive it'); return; }
          const wasArchived = !!sessions.find(x => x.id === currentSessionId)?.archived;
          toggleArchive(currentSessionId);
          showStatusBanner(wasArchived ? 'Unarchived conversation' : 'Archived conversation');
          return;
        }
        if (result.action === 'tag') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /tag <name>'); return; }
          if (!currentSessionId) { showStatusBanner('Save the chat first to tag it'); return; }
          const s = sessions.find(x => x.id === currentSessionId);
          const tags = Array.from(new Set([...(s?.tags ?? []), arg]));
          storage.updateSession(currentSessionId, { tags });
          setSessions(storage.getSessions());
          showStatusBanner(`Tagged conversation with "${arg}"`);
          return;
        }
        if (result.action === 'duplicate') {
          if (!currentSessionId) { showStatusBanner('Save the chat first to duplicate it'); return; }
          duplicateSession(currentSessionId);
          showStatusBanner('Duplicated conversation');
          return;
        }
        if (result.action === 'title') {
          if (!currentSessionId) { showStatusBanner('Save the chat first to retitle it'); return; }
          const title = generateTitle(messages);
          storage.updateSession(currentSessionId, { title });
          setSessions(storage.getSessions());
          showStatusBanner(`Retitled conversation to "${title}"`);
          return;
        }
        if (result.action === 'folder') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /folder <name>'); return; }
          if (!currentSessionId) { showStatusBanner('Save the chat first to folder it'); return; }
          let folder = folders.find(f => f.name.toLowerCase() === arg.toLowerCase());
          if (!folder) {
            folder = { id: `f_${Date.now()}`, name: arg, order: folders.length };
            storage.saveFolder(folder);
            setFolders(storage.getFolders());
          }
          moveToFolder(currentSessionId, folder.id);
          showStatusBanner(`Moved conversation to folder "${arg}"`);
          return;
        }
        if (result.action === 'system') {
          const arg = result.arg ?? '';
          if (!arg.trim()) {
            showStatusBanner(`System prompt: ${systemPrompt}`);
          } else {
            setSystemPrompt(arg);
            safeSetItem('ollama_gui_system_prompt', arg);
            showStatusBanner('System prompt updated');
          }
          return;
        }
        if (result.action === 'temp') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Temperature: ${genOptions.temperature ?? 'default'}`); return; }
          const v = Number(arg);
          if (!Number.isFinite(v) || v < 0 || v > 2) { showStatusBanner('Temperature must be a number between 0 and 2'); return; }
          updateGenOptions({ temperature: v });
          showStatusBanner(`Temperature set to ${v}`);
          return;
        }
        if (result.action === 'ctx') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Context window: ${genOptions.num_ctx ?? 4096}`); return; }
          const v = Math.round(Number(arg));
          if (!Number.isFinite(v) || v < 512) { showStatusBanner('Context window must be a number >= 512'); return; }
          updateGenOptions({ num_ctx: v });
          showStatusBanner(`Context window set to ${v}`);
          return;
        }
        if (result.action === 'topp') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Top-p: ${genOptions.top_p ?? 'default'}`); return; }
          const v = Number(arg);
          if (!Number.isFinite(v) || v < 0 || v > 1) { showStatusBanner('Top-p must be a number between 0 and 1'); return; }
          updateGenOptions({ top_p: v });
          showStatusBanner(`Top-p set to ${v}`);
          return;
        }
        if (result.action === 'predict') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Max tokens: ${genOptions.num_predict === undefined ? 'unlimited' : genOptions.num_predict}`); return; }
          const v = Math.round(Number(arg));
          if (!Number.isFinite(v) || (v !== -1 && v < 1)) { showStatusBanner('Max tokens must be a positive integer (or -1 for unlimited)'); return; }
          updateGenOptions({ num_predict: v });
          showStatusBanner(v === -1 ? 'Max tokens set to unlimited' : `Max tokens set to ${v}`);
          return;
        }
        if (result.action === 'stop') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Stop sequences: ${genOptions.stop && genOptions.stop.length ? genOptions.stop.join(', ') : 'none'}`); return; }
          if (arg.toLowerCase() === 'clear') { updateGenOptions({ stop: [] }); showStatusBanner('Stop sequences cleared'); return; }
          const seqs = arg.split(',').map(s => s.trim()).filter(Boolean);
          if (seqs.length === 0) { showStatusBanner('Stop sequences: provide comma-separated values'); return; }
          updateGenOptions({ stop: seqs });
          showStatusBanner(`Stop sequences set to ${seqs.length}`);
          return;
        }
        if (result.action === 'topk') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner(`Top-k: ${genOptions.top_k ?? 'default'}`); return; }
          const v = Math.round(Number(arg));
          if (!Number.isFinite(v) || v < 0) { showStatusBanner('Top-k must be a non-negative integer'); return; }
          updateGenOptions({ top_k: v });
          showStatusBanner(v === 0 ? 'Top-k set to 0 (disabled)' : `Top-k set to ${v}`);
          return;
        }
        if (result.action === 'cost') {
          const cost = formatCost(conversationTokens);
          const budgetPct = genOptions.num_ctx ? Math.round((conversationTokens / genOptions.num_ctx) * 100) : 0;
          showStatusBanner(`Tokens: ${formatTokenCount(conversationTokens)} · ${cost || 'no pricing set'} · Context: ${budgetPct}% of ${genOptions.num_ctx ?? 4096}`);
          return;
        }
        if (result.action === 'compact') {
          if (messages.length < 2) { showStatusBanner('Not enough messages to compact'); return; }
          if (isLoading) { showStatusBanner('Cannot compact while generating'); return; }
          void (async () => {
            showStatusBanner('Compacting conversation…');
            const summaryPrompt = 'Summarize the following conversation concisely. Preserve all key facts, decisions, code snippets, and context needed to continue the discussion. Format as a clear summary:\n\n';
            const convText = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
            const summaryMessages: Message[] = [
              { role: 'user', content: summaryPrompt + convText },
            ];
            let summary = '';
            try {
              const isCloudModel = models.some(m => m.name === model && m.cloud);
              const compactEndpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : url('/api/chat');
              await fetchOllamaChatStream(model, summaryMessages, (chunk) => {
                if (chunk.message?.content) summary += chunk.message.content;
              }, compactEndpoint, false, genOptions, undefined);
              if (!summary.trim()) { showStatusBanner('Compaction failed — empty summary'); return; }
              const compacted: Message[] = [
                { role: 'user', content: 'Previous conversation summary (via /compact):\n\n' + summary.trim() },
                { role: 'assistant', content: 'Understood. I have the conversation summary. How can I help you continue?', ts: Date.now() },
              ];
              setMessages(compacted);
              trunkMessagesRef.current = compacted;
              setBranchState(emptyBranchState());
              saveCurrentSession(compacted);
              showStatusBanner(`Compacted ${messages.length} messages into a summary`);
            } catch (err) {
              showStatusBanner(`Compaction failed: ${formatErrorLine(err, 'ollama')}`);
            }
          })();
          return;
        }
        if (result.action === 'delete') {
          if (!currentSessionId) { showStatusBanner('No conversation to delete'); return; }
          const title = sessions.find(s => s.id === currentSessionId)?.title ?? 'this chat';
          deleteSession(currentSessionId, title);
          return;
        }
        if (result.action === 'models') {
          if (models.length === 0) { showStatusBanner('No models available — check your Ollama connection'); return; }
          const local = models.filter(m => !m.cloud).map(m => `  ${m.name}${m.parameterSize ? ` (${m.parameterSize})` : ''}${m.quantization ? ` ${m.quantization}` : ''}`);
          const cloud = models.filter(m => m.cloud).map(m => `  ${m.name} ⛅`);
          const parts: string[] = [];
          if (local.length > 0) parts.push(`Local (${local.length}):\n${local.join('\n')}`);
          if (cloud.length > 0) parts.push(`Cloud (${cloud.length}):\n${cloud.join('\n')}`);
          showStatusBanner(parts.join('\n') || 'No models available');
          return;
        }
        if (result.action === 'pull') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /pull <model-name>'); return; }
          showStatusBanner(`Pulling ${arg}…`);
          void handlePullModel(arg);
          return;
        }
        if (result.action === 'remove') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /remove <model-name>'); return; }
          if (!models.some(m => m.name === arg)) { showStatusBanner(`Model "${arg}" not found`); return; }
          void handleDeleteModel(arg);
          return;
        }
        if (result.action === 'params') {
          showStatusBanner(
            `Temperature: ${genOptions.temperature ?? 'default'} · Context: ${genOptions.num_ctx ?? 4096} · Top-p: ${genOptions.top_p ?? 'default'} · Top-k: ${genOptions.top_k ?? 'default'} · Max tokens: ${genOptions.num_predict === undefined ? 'unlimited' : genOptions.num_predict} · Stop: [${genOptions.stop && genOptions.stop.length ? genOptions.stop.join(', ') : ''}]`
          );
          return;
        }
        if (result.action === 'stats') {
          const st = computeConversationStats(messages);
          showStatusBanner(
            `Messages: ${st.totalMessages} · User/Assistant: ${st.userMessages}/${st.assistantMessages} · Words: ${st.words.toLocaleString()} · Characters: ${st.characters.toLocaleString()} · Est. tokens: ${formatTokenCount(st.tokens)}`
          );
          return;
        }
        if (result.action === 'cwd') {
          // /cwd shows and copies the active workspace root path (#379).
          const wsRoot = getActiveRoot();
          if (wsRoot) {
            showStatusBanner(`Workspace: ${wsRoot} (copied to clipboard)`);
            navigator.clipboard?.writeText(wsRoot).catch(() => { /* clipboard may be unavailable */ });
          } else {
            showStatusBanner('No workspace open — open a project folder first');
          }
          return;
        }
        if (result.action === 'memory') {
          // /memory views the composed cross-session memory block (#383).
          const memBlock = composeMemoryBlock(activeProjectId ?? undefined);
          if (memBlock) {
            const count = getRelevantEntries(activeProjectId ?? undefined).length;
            showStatusBanner(`Memory (${count} entr${count === 1 ? 'y' : 'ies'}): ${memBlock.replace(/\n/g, ' ').trim()}`);
          } else {
            showStatusBanner('No memory entries.');
          }
          return;
        }
        if (result.action === 'map') {
          // /map emits a workspace repo-map overview into the chat (#382).
          const mapRoot = getActiveRoot();
          if (!mapRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          void (async () => {
            try {
              const top = await listDir(mapRoot);
              const lines: string[] = [];
              for (const e of top) {
                const name = e.is_dir ? e.name + '/' : e.name;
                lines.push(name);
                if (e.is_dir) {
                  try {
                    const children = await listDir(e.path);
                    for (const c of children.slice(0, 20)) {
                      lines.push('  ' + (c.is_dir ? c.name + '/' : c.name));
                    }
                    if (children.length > 20) lines.push('  … (' + (children.length - 20) + ' more)');
                  } catch { /* unreadable subdir — skip */ }
                }
              }
              const mapText = `Repo map: ${mapRoot}
${lines.join('\n')}`;
              if (currentSessionId) {
                const mapMsg: Message = { role: 'assistant', content: '```\n' + mapText + '\n```', ts: Date.now() };
                const next = [...messages, mapMsg];
                trunkMessagesRef.current = next;
                setMessages(next);
                saveCurrentSession(next);
              }
              showStatusBanner(`Repo map: ${top.length} top-level entries`);
            } catch (err) {
              showStatusBanner(`Could not read workspace: ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'status') {
          // /status quick overview (#385).
          const wsRoot = getActiveRoot();
          const conn = ollamaConnected === null ? 'unknown' : ollamaConnected ? 'connected' : 'disconnected';
          showStatusBanner(`Model: ${model} · Workspace: ${wsRoot ?? 'none'} · Ollama: ${conn} · Messages: ${messages.length}`);
          return;
        }
        if (result.action === 'tools') {
          // /tools lists registered agent tools with enabled state (#399).
          const statuses = listToolStatuses(disabledTools);
          if (statuses.length === 0) { showStatusBanner('No tools registered'); return; }
          const on = statuses.filter(s => s.enabled).length;
          const detail = statuses.map(s => `${s.enabled ? '✅' : '⛔'} ${s.name}${s.readOnly ? ' (read-only)' : ''}`).join(' · ');
          showStatusBanner(`Tools: ${on}/${statuses.length} enabled — ${detail}`);
         return;
       }
        if (result.action === 'gitundo') {
          // /gitundo reverts the most recent agent auto-commit (#402, Aider /undo parity).
          void (async () => {
            const res = await undoLastAutoCommit();
            if (res.reverted) showStatusBanner(`Reverted auto-commit: ${res.subject}`);
            else showStatusBanner(`Could not revert: ${res.error ?? 'unknown reason'}`);
          })();
          return;
        }
        if (result.action === 'save') {
          // /save writes the current conversation snapshot into the workspace (#386).
          const saveRoot = getActiveRoot();
          if (!saveRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          if (messages.length === 0) { showStatusBanner('Nothing to save — the conversation is empty'); return; }
          const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'chat';
          const arg = (result.arg ?? '').trim();
          const safe = (arg || title).replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'chat';
          const relDir = '.ollama-gui/sessions';
          const fullPath = saveRoot.replace(/\/$/, '') + '/' + relDir + '/' + safe + '.json';
          const session = currentSessionId ? sessions.find(s => s.id === currentSessionId) : null;
          const exportData = session ?? { id: currentSessionId ?? 'temp', title, messages, model, createdAt: Date.now() };
          void writeFile(fullPath, JSON.stringify(exportData, null, 2))
            .then(() => showStatusBanner(`Saved conversation to ${relDir}/${safe}.json`))
            .catch((err) => showStatusBanner(`Failed to save: ${formatErrorLine(err)}`));
          return;
        }
        if (result.action === 'load') {
          // /load restores a conversation snapshot from the workspace (#386).
          const loadRoot = getActiveRoot();
          if (!loadRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /load <name>'); return; }
          const safe = arg.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
          const relDir = '.ollama-gui/sessions';
          const fullPath = loadRoot.replace(/\/$/, '') + '/' + relDir + '/' + safe + '.json';
          void (async () => {
            try {
              const raw = await readFile(fullPath);
              const parsed = parseSessionImport(raw);
              if (parsed.length === 0) { showStatusBanner(`No conversations found in "${arg}"`); return; }
              parsed.forEach(s => storage.saveSession(s));
              setSessions(storage.getSessions());
              loadSession(parsed[0]);
              showStatusBanner(`Loaded conversation "${arg}"`);
            } catch (err) {
              showStatusBanner(`Could not load "${arg}": ${formatErrorLine(err)}`);
            }
          })();
          return;
        }
        if (result.action === 'id') {
          if (currentSessionId) {
            showStatusBanner(`Session ID: ${currentSessionId} (copied to clipboard)`);
            navigator.clipboard?.writeText(currentSessionId).catch(() => { /* clipboard may be unavailable */ });
          } else {
            showStatusBanner('No active session — start a chat first');
          }
          return;
        }
        if (result.action === 'merge') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /merge <session-id>'); return; }
          if (!currentSessionId) { showStatusBanner('No active session to merge into'); return; }
          if (arg === currentSessionId) { showStatusBanner('Cannot merge a conversation into itself'); return; }
          const target = sessions.find(s => s.id === arg);
          if (!target) { showStatusBanner(`Session "${arg}" not found`); return; }
          if (target.messages.length === 0) { showStatusBanner(`Session "${arg}" has no messages to merge`); return; }
          const merged = [...messages, ...target.messages];
          trunkMessagesRef.current = merged;
          setMessages(merged);
          saveCurrentSession(merged);
         showStatusBanner(`Merged ${target.messages.length} message${target.messages.length === 1 ? '' : 's'} from "${target.title}"`);
         return;
       }
        if (result.action === 'warm') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /warm <model-name>'); return; }
          showStatusBanner(`Loading ${arg} into memory…`);
          void (async () => {
            try {
              await loadOllamaModel(arg, 300, url('/api/generate'));
              showStatusBanner(`✅ ${arg} loaded into memory (5m keep-alive)`);
            } catch (err) {
              showStatusBanner(`Failed to load: ${formatErrorLine(err, 'ollama')}`);
            }
          })();
          return;
        }
        if (result.action === 'unload') {
          const arg = (result.arg ?? '').trim();
          if (!arg) { showStatusBanner('Usage: /unload <model-name>'); return; }
          showStatusBanner(`Unloading ${arg} from memory…`);
          void (async () => {
            try {
              await unloadOllamaModel(arg, url('/api/generate'));
              showStatusBanner(`✅ ${arg} unloaded from memory`);
            } catch (err) {
              showStatusBanner(`Failed to unload: ${formatErrorLine(err, 'ollama')}`);
            }
          })();
          return;
        }
        if (result.action === 'running') {
          void (async () => {
            try {
              const running = await fetchRunningModels(url('/api/ps'));
              if (running.length === 0) { showStatusBanner('No models currently loaded in memory'); return; }
              const lines = running.map(m => {
                const mb = Math.round(m.size / 1024 / 1024);
                const vram = m.sizeVram ? ` (VRAM: ${Math.round(m.sizeVram / 1024 / 1024)} MB)` : '';
                const exp = m.expiresRelativeToNow ? ` · expires in ${m.expiresRelativeToNow}` : '';
                return `  ${m.name} — ${mb} MB${vram}${exp}`;
              });
              showStatusBanner(`Loaded models (${running.length}):\n${lines.join('\n')}`);
            } catch (err) {
              showStatusBanner(`Failed to list running models: ${formatErrorLine(err, 'ollama')}`);
            }
          })();
          return;
        }
        if (result.action === 'version') {
          void (async () => {
            try {
              const info = await fetchOllamaVersion(url('/api/version'));
              showStatusBanner(`Ollama server version: ${info.version}`);
            } catch (err) {
              showStatusBanner(`Failed to fetch version: ${formatErrorLine(err, 'ollama')}`);
            }
          })();
          return;
        }
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

    // Prepend pinned-file context so it stays present across turns (#350).
    // Done after the slash-command dispatch so /-commands still work with
    // pinned files active. Pinned files persist until /drop or /clear.
    const pinnedBlock = continueMode ? '' : pinnedContextBlock(pinnedFiles);
    if (pinnedBlock) text = pinnedBlock + '\n\n' + text;
    const userMessage: Message = {
      role: 'user',
      content: text,
      ts: Date.now(),
      ...(attachedImages.length > 0 ? { images: [...attachedImages] } : {}),
    };

    // Strip data-URL prefix before sending — API expects raw base64 only
    const toApiMsg = (m: Message): Message =>
      m.images ? { ...m, images: m.images.map(toApiBase64) } : m;

    // Web search augmentation (#121/#192) — inject search results when enabled
    let webSearchBlock = '';
    if (webSearchConfig.enabled && text.trim()) {
      try {
        const results = await webSearch(text.trim(), webSearchConfig);
        webSearchBlock = formatResultsAsContext(results);
      } catch {
        // Non-fatal; proceed without search results
      }
    }

    // Compose system prompt from all context sources (#92/#93/#95)
    const activeProject = projects.find(p => p.id === activeProjectId);
    const memBlock = composeMemoryBlock(activeProjectId ?? undefined);
    const composedSystem = composeSystemPrompt({
      systemPrompt: webSearchBlock ? `${webSearchBlock}\n\n${systemPrompt}` : systemPrompt,
      rulesFileContent: projectRulesContent ?? undefined,
      projectInstructions: activeProject?.instructions,
      memoryBlock: memBlock || undefined,
    });

    // Apply filter inlets before dispatch (#127)
    const stripMaxIter = (m: Message) =>
      !(continueMode && m.role === 'assistant' && m.content.startsWith('⚠️ Agent stopped: maximum tool iterations'));
    let rawHistory: Message[] = [
      { role: 'system', content: composedSystem },
      ...messages.filter(stripMaxIter).map(toApiMsg),
      ...(continueMode ? [] : [toApiMsg(userMessage)]),
    ];

    // Model override for "regenerate with a different model" (#270). Falls back
    // to the active model state for normal sends.
    const activeModel = modelOverride ?? model;
    // Track recent model usage (#322)
    setRecentModels(prev => {
      const next = [activeModel, ...prev.filter(m => m !== activeModel)].slice(0, 5);
      try { safeSetItem('ollama_gui_recent_models', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

    // Auto-compact when history approaches context limit (#95)
    if (autoCompact && shouldCompact(rawHistory, compactionThreshold)) {
      rawHistory = await compactConversation(rawHistory, {
        thresholdTokens: compactionThreshold,
        summarizeFn: makeSummarizeFn(activeModel, url('/api/chat')),
      });
    }

    const chatHistory = await applyFilterInlet(rawHistory);

    setMessages(continueMode ? messages.filter(stripMaxIter) : [...messages, userMessage]);
    if (textOverride === undefined) setInput(''); // keep in-progress typing for queued auto-sends
    setAttachedImages([]);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const isCloudModel = models.some(m => m.name === activeModel && m.cloud);
      // Resolve the connected model + connection for remote routing.
      const selectedConnectedModel = connectedModels.find(m => m.id === activeModel);
      const selectedConnection = selectedConnectedModel
        ? connections.find(c => c.id === selectedConnectedModel.connectionId)
        : undefined;
      // Pick the chat endpoint: cloud Ollama > remote Ollama connection > local Ollama.
      const endpoint = isCloudModel
        ? 'https://cloud.ollama.ai/api/chat'
        : selectedConnection?.kind === 'ollama'
          ? `${selectedConnection.baseUrl.replace(/\/$/, '')}/api/chat`
          : url('/api/chat');
      const cloudEndpoint = 'https://cloud.ollama.ai/api/chat';
      const mlxActive = !!mlxAvailability && isMlxActive(mlxSettings, mlxAvailability);

      if (mlxAvailability?.available && mlxSettings.cloudBrainLocalWorker && mlxSettings.brainModel && mlxSettings.workerModel) {
        // Multi-agent: cloud model is the brain, local model is the worker.
        let header = '';
        let orchestratorReasoning = '';
        setMessages(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);
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
              setMessages(prev => [...prev, { role: 'assistant', content: header, ...(orchestratorReasoning ? { reasoning: orchestratorReasoning } : {}) }] as Message[]);
            },
            onDelta: (_phase, fullText) => {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { role: 'assistant', content: header + fullText, ...(orchestratorReasoning ? { reasoning: orchestratorReasoning } : {}) }] as Message[];
                }
                return prev;
              });
            },
            onReasoning: (_phase, fullReasoning) => {
              orchestratorReasoning = fullReasoning;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, reasoning: orchestratorReasoning }] as Message[];
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
        let assistantReasoning = '';
        setMessages(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);
        try {
          await fetchMlxChatStream(mlxSettings.localModel, chatHistory, (delta, reasoning) => {
            if (reasoning) assistantReasoning += reasoning;
            if (delta) assistantContent += delta;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent, ts: last?.ts ?? Date.now(), ...(assistantReasoning ? { reasoning: assistantReasoning } : {}) }] as Message[];
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
        let agenticReasoning = '';
        let agenticGenStats: GenStats | undefined;
        setAgentStatus('Thinking…');
        const agentStream = agenticChatStream({
          model: selectedConnectedModel?.name ?? model,
          messages: chatHistory,
          endpoint,
          maxIterations: autonomySettings.maxIterations,
          signal: abortControllerRef.current?.signal,
          options: genOptions,
          format,
          onIteration: (iteration, maxIterations) => setAgentStep({ iteration, max: maxIterations }),
          onMaxIterations: () => setAgentHitMax(true),
          // Clean abort handling (#405): a user-initiated Stop during an
          // agentic fetch marks the partial assistant reply as cancelled
          // (parity with the normal streaming cancel-keep-partial #303)
          // instead of surfacing an "Error: aborted" banner.
          onCancel: () => {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                const updated = [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*(generation cancelled)*', wasCancelled: true }] as Message[];
                saveCurrentSession(updated);
                return updated;
              }
              return prev;
            });
          },
         // Only filter when some built-in tool is disabled (#399); default = expose all.
          ...(disabledTools.size > 0 ? { toolFilter: getEnabledToolFilter(disabledTools) ?? undefined } : {}),
          // Plan/ask autonomy gate (#88/#89/#189)
          onApprovalNeeded: (toolName, args) =>
            new Promise<boolean>(resolve => {
              // Session auto-approve (#406): skip the modal for tools the user
              // already allowed "for this session".
              if (sessionToolAllowlistRef.current.has(toolName)) {
                resolve(true);
                return;
              }
              // Plan-mode gating (#408): in plan autonomy, the agent must get
              // its published plan approved before executing any mutating
              // tool. After approval, mutating tools auto-approve for the run.
              if (isPlanMode()) {
                if (planApprovedRef.current) { resolve(true); return; }
                setAgentStatus('Waiting for plan approval');
                setPendingPlanApproval({ toolName, resolve });
                return;
              }
              setAgentStatus(`Waiting for approval: ${toolName}`);
              setPendingToolApproval({ toolName, args, resolve });
            }),
          onAssistantMessage: (message) => {
            setAgentStatus('Thinking…');
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              const reasoning = agenticReasoning ? { reasoning: agenticReasoning } : {};
              if (lastMessage.role === 'assistant') {
                const updated = [...prev.slice(0, -1), { role: 'assistant', content: message, ...reasoning }] as Message[];
                saveCurrentSession(updated);
                return updated;
              } else {
                const updated = [...prev, { role: 'assistant', content: message, ...reasoning }] as Message[];
                saveCurrentSession(updated);
                return updated;
              }
            });
          },
          onAssistantReasoning: (reasoning) => {
            agenticReasoning = reasoning;
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage?.role === 'assistant') {
                const updated = [...prev.slice(0, -1), { ...lastMessage, reasoning }] as Message[];
                saveCurrentSession(updated);
                return updated;
              }
              return prev;
            });
          },
          onGenStats: (stats) => { agenticGenStats = stats; },
          onToolCall: (toolCall) => {
            setAgentStatus(`Running: ${toolCallName(toolCall)}`);
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: `Calling tool: ${toolCallName(toolCall)}`,
                tool_calls: [toolCall],
              },
            ]);
          },
          onToolResult: (toolResult) => {
            setAgentStatus('Thinking…');
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
            setAgentStatus(null);
            setAgentStep(null);
            // Intentionally do NOT reset agentHitMax here: a max-iterations
            // stop sets it via onMaxIterations and the "Continue agent" button
            // (#403) must remain visible after the run completes. sendMessage
            // clears it on the next send.
          },
          onError: (error) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: formatErrorLine(error, 'ollama'), isError: true },
            ]);
            setIsLoading(false);
            setAgentStatus(null);
            setAgentStep(null);
            setAgentHitMax(false);
          },
        });

        for await (const message of agentStream) {
          // Messages are already handled by the callbacks — except the
          // max-iterations stop warning, which is yielded directly by the
          // generator (not via onAssistantMessage) and must be surfaced to
          // the UI so the "Continue agent" button (#403) can attach to it.
          if (message.role === 'assistant' && typeof message.content === 'string' && message.content.startsWith('⚠️ Agent stopped: maximum tool iterations')) {
            setMessages(prev => { const updated = [...prev, message]; saveCurrentSession(updated); return updated; });
          }
        }
        // Stamp final-turn generation stats onto the last assistant reply (#391, #392).
        if (agenticGenStats) {
          setMessages(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'assistant') {
                const updated = [...prev.slice(0, i), { ...prev[i], genStats: agenticGenStats }, ...prev.slice(i + 1)] as Message[];
                saveCurrentSession(updated);
                return updated;
              }
            }
            return prev;
          });
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
          (modelId, delta, state, error, reasoning) => {
            setModelGroups(prev => prev.map((g, i) => {
              if (i !== prev.length - 1) return g;
              return {
                ...g,
                replies: g.replies.map(r => r.modelId !== modelId ? r : {
                  ...r,
                  content: state === 'streaming' ? r.content + delta : r.content,
                  reasoning: state === 'streaming' && reasoning ? (r.reasoning ?? '') + reasoning : r.reasoning,
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
        // Route through OpenAI-compatible connection when model belongs to one (#123).
        // Remote Ollama connections use the resolved `endpoint` (already correct above).
        const connectedModel = selectedConnectedModel;
        const connForModel = connectedModel ? connections.find(c => c.id === connectedModel.connectionId && c.kind === 'openai') : undefined;

        // Use regular chat stream
        let assistantContent = '';
        let assistantReasoning = '';
        let streamOk = false;
        let genStats: GenStats | undefined;
        setMessages(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);

        try {
          if (connForModel && connectedModel) {
            // OpenAI-compatible SSE stream (#123)
            await streamOpenAiChat(
              connForModel,
              connectedModel.name,
              chatHistory,
              (delta, reasoning) => {
                if (reasoning) assistantReasoning += reasoning;
                if (delta) assistantContent += delta;
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent, ts: last?.ts ?? Date.now(), ...(assistantReasoning ? { reasoning: assistantReasoning } : {}) }] as Message[];
                  saveCurrentSession(updated);
                  return updated;
                });
              },
              { temperature: genOptions?.temperature },
              abortControllerRef.current?.signal
            );
          } else {
          // Use bare model name — connected models carry a "connId/name" id prefix.
          const ollamaModelName = connectedModel?.name ?? activeModel;
          await fetchOllamaChatStream(ollamaModelName, chatHistory, (chunk) => {
            const thinking = chunk.message?.thinking ?? chunk.thinking;
            if (thinking) {
              assistantReasoning += thinking;
            }
            if (chunk.message?.content) {
              assistantContent += chunk.message.content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                const updated = [...prev.slice(0, -1), { role: 'assistant', content: assistantContent, ts: last?.ts ?? Date.now(), ...(assistantReasoning ? { reasoning: assistantReasoning } : {}) }] as Message[];
                saveCurrentSession(updated);
                return updated;
              });
            }
            if (chunk.done) { genStats = computeGenStats(chunk); }
          }, endpoint, false, genOptions, abortControllerRef.current?.signal, format);
          }
          streamOk = true;
          // Apply filter outlets after stream completes (#127)
          const filtered = await applyFilterOutlet(assistantContent);
          // Stamp producedByModel (#97) and apply filtered content in one update
          setMessages(prev => {
            const last = prev[prev.length - 1];
            const updatedMsg: Message = { ...last, content: filtered, producedByModel: activeModel, ...(assistantReasoning ? { reasoning: assistantReasoning } : {}), ...(genStats ? { genStats } : {}) };
            const updated = [...prev.slice(0, -1), updatedMsg] as Message[];
            saveCurrentSession(updated);
            return updated;
          });
          // Detect artifacts (#99) and surface in the canvas panel
          const arts = detectArtifacts(filtered);
          const primary = pickPrimaryArtifact(arts);
          if (primary) {
            setLatestArtifact(primary);
            showArtifact(primary);
          }
          // Surface agent-created/converted documents in the Artifacts panel (#145).
          // Scan the just-finalized message list (via the messages ref, kept current
          // by the message-tracking effect) for a document tool result.
          const recent = trunkMessagesRef.current ?? [];
          const docMsg = [...recent].reverse().find(
            m => m.role === 'tool' && !!m.name && ['document_create', 'document_convert'].includes(m.name),
          );
          if (docMsg) {
            try {
              const res = JSON.parse(docMsg.content || '{}');
              const path: string | undefined = res.path || res.dest;
              if (path) {
                void readDocument(path)
                  .then(doc => {
                    const docArtifact: DocumentArtifactData = { kind: 'document', path, format: doc.format, previewText: doc.text };
                    setLatestArtifact(docArtifact);
                    showArtifact(docArtifact);
                  })
                  .catch(() => {
                    const docArtifact: DocumentArtifactData = { kind: 'document', path, format: detectDocumentFormat(path), previewText: '' };
                    setLatestArtifact(docArtifact);
                    showArtifact(docArtifact);
                  });
              }
            } catch { /* non-document or unparseable result — ignore */ }
          }
          // Auto-speak after response if enabled (#101)
          if (voiceSettings.autoSpeak && isTtsAvailable() && filtered) {
            speak(filtered, voiceSettings).catch(() => {});
          }
          // Browser notification when generation completes and tab is unfocused (#307)
          if (notifyOnComplete && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            const snippet = filtered.slice(0, 100).replace(/\n/g, ' ');
            try {
              new Notification(`Reply from ${activeModel}`, { body: snippet || 'Generation complete' });
            } catch { /* notifications may be blocked — silently ignore */ }
          }
          // Completion sound (#320)
          if (playSoundOnComplete) playCompletionSound();
        } catch (streamError) {
          if (abortControllerRef.current?.signal.aborted) {
            // User cancelled — keep partial content, append note (#303)
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*(generation cancelled)*', wasCancelled: true }] as Message[];
              }
              return prev;
            });
          } else {
            // Network/server failure — roll back partial message
            setMessages(prev => {
              const withoutPartial = prev.slice(0, -1);
              return [...withoutPartial, { role: 'assistant', content: formatErrorLine(streamError, 'ollama'), isError: true }] as Message[];
            });
          }
        }
        setIsLoading(false);
        if (streamOk) void streamOk; // used for future tracking
      }
    } catch (error) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: formatErrorLine(error, 'ollama'), isError: true },
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

  // Delete a single message from the conversation (#280).
  const deleteMessage = (index: number) => {
    if (isLoading) return;
    const updated = messages.filter((_, j) => j !== index);
    trunkMessagesRef.current = updated;
    setMessages(updated);
    saveCurrentSession(updated);
  };

  // Toggle a GFM task-list checkbox inside a message in place (#352).
  const toggleTaskInMessage = (index: number, itemText: string, checked: boolean) => {
    if (isLoading) return;
    const msg = messages[index];
    if (!msg) return;
    const nextContent = toggleTaskInMarkdown(msg.content, itemText, checked);
    if (nextContent === msg.content) return;
    const updated = messages.map((m, j) => (j === index ? { ...m, content: nextContent } : m));
    trunkMessagesRef.current = updated;
    setMessages(updated);
    saveCurrentSession(updated);
  };

  // Edit an assistant reply in place (#281) — replace content, no re-stream.
  const editAssistantMessage = (index: number, newContent: string) => {
    if (isLoading) return;
    const updated = messages.map((m, j) => (j === index ? { ...m, content: newContent } : m));
    setMessages(updated);
    saveCurrentSession(updated);
  };

  // Quote a message into the composer as a Markdown blockquote draft (#284).
  const quoteMessage = (index: number) => {
    const quoted = messages[index]?.content.split('\n').map(l => `> ${l}`).join('\n') ?? '';
    if (!quoted) return;
    setInput(prev => (prev.trim() ? `${prev}\n\n${quoted}\n` : `${quoted}\n`));
    setTimeout(() => document.getElementById('chat-input')?.focus(), 0);
  };

  // Regenerate the last assistant reply: save the current tail starting at the
  // last user message index as a branch, truncate, and re-stream.
  const regenerateMessage = (assistantIndex: number, modelOverride?: string) => {
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
    void sendMessage(messages[userIndex].content, modelOverride);
    saveCurrentSession(newTrunk, updated);
  };

  // Regenerate the most recent assistant reply (#264). Used by the
  // Ctrl/Cmd+R keyboard shortcut — a no-op when there is no assistant
  // message to retry or a generation is already in progress.
  const regenerateLastResponse = () => {
    if (isLoading) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { regenerateMessage(i); return; }
    }
  };

  // Continue the agentic loop past the max-iterations stop (#403, Codex/Claude parity).
  // Re-runs the agentic turn with the current context (no new user message).
  const continueAgent = () => {
    if (isLoading || !isAgenticMode) return;
    void sendMessage(undefined, undefined, true);
  };

  // Retry a failed assistant message (#299). Removes the error placeholder
  // and re-sends the last user prompt — parity with Codex / Claude retry
  // affordances after a generation failure.
  const retryFailedMessage = (errorIndex: number) => {
    if (isLoading) return;
    let userIndex = errorIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
    if (userIndex < 0) return;
    const userContent = messages[userIndex].content;
    const trimmed = messages.slice(0, errorIndex);
    trunkMessagesRef.current = trimmed;
    setMessages(trimmed);
    saveCurrentSession(trimmed);
    void sendMessage(userContent);
  };

  // Continue a cancelled assistant reply (#303). Strips the cancellation note,
  // re-sends the conversation (including the partial assistant content) to the
  // model, and appends the streamed response to the existing message — parity
  // with Codex / Claude continue-generation after an interrupt.
  const continueGeneration = async (assistantIndex: number) => {
    if (isLoading) return;
    const partial = messages[assistantIndex];
    if (!partial || partial.role !== 'assistant') return;
    // Strip the cancellation marker
    const cleanContent = partial.content.replace(/\n\n\*\(generation cancelled\)\*$/, '');
    // Build history: everything up to and including the cleaned partial reply
    const history = [...messages.slice(0, assistantIndex), { ...partial, content: cleanContent, wasCancelled: false }] as Message[];
    trunkMessagesRef.current = history.slice(0, -1);
    setMessages(history);
    saveCurrentSession(history);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    const isCloudModel = models.some(m => m.name === model && m.cloud);
    const selectedConnectedModel = connectedModels.find(m => m.id === model);
    const selectedConnection = selectedConnectedModel
      ? connections.find(c => c.id === selectedConnectedModel.connectionId)
      : undefined;
    const contEndpoint = isCloudModel
      ? 'https://cloud.ollama.ai/api/chat'
      : selectedConnection?.kind === 'ollama'
        ? `${selectedConnection.baseUrl.replace(/\/$/, '')}/api/chat`
        : url('/api/chat');
    const ollamaModelName = selectedConnectedModel?.name ?? model;
    let continuedContent = '';
    let contGenStats: GenStats | undefined;
    try {
      await fetchOllamaChatStream(ollamaModelName, history, (chunk) => {
        if (chunk.message?.content) {
          continuedContent += chunk.message.content;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            const updated = [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent }] as Message[];
            saveCurrentSession(updated);
            return updated;
          });
        }
        if (chunk.done) contGenStats = computeGenStats(chunk);
      }, contEndpoint, false, genOptions, abortControllerRef.current?.signal);
      // Final save
      setMessages(prev => {
        const last = prev[prev.length - 1];
        const updated = [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent, wasCancelled: false, ...(contGenStats ? { genStats: contGenStats } : {}) }] as Message[];
        saveCurrentSession(updated);
        return updated;
      });
    } catch (streamError) {
      if (abortControllerRef.current?.signal.aborted) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent + '\n\n*(generation cancelled)*', wasCancelled: true }] as Message[];
          }
          return prev;
        });
      } else {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent + '\n\n' + formatErrorLine(streamError, 'ollama'), isError: true, wasCancelled: false }] as Message[];
          }
          return prev;
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
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

  // Command palette actions (#251)
  const paletteCommands: PaletteCommand[] = [
    { id: 'new-chat', label: 'New Chat', hint: 'Ctrl+K', run: () => startNewChat() },
    { id: 'find', label: 'Find in Chat', hint: 'Ctrl+F', run: () => { setChatSearchOpen(true); setChatSearchIndex(0); } },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', hint: 'Ctrl+\\', run: () => setIsSidebarOpen(prev => !prev) },
    { id: 'toggle-browser', label: 'Toggle Browser', hint: 'Ctrl+B', run: () => togglePanel('browser') },
    { id: 'toggle-files', label: 'Toggle Files', hint: 'Ctrl+Shift+F', run: () => togglePanel('files') },
    { id: 'toggle-terminal', label: 'Toggle Terminal', hint: 'Ctrl+T', run: () => togglePanel('terminal') },
    { id: 'open-settings', label: 'Open Settings', hint: 'Ctrl+,', run: () => setIsSettingsOpen(true) },
    { id: 'show-help', label: 'Show Keyboard Shortcuts', hint: '?', run: () => setShowHelp(true) },
    { id: 'autonomy-plan', label: 'Set Autonomy: Plan', run: () => { const s = { ...autonomySettings, level: 'plan' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'autonomy-ask', label: 'Set Autonomy: Ask', run: () => { const s = { ...autonomySettings, level: 'ask' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'autonomy-auto', label: 'Set Autonomy: Auto', run: () => { const s = { ...autonomySettings, level: 'auto' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'toggle-theme', label: 'Toggle Theme', hint: 'Ctrl+Shift+D', run: () => toggleTheme() },
    { id: 'toggle-zen', label: 'Toggle Zen/Focus Mode', hint: 'Ctrl+Shift+Z', run: () => toggleZenMode() },
    { id: 'toggle-artifacts', label: 'Toggle Artifacts Panel', hint: 'Ctrl+Shift+A', run: () => togglePanel('artifacts') },
    { id: 'regenerate', label: 'Regenerate Last Reply', hint: 'Ctrl+R', run: () => regenerateLastResponse() },
    { id: 'copy-last-reply', label: 'Copy Last Reply', hint: 'Ctrl+Shift+C', run: () => {
      for (let j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role === 'assistant' && messages[j].content) {
          navigator.clipboard.writeText(messages[j].content);
          showStatusBanner('Copied last reply');
          break;
        }
      }
    } },
    { id: 'scroll-latest', label: 'Scroll to Latest', hint: 'Ctrl+End', run: () => scrollToBottom() },
    { id: 'pin-convo', label: 'Pin/Unpin Conversation', hint: 'Ctrl+Shift+P', run: () => {
      if (!currentSessionId) { showStatusBanner('Save the chat first to pin it'); return; }
      const wasPinned = !!sessions.find(x => x.id === currentSessionId)?.pinned;
      togglePin(currentSessionId);
      showStatusBanner(wasPinned ? 'Unpinned conversation' : 'Pinned conversation');
    } },
    { id: 'next-convo', label: 'Next Conversation', hint: 'Ctrl+]', run: () => switchConversationRef.current(1) },
    { id: 'prev-convo', label: 'Previous Conversation', hint: 'Ctrl+[', run: () => switchConversationRef.current(-1) },
    { id: 'zoom-in', label: 'Zoom In', hint: 'Ctrl+=', run: () => { adjustFontScale(0.1); showStatusBanner(`Zoom: ${Math.round(fontScale * 100)}%`); } },
    { id: 'zoom-out', label: 'Zoom Out', hint: 'Ctrl+-', run: () => { adjustFontScale(-0.1); showStatusBanner(`Zoom: ${Math.round(fontScale * 100)}%`); } },
    { id: 'zoom-reset', label: 'Reset Zoom', hint: 'Ctrl+0', run: () => { setFontScale(1); safeSetItem('ollama_gui_font_scale', '1'); showStatusBanner('Zoom reset to 100%'); } },
  ];

  return (
    <CodeWordWrapContext.Provider value={{ wordWrap: codeWordWrap, toggle: toggleCodeWordWrap }}>
    <div className={`flex h-screen font-sans transition-colors duration-300 ${
      dark ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
    }`}>

      {/* Sidebar - Responsive: hidden on mobile by default, toggleable */}
      <div className={`transition-all duration-300 border-r flex flex-col absolute md:relative z-40 ${
        (isSidebarOpen && !zenMode) ? 'w-64 p-4' : 'w-0 overflow-hidden p-0 border-none'
      } ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'} ${
        isMobile && !isSidebarOpen ? 'hidden' : ''
      }`}>
        <h1 className="text-xl font-bold mb-4">Ollama GUI</h1>

             <button
               onClick={() => startNewChat()}
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
          id="sidebar-search"
          type="text"
          aria-label="Search conversations"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search conversations..."
          className={`w-full text-xs border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'bg-zinc-100 border-zinc-300 text-zinc-900 placeholder-zinc-400'
          }`}
        />

        {/* Conversation-list sort selector (#327) */}
        <div className="flex items-center gap-1 mb-2">
          <span className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Sort:</span>
          {(['recent', 'name', 'messages'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setSortMode(m); safeSetItem('ollama_gui_sort_mode', m); }}
              aria-label={`Sort by ${m}`}
              aria-pressed={sortMode === m}
              className={`text-[10px] px-2 py-0.5 rounded-full border ${sortMode === m ? 'bg-blue-600 text-white border-blue-600' : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
            >{m === 'recent' ? 'Recent' : m === 'name' ? 'Name' : 'Messages'}</button>
          ))}
        </div>

        {/* Bulk selection toggle + action bar (#338) */}
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {bulkSelectMode ? (
            <>
              <span className={`text-[10px] ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{bulkSelectedIds.size} selected</span>
              <button
                onClick={bulkArchiveSelected}
                disabled={bulkSelectedIds.size === 0}
                aria-label="Bulk archive selected"
                className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-600 text-white border-amber-600 disabled:opacity-50"
              >🗄 Archive ({bulkSelectedIds.size})</button>
              <button
                onClick={bulkDeleteSelected}
                disabled={bulkSelectedIds.size === 0}
                aria-label="Bulk delete selected"
                className="text-[10px] px-2 py-0.5 rounded-full border bg-red-600 text-white border-red-600 disabled:opacity-50"
              >✕ Delete ({bulkSelectedIds.size})</button>
              <button
                onClick={exitBulkSelect}
                aria-label="Exit bulk select mode"
                className={`text-[10px] px-2 py-0.5 rounded-full border ${dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500'}`}
              >Cancel</button>
            </>
          ) : (
            <button
              onClick={enterBulkSelect}
              aria-label="Enter bulk select mode"
              className={`text-[10px] px-2 py-0.5 rounded-full border ${dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500'}`}
            >☑ Select</button>
          )}
        </div>

        {/* Folder chips + archived toggle (#133) */}
        <div className="flex items-center flex-wrap gap-1 mb-2">
          <button
            onClick={() => { setFolderFilter(null); setShowArchived(false); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolderId('__all__'); }}
            onDragLeave={() => setDragOverFolderId(prev => prev === '__all__' ? null : prev)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverFolderId(null);
              const sessionId = e.dataTransfer.getData('text/session-id');
              if (sessionId) { moveToFolder(sessionId, ''); showStatusBanner('Moved to All (unfiled)'); }
            }}
            title="All conversations — drag a chat here to unfile it"
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              dragOverFolderId === '__all__'
                ? 'ring-2 ring-blue-400 bg-blue-600 text-white border-blue-600'
                : folderFilter === null && !showArchived ? 'bg-blue-600 text-white border-blue-600'
                : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')
            }`}
          >All</button>
         {folders.map(f => (
           <button
             key={f.id}
             onClick={() => { setFolderFilter(f.id); setShowArchived(false); }}
            title={`Folder: ${f.name} (long-press the ✕ to delete — or drag a chat here)`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolderId(f.id); }}
            onDragLeave={() => setDragOverFolderId(prev => prev === f.id ? null : prev)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverFolderId(null);
              const sessionId = e.dataTransfer.getData('text/session-id');
              if (sessionId) { moveToFolder(sessionId, f.id); showStatusBanner(`Moved to "${f.name}"`); }
            }}
            className={`group/folder text-[10px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
              dragOverFolderId === f.id
                ? 'ring-2 ring-blue-400 bg-blue-600 text-white border-blue-600'
                : folderFilter === f.id ? 'bg-blue-600 text-white border-blue-600'
                : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')
            }`}
          >
              🗂 {f.name}
              <span onClick={(e) => { e.stopPropagation(); renameFolder(f.id); }} title="Rename folder" aria-label={`Rename folder: ${f.name}`} className="opacity-0 group-hover/folder:opacity-100 hover:text-blue-300">✏️</span>
              <span onClick={(e) => { e.stopPropagation(); if (confirm(`Delete folder "${f.name}"? Chats stay, just ungrouped.`)) removeFolder(f.id); }} className="opacity-0 group-hover/folder:opacity-100 hover:text-red-300">✕</span>
            </button>
          ))}
          <button onClick={createFolder} className={`text-[10px] px-2 py-0.5 rounded-full border ${dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-200'}`}>+ folder</button>
          <button
            onClick={() => { setShowArchived(v => !v); setFolderFilter(null); }}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${showArchived ? 'bg-amber-600 text-white border-amber-600' : (dark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
          >🗄 Archived</button>
          {tagFilter && (
            <button
              className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-600 text-white border-blue-600 inline-flex items-center gap-1"
              onClick={() => setTagFilter(null)}
            >🏷 {tagFilter} ✕</button>
          )}
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
          {filteredSessions.map((s, idx) => {
                   const prevS = filteredSessions[idx - 1];
                   const showPinnedLabel = !!s.pinned && !(prevS?.pinned);
                   const useDateGroups = sortMode === 'recent';
                   const bucket = (!s.pinned && useDateGroups) ? conversationDateBucket(s.createdAt) : null;
                   const prevBucket = (prevS && !prevS.pinned && useDateGroups) ? conversationDateBucket(prevS.createdAt) : null;
                   const showBucketLabel = !!bucket && bucket !== prevBucket;
                   return (
                   <React.Fragment key={s.id}>
                     {showPinnedLabel && (
                       <p className={`text-xs uppercase font-semibold mt-2 mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Pinned</p>
                     )}
                     {showBucketLabel && (
                       <p className={`text-xs uppercase font-semibold mt-2 mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{bucket}</p>
                     )}
                  <div
                    onClick={() => bulkSelectMode ? toggleBulkSelected(s.id) : loadSession(s)}
                    role="button"
                    tabIndex={0}
                    draggable={!bulkSelectMode && !renamingSessionId}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/session-id', s.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onKeyDown={(e) => {
                       if (e.key === 'Enter') { loadSession(s); return; }
                       // Arrow-key navigation between session rows (#329)
                       if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                         e.preventDefault();
                         const list = e.currentTarget.parentElement;
                         if (!list) return;
                         const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]'));
                         const idx = rows.indexOf(e.currentTarget);
                         if (idx === -1) return;
                         const nextIdx = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
                         rows[nextIdx]?.focus();
                       }
                     }}
                     onContextMenu={(e) => { e.preventDefault(); setSessionContextMenu({ x: e.clientX, y: e.clientY, sessionId: s.id }); }}
                     aria-label={`Load session: ${s.title}`}
                     className={`group p-2 rounded-md cursor-pointer transition-colors ${
                       currentSessionId === s.id
                         ? (dark ? 'bg-zinc-700 text-white' : 'bg-zinc-300 text-zinc-900')
                         : (dark ? 'hover:bg-zinc-700/50 text-zinc-300' : 'hover:bg-zinc-200 text-zinc-600')
                     }`}
                   >
              <div className="flex items-center justify-between">
                {bulkSelectMode && (
                  <input
                    type="checkbox"
                    checked={bulkSelectedIds.has(s.id)}
                    onChange={() => toggleBulkSelected(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select session: ${s.title}`}
                    className="shrink-0 mr-1"
                  />
                )}
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
                  <div className="flex-1 min-w-0">
                    <span className="truncate text-sm block">{s.pinned ? '📌 ' : ''}{s.title}</span>
                    <div className="flex items-center gap-1.5">
                      {s.messages.length > 0 && (
                        <span className={`text-[9px] ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>{s.messages.length} {s.messages.length === 1 ? 'msg' : 'msgs'}</span>
                      )}
                      {/* Per-session model badge (#334) */}
                      {s.model && (
                        <span
                          title={`Model: ${s.model}`}
                          className={`text-[9px] truncate max-w-[8rem] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}
                        >{s.model}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); startRename(s.id, s.title); }} title="Rename" aria-label={`Rename session: ${s.title}`} className="p-1 text-xs hover:text-blue-400">✏️</button>
                  <button onClick={(e) => { e.stopPropagation(); togglePin(s.id); }} title={s.pinned ? 'Unpin' : 'Pin'} aria-label={`${s.pinned ? 'Unpin' : 'Pin'} session: ${s.title}`} className="p-1 text-xs hover:text-blue-400">📌</button>
                  <button onClick={(e) => { e.stopPropagation(); addTagToSession(s.id); }} title="Add tag" aria-label={`Add tag to session: ${s.title}`} className="p-1 text-xs hover:text-blue-400">🏷</button>
                  <button onClick={(e) => { e.stopPropagation(); toggleArchive(s.id); }} title={s.archived ? 'Unarchive' : 'Archive'} aria-label={`${s.archived ? 'Unarchive' : 'Archive'} session: ${s.title}`} className="p-1 text-xs hover:text-amber-400">🗄</button>
                  <button onClick={(e) => { e.stopPropagation(); duplicateSession(s.id); }} title="Duplicate" aria-label={`Duplicate session: ${s.title}`} className="p-1 text-xs hover:text-blue-400">📑</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id, s.title); }} title="Delete" aria-label={`Delete session: ${s.title}`} className="p-1 text-xs hover:text-red-400">✕</button>
                </div>
              </div>
              {/* tags + folder controls */}
              {((s.tags && s.tags.length > 0) || folders.length > 0) && (
                <div className="flex items-center flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                  {(s.tags ?? []).map(tag => (
                    <span key={tag} className={`text-[9px] px-1 rounded inline-flex items-center gap-0.5 ${tagFilter === tag ? 'bg-blue-600 text-white' : (dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600')}`}>
                      <button onClick={() => setTagFilter(prev => prev === tag ? null : tag)} className="hover:underline" title={tagFilter === tag ? 'Clear tag filter' : 'Filter by tag'}>{tag}</button>
                      <button onClick={() => removeTagFromSession(s.id, tag)} className="hover:text-red-400">×</button>
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
                   </React.Fragment>
          );
          })}
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
        isMobile && isSidebarOpen && !zenMode ? 'ml-64' : ''
      }`}>
        {/* Shared resizable layout shell — owns the chat+dock split (#70/#81).
            Near-passthrough until a panel registers + opens. */}
        <PanelShell dark={dark}>
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
              {/* Ollama connection status indicator (#324) */}
              <span
                aria-label="Ollama connection status"
                title={ollamaConnected === null ? 'Connection unknown' : ollamaConnected ? `Connected · ${ollamaBaseUrl}` : `Disconnected · ${ollamaBaseUrl}`}
                className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                  ollamaConnected === null
                    ? 'bg-zinc-400'
                    : ollamaConnected
                      ? 'bg-emerald-500'
                      : 'bg-red-500'
                }`}
              />
              <select
                value={activePresetId ? `preset:${activePresetId}` : model}
                title="● = model loaded in memory (warm). Use /running to list, /warm to load, /unload to free RAM."
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
                className={`text-sm border rounded-md px-2 py-1 min-w-[10rem] max-w-[22rem] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                }`}
              >
               {starredModels.length > 0 && !activePresetId && (
                 <optgroup label="— ★ Starred —">
                   {starredModels.filter(m => models.some(mi => mi.name === m)).map((m) => (
                      <option key={`starred:${m}`} value={m}>{m}{runningModels.has(m) ? ' ●' : ''}</option>
                   ))}
                 </optgroup>
               )}
               {recentModels.length > 0 && !activePresetId && (
                 <optgroup label="— Recent —">
                   {recentModels.filter(m => models.some(mi => mi.name === m)).map((m) => (
                      <option key={`recent:${m}`} value={m}>{m}{runningModels.has(m) ? ' ●' : ''}</option>
                   ))}
                 </optgroup>
               )}
                {presets.length > 0 && (
                  <optgroup label="— Presets —">
                    {presets.map(p => (
                      <option key={`preset:${p.id}`} value={`preset:${p.id}`}>
                        {p.icon ? `${p.icon} ` : ''}{p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
               {models.filter(m => !m.cloud).length > 0 && (
                 <optgroup label="— Local Ollama —">
                   {models.filter(m => !m.cloud).map((m) => (
                      <option key={m.name} value={m.name}>{m.name}{m.parameterSize ? ` · ${m.parameterSize}` : ''}{m.quantization ? ` · ${m.quantization}` : ''}{runningModels.has(m.name) ? ' ●' : ''}</option>
                   ))}
                 </optgroup>
               )}
                {models.filter(m => m.cloud).length > 0 && (
                  <optgroup label="— Cloud Ollama —">
                    {models.filter(m => m.cloud).map((m) => (
                      <option key={m.name} value={m.name}>{m.name} ⛅{m.parameterSize ? ` · ${m.parameterSize}` : ''}</option>
                    ))}
                  </optgroup>
                )}
                {/* Extra connection models grouped by connection (#123) */}
                {connections.filter(c => c.enabled).map(conn => {
                  const connModels = connectedModels.filter(m => m.connectionId === conn.id);
                  if (!connModels.length) return null;
                  const groupLabel = conn.kind === 'ollama'
                    ? `— Remote Ollama: ${conn.name} —`
                    : `— ${conn.name} —`;
                  return (
                    <optgroup key={conn.id} label={groupLabel}>
                      {connModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {/* Star/favourite the current model (#339) */}
              <button
                onClick={() => toggleStarModel(model)}
                aria-label={starredModels.includes(model) ? 'Unstar model' : 'Star model'}
                aria-pressed={starredModels.includes(model)}
                title={starredModels.includes(model) ? 'Unstar model' : 'Star model'}
                className={`p-1 rounded-md text-sm transition-colors ${starredModels.includes(model) ? 'text-amber-400' : (dark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700')}`}
              >{starredModels.includes(model) ? '★' : '☆'}</button>
              {models.find(m => m.name === model)?.cloud && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                  ⛅ Cloud
                </span>
              )}
              {(() => {
                const cm = connectedModels.find(m => m.id === model);
                const conn = cm ? connections.find(c => c.id === cm.connectionId) : undefined;
                if (!conn) return null;
                return (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}
                    title={conn.baseUrl}>
                    {conn.kind === 'ollama' ? '🌐 Remote' : conn.name}
                  </span>
                );
              })()}
              {isAgenticMode && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                  🤖 Agent
                </span>
              )}
              {isAgenticMode && isLoading && agentStatus && (
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={`Agent status: ${agentStep ? `step ${agentStep.iteration} of ${agentStep.max}, ` : ''}${agentStatus}`}
                  className={`text-xs px-2 py-0.5 rounded-full animate-pulse ${dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-200 text-zinc-700'}`}
                >
                  {agentStep && <span className="opacity-70 mr-1">Step {agentStep.iteration}/{agentStep.max}</span>}
                  {agentStatus}
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
              {/* Generation parameters badge (#325) */}
              <span
                aria-label="Generation parameters"
                title={`Temperature: ${genOptions.temperature ?? 'default'} · Context: ${genOptions.num_ctx ?? 4096} · Top-p: ${genOptions.top_p ?? 'default'} · Top-k: ${genOptions.top_k ?? 'default'} · Max tokens: ${genOptions.num_predict === undefined ? 'unlimited' : genOptions.num_predict}`}
                className={`text-xs px-2 py-0.5 rounded-full font-mono ${dark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}
              >
                T:{genOptions.temperature ?? 'def'} · CTX:{genOptions.num_ctx ?? 4096}
              </span>
             </div>
           <div className="flex items-center gap-3">
             {/* Autonomy / approval-mode quick selector (#355) */}
             <div className={`flex items-center rounded-md overflow-hidden border shrink-0 ${dark ? 'border-zinc-700' : 'border-zinc-300'}`} role="group" aria-label="Autonomy level">
               {(['plan', 'ask', 'auto'] as AutonomyLevel[]).map(lv => (
                 <button
                   key={lv}
                   aria-pressed={autonomySettings.level === lv}
                   aria-label={`Set autonomy: ${lv}`}
                   title={`Autonomy: ${lv}`}
                   onClick={() => { const s = { ...autonomySettings, level: lv }; setAutonomySettings(s); saveAutonomySettings(s); }}
                   className={`px-2 py-1 text-xs capitalize transition-colors ${autonomySettings.level === lv ? 'bg-blue-600 text-white' : (dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100')}`}
                 >{lv}</button>
               ))}
             </div>
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
                 {latestArtifact && (
                   <button
                     onClick={() => togglePanel('artifacts')}
                     title={isPanelOpen('artifacts') ? 'Close artifacts panel' : 'Open artifacts panel'}
                     aria-label={isPanelOpen('artifacts') ? 'Close artifacts panel' : 'Open artifacts panel'}
                     aria-pressed={isPanelOpen('artifacts')}
                     className={`p-2 rounded-md transition-colors ${isPanelOpen('artifacts') ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                   >
                     🖼
                   </button>
                 )}
                 {/* File tree toggle (#85) */}
                 <button
                   onClick={() => togglePanel('files')}
                   title={isPanelOpen('files') ? 'Close files panel' : 'Open files panel'}
                   aria-label={isPanelOpen('files') ? 'Close files panel' : 'Open files panel'}
                   aria-pressed={isPanelOpen('files')}
                   className={`p-2 rounded-md transition-colors ${isPanelOpen('files') ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                 >
                   📁
                 </button>
                 {/* Browser preview toggle (#71) */}
                 <button
                   onClick={() => togglePanel('browser')}
                   title="Toggle browser (Ctrl+B)"
                   aria-label="Toggle browser preview"
                   aria-pressed={isPanelOpen('browser')}
                   className={`p-2 rounded-md transition-colors ${isPanelOpen('browser') ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                 >
                   🌐
                 </button>
                 {/* Terminal toggle (#87) */}
                 <button
                   onClick={() => togglePanel('terminal')}
                   title={isPanelOpen('terminal') ? 'Close terminal panel' : 'Open terminal panel'}
                   aria-label={isPanelOpen('terminal') ? 'Close terminal panel' : 'Open terminal panel'}
                   aria-pressed={isPanelOpen('terminal')}
                   className={`p-2 rounded-md transition-colors ${isPanelOpen('terminal') ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                 >
                   ▶
                 </button>
                 <ConversationStatsButton
                   stats={computeConversationStats(messages)}
                   dark={dark}
                 />
                 <button
                   onClick={handleCopyMarkdown}
                   title="Copy conversation as Markdown"
                   aria-label="Copy conversation as Markdown"
                   disabled={messages.length === 0}
                   className={`p-2 rounded-md transition-colors disabled:opacity-40 ${copiedChat ? (dark ? 'text-green-400' : 'text-green-600') : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')}`}
                 >
                   {copiedChat ? '✓' : '📋'}
                 </button>
                 <button
                   onClick={handleExportMarkdown}
                   title="Export conversation as Markdown"
                   aria-label="Export conversation as Markdown"
                   disabled={messages.length === 0}
                   className={`p-2 rounded-md transition-colors disabled:opacity-40 ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
                 >
                   ⬇️
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

        {/* Live plan checklist (#239) */}
        <PlanPanel plan={plan} dark={dark} onClear={clearPlan} />

        {statusBanner && (
          <div className={`px-4 py-1.5 text-xs text-center border-b ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-zinc-100 border-zinc-300 text-zinc-600'}`} role="status" aria-live="polite">
            {statusBanner}
          </div>
        )}

        {/* Messages - Responsive: full width on mobile, padded on desktop */}
        <div
          ref={messagesContainerRef}
          data-testid="messages-container"
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 relative"
        >
          {/* Context limit warning (#319) */}
          {showContextWarning && (
            <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs mb-2 ${dark ? 'bg-amber-900/40 border border-amber-700/50 text-amber-300' : 'bg-amber-50 border border-amber-300 text-amber-800'}`}>
              <span>⚠ Context window ${contextPct}% full — consider /compact or /ctx ${Math.round((genOptions.num_ctx ?? 4096) * 1.5)} to avoid truncation.</span>
              <button onClick={() => setContextWarningDismissed(true)} aria-label="Dismiss context warning" className={`shrink-0 ${dark ? 'text-amber-400 hover:text-amber-200' : 'text-amber-600 hover:text-amber-400'}`}>✕</button>
            </div>
          )}
          {/* In-conversation search (#247) */}
          {chatSearchOpen && (
            <div className="sticky top-0 z-20 flex justify-end pb-1">
              <div className="w-full max-w-sm">
                <ChatSearch
                  query={chatSearchQuery}
                  onQueryChange={(q) => { setChatSearchQuery(q); setChatSearchIndex(0); }}
                  matchCount={chatSearchMatches.length}
                  currentIndex={chatSearchMatches.length > 0 ? Math.min(chatSearchIndex, chatSearchMatches.length - 1) : -1}
                  onPrev={() => goChatSearch(-1)}
                  onNext={() => goChatSearch(1)}
                  onClose={() => setChatSearchOpen(false)}
                  dark={dark}
                />
              </div>
            </div>
          )}
          {messages.length === 0 && (
            <WelcomeScreen
              dark={dark}
              prompts={prompts.map(p => ({ name: p.name, body: p.body }))}
              onPrompt={(prompt) => {
                setInput(prompt);
                document.getElementById('chat-input')?.focus();
              }}
            />
          )}
            {messages.map((msg, i) => {
              const showDaySeparator = !!msg.ts && (i === 0 || !isSameDay(messages[i - 1].ts, msg.ts));
              return (
              <React.Fragment key={i}>
                {showDaySeparator && (
                  <div className={`flex items-center gap-2 my-2 text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`} role="separator" aria-label={formatDayLabel(msg.ts, nowTick)}>
                    <div className={`flex-1 h-px ${dark ? 'bg-zinc-700' : 'bg-zinc-300'}`} />
                    <span>{formatDayLabel(msg.ts, nowTick)}</span>
                    <div className={`flex-1 h-px ${dark ? 'bg-zinc-700' : 'bg-zinc-300'}`} />
                  </div>
                )}
              <div
                key={i}
                data-msg-index={i}
                className={`flex flex-col gap-0.5 rounded-lg transition-shadow ${i === chatSearchCurrent ? 'ring-2 ring-blue-400 ring-offset-1' : ''} ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
               <div
                 className={`group/msg w-full md:max-w-3xl p-4 rounded-2xl ${
                 msg.role === 'user'
                   ? 'bg-blue-600 text-white rounded-tr-none'
                   : msg.role === 'tool'
                     ? (dark ? 'bg-zinc-700 text-zinc-100 rounded-tl-none border-l-2 border-blue-500' : 'bg-zinc-100 text-zinc-900 rounded-tl-none border-l-2 border-blue-500')
                     : (dark ? 'bg-zinc-800 text-zinc-100 rounded-tl-none' : 'bg-zinc-200 text-zinc-900 rounded-tl-none')
               }`}
                 onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, index: i }); }}
               >
                <div className="text-xs font-bold mb-2 opacity-50 uppercase flex items-center gap-1">
                  {msg.role}
                  {msg.role === 'tool' && <span className="text-blue-400">🔧</span>}
                  {/* Per-message model label (#97) */}
                  {msg.role === 'assistant' && msg.producedByModel && (
                    <span className="normal-case font-normal text-[10px] opacity-70 ml-1">{msg.producedByModel}</span>
                  )}
                  {/* Per-message timestamp (#253/#260) */}
                  {formatMessageTime(msg.ts, nowTick) && (
                    <time className="normal-case font-normal text-[10px] opacity-60 ml-auto" title={msg.ts ? new Date(msg.ts).toLocaleString() : undefined}>
                      {formatMessageTime(msg.ts, nowTick)}
                    </time>
                  )}
                  {/* Per-message estimated token count (#340) */}
                  {msg.content && msg.content.trim() && (
                    <span
                      className="normal-case font-normal text-[10px] opacity-50"
                      title="Estimated tokens for this message"
                      aria-label={`Estimated tokens: ${estimateTokens(msg.content)}`}
                    >≈{formatTokenCount(estimateTokens(msg.content))}t</span>
                  )}
                </div>
                {/* Generation stats: speed, prompt→completion tokens, stop reason (#297, #391, #392) */}
                {msg.role === 'assistant' && msg.genStats && (
                  <div
                    className={`text-[10px] -mt-1 mb-1 flex flex-wrap items-center gap-x-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}
                    aria-label="Assistant message generation stats"
                  >
                    {msg.genStats.tokensPerSec !== undefined && (
                      <span title="Generation speed">
                        {msg.genStats.tokensPerSec.toFixed(1)} tok/s
                      </span>
                    )}
                    {msg.genStats.promptCount !== undefined && msg.genStats.evalCount !== undefined ? (
                      <span title="Prompt → completion tokens consumed">
                        {msg.genStats.promptCount}→{msg.genStats.evalCount} tokens
                      </span>
                    ) : msg.genStats.evalCount !== undefined ? (
                      <span title="Tokens generated">{msg.genStats.evalCount} tokens</span>
                    ) : null}
                    {msg.genStats.stopReason !== undefined && (
                      <span
                        title={`Generation stopped: ${msg.genStats.stopReason}`}
                        className={`px-1 rounded ${msg.genStats.stopReason === 'length-limited' ? (dark ? 'text-amber-400' : 'text-amber-600') : ''}`}
                      >
                        · {msg.genStats.stopReason}
                      </span>
                    )}
                  </div>
                )}

                {/* M5 Issue 20: Show attached images */}
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={toDisplayUrl(img)}
                        alt="attachment"
                        onClick={() => setLightboxImage(toDisplayUrl(img))}
                        title="Click to view full size"
                        className="max-h-48 rounded-lg object-contain border border-white/20 cursor-zoom-in"
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
                        <span className="text-yellow-300">{toolCallName(toolCall)}</span>(
                        <span className="text-green-300">{typeof toolCall.function?.arguments === 'string' ? toolCall.function.arguments : JSON.stringify(toolCall.function?.arguments ?? toolCall.arguments ?? {})}</span>
                        )
                      </div>
                    ))}
                  </div>
                )}

                {/* Reasoning/thinking trace from Ollama reasoning models (#241) */}
                {msg.role === 'assistant' && msg.reasoning && (
                  <ReasoningBlock reasoning={msg.reasoning} dark={dark} />
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
                          if (msg.role === 'assistant') editAssistantMessage(i, editContent);
                          else editMessage(i, editContent);
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
                        onClick={() => { setEditingIndex(null); if (msg.role === 'assistant') editAssistantMessage(i, editContent); else editMessage(i, editContent); }}
                        className="text-xs px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold"
                      >{msg.role === 'assistant' ? 'Save edit' : 'Send edit'}</button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20"
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  // Browser tool results render richly (#75); grounded assistant
                  // replies render [n] as clickable citations (#120); everything
                  // else keeps full markdown rendering.
                  msg.role === 'tool' && msg.name && isBrowserToolName(msg.name)
                    ? (() => {
                        let payload: unknown = msg.content;
                        try { payload = JSON.parse(msg.content); } catch { /* keep raw string */ }
                        return <BrowserToolResult name={msg.name} payload={payload} dark={dark} />;
                      })()
                    : msg.role === 'assistant' && msg.sources && msg.sources.length > 0
                      ? (
                        <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
                          <p className="whitespace-pre-wrap">{renderWithCitations(msg.content, msg.sources, dark)}</p>
                        </div>
                      )
                      : msg.role === 'tool'
                        ? <ToolResultBlock name={msg.name} content={msg.content} dark={dark} />
                        : (() => {
                            const body = rawView[i] && msg.role === 'assistant'
                              ? <div className="whitespace-pre-wrap text-sm">{chatSearchOpen && chatSearchQuery ? highlightChildren(msg.content, chatSearchQuery) : msg.content}</div>
                              : <MarkdownMessage content={msg.content} dark={dark} onToggleTask={(t, c) => toggleTaskInMessage(i, t, c)} highlightQuery={chatSearchOpen ? chatSearchQuery : undefined} onApplyCode={projects.find(p => p.id === activeProjectId)?.workspaceRoot ? (codeVal: string, langVal: string) => {
                                    const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
                                    if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
                                    const colonIdx = langVal.indexOf(':');
                                    let relPath = colonIdx >= 0 ? langVal.slice(colonIdx + 1) : '';
                                    if (!relPath) relPath = window.prompt('File path (relative to workspace root):', 'new-file.ts') ?? '';
                                    if (!relPath.trim()) return;
                                    const fullPath = relPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relPath) ? relPath : wsRoot.replace(/\/$/, '') + '/' + relPath;
                                    void writeFile(fullPath, codeVal).then(() => showStatusBanner(`Applied to "${relPath}"`)).catch((err) => showStatusBanner(`Failed to write "${relPath}": ${formatErrorLine(err)}`));
                                  } : undefined} />;
                            if (msg.content.length <= 1000) return body;
                            const collapsed = collapsedMsg[i] !== false;
                            return (
                              <div>
                                <div className={collapsed ? 'max-h-60 overflow-hidden relative' : ''}>{body}</div>
                                <button
                                  onClick={() => setCollapsedMsg(prev => ({ ...prev, [i]: !collapsed }))}
                                  className={`mt-1 text-xs ${dark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'}`}
                                  aria-label={collapsed ? 'Show more' : 'Show less'}
                                >{collapsed ? 'Show more' : 'Show less'}</button>
                              </div>
                            );
                          })()
                )}
                {/* Inline citation Sources list (#120) */}
                {msg.role === 'assistant' && msg.sources && (
                  <Sources sources={msg.sources} dark={dark} />
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
                {/* Structured-output validity badge (#148) */}
                {msg.role === 'assistant' && msg.content !== '' && structuredOutput.enabled && !(isLoading && i === messages.length - 1) && (() => {
                  const verdict = classifyResponse(msg.content, parseSchemaInput(structuredOutput.schema).schema);
                  return (
                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 ${verdict === 'valid' ? (dark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700') : (dark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')}`}>
                      {verdict === 'valid' ? '✓ valid JSON' : '✗ does not match schema'}
                    </span>
                  );
                })()}
                {/* Retry button on failed/error assistant messages (#299) */}
                {msg.role === 'assistant' && msg.isError && (
                  <button
                    onClick={() => retryFailedMessage(i)}
                    aria-label="Retry failed message"
                    title="Retry — re-send the last prompt"
                    disabled={isLoading}
                    className={`text-xs px-2 py-0.5 mt-1 rounded transition-colors ${dark ? 'bg-red-900/50 text-red-300 hover:bg-red-800/60' : 'bg-red-100 text-red-700 hover:bg-red-200'} disabled:opacity-40`}
                  >↻ Retry</button>
                )}
                {/* Continue generation button on cancelled replies (#303) */}
                {msg.role === 'assistant' && msg.wasCancelled && (
                  <button
                    onClick={() => void continueGeneration(i)}
                    aria-label="Continue generation"
                    title="Continue — resume generation from where it stopped"
                    disabled={isLoading}
                    className={`text-xs px-2 py-0.5 mt-1 rounded transition-colors ${dark ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/60' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} disabled:opacity-40`}
                  >▶ Continue</button>
                )}
                {/* Continue the agentic loop past max-iterations (#403) */}
                {msg.role === 'assistant' && msg.content.startsWith('⚠️ Agent stopped: maximum tool iterations') && agentHitMax && !isLoading && isAgenticMode && i === messages.length - 1 && (
                  <button
                    onClick={continueAgent}
                    aria-label="Continue agent"
                    title="Continue — run another batch of tool iterations"
                    className={`text-xs px-2 py-0.5 mt-1 rounded transition-colors ${dark ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/60' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                  >▶ Continue agent</button>
                )}
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
                    {/* Copy message (#243) */}
                    <button
                      aria-label="Copy message"
                      title="Copy message"
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopiedMsgIdx(i);
                        setTimeout(() => setCopiedMsgIdx(prev => (prev === i ? null : prev)), 1500);
                      }}
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >{copiedMsgIdx === i ? '✓' : '⧉'}</button>
                    {/* Copy message as Markdown (#268) */}
                    <button
                      aria-label="Copy message as Markdown"
                      title="Copy message as Markdown"
                      onClick={() => {
                        navigator.clipboard.writeText(messageToMarkdown(msg));
                        setCopiedMdMsgIdx(i);
                        setTimeout(() => setCopiedMdMsgIdx(prev => (prev === i ? null : prev)), 1500);
                      }}
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >{copiedMdMsgIdx === i ? '✓' : '⎘'}</button>
                    {/* Copy message as plain text (#341) */}
                    <button
                      aria-label="Copy message as plain text"
                      title="Copy message as plain text"
                      onClick={() => {
                        navigator.clipboard.writeText(messageToPlainText(msg));
                        setCopiedPtMsgIdx(i);
                        setTimeout(() => setCopiedPtMsgIdx(prev => (prev === i ? null : prev)), 1500);
                      }}
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >{copiedPtMsgIdx === i ? '✓' : 'T'}</button>
                    {/* Export individual message as Markdown (#304) */}
                    <button
                      aria-label="Download message as Markdown"
                      title="Download message as Markdown"
                      onClick={() => handleExportMessage(msg, i)}
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >⬇</button>
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
                    {/* Regenerate with a different model (#270) */}
                    {!isLoading && models.length > 1 && (
                      <div className="relative">
                        <button
                          onClick={() => setRegenMenuIdx(prev => prev === i ? null : i)}
                          aria-label="Regenerate with a different model"
                          title="Regenerate with a different model"
                          className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                        >↺▾</button>
                        {regenMenuIdx === i && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setRegenMenuIdx(null)} />
                            <div
                              role="listbox"
                              aria-label="Regenerate with model"
                              className={`absolute right-0 top-full z-50 mt-1 w-48 max-h-56 overflow-y-auto rounded-lg border py-1 text-xs shadow-lg ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                            >
                              {models.map(m => (
                                <button
                                  key={m.name}
                                  role="option"
                                  aria-selected={m.name === model}
                                  onClick={() => { setModel(m.name); regenerateMessage(i, m.name); setRegenMenuIdx(null); }}
                                  className={`w-full text-left px-3 py-1.5 truncate ${m.name === model ? (dark ? 'bg-zinc-700 text-zinc-100' : 'bg-blue-50 text-blue-700') : (dark ? 'hover:bg-zinc-700/60' : 'hover:bg-zinc-100')}`}
                                >{m.name}</button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {/* Action function buttons (#127) */}
                    {getEnabledActions().map(action => (
                      <button
                        key={action.id}
                        aria-label={`Action: ${action.name}`}
                        onClick={async () => {
                          try {
                            const result = await runAction(action.id, msg);
                            if (result) sendMessage(result);
                          } catch (e) {
                            showStatusBanner(`Action '${action.name}' failed: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                      >{action.name}</button>
                    ))}
                    {/* Edit assistant reply in place (#281) */}
                    <button
                      onClick={() => { setEditingIndex(i); setEditContent(msg.content); }}
                      aria-label="Edit response"
                      title="Edit response"
                      className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >✏</button>
                    {/* Delete this message (#280) */}
                    <button
                      onClick={() => deleteMessage(i)}
                      aria-label="Delete response"
                      title="Delete response"
                      className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-red-400' : 'text-zinc-400 hover:text-red-600'}`}
                    >🗑</button>
                    {/* Quote message into the composer (#284) */}
                    <button
                      onClick={() => quoteMessage(i)}
                      aria-label="Quote response"
                      title="Quote into composer"
                      className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >❝</button>
                    {/* Toggle raw/rendered view (#290) */}
                    <button
                      onClick={() => setRawView(prev => ({ ...prev, [i]: !prev[i] }))}
                      aria-label={rawView[i] ? 'Show rendered' : 'Show raw'}
                      title={rawView[i] ? 'Show rendered' : 'Show raw'}
                      className={`text-xs px-1 rounded transition-colors opacity-0 group-hover/msg:opacity-100 ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >{rawView[i] ? 'MD' : 'Raw'}</button>
                  </div>
                )}
                {/* Edit button on user messages (#98) */}
                {msg.role === 'user' && !isLoading && editingIndex !== i && (
                  <div className="flex justify-end mt-1 gap-1">
                    <button
                      onClick={() => { setEditingIndex(i); setEditContent(msg.content); }}
                      aria-label="Edit message"
                      title="Edit (creates a branch)"
                      className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover/msg:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white/70"
                    >✏ Edit</button>
                    <button
                      onClick={() => deleteMessage(i)}
                      aria-label="Delete message"
                      title="Delete message"
                      className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover/msg:opacity-100 transition-opacity bg-white/10 hover:bg-red-500/30 text-white/70"
                    >🗑 Delete</button>
                    <button
                      onClick={() => quoteMessage(i)}
                      aria-label="Quote message"
                      title="Quote into composer"
                      className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover/msg:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 text-white/70"
                    >❝ Quote</button>
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
              </React.Fragment>
              );
            })}

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
                    {reply.reasoning && <ReasoningBlock reasoning={reply.reasoning} dark={dark} />}
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
          {showScrollTopButton && (
            <button
              onClick={scrollToTop}
              aria-label="Scroll to top"
              className={`absolute top-4 right-4 px-3 py-1.5 rounded-full text-xs shadow-md transition-colors ${
                dark ? 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600' : 'bg-white text-zinc-700 hover:bg-zinc-100'
              }`}
            >↑ Back to top</button>
          )}
          {showScrollButton && (
            <button
              onClick={scrollToBottom}
              aria-label={unreadCount > 0 ? `Scroll to bottom (${unreadCount} new messages)` : 'Scroll to bottom'}
              className={`absolute bottom-4 right-4 px-3 py-1.5 rounded-full text-xs shadow-md transition-colors flex items-center gap-1.5 ${
                dark ? 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600' : 'bg-white text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <span>↓ Scroll to bottom</span>
              {unreadCount > 0 && (
                <span className="bg-blue-600 text-white rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none" aria-hidden="true">
                  {unreadCount} new
                </span>
              )}
            </button>
          )}
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
              <button onClick={() => startNewChat()} className="px-2 py-0.5 rounded border border-current hover:opacity-80">Discard</button>
            </div>
          </div>
        )}

        {/* Input Area - Responsive: full width on mobile, constrained on desktop */}
        <div
          data-testid="composer-dropzone"
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragOver(false); }}
          className={`p-4 md:p-6 pb-6 pt-2 shrink-0 rounded-xl transition-colors ${
            isDragOver ? (dark ? 'bg-blue-900/30 ring-2 ring-blue-500' : 'bg-blue-50 ring-2 ring-blue-400') : ''
          } ${dark ? 'bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-transparent' : 'bg-gradient-to-t from-zinc-100 via-zinc-100/80 to-transparent'}`}
        >
          {/* M5 Issue 20: Image thumbnails preview */}
          {attachedImages.length > 0 && (
            <div className="max-w-3xl mx-auto flex flex-wrap gap-2 mb-2">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={img}
                    alt="pending attachment"
                    onClick={() => setLightboxImage(img)}
                    title="Click to view full size"
                    className="h-16 w-16 object-cover rounded-lg border border-zinc-600 cursor-zoom-in"
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

             {/* @-mention file autocomplete dropdown (#86/#183) */}
             {atSuggestions.length > 0 && (
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                 {atSuggestions.map((opt, idx) => (
                   <button
                     key={opt.path}
                     type="button"
                     onMouseDown={(e) => {
                       e.preventDefault();
                       void resolveAtMention(input, opt.path, opt.label).then(resolved => { setInput(resolved); setAtSuggestions([]); });
                     }}
                     className={`w-full text-left px-3 py-2 text-sm flex gap-2 items-baseline ${
                       idx === atSelected ? (dark ? 'bg-zinc-700' : 'bg-blue-50') : (dark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50')
                     }`}
                   >
                     <span className={`${dark ? 'text-amber-400' : 'text-amber-600'}`}>{opt.kind === 'dir' ? '📁' : '📄'}</span>
                     <span className={`font-mono text-xs ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{opt.label}</span>
                   </button>
                 ))}
               </div>
             )}

             {/* #-knowledge context dropdown (#119/#184) */}
             {hashSuggestions.length > 0 && (
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                 {hashSuggestions.map((opt, idx) => (
                   <button
                     key={opt.id ?? opt.url ?? opt.label}
                     type="button"
                     onMouseDown={(e) => {
                       e.preventDefault();
                       const ref: ContextRef = { kind: opt.kind, id: opt.id, url: opt.url, label: opt.label };
                       const stripped = input.replace(/#\S*$/, '').trim();
                       void resolveContextRef(ref, stripped, { ollamaBaseUrl }).then(sources => {
                         const block = buildContextBlock(sources);
                         if (block) setPendingContextBlocks(prev => [...prev, block]);
                       });
                       setInput(stripped);
                       setHashSuggestions([]);
                     }}
                     className={`w-full text-left px-3 py-2 text-sm flex gap-2 items-baseline ${
                       idx === hashSelected ? (dark ? 'bg-zinc-700' : 'bg-blue-50') : (dark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50')
                     }`}
                   >
                     <span className={`font-semibold ${dark ? 'text-emerald-400' : 'text-emerald-600'}`}>#</span>
                     <span className={`text-xs ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{opt.label}</span>
                     {opt.sublabel && <span className={`text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{opt.sublabel}</span>}
                   </button>
                 ))}
               </div>
             )}

             {/* Pinned file context chips (#350) */}
            {pinnedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1" aria-label="Pinned files">
                {pinnedFiles.map((f, i) => (
                  <span key={f.path} className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                    <span>📎 {f.path}</span>
                    <button type="button" aria-label={`Drop pinned file ${f.path}`} title="Drop pinned file" className="opacity-60 hover:opacity-100" onMouseDown={e => { e.preventDefault(); const next = dropPinnedFile(pinnedFiles, f.path); setPinnedFiles(next); savePinnedFiles(next); }}>×</button>
                  </span>
                ))}
                {pinnedFiles.length > 1 && (
                  <button type="button" aria-label="Clear all pinned files" title="Clear all pinned files" className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'}`} onMouseDown={e => { e.preventDefault(); setPinnedFiles([]); savePinnedFiles([]); showStatusBanner('Cleared all pinned files'); }}>Clear all</button>
                )}
              </div>
            )}

             {/* Pending context chips from # commands (#184) */}
             {pendingContextBlocks.length > 0 && (
               <div className="flex flex-wrap gap-1 mb-1">
                 {pendingContextBlocks.map((_, i) => (
                   <span key={i} className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${dark ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                     <span>#context {i + 1}</span>
                     <button type="button" className="opacity-60 hover:opacity-100" onMouseDown={e => { e.preventDefault(); setPendingContextBlocks(prev => prev.filter((_, j) => j !== i)); }}>×</button>
                   </span>
                 ))}
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
             <textarea
               id="chat-input"
               rows={1}
               value={input}
               onPaste={handlePaste}
               onChange={(e) => {
                 const val = e.target.value;
                 setInput(val);
                 // Auto-grow the multi-line composer up to a max height (#259)
                 const ta = e.target;
                 ta.style.height = 'auto';
                 ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
                 // Show slash command suggestions when input starts with /
                 if (val.startsWith('/')) {
                   const query = val.split(' ')[0];
                   const suggestions = filterCommands(query);
                   setCommandSuggestions(suggestions.slice(0, 6));
                   setSelectedSuggestion(0);
                   setAtSuggestions([]);
                   setHashSuggestions([]);
                 } else if (isAtTrigger(val)) {
                   // @-file mention autocomplete (#86/#183)
                   setCommandSuggestions([]);
                   setHashSuggestions([]);
                   void getAtOptions(atQuery(val)).then(opts => { setAtSuggestions(opts); setAtSelected(0); });
                 } else if (isHashTrigger(val)) {
                   // #-knowledge autocomplete (#119/#184)
                   setCommandSuggestions([]);
                   setAtSuggestions([]);
                   void getAutocompleteOptions(hashQuery(val)).then(opts => { setHashSuggestions(opts); setHashSelected(0); });
                 } else {
                   setCommandSuggestions([]);
                   setAtSuggestions([]);
                   setHashSuggestions([]);
                 }
               }}
               onKeyDown={(e) => {
                 // @-mention keyboard nav (#183)
                 if (atSuggestions.length > 0) {
                   if (e.key === 'ArrowDown') { e.preventDefault(); setAtSelected(s => Math.min(s + 1, atSuggestions.length - 1)); return; }
                   if (e.key === 'ArrowUp') { e.preventDefault(); setAtSelected(s => Math.max(s - 1, 0)); return; }
                   if (e.key === 'Tab' || e.key === 'Enter') {
                     e.preventDefault();
                     const opt = atSuggestions[atSelected];
                     void resolveAtMention(input, opt.path, opt.label).then(resolved => { setInput(resolved); setAtSuggestions([]); });
                     return;
                   }
                   if (e.key === 'Escape') { setAtSuggestions([]); return; }
                 }
                 // #-knowledge keyboard nav (#184)
                 if (hashSuggestions.length > 0) {
                   if (e.key === 'ArrowDown') { e.preventDefault(); setHashSelected(s => Math.min(s + 1, hashSuggestions.length - 1)); return; }
                   if (e.key === 'ArrowUp') { e.preventDefault(); setHashSelected(s => Math.max(s - 1, 0)); return; }
                   if (e.key === 'Tab' || e.key === 'Enter') {
                     e.preventDefault();
                     const opt = hashSuggestions[hashSelected];
                     const ref: ContextRef = { kind: opt.kind, id: opt.id, url: opt.url, label: opt.label };
                     const stripped = input.replace(/#\S*$/, '').trim();
                     void resolveContextRef(ref, stripped, { ollamaBaseUrl }).then(sources => {
                       const block = buildContextBlock(sources);
                       if (block) setPendingContextBlocks(prev => [...prev, block]);
                     });
                     setInput(stripped);
                     setHashSuggestions([]);
                     return;
                   }
                   if (e.key === 'Escape') { setHashSuggestions([]); return; }
                 }
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
                 // Tab-to-indent / Shift+Tab to outdent (#360) — TUI/Codex/Claude
                 // parity. Only when no autocomplete suggestions are open.
                 if (e.key === 'Tab' && atSuggestions.length === 0 && hashSuggestions.length === 0 && commandSuggestions.length === 0) {
                   e.preventDefault();
                   const ta = e.currentTarget as HTMLTextAreaElement;
                   const start = ta.selectionStart ?? input.length;
                   const end = ta.selectionEnd ?? input.length;
                   if (e.shiftKey) {
                     const lineStart = input.lastIndexOf('\n', start - 1) + 1;
                     const linePrefix = input.slice(lineStart, start);
                     const stripped = linePrefix.replace(/^ {1,2}/, '');
                     const removed = linePrefix.length - stripped.length;
                     if (removed > 0) {
                       const next = input.slice(0, lineStart) + stripped + input.slice(start);
                       setInput(next);
                       setTimeout(() => { ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - removed); }, 0);
                     }
                   } else {
                     const next = input.slice(0, start) + '  ' + input.slice(end);
                     setInput(next);
                     setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2; }, 0);
                   }
                   return;
                 }
                 // Up-arrow in an empty composer edits the last user message (#267)
                 // — parity with ChatGPT / Cursor quick-edit. Ignored while
                 // suggestions are open or a generation is in progress.
                 if (e.key === 'ArrowUp' && !e.altKey && input.trim() === '' && !isLoading) {
                   for (let j = messages.length - 1; j >= 0; j--) {
                     if (messages[j].role === 'user') {
                       e.preventDefault();
                       setEditingIndex(j);
                       setEditContent(messages[j].content);
                       return;
                     }
                   }
                 }
                 // Prompt history navigation: Alt+Up/Alt+Down (#332)
                 if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                   e.preventDefault();
                   const hist = promptHistoryRef.current;
                   if (hist.length === 0) return;
                   let idx = historyNavIndexRef.current;
                   if (e.key === 'ArrowUp') {
                     idx = Math.min(idx - 1, hist.length - 1);
                   } else {
                     idx = idx + 1;
                   }
                   if (idx < 0) idx = 0;
                   if (idx >= hist.length) {
                     historyNavIndexRef.current = hist.length;
                     setInput('');
                     return;
                   }
                   historyNavIndexRef.current = idx;
                   setInput(hist[idx]);
                   return;
                 }
                 if (e.key === 'Enter' && !e.shiftKey && !sendOnCtrlEnter) {
                   e.preventDefault();
                   setCommandSuggestions([]);
                   sendMessage();
                 } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sendOnCtrlEnter) {
                   e.preventDefault();
                   setCommandSuggestions([]);
                   sendMessage();
                 }
               }}
               placeholder="Message Ollama..."
               aria-label="Type your message here"
               className={`flex-1 border rounded-xl px-4 py-3 resize-none max-h-40 overflow-y-auto leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                 dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
               }`}
             ></textarea>
             {/* Many-models extra-model picker (#126) */}
             {[...models, ...connectedModels].length > 1 && (
               <select
                 multiple
                 aria-label="Compare with additional models"
                 value={extraModels}
                 onChange={e => setExtraModels(Array.from(e.target.selectedOptions, o => o.value))}
                 title="Ctrl/Cmd+click to select 1-2 additional models for comparison"
                 className={`hidden sm:block w-44 text-xs border rounded-xl px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-400' : 'bg-white border-zinc-300 text-zinc-600'}`}
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
          {/* Composer word/character/token counter (#301, #368) */}
          {input.trim() && (
            <div className={`text-right text-[10px] mt-1 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
              {input.trim().split(/\s+/).filter(Boolean).length} words · {input.length} chars · ~{estimateTokens(input)} tokens
            </div>
          )}
          <div className={`text-center text-[10px] mt-2 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            {(() => {
              const cost = formatCost(conversationTokens);
              return (
                <>
                  <span title="Approximate token usage for this conversation (and current draft)">
                    ≈ {formatTokenCount(conversationTokens)} tokens{cost ? ` · ${cost}` : ''}
                  </span>
                  {' · '}
                  <ContextBudget tokens={conversationTokens} numCtx={genOptions.num_ctx} dark={dark} />
                </>
              );
            })()}
            {' · '}Ollama GUI — Built for speed and privacy. · Cmd+K new chat · Cmd+F find · Cmd+P commands · ? for shortcuts
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
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Local Ollama Endpoint</label>
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
                    The local Ollama server. Models from this server appear under "Local Ollama" in the model selector.
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

                 {/* Remote Ollama servers — quick add/remove */}
                 <div>
                   <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Remote Ollama Servers</label>
                   <p className={`text-[10px] mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     Add remote Ollama instances (e.g. a server on another machine). Their models appear under "Remote Ollama: name" in the model selector.
                   </p>
                   {/* Existing remote Ollama connections */}
                   {connections.filter(c => c.kind === 'ollama').length > 0 && (
                     <div className="space-y-1 mb-2">
                       {connections.filter(c => c.kind === 'ollama').map(conn => {
                         const modelCount = connectedModels.filter(m => m.connectionId === conn.id).length;
                         return (
                           <div key={conn.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 border ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
                             <div className="flex-1 min-w-0">
                               <div className={`text-xs font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{conn.name}</div>
                               <div className={`text-[10px] font-mono truncate ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{conn.baseUrl} · {modelCount} model{modelCount !== 1 ? 's' : ''}</div>
                             </div>
                             <button
                               onClick={() => {
                                 const updated = connections.map(c => c.id === conn.id ? { ...c, enabled: !c.enabled } : c);
                                 saveConnections(updated);
                                 setConnections(updated);
                               }}
                               className={`shrink-0 text-[10px] px-2 py-0.5 rounded border ${conn.enabled ? (dark ? 'border-emerald-700 text-emerald-400' : 'border-emerald-400 text-emerald-600') : (dark ? 'border-zinc-600 text-zinc-500' : 'border-zinc-300 text-zinc-400')}`}
                             >{conn.enabled ? 'On' : 'Off'}</button>
                             <button
                               onClick={() => {
                                 const updated = connections.filter(c => c.id !== conn.id);
                                 saveConnections(updated);
                                 setConnections(updated);
                                 setConnectedModels(prev => prev.filter(m => m.connectionId !== conn.id));
                               }}
                               className="shrink-0 text-red-400 hover:text-red-300 text-xs"
                             >✕</button>
                           </div>
                         );
                       })}
                     </div>
                   )}
                   {/* Quick-add form */}
                   <div className="flex gap-1 mb-1">
                     <input
                       value={newRemoteOllamaName}
                       onChange={e => setNewRemoteOllamaName(e.target.value)}
                       placeholder="Name (e.g. Home Server)"
                       className={`flex-1 text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                     />
                   </div>
                   <div className="flex gap-1">
                     <input
                       value={newRemoteOllamaUrl}
                       onChange={e => setNewRemoteOllamaUrl(e.target.value)}
                       placeholder="URL (e.g. http://192.168.1.10:11434)"
                       className={`flex-1 text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                     />
                     <button
                       onClick={async () => {
                         const rawUrl = newRemoteOllamaUrl.trim();
                         const name = newRemoteOllamaName.trim() || rawUrl;
                         if (!rawUrl) return;
                         const conn = addConnection({ name, kind: 'ollama', baseUrl: rawUrl, enabled: true });
                         const updated = loadConnections();
                         setConnections(updated);
                         setNewRemoteOllamaUrl('');
                         setNewRemoteOllamaName('');
                         // Fetch models from the new remote server
                         const { fetchOllamaConnectionModels } = await import('./services/connections');
                         fetchOllamaConnectionModels(conn).then(newModels => {
                           setConnectedModels(prev => [...prev.filter(m => m.connectionId !== conn.id), ...newModels]);
                         }).catch(() => {});
                       }}
                       className={`shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white`}
                     >Add</button>
                   </div>
                 </div>

                 {/* System Prompt */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>System Prompt</label>
                   {/* System prompt presets (#315) */}
                   <div className="flex gap-2 mb-2">
                     <select
                       aria-label="Persona presets"
                       onChange={(e) => { if (e.target.value) { updateSystemPrompt(e.target.value); e.target.value = ''; } }}
                       className={`text-xs border rounded-lg px-2 py-1 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-zinc-100 border-zinc-300 text-zinc-600'}`}
                       defaultValue=""
                     >
                       <option value="" disabled>Apply preset…</option>
                       <option value="You are a helpful assistant.">Default</option>
                       <option value="You are an expert software engineer. Write clean, well-structured code with comments where needed. Explain your reasoning briefly.">Coding assistant</option>
                       <option value="You are a creative writing assistant. Help users craft engaging stories, poems, and prose with vivid language and imagination.">Creative writer</option>
                       <option value="You are a concise assistant. Answer briefly and to the point. Avoid unnecessary elaboration.">Concise responder</option>
                       <option value="You are a professional translator. Translate text accurately while preserving tone, context, and cultural nuances.">Translator</option>
                       <option value="">Custom (clear)</option>
                     </select>
                   </div>
                   <textarea
                     value={systemPrompt}
                     onChange={(e) => updateSystemPrompt(e.target.value)}
                     aria-label="System prompt"
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
                         aria-label="Context window (num_ctx)"
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
                         aria-label="Temperature"
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

                 {/* Privacy & data — secure cleanup (#38) */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Privacy &amp; data</label>
                   <button
                     onClick={() => {
                       if (!confirm('Securely erase ALL local data (chats, settings, MCP servers)? This cannot be undone.')) return;
                       const wiped = secureWipeAll();
                       notify(`Securely erased ${wiped.length} stored item${wiped.length === 1 ? '' : 's'}.`);
                       setSessions([]); setFolders([]); setMessages([]); setCurrentSessionId(null);
                       setMcpServers([]);
                     }}
                     className={`text-xs px-3 py-1.5 rounded border transition-colors ${dark ? 'border-red-800 text-red-400 hover:bg-red-950/40' : 'border-red-300 text-red-600 hover:bg-red-50'}`}
                   >
                     Securely erase all local data
                   </button>
                   <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     Overwrites then removes every stored item. Secrets (tokens) already live in the OS keychain; chat history can be encrypted at rest with AES-GCM via secureStorage.
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
                     <Toggle checked={isAgenticMode} onChange={() => setIsAgenticMode(!isAgenticMode)} dark={dark} label="Toggle tool calling" />
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
                     <div className="flex items-center gap-1.5">
                       <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                         mlxAvailability?.available
                           ? (dark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700')
                           : (dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500')
                       }`}>
                         {mlxAvailability === null ? 'checking…' : mlxAvailability.available ? `available${mlxAvailability.version ? ` · ${mlxAvailability.version}` : ''}` : 'unavailable'}
                       </span>
                       <button
                         onClick={async () => {
                           setMlxAvailability(null);
                           try { setMlxAvailability(await checkMlxAvailable()); } catch { setMlxAvailability(null); }
                         }}
                         title="Re-check MLX availability"
                         className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'}`}
                       >↺</button>
                     </div>
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
                              {/* Per-tool enable/disable (Claude Code parity, #399) */}
                              <span onClick={e => e.stopPropagation()} title={disabledTools.has(tool.name) ? 'Enable this tool' : 'Disable this tool'}>
                                <Toggle dark={dark} label={`Toggle ${tool.name}`} checked={!disabledTools.has(tool.name)} onChange={() => { const next = setToolEnabled(tool.name, disabledTools.has(tool.name)); setDisabledTools(new Set(next)); }} />
                              </span>
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
                      aria-label="Model name to pull"
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
                  {/* Notify on completion (#310) */}
                  <div className={`rounded-lg border p-3 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Notify on completion</span>
                      <Toggle
                        checked={notifyOnComplete}
                        onChange={() => {
                          const next = !notifyOnComplete;
                          setNotifyOnComplete(next);
                          try { safeSetItem('ollama_gui_notify_complete', String(next)); } catch { /* ignore */ }
                          if (next && 'Notification' in window && Notification.permission !== 'granted') {
                            Notification.requestPermission().catch(() => {});
                          }
                        }}
                        dark={dark}
                        label="Notify on completion"
                      />
                    </div>
                    <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      Shows a browser notification when a reply finishes while the tab is in the background.
                    </p>
                  </div>
                  {/* Completion sound (#320) */}
                  <div className={`rounded-lg border p-3 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Play sound on completion</span>
                      <Toggle
                        checked={playSoundOnComplete}
                        onChange={() => {
                          const next = !playSoundOnComplete;
                          setPlaySoundOnComplete(next);
                          try { safeSetItem('ollama_gui_sound_complete', String(next)); } catch { /* ignore */ }
                        }}
                        dark={dark}
                        label="Play sound on completion"
                      />
                    </div>
                    <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      Plays a short beep when a reply finishes.
                    </p>
                  </div>
                </div>

                {/* Prompt library (#97) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Prompt Library ({prompts.length})</label>
                  <div className={`rounded-lg border divide-y overflow-hidden mb-2 ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {prompts.length === 0
                      ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No saved prompts. Add one below or click "Save input" to save your current draft.</p>
                      : prompts.map(p => (
                        <div key={p.id} className={`flex items-center gap-2 px-3 py-2 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-medium truncate ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>{p.name}</div>
                            <div className={`text-[10px] truncate ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{p.body.slice(0, 60)}{p.body.length > 60 ? '…' : ''}</div>
                          </div>
                          <button
                            onClick={() => { setInput(prev => prev ? `${prev}\n${p.body}` : p.body); }}
                            title="Insert into chat input"
                            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                          >Use</button>
                          <button onClick={() => { removePrompt(p.id); setPrompts(loadPrompts()); }} className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-400 hover:text-red-500'}`}>✕</button>
                        </div>
                      ))
                    }
                  </div>
                  <div className="flex flex-col gap-1">
                    <input placeholder="Prompt name" value={newPromptName} onChange={e => setNewPromptName(e.target.value)}
                      className={`border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    <textarea placeholder="Prompt body (or use 'Save input' to save the current draft)" value={newPromptBody} onChange={e => setNewPromptBody(e.target.value)}
                      rows={2}
                      className={`border rounded px-2 py-1 text-xs font-mono resize-none focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          if (!newPromptName.trim() || !newPromptBody.trim()) return;
                          addPrompt({ name: newPromptName.trim(), body: newPromptBody.trim() });
                          setPrompts(loadPrompts());
                          setNewPromptName('');
                          setNewPromptBody('');
                        }}
                        className="flex-1 text-xs py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                      >Save</button>
                      <button
                        onClick={() => {
                          if (!newPromptName.trim() || !input.trim()) return;
                          addPrompt({ name: newPromptName.trim(), body: input.trim() });
                          setPrompts(loadPrompts());
                          setNewPromptName('');
                        }}
                        title="Save current chat input as a prompt"
                        className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                      >Save input</button>
                    </div>
                    <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Prompts appear in the 📋 picker next to the composer. "Use" inserts them into the input.</p>
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
                      {/* Workspace folder picker (#83) */}
                      <label className={`block text-xs mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Workspace folder</label>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`flex-1 text-xs truncate font-mono px-2 py-1 rounded border ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-400' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                          {p.workspaceRoot || 'No folder selected'}
                        </span>
                        <button
                          onClick={async () => {
                            const dir = await pickDirectory();
                            if (dir) {
                              const updated = { ...p, workspaceRoot: dir };
                              storage.saveProject(updated);
                              setProjects(storage.getProjects());
                              if (activeProjectId === p.id) {
                                void openWorkspace(dir);
                                registerGitTools(dir);
                              }
                            }
                          }}
                          className={`shrink-0 text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                        >Choose…</button>
                        {p.workspaceRoot && (
                          <button
                            onClick={() => {
                              const updated = { ...p, workspaceRoot: '' };
                              storage.saveProject(updated);
                              setProjects(storage.getProjects());
                            }}
                            className="shrink-0 text-[10px] text-red-400 hover:text-red-300"
                            title="Clear workspace folder"
                          >✕</button>
                        )}
                      </div>
                      {/* Per-project model binding (#171) */}
                      <label className={`block text-xs mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Default model (optional)</label>
                      <select
                        value={p.model ?? ''}
                        onChange={e => {
                          const updated = { ...p, model: e.target.value || undefined };
                          storage.saveProject(updated);
                          setProjects(storage.getProjects());
                          if (activeProjectId === p.id && updated.model) setModel(updated.model);
                        }}
                        className={`w-full text-xs px-2 py-1.5 rounded border mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                      >
                        <option value="">— inherit global model —</option>
                        {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
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

                {/* Agent Safety — autonomy levels (#88, #89, #146) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Agent Safety</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Control how autonomously the agent acts when using tools.</p>
                  {/* Autonomy level */}
                  <div className="mb-3">
                    <label className={`block text-xs mb-1.5 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Autonomy level</label>
                    <div className="flex gap-2">
                      {(['plan', 'ask', 'auto'] as AutonomyLevel[]).map(level => (
                        <button
                          key={level}
                          aria-pressed={autonomySettings.level === level}
                          onClick={() => { const s = { ...autonomySettings, level }; setAutonomySettings(s); saveAutonomySettings(s); }}
                          className={`flex-1 text-xs py-1 rounded border transition-colors capitalize ${autonomySettings.level === level ? (dark ? 'bg-blue-600 border-blue-500 text-white' : 'bg-blue-600 border-blue-500 text-white') : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100')}`}
                        >{level}</button>
                      ))}
                    </div>
                    <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {autonomySettings.level === 'plan' && 'Agent proposes a plan first; executes only after approval.'}
                      {autonomySettings.level === 'ask' && 'Agent confirms each mutating tool call before running it.'}
                      {autonomySettings.level === 'auto' && 'Agent runs all tools without interruption.'}
                    </p>
                  </div>
                  {/* Max iterations */}
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Max iterations</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={autonomySettings.maxIterations}
                      onChange={e => { const v = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1)); const s = { ...autonomySettings, maxIterations: v }; setAutonomySettings(s); saveAutonomySettings(s); }}
                      className={`w-20 text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                    />
                  </div>
                  {/* Read-only mode */}
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Read only mode</span>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Block all tools that write or execute; only read tools are allowed.</p>
                    </div>
                    <Toggle dark={dark} label="Read only mode" checked={autonomySettings.readOnly} onChange={() => { const s = { ...autonomySettings, readOnly: !autonomySettings.readOnly }; setAutonomySettings(s); saveAutonomySettings(s); }} />
                  </div>
                  {/* Smart approve */}
                  {autonomySettings.level === 'ask' && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Smart approve</span>
                        <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Auto-approve safe read tools; only prompt before mutating ones.</p>
                      </div>
                      <Toggle dark={dark} label="Smart approve" checked={autonomySettings.smartApprove} onChange={() => { const s = { ...autonomySettings, smartApprove: !autonomySettings.smartApprove }; setAutonomySettings(s); saveAutonomySettings(s); }} />
                    </div>
                  )}
                  {/* Auto-commit after edits (Aider parity, #401) */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Auto-commit edits</span>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Stage & commit each applied file edit to the workspace git repo with a descriptive message.</p>
                    </div>
                    <Toggle dark={dark} label="Auto-commit edits" checked={autoCommitEdits} onChange={() => { const v = !autoCommitEdits; setAutoCommitEdits(v); saveAutoCommitEdits(v); }} />
                  </div>
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

                {/* Web Search (#121/#192) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Web Search</label>
                    <Toggle
                      dark={dark}
                      label="Enable web search"
                      checked={webSearchConfig.enabled}
                      onChange={() => {
                        const updated = { ...webSearchConfig, enabled: !webSearchConfig.enabled };
                        setWebSearchConfig(updated);
                        saveWebSearchConfig(updated);
                      }}
                    />
                  </div>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    When enabled, search results are injected into the system prompt before each message. The agent can also call <span className="font-mono">search_web</span> directly.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className={`text-xs w-20 shrink-0 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Provider</label>
                      <select
                        value={webSearchConfig.provider}
                        onChange={e => {
                          const updated = { ...webSearchConfig, provider: e.target.value as 'duckduckgo' | 'searxng' };
                          setWebSearchConfig(updated);
                          saveWebSearchConfig(updated);
                        }}
                        className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                      >
                        <option value="duckduckgo">DuckDuckGo (no key)</option>
                        <option value="searxng">SearXNG (self-hosted)</option>
                      </select>
                    </div>
                    {webSearchConfig.provider === 'searxng' && (
                      <div className="flex items-center gap-2">
                        <label className={`text-xs w-20 shrink-0 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>SearXNG URL</label>
                        <input
                          value={webSearchConfig.searxngUrl ?? ''}
                          onChange={e => {
                            const updated = { ...webSearchConfig, searxngUrl: e.target.value };
                            setWebSearchConfig(updated);
                            saveWebSearchConfig(updated);
                          }}
                          placeholder="http://localhost:8888"
                          className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <label className={`text-xs w-20 shrink-0 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Results</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={webSearchConfig.resultCount ?? 5}
                        onChange={e => {
                          const n = parseInt(e.target.value, 10);
                          if (!isNaN(n)) {
                            const updated = { ...webSearchConfig, resultCount: n };
                            setWebSearchConfig(updated);
                            saveWebSearchConfig(updated);
                          }
                        }}
                        className={`w-16 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
                      />
                    </div>
                  </div>
                </div>

                {/* Secret Store (#173) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Secret Store</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Secrets are stored in the OS keychain (encrypted file fallback). The agent can read them via <span className="font-mono">secret_get</span>. Values are never displayed.</p>
                  <div className="space-y-1 mb-3 max-h-28 overflow-y-auto">
                    {secretKeys.map(r => (
                      <div key={`${r.service}:${r.key}`} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${dark ? 'bg-zinc-800 text-zinc-300' : 'bg-white text-zinc-700'}`}>
                        <span className={`shrink-0 font-mono text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{r.service}</span>
                        <span className="flex-1 font-mono">{r.key}</span>
                        <span className={`shrink-0 text-[10px] ${dark ? 'text-zinc-600' : 'text-zinc-300'}`}>••••••••</span>
                        <button
                          onClick={async () => {
                            await secretDelete(r.service, r.key);
                            setSecretKeys(secretListRefs());
                          }}
                          className="shrink-0 text-red-400 hover:text-red-300 text-[10px]"
                          title="Delete secret"
                        >✕</button>
                      </div>
                    ))}
                    {secretKeys.length === 0 && <p className={`text-xs italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No secrets stored.</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-1 mb-1">
                    <input
                      value={newSecretService}
                      onChange={e => setNewSecretService(e.target.value)}
                      placeholder="Service (e.g. openai)"
                      className={`text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                    <input
                      value={newSecretKey}
                      onChange={e => setNewSecretKey(e.target.value)}
                      placeholder="Key (e.g. api_key)"
                      className={`text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      value={newSecretValue}
                      onChange={e => setNewSecretValue(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === 'Enter' && newSecretService.trim() && newSecretKey.trim() && newSecretValue) {
                          await secretSet(newSecretService.trim(), newSecretKey.trim(), newSecretValue);
                          setSecretKeys(secretListRefs());
                          setNewSecretService(''); setNewSecretKey(''); setNewSecretValue('');
                        }
                      }}
                      placeholder="Value (never stored on disk)"
                      className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                    <button
                      onClick={async () => {
                        if (newSecretService.trim() && newSecretKey.trim() && newSecretValue) {
                          await secretSet(newSecretService.trim(), newSecretKey.trim(), newSecretValue);
                          setSecretKeys(secretListRefs());
                          setNewSecretService(''); setNewSecretKey(''); setNewSecretValue('');
                        }
                      }}
                      className="shrink-0 text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >Save</button>
                  </div>
                </div>

                {/* Knowledge Collections (#117/#188) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Knowledge Collections</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Create document collections for RAG-based context injection. Reference them with <span className="font-mono">#collection-name</span> in the chat.</p>
                  <div className="space-y-1 mb-3 max-h-52 overflow-y-auto">
                    {knowledgeCollections.map(col => (
                      <div key={col.id} className={`rounded-lg border overflow-hidden ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                        <div className={`flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer select-none ${dark ? 'bg-zinc-800 hover:bg-zinc-700/50' : 'bg-white hover:bg-zinc-50'}`}
                          onClick={() => {
                            if (expandedCollection === col.id) {
                              setExpandedCollection(null);
                            } else {
                              setExpandedCollection(col.id);
                              if (!knowledgeFilesMap[col.id]) {
                                void getFilesForCollection(col.id).then(files =>
                                  setKnowledgeFilesMap(prev => ({ ...prev, [col.id]: files }))
                                );
                              }
                            }
                          }}
                        >
                          <span className="opacity-50">{expandedCollection === col.id ? '▼' : '▶'}</span>
                          <span className={`flex-1 font-medium ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{col.name}</span>
                          <span className={`opacity-50 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{new Date(col.updatedAt).toLocaleDateString()}</span>
                          <button
                            type="button"
                            onClick={async e => {
                              e.stopPropagation();
                              if (!confirm(`Delete collection "${col.name}" and all its files?`)) return;
                              await deleteCollection(col.id);
                              const updated = await listCollections();
                              setKnowledgeCollections(updated);
                              if (expandedCollection === col.id) setExpandedCollection(null);
                            }}
                            className="shrink-0 text-red-400 hover:text-red-300 ml-1"
                            title="Delete collection"
                          >✕</button>
                        </div>
                        {expandedCollection === col.id && (
                          <div className={`px-2 pb-2 pt-1 ${dark ? 'bg-zinc-800/50' : 'bg-zinc-50'}`}>
                            <div className="space-y-1 mb-2">
                              {(knowledgeFilesMap[col.id] ?? []).map(f => (
                                <div key={f.id} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${dark ? 'bg-zinc-900 text-zinc-300' : 'bg-white text-zinc-700'}`}>
                                  <span className="flex-1 font-mono truncate">{f.name}</span>
                                  <span className={`shrink-0 opacity-50 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{(f.sizeBytes / 1024).toFixed(1)} KB</span>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await removeFile(f.id);
                                      const files = await getFilesForCollection(col.id);
                                      setKnowledgeFilesMap(prev => ({ ...prev, [col.id]: files }));
                                    }}
                                    className="shrink-0 text-red-400 hover:text-red-300 text-[10px]"
                                    title="Remove file"
                                  >✕</button>
                                </div>
                              ))}
                              {(knowledgeFilesMap[col.id] ?? []).length === 0 && (
                                <p className={`text-xs italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No files yet.</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (knowledgeFileInputRef.current) {
                                  knowledgeFileInputRef.current.dataset.collectionId = col.id;
                                  knowledgeFileInputRef.current.click();
                                }
                              }}
                              className={`text-xs px-2 py-1 rounded border ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}
                            >+ Add file</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {knowledgeCollections.length === 0 && <p className={`text-xs italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No collections yet.</p>}
                  </div>
                  <div className="flex gap-1">
                    <input
                      value={newCollectionName}
                      onChange={e => setNewCollectionName(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === 'Enter' && newCollectionName.trim()) {
                          await createCollection(newCollectionName.trim());
                          setKnowledgeCollections(await listCollections());
                          setNewCollectionName('');
                        }
                      }}
                      placeholder="New collection name…"
                      className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                    <button
                      onClick={async () => {
                        if (newCollectionName.trim()) {
                          await createCollection(newCollectionName.trim());
                          setKnowledgeCollections(await listCollections());
                          setNewCollectionName('');
                        }
                      }}
                      className="shrink-0 text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >Create</button>
                  </div>
                  {/* Hidden file input for adding documents */}
                  <input
                    ref={knowledgeFileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.rs,.html,.css,.yaml,.yml,.toml"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      const colId = knowledgeFileInputRef.current?.dataset.collectionId;
                      if (!file || !colId) return;
                      const text = await file.text();
                      await addFile(colId, file.name, file.type || 'text/plain', file.size, text);
                      const files = await getFilesForCollection(colId);
                      setKnowledgeFilesMap(prev => ({ ...prev, [colId]: files }));
                      e.target.value = '';
                    }}
                  />
                </div>

                {/* Browser Scenarios (#78/#200) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Browser Scenarios</label>
                  <p className={`text-[10px] mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Record and replay browser UI test flows. Each scenario is a sequence of navigate/click/type/assert/visual_match steps run against the embedded browser.
                  </p>
                  <div className={`rounded-lg border divide-y overflow-hidden mb-2 ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {scenarios.length === 0
                      ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No scenarios saved yet. Create one below.</p>
                      : scenarios.map(sc => {
                        const result = scenarioResults[sc.id];
                        const isRunning = runningScenarioId === sc.id;
                        return (
                          <div key={sc.id} className={`px-3 py-2 ${dark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'}`}>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{sc.name}</div>
                                <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{sc.steps.length} step{sc.steps.length !== 1 ? 's' : ''}</div>
                              </div>
                              {result && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${result.pass ? (dark ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700') : (dark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')}`}>
                                  {result.pass ? '✓ pass' : `✕ fail (step ${result.failedStepIndex ?? 0})`}
                                </span>
                              )}
                              <button
                                disabled={isRunning}
                                onClick={async () => {
                                  setRunningScenarioId(sc.id);
                                  try {
                                    const r = await runScenario(sc);
                                    setScenarioResults(prev => ({ ...prev, [sc.id]: r }));
                                  } catch (e) {
                                    console.error('Scenario run error', e);
                                  } finally {
                                    setRunningScenarioId(null);
                                  }
                                }}
                                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${isRunning ? 'opacity-50 cursor-wait' : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100')}`}
                              >{isRunning ? '…' : '▶ Run'}</button>
                              <button
                                onClick={() => { deleteScenario(sc.id); setScenarios(listScenarios()); setScenarioResults(prev => { const n = { ...prev }; delete n[sc.id]; return n; }); }}
                                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}
                              >✕</button>
                            </div>
                            {result && !result.pass && result.stepResults.find(s => !s.pass) && (
                              <p className={`text-[10px] mt-1 ${dark ? 'text-red-400' : 'text-red-600'}`}>
                                {result.stepResults.find(s => !s.pass)?.errorMessage}
                              </p>
                            )}
                          </div>
                        );
                      })
                    }
                  </div>
                  <div className="flex gap-1">
                    <input
                      value={newScenarioName}
                      onChange={e => setNewScenarioName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newScenarioName.trim()) {
                          const sc: BrowserScenario = { id: generateScenarioId(), name: newScenarioName.trim(), steps: [], createdAt: Date.now() };
                          saveScenario(sc);
                          setScenarios(listScenarios());
                          setNewScenarioName('');
                        }
                      }}
                      placeholder="New scenario name…"
                      className={`flex-1 text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800 placeholder-zinc-400'}`}
                    />
                    <button
                      onClick={() => {
                        if (!newScenarioName.trim()) return;
                        const sc: BrowserScenario = { id: generateScenarioId(), name: newScenarioName.trim(), steps: [], createdAt: Date.now() };
                        saveScenario(sc);
                        setScenarios(listScenarios());
                        setNewScenarioName('');
                      }}
                      className="shrink-0 text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >Create</button>
                  </div>
                </div>

                {/* Compaction (#95) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Context Compaction</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Automatically summarise old messages when the conversation approaches the context limit. Keeps recent turns intact.</p>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Auto-compact</span>
                    <Toggle checked={autoCompact} onChange={() => { const v = !autoCompact; setAutoCompact(v); safeSetItem('ollama_gui_auto_compact', JSON.stringify(v)); }} dark={dark} label="Toggle auto-compact" />
                    <Toggle checked={resumeLastSession} onChange={() => { const v = !resumeLastSession; setResumeLastSession(v); safeSetItem('ollama_gui_resume_last_session', JSON.stringify(v)); }} dark={dark} label="Resume last conversation on startup" />
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Send on Ctrl+Enter (Enter = newline)</span>
                    <Toggle checked={sendOnCtrlEnter} onChange={() => { const v = !sendOnCtrlEnter; setSendOnCtrlEnter(v); safeSetItem('ollama_gui_send_on_ctrl_enter', JSON.stringify(v)); }} dark={dark} label="Toggle send on Ctrl+Enter" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className={`text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Threshold (tokens)</label>
                    <input
                      type="number"
                      min={500}
                      max={32000}
                      value={compactionThreshold}
                      onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) { setCompactionThreshold(v); safeSetItem('ollama_gui_compact_threshold', String(v)); } }}
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

        {/* Command palette (#251) */}
        {paletteOpen && (
          <CommandPalette
            commands={paletteCommands}
            onClose={() => setPaletteOpen(false)}
            dark={dark}
          />
        )}

        {/* Composed system-prompt preview (#376) */}
        {promptPreview && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
              <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                <h2 className="text-lg font-bold">Composed System Prompt</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(promptPreview); showStatusBanner('Copied to clipboard'); }}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium ${dark ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'}`}
                  >Copy</button>
                  <button onClick={() => setPromptPreview(null)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
                </div>
              </div>
              <div className={`overflow-auto flex-1 p-6 text-sm font-mono whitespace-pre-wrap ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                {promptPreview || '(empty — no system prompt set)'}
              </div>
              <div className="px-6 py-3 border-t shrink-0 flex justify-end">
                <button onClick={() => setPromptPreview(null)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-colors">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Help Overlay (keyboard shortcuts) */}
        {showHelp && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Keyboard Shortcuts</h2>
                <button onClick={() => setShowHelp(false)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
              </div>
              <div className="space-y-1">
                {[
                  ['New Chat', 'Ctrl+K'],
                  ['Command Palette', 'Ctrl+P'],
                  ['Find in Chat', 'Ctrl+F'],
                  ['Toggle Sidebar', 'Ctrl+\\'],
                  ['Toggle Browser', 'Ctrl+B'],
                  ['Toggle Files', 'Ctrl+Shift+F'],
                  ['Toggle Terminal', 'Ctrl+T'],
                  ['Toggle Artifacts', 'Ctrl+Shift+A'],
                  ['Open Settings', 'Ctrl+,'],
                  ['Regenerate Last Reply', 'Ctrl+R'],
                  ['Focus Composer', 'Ctrl+L'],
                  ['Copy Last Reply', 'Ctrl+Shift+C'],
                  ['Toggle Theme', 'Ctrl+Shift+D'],
                  ['Zen/Focus Mode', 'Ctrl+Shift+Z'],
                  ['Pin/Unpin Conversation', 'Ctrl+Shift+P'],
                  ['Scroll to Latest', 'Ctrl+End'],
                  ['Next Conversation', 'Ctrl+]'],
                  ['Previous Conversation', 'Ctrl+['],
                  ['Tab Indent / Outdent', 'Tab / Shift+Tab'],
                  ['Send Message', 'Enter'],
                  ['New Line in Composer', 'Shift+Enter'],
                  ['Stop Generation / Close', 'Escape'],
                  ['Zoom In', 'Ctrl+='],
                  ['Zoom Out', 'Ctrl+-'],
                  ['Reset Zoom', 'Ctrl+0'],
                  ['Show Help', '?'],
                ].map(([label, key]) => (
                  <div key={key} className={`flex justify-between items-center py-3 border-b last:border-b-0 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                    <span className={dark ? 'text-zinc-300' : 'text-zinc-700'}>{label}</span>
                    <kbd className={`px-2 py-1 rounded text-sm font-mono ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-200 text-zinc-800'}`}>{key}</kbd>
                  </div>
                ))}
              </div>

              {/* Slash command reference (#335) */}
              <h3 className={`text-sm font-bold mt-6 mb-3 ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>Slash Commands</h3>
              <div className="max-h-60 overflow-y-auto space-y-1" aria-label="Slash commands">
                {getAllCommands().filter(c => c.builtin).map(c => (
                  <div key={c.name} className={`flex justify-between items-start gap-2 py-1.5 border-b last:border-b-0 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                    <code className={`text-xs font-mono shrink-0 ${dark ? 'text-blue-300' : 'text-blue-600'}`}>/{c.name}</code>
                    <span className={`text-[11px] text-right ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{c.description}</span>
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
        {/* Full-size image lightbox (#351) */}
        {lightboxImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={() => setLightboxImage(null)}
            onKeyDown={(e) => { if (e.key === 'Escape') setLightboxImage(null); }}
            tabIndex={-1}
          >
            <img src={lightboxImage} alt="attachment full size" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
            <button
              onClick={() => setLightboxImage(null)}
              aria-label="Close image preview"
              className="absolute top-4 right-4 text-white text-2xl bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center"
            >✕</button>
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
        {/* Delete session confirmation dialog */}
        {confirmDelete.open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="Delete chat confirmation"
            onClick={closeConfirmDelete}
          >
            <div
              className={`border rounded-2xl p-6 shadow-2xl w-full max-w-sm mx-4 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold mb-2">Delete chat?</h2>
              <p className={`text-sm mb-6 ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                This will permanently delete <span className="font-medium">"{confirmDelete.title}"</span>. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeConfirmDelete}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-100'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteSession}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Bulk delete confirmation dialog (#338) */}
        {confirmBulkDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="Bulk delete confirmation"
            onClick={() => setConfirmBulkDelete(false)}
          >
            <div
              className={`border rounded-2xl p-6 shadow-2xl w-full max-w-sm mx-4 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold mb-2">Delete {bulkSelectedIds.size} conversations?</h2>
              <p className={`text-sm mb-6 ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                This will permanently delete {bulkSelectedIds.size} conversation{bulkSelectedIds.size === 1 ? '' : 's'}. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-100'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmBulkDeleteSession}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        {/* LibreOffice optional-engine onboarding (#145) */}
        <LibreOfficeOnboarding
          open={showLoOnboarding}
          dark={dark}
          onDetect={async () => {
            const lo = await checkLibreOffice().catch(() => ({ available: false }));
            if (lo.available) { setShowLoOnboarding(false); notify('LibreOffice detected.'); }
            else notify('LibreOffice not found. Install it, then retry.');
          }}
          onOpenDownload={() => { void openSource({ id: 'lo', label: 'LibreOffice', kind: 'url', url: 'https://www.libreoffice.org/download/download/' }); }}
          onDismiss={() => { markDismissed(); setShowLoOnboarding(false); }}
        />
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

        {/* Tool approval modal (#88/#89/#189) — shown in plan/ask autonomy mode */}
        {pendingToolApproval && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span>🤖</span> Agent wants to use a tool
                </h2>
              </div>
              <p className={`text-sm mb-3 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                The agent requests permission to call:
              </p>
              <div className={`rounded-lg px-4 py-3 font-mono text-sm mb-2 border ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-200 text-zinc-900'}`}>
                <span className={`font-bold ${dark ? 'text-blue-400' : 'text-blue-600'}`}>{pendingToolApproval.toolName}</span>
              </div>
              {Object.keys(pendingToolApproval.args).length > 0 && (
                <pre className={`rounded-lg px-3 py-2 text-xs font-mono mb-4 overflow-auto max-h-40 border ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'}`}>
                  {JSON.stringify(pendingToolApproval.args, null, 2)}
                </pre>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { pendingToolApproval.resolve(false); setPendingToolApproval(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'}`}
                >Deny</button>
                <button
                  onClick={() => { pendingToolApproval.resolve(true); setPendingToolApproval(null); }}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold"
                >Allow</button>
                <button
                  onClick={() => {
                    sessionToolAllowlistRef.current.add(pendingToolApproval.toolName);
                    pendingToolApproval.resolve(true);
                    setPendingToolApproval(null);
                  }}
                  title={`Allow ${pendingToolApproval.toolName} without asking again for the rest of this session`}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border ${dark ? 'border-zinc-600 text-blue-300 hover:bg-zinc-700' : 'border-zinc-300 text-blue-600 hover:bg-zinc-100'}`}
                >Allow for session</button>
              </div>
            </div>
          </div>
        )}

        {/* Plan-mode approval modal (#408) — in plan autonomy, mutating tools
            are blocked until the user approves the published plan. Approve
            unblocks the whole plan run; Deny blocks the tool and keeps the
            plan un-approved. */}
        {pendingPlanApproval && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span>📋</span> Approve plan to begin execution?
                </h2>
              </div>
              <p className={`text-sm mb-3 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                The agent has published a plan and wants to start executing it. The next step is:
              </p>
              <div className={`rounded-lg px-4 py-3 font-mono text-sm mb-4 border ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-200 text-zinc-900'}`}>
                <span className={`font-bold ${dark ? 'text-blue-400' : 'text-blue-600'}`}>{pendingPlanApproval.toolName}</span>
              </div>
              {plan.length > 0 && (
                planEditDraft ? (
                  <ol className={`mb-4 max-h-60 overflow-y-auto space-y-1 text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    {planEditDraft.map((stepText, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="shrink-0 opacity-60">{idx + 1}.</span>
                        <textarea
                          aria-label={`Edit plan step ${idx + 1}`}
                          value={stepText}
                          onChange={(e) => setPlanEditDraft(draft => draft ? draft.map((t, j) => (j === idx ? e.target.value : t)) : draft)}
                          className={`flex-1 min-h-[2rem] rounded px-2 py-1 text-xs font-mono border ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ol className={`mb-4 max-h-40 overflow-y-auto space-y-1 text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    {plan.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="shrink-0 opacity-60">{idx + 1}.</span>
                        <span>{item.step}</span>
                      </li>
                    ))}
                  </ol>
                )
              )}
              <div className="flex gap-2 justify-end">
                {plan.length > 0 && !planEditDraft && (
                  <button
                    onClick={() => setPlanEditDraft(plan.map(item => item.step))}
                    className={`mr-auto px-3 py-2 rounded-lg text-sm font-medium border ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
                  >Edit plan</button>
                )}
                <button
                  onClick={() => { pendingPlanApproval.resolve(false); setPendingPlanApproval(null); setPlanEditDraft(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'}`}
                >Deny</button>
                <button
                  onClick={() => {
                    // Persist edited steps before unblocking execution (#409).
                    if (planEditDraft) {
                      setPlan(plan.map((item, idx) => ({
                        step: planEditDraft[idx] ?? item.step,
                        status: item.status,
                      })));
                    }
                    planApprovedRef.current = true;
                    pendingPlanApproval.resolve(true);
                    setPendingPlanApproval(null);
                    setPlanEditDraft(null);
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold"
                >Approve plan</button>
              </div>
            </div>
          </div>
        )}

        {/* Diff review modal (#84/#185/#254) — per-hunk accept/reject for apply_edit */}
        {pendingDiffEdit && (
          <DiffReviewModal
            edit={pendingDiffEdit}
            dark={dark}
            onResolve={(decision) => {
              diffReviewResolveRef.current?.(decision);
            diffReviewResolveRef.current = null;
            setPendingDiffEdit(null);
          }}
        />
      )}

       {/* Batch (multi-file) diff review modal (#400) — one review for apply_patch with several ops */}
       {pendingDiffEdits && pendingDiffEdits.length > 0 && (
         <DiffReviewBatchModal
           edits={pendingDiffEdits}
           dark={dark}
           onResolve={(decisions) => {
             batchDiffResolveRef.current?.(decisions);
             batchDiffResolveRef.current = null;
             setPendingDiffEdits(null);
           }}
         />
       )}

      {/* Right-click context menu on chat messages (#378) */}
        {contextMenu && (() => {
          const mi = contextMenu.index;
          const msg = messages[mi];
          if (!msg) { setContextMenu(null); return null; }
          const items: ContextMenuItem[] = [];
          items.push({ label: 'Copy message', onSelect: () => { navigator.clipboard.writeText(msg.content); setCopiedMsgIdx(mi); setTimeout(() => setCopiedMsgIdx(prev => (prev === mi ? null : prev)), 1500); } });
          if (msg.role === 'assistant') {
            items.push({ label: 'Copy as Markdown', onSelect: () => { navigator.clipboard.writeText(messageToMarkdown(msg)); setCopiedMdMsgIdx(mi); setTimeout(() => setCopiedMdMsgIdx(prev => (prev === mi ? null : prev)), 1500); } });
            items.push({ label: 'Copy as plain text', onSelect: () => { navigator.clipboard.writeText(messageToPlainText(msg)); setCopiedPtMsgIdx(mi); setTimeout(() => setCopiedPtMsgIdx(prev => (prev === mi ? null : prev)), 1500); } });
            items.push({ label: rawView[mi] ? 'Show rendered' : 'Show raw', onSelect: () => setRawView(prev => ({ ...prev, [mi]: !prev[mi] })) });
            items.push({ label: 'Regenerate', disabled: isLoading, onSelect: () => regenerateMessage(mi) });
          }
          if (msg.role !== 'tool') {
            items.push({ label: msg.role === 'assistant' ? 'Edit response' : 'Edit message', disabled: isLoading, onSelect: () => { setEditingIndex(mi); setEditContent(msg.content); } });
          }
          items.push({ label: 'Delete', onSelect: () => deleteMessage(mi) });
          if (msg.role !== 'tool') {
            items.push({ label: 'Quote into composer', onSelect: () => quoteMessage(mi) });
          }
          if (msg.role === 'assistant' && isTtsAvailable()) {
            items.push({ label: speakingMsgId === `msg-${mi}` ? 'Stop speaking' : 'Speak message', onSelect: () => {
              if (speakingMsgId === `msg-${mi}`) { stopSpeaking(); setSpeakingMsgId(null); }
              else { setSpeakingMsgId(`msg-${mi}`); speak(msg.content, voiceSettings).then(() => setSpeakingMsgId(null)).catch(() => setSpeakingMsgId(null)); }
            } });
          }
          return <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={() => setContextMenu(null)} dark={dark} />;
        })()}

        {/* Right-click context menu on sidebar session items (#381) */}
        {sessionContextMenu && (() => {
          const sess = sessions.find(x => x.id === sessionContextMenu.sessionId);
          if (!sess) { setSessionContextMenu(null); return null; }
          const items: ContextMenuItem[] = [
            { label: 'Rename', onSelect: () => startRename(sess.id, sess.title) },
            { label: sess.pinned ? 'Unpin' : 'Pin', onSelect: () => togglePin(sess.id) },
            { label: 'Add tag', onSelect: () => addTagToSession(sess.id) },
            { label: sess.archived ? 'Unarchive' : 'Archive', onSelect: () => toggleArchive(sess.id) },
            { label: 'Duplicate', onSelect: () => duplicateSession(sess.id) },
            { label: 'Delete', onSelect: () => deleteSession(sess.id, sess.title) },
          ];
          return <ContextMenu x={sessionContextMenu.x} y={sessionContextMenu.y} items={items} onClose={() => setSessionContextMenu(null)} dark={dark} />;
        })()}

        </PanelShell>
    </div>



    </div>
    </CodeWordWrapContext.Provider>
  );
}

const AppWithErrorBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
import { loadOllamaModel, unloadOllamaModel, fetchRunningModels, fetchOllamaVersion } from './services/ollama';
