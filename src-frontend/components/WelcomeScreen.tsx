import React from "react";
import { useWorkspacePicker } from "./useWorkspacePicker";

export interface WelcomePrompt {
  name: string;
  body: string;
}

export interface WelcomeScreenProps {
  dark: boolean;
  onPrompt: (text: string) => void;
  /** User-saved prompts from the prompt library (#358). */
  prompts?: WelcomePrompt[];
}

const STARTER_PROMPTS = [
  "Explain quantum computing in simple terms",
  "Write a Python function to reverse a string",
  "Summarize the latest AI news",
  "Help me debug a TypeScript error",
];

/**
 * Empty-state welcome surface shown when a chat has no messages yet.
 * Offers clickable starter prompts so the user can begin without typing.
 * When the user has saved prompts in their prompt library, those are shown
 * instead of the hardcoded starters (#358).
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ dark, onPrompt, prompts }) => {
  const custom = (prompts ?? []).filter(p => p.body && p.body.trim());
  const items: { label: string; body: string }[] =
    custom.length > 0
      ? custom.slice(0, 6).map(p => ({ label: p.name, body: p.body }))
      : STARTER_PROMPTS.map(p => ({ label: p, body: p }));

  // Project-folder onboarding (#479): pointing the app at a source tree is the
  // first thing anyone doing development work needs, so it belongs on the
  // empty-state screen rather than only inside the (closed-by-default) files panel.
  const ws = useWorkspacePicker();

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className={`mb-6 text-4xl ${dark ? "text-zinc-400" : "text-zinc-500"}`}>🦙</div>
      <h2 className={`text-xl font-semibold mb-2 ${dark ? "text-zinc-200" : "text-zinc-800"}`}>
        What can I help you with today?
      </h2>
      <p className={`max-w-md mb-6 text-sm ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
        {custom.length > 0
          ? "Pick one of your saved prompts, or start a conversation with your local AI."
          : "Start a conversation with your local AI, or pick a starter prompt below."}
      </p>

      {/* Workspace folder (#479) */}
      <div className="w-full max-w-md mb-8">
        {ws.root ? (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
              dark ? "bg-zinc-800 border-zinc-700" : "bg-white border-zinc-200"
            }`}
          >
            <span aria-hidden="true">📁</span>
            <span
              className={`flex-1 truncate text-left font-medium ${dark ? "text-zinc-200" : "text-zinc-700"}`}
              title={ws.root}
            >
              {ws.label}
            </span>
            <button
              onClick={() => { void ws.choose(); }}
              disabled={ws.picking}
              className={`shrink-0 text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                dark ? "text-zinc-400 hover:bg-zinc-700" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => { void ws.choose(); }}
              disabled={ws.picking}
              className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition-colors"
            >
              {ws.picking ? "Opening…" : "📁  Open project folder"}
            </button>
            <p className={`mt-2 text-xs ${dark ? "text-zinc-500" : "text-zinc-400"}`}>
              Give the AI access to a folder so it can read, search, and edit your code.
            </p>
            {ws.recentRoots.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                <span className={`text-[10px] uppercase tracking-wide text-left ${dark ? "text-zinc-500" : "text-zinc-400"}`}>
                  Recent
                </span>
                {ws.recentRoots.slice(0, 3).map(r => (
                  <button
                    key={r}
                    onClick={() => { void ws.openPath(r); }}
                    title={r}
                    className={`text-left text-xs px-2 py-1 rounded truncate transition-colors ${
                      dark ? "text-zinc-400 hover:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
    </div>
  );
};

export default WelcomeScreen;
