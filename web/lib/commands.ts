// Matches {server}, but leaves shell and template syntax like ${HOME} and {{.Names}} alone.
const PLACEHOLDER = /(?<![$\{])\{([a-zA-Z_][\w-]*)\}(?!\})/g;

export function placeholdersIn(command: string): string[] {
  return [...new Set([...command.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

export function fillPlaceholders(command: string, values: Record<string, string>) {
  return command.replace(PLACEHOLDER, (whole, name: string) => values[name] || whole);
}

export async function copyText(text: string, success: string, toast: { success: (message: string) => unknown; error: (message: string) => unknown }) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error("Your browser blocked copying.");
  }
}

export function downloadFile(name: string, text: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** The seconds of an entry that fall inside a period, so months add up when work crosses midnight. */
export function entrySeconds(entry: { startedAt: string; endedAt: string | null }, from?: Date, to?: Date) {
  const start = Math.max(new Date(entry.startedAt).getTime(), from?.getTime() ?? 0);
  const end = Math.min(entry.endedAt ? new Date(entry.endedAt).getTime() : Date.now(), to?.getTime() ?? Infinity);
  return Math.max(0, (end - start) / 1000);
}

/** Quotes a spreadsheet cell, and stops text from being run as a formula when the file is opened. */
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
