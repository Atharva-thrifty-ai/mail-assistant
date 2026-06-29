import React, { useState, useEffect } from 'react';

function ComposeView({ onCancel }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [instructions, setInstructions] = useState('');
  const [draftText, setDraftText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleGenerateDraft = async () => {
    if (!instructions.trim()) return;
    
    setIsDrafting(true);
    setDraftText('');

    try {
      const response = await fetch(`http://localhost:5000/api/compose/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions })
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
              console.error("Error parsing JSON chunk", e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to generate compose draft", error);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSend = async () => {
    setIsSending(true);
    try {
      const response = await fetch(`http://localhost:5000/api/compose/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, draftText })
      });
      const data = await response.json();
      if (data.success) {
        onCancel(); // Go back to inbox
      } else {
        alert("Failed to send email.");
      }
    } catch (error) {
      console.error("Error sending email", error);
      alert("Failed to send email.");
    } finally {
      setIsSending(false);
      setShowSendConfirmation(false);
    }
  };

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem', background: 'var(--bg-color)', color: 'var(--text-primary)' }}>
      <h2 style={{ margin: 0, color: 'var(--accent-color)' }}>Compose Email</h2>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
        <input
          type="email"
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '1rem' }}
        />
        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '1rem' }}
        />
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="AI Instructions (e.g. Write a polite email asking for sick leave)"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isDrafting) {
                e.preventDefault();
                handleGenerateDraft();
              }
            }}
            style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.4)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '1rem' }}
          />
          <button 
            onClick={handleGenerateDraft}
            disabled={isDrafting || !instructions.trim()}
            style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.2)', border: '1px solid rgba(99, 102, 241, 0.4)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            ✨ AI Draft
            {isDrafting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>}
          </button>
        </div>

        <textarea
          placeholder="Email body..."
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          style={{ flex: 1, padding: '1rem', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '1rem', resize: 'none', lineHeight: '1.5' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
        <button 
          onClick={onCancel}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'white', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button 
          onClick={() => setShowSendConfirmation(true)}
          disabled={!to || (!draftText && !isDrafting)}
          className="btn-primary"
        >
          Send
        </button>
      </div>

      {/* Confirmation Modal */}
      {showSendConfirmation && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ padding: '2rem', width: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Send this email?</h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Are you sure you want to send this email to <strong>{to}</strong>?</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button 
                onClick={() => setShowSendConfirmation(false)}
                disabled={isSending}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'white', cursor: 'pointer', flex: 1 }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSend}
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
                  'Yes, Send It'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComposeView;
