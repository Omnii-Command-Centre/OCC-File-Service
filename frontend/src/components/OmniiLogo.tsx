// The Omnii asterisk mark, drawn as SVG so it stays crisp at any size and
// takes its colour from the surrounding text (currentColor).
export default function OmniiLogo({ className = 'w-8 h-8' }: { className?: string }) {
  const spoke = 'M-1.2 -3.2 L-2.7 -11 L2.7 -11 L1.2 -3.2 Z';
  return (
    <svg viewBox="-12 -12 24 24" className={className} fill="currentColor" role="img" aria-label="Omnii logo">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d={spoke} transform={`rotate(${angle})`} />
      ))}
    </svg>
  );
}
