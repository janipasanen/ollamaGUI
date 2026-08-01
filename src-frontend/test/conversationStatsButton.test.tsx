import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationStatsButton } from '../components/ConversationStatsButton';
import type { ConversationStats } from '../services/conversationStats';

const stats: ConversationStats = {
  totalMessages: 4,
  userMessages: 2,
  assistantMessages: 2,
  words: 42,
  characters: 260,
  tokens: 70,
};

describe('ConversationStatsButton (#262)', () => {
  it('renders nothing when there are no messages', () => {
    const { container } = render(<ConversationStatsButton stats={{ ...stats, totalMessages: 0 }} dark={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a stats dialog on click showing counts', () => {
    render(<ConversationStatsButton stats={stats} dark={false} />);
    const btn = screen.getByRole('button', { name: 'Conversation statistics' });
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog', { name: 'Conversation statistics' });
    expect(dialog).toHaveTextContent('Messages');
    expect(dialog).toHaveTextContent('4');
    expect(dialog).toHaveTextContent('User / Assistant');
    expect(dialog).toHaveTextContent('2 / 2');
    expect(dialog).toHaveTextContent('Words');
    expect(dialog).toHaveTextContent('42');
    expect(dialog).toHaveTextContent('Characters');
    expect(dialog).toHaveTextContent('260');
    expect(dialog).toHaveTextContent('Est. tokens');
  });

  // The popover is portaled and dismisses on an outside press (#487); it no
  // longer paints a full-screen backdrop element to catch the click.
  it('closes the dialog when clicking outside it', () => {
    render(<ConversationStatsButton stats={stats} dark={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation statistics' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog on Escape', () => {
    render(<ConversationStatsButton stats={stats} dark={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation statistics' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
