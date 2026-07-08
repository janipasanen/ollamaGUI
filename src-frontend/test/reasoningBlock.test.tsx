import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningBlock } from '../App';

describe('ReasoningBlock (#241 / #246)', () => {
  it('renders nothing when reasoning is blank', () => {
    const { container } = render(<ReasoningBlock reasoning="   " dark={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a collapsible Thinking block with the reasoning text', () => {
    const { container } = render(<ReasoningBlock reasoning="I should consider X then Y." dark={false} />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(container.textContent).toContain('I should consider X then Y.');
  });

  it('is collapsible: reasoning text remains in DOM and the details toggles open', () => {
    const { container } = render(<ReasoningBlock reasoning="step by step" dark={true} />);
    const details = container.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(container.textContent).toContain('step by step');
  });

  it('renders a fenced code block as a CodeBlock with a Copy button (#246)', () => {
    const reasoning = 'Let me check the code:\n```ts\nconst x = 42;\n```\nDone.';
    const { container } = render(<ReasoningBlock reasoning={reasoning} dark={true} />);
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(container.textContent).toContain('const x = 42;');
  });

  it('renders a markdown list as <ul>/<li> markup, not raw dashes (#246)', () => {
    const reasoning = 'Options:\n- alpha\n- beta\n- gamma';
    const { container } = render(<ReasoningBlock reasoning={reasoning} dark={false} />);
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).toContain('gamma');
  });
});
