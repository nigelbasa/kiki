import React from 'react';

export default function Spinner({ size = 'md', className = '' }) {
  const px = size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-10 w-10 border-4' : 'h-6 w-6 border-2';
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-rwendo-accent border-t-transparent ${px} ${className}`}
    />
  );
}
