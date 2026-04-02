/**
 * Human-readable visit status for badges and lists (demo / Atlas clarity).
 */
export function formatVisitStatusLabel(status: string | null | undefined): string {
  if (!status?.trim()) return "—";
  const s = status.trim();
  const n = s.toLowerCase().replace(/&/g, "").replace(/\s+/g, " ").trim();

  if (n.includes("signed") && n.includes("complete")) return "Signed & Complete";
  if (n === "in progress" || n === "in_progress") return "In Progress";
  if (n === "waiting") return "Waiting";
  if (n === "draft") return "Draft";
  if (n === "signed" || n === "completed" || n === "finalized") {
    return "Signed & Complete";
  }

  if (s.includes("_")) {
    return s
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  return s;
}
