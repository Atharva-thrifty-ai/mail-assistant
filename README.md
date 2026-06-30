# 🚀 AI Mail Assistant

Welcome to the **AI Mail Assistant**, a hyper-fast, radically decoupled system that autonomously reads, summarizes, categorizes, and drafts responses to your emails in the background. It is engineered from the ground up to guarantee maximum speed, the absolute lowest OpenAI API costs, and perfect **zero-latency UI performance**.

---

## 🏗️ The 3-Tier Architecture

To prevent the heavy lifting of Artificial Intelligence from ever slowing down the user experience, the system is strictly decoupled into three standalone layers:

1. **The Pure Backend (The AI Factory):** A headless Node.js engine entirely dedicated to polling email APIs, managing concurrency queues, and orchestrating LangChain nodes. It operates entirely in the background, out of the user's way.
2. **The BFF (Backend-For-Frontend):** A lightning-fast Express.js API layer. It serves lightweight metadata from a local SQLite database to the UI instantly, and only fetches massive email bodies from Gmail/Microsoft when a user explicitly clicks a thread.
3. **The React UI:** A snappy, responsive frontend. Because it never waits for the AI backend to process, it feels as fast and native as a desktop application.

---

## ⚡ Core Technical Features

### 1. Dual-Queue Priority Dispatching
The backend utilizes two distinct queues: a **Background Queue** and an **Urgent Queue**. 
- When 100 emails arrive overnight, they trickle through the Background Queue in chronological order via a strictly rate-limited worker pool (preventing OpenAI `429 Too Many Requests` crashes).
- If the user opens the UI and clicks on email #99, the BFF fires a webhook to the Pure Backend, pushing that email into the **Urgent Queue**. The AI instantly drops what it's doing and processes the user's requested email immediately.

### 2. The Memory Node (Zero Context Loss)
Standard LLM windows cannot handle 50-email long threads without burning massive API budgets. Our **Memory Node** natively keeps the $K$ most recent messages in raw text and dynamically "squashes" older messages into a dense JSON dictionary. If a burst of emails skips the queue, the node mathematically slices and squashes the missed emails in a single LLM invocation, guaranteeing zero context loss.

### 3. Local RAG Integration
The AI does not hallucinate. The parallel Classifier and Drafter nodes utilize a local Vector Database (using mathematically optimized Cosine Similarity) to search your specific business rules, pricing, and calendar availability before generating tags or drafting replies.

### 4. Zero-Latency Gatekeeper
A pure JavaScript filter sits in front of the expensive LLM Drafting node. If an email is an automated newsletter (`noreply`), or if you've already manually replied to the client, the Gatekeeper aborts the drafting process instantly, saving massive API costs.

### 5. Self-Cleaning Databases & Concurrency Locks
The system runs on transient SQLite databases leveraging composite primary keys `(thread_id, live_version)` to securely handle concurrency. Furthermore, as soon as the AI finishes processing a thread, the backend executes a `DELETE` query to permanently destroy the massive HTML payload from the database. This guarantees the system's storage remains ultra-lightweight forever.

### 6. Optimistic UI & Self-Healing Drafts
- **Optimistic UI:** When you "Star" or "Trash" an email in the React UI, the screen updates instantaneously before the BFF even completes the network request to Gmail.
- **Self-Healing Drafts:** If you click send on an AI-generated draft, but that draft was accidentally deleted externally on Gmail, the BFF's `senderService.js` intercepts the failure, dynamically recreates the draft, pastes the text, and sends it without the user ever noticing the crash.
- **SSE AI Streaming:** Drafts and custom dynamic "Redrafts" stream beautifully into the UI character-by-character via Server-Sent Events.

---

## 📂 Project Structure & Navigation

- **`/src/` (The Pure Backend)**
  - `/ingestion/` - Delta Polling, Adapters, and the core Dual-Queue `worker.js` engine.
  - `/nodes/` - The LangChain intelligence (Memory, Classifier, Drafter).
  - `/utils/` & `/config/` - Gmail API wrappers and Database connections.
- **`/bff/` (The Backend-For-Frontend)**
  - `/routes/` - Local folder routing (Inbox, Spam, Trash) and AI endpoints (Extractor, Draft, Redraft).
  - `/services/` - The heavy lifters (`drafterService.js`, `senderService.js`, `extractorService.js`).
  - `/controllers/` - Action handling and optimistic syncing.
- **`/views/` (The React UI)**
  - Complete Vite + React frontend codebase implementing the sidebar, inbox lists, and detailed reading views.
- **`/data/` (The Local Data)**
  - `metadata.db`, `status.db`, `queues.db`, `memory.db` and the RAG `memory_vectors.json`.

*For an exhaustive, deep-dive technical breakdown of every node and routing decision, please consult the `system_architecture_and_history.md`, `pure backend.md`, and `bff.md` documentation files located in this repository.*
