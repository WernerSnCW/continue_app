import { useEffect, useRef, useState } from 'react';

/**
 * Tap-to-reveal help bubble.
 *
 * Phones have no hover, so a real tooltip isn't available — this is a small
 * ⓘ button that toggles a popover, dismissed by tapping anywhere else.
 */
export function HelpTip({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Opens upward by default, but flips below when the trigger sits near the
  // top of the screen — otherwise the bubble renders off-screen.
  const [below, setBelow] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Defer so the opening tap itself doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span className="helptip-wrap" ref={wrap}>
      <button
        className="helptip-btn"
        onClick={() => {
          const top = wrap.current?.getBoundingClientRect().top ?? 0;
          setBelow(top < 240);
          setOpen((o) => !o);
        }}
        aria-label={`What is ${title}?`}
        aria-expanded={open}
      >
        ⓘ
      </button>
      {open && (
        <span className={`helptip-bubble${below ? ' below' : ''}`} role="tooltip">
          <span className="helptip-title">{title}</span>
          <span className="helptip-body">{children}</span>
        </span>
      )}
    </span>
  );
}
