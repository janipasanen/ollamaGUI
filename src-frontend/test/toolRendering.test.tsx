import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallBlock, ToolResultView } from '../App';

const calcCall = {
  function: { name: 'calculate', arguments: '{"expr": "2 + 2", "verbose": true}' },
};
const execCall = {
  function: { name: 'execute_command', arguments: '{"cmd": ["ls", "-l"]}' },
};

describe('ToolCallBlock inline tool-call status (#657)', () => {
  it('shows the tool name, args preview, and the running status with a spinner', () => {
    render(<ToolCallBlock toolCall={calcCall} status="running" dark={false} />);
    expect(screen.getByText('calculate')).toBeTruthy();
    // compactPreview("{expr:..}") => { expr: "2 + 2", … }
    expect(screen.getByText('{ expr: "2 + 2", verbose: true }')).toBeTruthy();
    expect(screen.getByText('Running…')).toBeTruthy();
    expect(screen.getByLabelText('running')).toBeTruthy();
  });

  it('marks a completed call ✓ "Completed"', () => {
    render(<ToolCallBlock toolCall={execCall} status="completed" dark={false} />);
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByLabelText('tool completed')).toBeTruthy();
  });

  it('marks a failed call ✗ "Failed" and tints the border', () => {
    render(<ToolCallBlock toolCall={execCall} status="failed" dark={false} />);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByLabelText('tool failed')).toBeTruthy();
    expect(document.querySelector('.border-red-300')).toBeTruthy();
  });

  it('shows the awaiting-approval status', () => {
    render(<ToolCallBlock toolCall={execCall} status="awaiting-approval" dark={false} />);
    expect(screen.getByText('Awaiting approval…')).toBeTruthy();
    expect(screen.getByLabelText('awaiting approval')).toBeTruthy();
  });

  it('expands to reveal the full raw arguments', () => {
    render(<ToolCallBlock toolCall={execCall} status="completed" dark={false} />);
    const summary = screen.getByText('Arguments');
    fireEvent.click(summary);
    expect(screen.getByText('{"cmd":["ls","-l"]}')).toBeTruthy();
  });
});

describe('ToolResultView inline result rendering (#657)', () => {
  it('renders a structured key/value view for a JSON-returning tool', () => {
    render(<ToolResultView name="calculate" content='{"result": 4, "unit": "px"}' dark={false} />);
    // Name headline of the structured view.
    expect(screen.getByText(/calculate/)).toBeTruthy();
    // Structured path renders via the status icon ("tool completed"), unlike
    // the markdown fallback (ToolResultBlock) which uses "Tool success".
    expect(screen.getByLabelText('tool completed')).toBeTruthy();
    // Top-level rows render as key/preview pairs.
    expect(screen.queryAllByText(/result: 4/).length).toBe(1);
    expect(screen.queryAllByText(/unit: .px/).length).toBe(1);
  });

  it('renders a structured view when the content parses as JSON even for a generic tool name', () => {
    render(<ToolResultView name="execute_command" content='[1, 2, 3]' dark={false} />);
    expect(screen.getByLabelText('tool completed')).toBeTruthy();
    expect(screen.getByText('array(3)')).toBeTruthy();
  });

  it('falls back to markdown rendering for plain-text results', () => {
    render(<ToolResultView name="execute_command" content="first line\nsecond line" dark={false} />);
    // Markdown fallback (ToolResultBlock) reports success via its header; a
    // structured view would instead report "tool completed".
    expect(screen.getByLabelText('Tool success')).toBeTruthy();
    expect(screen.queryAllByText(/first line/).length).toBeGreaterThan(0);
  });

  it('renders a failed banner for error results', () => {
    render(<ToolResultView name="execute_command" content="error: boom\nmore details" dark={false} />);
    expect(screen.getByLabelText('Tool error')).toBeTruthy();
    expect(screen.queryAllByText(/more details/).length).toBeGreaterThan(0);
  });
});
