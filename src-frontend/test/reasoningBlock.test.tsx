import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningBlock } from '../App';

/**
 * #659 turned the block into a controlled disclosure (collapsed by default,
 * toggled by a "Show thinking" / "Hide thinking" button) instead of the native
 * <details> triangle, so the collapsed body is unmounted rather than merely
 * hidden. These tests follow that contract.
 */
describe('ReasoningBlock (#241 / #246 / #659)', () => {
  it('renders nothing when reasoning is blank', () => {
    const { container } = render(<ReasoningBlock reasoning="   " dark={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when show is false', () => {
    const { container } = render(<ReasoningBlock reasoning="hidden trace" dark={false} show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a collapsible Thinking block with the reasoning text', () => {
    const { container } = render(<ReasoningBlock reasoning="I should consider X then Y." dark={false} />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(container.textContent).not.toContain('I should consider X then Y.');
    fireEvent.click(screen.getByRole('button', { name: 'Show thinking' }));
    expect(container.textContent).toContain('I should consider X then Y.');
  });

  it('is collapsible: the disclosure toggles the reasoning text', () => {
    const { container } = render(<ReasoningBlock reasoning="step by step" dark={true} />);
    const collapsed = screen.getByRole('button', { name: 'Show thinking' });
    expect(collapsed).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(collapsed);
    expect(container.textContent).toContain('step by step');

    const expanded = screen.getByRole('button', { name: 'Hide thinking' });
    expect(expanded).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(expanded);
    expect(container.textContent).not.toContain('step by step');
  });

  it('renders the trace immediately when collapsedByDefault is false', () => {
    const { container } = render(
      <ReasoningBlock reasoning="visible right away" dark={true} collapsedByDefault={false} />,
    );
    expect(container.textContent).toContain('visible right away');
    expect(screen.getByRole('button', { name: 'Hide thinking' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders a fenced code block as a CodeBlock with a Copy button (#246)', () => {
    const reasoning = 'Let me check the code:\n```ts\nconst x = 42;\n```\nDone.';
    const { container } = render(
      <ReasoningBlock reasoning={reasoning} dark={true} collapsedByDefault={false} />,
    );
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(container.textContent).toContain('const x = 42;');
  });

  it('renders a markdown list as <ul>/<li> markup, not raw dashes (#246)', () => {
    const reasoning = 'Options:\n- alpha\n- beta\n- gamma';
    const { container } = render(
      <ReasoningBlock reasoning={reasoning} dark={false} collapsedByDefault={false} />,
    );
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).toContain('gamma');
  });
});
