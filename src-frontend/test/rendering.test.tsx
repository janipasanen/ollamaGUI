import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
