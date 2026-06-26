import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import InboxList from './components/InboxList';
import ReadingView from './components/ReadingView';
import MaintenancePlaceholder from './components/MaintenancePlaceholder';
import { api } from './api';

function App() {
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [activePhase, setActivePhase] = useState(null); // Used to trigger maintenance for future phases
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [maintenanceToast, setMaintenanceToast] = useState(null);

  // Fetch emails when folder changes
  useEffect(() => {
    // If it's a future phase folder (like drafts = phase 5, or compose = phase 7), don't fetch
    if (activePhase && activePhase > 4) {
      setEmails([]);
      setSelectedEmail(null);
      return;
    }

    const loadEmails = async () => {
      const data = await api.fetchFolder(activeFolder);
      setEmails(data);
      setSelectedEmail(null); // Reset selection on folder change
    };

    loadEmails();
  }, [activeFolder, activePhase]);

  const handleFolderChange = (folderId, phase = 4) => {
    setActiveFolder(folderId);
    setActivePhase(phase);
    // Drafts (phase 5) or Compose (phase 7) will trigger the placeholder via activePhase > 4
  };

  const triggerMaintenance = (featureName) => {
    setMaintenanceToast(featureName);
    setTimeout(() => setMaintenanceToast(null), 3000);
  };

  return (
    <>
      <Sidebar activeFolder={activeFolder} onFolderChange={handleFolderChange} />
      
      {activePhase && activePhase > 4 ? (
        <div className="glass-panel" style={{ flex: 1 }}>
          <MaintenancePlaceholder featureName={activeFolder === 'compose' ? 'Compose New Email' : 'Drafts Router'} />
        </div>
      ) : (
        <>
          <InboxList 
            folder={activeFolder} 
            emails={emails} 
            onSelectEmail={setSelectedEmail} 
            selectedId={selectedEmail?.internal_thread_id}
            onTriggerMaintenance={triggerMaintenance}
          />
          
          {selectedEmail ? (
            <ReadingView 
              key={selectedEmail.internal_thread_id}
              email={selectedEmail} 
              folder={activeFolder} 
              onTriggerMaintenance={triggerMaintenance}
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
