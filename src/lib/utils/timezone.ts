import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import { env } from '../env';

export const TIMEZONE = env.TZ; // 'Europe/Amsterdam'

/**
 * Get current date/time in the configured timezone
 */
export function getNow(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

/**
 * Format a date for logging in the configured timezone
 * Example: "2024-12-28 14:30:45 CET"
 */
export function formatForLog(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss zzz');
}

/**
 * Format a date in ISO 8601 format with timezone
 * Example: "2024-12-28T14:30:45+01:00"
 */
export function formatISO(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Check if an order date is after the configured start date
 */
export function isAfterStartDate(orderDate: string): boolean {
  try {
    const orderDateTime = parseISO(orderDate);
    const startDateTime = parseISO(env.PROCESSING_START_DATE);
    return orderDateTime >= startDateTime;
  } catch (error) {
    console.error('Error parsing dates:', error);
    return false;
  }
}

/**
 * Parse an ISO date string to a Date object
 */
export function parseDate(dateString: string): Date {
  return parseISO(dateString);
}

/**
 * Format a date as a human-readable string
 * Example: "December 28, 2024 at 2:30 PM"
 */
export function formatHumanReadable(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, 'MMMM dd, yyyy \'at\' h:mm a');
}
