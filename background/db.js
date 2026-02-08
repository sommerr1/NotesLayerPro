// IndexedDB schema and operations

const DB_NAME = 'NotesLayerPro';
const DB_VERSION = 1;

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Pages store
      if (!database.objectStoreNames.contains('pages')) {
        const pagesStore = database.createObjectStore('pages', { keyPath: 'id' });
        pagesStore.createIndex('url', 'url', { unique: true });
        pagesStore.createIndex('createdAt', 'createdAt');
      }

      // Anchors store
      if (!database.objectStoreNames.contains('anchors')) {
        const anchorsStore = database.createObjectStore('anchors', { keyPath: 'id' });
        anchorsStore.createIndex('pageId', 'pageId');
        anchorsStore.createIndex('createdAt', 'createdAt');
      }

      // Notes store
      if (!database.objectStoreNames.contains('notes')) {
        const notesStore = database.createObjectStore('notes', { keyPath: 'id' });
        notesStore.createIndex('pageId', 'pageId');
        notesStore.createIndex('anchorId', 'anchorId');
        notesStore.createIndex('createdAt', 'createdAt');
      }
    };
  });
}

/**
 * Get database instance
 */
function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

/**
 * Save or update a page
 */
export async function savePage(url, title) {
  const database = getDB();
  const transaction = database.transaction(['pages'], 'readwrite');
  const store = transaction.objectStore('pages');
  const urlIndex = store.index('url');

  return new Promise((resolve, reject) => {
    // Check if page exists
    const getRequest = urlIndex.get(url);
    
    getRequest.onsuccess = () => {
      const existingPage = getRequest.result;
      const now = Date.now();

      if (existingPage) {
        // Update existing page
        existingPage.title = title;
        existingPage.updatedAt = now;
        const putRequest = store.put(existingPage);
        putRequest.onsuccess = () => resolve(existingPage);
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        // Create new page
        const page = {
          id: generateId(),
          url,
          title,
          createdAt: now,
          updatedAt: now
        };
        const addRequest = store.add(page);
        addRequest.onsuccess = () => resolve(page);
        addRequest.onerror = () => reject(addRequest.error);
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Get page by URL
 */
export async function getPageByUrl(url) {
  const database = getDB();
  const transaction = database.transaction(['pages'], 'readonly');
  const store = transaction.objectStore('pages');
  const urlIndex = store.index('url');

  return new Promise((resolve, reject) => {
    const request = urlIndex.get(url);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save anchor
 */
export async function saveAnchor(anchor) {
  const database = getDB();
  const transaction = database.transaction(['anchors'], 'readwrite');
  const store = transaction.objectStore('anchors');

  return new Promise((resolve, reject) => {
    if (!anchor.id) {
      anchor.id = generateId();
    }
    if (!anchor.createdAt) {
      anchor.createdAt = Date.now();
    }

    const request = store.put(anchor);
    request.onsuccess = () => resolve(anchor);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get anchor by ID
 */
export async function getAnchorById(anchorId) {
  const database = getDB();
  const transaction = database.transaction(['anchors'], 'readonly');
  const store = transaction.objectStore('anchors');

  return new Promise((resolve, reject) => {
    const request = store.get(anchorId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get anchors by page ID
 */
export async function getAnchorsByPageId(pageId) {
  const database = getDB();
  const transaction = database.transaction(['anchors'], 'readonly');
  const store = transaction.objectStore('anchors');
  const pageIdIndex = store.index('pageId');

  return new Promise((resolve, reject) => {
    const request = pageIdIndex.getAll(pageId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save note
 */
export async function saveNote(note) {
  const database = getDB();
  const transaction = database.transaction(['notes'], 'readwrite');
  const store = transaction.objectStore('notes');

  return new Promise((resolve, reject) => {
    if (!note.id) {
      note.id = generateId();
      note.createdAt = Date.now();
    }
    note.updatedAt = Date.now();

    const request = store.put(note);
    request.onsuccess = () => resolve(note);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get note by ID
 */
export async function getNoteById(noteId) {
  const database = getDB();
  const transaction = database.transaction(['notes'], 'readonly');
  const store = transaction.objectStore('notes');

  return new Promise((resolve, reject) => {
    const request = store.get(noteId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get notes by page ID
 */
export async function getNotesByPageId(pageId) {
  const database = getDB();
  const transaction = database.transaction(['notes'], 'readonly');
  const store = transaction.objectStore('notes');
  const pageIdIndex = store.index('pageId');

  return new Promise((resolve, reject) => {
    const request = pageIdIndex.getAll(pageId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get notes by anchor ID
 */
export async function getNotesByAnchorId(anchorId) {
  const database = getDB();
  const transaction = database.transaction(['notes'], 'readonly');
  const store = transaction.objectStore('notes');
  const anchorIdIndex = store.index('anchorId');

  return new Promise((resolve, reject) => {
    const request = anchorIdIndex.getAll(anchorId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pages
 */
export async function getAllPages() {
  const database = getDB();
  const transaction = database.transaction(['pages'], 'readonly');
  const store = transaction.objectStore('pages');

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search notes by text
 */
export async function searchNotes(query) {
  const database = getDB();
  const transaction = database.transaction(['notes'], 'readonly');
  const store = transaction.objectStore('notes');

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const allNotes = request.result || [];
      const lowerQuery = query.toLowerCase();
      
      const matchingNotes = allNotes.filter(note => {
        // Search in annotation content (Delta JSON string)
        const annotationText = note.annotationContent 
          ? JSON.stringify(note.annotationContent).toLowerCase()
          : '';
        const questionText = (note.questionContent || '').toLowerCase();
        const answerText = (note.aiAnswer || '').toLowerCase();
        
        return annotationText.includes(lowerQuery) ||
               questionText.includes(lowerQuery) ||
               answerText.includes(lowerQuery);
      });

      resolve(matchingNotes);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete note
 */
export async function deleteNote(noteId) {
  const database = getDB();
  
  // Get note to find anchorId
  const note = await new Promise((resolve, reject) => {
    const transaction = database.transaction(['notes'], 'readonly');
    const store = transaction.objectStore('notes');
    const request = store.get(noteId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  if (!note) {
    throw new Error('Note not found');
  }

  const anchorId = note.anchorId;

  // Delete note
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(['notes'], 'readwrite');
    const store = transaction.objectStore('notes');
    const request = store.delete(noteId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Check if anchor has any other notes, if not, delete anchor
  if (anchorId) {
    const notesForAnchor = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const anchorIdIndex = store.index('anchorId');
      const request = anchorIdIndex.getAll(anchorId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    // If no other notes use this anchor, delete it
    if (notesForAnchor.length === 0) {
      await deleteAnchor(anchorId);
    }
  }
}

/**
 * Delete anchor
 */
export async function deleteAnchor(anchorId) {
  const database = getDB();
  const transaction = database.transaction(['anchors'], 'readwrite');
  const store = transaction.objectStore('anchors');

  return new Promise((resolve, reject) => {
    const request = store.delete(anchorId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete page (and all associated notes and anchors)
 */
export async function deletePage(pageId) {
  const database = getDB();
  
  // Get all notes and anchors for this page
  const [notes, anchors] = await Promise.all([
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const pageIdIndex = store.index('pageId');
      const request = pageIdIndex.getAll(pageId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readonly');
      const store = transaction.objectStore('anchors');
      const pageIdIndex = store.index('pageId');
      const request = pageIdIndex.getAll(pageId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })
  ]);

  // Delete all notes
  for (const note of notes) {
    await deleteNote(note.id);
  }

  // Delete all anchors
  for (const anchor of anchors) {
    await deleteAnchor(anchor.id);
  }

  // Delete page
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pages'], 'readwrite');
    const store = transaction.objectStore('pages');
    const request = store.delete(pageId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Export all data to JSON
 */
export async function exportToJSON() {
  const database = getDB();
  
  const [pages, anchors, notes] = await Promise.all([
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['pages'], 'readonly');
      const store = transaction.objectStore('pages');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readonly');
      const store = transaction.objectStore('anchors');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })
  ]);

  return {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    pages,
    anchors,
    notes
  };
}

/**
 * Check for conflicts when importing data
 */
export async function checkImportConflicts(importData) {
  const database = getDB();
  
  // Get all existing IDs
  const [existingPages, existingAnchors, existingNotes] = await Promise.all([
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['pages'], 'readonly');
      const store = transaction.objectStore('pages');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readonly');
      const store = transaction.objectStore('anchors');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })
  ]);

  const existingPageIds = new Set(existingPages.map(p => p.id));
  const existingAnchorIds = new Set(existingAnchors.map(a => a.id));
  const existingNoteIds = new Set(existingNotes.map(n => n.id));

  const importPageIds = new Set((importData.pages || []).map(p => p.id));
  const importAnchorIds = new Set((importData.anchors || []).map(a => a.id));
  const importNoteIds = new Set((importData.notes || []).map(n => n.id));

  const pageConflicts = [...importPageIds].filter(id => existingPageIds.has(id)).length;
  const anchorConflicts = [...importAnchorIds].filter(id => existingAnchorIds.has(id)).length;
  const noteConflicts = [...importNoteIds].filter(id => existingNoteIds.has(id)).length;

  const totalConflicts = pageConflicts + anchorConflicts + noteConflicts;

  return {
    hasConflicts: totalConflicts > 0,
    conflictCount: totalConflicts,
    pageConflicts,
    anchorConflicts,
    noteConflicts
  };
}

/**
 * Import data from JSON with conflict resolution
 */
export async function importFromJSON(importData, conflictStrategy) {
  const database = getDB();
  
  const stats = {
    pagesAdded: 0,
    pagesUpdated: 0,
    anchorsAdded: 0,
    anchorsUpdated: 0,
    notesAdded: 0,
    notesUpdated: 0
  };

  // Import pages
  if (importData.pages && importData.pages.length > 0) {
    const existingPages = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['pages'], 'readonly');
      const store = transaction.objectStore('pages');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const existingPageIds = new Set(existingPages.map(p => p.id));

    for (const page of importData.pages) {
      const exists = existingPageIds.has(page.id);
      
      if (exists && conflictStrategy === 'keepOriginal') {
        // Skip conflicting page
        continue;
      }

      // Import or update page
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['pages'], 'readwrite');
        const store = transaction.objectStore('pages');
        
        // Ensure required fields
        if (!page.createdAt) page.createdAt = Date.now();
        page.updatedAt = Date.now();
        
        const request = store.put(page);
        request.onsuccess = () => {
          if (exists) {
            stats.pagesUpdated++;
          } else {
            stats.pagesAdded++;
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  // Import anchors
  if (importData.anchors && importData.anchors.length > 0) {
    const existingAnchors = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readonly');
      const store = transaction.objectStore('anchors');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const existingAnchorIds = new Set(existingAnchors.map(a => a.id));

    for (const anchor of importData.anchors) {
      const exists = existingAnchorIds.has(anchor.id);
      
      if (exists && conflictStrategy === 'keepOriginal') {
        // Skip conflicting anchor
        continue;
      }

      // Import or update anchor
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['anchors'], 'readwrite');
        const store = transaction.objectStore('anchors');
        
        // Ensure required fields
        if (!anchor.createdAt) anchor.createdAt = Date.now();
        
        const request = store.put(anchor);
        request.onsuccess = () => {
          if (exists) {
            stats.anchorsUpdated++;
          } else {
            stats.anchorsAdded++;
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  // Import notes
  if (importData.notes && importData.notes.length > 0) {
    const existingNotes = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const existingNoteIds = new Set(existingNotes.map(n => n.id));

    for (const note of importData.notes) {
      const exists = existingNoteIds.has(note.id);
      
      if (exists && conflictStrategy === 'keepOriginal') {
        // Skip conflicting note
        continue;
      }

      // Import or update note
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');
        
        // Ensure required fields
        if (!note.createdAt) note.createdAt = Date.now();
        note.updatedAt = Date.now();
        
        const request = store.put(note);
        request.onsuccess = () => {
          if (exists) {
            stats.notesUpdated++;
          } else {
            stats.notesAdded++;
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  return stats;
}

/**
 * Clear all notes, anchors, and pages
 */
export async function clearAllNotes() {
  const database = getDB();
  
  // Get all pages first
  const allPages = await new Promise((resolve, reject) => {
    const transaction = database.transaction(['pages'], 'readonly');
    const store = transaction.objectStore('pages');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  // Delete all pages (this will cascade delete notes and anchors via deletePage)
  for (const page of allPages) {
    await deletePage(page.id);
  }

  // Also clear any orphaned anchors and notes (in case of data inconsistency)
  const [allAnchors, allNotes] = await Promise.all([
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readonly');
      const store = transaction.objectStore('anchors');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }),
    new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })
  ]);

  // Delete orphaned anchors
  for (const anchor of allAnchors) {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['anchors'], 'readwrite');
      const store = transaction.objectStore('anchors');
      const request = store.delete(anchor.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Delete orphaned notes
  for (const note of allNotes) {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['notes'], 'readwrite');
      const store = transaction.objectStore('notes');
      const request = store.delete(note.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * Generate unique ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
