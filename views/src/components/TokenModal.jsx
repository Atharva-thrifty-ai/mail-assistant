import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const TokenModal = ({ onClose }) => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/token_info');
        if (response.ok) {
          const data = await response.json();
          setMetrics(data);
        }
      } catch (err) {
        console.error("Failed to fetch token metrics", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMetrics();
  }, []);

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  };

  const contentStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    padding: '2rem',
    width: '700px',
    maxWidth: '90vw',
    color: 'var(--text-primary)',
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
    maxHeight: '90vh',
    overflowY: 'auto'
  };

  const calculateGrandTotal = () => {
    if (!metrics || !metrics.nodes) return { input: 0, output: 0, requests: 0 };
    return metrics.nodes.reduce((acc, curr) => ({
      input: acc.input + curr.total_input_tokens,
      output: acc.output + curr.total_output_tokens,
      requests: acc.requests + curr.total_requests
    }), { input: 0, output: 0, requests: 0 });
  };

  const gt = calculateGrandTotal();
  const TPM_LIMIT = 2000000; // OpenAI Tier 1 Limit
  const tpmColor = metrics && metrics.max_tpm > (TPM_LIMIT * 0.75) ? 'var(--attention)' : 'var(--personal)';

  return createPortal(
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
            <span>📊</span> Token Information
          </h2>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer', padding: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            &times;
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Loading metrics...</div>
        ) : !metrics ? (
          <div style={{ textAlign: 'center', color: 'var(--danger)', padding: '2rem' }}>Failed to load metrics.</div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Max Tokens / Min</div>
                <div style={{ fontSize: '2.5rem', fontWeight: '700', color: tpmColor }}>{metrics.max_tpm.toLocaleString()}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Max Requests / Min</div>
                <div style={{ fontSize: '2.5rem', fontWeight: '700', color: 'var(--personal)' }}>{metrics.max_rpm.toLocaleString()}</div>
              </div>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Node Metrics</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem 0', fontWeight: 500 }}>AI Node</th>
                  <th style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 500 }}>Requests</th>
                  <th style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 500 }}>Input Tokens</th>
                  <th style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 500 }}>Output Tokens</th>
                </tr>
              </thead>
              <tbody>
                {metrics.nodes.length === 0 ? (
                  <tr><td colSpan="4" style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>No node data available yet.</td></tr>
                ) : metrics.nodes.map(node => (
                  <tr key={node.node_name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0', fontWeight: '500' }}>{node.node_name}</td>
                    <td style={{ padding: '0.75rem 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{node.total_requests.toLocaleString()}</td>
                    <td style={{ padding: '0.75rem 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{node.total_input_tokens.toLocaleString()}</td>
                    <td style={{ padding: '0.75rem 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{node.total_output_tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 'bold' }}>
                  <td style={{ padding: '1rem 0' }}>Grand Total</td>
                  <td style={{ padding: '1rem 0', textAlign: 'right' }}>{gt.requests.toLocaleString()}</td>
                  <td style={{ padding: '1rem 0', textAlign: 'right' }}>{gt.input.toLocaleString()}</td>
                  <td style={{ padding: '1rem 0', textAlign: 'right' }}>{gt.output.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default TokenModal;
