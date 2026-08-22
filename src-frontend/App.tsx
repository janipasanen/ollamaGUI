import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Message, fetchOllamaChatStream, fetchOllamaModels, pullOllamaModel, deleteOllamaModel, fetchCloudModels, SUGGESTED_MODELS, GenerationOptions, ModelInfo, assembleModelfile, createOllamaModel, computeGenStats, type GenStats, loadOllamaModel, unloadOllamaModel, fetchRunningModels, fetchOllamaVersion, loadCustomCloudModels, saveCustomCloudModels, SUGGESTED_CLOUD_MODELS, getModelCapabilities, autoNumCtx, type ModelCapabilities } from './services/ollama';
import { classifyFit, fitLabel, fitColor, formatBytes, SystemMemory } from './services/modelFit';
import { ChatSession, Folder, Project, storage, searchSessions, sortSessions, SortMode, parseSessionImport } from './services/storage';
import { loadFromDisk, hasTauri } from './services/rustStore';
import { composeSystemPrompt } from './services/systemPrompt';
import {
  MemoryEntry,
  loadMemory, addMemoryEntry, removeMemoryEntry, composeMemoryBlock, getRelevantEntries,
} from './services/memory';
import {
  shouldCompact, compactConversation, makeSummarizeFn,
} from './services/compaction';
import { toolRegistry, registerBuiltInTools, registerCliTool, cliAllowlist, persistCliAllowlist, toolCallName, runCliOnce, commandBinary, CORE_AGENT_TOOLS } from './services/tools';
import { agenticChatStream, type AgenticChatOptions } from './services/agent';
import { openaiAgenticChatStream } from './services/openaiAgent';
import { McpServerConfig, mcpConfigStore, refreshAuthFlags } from './services/mcpConfig';
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
  STARTER_EXAMPLES, toolNameFor,
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
import { closeAllPanels } from './components/PanelShell';
import { registerDocumentTools, readDocument, detectDocumentFormat } from './services/documentTools';
import ArtifactPanel, { showArtifact, type AnyArtifact, type DocumentArtifactData } from './components/ArtifactPanel';
import { useModalFocus } from './components/useModalFocus';
import { pushActivity } from './services/agentActivity';
import LibreOfficeOnboarding from './components/LibreOfficeOnboarding';
import WelcomeScreen from './components/WelcomeScreen';
import { formatWorkspaceContext, detectRepoClis, detectGitInfo, type WorkspaceContext } from './services/workspaceContext';
import { checkLibreOffice } from './services/documents';
import { needsOnboarding, markDismissed } from './services/libreOfficeOnboarding';
import { openSource } from './services/citations';
import { MlxAvailability, checkMlxAvailable, isMlxModelName } from './services/mlx';
import { pickDirectory, pickDirectories, appendPathArg, getSystemMemory, safeSetItem, checkPath } from './services/platform';
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
  VoiceSettings,
  loadVoiceSettings, saveVoiceSettings,
  recognize, speak, stopSpeaking, isSpeechRecognitionAvailable, isTtsAvailable,
} from './services/voice';
import {
  SlashCommand,
  filterCommands, findCommand, runCommand, getAllCommands,
  loadUserCommands, addUserCommand, updateUserCommand, removeUserCommand,
} from './services/commands';
// Prompt Library UI is gone (#549 rank 15) — the service is only read once at
// boot to migrate any saved prompts into user slash commands.
import { loadPrompts, savePrompts } from './services/promptLibrary';
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
import { registerDevTools, makePostEditVerifyHook, isAutoVerifyEnabled } from './services/devTools';
import { registerCodeNavTools } from './services/codeNav';
import { openWorkspace, getActiveRoot, projectRoots, openWorkspaceRoots, closeWorkspace } from './services/workspace';

