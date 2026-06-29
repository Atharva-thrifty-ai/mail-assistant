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

const ReadingView = ({ email, folder, onTriggerMaintenance, onRefresh }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showDraftBox, setShowDraftBox] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [redraftInstruction, setRedraftInstruction] = useState('');
  const [isStarred, setIsStarred] = useState(email?.is_starred === 1);
  
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Forward State
  const [showForwardBox, setShowForwardBox] = useState(false);
  const [forwardText, setForwardText] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [forwardInstruction, setForwardInstruction] = useState('');
  const [isForwardDrafting, setIsForwardDrafting] = useState(false);
  const [showForwardConfirmation, setShowForwardConfirmation] = useState(false);

  const draftBoxRef = useRef(null);

  // Auto-scroll to draft box when it opens
  useEffect(() => {
    if (showDraftBox && draftBoxRef.current) {
      setTimeout(() => {
        draftBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    }
  }, [showDraftBox]);

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

  useEffect(() => {
    fetchThread();
    setIsStarred(email?.is_starred === 1);
  }, [email, folder]);

  const handleToggleStar = async () => {
    const action = isStarred ? 'unstar' : 'star';
    setIsStarred(!isStarred);
    try {
      await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/${action}`, { method: 'POST' });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      setIsStarred(isStarred); // revert on error
    }
  };

  const handleTrash = async () => {
    try {
      await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/trash`, { method: 'POST' });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUntrash = async () => {
    try {
      await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/untrash`, { method: 'POST' });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

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
    if (!redraftInstruction.trim()) return;
    
    setIsDrafting(true);
    setDraftText('');

    try {
      const response = await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/redraft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: redraftInstruction, draftText })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;
            if (dataStr === '[SSE_WAITING]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.text) {
                setDraftText(prev => prev + data.text);
              }
            } catch (e) {
              console.error("Error parsing JSON chunk", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to redraft", error);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleForward = () => {
    setShowForwardBox(true);
    const originalText = history.length > 0 
      ? history.map(m => `From: ${m.sender || m.from}\nDate: ${new Date(m.timestamp || m.date || email.date).toLocaleString()}\n\n${m.body || m.snippet}`).join('\n\n')
      : email.snippet;
    
    setForwardText(`\n\n---------- Forwarded message ---------\n${originalText}`);
  };

  const handleForwardDraft = async () => {
    if (!forwardInstruction.trim()) return;
    
    setIsForwardDrafting(true);
    
    try {
      const response = await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/forward/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: forwardInstruction })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let aiIntro = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              if (data.text) {
                aiIntro += data.text;
                // Prepend AI intro to the original forwarded text
                setForwardText(aiIntro + `\n\n---------- Forwarded message ---------\n` + (history.length > 0 
                  ? history.map(m => `From: ${m.sender || m.from}\nDate: ${new Date(m.timestamp || m.date || email.date).toLocaleString()}\n\n${m.body || m.snippet}`).join('\n\n')
                  : email.snippet));
              }
            } catch (e) {
              console.error("Error parsing JSON chunk", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to generate forward draft", error);
    } finally {
      setIsForwardDrafting(false);
    }
  };

  const executeForward = async () => {
    setIsSending(true);
    try {
      const response = await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/forward/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: forwardTo, draftText: forwardText })
      });
      const data = await response.json();
      if (data.success) {
        setSendSuccess(true);
        setTimeout(() => {
          setShowForwardConfirmation(false);
          setShowForwardBox(false);
          setSendSuccess(false);
          if (onRefresh) onRefresh();
        }, 2000);
      } else {
        alert("Failed to forward.");
      }
    } catch (error) {
      console.error(error);
      alert("Error forwarding.");
    } finally {
      setIsSending(false);
    }
  };

  const handleSendConfirm = async () => {
    setIsSending(true);
    try {
      const response = await fetch(`http://localhost:5000/api/${folder}/${email.internal_thread_id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText })
      });
      if (response.ok) {
        setSendSuccess(true);
        setTimeout(() => {
          setShowSendConfirmation(false);
          setShowDraftBox(false);
          setDraftText('');
          setIsSending(false);
          setSendSuccess(false);
          fetchThread();
        }, 1000);
      } else {
        throw new Error('Failed to send');
      }
    } catch (err) {
      console.error('Send Error', err);
      setIsSending(false);
      alert('Failed to send email.');
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
            <button onClick={handleToggleStar} title={isStarred ? "Unstar" : "Star"} style={{ fontSize: '1.2rem', opacity: isStarred ? 1 : 0.7 }}>
              {isStarred ? '⭐' : '☆'}
            </button>
            {folder === 'trash' ? (
              <button onClick={handleUntrash} title="Restore" style={{ fontSize: '1.2rem', opacity: 0.7 }}>♻️</button>
            ) : (
              <button onClick={handleTrash} title="Delete" style={{ fontSize: '1.2rem', opacity: 0.7 }}>🗑️</button>
            )}
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
      {!showDraftBox && !showForwardBox && (
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
            onClick={handleForward}
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
            <button 
              className="btn-primary" 
              onClick={() => setShowSendConfirmation(true)}
              disabled={isDrafting}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Inline Forward Box (Pinned to bottom) */}
      {showForwardBox && (
        <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(99, 102, 241, 0.4)', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontWeight: '600', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              ↪️ Forward
              {isForwardDrafting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
            </span>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowForwardBox(false)} style={{ color: 'var(--text-secondary)' }}>✕</button>
          </div>

          <input 
            type="email" 
            placeholder="To" 
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
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

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <input 
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && forwardInstruction.trim() && !isForwardDrafting) {
                  e.preventDefault();
                  handleForwardDraft();
                }
              }}
              type="text" 
              placeholder="AI Instructions (e.g. Write a brief intro asking them to review this)" 
              value={forwardInstruction}
              onChange={(e) => setForwardInstruction(e.target.value)}
              disabled={isForwardDrafting}
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--panel-border)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <button 
              className="btn-primary" 
              onClick={handleForwardDraft}
              disabled={isForwardDrafting || !forwardInstruction.trim()}
              style={{ padding: '0.75rem 1.5rem', background: 'rgba(99, 102, 241, 0.2)', border: '1px solid rgba(99, 102, 241, 0.4)' }}
            >
              ✨ AI Intro
            </button>
          </div>

          <textarea
            value={forwardText}
            onChange={(e) => setForwardText(e.target.value)}
            style={{
              width: '100%',
              minHeight: '200px',
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
              onClick={() => setShowForwardConfirmation(true)}
              disabled={isForwardDrafting || !forwardTo.trim()}
            >
              Send Forward
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
      {/* Send Confirmation Modal */}
      {showSendConfirmation && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{
            width: '600px',
            maxWidth: '90vw',
            padding: '2rem',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Confirm Send</h2>
            
            <div style={{
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '1rem',
              color: 'var(--text-secondary)',
              maxHeight: '300px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              fontSize: '0.9rem'
            }}>
              {draftText}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              {!isSending && !sendSuccess && (
                <button 
                  className="btn-secondary" 
                  onClick={() => setShowSendConfirmation(false)}
                  style={{ background: 'transparent', border: '1px solid var(--panel-border)', padding: '0.75rem 1.5rem', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              )}
              
              <button 
                className="btn-primary"
                onClick={handleSendConfirm}
                disabled={isSending || sendSuccess}
                style={{ 
                  minWidth: '120px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  background: sendSuccess ? 'rgba(16, 185, 129, 0.2)' : 'var(--accent-color)',
                  border: sendSuccess ? '1px solid rgba(16, 185, 129, 0.5)' : 'none',
                  color: sendSuccess ? '#10b981' : 'white'
                }}
              >
                {sendSuccess ? (
                  <span style={{ fontSize: '1.2rem' }}>✅</span>
                ) : isSending ? (
                  <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }}></div>
                ) : (
                  'Confirm Send'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Confirmation Modal */}
      {showForwardConfirmation && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ padding: '2rem', width: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'center' }}>
            {sendSuccess ? (
              <>
                <div style={{ fontSize: '3rem', margin: '1rem 0' }}>✅</div>
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Forward Sent!</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Your forwarded email has been dispatched.</p>
              </>
            ) : (
              <>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Send this forward?</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Are you sure you want to forward this email to <strong>{forwardTo}</strong>?</p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
                  <button 
                    onClick={() => setShowForwardConfirmation(false)}
                    disabled={isSending}
                    style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'white', cursor: 'pointer', flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={executeForward}
                    disabled={isSending}
                    className="btn-primary"
                    style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                  >
                    {isSending ? (
                      <>
                        <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
                        Sending...
                      </>
                    ) : (
                      'Yes, Forward'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default ReadingView;
