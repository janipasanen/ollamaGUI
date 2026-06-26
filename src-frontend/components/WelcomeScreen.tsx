import React from "react";

export interface WelcomeScreenProps {
  dark: boolean;
  onPrompt: (text: string) => void;
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
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ dark, onPrompt }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className={`mb-6 text-4xl ${dark ? "text-zinc-400" : "text-zinc-500"}`}>🦙</div>
      <h2 className={`text-xl font-semibold mb-2 ${dark ? "text-zinc-200" : "text-zinc-800"}`}>
        What can I help you with today?
      </h2>
      <p className={`max-w-md mb-8 text-sm ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
        Start a conversation with your local AI, or pick a starter prompt below.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-md">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPrompt(prompt)}
            className={`text-left px-4 py-3 rounded-lg text-sm transition-colors border ${
              dark
                ? "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50"
            }`}
            aria-label={`Use starter prompt: ${prompt}`}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default WelcomeScreen;
