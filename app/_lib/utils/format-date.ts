const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(date: Date | string | null): string {
  const dateObj = toDate(date);
  if (!dateObj) return "—";
  return dateFormatter.format(dateObj);
}

export function formatDateTime(date: Date | string | null): string {
  const dateObj = toDate(date);
  if (!dateObj) return "—";
  return dateTimeFormatter.format(dateObj);
}

