1. The "Infinite Spinning" Race Condition
The Problem: When Version 1 (the initial processing) finishes creating the draft via the Gmail API, Gmail instantly triggers a history change. Your Delta Sync cron detects this and creates Version 2, updating the database status to pending. Version 1 then tries to mark the thread as completed, but it fails because the database is already locked to Version 2. Version 2 is then enqueued, but because shouldDraft is false, it speeds through the nodes and attempts to complete. However, due to the tight race condition in worker.js and dbSync.js, the payload for v2 is either overwritten or discarded before Phase 5 finishes successfully. The database is permanently abandoned in pending.

Possible Fixes:

The "Ignore Own Drafts" Fix (Recommended): In adapter.js Delta Sync, we can check if the only new message added to the thread is an AI Draft. If it is, we simply update metadataDb with the new timestamp and do not queue v2 to the worker at all, leaving the status as completed.
The Phase 5 Graceful Exit: Modify worker.js Phase 5 so that if the database live_version is newer, it doesn't just fail silently. It can intelligently realize that the newer version was just an AI draft trigger and force the status to completed anyway.
2. The Hidden Summary and Draft in the UI
The Problem: Because the database is stuck in pending, your BFF routes (drafterService.js and summarizerService.js) are trapped. They have a while loop that forces the UI to show a loading spinner as long as the status is pending. Even though Version 1 successfully saved the AI Summary to summariesDb and the Draft to Gmail, the BFF refuses to serve them to the frontend because it's waiting for that pending status to change (which it never will).

Possible Fixes:

Smart BFF Polling: Update the BFF services so that they check if the summary or draft already exists in the database. If they exist, the BFF should immediately return them to the UI, even if the status is technically still pending.
Timeout Fallback: Add a timeout to the BFF polling loop. If it spins for more than 10 seconds, it should break the loop and serve whatever is currently in the database to prevent the UI from freezing.

3. The Mismatched "Live Typing" Drafts
The Problem: The background worker successfully calls the AI to generate a draft and saves it to Gmail. However, in Phase 5, the worker only saves the `native_draft_id` into the metadata database and forgets to update `is_draft = 1`. Because the database still says `is_draft = 0`, the UI mistakenly believes no draft exists. When a user clicks the email, the UI hits Condition 2, ignoring the draft in Gmail and triggering an expensive duplicate dynamic re-generation of the draft. This causes an unexpected "live typing" delay on the screen, and the resulting text in the UI differs from the text originally saved to Gmail.

Possible Fixes:
Update the worker's Phase 5 database query to explicitly set `is_draft = 1` alongside the `native_draft_id`.