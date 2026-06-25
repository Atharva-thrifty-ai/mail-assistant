# Backend-For-Frontend (BFF) & UI Architecture

This document tracks the logic and architecture for the BFF server and the Frontend UI, designed specifically to operate completely independently from the heavy AI backend engine.

## 1. The Client UI Layout

The frontend is a highly responsive email client layout:
- **Left Sidebar (Navigation):** Standard mail folders (Inbox, Sent, Drafts, Trash) and dynamic AI category filters (Spam, Personal & Social, Work & Professional, Attention).
- **Main Panel (Email List):** Displays rows of emails sorted by time. Each row renders the AI-determined context (categories like "Attention") directly on the row as visual badges. **Read/Unread State:** Following standard email UI conventions (like Gmail), unread emails are visually depicted with bold text and styling, driven directly by the `is_unread` boolean stored in our `metadata.db`.

## 2. The BFF Node.js Server

The BFF is a lightweight Node.js server that connects the UI to the pure backend databases. It operates on two distinct logical flows to guarantee a zero-latency user experience:

### Flow A: Initial Render ("On user going on page")
This handles the instant dashboard load without waiting for AI processing.
*   **The Trigger:** The user opens the dashboard or navigates to the Inbox.
*   **The Action:** The BFF bypasses the actual email service and the AI workers entirely. It queries the local **Metadata SQLite Database** directly.
*   **The Result:** It instantly returns the list of senders, subjects, times, and AI category labels to populate the UI. 

### Flow B: The Interaction ("User clicking")
This handles what happens when a user clicks an email, managing the bridge between the UI and the asynchronous AI.
*   **The Trigger:** The user clicks a specific email row to view its details.
*   **The Action:** The BFF pulls the specific thread's metadata and immediately checks the **Status Database**.

**The Routing Logic (The Split):**
*   **Path 1 (Completed):** If the status is `completed`, the BFF must fetch the raw email body on-the-fly (because the pure backend deletes heavy payloads to save space). It reads the `metadata.db` to grab the `provider_thread_id` and `source` (e.g., 'gmail' or 'microsoft'). The BFF then dynamically calls the respective API, runs a lightweight pre-processing function (e.g., decoding Base64 HTML, stripping trackers), and serves **ONLY** this clean email body to the user. *Crucially, it does NOT fetch the summary or draft from the databases at this stage, strictly decoupling the AI data to guarantee a blazing fast initial render.*
*   **Path 2 (Pending):** If the status is `pending`, the AI hasn't finished processing. The BFF performs the exact same on-the-fly fetch and pre-processing from the provider API so the user can immediately read the message. Crucially, it instantly pushes a signal to the **Urgent Queue** API (`POST /api/internal/urgent`). The payload it sends is the exact same `{ internal_thread_id, live_version }` JSON object that it just grabbed from its `status.db` query. This bridges the gap between the two backends, forcing the Pure Logic backend to rip that thread to the front of the line and prioritize it immediately.

# Backend-For-Frontend (BFF) Architecture

This document defines the routing, logic, and data flow for the Express.js BFF, serving as the bridge between the React frontend and the Pure Backend SQLite databases.

## 1. Routing Endpoints (The Filter Architecture)

The BFF handles folder navigation not by querying different databases, but by applying specific `WHERE` filters to the central `metadata.db`.

### Core Folder Endpoints
- **`/`** $\rightarrow$ Automatically redirects to `/inbox`
- **`/inbox`** $\rightarrow$ `SELECT * FROM metadata WHERE is_trash=0 AND is_spam=0 AND is_sent=0`
- **`/trash`** $\rightarrow$ `SELECT * FROM metadata WHERE is_trash=1`
- **`/starred`** $\rightarrow$ `SELECT * FROM metadata WHERE is_starred=1`
- **`/sent`** $\rightarrow$ `SELECT * FROM metadata WHERE is_sent=1`
- **`/spam`** $\rightarrow$ `SELECT * FROM metadata WHERE is_spam=1`
- **`/drafts`** $\rightarrow$ `SELECT * FROM metadata WHERE is_draft=1` *(Shows both AI and manual drafts)*

