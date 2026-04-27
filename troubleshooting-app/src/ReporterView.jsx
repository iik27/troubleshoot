import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

// ============================================================
// FUNGSI: Generate No. Pengaduan Otomatis
// Format: BM-YYYYMMDD-XXXX
// Contoh: BM-20260402-A3F1
// Dibuat unik dengan kombinasi tanggal + 4 karakter random (A-Z, 0-9)
// ============================================================
const generateComplaintNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // 4 karakter random: huruf kapital (A-Z) dan angka (0-9)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomSuffix = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');

  return `BM-${dateStr}-${randomSuffix}`;
};

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

const ReporterView = ({ onReportSubmit, reports, userProfile, totalReports, currentPage, onPageChange }) => {
  const [formData, setFormData] = useState({
    reporterName: userProfile?.name || '',
    division: 'Operasional',
    category: 'Kerusakan Perangkat',
    customCategory: '',
    description: '',
    evidenceType: 'link', // 'file' or 'link'
    evidence: null,
    manualLink: '',
    complaintNumber: generateComplaintNumber(), // Generate saat form pertama kali dibuat
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState(null); // { message, type, id }
  
  // REAL-TIME NOTIFICATIONS
  useEffect(() => {
    if (!userProfile?.name) return;

    console.log('Subscribing to real-time updates for:', userProfile.name);

    const subscription = supabase
      .channel('reporter_notifications')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reports',
          filter: `reporter_name=eq.${userProfile.name}`
        },
        (payload) => {
          console.log('Real-time change detected:', payload);
          const oldStatus = payload.old?.status;
          const newStatus = payload.new?.status;

          if (oldStatus !== newStatus) {
            const complaintNum = payload.new.complaint_number || 'Laporan';
            setNotification({
              id: Date.now(),
              message: `📢 ${complaintNum} Anda telah diperbarui menjadi: ${newStatus}`,
              type: newStatus.toLowerCase().includes('selesai') ? 'success' : 'info'
            });

            // Auto-hide after 10 seconds
            setTimeout(() => setNotification(null), 10000);
            
            // Refresh the list automatically
            onReportSubmit();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [userProfile?.name]);
  
  const totalPages = Math.ceil(totalReports / 10);

  // Keep name in sync with session
  React.useEffect(() => {
    if (userProfile?.name) {
      setFormData(prev => ({ ...prev, reporterName: userProfile.name }));
    }
  }, [userProfile]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // 1. Validasi Link Google Drive (Jika tipe link)
      if (formData.evidenceType === 'link') {
        const driveRegex = /drive\.google\.com/;
        if (!driveRegex.test(formData.manualLink)) {
          alert('Gagal! Link bukti harus merupakan link Google Drive (mengandung drive.google.com). Contoh: https://drive.google.com/file/d/...');
          return;
        }
      }

      // 2. Cooldown Logic (Anti-Spam 1 Menit)
      const lastSubmit = localStorage.getItem('tb_last_submit');
      const now = Date.now();
      if (lastSubmit && now - parseInt(lastSubmit) < 60000) {
        const remaining = Math.ceil((60000 - (now - parseInt(lastSubmit))) / 1000);
        alert(`Mohon tunggu ${remaining} detik lagi sebelum mengirim laporan berikutnya.`);
        return;
      }

      setIsSubmitting(true);
      
      let finalLink = formData.manualLink;

      // Simulate File Upload only if type is 'file' and no manual link provided
      if (formData.evidenceType === 'file' && formData.evidence) {
        finalLink = `https://drive.google.com/file/d/upload_${Math.random().toString(36).substring(7)}/view`;
      }
      
      // Determine the final category string
      const finalCategory = formData.category === 'Lainnya' 
        ? `Lainnya: ${formData.customCategory}` 
        : formData.category;

      const { data, error } = await supabase
        .from('reports')
        .insert([
          {
            reporter_name: formData.reporterName,
            division: formData.division,
            category: finalCategory,
            description: formData.description,
            drive_link: finalLink,
            status: 'Menunggu',
            complaint_number: formData.complaintNumber, // Simpan No. Pengaduan ke DB
          }
        ])
        .select();

      if (!error) {
        localStorage.setItem('tb_last_submit', Date.now().toString());
        onReportSubmit(); // Refresh the list in App.jsx
        // Reset form dan generate No. Pengaduan BARU untuk laporan berikutnya
        setFormData({ 
          ...formData,
          category: 'Kerusakan Perangkat', 
          customCategory: '',
          description: '', 
          evidence: null,
          manualLink: '',
          complaintNumber: generateComplaintNumber(), // Nomor baru untuk laporan selanjutnya
        });
        alert('Laporan berhasil terkirim!');
      } else {
        console.error('Supabase Insert Error:', error);
        alert(`Gagal mengirim laporan. Error Database: ${error.message || error.details || 'Gagal tersimpan'}`);
      }
    } catch (err) {
      console.error('Unexpected Error:', err);
      alert(`Terjadi kesalahan sistem: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      {/* Floating Notification */}
      {notification && (
        <div 
          className="animate-slide-in"
          style={{
            position: 'fixed',
            top: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: notification.type === 'success' ? 'var(--status-success)' : 'var(--primary)',
            color: 'white',
            padding: '1rem 1.5rem',
            borderRadius: '12px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            minWidth: '300px'
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ✕
          </button>
        </div>
      )}

      <section className="glass-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Lapor Masalah</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Nama Pelapor</label>
              <input 
                type="text"
                className="input-field"
                placeholder="Masukkan nama lengkap"
                value={formData.reporterName}
                readOnly
                style={{ background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed', color: 'var(--primary)' }}
                title="Nama sudah terkunci sesuai akun login"
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Divisi Pelaporan</label>
              <select 
                className="input-field" 
                value={formData.division}
                onChange={(e) => setFormData({...formData, division: e.target.value})}
              >
                <option value="Operasional">Operasional</option>
                <option value="IT Hub">IT Hub</option>
                <option value="Marketing">Marketing</option>
                <option value="Finance">Finance</option>
                <option value="HRD">HRD</option>
                <option value="Business Development">Business Development</option>
                <option value="Quality Control">Quality Control</option>
                <option value="Trainer">Trainer</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: formData.category === 'Lainnya' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Kategori Kendala</label>
              <select 
                className="input-field" 
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
              >
                <option value="Kerusakan Perangkat">Kerusakan Perangkat</option>
                <option value="Penambahan Menu">Penambahan Menu</option>
                <option value="Perubahan Data">Perubahan Data</option>
                <option value="Pelatihan Ulang">Pelatihan Ulang</option>
                <option value="Lainnya">Lainnya</option>
              </select>
            </div>

            {formData.category === 'Lainnya' && (
              <div className="animate-fade-in">
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Sebutkan Kendala</label>
                <input 
                  type="text"
                  className="input-field"
                  placeholder="Contoh: Lampu Mati"
                  value={formData.customCategory}
                  onChange={(e) => setFormData({...formData, customCategory: e.target.value})}
                  required
                />
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Deskripsi Permasalahan</label>
            <textarea 
              className="input-field" 
              rows="4"
              placeholder="Jelaskan detail kendala yang dialami..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              required
            />
          </div>

          {/* Banner No. Pengaduan - Panduan Penamaan File */}
          <div style={{
            background: 'rgba(192, 132, 252, 0.08)',
            border: '1px solid rgba(192, 132, 252, 0.25)',
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>No. Pengaduan Anda</p>
              <p style={{ fontSize: '1.35rem', fontWeight: '700', fontFamily: 'monospace', color: '#c084fc', margin: 0, letterSpacing: '0.05em' }}>
                {formData.complaintNumber}
              </p>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right', lineHeight: '1.6' }}>
              <p style={{ margin: 0 }}>📌 Gunakan nomor ini sebagai nama file bukti Anda.</p>
              <p style={{ margin: 0 }}>Contoh: <span style={{ color: 'white', fontFamily: 'monospace' }}>{formData.complaintNumber}_bukti.jpg</span></p>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
              Bukti Foto/Video <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>(Link Drive disarankan)</span>
            </label>

            {/* Banner Folder Drive Pusat */}
            <div style={{ 
              background: 'rgba(129, 140, 248, 0.1)', 
              border: '1px solid rgba(129, 140, 248, 0.2)', 
              borderRadius: '12px', 
              padding: '1rem', 
              marginBottom: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#818cf8', fontWeight: 'bold', fontSize: '0.9rem' }}>
                📂 Folder Pusat Bukti Pelaporan
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                1. Klik link di bawah untuk membuka Google Drive.<br/>
                2. Unggah file Anda ke sana.<br/>
                3. Klik kanan file Anda &rarr; "Dapatkan Link" &rarr; Ubah akses ke "Siapa saja yang memiliki link".<br/>
                4. Salin dan tempel Link Spesifik file tersebut ke kolom input di bawah.
              </p>
              <a 
                href="https://drive.google.com/drive/folders/1h1YrRgDbeoiAMrPzgPZMqz5OcW7kHmjp?usp=sharing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn-primary"
                style={{ 
                  marginTop: '0.5rem', 
                  padding: '0.5rem', 
                  fontSize: '0.8rem', 
                  textAlign: 'center', 
                  textDecoration: 'none',
                  display: 'inline-block',
                  width: 'auto',
                  alignSelf: 'flex-start'
                }}
              >
                Buka Folder Drive Pusat &rarr;
              </a>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button 
                type="button"
                onClick={() => setFormData({...formData, evidenceType: 'link'})}
                style={{ 
                  flex: 1, 
                  padding: '0.6rem', 
                  fontSize: '0.85rem',
                  color: 'white',
                  background: formData.evidenceType === 'link' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                  border: formData.evidenceType === 'link' ? 'none' : '1px solid var(--glass-border)'
                }}
              >
                🔗 Tempel Link
              </button>
              <button 
                type="button"
                onClick={() => {}}
                disabled={true}
                style={{ 
                  flex: 1, 
                  padding: '0.6rem', 
                  fontSize: '0.85rem',
                  color: 'white',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--glass-border)',
                  opacity: 0.5,
                  cursor: 'not-allowed'
                }}
                title="Fitur ini sementara dinonaktifkan. Gunakan Link Drive."
              >
                📁 Unggah File (Off)
              </button>
            </div>

            {formData.evidenceType === 'link' ? (
              <input 
                type="url"
                className="input-field animate-fade-in"
                placeholder="https://drive.google.com/..."
                value={formData.manualLink}
                onChange={(e) => setFormData({...formData, manualLink: e.target.value})}
                required
              />
            ) : (
              <div 
                className="input-field animate-fade-in" 
                style={{ borderStyle: 'dashed', textAlign: 'center', padding: '1.5rem', cursor: 'not-allowed', opacity: 0.5 }}
              >
                Fitur Unggah File Sementara Dinonaktifkan
              </div>
            )}
          </div>

          <button type="submit" className="btn-primary" style={{ padding: '1rem', width: '100%' }} disabled={isSubmitting}>
            {isSubmitting ? 'Mengirim...' : 'Kirim Laporan'}
          </button>
        </form>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Riwayat Laporan Saya</h2>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {reports.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Belum ada laporan yang diajukan.</p>
          ) : (
            reports.map(report => (
              <div key={report.id} className="glass-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                  <div>
                    {/* Tampilkan No. Pengaduan jika ada (laporan baru) */}
                    {report.complaint_number && (
                      <p style={{ fontSize: '0.7rem', color: '#c084fc', fontFamily: 'monospace', fontWeight: '600', margin: '0 0 0.25rem 0', letterSpacing: '0.05em' }}>
                        🎫 {report.complaint_number}
                      </p>
                    )}
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>{report.category}</h3>
                    <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>👤 {report.reporterName}</span>
                      <span>🏢 {report.division}</span>
                      <span>🕒 {report.timestamp}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
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
                </div>
                <p style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>{report.description}</p>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <a 
                    href={report.driveLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    📁 Bukti Lapor
                  </a>
                  {report.resolution_link && (
                    <a 
                      href={report.resolution_link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: 'var(--status-success)', fontSize: '0.85rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      ✅ Bukti Hasil Perbaikan
                    </a>
                  )}
                </div>
                
                {report.admin_note && (
                  <div style={{ 
                    marginTop: '1rem', 
                    padding: '0.75rem', 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '6px', 
                    borderLeft: `3px solid ${report.status === 'Selesai' ? 'var(--status-success)' : 'var(--status-cancel)'}`
                  }}>
                    <strong style={{ 
                      fontSize: '0.8rem', 
                      display: 'block', 
                      marginBottom: '0.25rem',
                      color: report.status === 'Selesai' ? 'var(--status-success)' : 'var(--status-cancel)'
                    }}>
                      Catatan Admin ({report.status}):
                    </strong>
                    <p style={{ fontSize: '0.85rem' }}>{report.admin_note}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export default ReporterView;
