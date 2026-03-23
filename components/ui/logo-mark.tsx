"use client";

/**
 * AptDesigner logo mark — a minimal floor-plan icon.
 * Two nested rooms with a doorway, evoking spatial design.
 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Outer room */}
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Interior wall — horizontal divider with doorway gap */}
      <line
        x1="2"
        y1="11"
        x2="10"
        y2="11"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="14"
        y1="11"
        x2="22"
        y2="11"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Accent dot — the "design" element, like a furniture piece on the plan */}
      <circle
        cx="17"
        cy="6.5"
        r="1.5"
        fill="currentColor"
        className="text-accent-warm"
      />
    </svg>
  );
}
