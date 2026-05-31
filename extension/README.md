# Wiredge Chrome Extension

Wiredge is a premium UI Compression Engine & Context Tracker designed to optimize how you interact with AI models.

## Core Features

- ⚡ **Prompt Compression:** Shrink prompt sizes by up to 40% while preserving context using our local compression engine (requires a Groq API key).
- 🔄 **Cross-LLM Handoff:** Instantly transfer your active conversation context between Claude, ChatGPT, Gemini, and Grok. Hit a limit on Claude? Pick up right where you left off on ChatGPT.
- 📊 **Live Usage Tracking:** Real-time quota and limit tracking for Claude, injected directly into the web UI.
- 🔒 **Privacy First:** 100% of your conversation history and API keys are stored securely in your browser's local storage.

## How to Install (Developer Mode)

To run this extension locally before it is published on the Chrome Web Store:

1. Download or clone this repository to your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle **Developer mode** ON in the top right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the `/extension` directory from this repository.
6. Navigate to `claude.ai` or `chatgpt.com` and start typing to see the Wiredge FAB (Floating Action Button) appear!

## Architecture

*   **Manifest V3:** Fully compliant with Chrome's MV3 standard.
*   **Content Scripts:** Injects highly optimized, non-blocking UI elements (`prompt-compressor.js`, `sidebar-panel.js`) into target AI websites.
*   **Background Service Worker:** Handles secure cross-origin API calls and memory management (`background.js`).
*   **Zero Dependencies:** Built entirely with vanilla JavaScript, HTML, and CSS for maximum performance and zero bloat.

*Created by dotiolabs*
