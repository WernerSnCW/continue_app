/**
 * Brand mark: a five-bar tally — four strokes and the diagonal that closes
 * the group. It's the oldest death-count notation there is, reads instantly
 * at 20px, and is unmistakably "counting" rather than generic fantasy chrome.
 *
 * Gold at the top fading to ember at the base, matching the palette.
 */
export function Logo({ size = 26, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={(size * 24) / 26}
      height={size}
      viewBox="0 0 24 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ flexShrink: 0, display: 'block' }}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="tallyGrad" x1="12" y1="3" x2="12" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e8b64a" />
          <stop offset="1" stopColor="#ff5a36" />
        </linearGradient>
      </defs>
      <g
        stroke="url(#tallyGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        style={{ vectorEffect: 'non-scaling-stroke' } as never}
      >
        {/* The four uprights, each nicked slightly out of true so it reads as
            scratched rather than printed. */}
        <path d="M3.4 4.6 L2.9 21.2" />
        <path d="M8.2 4.2 L8.0 21.5" />
        <path d="M13.0 4.6 L13.3 21.1" />
        <path d="M17.9 4.1 L18.4 21.4" />
        {/* The fifth stroke that closes the set. */}
        <path d="M1.3 20.2 L20.9 5.4" />
      </g>
    </svg>
  );
}
