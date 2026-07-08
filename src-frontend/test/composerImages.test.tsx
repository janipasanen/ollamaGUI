import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// Synchronous FileReader stub so drop/paste handlers attach a data URL immediately.
class MockFileReader {
  result: string | null = null;
  onload: ((ev: any) => void) | null = null;
  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,AAAA`;
    // Fire onload asynchronously to match real FileReader semantics.
    setTimeout(() => this.onload?.({ target: { result: this.result } }), 0);
  }
}

let originalFileReader: any;
beforeEach(() => {
  originalFileReader = (global as any).FileReader;
  (global as any).FileReader = MockFileReader;
});
afterEach(() => {
  (global as any).FileReader = originalFileReader;
  vi.restoreAllMocks();
});

describe('Composer drag-and-drop + paste image attachment (#250)', () => {
  it('dropping an image file onto the composer attaches it as a thumbnail', async () => {
    render(<App />);
    const dropzone = screen.getByTestId('composer-dropzone');
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getAllByAltText('pending attachment').length).toBe(1));
  });

  it('dropping a non-image file does not attach anything', () => {
    render(<App />);
    const dropzone = screen.getByTestId('composer-dropzone');
    const file = new File(['data'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(screen.queryAllByAltText('pending attachment')).toHaveLength(0);
  });

  it('drag-over sets a highlighted drop state and drag-leave clears it', () => {
    render(<App />);
    const dropzone = screen.getByTestId('composer-dropzone');
    fireEvent.dragOver(dropzone, { dataTransfer: { files: [] } });
    // highlighted state adds a ring class
    expect(dropzone.className).toMatch(/ring-blue/);
    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toMatch(/ring-blue/);
  });

  it('pasting an image from the clipboard attaches it', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
    const file = new File(['data'], 'clip.png', { type: 'image/png' });
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    });
    await waitFor(() => expect(screen.getAllByAltText('pending attachment').length).toBe(1));
  });

  it('pasting text only does not attach an image', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    });
    expect(screen.queryAllByAltText('pending attachment')).toHaveLength(0);
  });
});
