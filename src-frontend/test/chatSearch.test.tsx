import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatSearch, findMessageMatches } from '../components/ChatSearch';

describe('findMessageMatches (#247)', () => {
  const msgs = [
    { role: 'user', content: 'Hello world' },
    { role: 'assistant', content: 'Hi there', reasoning: 'world reasoning' },
    { role: 'user', content: 'bye' },
  ];

  it('returns indices of messages whose content or reasoning contains the query (case-insensitive)', () => {
    expect(findMessageMatches(msgs, 'world')).toEqual([0, 1]);
    expect(findMessageMatches(msgs, 'WORLD')).toEqual([0, 1]);
    expect(findMessageMatches(msgs, 'bye')).toEqual([2]);
  });

  it('returns no matches for empty/whitespace queries', () => {
    expect(findMessageMatches(msgs, '')).toEqual([]);
    expect(findMessageMatches(msgs, '   ')).toEqual([]);
  });

  it('matches reasoning text even when content does not contain the query', () => {
    expect(findMessageMatches(msgs, 'reasoning')).toEqual([1]);
  });
});

describe('ChatSearch component (#247)', () => {
  it('renders the search bar, focuses the input, and shows match count', () => {
    render(
      <ChatSearch
        query="foo"
        onQueryChange={() => {}}
        matchCount={3}
        currentIndex={1}
        onPrev={() => {}}
        onNext={() => {}}
        onClose={() => {}}
        dark={true}
      />,
    );
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search query')).toHaveFocus();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('shows 0 / 0 when there are no matches but a query is typed', () => {
    render(
      <ChatSearch query="zzz" onQueryChange={() => {}} matchCount={0} currentIndex={-1}
        onPrev={() => {}} onNext={() => {}} onClose={() => {}} dark={false} />,
    );
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });

  it('disables prev/next when there are no matches', () => {
    render(
      <ChatSearch query="zzz" onQueryChange={() => {}} matchCount={0} currentIndex={-1}
        onPrev={() => {}} onNext={() => {}} onClose={() => {}} dark={true} />,
    );
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
  });

  it('Enter triggers next, Shift+Enter triggers prev, Escape closes', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onClose = vi.fn();
    render(
      <ChatSearch query="a" onQueryChange={() => {}} matchCount={2} currentIndex={0}
        onPrev={onPrev} onNext={onNext} onClose={onClose} dark={true} />,
    );
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('typing calls onQueryChange', () => {
    const onQueryChange = vi.fn();
    render(
      <ChatSearch query="" onQueryChange={onQueryChange} matchCount={0} currentIndex={-1}
        onPrev={() => {}} onNext={() => {}} onClose={() => {}} dark={true} />,
    );
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'hello' } });
    expect(onQueryChange).toHaveBeenCalledWith('hello');
  });
});
