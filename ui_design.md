# Frontend UI Design & Interactions Blueprint

This document outlines the visual layout, user interactions, and specific UX behaviors for the AI Mail Assistant frontend. 

## Technology Stack
- **Frontend Framework:** React (scaffolded via Vite for maximum speed).
- **Styling:** Vanilla CSS to provide absolute control over premium aesthetics (glassmorphism, modern gradients, micro-animations) without being constrained by framework defaults.
- **Backend-For-Frontend (BFF):** A dedicated, lightweight Express.js server to handle API routing, real-time SSE streaming, and database queries.

## 1. Overall Layout Architecture

The UI follows a classic, highly responsive two-pane email client layout (inspired heavily by modern Gmail/Outlook designs):

### The Left Sidebar (Navigation)
- **Primary Action:** A prominent "Compose" button at the very top (just like Gmail) to draft entirely new emails.
- **Standard Folders:** Inbox, Sent, Drafts, Trash, Starred.
- **Dynamic AI Filters:** A dedicated section listing our custom AI categories (e.g., "Spam", "Personal & Social", "Work & Professional", "Attention"). Clicking these instantly filters the main panel.

### The Main Panel (The Inbox List)
- Displays email threads sorted by time.
- **Quick Actions (Hover):** When hovering over an email row, quick action buttons appear on the right: "Star", "Delete/Trash", and "Forward" to instantly manage the email. (Backend logic to be implemented in Phase 7).
- **Read/Unread State:** Driven by the `is_unread` boolean from our metadata. Unread emails are rendered in **bold text** with a solid white/bright background, while read emails use standard weight font with a slightly dimmed background.
- **AI Category Badges (List View):** To keep the snippet text completely uncluttered, categories are rendered purely as a minimalist **color indicator** (e.g., a solid colored dot or thin vertical bar) on the far right side of the row.
- **AI Category Badges (Reading View):** When the email is opened, the full category name (e.g., a sleek "🔴 Attention" badge) is displayed prominently at the top right of the reading view alongside the email header, giving immediate context before reading.

## 2. The Reading View & Floating Actions

When the user clicks an email row, the `internal_thread_id` is sent to the BFF, and the full thread payload is fetched from the provider API. The Reading View dynamically renders every message in the thread array. The latest message is fully expanded at the bottom, while older messages are stacked above it, providing a native scrolling feature so the user can easily scroll up and read the entire historical context of the conversation. 

**Standard Email Actions (Reading View):**
- **Top Right Header:** Sleek icons for **"Star"** and **"Delete/Trash"** sit right next to the AI Category badges for immediate management of the open thread.
- **Bottom Footer:** A native **"Forward"** button sits at the very bottom of the thread, positioned cleanly alongside the AI "Draft" action buttons.

To prevent UI clutter, AI features are hidden behind **Floating Action Buttons (FABs)**.

### Action 1: "Summarise"
- **Interaction:** The user clicks the "Summarise" icon.
- **Behavior:** A clean popup/modal appears. The BFF instantly serves the detailed summary fetched from the `summariesDb` (we purposefully avoid 1-sentence restrictions to ensure no critical information is lost).
- **Latency:** Instantaneous (0 LLM tokens spent).

### Action 2: "Draft"
- **Interaction:** The user clicks the "Draft" icon.
- **Behavior:** Instead of a simple popup, an **inline Compose Box** expands at the bottom of the reading view, perfectly mimicking the native Gmail reply interface.
- **Case A (Draft Exists):** The compose box is pre-filled with the AI-generated draft. It features a prominent "Send" button, and a custom "Redraft" button next to it. It also includes an Instruction input field. To redraft, the user inputs instructions (e.g., "Make it more formal"), and clicks "Redraft". Because the backend `/redraft` endpoint is a POST route (needed to send the massive earlier draft payload), the frontend uses a custom `fetch` stream reader to parse the Server-Sent Events over POST and streams the new version directly into the text box in real-time.
- **Case B (Draft Skipped by Gatekeeper):** The compose box opens empty. A "Fast-Create Draft" button is available. When clicked, the React UI simply calls the `GET /draft` endpoint without sending any heavy message payloads. It then displays a loading state for ~500ms while the backend fetches and preprocesses the history itself, before actively streaming a newly generated draft straight into the editor in real-time.
- **Case C (Last Message was Sent by User):** If the very last historical message in the thread was sent by the user (the backend returns `hideDraftButton: true`), the "Draft" action button is entirely hidden from the UI, as generating an AI reply to oneself is meaningless. this boolean will be returned by the extractor of that thread.

## 3. Real-Time UX & Animations

To make the application feel incredibly premium and responsive:
- **Server-Sent Events (SSE) Streaming:** Whenever the user asks for a "Redraft" or a "Fast-Create", the BFF streams the LLM tokens back to the UI. The user watches the draft "type itself out" in real-time within the popup, eliminating static loading screens.
- **The "Bad Luck" Spinner (Summarizer - Time-Based Polling):** If a user clicks the "Summarise" action before the background worker finishes, the popup displays a sleek, modern circular loading spinner. The React UI uses a simple time-based polling method (checking the backend every 2 seconds). When the backend completes, the UI grabs the 1-sentence summary and the spinner vanishes.
- **The "Bad Luck" Spinner (Drafter - SSE Streaming):** If the user clicks the "Draft" action while the worker is still generating the draft, the UI establishes a Server-Sent Events (SSE) connection. The backend holds this connection open and pushes the finished draft to the UI the exact millisecond the generation completes, offering a zero-latency transition.
