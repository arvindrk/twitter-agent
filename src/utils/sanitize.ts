export function sanitizeContent(content: string): string {
  return content.replace(/\s*—\s*/g, ", ");
}
