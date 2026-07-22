function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBubbleTimestamp(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = startOfWeek(now);
  const year = now.getFullYear();

  if (sameDay(date, now)) return `Today ${formatClock(date)}`;
  if (sameDay(date, yesterday)) return `Yesterday ${formatClock(date)}`;
  if (date >= weekStart) {
    return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${formatClock(date)}`;
  }
  if (date.getFullYear() === year) {
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${formatClock(date)}`;
  }
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} ${formatClock(date)}`;
}

export function formatReceiptTimestamp(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (sameDay(date, now)) return formatClock(date);
  if (sameDay(date, yesterday)) return `Yesterday ${formatClock(date)}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} ${formatClock(date)}`;
}

export function startOfLocalWeek(date: Date = new Date()) {
  return startOfWeek(date);
}
