import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import InboxList from './components/InboxList';
import ReadingView from './components/ReadingView';
import MaintenancePlaceholder from './components/MaintenancePlaceholder';
import ComposeView from './components/ComposeView';
import { api } from './api';

function App() {
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [activePhase, setActivePhase] = useState(null); // Used to trigger maintenance for future phases
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [maintenanceToast, setMaintenanceToast] = useState(null);

  // Fetch emails when folder changes
  const loadEmails = async (preserveSelection = false) => {
    if (activePhase && activePhase > 4 && activeFolder !== 'compose') {
      setEmails([]);
      setSelectedEmail(null);
      return;
    }
    if (activeFolder === 'compose') return;
    
    const data = await api.fetchFolder(activeFolder);
    setEmails(data);
    if (!preserveSelection) {
      setSelectedEmail(null);
    } else if (selectedEmail) {
      // Re-select if it still exists in the new data
      const stillExists = data.find(e => e.internal_thread_id === selectedEmail.internal_thread_id);
      setSelectedEmail(stillExists || null);
    }
  };

  useEffect(() => {
    loadEmails(false);
  }, [activeFolder, activePhase]);

  const handleFolderChange = (folderId, phase = 4) => {
    setActiveFolder(folderId);
    setActivePhase(phase);
  };

  const triggerMaintenance = (featureName) => {
    setMaintenanceToast(featureName);
    setTimeout(() => setMaintenanceToast(null), 3000);
  };

  return (
    <>
      <Sidebar activeFolder={activeFolder} onFolderChange={handleFolderChange} />
      
      {activeFolder === 'compose' ? (
        <div className="glass-panel" style={{ flex: 1, padding: 0 }}>
          <ComposeView onCancel={() => handleFolderChange('inbox', 4)} />
        </div>
      ) : activePhase && activePhase > 4 ? (
        <div className="glass-panel" style={{ flex: 1 }}>
          <MaintenancePlaceholder featureName={'Drafts Router'} />
        </div>
      ) : (
        <>
          <InboxList 
            folder={activeFolder} 
            emails={emails} 
            onSelectEmail={setSelectedEmail} 
            selectedId={selectedEmail?.internal_thread_id}
            onTriggerMaintenance={triggerMaintenance}
            onRefresh={() => loadEmails(true)}
          />
          
          {selectedEmail ? (
            <ReadingView 
              key={selectedEmail.internal_thread_id}
              email={selectedEmail} 
              folder={activeFolder} 
              onTriggerMaintenance={triggerMaintenance}
              onRefresh={() => loadEmails(true)}
            />
          ) : (
            <div className="glass-panel" style={{ flex: 1.5, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>✉️</div>
                <p>Select a thread to read</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Global Toast for Maintenance Actions (Star, Delete, Forward) */}
      {maintenanceToast && (
        <div className="toast-overlay">
          Feature "{maintenanceToast}" is scheduled for a future backend phase!
        </div>
      )}
    </>
  );
}

export default App;
