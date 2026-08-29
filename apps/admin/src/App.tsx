import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router';
import { AuthedLayout } from './components/AuthedLayout';
import { StageBanner } from './components/StageBanner';
import { ArticlePage } from './pages/ArticlePage';
import { LoginPage } from './pages/LoginPage';
import { OrgWorkspace } from './pages/OrgWorkspace';
import { ArticlesTab } from './pages/org/ArticlesTab';
import { AuditTab } from './pages/org/AuditTab';
import { OverviewTab } from './pages/org/OverviewTab';
import { PlannerTab } from './pages/org/PlannerTab';
import { PoolTab } from './pages/org/PoolTab';
import { PromoCodesPage } from './pages/PromoCodesPage';
import { SearchPage } from './pages/SearchPage';

// A data router rather than <BrowserRouter>: `useBlocker` — the article
// editor's unsaved-changes guard — only exists on this one. The route tree is
// otherwise unchanged.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthedLayout />}>
        <Route path="/" element={<SearchPage />} />
        {/* Tabs are nested routes, so every tab is a deep-linkable URL. */}
        <Route path="/orgs/:orgId" element={<OrgWorkspace />}>
          <Route index element={<OverviewTab />} />
          <Route path="pool" element={<PoolTab />} />
          <Route path="planner" element={<PlannerTab />} />
          <Route path="articles" element={<ArticlesTab />} />
          <Route path="audit" element={<AuditTab />} />
        </Route>
        {/* Workspace-independent, so an article link stands on its own. */}
        <Route path="/articles/:articleId" element={<ArticlePage />} />
        <Route path="/promo-codes" element={<PromoCodesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
  ),
);

export function App() {
  return (
    <>
      {/* Outside the router so the environment is visible on the login screen too. */}
      <StageBanner />
      <RouterProvider router={router} />
    </>
  );
}
