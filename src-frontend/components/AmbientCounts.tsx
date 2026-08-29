/**
 * Ambient counts of active configuration servers/tools/collections (#547).
 *
 * Instead of burying "how many MCP servers / custom tools / OpenAPI servers /
 * knowledge collections / secrets are active" behind the Settings modal, this
 * renders small always-legible chips inline in the header. Each chip is a
 * button that opens Settings so the user can *edit* the matching group — the
 * counts are a read-only ambient indicator, never a data source.
 */

export interface AmbientCountsProps {
  counts: {
    mcpServers: number;
    customTools: number;
    openApiServers: number;
    knowledgeCollections: number;
    secrets: number;
  };
  dark: boolean;
  onOpenSettings: () => void;
}

/** Pure helper: total number of active configuration entries. */
export function sumAmbientCounts(counts: {
  mcpServers: number;
  customTools: number;
  openApiServers: number;
  knowledgeCollections: number;
  secrets: number;
}): number {
  return (
    counts.mcpServers +
    counts.customTools +
    counts.openApiServers +
    counts.knowledgeCollections +
    counts.secrets
  );
}

interface Chip {
  text: string;
  count: number;
  label: string;
  title: string;
}

/** Build the ordered list of inline chips from the active counts. */
export function buildAmbientChips(counts: AmbientCountsProps['counts']): Chip[] {
  const { mcpServers, customTools, openApiServers, knowledgeCollections, secrets } = counts;
  const chips: Chip[] = [];
  if (mcpServers > 0) {
    chips.push({
      text: `${mcpServers} MCP`,
      count: mcpServers,
      label: `${mcpServers} MCP server${mcpServers === 1 ? '' : 's'} active`,
      title: `MCP servers active (mcpServers=${mcpServers})`,
    });
  }
  if (customTools > 0) {
    chips.push({
      text: `${customTools} tools`,
      count: customTools,
      label: `${customTools} custom tool${customTools === 1 ? '' : 's'} enabled`,
      title: `Custom tools enabled (customTools=${customTools})`,
    });
  }
  if (openApiServers > 0) {
    chips.push({
      text: `${openApiServers} OpenAPI`,
      count: openApiServers,
      label: `${openApiServers} OpenAPI server${openApiServers === 1 ? '' : 's'} enabled`,
      title: `OpenAPI servers enabled (openApiServers=${openApiServers})`,
    });
  }
  if (knowledgeCollections > 0) {
    chips.push({
      text: `${knowledgeCollections} KB`,
      count: knowledgeCollections,
      label: `${knowledgeCollections} knowledge collection${knowledgeCollections === 1 ? '' : 's'}`,
      title: `Knowledge collections (knowledgeCollections=${knowledgeCollections})`,
    });
  }
  if (secrets > 0) {
    chips.push({
      text: `${secrets} secret${secrets === 1 ? '' : 's'}`,
      count: secrets,
      label: `${secrets} secret${secrets === 1 ? '' : 's'} stored`,
      title: `Secrets stored (secrets=${secrets})`,
    });
  }
  return chips;
}

export function AmbientCounts({ counts, dark, onOpenSettings }: AmbientCountsProps) {
  if (sumAmbientCounts(counts) === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5" aria-label="Active configuration counts">
      {buildAmbientChips(counts).map((chip) => (
        <span
          key={chip.text}
          role="button"
          tabIndex={0}
          aria-label={chip.label}
          title={chip.title}
          onClick={onOpenSettings}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSettings(); }
          }}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            dark
              ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
          }`}
        >
          <span className="font-semibold" aria-hidden>{chip.count}</span>
          <span aria-hidden>{chip.text}</span>
        </span>
      ))}
    </div>
  );
}

export default AmbientCounts;
