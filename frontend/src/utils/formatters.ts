export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m (${minutes}m)` : `${hrs}h (${minutes}m)`;
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "Syncing...";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
