import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when Vitest globals are on. They aren't (tests
// import from 'vitest' explicitly), so unmount between tests by hand — otherwise
// mounted dialogs leak into the next test's `document`.
afterEach(cleanup);

// No layout shims. The hand-rolled Modal needed `getClientRects()` faked because
// it used a non-empty rect list as "is rendered"; Radix Dialog checks
// `getComputedStyle` instead, which jsdom answers on its own.
