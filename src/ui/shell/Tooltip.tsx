import { useId, useRef, useState, type ReactNode } from 'react';

/**
 * A tooltip on hover, keyboard focus and tap (touch): the trigger is described by the tip
 * (aria-describedby). Esc hides it. Keep tips short; long rule text belongs in a panel.
 */
export function Tooltip({ tip, children, className = '', as = 'span' }: { tip: ReactNode; children: ReactNode; className?: string; as?: 'span' | 'div' }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const touch = useRef(false);
  const Tag = as;
  return (
    <Tag
      className={`tt ${className} ${open ? 'open' : ''}`}
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={() => !touch.current && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onTouchStart={() => {
        touch.current = true;
      }}
      onClick={() => touch.current && setOpen((o) => !o)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {children}
      <span role="tooltip" id={id} className="tt-tip">
        {tip}
      </span>
    </Tag>
  );
}
