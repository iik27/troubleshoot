-- ============================================================
-- MIGRATION: Tambah kolom complaint_number ke tabel reports
-- ============================================================
-- Jalankan script ini di: Supabase Dashboard > SQL Editor
--
-- CATATAN:
-- Kolom ini dibuat NULLABLE (tidak wajib) agar data laporan
-- yang sudah ada sebelumnya tidak terpengaruh / tidak error.
-- Hanya laporan BARU yang akan memiliki No. Pengaduan.
-- ============================================================

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS complaint_number TEXT;

-- Opsional: Tambahkan index agar pencarian by complaint_number lebih cepat
CREATE INDEX IF NOT EXISTS idx_reports_complaint_number ON reports(complaint_number);
