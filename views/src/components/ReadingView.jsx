import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const ShadowEmail = ({ content }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      if (!containerRef.current.shadowRoot) {
        containerRef.current.attachShadow({ mode: 'open' });
      }

      const shadow = containerRef.current.shadowRoot;
      shadow.innerHTML = `
        <style>
          :host {
            display: block;
            color: var(--text-primary);
            font-family: inherit;
            overflow-x: auto;
            line-height: 1.6;
            white-space: pre-wrap;
          }
          a { color: var(--accent-color); }
        </style>
        <div>${content}</div>
      `;
    }
  }, [content]);

  return <div ref={containerRef} />;
};

const ReadingView = ({ email, folder, onTriggerMaintenance }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showDraftBox, setShowDraftBox] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [redraftInstruction, setRedraftInstruction] = useState('');

  const draftBoxRef = useRef(null);

  // Auto-scroll to draft box when it opens
  useEffect(() => {
    if (showDraftBox && draftBoxRef.current) {
      setTimeout(() => {
        draftBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    }
  }, [showDraftBox]);

  useEffect(() => {
    const fetchThread = async () => {
      setLoading(true);
      setShowSummary(false);
      setSummary(null);
      // Fetch thread history
      const data = await api.fetchThreadHistory(folder, email.internal_thread_id);
      if (data && data.messages) {
        setHistory(data.messages);
      } else {
        setHistory([]);
      }

      // Inline Draft Rendering
      if (data && data.draft) {
        setDraftText(data.draft);
        setShowDraftBox(true);
      } else {
        setDraftText('');
        setShowDraftBox(false);
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

  const handleRedraft = async () => {
    if (!redraftInstruction.trim() || !draftText.trim()) return;
    
    const earlierDraft = draftText;
    const currentInstruction = redraftInstruction; // Capture before clearing
    setRedraftInstruction(''); // Wipe out immediately
    setDraftText(''); // Clear to prepare for stream
    setIsDrafting(true);

    try {
      const response = await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/redraft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_comments: currentInstruction, earlier_draft: earlierDraft })
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep incomplete chunk

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              setIsDrafting(false);
              return;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.token && parsed.token !== '[SSE_WAITING]') {
                setDraftText((prev) => prev + parsed.token);
              } else if (parsed.error) {
                console.error(parsed.error);
                setIsDrafting(false);
              }
            } catch (err) {
              console.error('Error parsing SSE', err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Redraft Error', err);
      setIsDrafting(false);
    }
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
    <div className="glass-panel" style={{ flex: 1.5, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minHeight: 0 }}>

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
                  <span><strong>{msg.sender || msg.from}</strong></span>
                  <span>{new Date(msg.timestamp || msg.date || email.date).toLocaleString()}</span>
                </div>
                <ShadowEmail content={msg.bodyHtml || msg.body || msg.snippet} />
              </div>
            );
          })
        ) : (
          <div style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {email.snippet}
          </div>
        )}
      </div>

      {/* Footer Actions (Pinned to bottom) */}
      {!showDraftBox && (
        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--panel-border)', display: 'flex', gap: '1rem', background: 'rgba(0,0,0,0.2)' }}>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
            onClick={handleDraft}
          >
            ↪️ Reply
          </button>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
            onClick={() => onTriggerMaintenance('Forward Action')}
          >
            ↪️ Forward
          </button>
        </div>
      )}

      {/* Inline Draft Box (Pinned to bottom) */}
      {showDraftBox && (
        <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(99, 102, 241, 0.4)', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontWeight: '600', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              ✨ AI Draft
              {isDrafting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
            </span>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowDraftBox(false)} style={{ color: 'var(--text-secondary)' }}>✕</button>
          </div>

          <input 
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && redraftInstruction.trim() && !isDrafting) {
                e.preventDefault();
                handleRedraft();
              }
            }}
            type="text" 
            placeholder="Instructions for redrafting..." 
            value={redraftInstruction}
            onChange={(e) => setRedraftInstruction(e.target.value)}
            disabled={isDrafting}
            style={{
              width: '100%',
              marginBottom: '1rem',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />

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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }} onMouseDown={(e) => e.stopPropagation()}>
            <button 
              className="btn-primary" 
              style={{ background: 'transparent', border: '1px solid var(--panel-border)', opacity: (isDrafting || !redraftInstruction.trim()) ? 0.5 : 1 }}
              onClick={handleRedraft}
              disabled={isDrafting || !redraftInstruction.trim()}
            >
              Redraft
            </button>
            <button className="btn-primary" disabled={isDrafting}>
              Send
            </button>
          </div>
        </div>
      )}

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
