import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WelcomeScreen from '../components/WelcomeScreen';

describe('WelcomeScreen', () => {
  it('renders title and starter prompts', () => {
    render(<WelcomeScreen dark={false} onPrompt={vi.fn()} />);
    expect(screen.getByText(/What can I help you with today\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Explain quantum computing in simple terms/i)).toBeInTheDocument();
    expect(screen.getByText(/Write a Python function to reverse a string/i)).toBeInTheDocument();
  });

  it('calls onPrompt with the selected starter text', () => {
    const onPrompt = vi.fn();
    render(<WelcomeScreen dark={true} onPrompt={onPrompt} />);
    fireEvent.click(screen.getByText(/Summarize the latest AI news/i));
    expect(onPrompt).toHaveBeenCalledWith('Summarize the latest AI news');
  });

  it('has accessible labels for each starter prompt', () => {
    render(<WelcomeScreen dark={false} onPrompt={vi.fn()} />);
    expect(screen.getByLabelText(/Use starter prompt: Help me debug a TypeScript error/i)).toBeInTheDocument();
  });
});
