import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('App Component', () => {
  it('renders the main chat interface', () => {
    render(<App />);
    // The "Ollama GUI" h1 is gone — the rail now starts with the "+ New"
    // button and the composer is the centerpiece.
    expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Message Ollama\.\.\./i)).toBeInTheDocument();
  });

  it('toggles sidebar with Ctrl+\\', () => {
    render(<App />);

    // The rail is open by default on desktop; anchor on the sidebar search
    // input since the "Ollama GUI" heading no longer exists.
    const sidebar = screen.getByLabelText('Search conversations').closest('div.transition-all');
    expect(sidebar).not.toHaveClass('w-0');

    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });

    // After collapse the sidebar container has w-0
    expect(sidebar).toHaveClass('w-0');
  });

  it('opens settings overlay when settings button is clicked', () => {
    render(<App />);
    const settingsButton = screen.getByRole('button', { name: /⚙️ Settings/i });

    fireEvent.click(settingsButton);
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
  });

  it('updates input value when typing', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);

    fireEvent.change(input, { target: { value: 'Hello AI' } });
    expect(input).toHaveValue('Hello AI');
  });

  // M5 feature tests
  it('shows search input in sidebar', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/Search conversations/i)).toBeInTheDocument();
  });

  it('exposes export and import of all chats via the command palette', () => {
    // The sidebar Export/Import buttons are gone — the feature moved to the
    // command palette ("Export All Chats (JSON)" / "Import Chats (JSON)").
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Command palette search'), { target: { value: 'Chats (JSON)' } });
    expect(screen.getByText('Export All Chats (JSON)')).toBeInTheDocument();
    expect(screen.getByText('Import Chats (JSON)')).toBeInTheDocument();
  });

  it('shows attach button in input area', () => {
    render(<App />);
    expect(screen.getByTitle(/Attach image/i)).toBeInTheDocument();
  });

  it('shows endpoint config in settings overlay', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(screen.getByText(/Ollama Endpoint/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/http:\/\/localhost:11434/i)).toBeInTheDocument();
  });

  describe('Welcome screen', () => {
    it('fills the composer when a welcome starter prompt is clicked', () => {
      render(<App />);
      fireEvent.click(screen.getByText(/Explain quantum computing in simple terms/i));
      expect(screen.getByPlaceholderText(/Message Ollama/i)).toHaveValue('Explain quantum computing in simple terms');
    });

    it('shows the welcome screen on a fresh chat', () => {
      render(<App />);
      expect(screen.getByText(/What can I help you with today\?/i)).toBeInTheDocument();
    });
  });

  describe('Chat scroll behavior', () => {
    it('shows a scroll-to-bottom button when scrolled up', () => {
      render(<App />);
      const container = screen.getByTestId('messages-container');
      if (!container) throw new Error('messages container not found');
      // Simulate scrolled-up container
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
      container.scrollTop = 100;
      fireEvent.scroll(container);
      expect(screen.getByLabelText(/Scroll to bottom/i)).toBeInTheDocument();
    });

    it('hides the scroll-to-bottom button when near the bottom', () => {
      render(<App />);
      const container = screen.getByTestId('messages-container');
      if (!container) throw new Error('messages container not found');
      Object.defineProperty(container, 'scrollHeight', { value: 400, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
      container.scrollTop = 80;
      fireEvent.scroll(container);
      expect(screen.queryByLabelText(/Scroll to bottom/i)).not.toBeInTheDocument();
    });
 
    it('scrolls to bottom and hides the button when clicked', () => {
      const scrollIntoView = vi.fn();
      vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
      render(<App />);
      const container = screen.getByTestId('messages-container');
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
      container.scrollTop = 100;
      fireEvent.scroll(container);
      const button = screen.getByLabelText(/Scroll to bottom/i);
      fireEvent.click(button);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(screen.queryByLabelText(/Scroll to bottom/i)).not.toBeInTheDocument();
      vi.restoreAllMocks();
    });
  });

  describe('Delete chat confirmation', () => {
    function createSampleSession() {
      const data = JSON.stringify([
        { id: 's1', title: 'Sample Chat', messages: [], createdAt: Date.now(), model: 'llama3', tags: [], pinned: false, archived: false },
      ]);
      localStorage.setItem('ollama_gui_sessions', data);
    }

    it('opens a confirmation dialog before deleting a chat', () => {
      createSampleSession();
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Delete session: Sample Chat/i }));
      expect(screen.getByRole('dialog', { name: /Delete chat confirmation/i })).toBeInTheDocument();
      expect(screen.getByText(/Delete chat\?/i)).toBeInTheDocument();
    });

    it('cancels deletion when the cancel button is clicked', () => {
      createSampleSession();
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Delete session: Sample Chat/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
      expect(screen.queryByRole('dialog', { name: /Delete chat confirmation/i })).not.toBeInTheDocument();
    });

    it('removes the session when deletion is confirmed', () => {
      createSampleSession();
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Delete session: Sample Chat/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
      expect(screen.queryByRole('dialog', { name: /Delete chat confirmation/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete session: Sample Chat/i })).not.toBeInTheDocument();
    });

    it('closes on Escape (#202)', () => {
      createSampleSession();
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Delete session: Sample Chat/i }));
      expect(screen.getByRole('dialog', { name: /Delete chat confirmation/i })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: /Delete chat confirmation/i })).not.toBeInTheDocument();
    });

    it('closes when the backdrop is clicked (#202)', () => {
      createSampleSession();
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /Delete session: Sample Chat/i }));
      fireEvent.click(screen.getByRole('dialog', { name: /Delete chat confirmation/i }));
      expect(screen.queryByRole('dialog', { name: /Delete chat confirmation/i })).not.toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('Cmd/Ctrl+K should start new chat', () => {
      render(<App />);
      const initialMessages = screen.queryAllByRole('listitem');

      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      const updatedMessages = screen.queryAllByRole('listitem');
      expect(updatedMessages.length).toBeLessThanOrEqual(initialMessages.length);
    });

    it('Cmd/Ctrl+, should toggle settings', () => {
      render(<App />);

      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();

      fireEvent.keyDown(window, { key: ',', metaKey: true });
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: ',', metaKey: true });
      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    });

    it('Cmd/Ctrl+\\ should toggle sidebar', () => {
      render(<App />);

      // No "History" heading any more — anchor on the sidebar search input.
      const sidebar = screen.getByLabelText('Search conversations').closest('div.transition-all');
      expect(sidebar).not.toHaveClass('w-0');

      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      expect(sidebar).toHaveClass('w-0');

      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      expect(sidebar).not.toHaveClass('w-0');
    });

    it('Escape should close settings when open', () => {
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    });

    it('shortcuts should not trigger when typing in input', () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);

      input.focus();
      fireEvent.keyDown(input, { key: 'k', metaKey: true });
      fireEvent.keyDown(input, { key: ',', metaKey: true });

      expect(document.activeElement).toBe(input);
    });

    it('help button shows keyboard shortcuts', () => {
      render(<App />);

      expect(screen.queryByRole('heading', { name: /Keyboard Shortcuts/i })).not.toBeInTheDocument();

      // The header no longer carries a help button (#546); "?" still opens it.
      fireEvent.keyDown(window, { key: '?' });

      expect(screen.getByRole('heading', { name: /Keyboard Shortcuts/i })).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+K/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+\\/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+,/i)).toBeInTheDocument();
    });

    it('responsive design handles different screen sizes', () => {
      render(<App />);

      // Initially should have desktop layout: "+ New" button and Settings.
      expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /⚙️ Settings/i })).toBeInTheDocument();

      const sidebar = screen.getByLabelText('Search conversations').closest('div.transition-all');
      expect(sidebar).not.toHaveClass('w-0');

      // Simulate mobile viewport
      global.innerWidth = 600;
      fireEvent.resize(window);

      // On mobile, sidebar should be collapsed by default
      expect(sidebar).toHaveClass('w-0');

      // Crossing back to desktop width REOPENS the rail automatically (#545).
      global.innerWidth = 1024;
      fireEvent.resize(window);
      expect(sidebar).not.toHaveClass('w-0');
    });
  });
});

  // ── Toggle ARIA state (#234) ──────────────────────────────────────────────────
  describe('Toggle ARIA state (#234)', () => {
    // The responsive-design test above shrinks the viewport and never restores
    // it, so reset to a desktop width before each test here.
    beforeEach(() => {
      global.innerWidth = 1024;
    });

    // The header panel-toggle buttons (browser/terminal/files/…) were removed
    // with the docked panels themselves, so their aria-pressed test is gone.

    it('agentic-mode switch exposes role=switch and aria-checked', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      const sw = screen.getByRole('switch', { name: 'Toggle tool calling' });
      expect(sw).toHaveAttribute('aria-checked', 'false');
    });

    it('autonomy level buttons expose aria-pressed for the active level', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      // Default autonomy level is 'ask' (#88).
      const askBtn = screen.getAllByRole('button').find(b => b.textContent === 'ask');
      expect(askBtn).toBeTruthy();
      expect(askBtn!.getAttribute('aria-pressed')).toBe('true');
      const planBtn = screen.getAllByRole('button').find(b => b.textContent === 'plan');
      expect(planBtn!.getAttribute('aria-pressed')).toBe('false');
    });
  });

  // ── Settings input accessible names (#237) ───────────────────────────────────
  describe('Settings input accessible names (#237)', () => {
    beforeEach(() => {
      global.innerWidth = 1024;
    });

    it('system prompt textarea has an accessible name', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      expect(screen.getByLabelText(/System prompt/i)).toBeInTheDocument();
    });

    it('num_ctx and temperature inputs have accessible names', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      expect(screen.getByLabelText('Context window (num_ctx)')).toBeInTheDocument();
      expect(screen.getByLabelText('Temperature')).toBeInTheDocument();
    });

    it('model-pull input has an accessible name', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      expect(screen.getByLabelText(/Model name to pull/i)).toBeInTheDocument();
    });
  });
