import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmbientCounts, sumAmbientCounts, buildAmbientChips } from '../components/AmbientCounts';

const baseCounts = {
  mcpServers: 0,
  customTools: 0,
  openApiServers: 0,
  knowledgeCollections: 0,
  secrets: 0,
};

describe('AmbientCounts', () => {
  it('renders nothing when all counts are zero', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <AmbientCounts counts={baseCounts} dark={false} onOpenSettings={onOpen} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one accessible element per active group', () => {
    render(
      <AmbientCounts
        counts={{ ...baseCounts, mcpServers: 2, secrets: 1 }}
        dark={false}
        onOpenSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText('2 MCP servers active')).toBeInTheDocument();
    expect(screen.getByLabelText('1 secret stored')).toBeInTheDocument();
    // inactive groups do not appear
    expect(screen.queryByLabelText('0 OpenAPI servers active')).toBeNull();
  });

  it('opens Settings on chip click', () => {
    const onOpen = vi.fn();
    render(
      <AmbientCounts
        counts={{ ...baseCounts, openApiServers: 1 }}
        dark={false}
        onOpenSettings={onOpen}
      />
    );
    screen.getByLabelText('1 OpenAPI server enabled').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens Settings on Enter press', () => {
    const onOpen = vi.fn();
    render(
      <AmbientCounts
        counts={{ ...baseCounts, secrets: 3 }}
        dark={false}
        onOpenSettings={onOpen}
      />
    );
    fireEvent.keyDown(screen.getByLabelText('3 secrets stored'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('sumAmbientCounts', () => {
  it('adds all five counts', () => {
    expect(
      sumAmbientCounts({
        mcpServers: 3,
        customTools: 2,
        openApiServers: 1,
        knowledgeCollections: 4,
        secrets: 5,
      })
    ).toBe(15);
  });
});

describe('buildAmbientChips', () => {
  it('only includes nonzero groups', () => {
    const chips = buildAmbientChips({ ...baseCounts, secrets: 1 });
    expect(chips.length).toBe(1);
    expect(chips[0].text).toBe('1 secret');
  });
});
