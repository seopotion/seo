import Link from 'next/link';

const NAV_LINKS = [
  { href: '/#features', label: 'Features', native: true },
  { href: '/pricing', label: 'Pricing', native: false },
];

const linkClassName =
  'rounded-md px-3 py-2 text-sm font-semibold leading-none text-muted-foreground no-underline transition-colors hover:text-black focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none';

export function NavbarLinks() {
  return (
    <nav
      className="order-3 col-span-2 flex items-center justify-start gap-1 overflow-x-auto sm:order-0 sm:col-span-1 sm:justify-center"
      aria-label="Primary navigation"
    >
      {NAV_LINKS.map((link) =>
        link.native ? (
          <a className={linkClassName} href={link.href} key={link.href}>
            {link.label}
          </a>
        ) : (
          <Link className={linkClassName} href={link.href} key={link.href}>
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}
