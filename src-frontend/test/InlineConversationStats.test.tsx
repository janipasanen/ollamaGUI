import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineConversationStats } from '../components/InlineConversationStats';
import type { ConversationStats } from '../services/conversationStats';

const stats: ConversationStats = { totalMessages: 12, userMessages: 6, assistantMessages: 6, words: 100, characters: 800, tokens: 256 };

describe('InlineConversationStats', () => {
  it('renders the total message count with an aria-label', () => {
    render(<InlineConversationStats stats={stats} dark={false} />);
    expect(screen.getByText('12 msg')).toBeInTheDocument();
    expect(screen.getByLabelText('Conversation: 12 messages')).toBeInTheDocument();
  });

  it('returns null (renders nothing) when stats is null', () => {
    const { container } = render(<InlineConversationStats stats={null} dark={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('returns null when there are no messages', () => {
    const { container } = render(<InlineConversationStats stats={{ ...stats, totalMessages: 0 }} dark={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('toggles aria-expanded on click', () => {
    render(<InlineConversationStats stats={stats} dark={false} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
