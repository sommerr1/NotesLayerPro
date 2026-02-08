// Popup script

let allPages = [];
let allNotes = [];
let currentSearchQuery = '';

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadPages();
  setupEventListeners();
});

/**
 * Load all pages with notes
 */
async function loadPages() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getAllPages'
    });

    if (response.success && response.pages) {
      allPages = response.pages;

      // Load notes for each page
      for (const page of allPages) {
        const notesResponse = await chrome.runtime.sendMessage({
          action: 'getNotesByPageId',
          pageId: page.id
        });

        if (notesResponse.success) {
          page.notes = notesResponse.notes || [];
        }
      }

      renderPages();
    } else {
      showError('Failed to load pages');
    }
  } catch (error) {
    console.error('Error loading pages:', error);
    showError('Error loading pages: ' + error.message);
  }
}

/**
 * Render pages list
 */
function renderPages() {
  const pagesList = document.getElementById('pagesList');
  if (!pagesList) return;

  if (allPages.length === 0) {
    pagesList.innerHTML = '<div class="empty-state">No pages with notes yet</div>';
    return;
  }

  pagesList.innerHTML = allPages.map(page => {
    const notesCount = page.notes?.length || 0;
    const notesList = notesCount > 0 ? renderNotesList(page.notes) : '';

    return `
      <div class="page-item" data-page-id="${page.id}">
        <div class="page-item-header">
          <div class="page-item-title">${escapeHtml(page.title)}</div>
          <div class="page-item-actions">
            ${notesCount > 0 ? `<span class="page-item-notes-count">${notesCount}</span>` : ''}
            <button class="btn-delete-page" data-page-id="${page.id}" title="Delete page">×</button>
          </div>
        </div>
        <div class="page-item-url">${escapeHtml(page.url)}</div>
        <div class="page-item-meta">
          Created: ${formatDate(page.createdAt)}
          ${notesCount > 0 ? `<span class="page-item-notes-count">${notesCount} note${notesCount > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${notesList}
      </div>
    `;
  }).join('');

  // Setup expand/collapse
  pagesList.querySelectorAll('.page-item').forEach(item => {
    const notesList = item.querySelector('.notes-list');
    if (notesList) {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.notes-list') && !e.target.closest('.btn-delete-page') && !e.target.closest('.btn-delete-note')) {
          notesList.classList.toggle('expanded');
        }
      });
    }
  });

  // Setup delete page buttons
  pagesList.querySelectorAll('.btn-delete-page').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pageId = btn.dataset.pageId;
      await deletePage(pageId);
    });
  });

  // Setup delete note buttons
  pagesList.querySelectorAll('.btn-delete-note').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.noteId;
      await deleteNoteFromPopup(noteId);
    });
  });

  // Setup double-click on URL to open in new tab
  pagesList.querySelectorAll('.page-item-url').forEach(urlElement => {
    urlElement.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const url = urlElement.textContent.trim();
      if (url) {
        chrome.tabs.create({ url: url });
      }
    });
    
    // Add visual feedback on hover
    urlElement.style.cursor = 'pointer';
    urlElement.title = 'Double-click to open in new tab';
  });
}

/**
 * Render notes list for a page
 */
function renderNotesList(notes) {
  if (!notes || notes.length === 0) {
    return '';
  }

  return `
    <div class="notes-list">
      ${notes.map(note => {
        const type = note.type || 'annotation';
        // Use title if available, otherwise extract from content or use type
        const displayTitle = note.title || extractTitleFromNote(note) || type;
        const preview = getNotePreview(note);
        
        return `
          <div class="note-item" data-note-id="${note.id}">
            <div class="note-item-content">
              <span class="note-item-type ${type}">${escapeHtml(displayTitle)}</span>
              <div class="note-item-preview">${escapeHtml(preview)}</div>
            </div>
            <button class="btn-delete-note" data-note-id="${note.id}" title="Delete note">×</button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Extract title from note content (fallback if title is not set)
 */
function extractTitleFromNote(note) {
  if (note.title) {
    return note.title;
  }

  if (note.type === 'question' && note.questionContent) {
    return note.questionContent.substring(0, 60).trim();
  }

  if (note.annotationContent) {
    try {
      const delta = typeof note.annotationContent === 'string'
        ? JSON.parse(note.annotationContent)
        : note.annotationContent;
      
      if (delta && delta.ops) {
        let text = '';
        for (const op of delta.ops) {
          if (typeof op.insert === 'string') {
            text += op.insert;
          }
        }
        
        // Get first line or first 60 characters
        const newlineIndex = text.indexOf('\n');
        let firstLine = newlineIndex !== -1 
          ? text.substring(0, newlineIndex).trim()
          : text.trim();
        
        if (firstLine.length > 60) {
          firstLine = firstLine.substring(0, 60).trim();
          const lastSpace = firstLine.lastIndexOf(' ');
          if (lastSpace > 40) {
            firstLine = firstLine.substring(0, lastSpace);
          }
        }
        
        return firstLine || null;
      }
    } catch (error) {
      // Ignore parsing errors
    }
  }

  return null;
}

/**
 * Get note preview text
 */
function getNotePreview(note) {
  if (note.type === 'question' && note.questionContent) {
    return `Q: ${note.questionContent}`;
  }
  
  if (note.aiAnswer) {
    return note.aiAnswer.substring(0, 100) + (note.aiAnswer.length > 100 ? '...' : '');
  }

  if (note.annotationContent) {
    try {
      const delta = typeof note.annotationContent === 'string'
        ? JSON.parse(note.annotationContent)
        : note.annotationContent;
      
      // Extract text from Quill Delta
      let text = '';
      if (delta.ops) {
        text = delta.ops
          .map(op => (typeof op.insert === 'string' ? op.insert : ''))
          .join('')
          .substring(0, 100);
      }
      
      return text || '(Empty note)';
    } catch (error) {
      return '(Invalid content)';
    }
  }

  return '(Empty note)';
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Search input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      
      searchTimeout = setTimeout(() => {
        if (query) {
          performSearch(query);
        } else {
          switchTab('pages');
        }
      }, 300);
    });
  }

  // Export button
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToJSON);
  }

  // Import button
  const importBtn = document.getElementById('importBtn');
  if (importBtn) {
    importBtn.addEventListener('click', importFromJSON);
  }

  // File input for import
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileSelect);
  }

  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearNotes);
  }

  // Reload button
  const reloadBtn = document.getElementById('reloadBtn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', reloadExtension);
  }
}

/**
 * Switch tab
 */
function switchTab(tab) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tab}Tab`);
  });
}

/**
 * Perform search
 */
async function performSearch(query) {
  currentSearchQuery = query;
  switchTab('search');

  const searchResults = document.getElementById('searchResults');
  if (!searchResults) return;

  searchResults.innerHTML = '<div class="loading">Searching...</div>';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'searchNotes',
      query
    });

    if (response.success && response.notes) {
      renderSearchResults(response.notes, query);
    } else {
      searchResults.innerHTML = '<div class="empty-state">No results found</div>';
    }
  } catch (error) {
    console.error('Error searching:', error);
    searchResults.innerHTML = '<div class="empty-state">Error searching notes</div>';
  }
}

