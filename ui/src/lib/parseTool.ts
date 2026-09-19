export function parseToolJson(
  result:
    | {
        content?: Array<{ type?: string; text?: string }>;
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      }
    | null
    | undefined,
) {
  const text = (result?.content || [])
    .map((block) => (block?.type === 'text' ? block.text : ''))
    .join('\n')
    .trim();
  if (!text) return (result?.structuredContent || {}) as Record<string, unknown>;
  try {
    return { ...JSON.parse(text), ...result?.structuredContent } as Record<string, unknown>;
  } catch {
    return { text, ...result?.structuredContent } as Record<string, unknown>;
  }
}

export function extractSampleText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'type' in content && (content as { type?: string }).type === 'text') {
    return String((content as { text?: string }).text || '');
  }
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text || '')
      .join('\n')
      .trim();
  }
  return '';
}
