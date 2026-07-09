import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffReviewModal } from '../components/DiffReviewModal';
import type { PendingEdit } from '../services/diffReview';

const edit: PendingEdit = {
  id: 'e1',
  path: 'src/app.ts',
  kind: 'apply_edit',
  oldString: 'a\nb\nc\nd\ne',
  newString: 'a\nB\nc\nD\ne',
  createdAt: 1,
};

describe('DiffReviewModal — per-hunk accept/reject (#254)', () => {
  it('renders the modal with the file path and two hunks', () => {
    render(<DiffReviewModal edit={edit} dark={true} onResolve={() => {}} />);
    expect(screen.getByRole('dialog', { name: /Review file edit/i })).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getByLabelText('Reject hunk 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Reject hunk 2')).toBeInTheDocument();
  });

  it('Accept with all hunks accepted resolves with mergedNewString equal to the full after', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={false} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Accept'));
    expect(onResolve).toHaveBeenCalledTimes(1);
    const decision = onResolve.mock.calls[0][0];
    expect(decision.accepted).toBe(true);
    expect(decision.mergedNewString).toBe('a\nB\nc\nD\ne');
  });

  it('toggling a hunk to rejected and accepting applies only the accepted hunk', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={true} onResolve={onResolve} />);
    // Reject hunk 2 (keep original d)
    fireEvent.click(screen.getByLabelText('Reject hunk 2'));
    fireEvent.click(screen.getByText('Accept'));
    const decision = onResolve.mock.calls[0][0];
    expect(decision.accepted).toBe(true);
    expect(decision.mergedNewString).toBe('a\nB\nc\nd\ne');
  });

  it('rejecting all hunks then accepting resolves with the original before content', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={true} onResolve={onResolve} />);
    fireEvent.click(screen.getByLabelText('Reject hunk 1'));
    fireEvent.click(screen.getByLabelText('Reject hunk 2'));
    fireEvent.click(screen.getByText('Accept'));
    const decision = onResolve.mock.calls[0][0];
    expect(decision.mergedNewString).toBe('a\nb\nc\nd\ne');
  });

  it('the "Accept all / Reject all hunks" toggle flips every hunk', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={false} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Reject all hunks'));
    fireEvent.click(screen.getByText('Accept'));
    expect(onResolve.mock.calls[0][0].mergedNewString).toBe('a\nb\nc\nd\ne');
  });

  it('Reject resolves with accepted=false and no merged content', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={true} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Reject'));
    const decision = onResolve.mock.calls[0][0];
    expect(decision.accepted).toBe(false);
    expect(decision.mergedNewString).toBeUndefined();
  });

  it('write_file edits render the full content and Accept resolves without mergedNewString', () => {
    const onResolve = vi.fn();
    const wf: PendingEdit = { id: 'w1', path: 'new.txt', kind: 'write_file', newString: 'hello\nworld', createdAt: 1 };
    render(<DiffReviewModal edit={wf} dark={true} onResolve={onResolve} />);
    expect(screen.getByText(/hello/).textContent).toContain('world');
    fireEvent.click(screen.getByText('Accept'));
    const decision = onResolve.mock.calls[0][0];
    expect(decision.accepted).toBe(true);
    expect(decision.mergedNewString).toBeUndefined();
  });

  it('a hunk toggle updates aria-pressed to reflect state', () => {
    render(<DiffReviewModal edit={edit} dark={true} onResolve={() => {}} />);
    const hunk1 = screen.getByLabelText('Reject hunk 1');
    expect(hunk1).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hunk1);
    expect(screen.getByLabelText('Accept hunk 1')).toHaveAttribute('aria-pressed', 'false');
  });
});


describe('DiffReviewModal keyboard shortcuts (#362)', () => {
  it('Enter accepts the edit', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={false} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].accepted).toBe(true);
    expect(onResolve.mock.calls[0][0].mergedNewString).toBe('a\nB\nc\nD\ne');
  });

  it('Escape rejects the edit', () => {
    const onResolve = vi.fn();
    render(<DiffReviewModal edit={edit} dark={true} onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].accepted).toBe(false);
  });

});
