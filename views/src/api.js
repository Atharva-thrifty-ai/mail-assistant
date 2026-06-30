const BASE_URL = 'http://localhost:5000/api';

export const api = {
  // Fetch emails for a specific folder
  fetchFolder: async (folderName) => {
    try {
      const response = await fetch(`${BASE_URL}/${folderName}`);
      if (!response.ok) throw new Error(`Failed to fetch ${folderName}`);
      return await response.json();
    } catch (error) {
      console.error(error);
      return [];
    }
  },

  // Fetch thread history
  fetchThreadHistory: async (folderName, threadId) => {
    try {
      const response = await fetch(`${BASE_URL}/${folderName}/${threadId}/extractor`);
      if (!response.ok) throw new Error('Failed to fetch thread history');
      return await response.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  },

  // Fetch AI Summary
  fetchSummary: async (folderName, threadId) => {
    try {
      const response = await fetch(`${BASE_URL}/${folderName}/${threadId}/summary`);
      if (!response.ok) throw new Error('Failed to fetch summary');
      return await response.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  },

  // Global Search
  searchEmails: async (query) => {
    try {
      const response = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Failed to search');
      return await response.json();
    } catch (error) {
      console.error(error);
      return [];
    }
  }
};
