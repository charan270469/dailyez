// Utility functions for formatting and display logic

/**
 * Format a timestamp as a relative time string matching WhatsApp style:
 * - Today: "HH:MM AM/PM" (e.g., "4:47 PM")
 * - Yesterday: "Yesterday"
 * - This week: Day name (e.g., "Monday")
 * - Older: "MM/DD/YYYY" (e.g., "05/08/2026")
 */
export function formatRelativeTime(timestamp: string | Date | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  
  // Get dates at midnight for accurate day comparison
  const dateAtMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowAtMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const daysDifference = Math.floor((nowAtMidnight.getTime() - dateAtMidnight.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDifference === 0) {
    // Today: show time only
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } else if (daysDifference === 1) {
    // Yesterday
    return 'Yesterday';
  } else if (daysDifference > 1 && daysDifference <= 6) {
    // This week: show day name
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    // Older: show full date
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  }
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 60): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * Get initials from a contact name for avatar
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Get a color for avatar background based on name hash
 */
export function getAvatarColor(name: string): string {
  const colors = [
    'bg-rose-100 border-rose-200 text-rose-700',
    'bg-orange-100 border-orange-200 text-orange-700',
    'bg-amber-100 border-amber-200 text-amber-700',
    'bg-emerald-100 border-emerald-200 text-emerald-700',
    'bg-sky-100 border-sky-200 text-sky-700',
    'bg-blue-100 border-blue-200 text-blue-700',
    'bg-violet-100 border-violet-200 text-violet-700',
    'bg-pink-100 border-pink-200 text-pink-700',
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Check if a phone number or string looks like a contact name
 */
export function isLikelyContactName(str: string): boolean {
  if (!str) return false;
  // Phone numbers are typically just digits and +/-/()/ spaces
  const phonePattern = /^[\d+\-() ]*$/;
  return !phonePattern.test(str);
}

/**
 * Extract the email address from a sender header/string, e.g.
 * "ICFAI Admissions <admissions@icfaiuniversity.in>" -> "admissions@icfaiuniversity.in",
 * "noreply@linkedin.com" -> "noreply@linkedin.com".
 * Returns the lowercased address, or null when no email is present.
 */
export function extractEmailAddress(value: string): string | null {
  if (!value) return null;
  const angle = value.match(/<([^<>]+)>/);
  const addr = angle ? angle[1] : value;
  const match = addr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}