import { registerGitTools, gitDiff, gitStatus, gitStage, gitUnstage, gitCommit } from './services/git';
import {
  AgentAutonomySettings, AutonomyLevel,
  loadSettings as loadAutonomySettings, saveSettings as saveAutonomySettings,
  isPlanMode, getAutonomyLevel,
} from './services/agentAutonomy';
import { registerHook, makeReadOnlyHook, registerPostToolUseHook, makeSecretsRedactHook } from './services/toolHooks';
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
import { autoCommitEdit, loadAutoCommitEdits, undoLastAutoCommit } from './services/autoCommit';
import { DiffReviewBatchModal } from './components/DiffReviewBatchModal';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { registerPlanTool, getPlan, setPlan, clearPlan, subscribe as subscribePlan, type PlanItem } from './services/planStore';
import PlanPanel from './components/PlanPanel';
import { ChatSearch, findMessageMatches } from './components/ChatSearch';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { formatMessageTime, formatDayLabel, isSameDay, conversationDateBucket } from './services/formatTime';
import { chatToMarkdown, messageToMarkdown, chatToPlainText, messageToPlainText, chatToHtml } from './services/chatToMarkdown';
import { computeConversationStats } from './services/conversationStats';
import ProjectHeader from './components/ProjectHeader';
import { basename, folderLabel, deriveProjectName, isAutoFolderName } from './services/projectNaming';
import { shouldIgnoreEnterShortcut } from './components/keyboardScope';

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
// remark/rehype plugin arrays are hoisted so their identity is stable across renders.
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex];
export const MarkdownMessage: React.FC<{ content: string; dark: boolean; onToggleTask?: (itemText: string, checked: boolean) => void; highlightQuery?: string; onApplyCode?: (code: string, lang: string) => void }> = ({ content, dark, onToggleTask, highlightQuery, onApplyCode }) => {
  // Memoize the renderer map so react-markdown sees stable component types
  // across re-renders. Fresh inline functions each render made React treat
  // every renderer as a new element type, remounting each CodeBlock and
  // wiping its local state (copied/expanded/applied) whenever App re-rendered.
  // Keyed on exactly the props the renderers close over — never on content.
  const components = React.useMemo(() => ({
    p({ children, ...rest }: any) { return <p {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</p>; },
    td({ children, ...rest }: any) { return <td {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</td>; },
    strong({ children, ...rest }: any) { return <strong {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</strong>; },
    em({ children, ...rest }: any) { return <em {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</em>; },
    h1({ children, ...rest }: any) { return <h1 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h1>; },
    h2({ children, ...rest }: any) { return <h2 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h2>; },
    h3({ children, ...rest }: any) { return <h3 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h3>; },
    h4({ children, ...rest }: any) { return <h4 {...rest}>{highlightQuery ? highlightChildren(children, highlightQuery) : children}</h4>; },
    code({ node, className, children, ...props }: any) {
      // react-markdown v9+ no longer passes an `inline` prop. Block code is
      // code with a language-* class (fenced with a lang) or whose content
      // spans/ends with a newline (fenced without a lang); everything else
      // is inline code inside a sentence.
      const raw = String(children);
      const isBlock = /language-/.test(className || '') || raw.includes('\n');
      if (isBlock) {
        const lang = (className || '').replace('language-', '') || 'text';
        const code = raw.replace(/\n$/, '');
        if (lang === 'mermaid') return <Mermaid code={code} dark={dark} />;
        return <CodeBlock lang={lang} code={code} dark={dark} props={props} onApplyCode={onApplyCode} />;
      }
      return (
        <code className={`px-1 rounded font-mono ${dark ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-300 text-zinc-800'}`} {...props}>
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
  }), [dark, onToggleTask, highlightQuery, onApplyCode]);
  return (
    <div className={`prose max-w-none ${dark ? 'prose-invert' : 'prose-zinc'}`}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

// Collapsible tool-result block with a status header (#240).
// Mirrors agentic GUIs (Codex/Claude) that collapse tool output behind a
// summary showing the tool name + running/success/error state.
const TOOL_ERROR_RE = /^(error|tool blocked)/i;

/**
 * The one argument a human cares about in a tool call (#549 rank 14):
 * the path, command, or query — not the raw JSON envelope.
 */
function humanizeToolArgs(toolCall: any): string {
  let args: any = toolCall?.function?.arguments ?? toolCall?.arguments ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return args.slice(0, 80); } }
  const top = args.path ?? args.file_path ?? args.command ?? args.query ?? args.pattern ?? args.url ?? args.task ?? '';
  const text = typeof top === 'string' ? top : JSON.stringify(top ?? '');
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
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
  // Auto-verify (run project checks) after agentic edits (#425).
  // Agentic "Continue past max-iterations" affordance (Codex/Claude parity, #403).
  const [agentHitMax, setAgentHitMax] = useState(false);

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // Mirror of currentSessionId that is correct *within* a render pass (#508).
  // saveCurrentSession runs many times per streamed reply; the state value lags
  // by a render, so it must read the ref instead.
  const currentSessionIdRef = useRef<string | null>(null);
  /** True once something has deliberately chosen the model (#533). */
  const modelClaimedRef = useRef(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // Inline session rename (#52)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  // Inline project rename (#549 audit rank 10): auto-derived names need an
  // escape hatch — a bad name was previously permanent.
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState('');
  // Right-click context menu on sidebar project rows.
  const [projectContextMenu, setProjectContextMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
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
  // Persisted (#549 audit rank 7): losing the active project on relaunch
  // silently stripped folder context from every returning user's first prompt.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem('ollama_gui_active_project');
      return saved && storage.getProjects().some(p => p.id === saved) ? saved : null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeProjectId) localStorage.setItem('ollama_gui_active_project', activeProjectId);
      else localStorage.removeItem('ollama_gui_active_project');
    } catch { /* ignore */ }
  }, [activeProjectId]);
  /** True while the native folder picker is open for a new project (#542). */
  const [creatingProject, setCreatingProject] = useState(false);
  // Project-first sidebar (#542): which projects are expanded, and whether the
  // "+ New" project picker menu is open.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [newMenuOpen, setNewMenuOpen] = useState(false);

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

  // Settings / UI state
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  // Generation options — num_ctx unset means AUTO: sized from the model's
  // native context window and this machine's RAM at send time (#549 audit
  // rank 3). A fixed 4096 silently truncated agentic runs mid-goal.
  const [genOptions, setGenOptions] = useState<GenerationOptions>({});
  // Capabilities of the selected model (/api/show, cached) + the auto ctx
  // derived from them; used wherever an explicit num_ctx is not set.
  const [modelCaps, setModelCaps] = useState<ModelCapabilities | null>(null);
  // Structured output (Ollama `format`): JSON mode or a JSON Schema (#148).
  const [structuredOutput, setStructuredOutput] = useState<{ enabled: boolean; schema: string }>({ enabled: false, schema: '' });
  const [schemaError, setSchemaError] = useState<string | null>(null);
  /** Server id whose OAuth flow is currently running, if any (#503). */
  const [authInFlight, setAuthInFlight] = useState<string | null>(null);
  /** Validation message for the custom-tool form (#516, #517). */
  const [customToolError, setCustomToolError] = useState<string | null>(null);
  // Initialise from storage during the first render (#509). Previously the
  // mount effect called setOllamaBaseUrl(saved) and then refreshModels() in the
  // same pass — but that refreshModels closure was built on the first render,
  // where the URL was still the localhost default, so a saved remote host was
  // queried at localhost and the app started "disconnected" with no models.
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => {
    try { return localStorage.getItem('ollama_gui_base_url') || DEFAULT_BASE_URL; }
    catch { return DEFAULT_BASE_URL; }
  });
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME);
  // Temporary/incognito chat: held in memory only, never persisted (#134).
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [contextWarningDismissed, setContextWarningDismissed] = useState(false);
  const [recentModels, setRecentModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ollama_gui_recent_models') ?? '[]'); } catch { return []; }
  });
 // Starred/favourite models (#339) — pinned to the top of the selector. The
 // last starring UI went with the header rewrite, so this is read-only state
 // seeded from localStorage (#549 rank 15 removed the dead toggleStarModel).
 const [starredModels] = useState<string[]>(() => {
   try { return JSON.parse(localStorage.getItem('ollama_gui_starred_models') ?? '[]'); } catch { return []; }
 });
  // Models currently loaded in Ollama memory (#478) — refreshed periodically
  // so the selector shows a ● badge next to warm models (LM Studio / Codex parity).
  const [runningModels, setRunningModels] = useState<Set<string>>(new Set());
  const [playSoundOnComplete, setPlaySoundOnComplete] = useState<boolean>(() => {
    try { return localStorage.getItem('ollama_gui_sound_complete') === 'true'; } catch { return false; }
  });
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(() => {
    try { return localStorage.getItem('ollama_gui_notify_complete') === 'true'; } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(false);
  // Agentic mode is DERIVED, not a setting (#549 audit rank 1): tools are on
  // exactly when the active project has a bound folder — the agent has
  // somewhere real to work. No project → plain chat. The old toggle shipped
  // OFF and buried in Settings, so first goal prompts landed in a chatbot.
  const isAgenticMode = React.useMemo(() => {
    const p = projects.find(x => x.id === activeProjectId);
    return !!p && projectRoots(p).length > 0;
  }, [projects, activeProjectId]);
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

  // Model presets (#124)
  const [presets, setPresets] = useState<ModelPreset[]>(() => loadPresets());
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadActivePresetId());
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPreset, setNewPreset] = useState({ name: '', icon: '', systemPrompt: '', temperature: '', numCtx: '' });
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null); // #419 edit affordance

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
  const [editingConnId, setEditingConnId] = useState<string | null>(null); // #419 edit affordance
  const [connTestStatus, setConnTestStatus] = useState<Record<string, 'testing' | 'ok' | 'error'>>({});


  // Image generation (#130)
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenConfig>(() => loadImageGenConfig());

  // Speech-to-text (#131)
  const [sttConfig, setSttConfig] = useState<SttConfig>(() => loadSttConfig());

  // Web search config (#121/#192)
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(() => loadWebSearchConfig());
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [whisperAvailable, setWhisperAvailable] = useState<boolean | null>(null);

  // Conversation branching (#98)
  const [branchState, setBranchState] = useState<BranchState>(emptyBranchState());
  // Trunk messages always hold the full canonical history; branchState tracks alternatives
  const trunkMessagesRef = useRef<Message[]>([]);
  // /redo stack: stores exchanges dropped by /undo so they can be restored (#389).
  const redoStackRef = useRef<{ messages: Message[]; branch: BranchState }[]>([]);
  // Recursion-depth guard for spawn_subagent (#429). Sub-agents run sequentially
  // within the tool loop, so a single counter correctly tracks nesting depth.
  const subagentDepthRef = useRef(0);
  /**
   * Where an agent run should send its requests, kept in a ref because the
   * tool registry is built once in a `[]` effect (#551): a closure over the
   * `model` state there captures the boot-time value forever, so sub-agents
   * used to run whatever model was selected at startup — against the local
   * Ollama daemon — no matter what the user picked afterwards. That also made
   * them fail outright for LM Studio models, whose names that daemon has
   * never heard of.
   */
  const agentRoutingRef = useRef<{
    model: string;
    endpoint: string;
    conn?: ModelConnection;
    // Seeded with an absolute local endpoint so the value is usable even in
    // the window before the syncing effect below first runs.
  }>({ model, endpoint: `${ollamaBaseUrl}/api/chat` });
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
  // Workspace grounding for the system prompt (#489/#491): where the model is,
  // which repo that maps to, and which repo CLIs it may actually invoke.
  const [workspaceCtx, setWorkspaceCtx] = useState<WorkspaceContext | null>(null);
  const [repoClis, setRepoClis] = useState<string[]>([]);

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
  const [editingCmdName, setEditingCmdName] = useState<string | null>(null); // #419 edit affordance

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
  // Mobile header action menu (#445): the collapsed '⋯' used to only toggle the
  // sidebar, stranding every panel/tool action at small widths.
  const [mobileMenu, setMobileMenu] = useState<{ x: number; y: number } | null>(null);
  const [rawView, setRawView] = useState<Record<number, boolean>>({});
  const [collapsedMsg, setCollapsedMsg] = useState<Record<number, boolean>>({});
  const [copiedChat, setCopiedChat] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // MLX acceleration (Apple Silicon): detection only — no settings. Active
  // whenever the selected local model is an MLX model on a capable machine.
  const [mlxAvailability, setMlxAvailability] = useState<MlxAvailability | null>(null);

  // Per-session working directory (#550): overrides the project's primary
  // folder for THIS session. Ref mirrors state for the stream-time save path.
  const [sessionWorkingDir, setSessionWorkingDir] = useState<string | null>(null);
  const sessionWorkingDirRef = useRef<string | null>(null);
  useEffect(() => { sessionWorkingDirRef.current = sessionWorkingDir; }, [sessionWorkingDir]);
  // Set when the configured working folder is unreachable (moved, renamed,
  // unmounted volume): a persistent banner with a picker — never a crash.
  const [workspaceWarning, setWorkspaceWarning] = useState<string | null>(null);

  // Streaming cancel support
  const abortControllerRef = useRef<AbortController | null>(null);

  // Per-run stats for the end-of-run summary card (#549 audit rank 9): the
  // data already flows through the callbacks — it was just being discarded.
  const runStatsRef = useRef<{
    startedAt: number;
    toolCalls: number;
    filesEdited: Set<string>;
    commits: string[];
    checks: 'passed' | 'failed' | null;
  }>({ startedAt: 0, toolCalls: 0, filesEdited: new Set(), commits: [], checks: null });
  // True when the current run stopped at the iteration cap — it is PAUSED,
  // not done: no ✅ card (it would displace the "Continue agent" button as
  // the last message and misreport an unfinished run as finished).
  const runHitMaxRef = useRef(false);

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

  // Shared tool-approval gate (#476): the same ask/plan-mode confirmation flow
  // used by the top-level agentic run must also apply to sub-agents spawned
  // via spawn_subagent/spawn_parallel_subagents -- otherwise a sub-agent can
  // run mutating tools with no confirmation at all.
  // Approval requests are SERIALIZED (#549 audit rank 8): concurrent
  // sub-agents each requesting approval used to overwrite the single
  // pending-modal state, orphaning the earlier resolver — a permanent hang
  // only an app restart could clear. One gate at a time; a cancelled run
  // resolves queued gates as denied via the abort check.
  const approvalChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const requestToolApproval = (toolName: string, args: Record<string, unknown>) =>
    new Promise<boolean>(resolve => {
      if (abortControllerRef.current?.signal.aborted) {
        resolve(false);
        return;
      }
      if (sessionToolAllowlistRef.current.has(toolName)) {
        resolve(true);
        return;
      }
      // Edit tools are gated by the diff-review modal, which shows the actual
      // change — a second generic "allow write_file?" modal on top of it was
      // pure friction (#549 audit rank 2).
      if (toolName === 'write_file' || toolName === 'apply_edit' || toolName === 'apply_patch') {
        resolve(true);
        return;
      }
      if (isPlanMode()) {
        if (planApprovedRef.current) { resolve(true); return; }
        // No published plan to approve yet — fall back to the per-tool modal
        // that shows the arguments, instead of a plan dialog with no plan.
        if (getPlan().length === 0) {
          setAgentStatus(`Waiting for approval: ${toolName}`);
          setPendingToolApproval({ toolName, args, resolve });
          return;
        }
        setAgentStatus('Waiting for plan approval');
        setPendingPlanApproval({ toolName, resolve });
        return;
      }
      setAgentStatus(`Waiting for approval: ${toolName}`);
      setPendingToolApproval({ toolName, args, resolve });
    });

  const createApprovalGate = () => (toolName: string, args: Record<string, unknown>) => {
    const result = approvalChainRef.current.then(() => requestToolApproval(toolName, args));
    // Keep the chain alive regardless of outcome so one denial can't wedge it.
    approvalChainRef.current = result.catch(() => undefined);
    return result;
  };

  // Modal focus management (#447): focus-in, Tab trap, focus-restore for the
  // main overlays. Each ref is attached to its dialog element in the JSX.
  const settingsModalRef = useModalFocus<HTMLDivElement>(isSettingsOpen);
  const helpModalRef = useModalFocus<HTMLDivElement>(showHelp);
  const cliApprovalModalRef = useModalFocus<HTMLDivElement>(!!pendingApproval);
  const toolApprovalModalRef = useModalFocus<HTMLDivElement>(!!pendingToolApproval);
  const planApprovalModalRef = useModalFocus<HTMLDivElement>(!!pendingPlanApproval);
  const promptPreviewModalRef = useModalFocus<HTMLDivElement>(!!promptPreview);

  // Message queue: enqueue prompts while a reply streams; auto-send FIFO (#137).
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const messageQueueRef = useRef<string[]>([]);
  // Next auto-send from the queue, dispatched from a fresh render (#507).
  const [pendingQueuedMessage, setPendingQueuedMessage] = useState<string | null>(null);
  useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => {
    if (pendingQueuedMessage === null || isLoading) return;
    const text = pendingQueuedMessage;
    setPendingQueuedMessage(null);
    void sendMessage(text);
    // sendMessage is intentionally excluded: it is re-created every render, and
    // this effect must run with the binding from the render it fires in (#507).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQueuedMessage, isLoading]);

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
  // Focus-in, Tab trap and focus-restore for the bulk-delete confirmation,
  // which previously had none (#515). Declared here, after the state it reads.
  const bulkDeleteModalRef = useModalFocus<HTMLDivElement>(confirmBulkDelete);
  // Escape dismisses it, matching every other overlay in the app.
  useEffect(() => {
    if (!confirmBulkDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setConfirmBulkDelete(false); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirmBulkDelete]);
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

  // Sessions for the project-first sidebar (#542): search applies, archived
  // hidden, most recent first. Grouped per project at render time.
  const visibleSessions = React.useMemo(() => sortSessions(
    searchSessions(sessions, searchQuery, folders).filter(s => !s.archived),
    'recent',
  ), [sessions, searchQuery, folders]);
  const unscopedSessions = React.useMemo(
    () => visibleSessions.filter(s => !s.projectId),
    [visibleSessions],
  );
  const sessionsForProject = (projectId: string) => visibleSessions.filter(s => s.projectId === projectId);

  // Conversation token estimate, memoized so it only recomputes when the
  // messages or current draft change (#32, #62).
  const conversationTokens = React.useMemo(
    () => estimateConversationTokens(messages) + (input ? estimateTokens(input) : 0),
    [messages, input],
  );

  // Auto-sized context (#549 audit rank 3): probe the model's native window
  // once per model (cached in the service) and derive the ctx actually used
  // when the user hasn't set one explicitly.
  useEffect(() => {
    let cancelled = false;
    if (!model) { setModelCaps(null); return; }
    void getModelCapabilities(model, ollamaBaseUrl).then(caps => {
      if (!cancelled) setModelCaps(caps);
    });
    return () => { cancelled = true; };
  }, [model, ollamaBaseUrl]);
  const effectiveNumCtx = genOptions.num_ctx
    ?? autoNumCtx(modelCaps, systemMemory?.total_bytes ?? null, isAgenticMode);

  // Context limit warning (#319) — show a banner when usage exceeds 80%.
  const contextPct = effectiveNumCtx ? Math.round((conversationTokens / effectiveNumCtx) * 100) : 0;
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

  /**
   * Resolve which server and model name an agent run should use for
   * `modelId` (a bare local model name, or a "<connectionId>/<name>" id from
   * a registered connection). Single source of truth for the main send path
   * and for sub-agents, so they can never drift apart.
   */
  const resolveAgentRouting = (modelId: string) => {
    const connectedModel = connectedModels.find(m => m.id === modelId);
    const conn = connectedModel
      ? connections.find(c => c.id === connectedModel.connectionId)
      : undefined;
    return {
      // Connected models carry a "connId/name" id; servers want the bare name.
      model: connectedModel?.name ?? modelId,
      // Cloud models are proxied by the local daemon (#483), so they share the
      // local endpoint. Only a remote Ollama connection redirects it.
      endpoint: conn?.kind === 'ollama'
        ? `${conn.baseUrl.replace(/\/$/, '')}/api/chat`
        : url('/api/chat'),
      // Present only for OpenAI-compatible servers, which need their own loop.
      conn: conn?.kind === 'openai' ? conn : undefined,
    };
  };

  // Keep the routing ref live for closures that outlive a render — see
  // agentRoutingRef's declaration for why sub-agents cannot read state here.
  useEffect(() => {
    agentRoutingRef.current = resolveAgentRouting(model);
  }, [model, connections, connectedModels, ollamaBaseUrl]);

  // Split local models so MLX-capable ones can be surfaced first (#544). The
  // split only happens when this machine actually supports MLX; otherwise every
  // local model stays in one undifferentiated group exactly as before.
  const mlxUsable = !!mlxAvailability?.available;
  const localModels = models.filter(m => !m.cloud);
  const mlxModels = mlxUsable ? localModels.filter(m => isMlxModelName(m.name)) : [];
  const otherLocalModels = mlxUsable ? localModels.filter(m => !isMlxModelName(m.name)) : localModels;

  // User-specified Ollama Cloud model names (#485). The cloud catalogue changes
  // faster than this app ships and Ollama exposes no "list all cloud models"
  // endpoint, so anything the daemon doesn't already report is named here.
  const [customCloudModels, setCustomCloudModels] = useState<string[]>(() => loadCustomCloudModels());
  const [newCloudModel, setNewCloudModel] = useState('');

  const refreshModels = useCallback(async () => {
    const availableModels = await fetchOllamaModels(url('/api/tags'));
    setOllamaConnected(true);
    // Cloud models: discovered from the signed-in daemon's own tags + any the
    // user added in Settings (#485). Dedupe so a discovered cloud model isn't
    // listed twice when it also appears in the custom list.
    const local = availableModels.map(m => ({ ...m, cloud: isCloudModel(m.name) })); // preserve size/quant
    const cloudModels = (await fetchCloudModels(availableModels))
      .filter(c => !local.some(m => m.name === c.name));
    const combined: ModelInfo[] = [...local, ...cloudModels];
   setModels(combined);
   // Fetch extra connection models in parallel (#123)
   fetchAllConnectionModels(loadConnections()).then(setConnectedModels).catch(() => {});
    // Refresh running models list (#478)
    fetchRunningModels(url('/api/ps'))
      .then(r => setRunningModels(new Set(r.map(m => m.name))))
      .catch(() => {});
   return combined;
 }, [ollamaBaseUrl]);

  /** Add a user-specified cloud model name and refresh the selector (#485). */
  const addCustomCloudModel = useCallback(() => {
    const name = newCloudModel.trim();
    if (!name) return;
    setCustomCloudModels(prev => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      saveCustomCloudModels(next);
      return next;
    });
    setNewCloudModel('');
    void refreshModels().catch(() => {});
  }, [newCloudModel, refreshModels]);

  // Bind an ad-hoc folder back onto the active project (#488). Previously the
  // wiring only ran project -> workspace, so a folder opened from the chip or
  // files panel was forgotten on the next project switch and the two features
  // felt unrelated. Reads storage directly so it never closes over stale state,
  // and no-ops when the folder is already a root of the project (which is the
  // case when this fires as a result of activating that project).
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);
  useEffect(() => {
    const onChange = () => {
      const root = getActiveRoot();
      const pid = activeProjectIdRef.current;
      if (!root || !pid) return;
      const current = storage.getProjects().find(p => p.id === pid);
      if (!current) return;
      const roots = projectRoots(current);
      if (roots.includes(root)) return;
      storage.saveProject({
        ...current,
        workspaceRoot: current.workspaceRoot || root,
        workspaceRoots: [...roots, root],
      });
      setProjects(storage.getProjects());
    };
    window.addEventListener('ollama-gui:workspace-changed', onChange);
    return () => window.removeEventListener('ollama-gui:workspace-changed', onChange);
  }, []);

  // Reconcile MCP auth badges against the token store (#521), so the badge
  // reflects whether a usable token actually exists rather than transient state.
  useEffect(() => {
    let cancelled = false;
    void refreshAuthFlags(mcpConfigStore.list())
      .then(list => {
        if (cancelled) return;
        // Merge ONLY the flag into current state. Replacing the array wholesale
        // would resolve against a pre-await snapshot and silently drop any
        // server the user added while the keychain reads were in flight — the
        // same async-clobber this audit was fixing elsewhere.
        setMcpServers(prev => prev.map(srv => {
          const m = list.find(l => l.id === srv.id);
          return m && m.authenticated !== srv.authenticated
            ? { ...srv, authenticated: m.authenticated }
            : srv;
        }));
      })
      .catch(() => { /* keychain unavailable — keep whatever is persisted */ });
    return () => { cancelled = true; };
  }, []);

  // Probe once for repo CLIs so we only ever advertise what is installed (#491).
  useEffect(() => {
    let cancelled = false;
    detectRepoClis()
      .then(clis => { if (!cancelled) setRepoClis(clis); })
      .catch(() => { /* nothing detected — advertise nothing */ });
    return () => { cancelled = true; };
  }, []);

  // Keep the workspace block in sync with the open folder, the active project,
  // and the detected CLIs (#489). Rebuilt on ollama-gui:workspace-changed so it
  // tracks folders opened from any surface (chip, files panel, project switch).
  useEffect(() => {
    let cancelled = false;

    const rebuild = async () => {
      const root = getActiveRoot();
      if (!root) { if (!cancelled) setWorkspaceCtx(null); return; }
      const project = projects.find(p => p.id === activeProjectId);
      // Show the path immediately; git details fill in when they resolve.
      const base: WorkspaceContext = {
        root,
        projectName: project?.workspaceRoot === root ? project.name : undefined,
        availableClis: repoClis,
      };
      if (!cancelled) setWorkspaceCtx(base);
      const git = await detectGitInfo(root).catch(() => ({}));
      if (!cancelled) setWorkspaceCtx({ ...base, ...git });
    };

    void rebuild();
    const onChange = () => { void rebuild(); };
    window.addEventListener('ollama-gui:workspace-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ollama-gui:workspace-changed', onChange);
    };
  }, [activeProjectId, projects, repoClis]);

  // Poll running models every 30s so the warm indicator stays current (#478).
  // While disconnected the same tick retries the connection instead (#549
  // audit rank 5): the app heals itself the moment the daemon starts, rather
  // than requiring the user to find "Test connection" in Settings.
  useEffect(() => {
    const id = setInterval(() => {
      if (ollamaConnected === false) {
        refreshModels().catch(() => {});
        return;
      }
      fetchRunningModels(url('/api/ps'))
        .then(r => setRunningModels(new Set(r.map(m => m.name))))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [ollamaBaseUrl, ollamaConnected, refreshModels]);

  useEffect(() => {
    async function loadInitialData() {
      // Base URL is restored in the useState initialiser above (#509).

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

      // One-time migration (#549 rank 15): the Prompt Library UI is gone.
      // Any prompts the user saved become user slash commands (same power,
      // one concept), then the old store is cleared so this never re-runs.
      const legacyPrompts = loadPrompts();
      if (legacyPrompts.length > 0) {
        const taken = new Set(getAllCommands().map(c => c.name));
        for (const p of legacyPrompts) {
          if (!p.body || !p.body.trim()) continue;
          const base = p.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'prompt';
          let name = base;
          let n = 2;
          while (taken.has(name)) name = `${base}-${n++}`;
          taken.add(name);
          addUserCommand({ name, description: 'migrated prompt', template: p.body });
        }
        savePrompts([]);
        setUserCommands(loadUserCommands());
      }

      // Boot hydration from the Rust disk mirror: localStorage can be evicted
      // by the WebView or cleared by the user, but every save is also mirrored
      // to <app_data_dir>/store/*.json. When a store is missing here, restore
      // it from disk before the first read. The synchronous hasTauri() gate
      // keeps browser dev / tests on the fully synchronous path (no awaits
      // before the first storage reads).
      try {
        if (hasTauri()) {
          if (!localStorage.getItem('ollama_gui_sessions')) {
            const disk = await loadFromDisk('sessions');
            if (disk) localStorage.setItem('ollama_gui_sessions', disk);
          }
          if (!localStorage.getItem('ollama_gui_folders')) {
            const disk = await loadFromDisk('folders');
            if (disk) localStorage.setItem('ollama_gui_folders', disk);
          }
          if (!localStorage.getItem('ollama_gui_projects')) {
            const disk = await loadFromDisk('projects');
            if (disk) {
              localStorage.setItem('ollama_gui_projects', disk);
              // Projects state initialises from localStorage before this
              // effect runs — refresh it with the recovered list.
              setProjects(storage.getProjects());
            }
          }
        }
      } catch { /* hydration is best-effort */ }

      setSessions(storage.getSessions());
      setFolders(storage.getFolders());
      getSystemMemory().then(setSystemMemory).catch(() => setSystemMemory(null));

      // Load persisted MCP servers
      void refreshMcpServers();

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

      // Detect MLX availability (graceful no-op when unavailable). MLX has no
      // enable/disable settings — it is active whenever the machine supports it
      // and the selected local model is an MLX model (#544). Runs in the
      // background: awaiting it delayed tool registration below, so a message
      // sent right after launch could hit the approval gate before read-only
      // tools were registered and prompt for a read (#549 audit).
      void checkMlxAvailable()
        .then(setMlxAvailability)
        .catch(() => setMlxAvailability(null));

      // Initialize built-in tools and user-defined tools/functions (#127)
      registerBuiltInTools();
      // File & git tools (#83, #103) — must be called once; workspace root is
      // set separately when a project is activated (see activeProjectId effect).
      registerFileTools();
      // Agent quality tools (#423/#424): run_tests + run_checks with parsed output.
      registerDevTools();
      // Code navigation (#426/#427): list_symbols + find_references + go_to_definition.
      registerCodeNavTools();
      // Diff review callback (#84/#185) — intercepts write_file/apply_edit for user approval
      setDiffReviewCallback((edit: PendingEdit) =>
       new Promise<EditDecision>(resolve => {
         // In 'auto' the run must not stall on review — apply immediately; the
         // inline transcript diff + auto-commit keep it visible and revertible.
         if (getAutonomyLevel() === 'auto') {
           resolve({ id: edit.id, accepted: true });
           return;
         }
         setPendingDiffEdit(edit);
         diffReviewResolveRef.current = resolve;
       })
     );
     // Batch (multi-file) diff review callback (#400) — intercepts apply_patch
     // with several ops for a single combined review.
     setBatchReviewCallback((edits: PendingEdit[]) =>
      new Promise<EditDecision[]>(resolve => {
        if (getAutonomyLevel() === 'auto') {
          resolve(edits.map(e => ({ id: e.id, accepted: true })));
          return;
        }
        setPendingDiffEdits(edits);
        batchDiffResolveRef.current = resolve;
      })
    );
     // Auto-commit after an edit is applied to disk (#401). Reads the setting
     // fresh from localStorage so toggling it takes effect immediately.
     setEditAppliedCallback((path, label) => {
       // Feed the run-summary card (#549 rank 9): files touched + commit
       // hashes were previously discarded on the floor here.
       runStatsRef.current.filesEdited.add(path);
       void autoCommitEdit(path, label, loadAutoCommitEdits())
         .then(r => { if (r.committed && r.hash) runStatsRef.current.commits.push(r.hash); })
         .catch(() => {});
     });
     // Wire the read-only mode hook (#146) so the hook chain enforces it.
      registerHook('builtin:read-only', makeReadOnlyHook());
      // Redact known secrets (connection API keys) from tool output before it
      // reaches the model, so tokens never leak into the prompt context (#409).
      registerPostToolUseHook('builtin:redact-secrets', makeSecretsRedactHook(
        () => loadConnections().map(c => c.apiKey ?? '').filter(Boolean),
      ));
      // Post-edit verification (#425): when enabled (Settings), run the project
      // checks after each successful edit and feed diagnostics back to the model.
      registerPostToolUseHook('builtin:auto-verify-edits', makePostEditVerifyHook(isAutoVerifyEnabled));
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
        description: 'Spawn an isolated sub-agent with a fresh context to complete a focused task. Only the final result returns to the parent context. Nesting depth is bounded (max 2) to prevent runaway recursion.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task for the sub-agent to complete.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Optional list of tool names to give the sub-agent. Leave empty for all tools.' },
          },
          required: ['task'],
        },
        execute: async (params: { task: string; tools?: string[] }) => {
          // Enforce a real recursion-depth bound (#429). The previous version only
          // capped maxIterations, so a sub-agent — which received spawn_subagent in
          // its toolset — could nest sub-agents without limit.
          const MAX_SUBAGENT_DEPTH = 2;
          if (subagentDepthRef.current >= MAX_SUBAGENT_DEPTH) {
            return { error: `Max sub-agent nesting depth (${MAX_SUBAGENT_DEPTH}) reached — refusing to spawn another sub-agent.` };
          }
          subagentDepthRef.current += 1;
          try {
            let result = '';
            const subMessages: Message[] = [
              { role: 'system', content: 'You are a focused sub-agent. Complete the given task and return only your final answer.' },
              { role: 'user', content: params.task },
            ];
            // If the caller did not scope the toolset, deny the child spawn_subagent
            // so it cannot recurse further (defense-in-depth beyond the counter).
            const allToolNames = toolRegistry.getAllTools().map(t => t.name).filter(n => n !== 'spawn_subagent');
            const toolFilter = params.tools && params.tools.length > 0
              ? params.tools.filter(n => n !== 'spawn_subagent')
              : allToolNames;
            // Run on whatever the user has selected right now, through that
            // model's own server (#551) — see agentRoutingRef.
            const routing = agentRoutingRef.current;
            const subOptions = {
              model: routing.model,
              messages: subMessages,
              maxIterations: 3,
              endpoint: routing.endpoint,
              toolFilter,
              // Propagate the parent run's abort (#549 audit rank 8): without
              // it, Stop could not unwind a hung sub-agent.
              signal: abortControllerRef.current?.signal,
              onApprovalNeeded: createApprovalGate(),
              onAssistantMessage: (msg: string) => { result = msg; },
            };
            const gen = routing.conn
              ? openaiAgenticChatStream({ ...subOptions, conn: routing.conn })
              : agenticChatStream(subOptions);
            for await (const _m of gen) { /* consume */ }
            return { result };
          } finally {
            subagentDepthRef.current -= 1;
          }
        },
      });
      // Register spawn_parallel_subagents tool (#430) — fan out several focused
      // sub-agents concurrently and collect all results. Reuses the same depth
      // guard + tool scoping as spawn_subagent so recursion stays bounded.
      toolRegistry.registerTool({
        name: 'spawn_parallel_subagents',
        description: 'Run several focused sub-agents in parallel — each with a fresh context on its own task — and collect all their final answers. Use to decompose a task into independent parts that can run concurrently. Concurrency is capped.',
        parameters: {
          type: 'object',
          properties: {
            tasks: { type: 'array', items: { type: 'string' }, description: 'Independent tasks, one per sub-agent.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Optional tool names to give each sub-agent. Leave empty for all tools.' },
          },
          required: ['tasks'],
        },
        execute: async (params: { tasks: string[]; tools?: string[] }) => {
          const MAX_SUBAGENT_DEPTH = 2;
          const MAX_PARALLEL = 4;
          if (subagentDepthRef.current >= MAX_SUBAGENT_DEPTH) {
            return { error: `Max sub-agent nesting depth (${MAX_SUBAGENT_DEPTH}) reached — refusing to fan out sub-agents.` };
          }
          const tasks = Array.isArray(params.tasks) ? params.tasks.filter(t => typeof t === 'string' && t.trim()) : [];
          if (tasks.length === 0) return { error: 'No tasks provided.' };
          const limited = tasks.slice(0, MAX_PARALLEL);
          subagentDepthRef.current += 1;
          try {
            const spawnNames = new Set(['spawn_subagent', 'spawn_parallel_subagents']);
            const allToolNames = toolRegistry.getAllTools().map(t => t.name).filter(n => !spawnNames.has(n));
            const toolFilter = params.tools && params.tools.length > 0
              ? params.tools.filter(n => !spawnNames.has(n))
              : allToolNames;
            const runOne = async (task: string): Promise<string> => {
              let result = '';
              const routing = agentRoutingRef.current;
              const subOptions = {
                model: routing.model,
                messages: [
                  { role: 'system', content: 'You are a focused sub-agent. Complete the given task and return only your final answer.' },
                  { role: 'user', content: task },
                ] as Message[],
                maxIterations: 3,
                endpoint: routing.endpoint,
                toolFilter,
                signal: abortControllerRef.current?.signal,
                onApprovalNeeded: createApprovalGate(),
                onAssistantMessage: (msg: string) => { result = msg; },
              };
              const gen = routing.conn
                ? openaiAgenticChatStream({ ...subOptions, conn: routing.conn })
                : agenticChatStream(subOptions);
              for await (const _m of gen) { /* consume */ }
              return result;
            };
            const settled = await Promise.allSettled(limited.map(runOne));
            const results = settled.map((s, i) => ({
              task: limited[i],
              result: s.status === 'fulfilled' ? s.value : `Error: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
            }));
            return { ranInParallel: limited.length, dropped: tasks.length - limited.length, results };
          } finally {
            subagentDepthRef.current -= 1;
          }
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
        // Only fall back to the first model if nothing has claimed one. The
        // resume-on-startup effect restores session.model synchronously on
        // mount, but this runs later (after the /api/tags round-trip) and used
        // to overwrite it — so resuming a chat silently switched its model (#533).
        if (combined.length > 0 && !modelClaimedRef.current) {
          // Default to a model that can actually run the journey (#549 rank
          // 11): prefer an installed local MLX model over whatever /api/tags
          // happened to list first.
          const preferred = combined.find(m => !m.cloud && isMlxModelName(m.name)) ?? combined[0];
          setModel(preferred.name);
        }
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

  /**
   * Re-measure the composer to fit its content, capped at the CSS max height.
   *
   * The measure step used to live only in the textarea's own onChange, so every
   * programmatic write — prompt library, Alt+Up/Down history, dictation results,
   * @-mention resolution, slash-command completion — left the box at its previous
   * height. The common case was a 12-line prompt rendered in a one-line box that
   * snapped open as soon as you typed a character, which reads as a glitch (#534).
   */
  const growComposer = (el?: HTMLTextAreaElement | null) => {
    const ta = el ?? (document.getElementById('chat-input') as HTMLTextAreaElement | null);
    if (!ta) return;
    ta.style.height = 'auto';
    if (ta.value !== '') ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  // Keyed on `input`, so it covers both typed and programmatic updates (#259, #534).
  useEffect(() => { growComposer(); }, [input]);

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
        // Cleared on unmount: this timer had no cleanup, so it kept firing
        // after the component went away. Surfaced as an uncaught
        // "ReferenceError: document is not defined" when it landed after the
        // jsdom environment was torn down, and would throw the same way after a
        // real unmount.
        const t = setTimeout(() => {
          const ae = document.activeElement;
          if (ae === null || ae === document.body) input.focus();
        }, 100);
        return () => clearTimeout(t);
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
      // Collapse the sidebar when entering mobile widths, and reopen it when
      // returning to desktop — the rail is the primary navigation (#545).
      setIsMobile(prev => {
        if (isMobileDevice && !prev) setIsSidebarOpen(false);
        else if (!isMobileDevice && prev) setIsSidebarOpen(true);
        return isMobileDevice;
      });
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
    // A project may span several repositories (#492) — expose all of its
    // folders. The SESSION's own working directory (#550), when set, becomes
    // the primary folder for this session (relative paths, git) with the
    // project's other folders still readable.
    const projRoots = projectRoots(project);
    const roots = sessionWorkingDir
      ? [sessionWorkingDir, ...projRoots.filter(r => r !== sessionWorkingDir)]
      : projRoots;
    if (roots.length > 0) {
      // set_workspace_roots rejects the whole list if ANY folder is missing
      // (moved, renamed, unmounted volume). That rejection used to be
      // unhandled: the sidebar showed the new project as active while the
      // backend still pointed at the PREVIOUS project's folder, so the agent
      // silently kept reading and editing the wrong repository (#502).
      // Proactive backend check first (#550): fs::metadata in Rust tells us
      // the primary root is gone BEFORE set_workspace_roots rejects, so the
      // banner can say precisely what is wrong. null = cannot check (browser
      // dev / tests) — fall through and let the existing .catch handle it.
      void checkPath(roots[0])
        .then(check => {
          if (check && (!check.exists || !check.isDir)) {
            setProjectRulesContent(null);
            setWorkspaceWarning(
              check.exists
                ? `Working folder for "${project?.name ?? 'this session'}" is not a folder: ${roots[0]}`
                : `Working folder missing for "${project?.name ?? 'this session'}": ${roots[0]} does not exist (moved, renamed, or unmounted volume?)`,
            );
            return; // don't hand the backend a root we know is bad
          }
          return openWorkspaceRoots(roots).then(() => {
            setWorkspaceWarning(null);
            registerGitTools(roots[0]);
            return loadProjectRules(roots[0]).then(setProjectRulesContent);
          });
        })
        .catch((err) => {
          // Warn, never crash (#550): the app stays usable in plain-chat
          // terms and the banner offers a picker to point somewhere real.
          setProjectRulesContent(null);
          setWorkspaceWarning(
            `Working folder unavailable for "${project?.name ?? 'this session'}": ${formatErrorLine(err)}`,
          );
        });
    } else {
      setProjectRulesContent(null);
      setWorkspaceWarning(null);
    }
    // Apply per-project model overrides if they are set (#171).
    if (project?.model) setModel(project.model);
 }, [activeProjectId, projects, sessionWorkingDir]);

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
    setSessionWorkingDir(null);
    if (projectId !== undefined) setActiveProjectId(projectId);
  }, []);

  /**
   * Project-first entry point (#542): pick a folder, and that IS the project.
   *
   * Previously `+` opened a name field and produced a project with no folder;
   * binding one meant a trip to Settings -> Projects -> Choose…. Now the folder
   * picker is the first and only step, the project is named from the folder,
   * and it becomes active immediately — matching Codex/ChatGPT and Claude.
   */
  const createProjectFromFolder = useCallback(async () => {
    if (creatingProject) return;
    setCreatingProject(true);
    try {
      // Multi-select (#549 rank 12): the journey says "folder(s)" — one
      // dialog can bind them all; the first folder names the project.
      const dirs = await pickDirectories();
      if (!dirs || dirs.length === 0) {
        // Cancel and a broken picker both return null — say SOMETHING either
        // way; a silent dead click on the primary CTA reads as a broken app
        // (#549 audit rank 6).
        showStatusBanner('No folder selected');
        return;
      }
      const dir = dirs[0];
      // Dedup against ALL roots (#549 rank 12): re-picking a secondary folder
      // used to create a shadow project instead of switching to its owner.
      const existing = storage.getProjects().find(p => projectRoots(p).includes(dir));
      if (existing) {
        // Re-opening a folder already bound to a project just switches to it,
        // rather than creating a confusing duplicate row.
        setActiveProjectId(existing.id);
        startNewChat(existing.id);
        showStatusBanner(`Switched to "${existing.name}"`);
        return;
      }
      const proj: Project = {
        id: `proj_${Date.now()}`,
        name: basename(dir),
        workspaceRoot: dir,
        workspaceRoots: dirs,
        instructions: '',
        createdAt: Date.now(),
      };
      storage.saveProject(proj);
      setProjects(storage.getProjects());
      setActiveProjectId(proj.id);
      startNewChat(proj.id);
    } catch (e) {
      showStatusBanner(`Could not create project: ${formatErrorLine(e)}`);
    } finally {
      setCreatingProject(false);
    }
  }, [creatingProject, startNewChat]);


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
        // Allowlist the binary, not the exact string — "always allow npm test"
        // should cover "npm run build" too (#549 audit rank 2).
        cliAllowlist.add(commandBinary(pendingApproval.command));
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
      } else if (e.key === 'Enter' && !shouldIgnoreEnterShortcut(document.activeElement)) {
        // Only approve when the user is not typing and has not focused a
        // button (#497). Previously any Enter approved the plan — including
        // Enter pressed in the plan-edit textarea (silently discarding the
        // edits) or with Deny focused (turning a denial into an approval).
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
    // Claim the model so the startup default cannot overwrite it (#533).
    if (session.model) modelClaimedRef.current = true;
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
    // Adopt this session's working directory (#550); null = project default.
    setSessionWorkingDir(session.workingDir ?? null);
    // Loading a chat should show the latest messages and never a false unread badge (#258)
    prevMsgCountRef.current = session.messages.length;
    setUnreadCount(0);
    scrollToEndOnLoadRef.current = true;
  };

  // Open a session from the sidebar: adopt its project scope first so
  // workspace roots / rules / per-project model follow the chat (#543).
  const openSession = (session: ChatSession) => {
    setActiveProjectId(session.projectId ?? null);
    loadSession(session);
  };

  // Refresh the MCP server list with `authenticated` DERIVED from the token
  // store (#521): the flag used to live only in transient React state, so
  // adding/deleting any server (or restarting) wiped every green badge and
  // users re-ran OAuth for tokens that were still valid in the keychain.
  const refreshMcpServers = useCallback(async () => {
    const list = mcpConfigStore.list();
    const withAuth = await Promise.all(list.map(async server => {
      if (server.type !== 'http') return server;
      try {
        const tokens = await tokenStore.load(server.id);
        const authenticated = !!tokens && (!tokenStore.isExpired(tokens) || !!tokens.refresh_token);
        return { ...server, authenticated };
      } catch {
        return server;
      }
    }));
    setMcpServers(withAuth);
  }, []);

  // Change THIS session's working directory (#550) — picked folder becomes
  // the session's primary workspace and persists on the session record.
  const changeSessionWorkingDir = () => {
    void pickDirectory().then(dir => {
      if (!dir) { showStatusBanner('No folder selected'); return; }
      setSessionWorkingDir(dir);
      setWorkspaceWarning(null);
      if (currentSessionId) {
        storage.updateSession(currentSessionId, { workingDir: dir });
        setSessions(storage.getSessions());
      }
      showStatusBanner(`Session now works in ${dir}`);
      // Proactive backend check (#550): warn when the picked path is missing
      // or not a directory — but still honor the choice; the folder may live
      // on a volume that is only temporarily unmounted. null = cannot check.
      void checkPath(dir).then(check => {
        if (check && (!check.exists || !check.isDir)) {
          showStatusBanner(check.exists
            ? `Warning: "${dir}" is not a folder`
            : `Warning: "${dir}" does not exist (unmounted volume?)`);
        }
      });
    });
  };

  const toggleProjectExpanded = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Inline project rename (#549 audit rank 10) — the escape hatch for the
  // auto-derived name; a rename here also marks the name as deliberate so
  // the first-prompt auto-rename never overwrites it (isAutoFolderName).
  const commitProjectRename = () => {
    const id = renamingProjectId;
    const name = projectRenameDraft.trim();
    setRenamingProjectId(null);
    if (!id || !name) return;
    const project = storage.getProjects().find(p => p.id === id);
    if (!project || project.name === name) return;
    storage.saveProject({ ...project, name });
    setProjects(storage.getProjects());
  };

  const deleteProject = (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"? Its chats are kept, just unfiled.`)) return;
    storage.deleteProject(id);
    setProjects(storage.getProjects());
    setSessions(storage.getSessions());
    if (activeProjectId === id) setActiveProjectId(null);
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
    // Read through a ref, not the render closure (#508). Streaming calls this on
    // every token; setCurrentSessionId does not apply until the next render, so
    // each call still saw null and minted ANOTHER session — one per token.
    if (currentSessionIdRef.current === null) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: generateTitle(currentMessages),
        messages: currentMessages,
        createdAt: Date.now(),
        model,
        branchState: activeBranchState,
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        ...(sessionWorkingDirRef.current ? { workingDir: sessionWorkingDirRef.current } : {}),
      };
      const result = storage.saveSession(newSession);
      if (result.ok === false && result.error === 'quota') setStorageWarning(true);
      currentSessionIdRef.current = newSession.id;
      setCurrentSessionId(newSession.id);
      setSessions(storage.getSessions());
    } else {
      const session = storage.getSessions().find(s => s.id === currentSessionIdRef.current);
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
    if (messages.length === 0) { showStatusBanner('Nothing to export — the conversation is empty'); return; }
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
    if (messages.length === 0) { showStatusBanner('Nothing to copy — the conversation is empty'); return; }
    const title = (currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : undefined) ?? 'Chat';
    const md = chatToMarkdown(messages, { title });
    try {
      await navigator.clipboard.writeText(md);
      setCopiedChat(true);
      setTimeout(() => setCopiedChat(false), 1500);
    } catch {
      // Clipboard can be denied by permissions; silence left the user unsure
      // whether the copy had worked (#547).
      showStatusBanner('Could not copy — clipboard unavailable');
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

  // Close the loop at run end (#549 audit rank 9): a finished agentic run used
  // to just go quiet — verify verdicts shown only to the model, commit hashes
  // discarded, notifications wired only into plain chat. One shared exit.
  const finishAgentRun = (outcome: 'done' | 'error' | 'paused') => {
    const s = runStatsRef.current;
    if (!s.startedAt) return;
    // A tool-less agentic reply is just a chat answer — no run to summarize,
    // and a "Run finished" banner would be noise.
    if (s.toolCalls === 0) { s.startedAt = 0; return; }
    const secs = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    const dur = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    const bits = [
      `${s.toolCalls} ${s.toolCalls === 1 ? 'step' : 'steps'}`,
      s.filesEdited.size > 0 ? `${s.filesEdited.size} ${s.filesEdited.size === 1 ? 'file' : 'files'} edited` : null,
      s.commits.length > 0 ? `${s.commits.length} ${s.commits.length === 1 ? 'commit' : 'commits'}` : null,
      s.checks ? `checks ${s.checks}` : null,
    ].filter(Boolean).join(' · ');
    if (outcome === 'done' && s.toolCalls > 0) {
      setMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: `✅ Done in ${dur} — ${bits}.`, runSummary: true, ts: Date.now() } as Message];
        saveCurrentSession(updated);
        return updated;
      });
    }
    showStatusBanner(
      outcome === 'done' ? `Run finished in ${dur}`
        : outcome === 'paused' ? 'Run paused at the step limit — use "Continue agent" to keep going'
        : 'Run stopped on an error',
    );
    if (notifyOnComplete && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(
          outcome === 'done' ? 'Agent run finished' : outcome === 'paused' ? 'Agent run paused' : 'Agent run failed',
          { body: bits },
        );
      } catch { /* blocked */ }
    }
    if (playSoundOnComplete) playCompletionSound();
    s.startedAt = 0;
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
          const defaults = {};
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
                // Cloud models are proxied by the local daemon (#483).
                const commitEndpoint = url('/api/chat');
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
        if (result.action === 'unstage') {
          // /unstage removes all currently-staged files from the index (#419).
          const wsRoot = projects.find(p => p.id === activeProjectId)?.workspaceRoot;
          if (!wsRoot) { showStatusBanner('No workspace open — open a project folder first'); return; }
          void (async () => {
            try {
              const status = await gitStatus(wsRoot);
              const staged = status.staged ?? [];
              if (staged.length === 0) { showStatusBanner('Nothing staged to unstage'); return; }
              await gitUnstage(wsRoot, staged);
              showStatusBanner(`Unstaged ${staged.length} file${staged.length !== 1 ? 's' : ''}`);
            } catch (err) {
              showStatusBanner(`Unstage failed: ${formatErrorLine(err)}`);
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
              // Cloud models are proxied by the local daemon (#483).
              const initEndpoint = url('/api/chat');
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
              // Cloud models are proxied by the local daemon (#483).
              const compactEndpoint = url('/api/chat');
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
      if (!parsed.ok) {
        const msg = parsed.error ?? 'Invalid schema';
        setSchemaError(msg);
        // schemaError only renders next to the schema box inside Settings, so
        // from the chat this return was completely silent: nothing sent, no
        // error, no clue why (#501). Surface it where the user actually is.
        showStatusBanner(`Structured output: ${msg} — fix it in Settings, or turn structured output off.`);
        return;
      }
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
      workspaceBlock: formatWorkspaceContext(workspaceCtx) || undefined,
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
    // Explicit num_ctx (via /ctx or Settings) wins; otherwise use the
    // auto-sized window so long agentic runs don't silently truncate (#549).
    const sendOptions: GenerationOptions = genOptions.num_ctx !== undefined
      ? genOptions
      : { ...genOptions, num_ctx: effectiveNumCtx };
    // Track recent model usage (#322)
    setRecentModels(prev => {
      const next = [activeModel, ...prev.filter(m => m !== activeModel)].slice(0, 5);
      try { safeSetItem('ollama_gui_recent_models', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

    // Compaction is always on, sized to the real window (#549 rank 13):
    // summarize at ~70% of the effective context instead of a fixed 3000
    // tokens that ignored the window entirely.
    const compactAt = Math.round(effectiveNumCtx * 0.7);
    if (shouldCompact(rawHistory, compactAt)) {
      rawHistory = await compactConversation(rawHistory, {
        thresholdTokens: compactAt,
        summarizeFn: makeSummarizeFn(activeModel, url('/api/chat')),
      });
    }

    const chatHistory = await applyFilterInlet(rawHistory);

    // Claude-style project naming (#542): once the user says what they are
    // actually doing, replace the folder-derived placeholder with that. Only
    // while the name still looks auto-generated — a deliberate rename is never
    // overwritten — and only on the first prompt of the project.
    if (!continueMode && activeProjectId) {
      const proj = storage.getProjects().find(p => p.id === activeProjectId);
      if (proj && isAutoFolderName(proj.name, projectRoots(proj))) {
        const derived = deriveProjectName(text);
        if (derived && derived !== proj.name) {
          storage.saveProject({ ...proj, name: derived });
          setProjects(storage.getProjects());
        }
      }
    }
    setMessages(continueMode ? messages.filter(stripMaxIter) : [...messages, userMessage]);
    if (textOverride === undefined) setInput(''); // keep in-progress typing for queued auto-sends
    setAttachedImages([]);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    runStatsRef.current = { startedAt: Date.now(), toolCalls: 0, filesEdited: new Set(), commits: [], checks: null };
    runHitMaxRef.current = false;

    // Hoisted above the try so the catch can reference it too, and named
    // distinctly so it does not shadow the module-level isCloudModel() (#484).
    const usingCloudModel = models.some(m => m.name === activeModel && m.cloud);

    try {
      // Which server + model name this run targets. Shared with sub-agents
      // through resolveAgentRouting so the two can never drift (#551).
      const routing = resolveAgentRouting(activeModel);
      const endpoint = routing.endpoint;

      if (isAgenticMode) {
        // Use agentic loop with tool calling
        let agenticReasoning = '';
        let agenticGenStats: GenStats | undefined;
        setAgentStatus('Thinking…');
        const agenticOptions: AgenticChatOptions = {
          model: routing.model,
          messages: chatHistory,
          endpoint,
          maxIterations: autonomySettings.maxIterations,
          signal: abortControllerRef.current?.signal,
          options: sendOptions,
          compactThresholdTokens: compactAt,
          format,
          onIteration: (iteration, maxIterations) => setAgentStep({ iteration, max: maxIterations }),
          onMaxIterations: () => { setAgentHitMax(true); runHitMaxRef.current = true; },
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
          // Send the task-relevant core toolset plus user-added tools instead
          // of every registration (#549 audit rank 3): ~60 tool definitions
          // per request could fill a small context window on their own.
          toolFilter: [
            ...CORE_AGENT_TOOLS,
            ...mcpServers.flatMap(s => getRegisteredToolNames(s)),
            ...customTools.map(t => toolNameFor(t)),
          ].filter(n => !disabledTools.has(n)),
          // Plan/ask autonomy gate (#88/#89/#189), shared with sub-agents (#476)
          onApprovalNeeded: createApprovalGate(),
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
            runStatsRef.current.toolCalls += 1;
            // Feed the agent-activity timeline (#432).
            try {
              const args = (toolCall as any).function?.arguments ?? (toolCall as any).arguments;
              pushActivity('call', toolCallName(toolCall), args ? JSON.stringify(args) : undefined);
            } catch { /* non-fatal */ }
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
            pushActivity('result', toolResult.name, toolResult.content); // (#432)
            // Track check/test verdicts for the run summary (#549 rank 9).
            if (toolResult.name === 'run_tests' || toolResult.name === 'run_checks') {
              try {
                const parsed = JSON.parse(toolResult.content);
                if (typeof parsed.ok === 'boolean') runStatsRef.current.checks = parsed.ok ? 'passed' : 'failed';
              } catch { /* non-JSON result — no verdict */ }
            }
            setMessages(prev => {
              // Persist the tool trail as it happens (#549 rank 9): previously
              // only text streaming saved, so an error or reload dropped the
              // whole record of what the agent actually did.
              const updated = [...prev, { role: 'tool', content: toolResult.content, name: toolResult.name } as Message];
              saveCurrentSession(updated);
              return updated;
            });
          },
          onComplete: () => {
            setIsLoading(false);
            setAgentStatus(null);
            setAgentStep(null);
            finishAgentRun(runHitMaxRef.current ? 'paused' : 'done');
            // Intentionally do NOT reset agentHitMax here: a max-iterations
            // stop sets it via onMaxIterations and the "Continue agent" button
            // (#403) must remain visible after the run completes. sendMessage
            // clears it on the next send.
          },
          onError: (error) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: formatErrorLine(error, usingCloudModel ? 'ollama-cloud' : 'ollama'), isError: true },
            ]);
            setIsLoading(false);
            setAgentStatus(null);
            setAgentStep(null);
            setAgentHitMax(false);
            finishAgentRun('error');
          },
        };
        // LM Studio / llama.cpp / vLLM models (openai-kind connections) run
        // through the OpenAI-compatible tool loop (#551): the Ollama loop's
        // /api/chat dialect silently broke tool calling there — the exact gap
        // that made Qwen coder models fail here while opencode handled them.
        const agentStream = routing.conn
          ? openaiAgenticChatStream({
              ...agenticOptions,
              conn: routing.conn,
              temperature: sendOptions.temperature,
            })
          : agenticChatStream(agenticOptions);

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
      } else {
        // Route through OpenAI-compatible connection when model belongs to one (#123).
        // Remote Ollama connections use the resolved `endpoint` (already correct above).
        const connForModel = routing.conn;

        // Use regular chat stream
        let assistantContent = '';
        let assistantReasoning = '';
        let streamOk = false;
        let genStats: GenStats | undefined;
        setMessages(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);

        try {
          if (connForModel) {
            // OpenAI-compatible SSE stream (#123)
            await streamOpenAiChat(
              connForModel,
              routing.model,
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
          const ollamaModelName = routing.model;
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
          }, endpoint, false, sendOptions, abortControllerRef.current?.signal, format);
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
            // One-time LibreOffice onboarding nudge (#145/#405): when a document
            // tool runs and the optional engine is missing (and not dismissed),
            // surface the onboarding modal. needsOnboarding() respects the
            // persisted "dismissed" flag so this shows at most once.
            void checkLibreOffice()
              .then(lo => { if (needsOnboarding(!!lo.available)) setShowLoOnboarding(true); })
              .catch(() => { if (needsOnboarding(false)) setShowLoOnboarding(true); });
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
              return [...withoutPartial, { role: 'assistant', content: formatErrorLine(streamError, usingCloudModel ? 'ollama-cloud' : 'ollama'), isError: true }] as Message[];
            });
          }
        }
        setIsLoading(false);
        if (streamOk) void streamOk; // used for future tracking
      }
    } catch (error) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: formatErrorLine(error, usingCloudModel ? 'ollama-cloud' : 'ollama'), isError: true },
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
        // Hand off via state rather than calling sendMessage from this closure
        // (#507). sendMessage is re-created every render and reads `messages`
        // lexically; invoking it here ran turn 2 against the snapshot taken
        // BEFORE turn 1's reply existed, so `setMessages([...messages, user])`
        // silently dropped the previous exchange and saveCurrentSession then
        // persisted the truncated transcript. The effect below fires it from a
        // later render, where `messages` already includes turn 1.
        setPendingQueuedMessage(next);
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
    // Deleting a message is irreversible — confirm first (#448).
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
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
    const usingCloudModel = models.some(m => m.name === model && m.cloud);
    const routing = resolveAgentRouting(model);
    const contEndpoint = routing.endpoint;
    const ollamaModelName = routing.model;
    let continuedContent = '';
    let contGenStats: GenStats | undefined;
    const appendContinued = (delta: string) => {
      continuedContent += delta;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        const updated = [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent }] as Message[];
        saveCurrentSession(updated);
        return updated;
      });
    };
    try {
      if (routing.conn) {
        // Continuing an LM Studio / vLLM reply used to be sent to the LOCAL
        // Ollama daemon under a model name it has never heard of (#551), so
        // "Continue generation" always failed for OpenAI-kind connections.
        await streamOpenAiChat(
          routing.conn,
          routing.model,
          history,
          (delta) => { if (delta) appendContinued(delta); },
          { temperature: genOptions?.temperature },
          abortControllerRef.current?.signal,
        );
      } else {
        await fetchOllamaChatStream(ollamaModelName, history, (chunk) => {
          if (chunk.message?.content) appendContinued(chunk.message.content);
          if (chunk.done) contGenStats = computeGenStats(chunk);
        }, contEndpoint, false, genOptions, abortControllerRef.current?.signal);
      }
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
            return [...prev.slice(0, -1), { ...last, content: cleanContent + continuedContent + '\n\n' + formatErrorLine(streamError, usingCloudModel ? 'ollama-cloud' : 'ollama'), isError: true, wasCancelled: false }] as Message[];
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
    { id: 'temporary-chat', label: 'New Temporary Chat', run: () => startTemporaryChat() },
    { id: 'find', label: 'Find in Chat', hint: 'Ctrl+F', run: () => { setChatSearchOpen(true); setChatSearchIndex(0); } },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', hint: 'Ctrl+\\', run: () => setIsSidebarOpen(prev => !prev) },
    { id: 'open-settings', label: 'Open Settings', hint: 'Ctrl+,', run: () => setIsSettingsOpen(true) },
    { id: 'show-help', label: 'Show Keyboard Shortcuts', hint: '?', run: () => setShowHelp(true) },
    { id: 'autonomy-plan', label: 'Set Autonomy: Plan', run: () => { const s = { ...autonomySettings, level: 'plan' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'autonomy-ask', label: 'Set Autonomy: Ask', run: () => { const s = { ...autonomySettings, level: 'ask' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'autonomy-auto', label: 'Set Autonomy: Auto', run: () => { const s = { ...autonomySettings, level: 'auto' as AutonomyLevel }; setAutonomySettings(s); saveAutonomySettings(s); } },
    { id: 'toggle-theme', label: 'Toggle Theme', hint: 'Ctrl+Shift+D', run: () => toggleTheme() },
    { id: 'toggle-zen', label: 'Toggle Zen/Focus Mode', hint: 'Ctrl+Shift+Z', run: () => toggleZenMode() },
    { id: 'copy-conversation', label: 'Copy Conversation as Markdown', run: () => { void handleCopyMarkdown(); } },
    { id: 'export-conversation', label: 'Export Conversation as Markdown', run: () => handleExportMarkdown() },
    { id: 'export-chats', label: 'Export All Chats (JSON)', run: () => handleExport() },
    { id: 'import-chats', label: 'Import Chats (JSON)', run: () => importInputRef.current?.click() },
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

  // One sidebar chat row — used inside project groups and the unscoped list.
  const renderSessionRow = (s: ChatSession) => (
    <div
      key={s.id}
      onClick={() => openSession(s)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { openSession(s); return; }
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
      className={`group px-2 py-1.5 rounded-md cursor-pointer transition-colors flex items-center ${
        currentSessionId === s.id
          ? (dark ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100 text-zinc-900')
          : (dark ? 'hover:bg-zinc-800/60 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-600')
      }`}
    >
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
          className={`flex-1 text-xs px-1 py-0.5 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate text-xs">{s.pinned ? '📌 ' : ''}{s.title}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); deleteSession(s.id, s.title); }}
        title="Delete"
        aria-label={`Delete session: ${s.title}`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 p-1 text-xs hover:text-red-400"
      >✕</button>
    </div>
  );

  return (
    <CodeWordWrapContext.Provider value={{ wordWrap: codeWordWrap, toggle: toggleCodeWordWrap }}>
    <div className={`flex h-screen font-sans transition-colors duration-300 ${
      dark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'
    }`}>

      {/* Sidebar — projects with their chat sessions nested beneath (Ollama-style) */}
      <div className={`transition-all duration-300 border-r flex flex-col absolute md:relative z-40 ${
        (isSidebarOpen && !zenMode) ? 'w-64 p-3' : 'w-0 overflow-hidden p-0 border-none'
      } ${dark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} ${
        isMobile && !isSidebarOpen ? 'hidden' : ''
      }`}>
        {/* New chat — the user picks which project it belongs to (#542) */}
        <div className="relative mb-2">
          <button
            onClick={() => {
              if (projects.length === 0) { void createProjectFromFolder(); return; }
              setNewMenuOpen(v => !v);
            }}
            aria-label="Start new chat"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            className={`w-full py-2 px-4 rounded-lg transition-colors text-sm font-semibold ${
              dark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
            }`}
          >
            + New
          </button>
          {newMenuOpen && (
            <div role="menu" aria-label="New chat in project" className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-lg z-50 max-h-64 overflow-y-auto ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
              {projects.map(p => (
                <button
                  key={p.id}
                  role="menuitem"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setExpandedProjects(prev => new Set(prev).add(p.id));
                    startNewChat(p.id);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs truncate ${dark ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-800'}`}
                >📂 {p.name}</button>
              ))}
              <button
                role="menuitem"
                onClick={() => { setNewMenuOpen(false); startNewChat(null); }}
                className={`w-full text-left px-3 py-2 text-xs ${dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-50 text-zinc-500'}`}
              >🌐 No project</button>
              <button
                role="menuitem"
                onClick={() => { setNewMenuOpen(false); void createProjectFromFolder(); }}
                className={`w-full text-left px-3 py-2 text-xs border-t ${dark ? 'hover:bg-zinc-700 text-zinc-400 border-zinc-700' : 'hover:bg-zinc-50 text-zinc-500 border-zinc-200'}`}
              >＋ New project from a folder…</button>
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
          className={`w-full text-xs border rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder-zinc-400'
          }`}
        />

        {/* Projects — click a name to show its sessions; + starts a chat in it */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className={`text-xs uppercase font-semibold ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Projects</span>
            <button
              onClick={() => { void createProjectFromFolder(); }}
              disabled={creatingProject}
              title="New project from a folder"
              aria-label="New project from a folder"
              className={`px-1.5 rounded hover:opacity-70 disabled:opacity-40 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}
            >{creatingProject ? '…' : '+'}</button>
          </div>
          {projects.length === 0 && (
            <p className={`text-xs italic px-1 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No projects yet — click + to open a folder.</p>
          )}
          {projects.map(p => {
            const expanded = expandedProjects.has(p.id);
            const projSessions = sessionsForProject(p.id);
            return (
              <div key={p.id} className="mb-0.5">
                <div className="group/proj flex items-center">
                  {renamingProjectId === p.id ? (
                    <input
                      autoFocus
                      value={projectRenameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setProjectRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitProjectRename();
                        else if (e.key === 'Escape') setRenamingProjectId(null);
                      }}
                      onBlur={commitProjectRename}
                      aria-label="Rename project"
                      className={`flex-1 min-w-0 text-sm px-2 py-1 rounded border outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                    />
                  ) : (
                  <button
                    onClick={() => { toggleProjectExpanded(p.id); setActiveProjectId(p.id); }}
                    onDoubleClick={() => { setRenamingProjectId(p.id); setProjectRenameDraft(p.name); }}
                    onContextMenu={(e) => { e.preventDefault(); setProjectContextMenu({ x: e.clientX, y: e.clientY, projectId: p.id }); }}
                    aria-expanded={expanded}
                    aria-current={activeProjectId === p.id}
                    aria-label={p.name}
                    title={projectRoots(p)[0] ?? 'No folder bound'}
                    className={`flex-1 min-w-0 text-left px-2 py-1.5 text-sm rounded-md transition-colors ${
                      activeProjectId === p.id
                        ? (dark ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100 text-zinc-900')
                        : (dark ? 'text-zinc-300 hover:bg-zinc-800/60' : 'text-zinc-700 hover:bg-zinc-100')
                    }`}
                  >
                    <span className="block truncate">
                      <span className={`inline-block w-3 text-[10px] ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>{expanded ? '▾' : '▸'}</span>
                      {p.name}
                    </span>
                  </button>
                  )}
                  <button
                    onClick={() => {
                      setExpandedProjects(prev => new Set(prev).add(p.id));
                      startNewChat(p.id);
                    }}
                    title={`New chat in ${p.name}`}
                    aria-label={`New chat in project ${p.name}`}
                    className={`opacity-0 group-hover/proj:opacity-100 focus:opacity-100 px-1.5 text-sm ${dark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}`}
                  >+</button>
                  <button
                    onClick={() => deleteProject(p.id, p.name)}
                    className="opacity-0 group-hover/proj:opacity-100 focus:opacity-100 px-1 text-[10px] text-red-400 hover:text-red-300"
                    aria-label={`Delete project ${p.name}`}
                  >✕</button>
                </div>
                {expanded && (
                  <div className={`ml-2.5 pl-1.5 border-l ${dark ? 'border-zinc-800' : 'border-zinc-200'}`}>
                    {projSessions.length === 0 && (
                      <p className={`text-xs italic px-2 py-1 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>No chats yet.</p>
                    )}
                    {projSessions.map(s => renderSessionRow(s))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Sessions not bound to any project */}
          {unscopedSessions.length > 0 && (
            <>
              <p className={`text-xs uppercase font-semibold mt-3 mb-1 px-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Chats</p>
              {unscopedSessions.map(s => renderSessionRow(s))}
            </>
          )}
        </div>

        {/* Bottom actions */}
        <div className={`mt-2 border-t pt-2 ${dark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`w-full py-2 px-4 text-sm rounded-lg transition-all text-left flex items-center gap-2 ${
              dark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            ⚙️ Settings
          </button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {/* Main Chat Area - Responsive: full width on mobile, adjusts for sidebar on desktop */}
      <div className={`flex-1 flex flex-col relative overflow-hidden ${
        isMobile && isSidebarOpen && !zenMode ? 'ml-64' : ''
      }`}>
        {/* Header — minimal, Ollama-style: no buttons on the right. */}
        <header className={`h-12 border-b flex items-center gap-3 px-4 shrink-0 transition-colors duration-300 ${
          dark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'
        }`}>
          {isMobile && (
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              title="Toggle sidebar (Ctrl+\\)"
              aria-label="Toggle sidebar"
              className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-600'}`}
            >
              ☰
            </button>
          )}
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
          <span className={`text-sm font-medium truncate ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
            {currentSessionId ? (sessions.find(s => s.id === currentSessionId)?.title ?? 'Chat') : 'New chat'}
          </span>
          {isAgenticMode && isLoading && agentStatus && (
            <span
              role="status"
              aria-live="polite"
              aria-label={`Agent status: ${agentStep ? `step ${agentStep.iteration} of ${agentStep.max}, ` : ''}${agentStatus}`}
              className={`text-xs px-2 py-0.5 rounded-full animate-pulse shrink-0 ${dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-100 text-zinc-700'}`}
            >
              {agentStep && <span className="opacity-70 mr-1">Step {agentStep.iteration}/{agentStep.max}</span>}
              {agentStatus}
            </span>
          )}
          {isMobile && (
            <button
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMobileMenu({ x: Math.max(8, r.right - 180), y: r.bottom + 4 });
              }}
              className={`ml-auto p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-600'}`}
              title="Menu"
              aria-label="Open menu"
              aria-haspopup="menu"
            >
              ⋯
            </button>
          )}
        </header>

        {/* Mobile action menu (#445): panel toggles + tools that the collapsed
            header hides at small widths. */}
        {mobileMenu && (
          <ContextMenu
            x={mobileMenu.x}
            y={mobileMenu.y}
            dark={dark}
            onClose={() => setMobileMenu(null)}
            items={[
              { label: isSidebarOpen ? 'Hide sidebar' : 'Show sidebar', onSelect: () => setIsSidebarOpen(!isSidebarOpen) },
              { label: 'Command palette…', onSelect: () => setPaletteOpen(true) },
              { label: 'Keyboard shortcuts', onSelect: () => setShowHelp(true) },
              { label: 'Settings…', onSelect: () => setIsSettingsOpen(true) },
            ]}
          />
        )}

        {/* Live plan checklist (#239) */}
        <PlanPanel plan={plan} dark={dark} onClear={clearPlan} />

        {statusBanner && (
          <div className={`px-4 py-1.5 text-xs text-center border-b ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-zinc-100 border-zinc-300 text-zinc-600'}`} role="status" aria-live="polite">
            {statusBanner}
          </div>
        )}

        {/* Ambient project context (#543): name + working folder. The chip is
            the SESSION's working dir (#550) — click it to change where this
            session's agent works. */}
        {(() => {
          const active = projects.find(p => p.id === activeProjectId);
          const projRoots = projectRoots(active);
          const roots = sessionWorkingDir
            ? [sessionWorkingDir, ...projRoots.filter(r => r !== sessionWorkingDir)]
            : projRoots;
          return <ProjectHeader name={active?.name ?? null} roots={roots} dark={dark} onChangeWorkingDir={changeSessionWorkingDir} />;
        })()}

        {/* Messages - Responsive: full width on mobile, padded on desktop.
            role="log" + aria-live announce streamed assistant replies to screen
            readers (#439); without this the app's core output is silent to AT. */}
        <div
          ref={messagesContainerRef}
          data-testid="messages-container"
          role="log"
          aria-live="polite"
          aria-label="Conversation messages"
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 relative"
        >
          {/* Context limit warning (#319) */}
          {showContextWarning && (
            <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs mb-2 ${dark ? 'bg-amber-900/40 border border-amber-700/50 text-amber-300' : 'bg-amber-50 border border-amber-300 text-amber-800'}`}>
              <span>⚠ Conversation is {contextPct}% of the context window.</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* One-click actions instead of "/compact or /ctx 6144" jargon (#549). */}
                <button
                  onClick={() => { void sendMessage('/compact'); }}
                  disabled={isLoading}
                  className="px-2 py-0.5 rounded border border-current hover:opacity-80 disabled:opacity-40"
                >Summarize older messages</button>
                <button
                  onClick={() => {
                    const next = { ...genOptions, num_ctx: Math.round(effectiveNumCtx * 1.5) };
                    setGenOptions(next);
                    safeSetItem('ollama_gui_gen_options', JSON.stringify(next));
                    showStatusBanner(`Context window raised to ${Math.round(effectiveNumCtx * 1.5)}`);
                  }}
                  className="px-2 py-0.5 rounded border border-current hover:opacity-80"
                >Raise limit</button>
                <button onClick={() => setContextWarningDismissed(true)} aria-label="Dismiss context warning" className={`${dark ? 'text-amber-400 hover:text-amber-200' : 'text-amber-600 hover:text-amber-400'}`}>✕</button>
              </div>
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
              onPrompt={(prompt) => {
                setInput(prompt);
                document.getElementById('chat-input')?.focus();
              }}
              hasProject={isAgenticMode}
              onOpenProject={() => { void createProjectFromFolder(); }}
              creatingProject={creatingProject}
              showModelSetup={ollamaConnected === true && models.length === 0}
              suggestedModels={SUGGESTED_MODELS}
              onPullModel={(name) => { void handlePullModel(name); }}
              pullStatus={pullProgress || null}
              pulling={isPulling}
              systemRamGB={systemMemory ? systemMemory.total_bytes / 1024 ** 3 : null}
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
                 className={`group/msg ${
                 msg.runSummary
                   ? `w-full md:max-w-3xl px-4 py-2.5 rounded-xl border text-sm ${dark ? 'bg-emerald-900/20 border-emerald-800/60 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`
                   : msg.role === 'user'
                   ? `max-w-[85%] md:max-w-xl px-4 py-2.5 rounded-2xl ${dark ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100 text-zinc-900'}`
                   : msg.role === 'tool'
                     ? `w-full md:max-w-3xl p-4 rounded-2xl border-l-2 border-blue-500 ${dark ? 'bg-zinc-800/60 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`
                     : `w-full md:max-w-3xl px-1 py-2 ${dark ? 'text-zinc-100' : 'text-zinc-900'}`
               }`}
                 onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, index: i }); }}
                 // Keyboard path to the message menu (#452): focusable bubble;
                 // Shift+F10 / the ContextMenu key opens it at the bubble.
                 tabIndex={0}
                 onKeyDown={(e) => {
                   if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
                     e.preventDefault();
                     const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                     setContextMenu({ x: r.left + 16, y: r.top + 16, index: i });
                   }
                 }}
               >
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

                {/* Tool call rendering (#549 rank 14): one quiet step row per
                    call — the humanized top argument instead of raw JSON. */}
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="mb-1">
                    {msg.tool_calls.map((toolCall: any, idx: number) => (
                      <div key={idx} className={`text-xs flex items-baseline gap-1.5 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        <span aria-hidden="true">→</span>
                        <span className="font-mono">{toolCallName(toolCall)}</span>
                        <span className={`truncate font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{humanizeToolArgs(toolCall)}</span>
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
                      className={`w-full rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 border ${dark ? 'bg-zinc-700 text-zinc-100 border-zinc-600' : 'bg-white text-zinc-900 border-zinc-300'}`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingIndex(null); if (msg.role === 'assistant') editAssistantMessage(i, editContent); else editMessage(i, editContent); }}
                        className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                      >{msg.role === 'assistant' ? 'Save edit' : 'Send edit'}</button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className={`text-xs px-3 py-1 rounded-lg ${dark ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-200 hover:bg-zinc-300'}`}
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
                        ? (
                          // Collapsed step row (#549 rank 14): a 30-call run
                          // used to be 60+ full-height bubbles of raw output.
                          <details className="group/step">
                            <summary className={`cursor-pointer list-none text-xs flex items-baseline gap-1.5 ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                              <span aria-hidden="true">{TOOL_ERROR_RE.test(msg.content) ? '✗' : '✓'}</span>
                              <span className="font-mono">{msg.name}</span>
                              <span className={dark ? 'text-zinc-600' : 'text-zinc-400'}>
                                {TOOL_ERROR_RE.test(msg.content) ? 'failed — click to inspect' : `${msg.content.length.toLocaleString()} chars — click to inspect`}
                              </span>
                            </summary>
                            <div className="mt-1">
                              <ToolResultBlock name={msg.name} content={msg.content} dark={dark} />
                            </div>
                          </details>
                        )
                        : (() => {
                            // The step row above already names the tool — the
                            // "Calling tool: X" filler text is duplication.
                            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && msg.content.startsWith('Calling tool:')) return null;
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
                {/* Message actions — minimal; everything else lives in the right-click menu (#378) */}
                {msg.role === 'assistant' && msg.content !== '' && !(isLoading && i === messages.length - 1) && (
                  <div className="flex items-center gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
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
                    {/* Regenerate button (#98) */}
                    {!isLoading && (
                      <button
                        onClick={() => regenerateMessage(i)}
                        aria-label="Regenerate response"
                        title="Regenerate (creates a branch)"
                        className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                      >↺</button>
                    )}
                    {/* Edit assistant reply in place (#281) */}
                    <button
                      onClick={() => { setEditingIndex(i); setEditContent(msg.content); }}
                      aria-label="Edit response"
                      title="Edit response"
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >✏</button>
                    {/* Delete this message (#280) */}
                    <button
                      onClick={() => deleteMessage(i)}
                      aria-label="Delete response"
                      title="Delete response"
                      className={`text-xs px-1 rounded transition-colors ${dark ? 'text-zinc-600 hover:text-red-400' : 'text-zinc-400 hover:text-red-600'}`}
                    >🗑</button>
                  </div>
                )}
                {/* Edit button on user messages (#98) */}
                {msg.role === 'user' && !isLoading && editingIndex !== i && (
                  <div className="flex justify-end mt-1 gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingIndex(i); setEditContent(msg.content); }}
                      aria-label="Edit message"
                      title="Edit (creates a branch)"
                      className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200'}`}
                    >✏ Edit</button>
                    <button
                      onClick={() => deleteMessage(i)}
                      aria-label="Delete message"
                      title="Delete message"
                      className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-red-400 hover:bg-zinc-700' : 'text-zinc-400 hover:text-red-600 hover:bg-zinc-200'}`}
                    >🗑 Delete</button>
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

        {/* Ollama disconnected (#549 audit rank 5): visible where the user is
            about to act, with a one-click retry — not just a 2.5px header dot. */}
        {ollamaConnected === false && (
          <div className={`mx-4 mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${dark ? 'bg-red-900/30 border-red-800 text-red-200' : 'bg-red-50 border-red-200 text-red-700'}`} role="status">
            <span>Ollama isn't running — open the Ollama app, then retry. Reconnecting automatically every 30s.</span>
            <button
              onClick={() => { void refreshModels().then(() => showStatusBanner('Connected to Ollama')).catch(() => showStatusBanner('Still no connection — is Ollama running?')); }}
              aria-label="Retry Ollama connection"
              className="ml-3 shrink-0 px-2 py-0.5 rounded border border-current hover:opacity-80"
            >Retry</button>
          </div>
        )}

        {/* Unreachable working folder (#550): warn and offer a picker — the
            app must never crash because a path is gone. */}
        {workspaceWarning && (
          <div className={`mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs border ${dark ? 'bg-amber-900/30 border-amber-800 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-800'}`} role="alert">
            <span className="min-w-0 truncate" title={workspaceWarning}>⚠ {workspaceWarning}</span>
            <button
              onClick={changeSessionWorkingDir}
              aria-label="Choose a new working folder"
              className="shrink-0 px-2 py-0.5 rounded border border-current hover:opacity-80"
            >Choose folder…</button>
          </div>
        )}

        {/* Storage quota warning */}
        {storageWarning && (
          <div className="mx-4 mb-2 flex items-center justify-between rounded-lg bg-amber-900/60 border border-amber-700 px-3 py-2 text-xs text-amber-200">
            <span>⚠️ Chat history is nearly full. Export and delete old conversations to free space.</span>
            <button aria-label="Dismiss storage warning" onClick={() => setStorageWarning(false)} className="ml-3 text-amber-400 hover:text-amber-200">✕</button>
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
          className={`p-4 md:p-6 pb-4 pt-2 shrink-0 rounded-xl transition-colors ${
            isDragOver ? (dark ? 'bg-blue-900/30 ring-2 ring-blue-500' : 'bg-blue-50 ring-2 ring-blue-400') : ''
          }`}
        >
          {/* Agentic mode with no workspace folder open (#482) */}
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

          {/* These chip strips were in-flow children of the composer ROW below,
              which is a horizontal flex container — so they became siblings of
              the textarea and squeezed it sideways instead of stacking above it
              (#531/#538). They live in the surrounding column now. */}
          <div className="max-w-3xl mx-auto">
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
                     <button type="button" aria-label="Remove context block" className="opacity-60 hover:opacity-100" onMouseDown={e => { e.preventDefault(); setPendingContextBlocks(prev => prev.filter((_, j) => j !== i)); }}>×</button>
                   </span>
                 ))}
               </div>
             )}

          </div>

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


             {/* @-mention file autocomplete dropdown (#86/#183) */}
             {atSuggestions.length > 0 && (
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden overflow-y-auto max-h-[min(50vh,20rem)] overscroll-contain z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
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
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden overflow-y-auto max-h-[min(50vh,20rem)] overscroll-contain z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
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

             {/* Slash command autocomplete dropdown (#96) */}
             {commandSuggestions.length > 0 && (
               <div className={`absolute bottom-full mb-1 left-0 right-0 rounded-xl border shadow-lg overflow-hidden overflow-y-auto max-h-[min(50vh,20rem)] overscroll-contain z-10 ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
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
                 // Auto-grow the multi-line composer up to a max height (#259).
                 // The effect keyed on `input` handles programmatic writes (#534).
                 growComposer(e.target);
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
                   const ta = e.currentTarget as HTMLTextAreaElement;
                   const start = ta.selectionStart ?? input.length;
                   const end = ta.selectionEnd ?? input.length;
                   if (e.shiftKey) {
                     const lineStart = input.lastIndexOf('\n', start - 1) + 1;
                     const linePrefix = input.slice(lineStart, start);
                     const stripped = linePrefix.replace(/^ {1,2}/, '');
                     const removed = linePrefix.length - stripped.length;
                     if (removed > 0) {
                       e.preventDefault();
                       const next = input.slice(0, lineStart) + stripped + input.slice(start);
                       setInput(next);
                       setTimeout(() => { ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - removed); }, 0);
                     }
                     // Nothing to outdent: let the browser move focus (#496).
                     // Tab-to-indent used to preventDefault unconditionally, so
                     // neither Tab nor Shift+Tab could ever leave the composer —
                     // a hard keyboard trap. Shift+Tab is now the way out.
                   } else {
                     e.preventDefault();
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
                 // While an IME is composing (CJK, and some accent input), Enter
                 // commits the candidate — it is not a send. Browsers report this
                 // via isComposing / keyCode 229; without the guard the composer
                 // sent a half-converted message and swallowed the commit (#519).
                 if ((e.nativeEvent as KeyboardEvent).isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) {
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
               placeholder={isAgenticMode ? 'Describe the goal for this session…' : 'Message Ollama...'}
               aria-label="Type your message here"
               className={`flex-1 border rounded-xl px-4 py-3 resize-none max-h-40 overflow-y-auto leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                 dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
               }`}
             ></textarea>
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
                     // The button just stopped pulsing and nothing was inserted,
                     // so a denied microphone or a down Whisper server looked
                     // identical to "you said nothing" (#526).
                     console.error('Speech recognition error', e);
                     showStatusBanner(`Dictation failed: ${formatErrorLine(e)}`);
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
          {/* Model switcher — below the composer; local MLX models highlighted (#544) */}
          <div className="max-w-3xl mx-auto flex items-center gap-2 mt-2">
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
              className={`text-xs border rounded-lg px-2 py-1.5 min-w-[8rem] max-w-[16rem] truncate focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
              }`}
            >
              {/* Empty-state placeholder (#438) */}
              {models.length === 0 && presets.length === 0 && connectedModels.length === 0 && (
                <option value="" disabled>
                  {ollamaConnected === false
                    ? 'No models — is Ollama running?'
                    : 'No models — pull one (e.g. ollama pull llama3)'}
                </option>
              )}
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
              {/* MLX-capable models first, grouped and bold, but ONLY when this
                  machine can actually accelerate them (#544). */}
              {mlxModels.length > 0 && (
                <optgroup label="— MLX (recommended) —">
                  {mlxModels.map((m) => (
                    <option key={m.name} value={m.name} style={{ fontWeight: 700 }}>
                      {m.name}{m.parameterSize ? ` · ${m.parameterSize}` : ''}{m.quantization ? ` · ${m.quantization}` : ''}{runningModels.has(m.name) ? ' ●' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherLocalModels.length > 0 && (
                <optgroup label={mlxModels.length > 0 ? '— Local Ollama (other) —' : '— Local Ollama —'}>
                  {otherLocalModels.map((m) => (
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
            {mlxUsable && isMlxModelName(model) && (
              <span
                title="MLX acceleration active — this model uses Apple-Silicon MLX weights"
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${dark ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}
              >⚡ MLX</span>
            )}
            {/* Tool-capability warning (#549 rank 11): agent runs fail with a
                raw 400 on models without tool support — say so up front. */}
            {isAgenticMode && modelCaps?.tools === false && (
              <span
                title="This model doesn't support tool calling — agent runs will fail. Pick a recent instruct model (e.g. qwen2.5, llama3.1)."
                className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${dark ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'}`}
              >⚠ no tool support</span>
            )}
            {models.find(m => m.name === model)?.cloud && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${dark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>⛅ Cloud</span>
            )}
            {/* Autonomy — the one visible agent control (#549 audit rank 1).
                Shown only when a project folder makes the agent active. */}
            {isAgenticMode && (
              <div className={`flex items-center rounded-lg overflow-hidden border shrink-0 ${dark ? 'border-zinc-700' : 'border-zinc-300'}`} role="group" aria-label="Autonomy level">
                {(['plan', 'ask', 'auto'] as AutonomyLevel[]).map(lv => (
                  <button
                    key={lv}
                    aria-pressed={autonomySettings.level === lv}
                    aria-label={`Set autonomy: ${lv}`}
                    title={lv === 'plan' ? 'Plan first, execute after approval' : lv === 'ask' ? 'Confirm each change' : 'Run without interruption'}
                    onClick={() => { const s = { ...autonomySettings, level: lv }; setAutonomySettings(s); saveAutonomySettings(s); }}
                    className={`px-2 py-1 text-[10px] capitalize transition-colors ${autonomySettings.level === lv ? 'bg-blue-600 text-white' : (dark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100')}`}
                  >{lv}</button>
                ))}
              </div>
            )}
            <div className={`ml-auto text-[10px] text-right ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
              {(() => {
                const cost = formatCost(conversationTokens);
                return (
                  <>
                    <span title="Approximate token usage for this conversation (and current draft)">
                      ≈ {formatTokenCount(conversationTokens)} tokens{cost ? ` · ${cost}` : ''}
                    </span>
                    {' · '}
                    <ContextBudget tokens={conversationTokens} numCtx={effectiveNumCtx} dark={dark} />
                  </>
                );
              })()}
            </div>
          </div>

        {/* Settings Overlay */}
        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={settingsModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="settings-title" className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 id="settings-title" className="text-xl font-bold">Settings</h2>
                <button aria-label="Close settings" onClick={() => setIsSettingsOpen(false)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
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

                 {/* Ollama Cloud models (#485) */}
                 <div>
                   <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Ollama Cloud Models</label>
                   <p className={`text-[10px] mb-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                     Sign in once with <code>ollama signin</code>; cloud models are then served through your local Ollama. Models you already have access to are detected automatically — add any others by name here (e.g. <code>gpt-oss:120b-cloud</code>).
                   </p>
                   {customCloudModels.length > 0 && (
                     <div className="space-y-1 mb-2">
                       {customCloudModels.map(name => (
                         <div key={name} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1 border ${dark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-zinc-50'}`}>
                           <span className="flex-1 font-mono truncate">⛅ {name}</span>
                           <button
                             aria-label={`Remove cloud model ${name}`}
                             onClick={() => {
                               const next = customCloudModels.filter(n => n !== name);
                               setCustomCloudModels(next);
                               saveCustomCloudModels(next);
                               void refreshModels().catch(() => {});
                             }}
                             className="shrink-0 text-red-400 hover:text-red-300"
                           >✕</button>
                         </div>
                       ))}
                     </div>
                   )}
                   <div className="flex items-center gap-2">
                     <input
                       type="text"
                       value={newCloudModel}
                       onChange={(e) => setNewCloudModel(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomCloudModel(); } }}
                       placeholder="model-name:tag-cloud"
                       aria-label="Cloud model name"
                       className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-colors ${
                         dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
                       }`}
                     />
                     <button
                       onClick={addCustomCloudModel}
                       disabled={!newCloudModel.trim()}
                       className="shrink-0 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
                     >Add</button>
                   </div>
                   <div className="flex flex-wrap gap-1 mt-2">
                     {SUGGESTED_CLOUD_MODELS.filter(s => !customCloudModels.includes(s)).map(s => (
                       <button
                         key={s}
                         onClick={() => {
                           const next = [...customCloudModels, s];
                           setCustomCloudModels(next);
                           saveCustomCloudModels(next);
                           void refreshModels().catch(() => {});
                         }}
                         className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                           dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'
                         }`}
                       >+ {s}</button>
                     ))}
                   </div>
                 </div>

                 {/* System Prompt */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>System Prompt</label>
                   {/* System prompt presets (#315) */}
                   <div className="flex gap-2 mb-2">
                     <select
                       aria-label="Persona presets"
                       onChange={(e) => {
                         // "Custom (clear)" carries value="" and was swallowed by
                         // a truthiness guard, so the option did nothing (#522).
                         // Distinguish it from the disabled placeholder by index.
                         const idx = e.target.selectedIndex;
                         const isClear = e.target.options[idx]?.textContent === 'Custom (clear)';
                         if (isClear) updateSystemPrompt('');
                         else if (e.target.value) updateSystemPrompt(e.target.value);
                         e.target.selectedIndex = 0;
                       }}
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
                         placeholder={`Auto (${effectiveNumCtx})`}
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
                     Leave the context window blank for automatic sizing from the model's native limit and this machine's memory.
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
                              {/* preventDefault, not just stopPropagation (#536):
                                  <summary>'s activation target is chosen while the
                                  event path is built, before listeners run, so
                                  stopping propagation does not stop the <details>
                                  from toggling — only cancelling the event does. */}
                              <span onClick={e => { e.preventDefault(); e.stopPropagation(); }} title={disabledTools.has(tool.name) ? 'Enable this tool' : 'Disable this tool'}>
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

                {/* Model providers (#123/#493) — one section for every extra endpoint:
                    remote Ollama servers and OpenAI-compatible APIs share the same
                    connections store, so the old separate 'Remote Ollama Servers'
                    section was a second CRUD UI over identical data (#549 rank 15). */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Model providers ({connections.length})</label>
                    <button onClick={() => {
                        if (showAddConnection) { setEditingConnId(null); setNewConn({ name: '', kind: 'openai', baseUrl: '', apiKey: '' }); }
                        setShowAddConnection(v => !v);
                      }}
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
                        <input aria-label="Connection name" placeholder="Name (e.g. LM Studio)" value={newConn.name} onChange={e => setNewConn(v => ({ ...v, name: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      </div>
                      <input aria-label="Connection base URL" placeholder="Base URL (e.g. http://localhost:1234)" value={newConn.baseUrl} onChange={e => setNewConn(v => ({ ...v, baseUrl: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <input aria-label="Connection API key" placeholder="API key / token (optional)" value={newConn.apiKey} onChange={e => setNewConn(v => ({ ...v, apiKey: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <button onClick={() => {
                        if (!newConn.name.trim() || !newConn.baseUrl.trim()) return;
                        if (editingConnId) {
                          // #419: edit an existing connection in place.
                          updateConnection(editingConnId, { name: newConn.name.trim(), kind: newConn.kind, baseUrl: newConn.baseUrl.trim(), apiKey: newConn.apiKey.trim() || undefined });
                        } else {
                          addConnection({ name: newConn.name.trim(), kind: newConn.kind, baseUrl: newConn.baseUrl.trim(), apiKey: newConn.apiKey.trim() || undefined, enabled: true });
                        }
                        const updated = loadConnections();
                        setConnections(updated);
                        fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {});
                        setNewConn({ name: '', kind: 'openai', baseUrl: '', apiKey: '' });
                        setEditingConnId(null);
                        setShowAddConnection(false);
                      }} className="w-full text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">{editingConnId ? 'Update Connection' : 'Add Connection'}</button>
                    </div>
                  )}
                  <div className={`rounded-lg border divide-y overflow-hidden ${dark ? 'border-zinc-700 divide-zinc-700' : 'border-zinc-200 divide-zinc-200'}`}>
                    {connections.length === 0
                      ? <p className={`text-xs px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No extra model providers. Add an OpenAI-compatible endpoint (LM Studio, llama.cpp) or a remote Ollama server.</p>
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
                              <button aria-label={`Edit connection ${conn.name}`} onClick={() => {
                                // #419: load the connection into the form for in-place editing.
                                setNewConn({ name: conn.name, kind: conn.kind, baseUrl: conn.baseUrl, apiKey: conn.apiKey ?? '' });
                                setEditingConnId(conn.id);
                                setShowAddConnection(true);
                              }} className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>Edit</button>
                              <button onClick={() => {
                                const updated = connections.map(c => c.id === conn.id ? { ...c, enabled: !c.enabled } : c);
                                saveConnections(updated); setConnections(updated);
                                fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {});
                              }} className={`text-[10px] px-1.5 py-0.5 rounded border ${conn.enabled ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600') : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}>
                                {conn.enabled ? 'On' : 'Off'}
                              </button>
                              <button aria-label={`Remove connection ${conn.name}`} onClick={() => { if (!window.confirm(`Remove connection "${conn.name}"?`)) return; removeConnection(conn.id); const updated = loadConnections(); setConnections(updated); fetchAllConnectionModels(updated).then(setConnectedModels).catch(() => {}); }}
                                className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-red-400' : 'border-zinc-300 text-red-500'}`}>✕</button>
                            </div>
                          </div>
                        );
                      })
                    }
                  </div>
                  <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Models from extra providers appear in the model selector grouped by provider. For a remote Ollama server pick kind "Ollama"; set its bearer token in the API key field (#493).
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
                          void refreshMcpServers();
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
                                 disabled={authInFlight === server.id}
                                 onClick={async () => {
                                   // The browser round-trip can take minutes. Without an
                                   // in-flight guard the button looked idle, so a second
                                   // click started a SECOND flow — leaking a redirect
                                   // listener and surfacing a stale timeout error long
                                   // after the first attempt had succeeded (#503).
                                   if (authInFlight) return;
                                   setMcpAuthError(null);
                                   setAuthInFlight(server.id);
                                   try {
                                     await performOAuthFlow(server.id, server.url!);
                                     // Persist it — this used to touch React state
                                     // only, so any later setMcpServers(list()) reset
                                     // every badge to unauthenticated (#521).
                                     const authed = { ...server, authenticated: true };
                                     await mcpConfigStore.save(authed);
                                     setMcpServers(prev =>
                                       prev.map(s => s.id === server.id ? { ...s, authenticated: true } : s)
                                     );
                                   } catch (e) {
                                     setMcpAuthError(e instanceof Error ? e.message : 'Auth failed');
                                   } finally {
                                     setAuthInFlight(null);
                                   }
                                 }}
                                 className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                   server.authenticated
                                     ? (dark ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600')
                                     : (dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100')
                                 }`}
                                 title={server.authenticated ? 'Authenticated' : 'Authenticate with OAuth'}
                               >
                                 {authInFlight === server.id ? 'Authorising…' : server.authenticated ? '🔑 auth' : 'Auth'}
                               </button>
                             )}
                             <button
                               aria-label={`Remove MCP server ${server.name}`}
                               title={`Remove ${server.name}`}
                               onClick={async () => {
                                 // This also purges the server's keychain secrets
                                 // and OAuth tokens, so it must be confirmed, and a
                                 // mid-way failure must not leave the row looking
                                 // untouched with no explanation (#525).
                                 if (!window.confirm(
                                   `Remove MCP server "${server.name}"?\n\n` +
                                   `Its tools are unregistered and any stored credentials ` +
                                   `and OAuth tokens for it are deleted.`,
                                 )) return;
                                 try {
                                   const existing = mcpServers.find(s => s.id === server.id);
                                   if (existing) {
                                     unregisterMcpTools(server.id, getRegisteredToolNames(existing));
                                   }
                                   await mcpServerManager.disconnectFromServer(server.id);
                                   await mcpConfigStore.delete(server.id);
                                 } catch (e) {
                                   showStatusBanner(`Could not fully remove "${server.name}": ${formatErrorLine(e)}`);
                                 }
                                 void refreshMcpServers();
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

                {/* Model Presets (#124) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-medium ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Model Presets ({presets.length})</label>
                    <button onClick={() => {
                        // Toggling closed (or opening fresh) clears any in-progress edit (#419).
                        if (showAddPreset) { setEditingPresetId(null); setNewPreset({ name: '', icon: '', systemPrompt: '', temperature: '', numCtx: '' }); }
                        setShowAddPreset(v => !v);
                      }}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}>
                      {showAddPreset ? 'Cancel' : '+ Add'}
                    </button>
                  </div>
                  {showAddPreset && (
                    <div className={`rounded-lg border p-3 mb-2 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                      <div className="flex gap-1.5">
                        <input aria-label="Preset icon" placeholder="Icon (emoji)" value={newPreset.icon} onChange={e => setNewPreset(v => ({ ...v, icon: e.target.value }))}
                          className={`w-14 border rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input aria-label="Preset name" placeholder="Preset name" value={newPreset.name} onChange={e => setNewPreset(v => ({ ...v, name: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      </div>
                      <textarea placeholder="System prompt" rows={2} value={newPreset.systemPrompt} onChange={e => setNewPreset(v => ({ ...v, systemPrompt: e.target.value }))}
                        className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <div className="flex gap-1.5">
                        <input aria-label="Preset temperature" placeholder="Temp (0-1)" value={newPreset.temperature} onChange={e => setNewPreset(v => ({ ...v, temperature: e.target.value }))}
                          className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input aria-label="Preset context window" placeholder="Context window" value={newPreset.numCtx} onChange={e => setNewPreset(v => ({ ...v, numCtx: e.target.value }))}
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
                        if (editingPresetId) {
                          // #419: edit an existing preset in place.
                          updatePreset(editingPresetId, { name: newPreset.name.trim(), icon: newPreset.icon.trim() || undefined, systemPrompt: newPreset.systemPrompt, params });
                        } else {
                          addPreset({ name: newPreset.name.trim(), icon: newPreset.icon.trim() || undefined, baseModel: model, systemPrompt: newPreset.systemPrompt, params, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
                        }
                        setPresets(loadPresets());
                        setNewPreset({ name: '', icon: '', systemPrompt: '', temperature: '', numCtx: '' });
                        setEditingPresetId(null);
                        setShowAddPreset(false);
                      }} className="w-full text-xs py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">{editingPresetId ? 'Update Preset' : 'Save Preset'}</button>
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
                          <button aria-label={`Edit preset ${p.name}`} onClick={() => {
                            // #419: load the preset into the form for in-place editing.
                            setNewPreset({
                              name: p.name,
                              icon: p.icon ?? '',
                              systemPrompt: p.systemPrompt ?? '',
                              temperature: p.params?.temperature != null ? String(p.params.temperature) : '',
                              numCtx: p.params?.num_ctx != null ? String(p.params.num_ctx) : '',
                            });
                            setEditingPresetId(p.id);
                            setShowAddPreset(true);
                          }} className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>Edit</button>
                          <button aria-label={`Remove preset ${p.name}`} onClick={() => { if (!window.confirm(`Remove preset "${p.name}"?`)) return; removePreset(p.id); setPresets(loadPresets()); if (activePresetId === p.id) { setActivePresetId(null); } }}
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

                {/* User-defined slash commands (#96) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Custom Slash Commands ({userCommands.length})</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    {userCommands.map(cmd => (
                      <div key={cmd.name} className="flex items-center gap-1.5">
                        <span className={`font-mono text-xs ${dark ? 'text-blue-400' : 'text-blue-600'}`}>/{cmd.name}</span>
                        <span className={`flex-1 text-xs truncate ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>{cmd.description}</span>
                        <button aria-label={`Edit command /${cmd.name}`} onClick={() => {
                          // #419: load the command into the form for in-place editing.
                          setNewCmd({ name: cmd.name, description: cmd.description, template: cmd.template ?? '' });
                          setEditingCmdName(cmd.name);
                        }} className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>Edit</button>
                        <button aria-label={`Remove command /${cmd.name}`} onClick={() => { if (!window.confirm(`Remove command /${cmd.name}?`)) return; removeUserCommand(cmd.name); setUserCommands(loadUserCommands()); if (editingCmdName === cmd.name) { setEditingCmdName(null); setNewCmd({ name: '', description: '', template: '' }); } }} className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-400 hover:text-red-500'}`}>✕</button>
                      </div>
                    ))}
                    <div className="flex gap-1.5 pt-1">
                      <input aria-label="Command name" placeholder="name" value={newCmd.name} onChange={e => setNewCmd(v => ({ ...v, name: e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() }))}
                        className={`w-24 border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <input aria-label="Command description" placeholder="description" value={newCmd.description} onChange={e => setNewCmd(v => ({ ...v, description: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    </div>
                    <input aria-label="Command template" placeholder="Template — use $ARGUMENTS or $1 $2 for substitution" value={newCmd.template} onChange={e => setNewCmd(v => ({ ...v, template: e.target.value }))}
                      className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          if (!newCmd.name || !newCmd.description || !newCmd.template) return;
                          if (editingCmdName) {
                            // #419: edit an existing command in place (supports rename).
                            updateUserCommand(editingCmdName, { name: newCmd.name, description: newCmd.description, template: newCmd.template });
                          } else {
                            addUserCommand({ name: newCmd.name, description: newCmd.description, template: newCmd.template });
                          }
                          setUserCommands(loadUserCommands());
                          setNewCmd({ name: '', description: '', template: '' });
                          setEditingCmdName(null);
                        }}
                        className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                      >{editingCmdName ? 'Update Command' : '+ Add Command'}</button>
                      {editingCmdName && (
                        <button
                          onClick={() => { setEditingCmdName(null); setNewCmd({ name: '', description: '', template: '' }); }}
                          className={`text-xs px-3 py-1 rounded border ${dark ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}
                        >Cancel</button>
                      )}
                    </div>
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
                        <button aria-label="Remove memory entry" onClick={() => { removeMemoryEntry(e.id); setMemoryEntries(loadMemory()); }} className="shrink-0 text-red-400 hover:text-red-300">✕</button>
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

                {/* Knowledge Collections (#117/#188) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Knowledge Collections</label>
                  <p className={`text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>Create document collections for RAG-based context injection. Reference them with <span className="font-mono">#collection-name</span> in the chat.</p>
                  <div className="space-y-1 mb-3 max-h-52 overflow-y-auto">
                    {knowledgeCollections.map(col => (
                      <div key={col.id} className={`rounded-lg border overflow-hidden ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                        {/* The row was a plain <div onClick>: no role, no tabIndex
                            and no key handler, so a keyboard user could never
                            expand a collection and therefore could not add or
                            remove any of its files (#512). It is a button now. */}
                        <div className={`flex items-center gap-2 px-2 py-1.5 text-xs select-none ${dark ? 'bg-zinc-800 hover:bg-zinc-700/50' : 'bg-white hover:bg-zinc-50'}`}>
                          <button
                            type="button"
                            aria-expanded={expandedCollection === col.id}
                            aria-label={`${expandedCollection === col.id ? 'Collapse' : 'Expand'} collection ${col.name}`}
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
                            className="flex-1 min-w-0 flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                          >
                            <span className="opacity-50">{expandedCollection === col.id ? '▼' : '▶'}</span>
                            <span className={`flex-1 truncate font-medium ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{col.name}</span>
                            <span className={`opacity-50 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{new Date(col.updatedAt).toLocaleDateString()}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete collection ${col.name}`}
                            onClick={async () => {
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
                                    aria-label={`Remove file ${f.name}`}
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

                {/* General (#549 rank 13: compaction is always on now, sized to
                    the effective context window — its toggle and threshold are
                    gone; the misfiled general toggles keep their home here) */}
                <div className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>General</label>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Resume last conversation on startup</span>
                    <Toggle checked={resumeLastSession} onChange={() => { const v = !resumeLastSession; setResumeLastSession(v); safeSetItem('ollama_gui_resume_last_session', JSON.stringify(v)); }} dark={dark} label="Resume last conversation on startup" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Send on Ctrl+Enter (Enter = newline)</span>
                    <Toggle checked={sendOnCtrlEnter} onChange={() => { const v = !sendOnCtrlEnter; setSendOnCtrlEnter(v); safeSetItem('ollama_gui_send_on_ctrl_enter', JSON.stringify(v)); }} dark={dark} label="Toggle send on Ctrl+Enter" />
                  </div>
                </div>

                {/* Advanced — expert builders, collapsed by default (#549 rank 15).
                    Content stays mounted so label-based queries keep working. */}
                <details className={`rounded-xl border ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                  <summary className={`cursor-pointer select-none px-4 py-3 text-sm font-medium ${dark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-800'}`}>Advanced</summary>
                  <div className="px-4 pb-4 space-y-6">
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
                        <input aria-label="Tool name" placeholder="Tool name (alphanumeric, _)" value={newCustomTool.name} onChange={e => setNewCustomTool(v => ({ ...v, name: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <input aria-label="Tool description" placeholder="Description" value={newCustomTool.description} onChange={e => setNewCustomTool(v => ({ ...v, description: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <textarea placeholder='Parameters JSON: {"key":{"type":"string","description":"desc"}}' rows={2} value={newCustomTool.paramsJson} onChange={e => setNewCustomTool(v => ({ ...v, paramsJson: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        <textarea placeholder="JS body — use params.x to access parameters. Must return/resolve a value." rows={3} value={newCustomTool.code} onChange={e => setNewCustomTool(v => ({ ...v, code: e.target.value }))}
                          className={`w-full border rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none resize-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                        {customToolError && (
                          <p role="alert" className="text-[10px] text-red-400">⚠️ {customToolError}</p>
                        )}
                        <button onClick={() => {
                          const name = newCustomTool.name.trim();
                          // Previously: a blank name returned silently, a malformed
                          // params JSON was swallowed by `catch {}` and saved the tool
                          // with ZERO parameters (#516), and a duplicate name collided
                          // on one registry key so deleting either killed both (#517).
                          if (!name) { setCustomToolError('Enter a tool name.'); return; }
                          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                            setCustomToolError('Tool names may contain only letters, digits and underscores, and cannot start with a digit.');
                            return;
                          }
                          if (customTools.some(t => t.name === name)) {
                            setCustomToolError(`A tool named "${name}" already exists — pick another name.`);
                            return;
                          }
                          let props: Record<string, { type: string; description: string }> = {};
                          const raw = newCustomTool.paramsJson.trim();
                          if (raw) {
                            try {
                              const parsed = JSON.parse(raw);
                              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                                setCustomToolError('Parameters JSON must be an object, e.g. {"input":{"type":"string","description":"…"}}.');
                                return;
                              }
                              props = parsed;
                            } catch (e) {
                              setCustomToolError(`Parameters JSON is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
                              return;
                            }
                          }
                          setCustomToolError(null);
                          addCustomTool({ name, description: newCustomTool.description.trim(), parameters: { type: 'object', properties: props }, code: newCustomTool.code, enabled: true });
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
                            <button aria-label={`Remove tool ${t.name}`} onClick={() => { if (!window.confirm(`Remove tool "${t.name}"?`)) return; removeCustomTool(t.id); setCustomTools(loadCustomTools()); }}
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
                          <input aria-label="Function name" placeholder="Name" value={newFunction.name} onChange={e => setNewFunction(v => ({ ...v, name: e.target.value }))}
                            className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                          {newFunction.kind === 'filter' && (
                            <input aria-label="Function priority" placeholder="Priority" value={newFunction.priority} onChange={e => setNewFunction(v => ({ ...v, priority: e.target.value }))}
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
                            <button aria-label={`Remove function ${f.name}`} onClick={() => { if (!window.confirm(`Remove function "${f.name}"?`)) return; removeFunctionDef(f.id); setFunctionDefs(loadFunctionDefs()); }}
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

                {/* Modelfile Builder (#125) */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Create Model (Modelfile)</label>
                  <div className={`rounded-lg border p-3 space-y-2 ${dark ? 'border-zinc-700 bg-zinc-900/30' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="flex gap-1.5">
                      <input aria-label="New model name" placeholder="New model name (e.g. my-assistant:latest)" value={modelfileFields.name} onChange={e => {
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
                      <input aria-label="Modelfile temperature" placeholder="Temperature" value={modelfileFields.temperature} onChange={e => setModelfileFields(v => ({ ...v, temperature: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                      <input aria-label="Modelfile context window" placeholder="num_ctx" value={modelfileFields.numCtx} onChange={e => setModelfileFields(v => ({ ...v, numCtx: e.target.value }))}
                        className={`flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`} />
                    </div>
                    {modelfilePreview && (
                      <div className={`rounded border p-2 text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-auto ${dark ? 'bg-zinc-900 border-zinc-700 text-zinc-400' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                        {modelfilePreview}
                      </div>
                    )}
                    {(modelfileError || modelfileProgress) && (
                      <p role={modelfileError ? 'alert' : undefined} className={`text-xs ${modelfileError ? 'text-red-400' : 'text-green-400'}`}>
                        {/* Render the error, not just the progress text (#528).
                            The catch path clears modelfileProgress, so this
                            paragraph used to go blank and every failure —
                            including "Enter a model name" — was invisible. */}
                        {modelfileError || modelfileProgress}
                      </p>
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
                          // "16k" used to parse to 16 and any non-numeric text
                          // emitted `PARAMETER temperature NaN` into the Modelfile
                          // (#520). Reject rather than silently mangling.
                          const tempRaw = modelfileFields.temperature.trim();
                          const ctxRaw = modelfileFields.numCtx.trim();
                          const temperature = tempRaw ? Number(tempRaw) : undefined;
                          const numCtx = ctxRaw ? Number(ctxRaw) : undefined;
                          if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
                            setModelfileError('Temperature must be a number between 0 and 2.');
                            return;
                          }
                          if (numCtx !== undefined && (!Number.isInteger(numCtx) || numCtx <= 0)) {
                            setModelfileError('Context window (num_ctx) must be a positive whole number — e.g. 16384, not "16k".');
                            return;
                          }
                          const mf = assembleModelfile({ from: model, system: modelfileFields.system || undefined, temperature, numCtx });
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
                          // A failed spec fetch used to be swallowed while the
                          // server stayed in the list with a green status dot, so a
                          // broken server looked healthy and its tools silently never
                          // appeared (#522).
                          registerOpenApiServer(cfg).catch((e) => {
                            showStatusBanner(`OpenAPI server "${cfg.name}": ${formatErrorLine(e)}`);
                            const disabled = { ...cfg, enabled: false };
                            setOpenApiServers(prev => {
                              const next = prev.map(x => x.id === cfg.id ? disabled : x);
                              saveOpenApiServers(next);
                              return next;
                            });
                          });
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
                          onChange={e => {
                            // An empty/non-numeric field used to persist NaN,
                            // which permanently broke dictation (#500).
                            const secs = parseInt(e.target.value, 10);
                            if (!Number.isFinite(secs)) return;
                            const clamped = Math.min(600, Math.max(1, secs));
                            const cfg = { ...sttConfig, maxDurationMs: clamped * 1000 };
                            setSttConfig(cfg); saveSttConfig(cfg);
                          }}
                          className={`w-24 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                        />
                      </div>
                      <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Run <span className="font-mono">./server --port 8080</span> from whisper.cpp. A 🎙 button appears in the chat composer to record and transcribe.
                      </p>
                    </div>
                  )}
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
                          aria-label={`Delete secret ${r.key}`}
                          onClick={async () => {
                            // The value is masked and unrecoverable, so an
                            // accidental click destroyed a credential the user
                            // could not even read back (#523).
                            if (!window.confirm(
                              `Delete secret "${r.key}" from ${r.service}?\n\n` +
                              `This removes it from the OS keychain and cannot be undone.`,
                            )) return;
                            try {
                              await secretDelete(r.service, r.key);
                            } catch (e) {
                              showStatusBanner(`Could not delete secret: ${formatErrorLine(e)}`);
                            }
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
                  </div>
                </details>

                 {/* Privacy & data — secure cleanup (#38). Deliberately the last section:
                     the destructive control sits at the very bottom of Settings. */}
                 <div>
                   <label className={`block text-sm font-medium mb-2 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>Privacy &amp; data</label>
                   <button
                     onClick={() => {
                       // Typed confirmation (#549 rank 15): confirm() made the most
                       // destructive action in the app a single misclick away.
                       const typed = window.prompt('Securely erase ALL local data (chats, settings, MCP servers)? This cannot be undone.\n\nType ERASE to confirm:');
                       if (typed !== 'ERASE') return;
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={promptPreviewModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Composed system prompt preview" className={`border w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
              <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                <h2 className="text-lg font-bold">Composed System Prompt</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(promptPreview); showStatusBanner('Copied to clipboard'); }}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium ${dark ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'}`}
                  >Copy</button>
                  <button aria-label="Close prompt preview" onClick={() => setPromptPreview(null)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={helpModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="help-title" className={`border w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl ${
              dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
            }`}>
              <div className="flex justify-between items-center mb-6">
                <h2 id="help-title" className="text-xl font-bold">Keyboard Shortcuts</h2>
                <button aria-label="Close keyboard shortcuts" onClick={() => setShowHelp(false)} className={dark ? 'text-zinc-400 hover:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900'}>✕</button>
              </div>
              <div className="space-y-1">
                {[
                  ['New Chat', 'Ctrl+K'],
                  ['Command Palette', 'Ctrl+P'],
                  ['Find in Chat', 'Ctrl+F'],
                  ['Toggle Sidebar', 'Ctrl+\\'],
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
            className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm border ${
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
              ref={bulkDeleteModalRef}
              tabIndex={-1}
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
          onClose={() => setShowLoOnboarding(false)}
        />
        {/* CLI Command Approval Modal */}
        {pendingApproval && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={cliApprovalModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Command approval required" className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${
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
                    cliAllowlist.add(commandBinary(pendingApproval.command));
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={toolApprovalModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Agent tool-use approval" className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={planApprovalModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Approve plan to begin execution" className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}>
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

        {/* Right-click context menu on sidebar project rows (#549 rank 10) */}
        {projectContextMenu && (() => {
          const proj = projects.find(p => p.id === projectContextMenu.projectId);
          if (!proj) { setProjectContextMenu(null); return null; }
          const items: ContextMenuItem[] = [
            { label: 'New chat', onSelect: () => { setExpandedProjects(prev => new Set(prev).add(proj.id)); startNewChat(proj.id); } },
            { label: 'Rename', onSelect: () => { setRenamingProjectId(proj.id); setProjectRenameDraft(proj.name); } },
            // Project config lives ON the project now (#549 rank 12) — the
            // Settings Projects section is gone.
            { label: 'Add folder…', onSelect: () => {
              void pickDirectory().then(dir => {
                if (!dir) { showStatusBanner('No folder selected'); return; }
                const roots = projectRoots(proj);
                if (roots.includes(dir)) { showStatusBanner('That folder is already part of this project'); return; }
                const next = [...roots, dir];
                storage.saveProject({ ...proj, workspaceRoot: next[0], workspaceRoots: next });
                setProjects(storage.getProjects());
                if (activeProjectId === proj.id) {
                  void openWorkspaceRoots(next);
                  registerGitTools(next[0]);
                }
                showStatusBanner(`Added folder to "${proj.name}"`);
                // Proactive backend check (#550): warn on a missing/non-dir
                // pick but keep it — it may be a temporarily unmounted volume.
                void checkPath(dir).then(check => {
                  if (check && (!check.exists || !check.isDir)) {
                    showStatusBanner(check.exists
                      ? `Warning: "${dir}" is not a folder`
                      : `Warning: "${dir}" does not exist (unmounted volume?)`);
                  }
                });
              });
            } },
            ...(projectRoots(proj).length > 1 ? [{
              label: 'Remove folder…',
              onSelect: () => {
                const roots = projectRoots(proj);
                const pick = window.prompt(
                  `Remove which folder from "${proj.name}"? (the first is primary and stays)\n` +
                  roots.map((r, i) => `${i + 1}. ${r}`).join('\n'),
                  String(roots.length),
                );
                const idx = pick ? parseInt(pick, 10) - 1 : -1;
                if (idx === 0) { showStatusBanner('The primary folder cannot be removed'); return; }
                if (idx < 1 || idx >= roots.length) return;
                const next = roots.filter((_, i) => i !== idx);
                storage.saveProject({ ...proj, workspaceRoot: next[0], workspaceRoots: next });
                setProjects(storage.getProjects());
                if (activeProjectId === proj.id) { void openWorkspaceRoots(next); registerGitTools(next[0]); }
              },
            }] : []),
            { label: 'Instructions…', onSelect: () => {
              const next = window.prompt(`Instructions for "${proj.name}" (prepended to the system prompt):`, proj.instructions ?? '');
              if (next === null) return;
              storage.saveProject({ ...proj, instructions: next });
              setProjects(storage.getProjects());
            } },
            { label: proj.model === model ? 'Default model: current ✓' : `Set default model: ${model}`, onSelect: () => {
              storage.saveProject({ ...proj, model });
              setProjects(storage.getProjects());
              showStatusBanner(`"${proj.name}" now defaults to ${model}`);
            } },
            { label: 'Delete', onSelect: () => deleteProject(proj.id, proj.name) },
          ];
          return <ContextMenu x={projectContextMenu.x} y={projectContextMenu.y} items={items} onClose={() => setProjectContextMenu(null)} dark={dark} />;
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
