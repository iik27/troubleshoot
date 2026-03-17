import React, { useState, useEffect } from 'react';
import ReporterView from './ReporterView';
import AdminView from './AdminView';
import Login from './Login';
import { supabase } from './supabase';
import './index.css';

function App() {
  const [session, setSession] = useState(null); // { role: 'admin' | 'reporter' }
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  // Load session from localStorage
  useEffect(() => {
    const savedSession = localStorage.getItem('tb_session');
    if (savedSession) setSession(JSON.parse(savedSession));
  }, []);

  // Fetch reports when session or page changes
  useEffect(() => {
    if (session) {
      fetchReports(currentPage);
    }
  }, [session, currentPage]);

  const fetchReports = async (page = 1) => {
    setIsLoading(true);

    // Calculate range
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('reports')
      .select('*', { count: 'exact' });

    // PRIVACY: If reporter, only show their own reports
    if (session?.role === 'reporter') {
      query = query.eq('reporter_name', session.name);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (!error && data) {
      setReports(data.map(r => ({
        ...r,
        reporterName: r.reporter_name,
        driveLink: r.drive_link,
        timestamp: new Date(r.created_at).toLocaleString()
      })));
      setTotalCount(count || 0);
    }
    setIsLoading(false);
  };

  const handleLogin = (role, name) => {
    const sessionData = { role, name };
    setSession(sessionData);
    localStorage.setItem('tb_session', JSON.stringify(sessionData));
    setCurrentPage(1); // Reset to first page
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('tb_session');
    setReports([]);
    setCurrentPage(1);
  };

  const handleUpdateStatus = async (id, newStatus, adminNote = '') => {
    console.log('handleUpdateStatus called with:', { id, newStatus, adminNote });
    // Jika dipanggil tanpa argumen (dari AdminView yg sudah update DB sendiri),
    // fungsikan hanya sebagai trigger refresh UI.
    if (!id || !newStatus) {
      console.log('Triggering pure UI refresh...');
      fetchReports(currentPage);
      return;
    }

    console.log('Updating report status in Supabase...');
    const { error } = await supabase
      .from('reports')
      .update({
        status: newStatus,
        admin_note: adminNote
      })
      .eq('id', id);

    if (!error) {
      console.log('Update successful, refreshing reports...');
      // Re-fetch to ensure data consistency with current page
      fetchReports(currentPage);
    } else {
      console.error('Error in App.jsx update:', error);
      alert(`Gagal sinkronisasi update: ${error.message}`);
    }
  };

  if (!session) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <nav className="glass-card" style={{
        margin: '1rem',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: '1rem',
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', background: 'linear-gradient(to right, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
            Beresin Masalah
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'white', margin: 0 }}>{session.name}</p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {session.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8rem',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--status-cancel)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '0.5rem'
            }}
          >
            Log Out
          </button>
        </div>
      </nav>

      <main>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '4rem' }}>Memuat data...</div>
        ) : (
          session.role === 'reporter' ? (
            <ReporterView
              reports={reports}
              onReportSubmit={() => fetchReports(1)}
              userProfile={session}
              totalReports={totalCount}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          ) : (
            <AdminView
              reports={reports}
              onStatusUpdate={handleUpdateStatus}
              totalReports={totalCount}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          )
        )}
      </main>

      <footer style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <p style={{ margin: 0 }}>
          &copy; 2026 Beresin Masalah. <span style={{ fontStyle: 'italic' }}>"Satu Akses, Urusan Beres"</span>.
        </p>
      </footer>
    </div>
  );
}

export default App;
