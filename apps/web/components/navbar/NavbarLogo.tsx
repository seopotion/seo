import Image from 'next/image';
import Link from 'next/link';

export function NavbarLogo() {
  return (
    <Link
      className="inline-flex items-center gap-2 justify-self-start no-underline"
      href="/"
      aria-label="Seopotion home"
    >
      <Image
        src="/android-chrome-192x192.png"
        alt="Seopotion logo"
        width={32}
        height={32}
      />
      <span className="text-2xl font-bold text-gray-900">Seopotion</span>
    </Link>
  );
}
