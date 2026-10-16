import { render, screen, act } from '@testing-library/react';
import { ReasoningBlock } from '../App';
import {
  loadShowThinking, saveShowThinking,
  loadThinkingCollapsedByDefault, saveThinkingCollapsedByDefault,
} from '../services/thinking';

describe('ReasoningBlock reasoning disclosure (#659)', () => {
  it('is collapsed by default and can be expanded with an affordance', () => {
    render(<ReasoningBlock reasoning="Because." dark={false} collapsedByDefault />);
    const button = screen.getByRole('button', { expanded: false });
    expect(button).toBeTruthy();
    // The affordance label advertises the expand action.
    expect(button.getAttribute('aria-label')).toBe('Show thinking');
    // Clicking it opens the disclosure.
    act(() => { button.click(); });
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('stays expanded when not collapsed by default', () => {
    render(<ReasoningBlock reasoning="Because." dark={false} collapsedByDefault={false} />);
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('renders nothing when thinking is disabled', () => {
    render(<ReasoningBlock reasoning="Because." dark={false} show={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when there is no reasoning', () => {
    render(<ReasoningBlock reasoning="   " dark={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('thinking preference persistence (#659)', () => {
  it('defaults to thinking-on and collapsed-by-default', () => {
    // localStorage is empty in jsdom.
    expect(loadShowThinking()).toBe(true);
    expect(loadThinkingCollapsedByDefault()).toBe(true);
  });

  it('persists the show-thinking choice', () => {
    saveShowThinking(false);
    expect(loadShowThinking()).toBe(false);
    saveShowThinking(true);
    expect(loadShowThinking()).toBe(true);
  });

  it('persists the collapsed-by-default choice', () => {
    saveThinkingCollapsedByDefault(false);
    expect(loadThinkingCollapsedByDefault()).toBe(false);
    saveThinkingCollapsedByDefault(true);
    expect(loadThinkingCollapsedByDefault()).toBe(true);
  });
});
