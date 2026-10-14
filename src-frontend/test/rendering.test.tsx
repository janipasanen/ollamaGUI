import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import mermaid from 'mermaid';
import { MarkdownMessage } from '../App';

// mermaid is lazy-imported inside the component; mock it so render is deterministic.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => ({ svg: `<svg class="mmd">${code}</svg>` })),
  },
}));

describe('MarkdownMessage rendering (#135)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a ```mermaid block as a diagram', async () => {
    const { container } = render(<MarkdownMessage dark={false} content={'```mermaid\ngraph TD; A-->B\n```'} />);
    await waitFor(() => expect(container.querySelector('svg.mmd')).toBeTruthy());
    expect(mermaid.render).toHaveBeenCalled();
  });

  it('falls back to raw code when mermaid fails to parse', async () => {
    (mermaid.render as any).mockRejectedValueOnce(new Error('parse error'));
    const { container } = render(<MarkdownMessage dark={false} content={'```mermaid\nNOT VALID DIAGRAM\n```'} />);
    await waitFor(() => expect(container.textContent).toContain('NOT VALID DIAGRAM'));
    expect(container.querySelector('svg.mmd')).toBeFalsy();
  });

  it('renders $inline$ and $$block$$ LaTeX via KaTeX', () => {
    const { container } = render(<MarkdownMessage dark={false} content={'$E=mc^2$ and $$\\int_0^1 x\\,dx$$'} />);
    expect(container.querySelector('.katex')).toBeTruthy();
  });

  it('renders non-mermaid code with the syntax highlighter (language label + Copy)', () => {
    render(<MarkdownMessage dark={false} content={'```python\nprint(1)\n```'} />);
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});

// react-markdown v10 no longer passes an `inline` prop to the code renderer;
// inline vs block is decided by className/newline instead.
describe('Inline vs fenced code (react-markdown v10, no inline prop)', () => {
  it('renders single-backtick inline code as a plain <code>, without CodeBlock chrome', () => {
    const { container } = render(
      <MarkdownMessage dark={false} content={'Run the `npm install` command to begin.'} />
    );
    const codeEl = container.querySelector('p code');
    expect(codeEl).toBeTruthy();
    expect(codeEl!.textContent).toBe('npm install');
    // No CodeBlock chrome: no buttons (Copy/Wrap/Apply) and no block wrapper.
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('p div')).toBeNull();
  });

  it('still renders fenced code as a CodeBlock with its copy button', () => {
    render(<MarkdownMessage dark={false} content={'```js\nconst a = 1;\n```'} />);
    expect(screen.getByText('js')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('treats a fenced block without a language as block code (newline heuristic)', () => {
    render(<MarkdownMessage dark={false} content={'```\nplain block\n```'} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument(); // fallback lang label
  });
});

// The `components` map handed to ReactMarkdown is memoized; fresh renderer
// identities on every render used to make React remount each CodeBlock,
// wiping its local state (copied/expanded/applied) whenever App re-rendered.
describe('CodeBlock state survives parent re-renders (memoized components map)', () => {
  it('keeps the copied state and DOM node across an unrelated parent re-render', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const md = '```js\nconst a = 1;\n```';
    const Wrapper = ({ tick }: { tick: number }) => (
      <div data-tick={tick}>
        <MarkdownMessage dark={false} content={md} />
      </div>
    );
    const { rerender } = render(<Wrapper tick={0} />);
    const copyBtn = screen.getByText('Copy');
    fireEvent.click(copyBtn);
    const copied = await screen.findByText('Copied!');
    rerender(<Wrapper tick={1} />);
    // State survived (no remount) and the exact DOM node is still attached.
    expect(screen.getByText('Copied!')).toBe(copied);
    expect(document.body.contains(copied)).toBe(true);
  });

  it('keeps the expanded state of a long code block across a parent re-render', async () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
    const md = '```python\n' + longCode + '\n```';
    const Wrapper = ({ tick }: { tick: number }) => (
      <div data-tick={tick}>
        <MarkdownMessage dark={false} content={md} />
      </div>
    );
    const { rerender } = render(<Wrapper tick={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    rerender(<Wrapper tick={1} />);
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});
