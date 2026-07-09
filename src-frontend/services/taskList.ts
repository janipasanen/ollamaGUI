/**
 * Interactive GFM task lists (#352).
 *
 * remark-gfm renders `- [ ]` / `- [x]` items as list items with a `checked`
 * flag on the mdast node. This service provides the pure-text helpers to (a)
 * extract a task item's label from the mdast node and (b) toggle the matching
 * task line's checkbox in the raw markdown so the change can be persisted.
 */

/** Recursively extract plain text from an mdast node. */
export function extractNodeText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(extractNodeText).join('');
  return '';
}

/**
 * Extract the label text of a GFM task-list item node.
 * The first child of a task-list item is a paragraph whose children hold the
 * label text (possibly with inline formatting).
 */
export function extractTaskText(node: any): string {
  const para = node?.children?.[0];
  return extractNodeText(para).trim();
}

const TASK_LINE = /^(\s*[-*+]\s*)\[([ xX])\]\s*(.*)$/;

/**
 * Toggle the checkbox of the first task-list line whose label matches
 * `itemText` and whose current checked state equals `currentlyChecked`.
 * Returns the (possibly unchanged) markdown content.
 */
export function toggleTaskInMarkdown(
  content: string,
  itemText: string,
  currentlyChecked: boolean,
): string {
  const target = itemText.trim();
  if (!target) return content;
  const want = currentlyChecked ? 'x' : ' '; // the state we are flipping FROM
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_LINE);
    if (!m) continue;
    const [, prefix, box, label] = m;
    if (label.trim() !== target) continue;
    if (box.toLowerCase() !== want) continue;
    const nextBox = currentlyChecked ? ' ' : 'x';
    lines[i] = `${prefix}[${nextBox}] ${label}`;
    return lines.join('\n');
  }
  return content;
}

/** Whether a markdown string contains at least one GFM task-list item. */
export function hasTaskList(content: string): boolean {
  return TASK_LINE.test(content);
}

/**
 * Recursively flatten React children (as produced by react-markdown) into a
 * plain-text string, so a task item's label can be matched against the raw
 * markdown for toggling.
 */
export function reactChildrenToText(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactChildrenToText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return reactChildrenToText((node as any).props?.children);
  }
  return '';
}
