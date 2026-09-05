import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ProjectHeader from '../components/ProjectHeader';
import { isMlxModelName } from '../services/mlx';

describe('ProjectHeader (#543)', () => {
  it('renders nothing when no project is active, rather than a placeholder', () => {
    const { container } = render(<ProjectHeader name={null} roots={[]} dark={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the project name and the folder chip beneath it', () => {
    render(<ProjectHeader name="Payments rewrite" roots={['/repos/payments']} dark={false} />);
    expect(screen.getByText('Payments rewrite')).toBeInTheDocument();
    expect(screen.getByTestId('project-folder-chip')).toHaveTextContent('payments');
  });

  it('summarises a multi-repo project instead of listing every folder', () => {
    render(<ProjectHeader name="Platform" roots={['/repos/api', '/repos/web', '/repos/infra']} dark={false} />);
    expect(screen.getByTestId('project-folder-chip')).toHaveTextContent('api +2');
  });

  it('exposes every folder on hover so the summary is not lossy', () => {
    render(<ProjectHeader name="Platform" roots={['/repos/api', '/repos/web']} dark={false} />);
    // The chip doubles as the change-working-folder control (#550), so the
    // tooltip carries the paths PLUS the click hint.
    const title = screen.getByTestId('project-folder-chip').getAttribute('title') ?? '';
    expect(title).toContain('/repos/api\n/repos/web');
    expect(title).toMatch(/change this session's working folder/i);
  });

  it('omits the chip entirely for a project with no folder bound', () => {
    render(<ProjectHeader name="Scratch" roots={[]} dark={false} />);
    expect(screen.getByText('Scratch')).toBeInTheDocument();
    expect(screen.queryByTestId('project-folder-chip')).not.toBeInTheDocument();
  });
});

describe('isMlxModelName (#544)', () => {
  it('recognises the tag forms Ollama actually uses', () => {
    expect(isMlxModelName('qwen3.5:4b-mlx')).toBe(true);
    expect(isMlxModelName('gemma4:12b-mlx')).toBe(true);
    expect(isMlxModelName('some-model:mlx')).toBe(true);
    expect(isMlxModelName('mlx-community/thing')).toBe(true);
  });

  it('does not match models that merely contain the letters', () => {
    expect(isMlxModelName('ornith:9b')).toBe(false);
    expect(isMlxModelName('nomic-embed-text:latest')).toBe(false);
    // Substring inside a longer word must not count.
    expect(isMlxModelName('mlxxl:7b')).toBe(false);
    expect(isMlxModelName('premlx:7b')).toBe(false);
  });
});
