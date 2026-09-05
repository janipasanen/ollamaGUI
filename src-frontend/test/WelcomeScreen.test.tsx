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
