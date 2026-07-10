import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffReviewBatchModal } from '../components/DiffReviewBatchModal';
import type { PendingEdit } from '../services/diffReview';

const edits: PendingEdit[] = [
  { id: 'e1', path: 'a.ts', kind: 'apply_edit', oldString: 'foo', newString: 'bar', createdAt: 1 },
  { id: 'e2', path: 'b.ts', kind: 'write_file', newString: 'new file', createdAt: 2 },
  { id: 'e3', path: 'c.ts', kind: 'apply_edit', oldString: 'x', newString: 'y', createdAt: 3 },
];

describe('DiffReviewBatchModal (#400)', () => {
  it('renders one review listing every file path', () => {
    render(<DiffReviewBatchModal edits={edits} dark={true} onResolve={() => {}} />);
    expect(screen.getByRole('dialog', { name: /Review 3 file edits/i })).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getByText('c.ts')).toBeInTheDocument();
  });

  it('Apply resolves with all files accepted by default', () => {
    const onResolve = vi.fn();
    render(<DiffReviewBatchModal edits={edits} dark={false} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    const decisions = onResolve.mock.calls[0][0];
    expect(decisions.map((d: any) => d.accepted)).toEqual([true, true, true]);
  });

  it('Reject resolves with all files rejected', () => {
    const onResolve = vi.fn();
    render(<DiffReviewBatchModal edits={edits} dark={true} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Reject'));
    const decisions = onResolve.mock.calls[0][0];
    expect(decisions.map((d: any) => d.accepted)).toEqual([false, false, false]);
  });

  it('Reject all files link marks every file rejected, then Apply reflects it', () => {
    const onResolve = vi.fn();
    render(<DiffReviewBatchModal edits={edits} dark={true} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Reject all files'));
    fireEvent.click(screen.getByText('Apply'));
    const decisions = onResolve.mock.calls[0][0];
    expect(decisions.map((d: any) => d.accepted)).toEqual([false, false, false]);
  });

  it('toggling a single file off rejects only that file on Apply', () => {
    const onResolve = vi.fn();
    render(<DiffReviewBatchModal edits={edits} dark={false} onResolve={onResolve} />);
    // The middle file's per-file switch.
    fireEvent.click(screen.getByLabelText('accept b.ts'));
    fireEvent.click(screen.getByText('Apply'));
    const decisions = onResolve.mock.calls[0][0];
    expect(decisions.map((d: any) => d.accepted)).toEqual([true, false, true]);
  });

  it('Escape rejects all', () => {
    const onResolve = vi.fn();
    render(<DiffReviewBatchModal edits={edits} dark={true} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    const decisions = onResolve.mock.calls[0][0];
    expect(decisions.map((d: any) => d.accepted)).toEqual([false, false, false]);
  });
});
