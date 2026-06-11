/**
 * LibreOfficeOnboarding modal (#145).
 *
 * Explains the OPTIONAL LibreOffice conversion engine and offers three actions:
 *   • Detect existing install — probe the host for a `soffice` binary.
 *   • Open download page — send the user to libreoffice.org.
 *   • Dismiss — never ask again (persisted via services/libreOfficeOnboarding).
 *
 * Styled like the CLI approval modal in App.tsx: a fixed inset overlay with a
 * centered card, themed purely through the `dark` ternary convention. Renders
 * null when `open` is false so it can sit unconditionally in the tree.
 */

import React from 'react';

export interface LibreOfficeOnboardingProps {
  open: boolean;
  dark: boolean;
  /** Probe the host for an existing LibreOffice install. */
  onDetect: () => void;
  /** Open the LibreOffice download page (in the OS browser). */
  onOpenDownload: () => void;
  /** Dismiss the prompt for good. */
  onDismiss: () => void;
}

export default function LibreOfficeOnboarding({
  open,
  dark,
  onDetect,
  onOpenDownload,
  onDismiss,
}: LibreOfficeOnboardingProps) {
  if (!open) return null;

  return (
    <div
      data-testid="libreoffice-onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="LibreOffice engine onboarding"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div
        className={`border w-full max-w-lg rounded-2xl p-6 shadow-2xl ${
          dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>📄</span> Optional: LibreOffice engine
          </h2>
        </div>

        <p className={`text-sm mb-3 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          Some document conversions — presentations (pptx/odp) and PDFs rendered
          from Word documents — use LibreOffice as a local engine. It is
          completely optional: everything else works without it.
        </p>
        <p className={`text-xs mb-5 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          Detect an existing install, download LibreOffice, or dismiss this prompt.
          Nothing is sent anywhere — conversion runs entirely on your machine.
        </p>

        <div className="flex gap-2 justify-end flex-wrap">
          <button
            onClick={onDismiss}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-700'
            }`}
          >
            Dismiss
          </button>
          <button
            onClick={onOpenDownload}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              dark ? 'border-blue-600 text-blue-400 hover:bg-blue-600/20' : 'border-blue-500 text-blue-600 hover:bg-blue-50'
            }`}
          >
            Open download page
          </button>
          <button
            onClick={onDetect}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            Detect existing install
          </button>
        </div>
      </div>
    </div>
  );
}
