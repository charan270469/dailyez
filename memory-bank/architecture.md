9. Is the tree from item 2 the intended final layout, or is Cline still reorganizing it (src/features, src/services vs src/lib, server/config)? Tell me which parts are final.
10. Mark each of these as done, partial, not done, or unsure:

central env config module
per-Google-account WhatsApp session folders
resume-previous-session prompt
data purge on explicit Disconnect
account guard when a different number links
PDF parsing UI toggle plus Gemini extraction
Kokoro local TTS fallback
React Context state store
Groq to Gemini matching fallback
ntfy notifications
Is this data flow still accurate? Gmail is fetched by a 2 minute cron or manually, and WhatsApp arrives live through Baileys. Both go through the orchestrator (keyword prefilter, deterministic sender match, extraction, classification, verification on medium or low confidence), are saved to MongoDB Atlas, and are pushed to the Matched tab over SSE. What should change?
Are there any external services beyond Google OAuth and Gmail API, WhatsApp via Baileys, Groq, Gemini, MongoDB Atlas and local Kokoro?
