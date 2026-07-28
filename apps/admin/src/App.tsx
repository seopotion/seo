import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthedLayout } from './components/AuthedLayout';
import { StageBanner } from './components/StageBanner';
import { LoginPage } from './pages/LoginPage';
import { OrgWorkspace } from './pages/OrgWorkspace';
import { OverviewTab } from './pages/org/OverviewTab';
import { PlaceholderTab } from './pages/org/PlaceholderTab';
import { SearchPage } from './pages/SearchPage';

export function App() {
  return (
    <BrowserRouter>
      {/* Outside <Routes> so the environment is visible on the login screen too. */}
      <StageBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthedLayout />}>
          <Route path="/" element={<SearchPage />} />
          {/* Tabs are nested routes, so every tab is a deep-linkable URL. */}
          <Route path="/orgs/:orgId" element={<OrgWorkspace />}>
            <Route index element={<OverviewTab />} />
            <Route path="pool" element={<PlaceholderTab name="The candidate pool" />} />
            <Route path="planner" element={<PlaceholderTab name="The planner" />} />
            <Route path="articles" element={<PlaceholderTab name="Articles" />} />
            <Route path="audit" element={<PlaceholderTab name="The audit trail" />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
