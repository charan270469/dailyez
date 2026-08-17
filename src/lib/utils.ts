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
    'bg-red-900/40 border-red-900/40 text-red-400',
    'bg-orange-900/40 border-orange-900/40 text-orange-400',
    'bg-yellow-900/40 border-yellow-900/40 text-yellow-400',
    'bg-green-900/40 border-green-900/40 text-green-400',
    'bg-blue-900/40 border-blue-900/40 text-blue-400',
    'bg-indigo-900/40 border-indigo-900/40 text-indigo-400',
    'bg-purple-900/40 border-purple-900/40 text-purple-400',
    'bg-pink-900/40 border-pink-900/40 text-pink-400',
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
