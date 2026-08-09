import React from "react";
import type { SuggestedModel } from "../services/ollama";

export interface WelcomeScreenProps {
  dark: boolean;
  onPrompt: (text: string) => void;
  /** True when a project (with folder) is already active — hides the CTA. */
  hasProject?: boolean;
  /** Creates a project from a folder — the ONE folder concept (#549 rank 6). */
  onOpenProject?: () => void;
  creatingProject?: boolean;
  /** Zero-models first run (#549 rank 4): offer one-click downloads inline. */
  showModelSetup?: boolean;
  suggestedModels?: SuggestedModel[];
  onPullModel?: (name: string) => void;
  pullStatus?: string | null;
  pulling?: boolean;
  /** Total system RAM in GB, when known — used to mark models that fit. */
  systemRamGB?: number | null;
}

// Goal-shaped starters for project work (#549 rank 6) — the app's journey is
// "state a goal, let it run", so the examples must model that.
const PROJECT_PROMPTS = [
  "Summarize this codebase: what it does and how it's structured",
  "Find and fix one real bug, then run the tests to prove it",
  "Add tests for the most important untested code",
  "Write a concise README for this project",
];

const CHAT_PROMPTS = [
  "Explain quantum computing in simple terms",
  "Write a Python function to reverse a string",
];

/**
 * Empty-state welcome surface shown when a chat has no messages yet.
 * First-run priorities in order: get a model (if none), get a project folder
 * (if none), then state a goal.
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  dark, onPrompt,
  hasProject, onOpenProject, creatingProject,
  showModelSetup, suggestedModels, onPullModel, pullStatus, pulling,
  systemRamGB,
}) => {
  const starters = hasProject ? PROJECT_PROMPTS : CHAT_PROMPTS;
  const items: { label: string; body: string }[] =
    starters.map(p => ({ label: p, body: p }));

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className={`mb-6 text-4xl ${dark ? "text-zinc-400" : "text-zinc-500"}`}>🦙</div>
      <h2 className={`text-xl font-semibold mb-2 ${dark ? "text-zinc-200" : "text-zinc-800"}`}>
        {hasProject ? "What should we get done?" : "What can I help you with today?"}
      </h2>
      <p className={`max-w-md mb-6 text-sm ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
        {hasProject
          ? "Describe the goal for this session — the agent works in your project folder until it's reached."
          : "Open a project folder to work on code, or just start chatting."}
      </p>

      {/* Zero-models first run (#549 rank 4): the old dead-end told GUI users
          to run `ollama pull` in a terminal. Download is one click now. */}
      {showModelSetup && (
        <div className="w-full max-w-md mb-8" data-testid="welcome-model-setup">
          <p className={`text-sm font-medium mb-2 ${dark ? "text-zinc-200" : "text-zinc-700"}`}>
            First, download a model:
          </p>
          <div className="flex flex-col gap-1.5">
            {(suggestedModels ?? []).slice(0, 4).map(m => {
              const fits = systemRamGB == null || systemRamGB >= m.minRamGB;
              return (
                <button
                  key={m.name}
                  onClick={() => onPullModel?.(m.name)}
                  disabled={pulling}
                  aria-label={`Download model ${m.label}`}
                  className={`flex items-baseline gap-2 text-left px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50 ${
                    dark ? "bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-200" : "bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700"
                  }`}
                >
                  <span className="font-medium">{m.label}</span>
                  <span className={`text-xs ${dark ? "text-zinc-500" : "text-zinc-400"}`}>{m.sizeGB} GB{m.recommended ? " · recommended" : ""}{!fits ? " · needs more RAM" : ""}</span>
                </button>
              );
            })}
          </div>
          {pullStatus && (
            <p role="status" className={`mt-2 text-xs ${dark ? "text-zinc-400" : "text-zinc-500"}`}>{pullStatus}</p>
          )}
        </div>
      )}

      {/* Project-folder onboarding — one concept: the folder IS the project
          (#549 rank 6). Hidden once a project is active. */}
      {!hasProject && !showModelSetup && (
        <div className="w-full max-w-md mb-8">
          <button
            onClick={() => onOpenProject?.()}
            disabled={creatingProject}
            className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition-colors"
          >
            {creatingProject ? "Opening…" : "📁  Open a project folder"}
          </button>
          <p className={`mt-2 text-xs ${dark ? "text-zinc-500" : "text-zinc-400"}`}>
            The folder becomes a project in the sidebar, and the agent can read, search, and edit the code inside it.
          </p>
        </div>
      )}

      {!showModelSetup && (
        <div className="flex flex-col gap-3 w-full max-w-md">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => onPrompt(item.body)}
              className={`text-left px-4 py-3 rounded-lg text-sm transition-colors border ${
                dark
                  ? "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                  : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
              aria-label={`Use starter prompt: ${item.label}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default WelcomeScreen;
