import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanPanel from '../components/PlanPanel';
import type { PlanItem } from '../services/planStore';

describe('PlanPanel (#239)', () => {
  it('renders nothing when the plan is empty', () => {
    const { container } = render(<PlanPanel plan={[]} dark={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a checklist with status icons and a progress count', () => {
    const plan: PlanItem[] = [
      { step: 'Read file', status: 'completed' },
      { step: 'Edit file', status: 'in_progress' },
      { step: 'Verify', status: 'pending' },
    ];
    render(<PlanPanel plan={plan} dark={false} />);
    expect(screen.getByRole('heading', { name: /Plan/i })).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('Read file')).toHaveClass('line-through');
    expect(screen.getByText('Edit file')).toBeInTheDocument();
    expect(screen.getByText('Verify')).toBeInTheDocument();
    // Status icons exposed via aria-label
    expect(screen.getByLabelText('Completed')).toBeInTheDocument();
    expect(screen.getByLabelText('In progress')).toBeInTheDocument();
    expect(screen.getByLabelText('Pending')).toBeInTheDocument();
  });

  it('clears the plan when the clear button is clicked', () => {
    const onClear = vi.fn();
    render(<PlanPanel plan={[{ step: 'A', status: 'pending' }]} dark={true} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear plan/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