/**
 * Render search results
 */
function renderSearchResults(notes, query) {
  const searchResults = document.getElementById('searchResults');
  if (!searchResults) return;

  if (notes.length === 0) {
    searchResults.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }

  // Group by page
  const notesByPage = {};
  for (const note of notes) {
    const page = allPages.find(p => p.id === note.pageId);
    if (page) {
      if (!notesByPage[page.id]) {
        notesByPage[page.id] = { page, notes: [] };
      }
      notesByPage[page.id].notes.push(note);
    }
  }

  searchResults.innerHTML = Object.values(notesByPage).map(({ page, notes: pageNotes }) => {
    return `
      <div class="search-result-item">
        <div class="search-result-page">${escapeHtml(page.title)} - ${escapeHtml(page.url)}</div>
        ${pageNotes.map(note => {
          const displayTitle = note.title || extractTitleFromNote(note) || (note.type || 'annotation');
          const preview = highlightText(getNotePreview(note), query);
          return `
            <div class="search-result-note" data-note-id="${note.id}">
              <div class="search-result-title">${escapeHtml(displayTitle)}</div>
              <div class="search-result-note-content-wrapper">
                <div class="search-result-content">${preview}</div>
                <button class="btn-delete-note" data-note-id="${note.id}" title="Delete note">×</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  // Setup delete note buttons in search results
  searchResults.querySelectorAll('.btn-delete-note').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.noteId;
      await deleteNoteFromPopup(noteId);
      // Re-run search to update results
      if (currentSearchQuery) {
        await performSearch(currentSearchQuery);
      }
    });
  });

  // Setup double-click on URL in search results to open in new tab
  searchResults.querySelectorAll('.search-result-page').forEach(pageElement => {
    // Extract URL from the text (format: "Title - URL")
    pageElement.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const text = pageElement.textContent.trim();
      // Extract URL (everything after " - ")
      const urlMatch = text.match(/ - (.+)$/);
      if (urlMatch && urlMatch[1]) {
        const url = urlMatch[1].trim();
        if (url) {
          chrome.tabs.create({ url: url });
        }
      }
    });
    
    // Add visual feedback on hover
    pageElement.style.cursor = 'pointer';
    pageElement.title = 'Double-click to open URL in new tab';
  });
}

/**
 * Highlight search text
 */
function highlightText(text, query) {
  if (!query) return escapeHtml(text);
  
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return escapeHtml(text).replace(regex, '<span class="search-highlight">$1</span>');
}

/**
 * Export to JSON
 */
async function exportToJSON() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'exportToJSON'
    });

    if (response.success) {
      // Show success message
      const btn = document.getElementById('exportBtn');
      const originalText = btn.textContent;
      btn.textContent = 'Exporting...';
      btn.disabled = true;

      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } else {
      alert('Export failed: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error exporting:', error);
    alert('Error exporting: ' + error.message);
  }
}

