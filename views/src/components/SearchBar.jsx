import React from 'react';

const SearchBar = ({ searchQuery, setSearchQuery }) => {
  return (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '8px',
        padding: '0.5rem 1rem',
        border: '1px solid var(--border-color)',
        transition: 'all 0.3s ease',
      }}>
        <span style={{ marginRight: '0.5rem', opacity: 0.5 }}>🔍</span>
        <input
          type="text"
          placeholder="Search emails globally..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            outline: 'none',
          }}
        />
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery('')}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer',
              opacity: 0.7,
            }}
          >
            ✖
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
