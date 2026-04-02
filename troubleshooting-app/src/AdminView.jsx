import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import ExcelJS from 'exceljs';

// Komponen Live Timer untuk menghitung durasi On Process
const LiveTimer = ({ acceptedAt, completedAt, status }) => {
  const [duration, setDuration] = useState('');

  useEffect(() => {
    if (!acceptedAt) {
      setDuration('-');
      return;
    }

    const calculateDuration = () => {
      const start = new Date(acceptedAt).getTime();
      const end = completedAt ? new Date(completedAt).getTime() : Date.now();
      const diff = Math.max(0, end - start);

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setDuration(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
    };

    calculateDuration();

    let intervalId;
    if (status === 'On Process' && !completedAt) {
      intervalId = setInterval(calculateDuration, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [acceptedAt, completedAt, status]);

  return <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>⏱ {duration}</span>;
};

const AdminView = ({ onLogout, onStatusUpdate, totalReports, reports, currentPage, onPageChange }) => {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' or 'settings'
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', pin: '', role: 'reporter' });
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const totalPages = Math.ceil(totalReports / 10);

  // New states for resolution and export
  const [selectedReport, setSelectedReport] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionLink, setResolutionLink] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState(''); // 'accept', 'reject', 'resolve'
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });

  useEffect(() => {
    if (activeTab === 'settings') {
      fetchUsers();
    }
  }, [activeTab]);

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true });

    if (!error && data) {
      setUsers(data);
    }
    setIsLoadingUsers(false);
  };

  const filteredReports = reports.filter(report => {
    if (!dateFilter.start && !dateFilter.end) return true;
    const reportDate = new Date(report.created_at || Date.now());
    const start = dateFilter.start ? new Date(dateFilter.start) : new Date(0);
    const end = dateFilter.end ? new Date(dateFilter.end) : new Date();
    end.setHours(23, 59, 59, 999);
    return reportDate >= start && reportDate <= end;
  });

  const stats = {
    total: totalReports, // Use total from DB for stats
    menunggu: reports.filter(r => r.status && r.status.toLowerCase() === 'menunggu').length,
    proses: reports.filter(r => r.status && r.status.toLowerCase() === 'on process').length,
    selesai: reports.filter(r => r.status && r.status.toLowerCase() === 'selesai').length,
    cancel: reports.filter(r => r.status && r.status.toLowerCase() === 'cancel').length,
  };

  const handleStatusAction = (report, newStatus) => {
    console.log('Action triggered:', { reportId: report.id, newStatus });
    setSelectedReport(report);
    setResolutionNote(report.admin_note || '');

    if (newStatus === 'On Process') {
      setModalMode('accept');
      setIsModalOpen(true);
    } else if (newStatus === 'Cancel') {
      setModalMode('reject');
      setIsModalOpen(true);
    } else if (newStatus === 'Selesai' || newStatus === 'Success') {
      setModalMode('resolve');
      setIsModalOpen(true);
    } else {
      onStatusUpdate(report.id, newStatus);
    }
  };
  const confirmAction = async () => {
    if (!selectedReport) return;

    console.log(`Executing ${modalMode} for:`, selectedReport.id);
    let updateData = {};
    let statusText = '';

    if (modalMode === 'accept') {
      updateData = { status: 'On Process', accepted_at: new Date().toISOString() };
      statusText = 'On Process';
    } else if (modalMode === 'reject') {
      updateData = { status: 'Cancel', admin_note: resolutionNote };
      statusText = 'Cancel';
    } else if (modalMode === 'resolve') {
      updateData = {
        status: 'Selesai',
        admin_note: resolutionNote,
        resolution_link: resolutionLink,
        completed_at: new Date().toISOString()
      };
      statusText = 'Selesai';
    }

    try {
      const { error } = await supabase
        .from('reports')
        .update(updateData)
        .eq('id', selectedReport.id);

      if (error) throw error;

      onStatusUpdate();
      setIsModalOpen(false);
      setSelectedReport(null);
      setResolutionNote('');
      setResolutionLink('');
      setModalMode('');
      alert(`Berhasil memperbarui status laporan ke: ${statusText}`);
    } catch (err) {
      console.error('Action failed:', err);
      alert(`Gagal memproses aksi: ${err.message}`);
    }
  };


  const handleAddUser = async (e) => {
    e.preventDefault();
    if (newUser.name && newUser.pin) {
      // VALIDATION: Check if PIN already exists
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('name')
        .eq('pin', newUser.pin)
        .maybeSingle();

      if (existingUser) {
        alert(`Gagal! PIN sudah digunakan oleh ${existingUser.name}. Silakan gunakan PIN lain.`);
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .insert([newUser]);

      if (!error) {
        fetchUsers();
        setNewUser({ name: '', pin: '', role: 'reporter' });
        alert('User berhasil ditambahkan!');
      } else {
        alert('Gagal menambah user.');
      }
    }
  };

  // New states for editing user
  const [editingUser, setEditingUser] = useState(null);
  const [editFormData, setEditFormData] = useState({ name: '', pin: '', role: 'reporter' });

  const handleEditClick = (user) => {
    setEditingUser(user.id);
    setEditFormData({ name: user.name, pin: user.pin, role: user.role });
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (editFormData.name && editFormData.pin) {
      // 1. Validasi PIN Unik (Kecuali PIN miliknya sendiri)
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('name, id')
        .eq('pin', editFormData.pin)
        .maybeSingle();

      if (existingUser && existingUser.id !== editingUser) {
        alert(`Gagal! PIN sudah digunakan oleh ${existingUser.name}. Silakan gunakan PIN lain.`);
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          name: editFormData.name,
          pin: editFormData.pin,
          role: editFormData.role
        })
        .eq('id', editingUser);

      if (!error) {
        setEditingUser(null);
        fetchUsers();
        alert('Data user berhasil diperbarui!');
      } else {
        alert('Gagal memperbarui user.');
      }
    }
  };

  const handleDeleteUser = async (user) => {
    // 4. Proteksi Master Admin Lebih Aman (Cek Nama & PIN)
    if (user.pin === '9999' || user.name === 'Admin Master' || user.role === 'master') {
      alert('Gagal! User Admin Master tidak dapat dihapus melalui aplikasi.');
      return;
    }

    if (!confirm(`Apakah Anda yakin ingin menghapus user ${user.name}?`)) return;

    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (!error) {
      fetchUsers();
    } else {
      alert('Gagal menghapus user.');
    }
  };

  const exportToExcel = async (exportAll = false) => {
    console.log(`Starting high-fidelity professional export (all=${exportAll})...`);
    let dataToExport = filteredReports;

    if (exportAll) {
      const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        dataToExport = data.map(r => ({
          ...r,
          reporterName: r.reporter_name,
          driveLink: r.drive_link,
        }));
      } else {
        alert('Gagal mengambil semua data untuk ekspor.');
        return;
      }
    }

    if (!dataToExport || dataToExport.length === 0) {
      alert('Tidak ada data untuk diekspor.');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Laporan Pengaduan');

      // 1. JUDUL UTAMA (Font 16, Bold, Center)
      worksheet.mergeCells('A1:L1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'LAPORAN PENGADUAN LAYANAN - BERESIN MASALAH';
      titleCell.font = { size: 16, bold: true };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // 2. METADATA (Merge Info)
      worksheet.mergeCells('A2:L2');
      worksheet.getCell('A2').value = `Tanggal Ekspor : ${new Date().toLocaleString('id-ID')}`;

      worksheet.mergeCells('A3:L3');
      worksheet.getCell('A3').value = `Tipe Laporan   : ${exportAll ? 'Seluruh Data (Database)' : 'Data Hasil Filter'}`;

      worksheet.mergeCells('A4:L4');
      worksheet.getCell('A4').value = `Periode Data   : ${dateFilter.start || 'Awal'} s/d ${dateFilter.end || 'Sekarang'}`;

      worksheet.mergeCells('A5:L5');
      worksheet.getCell('A5').value = `Total Laporan  : ${dataToExport.length} Entri`;

      // Spacer
      worksheet.addRow([]);

      // 3. HEADER TABEL (Row 7)
      const headerRow = worksheet.getRow(7);
      headerRow.values = [
        "NO", "TANGGAL LAPORAN", "NAMA PELAPOR", "DIVISI / UNIT",
        "KATEGORI", "DESKRIPSI MASALAH", "LINK BUKTI AWAL",
        "STATUS PROSES", "CATATAN ADMIN / RESOLUSI",
        "WAKTU TERIMA", "WAKTU SELESAI", "LINK BUKTI HASIL"
      ];

      // GAYA HEADER (Bold & Border)
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2563EB' } // Warna Primary Blue
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
      });

      // 4. ISI DATA (Rows 8+)
      dataToExport.forEach((r, index) => {
        const row = worksheet.addRow([
          index + 1,
          new Date(r.created_at).toLocaleString('id-ID'),
          r.reporterName || r.reporter_name || '-',
          r.division || '-',
          r.category || '-',
          r.description || '-',
          (r.driveLink || r.drive_link) ? { text: r.driveLink || r.drive_link, hyperlink: r.driveLink || r.drive_link } : '-',
          r.status || '-',
          r.admin_note || '-',
          r.accepted_at ? new Date(r.accepted_at).toLocaleString('id-ID') : '-',
          r.completed_at ? new Date(r.completed_at).toLocaleString('id-ID') : '-',
          r.resolution_link ? { text: r.resolution_link, hyperlink: r.resolution_link } : '-'
        ]);

        // GAYA ISI (Border Hitam)
        row.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          };

          // Styling khusus untuk Hyperlink (Kolom 7: Bukti Awal, Kolom 12: Bukti Hasil)
          if (colNumber === 7 || colNumber === 12) {
             if (cell.value && typeof cell.value === 'object' && cell.value.hyperlink) {
                cell.font = { color: { argb: 'FF0000FF' }, underline: true };
             }
          }
        });
      });

      // 5. ATUR LEBAR KOLOM
      worksheet.columns = [
        { width: 5 },  // NO
        { width: 22 }, // TANGGAL
        { width: 22 }, // PELAPOR
        { width: 20 }, // DIVISI
        { width: 20 }, // KATEGORI
        { width: 50 }, // DESKRIPSI
        { width: 35 }, // LINK BUKTI
        { width: 18 }, // STATUS
        { width: 40 }, // CATATAN
        { width: 25 }, // TERIMA
        { width: 25 }, // SELESAI
        { width: 30 }  // LINK SOLUSI
      ];

      // 6. EXPORT & DOWNLOAD (Native Forced Download for Chrome Compatibility)
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `Laporan_BeresinMasalah_${exportAll ? 'Semua' : 'Filter'}_${dateStr}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(anchor);

      console.log('High-fidelity export success with native trigger:', fileName);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Gagal membuat laporan: ' + err.message);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '1rem 2rem' }}>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)' }}>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            padding: '1rem 0',
            background: 'transparent',
            color: activeTab === 'dashboard' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: activeTab === 'dashboard' ? '2px solid var(--primary)' : 'none',
            borderRadius: 0,
            fontWeight: 600
          }}
        >
          📈 Dashboard
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            padding: '1rem 0',
            background: 'transparent',
            color: activeTab === 'settings' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: activeTab === 'settings' ? '2px solid var(--primary)' : 'none',
            borderRadius: 0,
            fontWeight: 600
          }}
        >
          ⚙️ Pengaturan User
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <>
          <header style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Ringkasan Laporan</h1>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Mulai</label>
                    <input
                      type="date"
                      className="input-field"
                      style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                      value={dateFilter.start}
                      onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Hingga</label>
                    <input
                      type="date"
                      className="input-field"
                      style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                      value={dateFilter.end}
                      onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button
                    onClick={() => exportToExcel(false)}
                    className="btn-primary"
                    style={{ padding: '0.55rem 0.8rem', fontSize: '0.75rem', background: 'var(--status-success)', borderRadius: '0.5rem 0 0 0.5rem' }}
                    title="Ekspor hanya yang tampil di layar"
                  >
                    📥 Export View
                  </button>
                  <button
                    onClick={() => exportToExcel(true)}
                    className="btn-primary"
                    style={{ padding: '0.55rem 0.8rem', fontSize: '0.75rem', background: '#059669', borderRadius: '0 0.5rem 0.5rem 0', borderLeft: '1px solid rgba(255,255,255,0.1)' }}
                    title="Ekspor seluruh data database"
                  >
                    All
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem' }}>
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Total Laporan</p>
                <h3 style={{ fontSize: '1.75rem' }}>{stats.total}</h3>
              </div>
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', borderLeft: '4px solid #f59e0b' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Menunggu</p>
                <h3 style={{ fontSize: '1.75rem', color: '#f59e0b' }}>{stats.menunggu || 0}</h3>
              </div>
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', borderLeft: '4px solid var(--status-process)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Diproses</p>
                <h3 style={{ fontSize: '1.75rem', color: 'var(--status-process)' }}>{stats.proses}</h3>
              </div>
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', borderLeft: '4px solid var(--status-success)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Selesai</p>
                <h3 style={{ fontSize: '1.75rem', color: 'var(--status-success)' }}>{stats.selesai}</h3>
              </div>
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', borderLeft: '4px solid var(--status-cancel)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Dibatalkan</p>
                <h3 style={{ fontSize: '1.75rem', color: 'var(--status-cancel)' }}>{stats.cancel}</h3>
              </div>
            </div>
          </header>

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Daftar Semua Laporan</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="btn-primary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: currentPage === 1 ? 'rgba(255,255,255,0.05)' : 'var(--primary)' }}
                  disabled={currentPage === 1}
                  onClick={() => onPageChange(currentPage - 1)}
                >
                  &larr; Prev
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Hal {currentPage} dari {totalPages || 1}</span>
                <button
                  className="btn-primary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: currentPage >= totalPages ? 'rgba(255,255,255,0.05)' : 'var(--primary)' }}
                  disabled={currentPage >= totalPages}
                  onClick={() => onPageChange(currentPage + 1)}
                >
                  Next &rarr;
                </button>
              </div>
            </div>
            <div className="glass-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <th style={{ padding: '1.25rem' }}>Pelapor / Divisi</th>
                    <th style={{ padding: '1.25rem' }}>Kategori & Waktu</th>
                    <th style={{ padding: '1.25rem' }}>Deskripsi & Bukti</th>
                    <th style={{ padding: '1.25rem' }}>Status</th>
                    <th style={{ padding: '1.25rem' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada data laporan.</td>
                    </tr>
                  ) : (
                    [...filteredReports].reverse().map(report => (
                      <tr key={report.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                        <td style={{ padding: '1.25rem' }}>
                          <p style={{ fontWeight: '600', color: 'white' }}>{report.reporterName}</p>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{report.division}</p>
                        </td>
                        <td style={{ padding: '1.25rem' }}>
                          <p style={{ fontWeight: '500' }}>{report.category}</p>
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(report.created_at).toLocaleString('id-ID')}</p>
                        </td>
                        <td style={{ padding: '1.25rem' }}>
                          <p style={{ maxWidth: '250px', fontSize: '0.85rem', marginBottom: '0.3rem' }} title={report.description}>
                            {report.description}
                          </p>
                          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                            {report.driveLink ? (
                              <a href={report.driveLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                🔗 Bukti Lapor
                              </a>
                            ) : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tanpa Bukti</span>}

                            {report.resolution_link && (
                              <a href={report.resolution_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--status-success)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                ✅ Bukti Hasil
                              </a>
                            )}
                          </div>
                          {report.admin_note && (
                            <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', borderLeft: '2px solid var(--status-success)', fontSize: '0.75rem' }}>
                              <strong style={{ color: 'var(--status-success)' }}>Catatan:</strong> {report.admin_note}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '1.25rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-start' }}>
                            <span className={`status-badge badge-${report.status.toLowerCase().replace(' ', '-')}`}>
                              {report.status}
                            </span>
                            {(report.status === 'On Process' || report.status === 'Selesai') && (
                              <LiveTimer
                                acceptedAt={report.accepted_at}
                                completedAt={report.completed_at}
                                status={report.status}
                              />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '1.25rem' }}>
                          <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
                            {report.status && report.status.toLowerCase() === 'menunggu' && (
                              <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
                                <button
                                  className="btn-primary"
                                  style={{ padding: '0.4rem', fontSize: '0.75rem', background: 'var(--status-process)' }}
                                  onClick={() => {
                                    setSelectedReport(report);
                                    setModalMode('accept');
                                    setIsModalOpen(true);
                                  }}
                                >
                                  ▶ Terima
                                </button>
                                <button
                                  className="btn-primary"
                                  style={{ padding: '0.4rem', fontSize: '0.75rem', background: 'rgba(239,68,68,0.2)', color: 'var(--status-cancel)' }}
                                  onClick={() => {
                                    setSelectedReport(report);
                                    setModalMode('reject');
                                    setResolutionNote('');
                                    setIsModalOpen(true);
                                  }}
                                >
                                  ✖ Tolak
                                </button>
                              </div>
                            )}
                            {report.status && report.status.toLowerCase() === 'on process' && (
                              <button
                                className="btn-primary"
                                style={{ padding: '0.5rem', fontSize: '0.8rem', background: 'var(--status-success)' }}
                                onClick={() => {
                                  setSelectedReport(report);
                                  setModalMode('resolve');
                                  setResolutionNote(report.admin_note || '');
                                  setIsModalOpen(true);
                                }}
                              >
                                Selesaikan
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="animate-fade-in">
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Manajemen User & PIN</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem' }}>
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Tambah User Baru</h3>
              <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nama Lengkap</label>
                  <input
                    type="text"
                    className="input-field"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="Nama User"
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>PIN Akses (4 Digit)</label>
                  <input
                    type="text"
                    className="input-field"
                    maxLength="4"
                    value={newUser.pin}
                    onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/[^0-9]/g, '') })}
                    placeholder="Contoh: 1234"
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Role</label>
                  <select
                    className="input-field"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="reporter">Reporter</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="btn-primary" style={{ padding: '0.75rem', marginTop: '0.5rem' }}>
                  Simpan User
                </button>
              </form>
            </div>

            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Daftar User Aktif</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {users.map(user => (
                  <div key={user.id} style={{
                    background: 'rgba(255,255,255,0.03)',
                    padding: '0.75rem 1rem',
                    borderRadius: '0.75rem',
                    border: editingUser === user.id ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                    transition: 'all 0.3s ease'
                  }}>
                    {editingUser === user.id ? (
                      <form onSubmit={handleUpdateUser} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div style={{ flex: 2, minWidth: '150px' }}>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Edit Nama</label>
                          <input
                            type="text"
                            className="input-field"
                            style={{ padding: '0.4rem' }}
                            value={editFormData.name}
                            onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                            required
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: '80px' }}>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Edit PIN</label>
                          <input
                            type="text"
                            className="input-field"
                            style={{ padding: '0.4rem' }}
                            maxLength="4"
                            value={editFormData.pin}
                            onChange={(e) => setEditFormData({ ...editFormData, pin: e.target.value.replace(/[^0-9]/g, '') })}
                            required
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: '100px' }}>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Role</label>
                          <select
                            className="input-field"
                            style={{ padding: '0.4rem' }}
                            value={editFormData.role}
                            onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                          >
                            <option value="reporter">Reporter</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button type="submit" className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', background: 'var(--status-success)' }}>
                            Update
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingUser(null)}
                            style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.75rem' }}
                          >
                            Batal
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontWeight: '600' }}>{user.name}</p>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Role: <span style={{ color: user.role === 'admin' ? 'var(--status-process)' : 'var(--primary)' }}>{user.role}</span> | PIN: ****
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => handleEditClick(user)}
                            style={{
                              background: 'rgba(129,140,248,0.1)',
                              color: 'var(--primary)',
                              padding: '0.4rem 0.8rem',
                              borderRadius: '0.5rem',
                              fontSize: '0.75rem'
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user)}
                            style={{
                              background: (user.pin === '9999' || user.name === 'Admin Master' || user.role === 'master') ? 'rgba(255,255,255,0.05)' : 'rgba(239,68,68,0.1)',
                              color: (user.pin === '9999' || user.name === 'Admin Master' || user.role === 'master') ? 'var(--text-muted)' : 'var(--status-cancel)',
                              padding: '0.4rem 0.8rem',
                              borderRadius: '0.5rem',
                              fontSize: '0.75rem',
                              cursor: (user.pin === '9999' || user.name === 'Admin Master' || user.role === 'master') ? 'not-allowed' : 'pointer'
                            }}
                            disabled={user.pin === '9999' || user.name === 'Admin Master' || user.role === 'master'}
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Resolution Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="glass-card animate-fade-in" style={{ padding: '2rem', width: '100%', maxWidth: '500px' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>
              {modalMode === 'accept' && 'Terima Laporan'}
              {modalMode === 'reject' && 'Tolak Laporan'}
              {modalMode === 'resolve' && 'Selesaikan Laporan'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              {modalMode === 'accept' && 'Apakah Anda yakin ingin mulai mengerjakan laporan ini? status akan berubah menjadi On Process.'}
              {modalMode === 'reject' && 'Berikan alasan mengapa laporan ini ditolak.'}
              {modalMode === 'resolve' && 'Berikan catatan penanganan atau link drive bukti penyelesaian.'}
            </p>

            {(modalMode === 'reject' || modalMode === 'resolve') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem', fontWeight: '500' }}>
                    {modalMode === 'reject' ? 'Alasan Penolakan' : 'Catatan Resolusi (Hasil Perbaikan)'}
                  </label>
                  <textarea
                    className="input-field"
                    style={{ height: '100px', resize: 'none' }}
                    placeholder={modalMode === 'reject' ? 'Contoh: Masalah tidak sesuai kategori...' : 'Jelaskan apa saja yang sudah diperbaiki...'}
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                  />
                </div>

                {modalMode === 'resolve' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Banner Folder Drive Pusat */}
                    <div style={{
                      background: 'rgba(52, 211, 153, 0.08)',
                      border: '1px solid rgba(52, 211, 153, 0.2)',
                      borderRadius: '10px',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#34d399', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        📂 Folder Pusat Bukti Penyelesaian
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                        Unggah foto/video hasil perbaikan ke Drive, lalu salin link file spesifik ke kolom di bawah.
                      </p>
                      <a
                        href="https://drive.google.com/drive/folders/1h1YrRgDbeoiAMrPzgPZMqz5OcW7kHmjp?usp=sharing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                        style={{
                          marginTop: '0.25rem',
                          padding: '0.4rem 0.75rem',
                          fontSize: '0.75rem',
                          textAlign: 'center',
                          textDecoration: 'none',
                          display: 'inline-block',
                          width: 'auto',
                          alignSelf: 'flex-start',
                          background: 'rgba(52, 211, 153, 0.15)',
                          border: '1px solid rgba(52, 211, 153, 0.3)',
                          color: '#34d399',
                          borderRadius: '0.5rem'
                        }}
                      >
                        Buka Folder Drive Pusat →
                      </a>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem', fontWeight: '500' }}>
                        Link Drive Bukti Penyelesaian
                      </label>
                      <input
                        type="url"
                        className="input-field"
                        placeholder="https://drive.google.com/..."
                        value={resolutionLink}
                        onChange={(e) => setResolutionLink(e.target.value)}
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        *Link khusus file hasil perbaikan, bukan link folder.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="btn-primary"
                style={{ flex: 1, background: 'transparent', border: '1px solid var(--glass-border)' }}
                onClick={() => {
                  setIsModalOpen(false);
                  setModalMode('');
                }}
              >
                Batal
              </button>
              <button
                className="btn-primary"
                style={{
                  flex: 2,
                  background: modalMode === 'reject' ? 'var(--status-cancel)' : (modalMode === 'accept' ? 'var(--status-process)' : 'var(--status-success)')
                }}
                onClick={confirmAction}
              >
                {modalMode === 'accept' && 'Ya, Terima'}
                {modalMode === 'reject' && 'Tolak Sekarang'}
                {modalMode === 'resolve' && 'Selesaikan & Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminView;
