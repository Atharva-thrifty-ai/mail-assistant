import React, { useState } from 'react';
import TokenModal from './TokenModal';

const Sidebar = ({ activeFolder, onFolderChange }) => {
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const folders = [
    { id: 'inbox', label: 'Inbox', icon: '📥' },
    { id: 'starred', label: 'Starred', icon: '⭐' },
    { id: 'sent', label: 'Sent', icon: '📤' },
    { id: 'drafts', label: 'Drafts', icon: '📝' },
    { id: 'trash', label: 'Trash', icon: '🗑️' }
  ];

  const aiFilters = [
    { id: 'attention', label: 'Attention', color: 'var(--attention)' },
    { id: 'work-professional', label: 'Work & Professional', color: 'var(--work)' },
    { id: 'personal-social', label: 'Personal & Social', color: 'var(--personal)' },
    { id: 'spam', label: 'Spam', color: 'var(--spam)' }
  ];

  return (
    <div className="glass-panel" style={{ width: '260px', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
      <button 
        className="btn-primary" 
        style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        onClick={() => onFolderChange('compose')}
      >
        <span>✏️</span> Compose
      </button>

      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
          Standard
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {folders.map(folder => (
            <button 
              key={folder.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                color: activeFolder === folder.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeFolder === folder.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                textAlign: 'left',
                transition: 'all 0.2s',
                fontWeight: activeFolder === folder.id ? '500' : '400'
              }}
              onClick={() => onFolderChange(folder.id, folder.phase)}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseOut={(e) => e.currentTarget.style.background = activeFolder === folder.id ? 'rgba(255,255,255,0.05)' : 'transparent'}
            >
              <span>{folder.icon}</span> {folder.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
          AI Filters
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {aiFilters.map(filter => (
            <button 
              key={filter.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                color: activeFolder === filter.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeFolder === filter.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                textAlign: 'left',
                transition: 'all 0.2s',
                fontWeight: activeFolder === filter.id ? '500' : '400'
              }}
              onClick={() => onFolderChange(filter.id)}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseOut={(e) => e.currentTarget.style.background = activeFolder === filter.id ? 'rgba(255,255,255,0.05)' : 'transparent'}
            >
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: filter.color }}></div>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
        <button 
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            borderRadius: '8px',
            color: 'var(--text-secondary)',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            transition: 'all 0.2s',
            cursor: 'pointer',
            fontSize: '0.85rem'
          }}
          onClick={() => setIsTokenModalOpen(true)}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
        >
          <span>📊</span> Token Information
        </button>
      </div>

      {isTokenModalOpen && (
        <TokenModal onClose={() => setIsTokenModalOpen(false)} />
      )}
    </div>
  );
};

export default Sidebar;
