import { useEffect, useState } from 'react';
import { api, getApiError } from '../api/client.js';

const initialStudent = {
  studentId: '', name: '', batch: '', centre: '',
  parentName: '', parentEmail: '', parentPhone: ''
};

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [student, setStudent] = useState(initialStudent);
  const [counsellor, setCounsellor] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadUsers() {
    const { data } = await api.get('/admin/users');
    setUsers(data.users);
  }

  useEffect(() => {
    loadUsers().catch((requestError) => setError(getApiError(requestError)));
  }, []);

  async function registerStudent(event) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/admin/students', {
        studentId: student.studentId,
        name: student.name,
        batch: student.batch,
        centre: student.centre,
        parent: { name: student.parentName, email: student.parentEmail, phone: student.parentPhone }
      });
      setNotice(data.invitationCreated
        ? 'Student and parent account created. An activation invitation was sent to the parent.'
        : 'Student registered and the existing parent account was linked.');
      setStudent(initialStudent);
      await loadUsers();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally { setSaving(false); }
  }

  async function inviteCounsellor(event) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      await api.post('/admin/counsellors/invite', counsellor);
      setNotice('Counsellor account created. An activation invitation was sent.');
      setCounsellor({ name: '', email: '', phone: '' });
      await loadUsers();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally { setSaving(false); }
  }

  async function setActive(user) {
    setError(''); setNotice('');
    try {
      await api.patch(`/admin/users/${user.id}/status`, { active: !user.isActive });
      setNotice(`Account ${user.isActive ? 'deactivated' : 'activated'}.`);
      await loadUsers();
    } catch (requestError) { setError(getApiError(requestError)); }
  }

  return (
    <section>
      <div className="page-heading">
        <div><p className="page-eyebrow">ACCOUNTS ADMIN</p><h1>User management</h1><p>Provision institute-controlled accounts and link parents to students.</p></div>
      </div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      {notice && <div className="notice-success" role="status">{notice}</div>}
      <div className="management-grid">
        <form className="panel management-form" onSubmit={registerStudent}>
          <div className="panel-heading"><div><h2>Register student and parent</h2><p>The parent receives a secure activation invitation.</p></div></div>
          <div className="form-grid">
            {[
              ['Student ID', 'studentId', 'Student ID'],
              ['Student name', 'name', 'Full name'],
              ['Batch', 'batch', 'Batch'],
              ['Centre', 'centre', 'Centre'],
              ['Parent name', 'parentName', 'Full name'],
              ['Parent email', 'parentEmail', 'Email address'],
              ['Parent phone', 'parentPhone', 'Phone number']
            ].map(([label, key, placeholder]) => (
              <label key={key}>{label}<input required type={key === 'parentEmail' ? 'email' : 'text'} placeholder={placeholder} value={student[key]} onChange={(event) => setStudent({ ...student, [key]: event.target.value })} /></label>
            ))}
          </div>
          <div className="form-actions"><span>Existing parent emails are linked only when unlinked.</span><button className="button-primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Register student'}</button></div>
        </form>

        <form className="panel management-form" onSubmit={inviteCounsellor}>
          <div className="panel-heading"><div><h2>Invite counsellor</h2><p>Counsellors receive risk-workflow access only.</p></div></div>
          <div className="form-grid">
            <label>Name<input required value={counsellor.name} onChange={(event) => setCounsellor({ ...counsellor, name: event.target.value })} /></label>
            <label>Email<input required type="email" value={counsellor.email} onChange={(event) => setCounsellor({ ...counsellor, email: event.target.value })} /></label>
            <label>Phone<input required value={counsellor.phone} onChange={(event) => setCounsellor({ ...counsellor, phone: event.target.value })} /></label>
          </div>
          <div className="form-actions"><span>No password is returned or displayed.</span><button className="button-primary" disabled={saving} type="submit">{saving ? 'Sending…' : 'Send invitation'}</button></div>
        </form>
      </div>

      <section className="panel">
        <div className="panel-heading"><div><h2>Managed accounts</h2><p>Only Accounts Admin can change account status.</p></div></div>
        <div className="management-users">
          {users.map((user) => (
            <div className="management-user" key={user.id}>
              <div><strong>{user.name}</strong><span>{user.email} · {user.role}</span></div>
              <button className="text-button" onClick={() => setActive(user)} type="button">{user.isActive ? 'Deactivate' : 'Activate'}</button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
