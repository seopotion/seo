import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthedLayout } from './components/AuthedLayout';
import { StageBanner } from './components/StageBanner';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  return (
    <BrowserRouter>
      {/* Outside <Routes> so the environment is visible on the login screen too. */}
      <StageBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthedLayout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
