import React from 'react';

type LogoMarkProps = React.SVGProps<SVGSVGElement>;

export function LogoMark({ className, ...props }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="6.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8.2 9.6c.9-1 2.2-1.7 3.8-1.7 1.6 0 2.9.7 3.8 1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8.2 14.4c.9 1 2.2 1.7 3.8 1.7 1.6 0 2.9-.7 3.8-1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <path
        d="M18.6 4.6l.8 1.7 1.8.3-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.8-.3.8-1.7z"
        fill="currentColor"
      />
    </svg>
  );
}
