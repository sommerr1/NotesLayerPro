// Background service worker

import { initDB, savePage, saveAnchor, saveNote, getPageByUrl, getNotesByPageId, getAnchorsByPageId, getNoteById, getAnchorById, deleteNote, deleteAnchor, deletePage, getAllPages, searchNotes, exportToJSON } from './db.js';
import { GoogleSearchProvider } from './google-search-provider.js';

let llmProvider = null;

// Initialize database on install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await initDB();
    console.log('Notes Layer Pro: Database initialized');
    
    // Create context menu
    chrome.contextMenus.create({
      id: 'create-note',
      title: '📝 Create Note',
      contexts: ['selection']
    });
  } catch (error) {
    console.error('Notes Layer Pro: Failed to initialize database', error);
  }
});

// Initialize database on startup
chrome.runtime.onStartup.addListener(async () => {
  try {
    await initDB();
    console.log('Notes Layer Pro: Database initialized on startup');
    
    // Ensure context menu exists (in case it wasn't created on install)
    chrome.contextMenus.create({
      id: 'create-note',
      title: '📝 Create Note',
      contexts: ['selection']
    }, () => {
      // Ignore error if menu already exists
      if (chrome.runtime.lastError) {
        // console.log('Context menu already exists');
      }
    });
  } catch (error) {
    console.error('Notes Layer Pro: Failed to initialize database', error);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'create-note') {
    chrome.tabs.sendMessage(tab.id, { action: 'createNoteFromContextMenu' });
  }
});

// Initialize LLM provider
function getLLMProvider() {
  if (!llmProvider) {
    llmProvider = new GoogleSearchProvider();
  }
  return llmProvider;
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  try {
    // Ensure DB is initialized
    try {
      await initDB();
    } catch (error) {
      // DB might already be initialized
      console.log('DB initialization check:', error.message);
    }

    switch (message.action) {
      case 'initDB': {
        await initDB();
        sendResponse({ success: true });
        break;
      }

      case 'savePage': {
        const page = await savePage(message.url, message.title);
        sendResponse({ success: true, page });
        break;
      }

      case 'getPageByUrl': {
        const existingPage = await getPageByUrl(message.url);
        sendResponse({ success: true, page: existingPage });
        break;
      }

      case 'saveAnchor': {
        const anchor = await saveAnchor(message.anchor);
        sendResponse({ success: true, anchor });
        break;
      }

      case 'getAnchorsByPageId': {
        const anchors = await getAnchorsByPageId(message.pageId);
        sendResponse({ success: true, anchors });
        break;
      }

      case 'getAnchorById': {
        const anchor = await getAnchorById(message.anchorId);
        sendResponse({ success: true, anchor });
        break;
      }

      case 'saveNote': {
        const note = await saveNote(message.note);
        sendResponse({ success: true, note });
        break;
      }

      case 'getNoteById': {
        const foundNote = await getNoteById(message.noteId);
        sendResponse({ success: true, note: foundNote });
        break;
      }

      case 'getNotesByPageId': {
        const notes = await getNotesByPageId(message.pageId);
        sendResponse({ success: true, notes });
        break;
      }

      case 'deleteNote': {
        await deleteNote(message.noteId);
        sendResponse({ success: true });
        break;
      }

      case 'deleteAnchor': {
        await deleteAnchor(message.anchorId);
        sendResponse({ success: true });
        break;
      }

      case 'deletePage': {
        await deletePage(message.pageId);
        sendResponse({ success: true });
        break;
      }

      case 'askAI': {
        const provider = getLLMProvider();
        const result = await provider.askQuestion(message.question);
        // Handle both string and object responses (with screenshot)
        if (typeof result === 'string') {
          sendResponse({ success: true, answer: result });
        } else if (result && result.text) {
          sendResponse({ success: true, answer: result.text, screenshot: result.screenshot || null });
        } else {
          sendResponse({ success: true, answer: result });
        }
        break;
      }

      case 'getAllPages': {
        const allPages = await getAllPages();
        sendResponse({ success: true, pages: allPages });
        break;
      }

      case 'searchNotes': {
        const searchResults = await searchNotes(message.query);
        sendResponse({ success: true, notes: searchResults });
        break;
      }

      case 'exportToJSON': {
        try {
          const exportData = await exportToJSON();
          const jsonString = JSON.stringify(exportData, null, 2);
          const dateStr = new Date().toISOString().split('T')[0];
          const filename = `notes-export-${dateStr}.json`;
          
          // Convert to base64 data URL (URL.createObjectURL is not available in service workers)
          const base64 = btoa(unescape(encodeURIComponent(jsonString)));
          const dataUrl = `data:application/json;base64,${base64}`;
          
          chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, downloadId });
            }
          });
        } catch (error) {
          console.error('Error exporting to JSON:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      default: {
        sendResponse({ success: false, error: 'Unknown action' });
        break;
      }
    }
  } catch (error) {
    console.error('Notes Layer Pro: Error handling message', error);
    sendResponse({ success: false, error: error.message });
  }
}

