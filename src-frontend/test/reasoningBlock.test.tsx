import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningBlock } from '../App';

describe('ReasoningBlock (#241)', () => {
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
});
