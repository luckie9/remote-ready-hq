import Link from 'next/link';

/** Emerald forward-arrow inside an R-shaped mark */
export function BrandLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="40" height="40" rx="10" fill="#064E3B" />
      {/* R bowl */}
      <path
        d="M11 8.5h10.2c4.55 0 7.55 2.55 7.55 6.35 0 3.05-1.7 5.2-4.55 6.05L30 31.5h-4.85l-5.35-9.85H15.2V31.5H11V8.5Z"
        fill="#ECFDF5"
      />
      <path
        d="M15.2 12.15v6.55h5.55c2.35 0 3.75-1.15 3.75-3.25s-1.4-3.3-3.75-3.3H15.2Z"
        fill="#064E3B"
      />
      {/* Emerald forward arrow */}
      <path
        d="M22.5 20.2h7.2m0 0-2.6-2.55m2.6 2.55-2.6 2.55"
        stroke="#34D399"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMark({
  href = '/',
  size = 'nav',
}: {
  href?: string;
  size?: 'nav' | 'hero';
}) {
  const text =
    size === 'hero'
      ? 'text-3xl font-extrabold tracking-tight text-white sm:text-4xl'
      : 'text-lg font-extrabold tracking-tight text-white sm:text-xl';
  const logo = size === 'hero' ? 'h-10 w-10 sm:h-11 sm:w-11' : 'h-8 w-8';

  return (
    <Link href={href} className="inline-flex items-center gap-2.5">
      <BrandLogo className={logo} />
      <span className={text}>RemoteReady HQ</span>
    </Link>
  );
}
