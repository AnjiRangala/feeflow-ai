import { NavLink, Outlet } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';

export default function DashboardLayout({ user, onSignOut }) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <BrandMark />
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <NavLink aria-label="Overview" title="Overview" end to="/" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            <span aria-hidden="true">▦</span> Overview
          </NavLink>
          {(user.role === 'parent' || user.role === 'accounts') && (
            <NavLink aria-label="Fee ledger" title="Fee ledger" to="/fees" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">▤</span> Fee ledger
            </NavLink>
          )}
          {(user.role === 'accounts' || user.role === 'counsellor') && (
            <NavLink aria-label="AI risk monitor" title="AI risk monitor" to="/ai-risk" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">◉</span> AI Risk Monitor
            </NavLink>
          )}
          {user.role === 'accounts' && (
            <NavLink aria-label="Reminder centre" title="Reminder centre" to="/reminders" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">◷</span> Reminder centre
            </NavLink>
          )}
          {user.role === 'accounts' && (
            <NavLink aria-label="Refund calculator" title="Refund calculator" to="/refunds" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">₹</span> Refund calculator
            </NavLink>
          )}
          {user.role === 'accounts' && (
            <NavLink aria-label="Fee assistant" title="Fee assistant" to="/assistant" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">✦</span> Fee assistant
            </NavLink>
          )}
          {user.role === 'accounts' && (
            <NavLink aria-label="User management" title="User management" to="/user-management" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span aria-hidden="true">◎</span> User management
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div className="sidebar-user">
            <strong>{user.name}</strong>
            <span>{user.role === 'accounts' ? 'Accounts team' : user.role === 'counsellor' ? 'Counsellor' : 'Parent account'}</span>
          </div>
          <button className="sidebar-signout" onClick={onSignOut} type="button" aria-label="Sign out">↗</button>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumb"><span>FeeFlow</span><span>/</span><strong>{user.role === 'accounts' ? 'Accounts' : user.role === 'counsellor' ? 'Counsellor workspace' : 'Parent portal'}</strong></div>
          <div className="topbar-user">
            <span className="topbar-date">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date())}</span>
            <span className="avatar small">{user.name.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <div className="dashboard-content"><Outlet /></div>
      </div>
    </div>
  );
}
