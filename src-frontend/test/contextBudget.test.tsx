import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBudget } from '../App';

describe('ContextBudget (#242)', () => {
  it('renders the percentage and a fill bar', () => {
    const { container } = render(<ContextBudget tokens={2048} numCtx={4096} dark={true} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByLabelText('Context usage 50 percent')).toBeInTheDocument();
    const fill = container.querySelector('.h-full');
    expect(fill).toHaveStyle({ width: '50%' });
  });

  it('uses the 4096 default when numCtx is unset', () => {
    render(<ContextBudget tokens={4096} numCtx={undefined} dark={false} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('clamps above 100%', () => {
    render(<ContextBudget tokens={9999} numCtx={4096} dark={true} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('color-codes green under 70%, amber 70-89%, red at 90%+', () => {
    const { container, rerender } = render(<ContextBudget tokens={1000} numCtx={4096} dark={true} />);
    expect(container.querySelector('.h-full')).toHaveClass('bg-emerald-500');
    rerender(<ContextBudget tokens={3000} numCtx={4096} dark={true} />);
    expect(container.querySelector('.h-full')).toHaveClass('bg-amber-500');
    rerender(<ContextBudget tokens={3800} numCtx={4096} dark={true} />);
    expect(container.querySelector('.h-full')).toHaveClass('bg-red-500');
  });
});
