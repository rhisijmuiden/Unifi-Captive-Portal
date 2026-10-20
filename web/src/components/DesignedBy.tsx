export function DesignedBy({ onDark = false }: { onDark?: boolean }) {
  return (
    <a
      href="https://rhis.nl"
      target="_blank"
      rel="noopener"
      className={`fixed right-4 bottom-4 z-20 inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[11px] font-medium backdrop-blur transition hover:-translate-y-0.5 ${
        onDark ? 'border-white/15 bg-white/10 text-white/75 hover:text-white' : 'border-line bg-raised/85 text-muted shadow-card hover:text-ink'
      }`}
    >
      <img src="/rhis-icon.svg" alt="" className="size-5 rounded-md" />
      Designed by <span className="font-bold tracking-wide">RHIS</span>
    </a>
  );
}
