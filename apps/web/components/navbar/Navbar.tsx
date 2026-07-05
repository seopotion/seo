import { LocaleSwitcher } from '../i18n/LocaleSwitcher';
import { GoogleJoinButton } from './GoogleJoinButton';
import { NavbarLinks } from './NavbarLinks';
import { NavbarLogo } from './NavbarLogo';

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/95 backdrop-blur-md">
      <div className="mx-auto grid min-h-21 w-full max-w-6xl grid-cols-[1fr_auto] grid-rows-[auto_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:min-h-18 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:grid-rows-1 sm:gap-6 sm:py-0">
        <NavbarLogo />
        <NavbarLinks />
        <div className="flex min-w-0 items-center justify-end gap-2 sm:min-w-40">
          <LocaleSwitcher className="hidden sm:inline-flex" />
          <GoogleJoinButton />
        </div>
      </div>
    </header>
  );
}
