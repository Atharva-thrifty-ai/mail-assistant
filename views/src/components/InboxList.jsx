import React from 'react';
import SearchBar from './SearchBar';

const InboxList = ({ folder, emails, onSelectEmail, selectedId, onTriggerMaintenance, onRefresh, searchQuery, setSearchQuery }) => {
  if (!emails || emails.length === 0) {
    return (
      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <SearchBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No emails found in {folder.replace('-', ' ')}</p>
        </div>
      </div>
    );
  }

  const getCategoryColor = (categories) => {
    if (!categories) return 'transparent';
    if (categories.includes('Attention')) return 'var(--attention)';
    if (categories.includes('Work & Professional')) return 'var(--work)';
    if (categories.includes('Personal & Social')) return 'var(--personal)';
    if (categories.includes('Spam')) return 'var(--spam)';
    return 'transparent';
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SearchBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', textTransform: 'capitalize' }}>
          {folder.replace('-', ' ')}
        </h2>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {emails.map((email) => {
          const isSelected = selectedId === email.internal_thread_id;
          const isUnread = email.is_unread; // Assumption based on standard email logic

          return (
            <div 
              key={email.internal_thread_id}
              onClick={() => onSelectEmail(email)}
              style={{
                padding: '1rem',
                borderBottom: '1px solid var(--panel-border)',
                background: isSelected ? 'rgba(255,255,255,0.08)' : (isUnread ? 'rgba(255,255,255,0.03)' : 'transparent'),
                cursor: 'pointer',
                transition: 'background 0.2s',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                position: 'relative'
              }}
              onMouseOver={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                const actions = e.currentTarget.querySelector('.quick-actions');
                if (actions) actions.style.opacity = '1';
              }}
              onMouseOut={(e) => {
                if (!isSelected) e.currentTarget.style.background = isUnread ? 'rgba(255,255,255,0.03)' : 'transparent';
                const actions = e.currentTarget.querySelector('.quick-actions');
                if (actions) actions.style.opacity = '0';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ 
                  fontWeight: isUnread ? '600' : '400', 
                  color: isUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: '0.9rem'
                }}>
                  {email.sender_name || email.sender_email.split('@')[0]}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {formatDate(email.date)}
                  </span>
                  {email.is_starred === 1 && <span style={{ fontSize: '0.75rem' }}>⭐</span>}
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getCategoryColor(email.ai_categories) }}></div>
                </div>
              </div>

              <div style={{ fontWeight: isUnread ? '600' : '500', fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email.subject || '(No Subject)'}
              </div>

              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email.snippet}
              </div>

              {/* Hover Actions */}
              <div 
                className="quick-actions"
                style={{
                  position: 'absolute',
                  right: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  gap: '0.5rem',
                  background: 'var(--bg-color)',
                  padding: '0.25rem',
                  borderRadius: '8px',
                  opacity: 0,
                  transition: 'opacity 0.2s',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}
                onClick={(e) => e.stopPropagation()} // Prevent opening email
              >
                <button onClick={(e) => {
                  e.stopPropagation();
                  fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/${email.is_starred === 1 ? 'unstar' : 'star'}`, { method: 'POST' }).then(() => onRefresh && onRefresh());
                }} title={email.is_starred === 1 ? 'Unstar' : 'Star'} style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}>
                  {email.is_starred === 1 ? '⭐' : '☆'}
                </button>
                {folder === 'trash' ? (
                  <button onClick={(e) => {
                    e.stopPropagation();
                    fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/untrash`, { method: 'POST' }).then(() => onRefresh && onRefresh());
                  }} title="Restore" style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}>♻️</button>
                ) : (
                  <button onClick={(e) => {
                    e.stopPropagation();
                    fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/trash`, { method: 'POST' }).then(() => onRefresh && onRefresh());
                  }} title="Delete" style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}>🗑️</button>
                )}
                <button onClick={() => onTriggerMaintenance('Forward Action')} style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}>↪️</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InboxList;
