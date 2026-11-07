import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/client.js';
import LoadingSpinner from './components/LoadingSpinner.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardLayout from './components/DashboardLayout.jsx';
import FeeLedgerPage from './pages/FeeLedgerPage.jsx';
import StudentFeePage from './pages/StudentFeePage.jsx';
import FeeAssistantPage from './pages/FeeAssistantPage.jsx';
import ParentDashboard from './pages/ParentDashboard.jsx';
import ParentPaymentPage from './pages/ParentPaymentPage.jsx';
import ReminderCenterPage from './pages/ReminderCenterPage.jsx';
const AccountsDashboardPage = lazy(() => import('./pages/AccountsDashboardPage.jsx'));
const RefundCalculatorPage = lazy(() => import('./pages/RefundCalculatorPage.jsx'));
const AiRiskMonitorPage = lazy(() => import('./pages/AiRiskMonitorPage.jsx'));

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const token = window.localStorage.getItem('feeflow.accessToken');
    if (!token) {
      setCheckingSession(false);
      return;
    }

    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        window.localStorage.removeItem('feeflow.accessToken');
      })
      .finally(() => setCheckingSession(false));
  }, []);

  function onAuthenticated(token, authenticatedUser) {
    window.localStorage.setItem('feeflow.accessToken', token);
    setUser(authenticatedUser);
  }

  function onSignOut() {
    window.localStorage.removeItem('feeflow.accessToken');
    setUser(null);
  }

  return (
    <BrowserRouter>
      {checkingSession ? <LoadingSpinner /> : (
        <Routes>
          <Route path="/login" element={<LoginPage onAuthenticated={onAuthenticated} user={user} />} />
          <Route path="/" element={user ? <DashboardLayout onSignOut={onSignOut} user={user} /> : <Navigate to="/login" replace />}>
            <Route index element={user?.role === 'parent' ? <ParentDashboard /> : user?.role === 'counsellor' ? <Navigate to="/ai-risk" replace /> : user ? <Suspense fallback={<LoadingSpinner />}><AccountsDashboardPage user={user} /></Suspense> : <Navigate to="/login" replace />} />
            <Route path="fees" element={user?.role === 'parent' || user?.role === 'accounts' ? <FeeLedgerPage user={user} /> : <Navigate to="/" replace />} />
            <Route path="fees/:studentId" element={user?.role === 'parent' || user?.role === 'accounts' ? <StudentFeePage user={user} /> : <Navigate to="/" replace />} />
            <Route path="payments/:studentId/:installmentNumber" element={user?.role === 'parent' ? <ParentPaymentPage user={user} /> : <Navigate to="/" replace />} />
            {user?.role === 'accounts' && <Route path="reminders" element={<ReminderCenterPage />} />}
            {user?.role === 'accounts' && <Route path="refunds" element={<Suspense fallback={<LoadingSpinner />}><RefundCalculatorPage /></Suspense>} />}
            {user?.role === 'accounts' && <Route path="assistant" element={<FeeAssistantPage />} />}
            {(user?.role === 'accounts' || user?.role === 'counsellor') && <Route path="ai-risk" element={<Suspense fallback={<LoadingSpinner />}><AiRiskMonitorPage user={user} /></Suspense>} />}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