/**
 * Import from JSON - opens file picker
 */
function importFromJSON() {
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.click();
  }
}

/**
 * Handle file selection for import
 */
async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const importBtn = document.getElementById('importBtn');
  const originalText = importBtn.textContent;
  importBtn.textContent = 'Importing...';
  importBtn.disabled = true;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    // Validate structure
    if (!importData.pages || !importData.anchors || !importData.notes) {
      throw new Error('Invalid import file format. Expected: { pages, anchors, notes }');
    }

    // Check for conflicts
    const conflictCheck = await chrome.runtime.sendMessage({
      action: 'checkImportConflicts',
      importData
    });

    if (!conflictCheck.success) {
      throw new Error(conflictCheck.error || 'Failed to check conflicts');
    }

    let conflictStrategy = 'keepOriginal'; // default

    // If conflicts exist, ask user for strategy
    if (conflictCheck.hasConflicts) {
      const userChoice = confirm(
        `Found ${conflictCheck.conflictCount} conflicting items.\n\n` +
        `Click OK to use imported data (replace existing)\n` +
        `Click Cancel to keep original data (skip conflicts)`
      );
      conflictStrategy = userChoice ? 'useImported' : 'keepOriginal';
    }

    // Perform import
    const importResponse = await chrome.runtime.sendMessage({
      action: 'importFromJSON',
      importData,
      conflictStrategy
    });

    if (importResponse.success) {
      const stats = importResponse.stats;
      alert(
        `Import completed!\n\n` +
        `Pages: ${stats.pagesAdded} added, ${stats.pagesUpdated} updated\n` +
        `Anchors: ${stats.anchorsAdded} added, ${stats.anchorsUpdated} updated\n` +
        `Notes: ${stats.notesAdded} added, ${stats.notesUpdated} updated`
      );
      // Reload pages list
      await loadPages();
    } else {
      throw new Error(importResponse.error || 'Import failed');
    }
  } catch (error) {
    console.error('Error importing:', error);
    alert('Error importing: ' + error.message);
  } finally {
    importBtn.textContent = originalText;
    importBtn.disabled = false;
    // Reset file input
    event.target.value = '';
  }
}

// State for clear notes confirmation
let clearNotesConfirmState = false;

/**
 * Clear all notes with confirmation
 */
async function clearNotes() {
  const clearBtn = document.getElementById('clearBtn');
  
  if (!clearNotesConfirmState) {
    // First click - show warning
    clearNotesConfirmState = true;
    const originalText = clearBtn.textContent;
    clearBtn.textContent = '⚠️ All notes will be permanently deleted. Click again to confirm';
    clearBtn.classList.add('confirm-state');
    
    // Reset after 5 seconds if not confirmed
    setTimeout(() => {
      if (clearNotesConfirmState) {
        clearNotesConfirmState = false;
        clearBtn.textContent = originalText;
        clearBtn.classList.remove('confirm-state');
      }
    }, 5000);
  } else {
    // Second click - confirm and clear
    clearNotesConfirmState = false;
    clearBtn.textContent = 'Clearing...';
    clearBtn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'clearAllNotes'
      });

      if (response.success) {
        alert('All notes have been permanently deleted.');
        // Reload pages list
        await loadPages();
      } else {
        throw new Error(response.error || 'Failed to clear notes');
      }
    } catch (error) {
      console.error('Error clearing notes:', error);
      alert('Error clearing notes: ' + error.message);
    } finally {
      clearBtn.textContent = 'Clear Notes';
      clearBtn.classList.remove('confirm-state');
      clearBtn.disabled = false;
    }
  }
}

/**
 * Reload extension
 */
async function reloadExtension() {
  // Обновляем все открытые вкладки
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        chrome.tabs.reload(tab.id);
      }
    }
  } catch (error) {
    console.error('Error reloading tabs:', error);
  }
  
  // Перезагружаем расширение без диалога подтверждения
  chrome.runtime.reload();
}

/**
 * Delete note from popup
 */
async function deleteNoteFromPopup(noteId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deleteNote',
      noteId
    });

    if (response.success) {
      // Reload pages to update the list
      await loadPages();
    } else {
      alert('Failed to delete note: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error deleting note:', error);
    alert('Error deleting note: ' + error.message);
  }
}

/**
 * Delete page from popup
 */
async function deletePage(pageId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deletePage',
      pageId
    });

    if (response.success) {
      // Reload pages to update the list
      await loadPages();
    } else {
      alert('Failed to delete page: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error deleting page:', error);
    alert('Error deleting page: ' + error.message);
  }
}

/**
 * Show error message
 */
function showError(message) {
  const pagesList = document.getElementById('pagesList');
  if (pagesList) {
    pagesList.innerHTML = `<div class="empty-state" style="color: red;">${escapeHtml(message)}</div>`;
  }
}

/**
 * Utility functions
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}
