import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';
import { _resetPlanStore, unregisterPlanTool } from '../services/planStore';

describe('Plan integration via App (#239)', () => {
  beforeEach(() => {
    global.innerWidth = 1024;
    _resetPlanStore();
    unregisterPlanTool();
  });

  afterEach(() => {
    _resetPlanStore();
    unregisterPlanTool();
  });

  it('invoking update_plan renders the live checklist in the chat column', async () => {
    render(<App />);
    // App registers update_plan on mount.
    await waitFor(() => expect(toolRegistry.getTool('update_plan')).toBeDefined());
    await toolRegistry.getTool('update_plan')!.execute({
      plan: [
        { step: 'Inspect repository', status: 'completed' },
        { step: 'Implement feature', status: 'in_progress' },
        { step: 'Run tests', status: 'pending' },
      ],
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: /Plan/i })).toBeInTheDocument());
    expect(screen.getByText('Inspect repository')).toBeInTheDocument();
    expect(screen.getByText('Implement feature')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });
});
