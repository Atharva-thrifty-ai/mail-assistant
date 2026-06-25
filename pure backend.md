# Pure Backend Architecture & Execution Logic

This document is the definitive architectural blueprint for the AI Mail Assistant's backend. It traces the exact flow of data from ingestion through the dual-queue system and into the parallel AI generation nodes, detailing not just *what* happens, but *why* each architectural decision was made.

---

## Phase 1: Ingestion & Initial State Dispatch
The system begins when new email data arrives (via Full Sync on boot, or Delta CRON polling). 

### 1. The Injection Node (Data Normalization)
Because Gmail and Microsoft Graph send data in completely different formats (Base64 vs HTML, different header structures), the **Injection Node** acts as the primary normalizer. It builds a **Universal Email Object (UEO)**.
*   **Why:** Without a UEO, the entire downstream AI pipeline would need duplicate logic for every email provider. Normalizing it here guarantees the rest of the architecture deals with one clean, predictable schema.

### 2. State Initialization & Storage
Instead of pushing the massive UEO directly into memory queues, the Injection Node immediately splits the data into dedicated persistent SQLite databases:
*   **The Status Database:** Creates a new row for the thread with status `pending` and assigns it a `live_version` integer lock. **Why:** This prevents race conditions and handles concurrency.
*   **The Metadata Database:** Stores only lightweight fields (Sender, Subject, Timestamp, Snippet). **Why:** This populates the frontend UI instantly. The user can browse their inbox with zero latency while the heavy AI runs in the background.
*   **The Threads Database:** Stores the full, heavy UEO payload (including the clean text body and historical messages). **Why:** Storing massive payloads in Node.js memory queues causes memory leaks during traffic bursts. Saving it to SQLite allows the queues to remain ultra-lightweight.

### 3. The Queue Handoff
The Injection Node pushes a tiny, lightweight object—`{ internal_thread_id, live_version }`—into the asynchronous **Background Queue**. 

---

## Phase 2: The Dual-Queue System & Prioritization
The backend relies on two FIFO (First-In, First-Out) data structures: the **Background Queue** and the **Urgent Queue**.

### The Background Queue (Chronological Processing & Rate Limiting)
By default, all new emails enter the background queue. A strictly controlled pool of exactly 3 workers (running concurrently via `Promise.all`) silently pull the `{ id, version }` packets one by one, fetch the heavy thread payload from the Threads Database using the ID, and process them in chronological order. *(Note: Using exactly 3 workers is a deliberate rate-limiting strategy. It mathematically guarantees that no matter how massive the email burst, only 3 concurrent LLM requests are made, completely preventing 429 Too Many Requests errors from the AI provider).*

