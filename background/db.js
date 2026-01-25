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
 * Generate unique ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
