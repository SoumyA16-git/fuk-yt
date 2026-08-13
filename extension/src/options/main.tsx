import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

function OptionsPage() {
  return (
    <div style={{
      maxWidth: 600,
      margin: '40px auto',
      padding: '0 24px 60px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontSize: 24,
          fontWeight: 800,
          background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          FUK-YT Options
        </h1>
        <p style={{ color: '#a3a3a3', marginTop: 4 }}>
          No settings are required for the new simplified FUK-YT. Just click the download button on any video!
        </p>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<OptionsPage />);