### The Urgent Queue (The Queue-Jump)
If 50 emails arrive overnight, they sit in the background queue. If the user opens the app and clicks on email #49, they should not have to wait for the first 48 emails to be processed.
*   **The Trigger:** When the user clicks a "pending" email, the frontend hits the backend API. *(Note: Because the Pure Backend and the Backend-For-Frontend (BFF) run on two separate servers and ports, this trigger is an ultra-fast HTTP POST from the BFF directly to the Pure Backend's hidden API port).*
*   **The Action:** The backend instantly pushes that specific `{ internal_thread_id, live_version }` into the **Urgent Queue**.
*   **The Result:** The very next available worker ignores the background queue, grabs the task from the urgent queue, fetches the payload from the SQLite database instantly, and runs the AI.

### The Status Lock & Discard Mechanism (Cost Saving)
Every time a new email arrives in a thread, the thread's `live_version` increments in the SQLite Status DB.
*   **No Array Deduplication Needed:** When a thread updates, the system blindly appends the new `{ internal_thread_id, live_version: 2 }` to the queue. It does NOT search the array to delete the old `{ live_version: 1 }` packet.
*   **The Composite Key Database:** The heavy UEO payloads are stored in the transient `queues.db` using a composite primary key: `(internal_thread_id, live_version)`. This means if `v1` and `v2` are both in the queue, their payloads exist safely and simultaneously in the database without overwriting each other.
*   **The Discard:** Because the worker pops the newest emails first, it processes `v2` instantly. Minutes later, when it finally pops the old `v1` packet, it checks the DB. The DB says the live version is `2`. 
*   **The Save:** Because `1 < 2`, the worker immediately **discards** the old task without executing any LLM logic, saving massive API costs and preventing duplicate replies.
*   **Discard Cleanup:** When the worker discards the stale `v1` task, it instantly runs a `DELETE` query against `queues.db` to destroy that specific `(thread_id, v1)` payload. This saves disk space while leaving the `v2` payload perfectly intact.

---

## Phase 3: The Memory Node (Running Summary Beyond K)
Once a valid task is pulled, the worker hands the payload to the **Memory Node** (the first LLM processing block).

*   **The Tech Stack:** This node is powered strictly by LangChain using the `gpt-5.4-nano` OpenAI model. We explicitly use `nano` because maintaining a running summary is not a deeply complex reasoning task, and `nano` provides massive speed and cost savings for simple text squashing. It is a standard LLM invocation (not an Agent/createAgent), as its sole purpose is text summarization with zero tool-calling required.
*   **The Logic:** Instead of feeding an entire 50-email thread to the LLM (which exceeds context limits and destroys API budgets), the system maintains a **Running Summary**.
*   **Beyond K:** The system keeps the `K` most recent messages in their pure, verbatim text format. *(Note: If a thread has fewer than `K` emails, this node stays completely dormant to save API costs).* Any message older than `K` is aggressively squashed into a dense "Running Summary" dictionary `{ }`.
*   **Storage Suggestion:** This dense AI Running Summary, alongside a `summarized_count` integer, should be stored in a dedicated persistent SQLite database (e.g., `memory.db`). This separates the hidden, heavy AI context from the fast frontend databases.
*   **Handling Skipped Queue Tasks (The "Bunch" Logic):** Because our Status Lock mechanism aggressively discards stale queue tasks, it is highly likely that *multiple* emails might fall out of the `K` window simultaneously before a worker actually processes the thread.
*   **The Math:** To solve this, `memory.db` tracks the `summarized_count` (how many messages are already inside the summary). If a thread has `N` total messages, and we want to keep `K` visible, then the first `N - K` messages belong in the summary. 
*   **The Execution:** The worker mathematically slices any raw messages that exist between `summarized_count` and `N - K`. The prompt is dynamically constructed as: `[Existing Running Summary] + [Missed Email 1] + [Missed Email 2]...`. 
*   **Why:** This allows the `nano` LLM to squash the entire "bunch" of skipped emails in one go, mathematically guaranteeing that absolutely no conversation data is ever lost due to queue-jumping, while still keeping token counts incredibly low.

---

## Phase 4: The Parallel Generation Engine (Fan-Out)
With the Running Summary updated, the architecture branches into two parallel LLM nodes that execute simultaneously to cut processing time in half. *(Crucial Architecture Detail: While the diagram shows the Memory Node feeding these branches, these Fan-Out nodes cannot rely on the summary alone. They must use the `internal_thread_id` to reach back into the Threads Database to fetch those `K` raw recent messages. To strictly prevent API token bloat, they explicitly slice the history to `K=3`, and append the `latest_message` so the AI is perfectly focused on the newest inquiry).*

### Branch A: Drafting Response
*   **The Zero-Latency Gatekeeper:** Before calling the expensive Drafting LLM, the system runs a fast, pure-Javascript check. It aborts the draft instantly if the `From:` header matches the owner's email (meaning we already replied manually), or if it matches an automated regex (like `noreply`, `updates`, `newsletter`). This protects API budgets from spam.
*   This node generates the actual reply draft for the user to review.
*   **The RAG Integration:** The node queries an external Vector Database (RAG) to pull factual business context (company policies, calendar rules, past deal terms).
*   **Why:** Without RAG, the LLM hallucinates. With RAG, the drafted response is factually grounded in your specific business logic. The draft is then pushed back to the respective email API. *(Specifically, the generated drafts are pushed natively via the Gmail API / Microsoft Graph API directly into the user's actual email account so they appear seamlessly in their inbox).*

### Branch B: Classifier and Summarizer
*   This node reads the running summary and raw emails to generate a short, 1-sentence user-facing summary and assigns an AI Category (e.g., "Attention", "Work & Professional", "Personal").
*   **RAG Intelligence:** Just like the Drafter, the Classifier node performs a local Vector Search against `memory_vectors.json`. If a client asks "I want to build a website", the Classifier pulls the business rule about website development and accurately tags the thread with "Attention".
*   **Structured Outputs:** Because it needs to generate two distinct pieces of data, we explicitly use **OpenAI Structured Outputs** (JSON mode). The LLM is forced to return a perfect JSON object containing two fields: `{ summary: "...", category: "..." }`.
*   **The Save:** It writes the `summary` string directly to the **Summaries SQLite Database**, and it runs an `UPDATE` query on the **Metadata SQLite Database** to inject the `category` string directly into the metadata row.
*   **Why:** Using structured outputs guarantees the JSON is perfectly parsable. The BFF can instantly query these tables and display the summary and category badges directly on the inbox list view, allowing the user to triage their inbox at a glance.

---

## Phase 5: Resolution & Status Sync (Fan-In)
Because Branch A and Branch B are parallel asynchronous tasks, they finish at different times. 

*   **The Completion Mark:** The architecture concludes with a barrier node. It waits for *both* parallel AI tasks to successfully finish their generation.
*   **The Persistent Draft Storage:** If the Drafter Node successfully created a native draft (e.g., via the Gmail or Microsoft Graph API), it returns a unique Draft ID. Before closing out, the worker executes a fast `UPDATE` to permanently save this `native_draft_id` into the **Metadata SQLite Database**. This elegantly bridges the backend with the BFF, allowing the UI to instantly query if a draft exists without making external API calls.
*   **The Final Sync:** Once both are done, the Completion Mark sends a final update back to the SQLite Status Database.
*   It flips the thread's status from `pending/processing` to `completed`.
*   **The Self-Cleaning Database:** Once the process is fully completed, the massive raw email payload sitting in the transient Threads Database is **permanently deleted**. This ensures the database stays ultra-tiny forever, saving massive amounts of disk space.
*   **Why:** This is the final signal. When the BFF reads `completed` from the database, it instructs the frontend UI to hide the "loading" spinners and officially unlock the AI tabs for the user.

---

## Architectural Decisions

### Why Standard LangChain over LangGraph?
While LangGraph is a powerful tool for building stateful, multi-agent AI loops, we explicitly chose **Standard LangChain orchestrated by pure Node.js (`worker.js`)** for this backend. The technical reasons are:

1. **Linear Pipeline vs. Cyclical Agency:** LangGraph is designed for unpredictable, looping agent behavior (e.g., trying a tool, failing, looping back). Our backend is a hyper-fast, perfectly predictable assembly line (`Memory -> Fan-Out -> Draft -> Finish`). We do not want the AI to "think about what to do next"; we want strict, forced progression.
2. **Maximum Orchestration Speed:** By using pure Javascript (`Promise.all`), we can launch multiple LangChain nodes (Summarizer, Categorizer, Drafter) at the *exact same millisecond* with zero framework overhead. Node.js's native asynchronous I/O allows multiple workers to pause and wait for OpenAI simultaneously without locking up the server.
3. **API Cost Efficiency:** LangGraph passes a heavy "global state" object to every node, consuming extra tokens just to evaluate conditional routing edges. Our architecture uses pure JavaScript `if/else` statements for routing (e.g., checking if the customer replied), entirely bypassing the LLM for routing and saving massive API costs.
4. **Simplicity:** If a pipeline breaks, diagnosing pure Javascript asynchronous functions in a single `worker.js` file is vastly easier than tracing state mutations through a complex graph definition.
