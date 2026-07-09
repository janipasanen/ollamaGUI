import React from "react";

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

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className={`mb-6 text-4xl ${dark ? "text-zinc-400" : "text-zinc-500"}`}>🦙</div>
      <h2 className={`text-xl font-semibold mb-2 ${dark ? "text-zinc-200" : "text-zinc-800"}`}>
        What can I help you with today?
      </h2>
      <p className={`max-w-md mb-8 text-sm ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
        {custom.length > 0
          ? "Pick one of your saved prompts, or start a conversation with your local AI."
          : "Start a conversation with your local AI, or pick a starter prompt below."}
      </p>
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