### AI Category Endpoints
- **`/attention`** $\rightarrow$ `SELECT * FROM metadata WHERE ai_categories LIKE '%Attention%'`
- **`/work-professional`** $\rightarrow$ `SELECT * FROM metadata WHERE ai_categories LIKE '%Work & Professional%'`
- **`/personal-social`** $\rightarrow$ `SELECT * FROM metadata WHERE ai_categories LIKE '%Personal & Social%'`

## 2. The Live-Fetch Mechanism (Email Reading View)

Because the Pure Backend intentionally destroys heavy email payloads in Phase 5, the BFF is responsible for securely fetching the full email body when a user clicks a row.

1. **Trigger:** User clicks an email in any of the above endpoints.
2. **Action:** The BFF receives the `provider_thread_id` and makes a *live* API call to the Gmail API (`gmail.users.threads.get`).
3. **Preprocessing:** The BFF pipes the raw Google response through our existing `preprocessor.js` to strip out HTML clutter and signatures.
4. **Render:** The clean text is sent to the UI along with the action buttons (Summarize, Draft, etc.).

*(If the user clicks an email specifically from the `/drafts` endpoint, the UI receives the fetched body but instantly mounts the Draft Compose Box instead of the standard reading view).*

**The Spinner Race Condition (Good Luck vs. Bad Luck):**
When an email is clicked while `pending`, a race begins between the user reading the email and the backend processing the AI tasks:
*   **Good Luck (Backend Wins):** The Pure Backend finishes processing the Urgent Queue task before the user finishes reading the email body. The status silently flips to `completed`. When the user clicks the "Summarise" or "Draft" action buttons, the popup instantly displays the AI data.
*   **Bad Luck (User Wins):** The user clicks the "Summarise" or "Draft" button *before* the Pure Backend finishes. The popup opens, but the BFF detects the status is still `pending`. It displays a sleek circular loading spinner in the popup. The BFF streams/polls for completion, and the second the backend finishes, the spinner is replaced by the summary/draft.

### Flow C: On-Demand AI Interactions (The UI Floating Actions)
When the user views the email body, the AI summary and drafted response are **hidden** by default. They are accessible via two floating action buttons:

1. **The "Summarise" Action:**
   - **Trigger:** User clicks the "Summarise" button.
   - **Action:** A popup appears. The BFF instantly fetches the already-generated 1-sentence summary from the `summariesDb` and displays it. No LLM tokens are spent.

2. **The "Draft" Action (On-the-Fly & Redrafting):**
   - **Trigger:** User clicks the "Draft" button, opening the Draft popup.
   - **Case A (Draft Already Exists):** The popup displays the draft previously generated by the Pure Backend. It provides a "Redraft" button with a text input field ("why redraft?"). If the user submits specific instructions (e.g., "Make it more formal"), the BFF sends this to the LLM to regenerate the draft, streaming the response back to the UI in real-time via Server-Sent Events (SSE).
   - **Case B (Draft Was Skipped):** If the Pure Backend's Zero-Latency Gatekeeper originally skipped drafting for this thread to save API costs, no draft exists. Clicking "Draft" forces the BFF to "fast-create" a draft on-the-fly. The BFF executes the exact same Drafter logic, connects to the local RAG Vector Database (`memory_vectors.json`), and streams the generated text to the UI.
   - **Architectural Implementation:** To prevent duplicate code, the core drafting logic (`drafterNode.js`) will be extracted into a shared `services/` directory so both the Pure Backend (for background drafting) and the BFF (for redrafting) use the exact same RAG-grounded AI brain.

## 3. Special Add-ons
- **Zero-Latency Gatekeeper Handling:** If the backend gatekeeper aborted drafting (e.g., for a newsletter or an email we already replied to), the BFF recognizes the empty draft field. If the user decides they *do* want a draft, they can click the Draft button to trigger the BFF's on-the-fly "fast-create" streaming engine.
- **RAG-Powered Highlights:** The UI dynamically highlights emails tagged with the "Attention" category, directly powered by the local Vector Search matching emails against your business rules.
