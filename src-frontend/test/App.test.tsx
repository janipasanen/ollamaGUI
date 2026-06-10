import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('App Component', () => {
  it('renders the main chat interface', () => {
    render(<App />);
    expect(screen.getByText(/Ollama GUI/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Message Ollama\.\.\./i)).toBeInTheDocument();
  });

  it('toggles sidebar when menu button is clicked', () => {
    render(<App />);
    const menuButton = screen.getByRole('button', { name: /☰/i });
    
    // Initially open (based on App.tsx default state)
    expect(screen.getByText(/History/i)).toBeInTheDocument();
    
    fireEvent.click(menuButton);
    // Sidebar should be hidden (width 0, overflow hidden)
    const sidebar = screen.getByText(/Ollama GUI/).closest('div');
    expect(sidebar).toHaveClass('w-0');
  });

  it('opens settings overlay when settings button is clicked', () => {
    render(<App />);
    const settingsButton = screen.getByText(/⚙️ Settings/i);
    
    fireEvent.click(settingsButton);
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/i)).toBeInTheDocument();
  });

  it('updates input value when typing', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
    
    fireEvent.change(input, { target: { value: 'Hello AI' } });
    expect(input).toHaveValue('Hello AI');
  });
});
