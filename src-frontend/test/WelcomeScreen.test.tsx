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
    fireEvent.click(screen.getByText(/Write a Python function to reverse a string/i));
    expect(onPrompt).toHaveBeenCalledWith('Write a Python function to reverse a string');
  });

  it('has accessible labels for each starter prompt', () => {
    render(<WelcomeScreen dark={false} onPrompt={vi.fn()} />);
    expect(screen.getByLabelText(/Use starter prompt: Explain quantum computing/i)).toBeInTheDocument();
  });

  it('shows goal-shaped prompts and no folder CTA when a project is active (#549 rank 6)', () => {
    render(<WelcomeScreen dark={false} onPrompt={vi.fn()} hasProject />);
    expect(screen.getByText(/Find and fix one real bug/i)).toBeInTheDocument();
    expect(screen.queryByText(/Open a project folder/i)).not.toBeInTheDocument();
    expect(screen.getByText(/What should we get done\?/i)).toBeInTheDocument();
  });

  it('offers one-click model downloads on a zero-models first run (#549 rank 4)', () => {
    const onPull = vi.fn();
    render(
      <WelcomeScreen
        dark={false}
        onPrompt={vi.fn()}
        showModelSetup
        suggestedModels={[{ name: 'ministral-3:3b', label: 'Ministral 3B', description: '', sizeGB: 2.0, minRamGB: 8, recommended: true }]}
        onPullModel={onPull}
        pullStatus={null}
        pulling={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Download model Ministral 3B'));
    expect(onPull).toHaveBeenCalledWith('ministral-3:3b');
  });
});


describe('WelcomeScreen prompt library (#358)', () => {
  it('shows saved prompts instead of starters when provided', () => {
    render(
      <WelcomeScreen
        dark={false}
        onPrompt={vi.fn()}
        prompts={[{ name: 'Refactor module', body: 'Refactor the auth module' }, { name: 'Add tests', body: 'Add unit tests for utils' }]}
      />,
    );
    expect(screen.getByText('Refactor module')).toBeInTheDocument();
    expect(screen.getByText('Add tests')).toBeInTheDocument();
    // Starters are not shown when custom prompts exist.
    expect(screen.queryByText(/Explain quantum computing/i)).not.toBeInTheDocument();
  });

  it('sends the prompt body (not the name) on click', () => {
    const onPrompt = vi.fn();
    render(
      <WelcomeScreen
        dark={true}
        onPrompt={onPrompt}
        prompts={[{ name: 'Greet', body: 'Say hello politely' }]}
      />,
    );
    fireEvent.click(screen.getByText('Greet'));
    expect(onPrompt).toHaveBeenCalledWith('Say hello politely');
  });

  it('falls back to starter prompts when the saved list is empty', () => {
    render(<WelcomeScreen dark={false} onPrompt={vi.fn()} prompts={[]} />);
    expect(screen.getByText(/Explain quantum computing in simple terms/i)).toBeInTheDocument();
  });

  it('ignores saved prompts with empty bodies', () => {
    render(
      <WelcomeScreen
        dark={false}
        onPrompt={vi.fn()}
        prompts={[{ name: 'Empty', body: '   ' }]}
      />,
    );
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
    expect(screen.getByText(/Explain quantum computing/i)).toBeInTheDocument();
  });
});
