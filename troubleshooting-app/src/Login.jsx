import React, { useState } from 'react';
import { supabase } from './supabase';

const Login = ({ onLogin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { data, error: sbError } = await supabase
        .from('profiles')
        .select('role, name')
        .eq('pin', pin)
        .single();

      console.log('Supabase Login Attempt:', { data, sbError });

      if (sbError || !data) {
        if (sbError) console.error('Supabase Error details:', sbError);
        setError('PIN Salah atau masalah koneksi. Silakan coba lagi.');
        setPin('');
      } else {
        onLogin(data.role, data.name);
      }
    } catch (err) {
      setError('Terjadi kesalahan koneksi. Pastikan SQL sudah di-Run di Supabase.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '1rem'
    }}>
      <div className="glass-card" style={{ padding: '3rem', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem', background: 'linear-gradient(to right, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Beresin Masalah
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '1.5rem' }}>
          "Satu Akses, Urusan Beres"
        </p>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Masukkan PIN untuk mengakses sistem</p>
        
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <input 
              type="password"
              className="input-field"
              placeholder="••••"
              maxLength="4"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
              style={{ fontSize: '2rem', textAlign: 'center', letterSpacing: '0.5rem' }}
              autoFocus
              disabled={isLoading}
            />
          </div>
          
          {error && (
            <p style={{ color: 'var(--status-cancel)', fontSize: '0.85rem' }}>{error}</p>
          )}

          <button type="submit" className="btn-primary" style={{ padding: '1rem' }} disabled={isLoading}>
            {isLoading ? 'Memproses...' : 'Masuk Sekarang'}
          </button>
        </form>
        
        <div style={{ marginTop: '2.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <p>Login menggunakan PIN yang sudah didaftarkan.</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
