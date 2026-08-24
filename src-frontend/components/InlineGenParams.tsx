/**
 * Inline generation parameters display (#547).
 * Shows key generation options compactly in the header area.
 */

import React from 'react';
import type { GenerationOptions } from '../services/ollama';

interface Props {
  model: string;
  genOptions: GenerationOptions;
  dark: boolean;
}

export const InlineGenParams: React.FC<Props> = ({ model, genOptions, dark }) => {
  // Truncate long model names
  const modelName = model.length > 25 ? `${model.slice(0, 23)}…` : model;

  return (
    <div className="flex items-center gap-3 text-[10px]">
      {/* Model name */}
      <span
        className={`font-medium truncate max-w-[150px] ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}
        title={model}
      >
        {modelName}
      </span>

      {/* Temperature */}
      {genOptions.temperature !== undefined && genOptions.temperature !== null && (
        <span className={`whitespace-nowrap ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          temp: {genOptions.temperature}
        </span>
      )}

      {/* Context window usage */}
      {genOptions.num_ctx && genOptions.num_ctx > 0 && (
        <div className="flex items-center gap-1" title={`Context: ${genOptions.num_ctx} tokens`}>
          <span className="text-[9px]">Ctx</span>
          <div
            className={`w-24 h-1 rounded-full overflow-hidden ${
              dark ? 'bg-zinc-700' : 'bg-zinc-200'
            }`}
          >
            <div className={`h-full ${dark ? 'bg-emerald-500' : 'bg-emerald-500'}`} style={{ width: '40%' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default InlineGenParams;
