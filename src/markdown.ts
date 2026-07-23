const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export type MarkdownDocument<T> = {
  meta: T;
  body: string;
};

export function parseMarkdownDocument<T>(text: string): MarkdownDocument<T> {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error("Markdown document is missing JSON frontmatter.");
  }

  const meta = JSON.parse(match[1]) as T;
  return {
    meta,
    body: text.slice(match[0].length)
  };
}

export function stringifyMarkdownDocument<T>(meta: T, body: string): string {
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${normalizedBody}`;
}

export function section(title: string, content?: string | string[]): string {
  const value = Array.isArray(content) ? content.filter(Boolean).map((item) => `- ${item}`).join("\n") : content;
  return `## ${title}\n${value && value.trim().length > 0 ? value.trim() : "TBD"}\n`;
}
