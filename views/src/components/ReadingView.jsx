import React, { useState, useEffect } from 'react';
import { api } from '../api';

const ReadingView = ({ email, folder, onTriggerMaintenance }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showDraftBox, setShowDraftBox] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(() => {
    const fetchThread = async () => {
      setLoading(true);
      setShowSummary(false);
      setSummary(null);
      // Fetch thread history
      const data = await api.fetchThreadHistory(folder, email.internal_thread_id);
      if (data && data.history) {
        setHistory(data.history);
      } else {
        setHistory([]);
      }
      setLoading(false);
    };

    fetchThread();
  }, [email, folder]);

  const handleSummarise = async () => {
    setShowSummary(!showSummary);
    if (!summary && !showSummary) {
      const data = await api.fetchSummary(folder, email.internal_thread_id);
      if (data) {
        setSummary(data.summary || data);
      }
    }
  };

  const handleDraft = () => {
    setShowDraftBox(true);
    if (draftText !== '') return; // Don't refetch if we already have it

    setIsDrafting(true);
    const eventSource = new EventSource(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/draft`);
    
    eventSource.onmessage = (event) => {
      if (event.data === '[DONE]') {
        eventSource.close();
        setIsDrafting(false);
        return;
      }
      
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.token) {
          if (parsed.token !== '[SSE_WAITING]') {
             setDraftText((prev) => prev + parsed.token);
          }
        } else if (parsed.error) {
          console.error(parsed.error);
          eventSource.close();
          setIsDrafting(false);
        }
      } catch (err) {
        console.error('Error parsing SSE', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error', err);
      eventSource.close();
      setIsDrafting(false);
    };
  };

  const getCategoryBadge = (categories) => {
    if (!categories) return null;
    let color = 'transparent';
    let icon = '📌';
    if (categories.includes('Attention')) { color = 'rgba(239, 68, 68, 0.2)'; icon = '🔴'; }
    else if (categories.includes('Work & Professional')) { color = 'rgba(59, 130, 246, 0.2)'; icon = '💼'; }
    else if (categories.includes('Personal & Social')) { color = 'rgba(16, 185, 129, 0.2)'; icon = '🟢'; }
    else if (categories.includes('Spam')) { color = 'rgba(107, 114, 128, 0.2)'; icon = '🚫'; }
    
    return (
      <span style={{ 
        background: color, 
        padding: '0.25rem 0.75rem', 
        borderRadius: '16px', 
        fontSize: '0.8rem',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        {icon} {categories}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ flex: 1.5, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      
      {/* Header */}
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem' }}>{email.subject || '(No Subject)'}</h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            From: <strong>{email.sender_name || email.sender_email}</strong> &lt;{email.sender_email}&gt;
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {getCategoryBadge(email.ai_categories)}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
             <button onClick={() => onTriggerMaintenance('Star Action')} title="Star" style={{ fontSize: '1.2rem', opacity: 0.7 }}>⭐</button>
             <button onClick={() => onTriggerMaintenance('Delete/Trash Action')} title="Delete" style={{ fontSize: '1.2rem', opacity: 0.7 }}>🗑️</button>
          </div>
        </div>
      </div>

      {/* Thread Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {history.length > 0 ? (
          history.map((msg, idx) => {
            const isLatest = idx === history.length - 1;
            return (
              <div key={idx} style={{ 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: '8px', 
                padding: '1.5rem',
                border: isLatest ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--panel-border)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  <span><strong>{msg.sender}</strong></span>
                  <span>{new Date(msg.timestamp || email.date).toLocaleString()}</span>
                </div>
                <div style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: msg.body || msg.snippet }}></div>
              </div>
            );
          })
        ) : (
          <div style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
             {email.snippet}
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', paddingBottom: '2rem' }}>
           <button 
             className="btn-primary" 
             style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
             onClick={handleDraft}
           >
             ✨ AI Draft Reply
           </button>
           <button 
             className="btn-primary" 
             style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
             onClick={() => onTriggerMaintenance('Forward Action')}
           >
             ↪️ Forward
           </button>
        </div>

        {/* Inline Draft Box */}
        {showDraftBox && (
          <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(99, 102, 241, 0.4)', marginTop: '-1rem', marginBottom: '2rem' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontWeight: '600', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                   ✨ AI Draft
                   {isDrafting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
                </span>
                <button onClick={() => setShowDraftBox(false)} style={{ color: 'var(--text-secondary)' }}>✕</button>
             </div>
             <textarea 
               value={draftText}
               onChange={(e) => setDraftText(e.target.value)}
               style={{
                 width: '100%',
                 minHeight: '150px',
                 background: 'rgba(0,0,0,0.2)',
                 border: '1px solid var(--panel-border)',
                 borderRadius: '8px',
                 padding: '1rem',
                 color: 'var(--text-primary)',
                 outline: 'none',
                 resize: 'vertical',
                 lineHeight: '1.5'
               }}
             />
             <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--panel-border)' }}>
                   Redraft
                </button>
                <button className="btn-primary">
                   Send
                </button>
             </div>
          </div>
        )}
      </div>

      {/* Floating Action Buttons */}
      <div style={{ position: 'absolute', bottom: '2rem', right: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button 
          className="btn-primary" 
          style={{ width: '56px', height: '56px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)' }}
          title="AI Summarise"
          onClick={handleSummarise}
        >
          <span style={{ fontSize: '1.5rem' }}>💡</span>
        </button>
      </div>

      {/* Summary Floating Card */}
      {showSummary && (
        <div className="glass-panel" style={{
          position: 'absolute',
          bottom: '5.5rem',
          right: '2rem',
          width: '350px',
          padding: '1.5rem',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 10,
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <button 
            onClick={() => setShowSummary(false)} 
            style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '1.2rem', color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
            <span style={{ fontSize: '1.2rem' }}>💡</span> AI Summary
          </h3>
          {summary ? (
             typeof summary === 'string' ? (
                <p style={{ lineHeight: '1.5', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{summary}</p>
             ) : (
                <p style={{ lineHeight: '1.5', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{summary.short_summary || summary.snippet || JSON.stringify(summary)}</p>
             )
          ) : (
             <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
               <div className="spinner"></div>
               <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Generating premium summary...</span>
             </div>
          )}
        </div>
      )}

    </div>
  );
};

export default ReadingView;
