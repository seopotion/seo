import Image from 'next/image';
import Link from 'next/link';

export function NavbarLogo() {
  return (
    <Link
      className="inline-flex items-center gap-2 justify-self-start no-underline"
      href="/"
      aria-label="Rankpace home"
    >
      <Image
        src="/android-chrome-192x192.png"
        alt="Rankpace logo"
        width={32}
        height={32}
      />
      <span className="text-2xl font-bold text-gray-900">Rankpace</span>
    </Link>
  );
}
