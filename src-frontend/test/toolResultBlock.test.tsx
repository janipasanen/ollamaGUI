import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolResultBlock } from '../App';

describe('ToolResultBlock (#240)', () => {
  it('renders a collapsible block with the tool name and a success status, expanded for short content', () => {
    const { container } = render(<ToolResultBlock name="git_status" content="staged: []\nunstaged: [a.ts]" dark={true} />);
    expect(screen.getByText('git_status')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool success')).toBeInTheDocument();
    const details = container.querySelector('details')!;
    expect(details).toHaveAttribute('open');
    expect(container.textContent).toContain('a.ts');
  });

  it('shows an error status when the content starts with "Error" or "Tool blocked"', () => {
    const { rerender } = render(<ToolResultBlock name="run_terminal" content="Error: binary not found" dark={false} />);
    expect(screen.getByLabelText('Tool error')).toBeInTheDocument();
    rerender(<ToolResultBlock name="apply_edit" content="Tool blocked: user denied approval" dark={false} />);
    expect(screen.getByLabelText('Tool error')).toBeInTheDocument();
  });

  it('collapses long content by default and expands on click', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = render(<ToolResultBlock name="browser_snapshot" content={long} dark={true} />);
    const details = container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    // Collapsed <details> still keeps content in the DOM but hidden; assert the
    // summary preview is shown and the body is not visually open.
    expect(details.querySelector('summary')).toBeInTheDocument();
    fireEvent.click(details.querySelector('summary')!);
    expect(details).toHaveAttribute('open');
    expect(container.textContent).toContain('line 30');
  });

  it('falls back to a "tool" label when no name is provided', () => {
    render(<ToolResultBlock content="ok" dark={true} />);
    expect(screen.getByText('tool')).toBeInTheDocument();
  });
});
