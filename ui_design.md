# Frontend UI Design & Interactions Blueprint

This document outlines the visual layout, user interactions, and specific UX behaviors for the AI Mail Assistant frontend. 

## Technology Stack
- **Frontend Framework:** React (scaffolded via Vite for maximum speed).
- **Styling:** Vanilla CSS to provide absolute control over premium aesthetics (glassmorphism, modern gradients, micro-animations) without being constrained by framework defaults.
- **Backend-For-Frontend (BFF):** A dedicated, lightweight Express.js server to handle API routing, real-time SSE streaming, and database queries.

## 1. Overall Layout Architecture

The UI follows a classic, highly responsive two-pane email client layout (inspired heavily by modern Gmail/Outlook designs):

### The Left Sidebar (Navigation)
- **Standard Folders:** Inbox, Sent, Drafts, Trash, Starred.
- **Dynamic AI Filters:** A dedicated section listing our custom AI categories (e.g., "Spam", "Personal & Social", "Work & Professional", "Attention"). Clicking these instantly filters the main panel.

### The Main Panel (The Inbox List)
- Displays email threads sorted by time.
- **Read/Unread State:** Driven by the `is_unread` boolean from our metadata. Unread emails are rendered in **bold text** with a solid white/bright background, while read emails use standard weight font with a slightly dimmed background.
- **AI Category Badges:** The AI-determined category is rendered as a colorful, pill-shaped badge directly on the email row (e.g., a red/orange badge for "Attention"). This gives immediate context before opening the email.

## 2. The Reading View & Floating Actions

When the user clicks an email row, the `internal_thread_id` is sent to the BFF, and the raw email body is fetched and displayed. To prevent UI clutter, AI features are hidden behind **Floating Action Buttons (FABs)**.

### Action 1: "Summarise"
- **Interaction:** The user clicks the "Summarise" icon.
- **Behavior:** A clean popup/modal appears. The BFF instantly serves the detailed summary fetched from the `summariesDb` (we purposefully avoid 1-sentence restrictions to ensure no critical information is lost).
- **Latency:** Instantaneous (0 LLM tokens spent).

### Action 2: "Draft"
- **Interaction:** The user clicks the "Draft" icon.
- **Behavior:** Instead of a simple popup, an **inline Compose Box** expands at the bottom of the reading view, perfectly mimicking the native Gmail reply interface.
- **Case A (Draft Exists):** The compose box is pre-filled with the AI-generated draft. It features a rich text toolbar at the bottom, a prominent "Send" button, and a custom "Redraft" button next to it. If the user clicks "Redraft" (optionally providing a prompt like "make it shorter"), a new version streams directly into the text box.
- **Case B (Draft Skipped by Gatekeeper):** The compose box opens empty. A "Fast-Create Draft" button is available, which triggers the BFF to actively stream a newly generated draft straight into the editor in real-time.

## 3. Real-Time UX & Animations

To make the application feel incredibly premium and responsive:
- **Server-Sent Events (SSE) Streaming:** Whenever the user asks for a "Redraft" or a "Fast-Create", the BFF streams the LLM tokens back to the UI. The user watches the draft "type itself out" in real-time within the popup, eliminating static loading screens.
- **The "Bad Luck" Spinner:** If a user clicks into an email and clicks an AI action *before* the background worker finishes processing it, the popup will display a sleek, modern circular loading spinner. The spinner actively listens to the backend and instantly vanishes, replacing itself with the AI data the exact millisecond the background worker completes Phase 5.
