import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: any) {
  if (!date) return '';
  
  // Handle Firestore Timestamp
  if (typeof date.toDate === 'function') {
    return date.toDate().toLocaleString();
  }
  
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}
