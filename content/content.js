// Main content script
// Note: anchor.js, highlighter.js, and note-card.js are loaded before this script

/**
 * Safe message sender that handles extension context invalidation
 */
async function safeSendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    
    // Check if extension context was invalidated
    if (chrome.runtime.lastError) {
      if (chrome.runtime.lastError.message && 
          (chrome.runtime.lastError.message.includes('Extension context invalidated') ||
           chrome.runtime.lastError.message.includes('message port closed'))) {
        throw new Error('EXTENSION_CONTEXT_INVALIDATED');
      }
      throw new Error(chrome.runtime.lastError.message);
    }
    
    return response;
  } catch (error) {
    if (error.message === 'EXTENSION_CONTEXT_INVALIDATED') {
      // Show user-friendly error
      const shouldReload = confirm(
        'Расширение было перезагружено. Перезагрузить страницу для продолжения работы?\n\n' +
        'Нажмите "OK" для перезагрузки страницы или "Отмена" чтобы попробовать еще раз.'
      );
      if (shouldReload) {
        window.location.reload();
      }
      throw new Error('Extension context invalidated. Please reload the page.');
    }
    throw error;
  }
}

class NotesLayerContent {
  constructor() {
    // Check if Highlighter is available
    if (typeof Highlighter === 'undefined') {
      throw new Error('Highlighter class is not defined. Please reload the page.');
    }
    
    this.highlighter = new Highlighter();
    this.openCards = new Map(); // noteId -> NoteCard instance
    this.currentPage = null;
    this.isInitialized = false;
    this.hoverTimeout = null;
    this.currentTooltip = null;
    this.currentNoteId = null;
    this.isCreatingNote = false; // Flag to prevent duplicate note creation
  }

  /**
   * Initialize content script
   */
  async init() {
    if (this.isInitialized) {
      console.log('Notes Layer Pro: Already initialized, skipping');
      return;
    }

    try {
      console.log('Notes Layer Pro: Starting initialization...', {
        readyState: document.readyState,
        url: window.location.href
      });
      
      // Wait for DOM to be ready if needed
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
      }

      // Additional wait for dynamic content (especially for SPAs)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get current page info
      await this.loadPageInfo();
      console.log('Notes Layer Pro: Page info loaded', this.currentPage ? `pageId: ${this.currentPage.id}` : 'no page');

      // Restore notes for current page
      await this.restoreNotes();
      console.log('Notes Layer Pro: Notes restored');

      // Setup text selection handler
      this.setupSelectionHandler();
      console.log('Notes Layer Pro: Selection handler setup');

      // Setup marker click handlers FIRST (for existing highlights)
      // This must be before double-click handler to check for highlights first
      this.setupMarkerHandlers();
      console.log('Notes Layer Pro: Marker handlers setup');

      // Setup double-click handler SECOND (for creating new notes)
      this.setupDoubleClickHandler();
      console.log('Notes Layer Pro: Double-click handler setup');

      // Setup custom event listeners
      this.setupEventListeners();
      console.log('Notes Layer Pro: Event listeners setup');

      // Setup scroll and resize handlers for marker positions
      this.setupMarkerPositionHandlers();
      console.log('Notes Layer Pro: Marker position handlers setup');

      // Setup handlers to hide tooltip on scroll/click
      this.setupTooltipHideHandlers();
      console.log('Notes Layer Pro: Tooltip hide handlers setup');

      this.isInitialized = true;
      console.log('Notes Layer Pro: Initialization complete');
    } catch (error) {
      console.error('Notes Layer Pro: Error during initialization:', error);
      // Don't block - try to continue
      this.isInitialized = true;
    }
  }

  /**
   * Extract Copilot chat title from the page
   * Tries multiple strategies to find the actual chat title in the sidebar
   */
  getCopilotChatTitle() {
    if (!this.isCopilotPage()) {
      return null;
    }

    // Try multiple strategies to find the chat title
    // Strategy 1: Look for active/selected chat item in sidebar
    const activeChatSelectors = [
      '[aria-selected="true"]',
      '[aria-current="page"]',
      '[aria-label*="chat" i]',
      '.active',
      '[class*="active"]',
      '[class*="selected"]',
      '[data-selected="true"]',
      '[role="listitem"][aria-selected="true"]',
      'a[href*="/chats/"]',
      'button[href*="/chats/"]'
    ];

    for (const selector of activeChatSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Check if this element is in a sidebar/navigation area or has href matching current URL
          const href = el.getAttribute('href') || '';
          const currentUrl = window.location.href;
          const isCurrentChat = href && currentUrl.includes(href.split('/').pop());
          const isInSidebar = el.closest('nav, aside, [role="navigation"], [class*="sidebar"], [class*="nav"], [class*="chat-list"]');
          
          if (isInSidebar || isCurrentChat) {
            // Try to get text from the element or its children
            let text = el.textContent?.trim();
            
            // If text is too long, try to get from a child element that looks like a title
            if (!text || text.length > 200) {
              const titleChild = el.querySelector('[class*="title"], [class*="name"], [class*="chat-title"], span, div');
              if (titleChild) {
                text = titleChild.textContent?.trim();
              }
            }
            
            if (text && text.length > 0 && text.length < 200) {
              // Filter out generic text like "Copilot", navigation labels, etc.
              const lowerText = text.toLowerCase();
              if (!lowerText.includes('copilot') && 
                  !lowerText.includes('для вас') && 
                  !lowerText.includes('представить новое') &&
                  !lowerText.includes('библиотека') &&
                  !lowerText.includes('labs') &&
                  !lowerText.includes('типы заметок') &&
                  !lowerText.match(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/i) &&
                  !lowerText.match(/^github copilot/i)) {
                console.log('Notes Layer Pro: Found Copilot chat title via active selector:', text);
                return text;
              }
            }
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Strategy 2: Look for chat title in URL-based elements
    // Microsoft Copilot URLs often have chat IDs, look for elements that might contain the title
    try {
      const urlMatch = window.location.href.match(/\/chats\/([^\/\?]+)/);
      if (urlMatch) {
        const chatId = urlMatch[1];
        // Look for elements that might be associated with this chat
        const possibleTitleElements = document.querySelectorAll(
          `a[href*="${chatId}"], button[href*="${chatId}"], [data-chat-id*="${chatId}"], [data-id*="${chatId}"], [href*="/chats/${chatId}"]`
        );
        
        for (const el of possibleTitleElements) {
          let text = el.textContent?.trim();
          
          // Try to get from child if text is too long
          if (!text || text.length > 200) {
            const titleChild = el.querySelector('[class*="title"], [class*="name"], [class*="chat-title"]');
            if (titleChild) {
              text = titleChild.textContent?.trim();
            }
          }
          
          if (text && text.length > 0 && text.length < 200) {
            const lowerText = text.toLowerCase();
            if (!lowerText.includes('copilot') && 
                !lowerText.includes('для вас') && 
                !lowerText.includes('представить новое') &&
                !lowerText.includes('библиотека') &&
                !lowerText.includes('labs') &&
                !lowerText.match(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/i)) {
              console.log('Notes Layer Pro: Found Copilot chat title from URL match:', text);
              return text;
            }
          }
        }
      }
    } catch (e) {
      // Continue to next strategy
    }

    // Strategy 3: Look in sidebar for the most prominent text that's not navigation
    try {
      const sidebarSelectors = [
        'nav',
        'aside',
        '[role="navigation"]',
        '[class*="sidebar"]',
        '[class*="nav"]',
        '[class*="chat-list"]',
        '[class*="conversation-list"]'
      ];
      
      let sidebar = null;
      for (const selector of sidebarSelectors) {
        sidebar = document.querySelector(selector);
        if (sidebar) break;
      }
      
      if (sidebar) {
        // Find all links/buttons in sidebar that might be chat titles
        const links = sidebar.querySelectorAll('a, button, [role="link"], [role="button"]');
        const candidates = [];
        
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const isChatLink = href.includes('/chats/');
          const text = link.textContent?.trim();
          
          if (text && text.length > 3 && text.length < 200 && isChatLink) {
            const lowerText = text.toLowerCase();
            // Skip navigation labels and generic text
            if (!lowerText.includes('copilot') && 
                !lowerText.includes('для вас') && 
                !lowerText.includes('представить новое') &&
                !lowerText.includes('библиотека') &&
                !lowerText.includes('labs') &&
                !lowerText.includes('типы заметок') &&
                !lowerText.match(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/i)) {
              
              // Check if this link matches current URL
              const currentUrl = window.location.href;
              const urlMatch = currentUrl.match(/\/chats\/([^\/\?]+)/);
              const currentChatId = urlMatch ? urlMatch[1] : null;
              const hrefChatId = href.match(/\/chats\/([^\/\?]+)/);
              const isCurrent = (currentChatId && hrefChatId && currentChatId === hrefChatId[1]) ||
                               currentUrl.includes(href.split('/').pop()) ||
                               link.getAttribute('aria-selected') === 'true' ||
                               link.getAttribute('aria-current') === 'page';
              
              candidates.push({ 
                text, 
                priority: isCurrent ? 1 : 2,
                isCurrent 
              });
            }
          }
        }

        if (candidates.length > 0) {
          // Sort by priority (current chat first) and return the first one
          candidates.sort((a, b) => {
            if (a.isCurrent && !b.isCurrent) return -1;
            if (!a.isCurrent && b.isCurrent) return 1;
            return a.priority - b.priority;
          });
          const title = candidates[0].text;
          console.log('Notes Layer Pro: Found Copilot chat title from sidebar links:', title);
          return title;
        }
      }
    } catch (e) {
      console.warn('Notes Layer Pro: Error extracting chat title from sidebar:', e);
    }

    // Strategy 4: Try to extract from page title if it contains useful info
    // Sometimes document.title might have the chat title
    const docTitle = document.title;
    if (docTitle && !docTitle.includes('Microsoft Copilot: ваш ИИ-помощник')) {
      // If title is different from generic, might be useful
      const titleMatch = docTitle.match(/^(.+?)\s*[-–—]\s*Microsoft Copilot/i);
      if (titleMatch && titleMatch[1]) {
        const extracted = titleMatch[1].trim();
        if (extracted.length > 0 && extracted.length < 200) {
          console.log('Notes Layer Pro: Found Copilot chat title from document.title:', extracted);
          return extracted;
        }
      }
    }

    console.log('Notes Layer Pro: Could not extract Copilot chat title');
    return null;
  }

  /**
   * Load or create page info
   */
  async loadPageInfo(retryCount = 0) {
    try {
      const url = window.location.href;
      let title = document.title;

      // Try to extract Copilot chat title if on Copilot page
      if (this.isCopilotPage()) {
        // Wait a bit for dynamic content to load (especially for Copilot)
        if (retryCount === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        const chatTitle = this.getCopilotChatTitle();
        if (chatTitle) {
          title = chatTitle;
          console.log('Notes Layer Pro: Using Copilot chat title:', title);
        } else if (retryCount < 3) {
          // Retry a few times for dynamic content
          console.log(`Notes Layer Pro: Chat title not found, retrying (${retryCount + 1}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.loadPageInfo(retryCount + 1);
        }
      }

      const response = await safeSendMessage({
        action: 'getPageByUrl',
        url
      });

      if (response.success) {
        if (response.page) {
          // Update title if it's different and we're on Copilot
          if (this.isCopilotPage() && response.page.title !== title && title !== document.title) {
            const updateResponse = await safeSendMessage({
              action: 'savePage',
              url,
              title
            });
            if (updateResponse.success) {
              this.currentPage = updateResponse.page;
            } else {
              this.currentPage = response.page;
            }
          } else {
            this.currentPage = response.page;
          }
        } else {
          // Create new page
          const createResponse = await safeSendMessage({
            action: 'savePage',
            url,
            title
          });

          if (createResponse.success) {
            this.currentPage = createResponse.page;
          }
        }
      }
    } catch (error) {
      console.error('Error loading page info:', error);
    }
  }

  /**
   * Check if current page is Copilot
   */
  isCopilotPage() {
    return typeof AnchorManager !== 'undefined' && AnchorManager.isCopilotPage();
  }

  /**
   * Restore notes for current page
   */
  async restoreNotes(retryCount = 0) {
    if (!this.currentPage) {
      console.log('Notes Layer Pro: No current page, skipping restore');
      return;
    }

    const isCopilot = this.isCopilotPage();
    const maxRetries = isCopilot ? 10 : 5; // More retries for Copilot
    
    try {
      console.log(`Notes Layer Pro: Starting restore notes for page: ${this.currentPage.id} (attempt ${retryCount + 1})${isCopilot ? ' [Copilot-optimized]' : ''}`);
      
      // Wait a bit for dynamic content to load (especially for SPAs)
      // For Copilot, wait longer as content loads dynamically
      const waitTime = isCopilot ? 500 + retryCount * 200 : 200 + retryCount * 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Ensure DOM is ready
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
          } else {
            resolve();
          }
        });
      }

      // Additional wait for body to be ready
      if (!document.body) {
        await new Promise(resolve => {
          const checkBody = setInterval(() => {
            if (document.body) {
              clearInterval(checkBody);
              resolve();
            }
          }, 50);
          // Timeout after 2 seconds
          setTimeout(() => {
            clearInterval(checkBody);
            resolve();
          }, 2000);
        });
      }

      // Get notes and anchors for this page
      const [notesResponse, anchorsResponse] = await Promise.all([
        safeSendMessage({
          action: 'getNotesByPageId',
          pageId: this.currentPage.id
        }),
        safeSendMessage({
          action: 'getAnchorsByPageId',
          pageId: this.currentPage.id
        })
      ]);

      if (notesResponse.success && anchorsResponse.success) {
        const notes = notesResponse.notes || [];
        const anchors = anchorsResponse.anchors || [];

        console.log('Notes Layer Pro: Found notes:', notes.length, 'anchors:', anchors.length);

        if (notes.length > 0 && anchors.length > 0) {
          // Restore highlights
          await this.highlighter.restoreHighlights(notes, anchors);
          
          // Verify restoration
          const restoredCount = this.highlighter.highlights.size;
          console.log(`Notes Layer Pro: Restored ${restoredCount} highlights from ${notes.length} notes`);
          
          // If restoration failed but we have notes, retry
          // For Copilot, be more aggressive with retries
          const retryDelay = isCopilot ? 1000 : 500;
          if (restoredCount === 0 && retryCount < maxRetries) {
            console.log(`Notes Layer Pro: No highlights restored, retrying in ${retryDelay}ms...`);
            setTimeout(() => this.restoreNotes(retryCount + 1), retryDelay);
            return;
          }
          
          // For Copilot, also retry if not all notes were restored
          if (isCopilot && restoredCount > 0 && restoredCount < notes.length && retryCount < maxRetries) {
            console.log(`Notes Layer Pro: Only ${restoredCount}/${notes.length} restored, retrying for remaining...`);
            setTimeout(() => this.restoreNotes(retryCount + 1), retryDelay);
            return;
          }
          
          if (restoredCount > 0) {
            console.log('Notes Layer Pro: Notes restored successfully');
          } else {
            console.warn('Notes Layer Pro: Failed to restore any highlights after', retryCount + 1, 'attempts');
          }
        } else {
          console.log('Notes Layer Pro: No notes to restore');
        }
      } else {
        console.warn('Notes Layer Pro: Failed to get notes/anchors', {
          notesSuccess: notesResponse.success,
          anchorsSuccess: anchorsResponse.success
        });
        
        // Retry if we got an error
        // For Copilot, retry more aggressively
        const retryDelay = isCopilot ? 1000 : 500;
        if (retryCount < maxRetries) {
          console.log(`Notes Layer Pro: Retrying to get notes/anchors in ${retryDelay}ms...`);
          setTimeout(() => this.restoreNotes(retryCount + 1), retryDelay);
        }
      }
    } catch (error) {
      console.error('Error restoring notes:', error);
      
      // Retry on error
      // For Copilot, retry more aggressively
      const retryDelay = isCopilot ? 1000 : 500;
      if (retryCount < maxRetries) {
        console.log(`Notes Layer Pro: Retrying after error in ${retryDelay}ms...`);
        setTimeout(() => this.restoreNotes(retryCount + 1), retryDelay);
      }
    }
  }

  /**
   * Setup text selection handler
   */
  setupSelectionHandler() {
    try {
      document.addEventListener('mouseup', async (e) => {
        try {
          // Don't interfere with existing UI interactions
          if (this.closestFromEvent(e, '.notes-layer-card-container') ||
              this.closestFromEvent(e, '.notes-layer-marker')) {
            return;
          }

          const selection = window.getSelection();
          if (!selection) {
            return;
          }
          
          const selectedText = selection.toString().trim();

          // Check if we're waiting for re-anchoring
          if (this.waitingForReanchor && selectedText && selectedText.length > 0) {
            await this.reanchorNoteToSelection(this.waitingForReanchor, selection);
            this.waitingForReanchor = null;
            // Remove instruction
            const instruction = document.querySelector('.notes-layer-reanchor-instruction');
            if (instruction) {
              instruction.remove();
            }
            return;
          }

          if (selectedText && selectedText.length > 0) {
            // Show create note button
            this.showCreateNoteButton(e, selection);
          } else {
            // Hide create note button if exists
            this.hideCreateNoteButton();
          }
        } catch (error) {
          console.error('Notes Layer Pro: Error in selection handler:', error);
        }
      });
      
      // Hide button on scroll or click elsewhere
      document.addEventListener('scroll', () => this.hideCreateNoteButton(), true);
      document.addEventListener('click', (e) => {
        if (!this.closestFromEvent(e, '.notes-layer-create-btn')) {
          this.hideCreateNoteButton();
        }
      });
    } catch (error) {
      console.error('Notes Layer Pro: Error setting up selection handler:', error);
    }
  }

  /**
   * Get word range at point (creates range only for the word, not the whole line)
   */
  getWordRangeAtPoint(x, y) {
    let range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (!range) {
      // Fallback for browsers that don't support caretRangeFromPoint
      const element = document.elementFromPoint(x, y);
      if (!element) return null;
      
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let node;
      while (node = walker.nextNode()) {
        const rect = node.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const text = node.textContent;
          const offset = Math.floor((x - rect.left) / rect.width * text.length);
          range = document.createRange();
          range.setStart(node, Math.max(0, offset));
          range.setEnd(node, Math.min(text.length, offset + 1));
          break;
        }
      }
    }
    
    if (!range) return null;
    
    // Expand range to include the whole word
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return null;
    
    const text = textNode.textContent;
    let start = range.startOffset;
    let end = range.endOffset;
    
    // Find word boundaries
    const wordRegex = /[\w\u0400-\u04FF]+/g; // Supports Cyrillic and Latin letters
    let match;
    let wordFound = false;
    while ((match = wordRegex.exec(text)) !== null) {
      if (match.index <= start && match.index + match[0].length >= end) {
        start = match.index;
        end = match.index + match[0].length;
        wordFound = true;
        break;
      }
    }
    
    // If no word found at the position, return null
    if (!wordFound) {
      return null;
    }
    
    // Create new range for just the word
    const wordRange = document.createRange();
    wordRange.setStart(textNode, start);
    wordRange.setEnd(textNode, end);
    
    return wordRange;
  }

  /**
   * Setup double-click handler
   */
  setupDoubleClickHandler() {
    // Double-click on text to create note
    // Use bubble phase to allow browser to create selection first
    document.addEventListener('dblclick', async (e) => {
      console.log('Notes Layer Pro: Double-click detected in setupDoubleClickHandler', e.target);
      
      try {
        // Don't interfere with existing UI interactions
        if (this.closestFromEvent(e, '.notes-layer-card-container') ||
            this.closestFromEvent(e, '.notes-layer-marker') ||
            this.closestFromEvent(e, '.notes-layer-create-btn')) {
          console.log('Notes Layer Pro: Double-click blocked - UI interaction');
          return;
        }

        // Check if clicking on existing highlight - open for editing
        // This is a fallback in case setupMarkerHandlers didn't catch it
        const existingHighlight = this.getHighlightFromEvent(e);
        if (existingHighlight) {
          console.log('Notes Layer Pro: Double-click on existing highlight - opening for editing (fallback)');
          const noteId = existingHighlight.dataset.noteId;
          if (noteId) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // Prevent other handlers
            await this.showNoteCard(noteId);
          }
          return; // Don't create new note if editing existing one
        }

        // Check if we're waiting for re-anchoring
        if (this.waitingForReanchor) {
          console.log('Notes Layer Pro: Waiting for re-anchoring - skipping');
          return;
        }

        // Prevent duplicate note creation
        if (this.isCreatingNote) {
          console.log('Notes Layer Pro: Note creation already in progress - skipping');
          return;
        }

        console.log('Notes Layer Pro: Processing double-click for note creation');

        // Wait for browser's default selection to be created
        // Use requestAnimationFrame to wait for next frame when selection should be ready
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get current selection (browser's default double-click selection)
        let selection = window.getSelection();
        let range = null;
        let selectedText = '';

        if (selection && selection.rangeCount > 0) {
          range = selection.getRangeAt(0).cloneRange(); // Clone to preserve it
          selectedText = selection.toString().trim();
          console.log('Notes Layer Pro: Browser selection found:', selectedText);
        }

        // If no selection from browser, try to get word at click point
        if (!selectedText || selectedText.length === 0 || !range) {
          console.log('Notes Layer Pro: No browser selection, trying getWordRangeAtPoint');
          const wordRange = this.getWordRangeAtPoint(e.clientX, e.clientY);
          if (!wordRange) {
            console.log('Notes Layer Pro: Could not get word range at point');
            return;
          }
          
          // Create selection if needed
          if (!selection) {
            selection = window.getSelection();
          }
          if (!selection) {
            console.log('Notes Layer Pro: No selection object available');
            return;
          }
          
          // Clear any existing selection first
          selection.removeAllRanges();
          
          // Add the word range to selection (this will visually highlight it)
          selection.addRange(wordRange);
          range = wordRange.cloneRange(); // Clone to preserve
          selectedText = selection.toString().trim();
          console.log('Notes Layer Pro: Word range created:', selectedText);
        }

        // Check if we have valid selection
        if (!selectedText || selectedText.length === 0 || !range || !selection) {
          console.log('Notes Layer Pro: No selected text after all attempts');
          return;
        }

        console.log('Notes Layer Pro: Creating note from double-click selection:', selectedText);

        // Now prevent default and stop propagation
        e.preventDefault();
        e.stopPropagation();

        // Ensure we have the range in selection before creating note
        if (selection.rangeCount === 0 || selection.toString().trim() !== selectedText) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        
        // Let createNoteFromSelection manage the isCreatingNote flag itself
        await this.createNoteFromSelection(selection);
        this.hideCreateNoteButton();
      } catch (error) {
        console.error('Notes Layer Pro: Error in double-click handler:', error);
        // createNoteFromSelection manages isCreatingNote flag in its finally block
      }
    }, false); // Use bubble phase to allow browser to create selection first
  }

  /**
   * Show create note button
   */
  showCreateNoteButton(event, selection) {
    // Remove existing button
    this.hideCreateNoteButton();

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const button = document.createElement('button');
    button.className = 'notes-layer-create-btn';
    button.textContent = '📝 Create Note';
    button.style.position = 'fixed';
    button.style.left = `${rect.right + 10}px`;
    button.style.top = `${rect.top}px`;
    button.style.zIndex = '100000';
    button.style.padding = '6px 12px';
    button.style.background = '#4a90e2';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontSize = '12px';
    button.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';

    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.createNoteFromSelection(selection);
      this.hideCreateNoteButton();
    });

    document.body.appendChild(button);
    this.createNoteButton = button;
  }

  /**
   * Hide create note button
   */
  hideCreateNoteButton() {
    if (this.createNoteButton) {
      this.createNoteButton.remove();
      this.createNoteButton = null;
    }
  }

  /**
   * Create note from text selection
   */
  async createNoteFromSelection(selection) {
    // Prevent duplicate creation
    if (this.isCreatingNote) {
      console.log('Notes Layer Pro: Note creation already in progress, skipping');
      return;
    }

    this.isCreatingNote = true;
    console.log('Notes Layer Pro: Creating note from selection');
    
    try {
      // Capture selection coordinates immediately before any async operations
      let selectionRect = null;
      try {
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          selectionRect = {
            right: rect.right,
            top: rect.top
          };
        }
      } catch (e) {
        console.warn('Could not capture selection rect', e);
      }

      if (!selection || selection.rangeCount === 0) {
        console.warn('Notes Layer Pro: Invalid selection');
        alert('Ошибка: не удалось получить выделенный текст. Попробуйте выделить текст еще раз.');
        this.isCreatingNote = false;
        return;
      }
      
      if (!this.currentPage) {
        console.log('Notes Layer Pro: Loading page info...');
        await this.loadPageInfo();
      }

      if (!this.currentPage) {
        console.error('Notes Layer Pro: Failed to initialize page');
        alert('Ошибка: не удалось инициализировать страницу. Пожалуйста, перезагрузите страницу и попробуйте снова.');
        this.isCreatingNote = false;
        return;
      }

      console.log('Notes Layer Pro: Starting note creation process');
      // Check if AnchorManager is available
      if (typeof AnchorManager === 'undefined') {
        throw new Error('AnchorManager is not defined. Please reload the page.');
      }
      
      // Create anchor
      const anchorData = AnchorManager.createAnchor(selection);
      if (!anchorData) {
        console.warn('Failed to create anchor from selection');
        this.isCreatingNote = false;
        return;
      }

      const anchor = {
        pageId: this.currentPage.id,
        text: anchorData.text,
        contextLeft: anchorData.contextLeft,
        contextRight: anchorData.contextRight,
        domPath: anchorData.domPath,
        coords: anchorData.coords
      };

      // Save anchor
      const anchorResponse = await safeSendMessage({
        action: 'saveAnchor',
        anchor
      });

      if (!anchorResponse.success || !anchorResponse.anchor) {
        throw new Error('Failed to save anchor');
      }

      // Create note
      const note = {
        pageId: this.currentPage.id,
        anchorId: anchorResponse.anchor.id,
        type: 'annotation',
        annotationContent: null,
        warningLevel: 'none'
      };

      const noteResponse = await safeSendMessage({
        action: 'saveNote',
        note
      });

      if (!noteResponse.success || !noteResponse.note) {
        console.error('Notes Layer Pro: Failed to save note', noteResponse);
        throw new Error('Failed to save note: ' + (noteResponse.error || 'Unknown error'));
      }

      console.log('Notes Layer Pro: Note saved successfully', noteResponse.note.id);

      // Highlight text (non-blocking - note is already saved)
      try {
        // Get range from selection before it might be lost
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        if (range && range.startContainer && range.endContainer) {
          console.log('Notes Layer Pro: Highlighting text...');
          this.highlighter.highlightText(range, noteResponse.note.id, 'none');
          console.log('Notes Layer Pro: Text highlighted');
          
          // Wait for DOM to update and verify highlight was created correctly
          await new Promise(resolve => requestAnimationFrame(resolve));
          
          // Verify highlight exists and has correct noteId
          const highlight = this.highlighter.getHighlight(noteResponse.note.id);
          if (highlight) {
            const highlightElement = highlight.element || (highlight.elements && highlight.elements[0]);
            if (highlightElement) {
              // Ensure dataset.noteId is set correctly
              if (!highlightElement.dataset.noteId || highlightElement.dataset.noteId !== noteResponse.note.id) {
                console.warn('Notes Layer Pro: Fixing missing noteId on highlight element');
                highlightElement.dataset.noteId = noteResponse.note.id;
              }
              // Also fix for multi-node highlights
              if (highlight.elements) {
                highlight.elements.forEach(el => {
                  if (!el.dataset.noteId || el.dataset.noteId !== noteResponse.note.id) {
                    el.dataset.noteId = noteResponse.note.id;
                  }
                });
              }
              console.log('Notes Layer Pro: Highlight verified and ready for hover');
            }
          }
          
          // Keep selection visible after highlighting
          // The highlight will replace the selection, but we want to show it was selected
          try {
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (e) {
            // Selection might be invalid after highlighting, ignore
          }
        } else {
          console.warn('Notes Layer Pro: Invalid range for highlighting, but note is saved');
        }
      } catch (highlightError) {
        console.error('Notes Layer Pro: Error highlighting text (note is still saved):', highlightError);
        // Note is already saved, highlighting is optional
      }

      // Show note card
      try {
        console.log('Notes Layer Pro: Showing note card...');
        
        let x, y;
        if (selectionRect) {
            x = window.scrollX + selectionRect.right + 20;
            y = window.scrollY + selectionRect.top;
        } else {
            // Fallback if we couldn't capture rect earlier
            try {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                x = window.scrollX + rect.right + 20;
                y = window.scrollY + rect.top;
            } catch (e) {
                x = window.innerWidth / 2 - 200;
                y = window.innerHeight / 2 - 200;
            }
        }

        await this.showNoteCard(noteResponse.note.id, noteResponse.note, {
          x: x,
          y: y
        });
        console.log('Notes Layer Pro: Note card shown');
      } catch (cardError) {
        console.error('Notes Layer Pro: Error showing note card:', cardError);
        // Try to show card at center of screen
        try {
          await this.showNoteCard(noteResponse.note.id, noteResponse.note, {
            x: window.innerWidth / 2 - 200,
            y: window.innerHeight / 2 - 200
          });
        } catch (fallbackError) {
          console.error('Notes Layer Pro: Fallback card show also failed:', fallbackError);
          alert('Заметка сохранена, но не удалось открыть карточку. ID заметки: ' + noteResponse.note.id);
        }
      }
    } catch (error) {
      console.error('Error creating note:', error);
      
      // Don't show alert if extension context was invalidated - safeSendMessage already handled it
      if (error.message === 'Extension context invalidated. Please reload the page.' || 
          error.message.includes('EXTENSION_CONTEXT_INVALIDATED')) {
        // safeSendMessage already showed confirm dialog, just return
        return;
      }
      
      let errorMessage = 'Ошибка при создании заметки: ';
      if (error.message.includes('Extension context invalidated')) {
        errorMessage += 'Контекст расширения был инвалидирован. Пожалуйста, перезагрузите страницу.';
      } else if (error.message.includes('NoteCard is not defined') || error.message.includes('NoteCard')) {
        errorMessage += 'Класс NoteCard не загружен. Это может произойти если:\n' +
          '• Скрипты расширения не загрузились полностью\n' +
          '• Расширение было перезагружено\n' +
          '• Есть конфликт с другими расширениями\n\n' +
          'Решение: Перезагрузите страницу (F5 или Ctrl+R)';
      } else if (error.message.includes('Failed to save')) {
        errorMessage += 'Не удалось сохранить данные. Попробуйте еще раз.';
      } else {
        errorMessage += error.message;
      }
      
      alert(errorMessage);
    } finally {
      this.isCreatingNote = false;
    }
  }

  /**
   * Setup click handlers for notes
   */
  setupMarkerHandlers() {
    // Double click to open editor
    document.addEventListener('dblclick', async (e) => {
      console.log('Notes Layer Pro: setupMarkerHandlers - dblclick detected');
      
      // Hide tooltip if visible
      this.hideNotePreview();

      // Check if clicked element is a highlight
      const highlight = this.getHighlightFromEvent(e);
      if (highlight) {
        console.log('Notes Layer Pro: setupMarkerHandlers - found highlight, opening note');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Prevent other handlers (like setupDoubleClickHandler) from running
        const noteId = highlight.dataset.noteId;
        if (noteId) {
          await this.showNoteCard(noteId);
        }
        return; // Important: return early to prevent creating new note
      }
      
      // Keep support for legacy markers just in case
      // Check if target is an element before using classList
      let targetElement = e.target;
      if (targetElement && targetElement.nodeType === Node.TEXT_NODE) {
        targetElement = targetElement.parentElement;
      }
      if (targetElement && targetElement.classList && targetElement.classList.contains('notes-layer-marker')) {
        console.log('Notes Layer Pro: setupMarkerHandlers - found marker, opening note');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const noteId = targetElement.dataset.noteId;
        if (noteId) {
          await this.showNoteCard(noteId);
        }
        return; // Important: return early to prevent creating new note
      }
      
      console.log('Notes Layer Pro: setupMarkerHandlers - no highlight/marker found, allowing event to continue');
      // Don't block event if no highlight found - let setupDoubleClickHandler handle it
    }, true); // Use capture phase to run before setupDoubleClickHandler

    // Setup hover handlers for preview tooltip
    this.setupHoverHandlers();
  }

  /**
   * Get element from event target, handling text nodes
   */
  getElementFromEvent(e) {
    if (!e || !e.target) return null;
    
    let element = e.target;
    
    // If target is a text node, get parent element
    if (element.nodeType === Node.TEXT_NODE) {
      element = element.parentElement;
      if (!element) return null;
    }
    
    // Check if element is a DOM element
    if (element.nodeType === Node.ELEMENT_NODE) {
      return element;
    }
    
    return null;
  }

  /**
   * Safely call closest on event target
   */
  closestFromEvent(e, selector) {
    const element = this.getElementFromEvent(e);
    if (element && typeof element.closest === 'function') {
      return element.closest(selector);
    }
    return null;
  }

  /**
   * Get highlight element from event target
   * Handles cases where e.target might be a text node
   */
  getHighlightFromEvent(e) {
    return this.closestFromEvent(e, '.notes-layer-highlight');
  }

  /**
   * Setup hover handlers for showing note preview
   */
  setupHoverHandlers() {
    // Use mouseover/mouseout with event delegation
    // mouseenter/mouseleave don't bubble, so we can't use them with delegation
    document.addEventListener('mouseover', async (e) => {
      const highlight = this.getHighlightFromEvent(e);
      if (!highlight) return;

      // Check if we're entering the highlight (not just moving within it)
      const relatedTarget = e.relatedTarget;
      if (relatedTarget && highlight.contains(relatedTarget)) {
        // Moving within the highlight, ignore
        return;
      }

      let noteId = highlight.dataset.noteId;
      if (!noteId) {
        // Try to get noteId from the highlight element stored in highlighter
        // This can happen if highlight was just created and DOM hasn't fully updated
        const highlightData = Array.from(this.highlighter.highlights.values()).find(h => {
          const el = h.element || (h.elements && h.elements[0]);
          return el === highlight || (h.elements && h.elements.includes(highlight));
        });
        if (highlightData) {
          // Find noteId from highlights map
          for (const [id, data] of this.highlighter.highlights.entries()) {
            if (data === highlightData) {
              noteId = id;
              // Fix the dataset for future
              highlight.dataset.noteId = noteId;
              break;
            }
          }
        }
        if (!noteId) {
          console.warn('Notes Layer Pro: Highlight found but no noteId', highlight);
          return;
        }
      }

      // Don't show tooltip if note card is already open
      if (this.openCards.has(noteId)) {
        return;
      }

      // Clear any existing timeout
      if (this.hoverTimeout) {
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = null;
      }

      // Hide existing tooltip if different note
      if (this.currentTooltip && this.currentNoteId !== noteId) {
        this.hideNotePreview();
      }

      this.currentNoteId = noteId;

      // Show tooltip after short delay
      this.hoverTimeout = setTimeout(async () => {
        await this.showNotePreview(noteId, highlight);
      }, 300); // 300ms delay before showing
    }, true);

    document.addEventListener('mouseout', (e) => {
      const highlight = this.getHighlightFromEvent(e);
      if (!highlight) return;

      // Check if we're leaving the highlight (not just moving within it)
      const relatedTarget = e.relatedTarget;
      if (relatedTarget && highlight.contains(relatedTarget)) {
        // Moving within the highlight, ignore
        return;
      }

      // Also check if moving to tooltip
      if (relatedTarget && relatedTarget.classList && relatedTarget.classList.contains('notes-layer-preview-tooltip')) {
        // Moving to tooltip, don't hide
        return;
      }

      // Clear timeout if mouse left before delay
      if (this.hoverTimeout) {
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = null;
      }

      // Hide tooltip after short delay (allows moving to tooltip)
      setTimeout(() => {
        // Check if mouse is still over highlight or tooltip
        const tooltip = document.querySelector('.notes-layer-preview-tooltip');
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
        const isOverTooltip = tooltip && (tooltip.contains(elementUnderMouse) || elementUnderMouse === tooltip);
        const isOverHighlight = highlight && (highlight.contains(elementUnderMouse) || elementUnderMouse === highlight);
        
        if (!isOverTooltip && !isOverHighlight) {
          this.hideNotePreview();
        }
      }, 100);
    }, true);
  }

  /**
   * Extract text from note content for preview (body only, no title)
   * Returns null if no body content exists
   */
  extractNotePreviewText(note) {
    if (note.type === 'question' && note.questionContent) {
      return note.questionContent.trim();
    }
    
    if (note.aiAnswer) {
      return note.aiAnswer.trim();
    }

    if (note.annotationContent) {
      try {
        const delta = typeof note.annotationContent === 'string'
          ? JSON.parse(note.annotationContent)
          : note.annotationContent;
        
        // Extract text from Quill Delta
        let text = '';
        if (delta && delta.ops) {
          text = delta.ops
            .map(op => (typeof op.insert === 'string' ? op.insert : ''))
            .join('')
            .trim();
        }
        
        return text || null;
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  /**
   * Show note preview tooltip
   */
  async showNotePreview(noteId, highlightElement) {
    // Hide existing tooltip
    this.hideNotePreview();

    try {
      // Get note data
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId
      });

      if (!response.success || !response.note) {
        return;
      }

      const note = response.note;
      const previewText = this.extractNotePreviewText(note);

      // Create tooltip element
      const tooltip = document.createElement('div');
      tooltip.className = 'notes-layer-preview-tooltip';
      
      // If no body content, show empty tooltip with just background
      if (!previewText || previewText.length === 0) {
        tooltip.classList.add('notes-layer-preview-empty');
        // Don't add any text content
      } else {
        tooltip.textContent = previewText;
      }

      // Position tooltip near highlight
      const rect = highlightElement.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      // Add to document first to measure actual size
      document.body.appendChild(tooltip);
      
      // Get actual tooltip dimensions after rendering
      const tooltipRect = tooltip.getBoundingClientRect();
      const tooltipWidth = tooltipRect.width;
      const tooltipHeight = tooltipRect.height;
      const tooltipPadding = 24; // 12px * 2
      const tooltipMinHeight = 20;

      // Position above or below highlight
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      
      let top, transformY, transformX;
      
      if (spaceBelow > tooltipHeight + 20 || spaceBelow > spaceAbove) {
        // Show below
        top = scrollY + rect.bottom + 8;
        transformY = '0';
      } else {
        // Show above
        top = scrollY + rect.top - 8;
        transformY = '-100%';
      }

      // Center horizontally relative to highlight, but keep within viewport
      let left = scrollX + rect.left + rect.width / 2;
      const viewportWidth = window.innerWidth;
      const tooltipHalfWidth = tooltipWidth / 2;
      
      // Adjust if tooltip would go off screen
      if (left - tooltipHalfWidth < scrollX + 10) {
        // Too far left, align to left edge
        left = scrollX + 10 + tooltipHalfWidth;
        transformX = '0';
      } else if (left + tooltipHalfWidth > scrollX + viewportWidth - 10) {
        // Too far right, align to right edge
        left = scrollX + viewportWidth - 10 - tooltipHalfWidth;
        transformX = '0';
      } else {
        // Center
        transformX = '-50%';
      }

      // Apply positioning
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.transform = `translate(${transformX}, ${transformY})`;

      // Tooltip already added to document for measurement
      this.currentTooltip = tooltip;

      // Keep tooltip visible when hovering over it
      tooltip.addEventListener('mouseenter', () => {
        if (this.hoverTimeout) {
          clearTimeout(this.hoverTimeout);
        }
      });

      tooltip.addEventListener('mouseleave', () => {
        this.hideNotePreview();
      });
    } catch (error) {
      console.error('Error showing note preview:', error);
    }
  }

  /**
   * Hide note preview tooltip
   */
  hideNotePreview() {
    const tooltip = document.querySelector('.notes-layer-preview-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
    this.currentTooltip = null;
    this.currentNoteId = null;
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }

  /**
   * Show note card
   */
  async showNoteCard(noteId, noteData = null, position = null) {
    // Close other cards
    this.closeAllCards();

    // Get note data if not provided
    if (!noteData) {
      try {
        const response = await safeSendMessage({
          action: 'getNoteById',
          noteId
        });

        if (response.success && response.note) {
          noteData = response.note;
        } else {
          console.error('Note not found:', noteId);
          return;
        }
      } catch (error) {
        console.error('Error loading note:', error);
        return;
      }
    }

    // Wait for NoteCard class to be available (with retries)
    let retries = 0;
    const maxRetries = 50; // 5 seconds total (50 * 100ms)
    while (typeof NoteCard === 'undefined' && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }
    
    // Create card - check if NoteCard is defined
    if (typeof NoteCard === 'undefined') {
      console.error('NoteCard class is not defined after waiting. Scripts may not have loaded correctly.');
      alert('Ошибка: класс NoteCard не загружен.\n\n' +
        'Возможные причины:\n' +
        '• Скрипты расширения не загрузились полностью\n' +
        '• Расширение было перезагружено\n' +
        '• Конфликт с другими расширениями\n\n' +
        'Решение: Перезагрузите страницу (F5 или Ctrl+R)');
      return;
    }
    
    let card;
    try {
      card = new NoteCard(noteId, noteData);
    } catch (error) {
      console.error('Error creating NoteCard:', error);
      alert('Ошибка при создании карточки заметки: ' + error.message + '\n\nПожалуйста, перезагрузите страницу.');
      return;
    }

    // Determine position
    if (!position) {
      const highlight = this.highlighter.getHighlight(noteId);
      
      if (highlight) {
        let rect;
        
        // Use highlight element position
        if (highlight.elements && highlight.elements.length > 0) {
             rect = highlight.elements[0].getBoundingClientRect();
        } else if (highlight.element) {
             rect = highlight.element.getBoundingClientRect();
        } else if (highlight.range) {
             rect = highlight.range.getBoundingClientRect();
        }
        
        if (rect) {
          position = {
            x: rect.right + 10,
            y: rect.top
          };
        }
      } 
      
      // Fallback
      if (!position) {
        position = {
          x: window.innerWidth / 2 - 200,
          y: window.innerHeight / 2 - 200
        };
      }
    }

    await card.create(position);
    this.openCards.set(noteId, card);
  }

  /**
   * Close all note cards
   */
  closeAllCards() {
    for (const card of this.openCards.values()) {
      card.close();
    }
    this.openCards.clear();
  }

  /**
   * Re-anchor note to new selection
   */
  async reanchorNoteToSelection(noteId, selection) {
    try {
      // Get note data
      const noteResponse = await safeSendMessage({
        action: 'getNoteById',
        noteId
      });

      if (!noteResponse.success || !noteResponse.note) {
        throw new Error('Note not found');
      }

      const note = noteResponse.note;

      // Create new anchor
      const anchorData = AnchorManager.createAnchor(selection);
      if (!anchorData) {
        throw new Error('Failed to create anchor');
      }

      // Remove old highlight
      this.highlighter.removeHighlight(noteId);

      // Get existing anchor
        const anchorResponse = await safeSendMessage({
          action: 'getAnchorById',
          anchorId: note.anchorId
        });

        if (anchorResponse.success && anchorResponse.anchor) {
          // Update existing anchor
          const anchor = anchorResponse.anchor;
          anchor.text = anchorData.text;
          anchor.contextLeft = anchorData.contextLeft;
          anchor.contextRight = anchorData.contextRight;
          anchor.domPath = anchorData.domPath;
          anchor.coords = anchorData.coords;

          await safeSendMessage({
            action: 'saveAnchor',
            anchor
          });
        } else {
          // Create new anchor if old one not found
          const newAnchor = {
            pageId: note.pageId,
            text: anchorData.text,
            contextLeft: anchorData.contextLeft,
            contextRight: anchorData.contextRight,
            domPath: anchorData.domPath,
            coords: anchorData.coords
          };

          const newAnchorResponse = await safeSendMessage({
            action: 'saveAnchor',
            anchor: newAnchor
          });

        if (newAnchorResponse.success) {
          note.anchorId = newAnchorResponse.anchor.id;
        }
      }

      // Highlight with new anchor
      const range = selection.getRangeAt(0);
      this.highlighter.highlightText(range, noteId, 'none');

      // Update note warning level
      note.warningLevel = 'none';
      await safeSendMessage({
        action: 'saveNote',
        note
      });
    } catch (error) {
      console.error('Error re-anchoring note:', error);
      alert('Error re-anchoring note: ' + error.message);
    }
  }

  /**
   * Setup custom event listeners
   */
  setupEventListeners() {
    // Handle note deletion
    document.addEventListener('notes-layer-delete-note', async (e) => {
      const { noteId } = e.detail;
      this.highlighter.removeHighlight(noteId);
      this.openCards.delete(noteId);
    });

    // Handle card close
    document.addEventListener('notes-layer-card-closed', (e) => {
      const { noteId } = e.detail;
      this.openCards.delete(noteId);
      console.log('Notes Layer Pro: Card closed, removed from openCards', noteId);
    });

    // Handle re-anchoring
    document.addEventListener('notes-layer-reanchor', async (e) => {
      const { noteId } = e.detail;
      // Wait for user to select new text
      this.waitingForReanchor = noteId;
      
      // Show instruction
      const instruction = document.createElement('div');
      instruction.className = 'notes-layer-reanchor-instruction';
      instruction.textContent = 'Select new text to anchor this note';
      instruction.style.position = 'fixed';
      instruction.style.top = '20px';
      instruction.style.left = '50%';
      instruction.style.transform = 'translateX(-50%)';
      instruction.style.background = '#4a90e2';
      instruction.style.color = 'white';
      instruction.style.padding = '12px 24px';
      instruction.style.borderRadius = '4px';
      instruction.style.zIndex = '100001';
      instruction.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      document.body.appendChild(instruction);

      // Cancel handler
      const cancelHandler = () => {
        if (instruction.parentNode) {
          instruction.remove();
        }
        this.waitingForReanchor = null;
        document.removeEventListener('click', cancelHandler);
        document.removeEventListener('keydown', escapeHandler);
      };

      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          cancelHandler();
        }
      };

      document.addEventListener('click', cancelHandler, { once: true });
      document.addEventListener('keydown', escapeHandler);
    });

    // Listen for messages from background script (e.g. context menu)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'createNoteFromContextMenu') {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
          this.createNoteFromSelection(selection);
        } else {
          alert('Пожалуйста, выделите текст для создания заметки.');
        }
      }
    });
  }

  /**
   * Setup handlers for updating marker positions on scroll/resize
   */
  setupMarkerPositionHandlers() {
    let scrollTimeout;
    let resizeTimeout;

    // Throttled scroll handler
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (this.highlighter && typeof this.highlighter.updateMarkerPositions === 'function') {
          this.highlighter.updateMarkerPositions();
        }
      }, 50);
    };

    // Throttled resize handler
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (this.highlighter && typeof this.highlighter.updateMarkerPositions === 'function') {
          this.highlighter.updateMarkerPositions();
        }
      }, 100);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
  }

  /**
   * Setup handlers to hide tooltip on scroll/click outside
   */
  setupTooltipHideHandlers() {
    // Hide tooltip on scroll
    window.addEventListener('scroll', () => {
      this.hideNotePreview();
    }, { passive: true });

    // Hide tooltip on click outside
    document.addEventListener('click', (e) => {
      const tooltip = document.querySelector('.notes-layer-preview-tooltip');
      if (tooltip && !tooltip.contains(e.target)) {
        this.hideNotePreview();
      }
    }, true);
  }
}

// Initialize when DOM is ready
// Wait for all scripts to load, especially NoteCard
let notesLayerInstance = null;

function initializeNotesLayer() {
  console.log('Notes Layer Pro: Initializing...', {
    NoteCard: typeof NoteCard,
    Highlighter: typeof Highlighter,
    AnchorManager: typeof AnchorManager,
    documentReady: document.readyState
  });
  
  // Check if all required classes are available
  if (typeof NoteCard === 'undefined' || typeof Highlighter === 'undefined' || typeof AnchorManager === 'undefined') {
    console.warn('Notes Layer Pro: Required classes not yet defined, waiting...', {
      NoteCard: typeof NoteCard,
      Highlighter: typeof Highlighter,
      AnchorManager: typeof AnchorManager
    });
    // Retry after a short delay (max 5 seconds)
    const maxRetries = 50;
    let retries = 0;
    const checkInterval = setInterval(() => {
      retries++;
      if (typeof NoteCard !== 'undefined' && typeof Highlighter !== 'undefined' && typeof AnchorManager !== 'undefined') {
        clearInterval(checkInterval);
        console.log('Notes Layer Pro: All classes loaded, creating instance');
        createNotesLayer();
      } else if (retries >= maxRetries) {
        clearInterval(checkInterval);
        const missing = [];
        if (typeof NoteCard === 'undefined') missing.push('NoteCard');
        if (typeof Highlighter === 'undefined') missing.push('Highlighter');
        if (typeof AnchorManager === 'undefined') missing.push('AnchorManager');
        console.error('Notes Layer Pro: Required classes failed to load after 5 seconds:', missing);
        alert('Ошибка загрузки расширения: не загружены классы: ' + missing.join(', ') + '\n\nПожалуйста, перезагрузите страницу (F5).');
      }
    }, 100);
    return;
  }
  
  createNotesLayer();
}

function createNotesLayer() {
  try {
    console.log('Notes Layer Pro: Creating NotesLayerContent instance');
    notesLayerInstance = new NotesLayerContent();
    console.log('Notes Layer Pro: Instance created successfully');
    
    // Function to initialize with proper timing
    const doInit = () => {
      if (notesLayerInstance) {
        // Small delay to ensure everything is ready
        setTimeout(() => {
          if (notesLayerInstance) {
            console.log('Notes Layer Pro: Initializing instance...');
            notesLayerInstance.init();
          }
        }, 100);
      }
    };
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInit, { once: true });
    } else {
      // DOM is already ready, but wait a bit for dynamic content
      console.log('Notes Layer Pro: DOM already ready, initializing with delay...');
      doInit();
    }
  } catch (error) {
    console.error('Notes Layer Pro: Error creating NotesLayerContent:', error);
    alert('Ошибка инициализации расширения: ' + error.message + '\n\nПожалуйста, перезагрузите страницу.');
  }
}

// Start initialization
console.log('Notes Layer Pro: Starting initialization...');
initializeNotesLayer();

// Re-initialize on navigation (for SPAs)
let lastUrl = location.href;

new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (notesLayerInstance) {
      notesLayerInstance.isInitialized = false;
      notesLayerInstance.closeAllCards();
      notesLayerInstance.highlighter.clearAll();
    }
    
    // Re-initialize with check for required classes
    function reinitNotesLayer() {
      if (typeof NoteCard === 'undefined' || typeof Highlighter === 'undefined' || typeof AnchorManager === 'undefined') {
        setTimeout(reinitNotesLayer, 100);
        return;
      }
      if (notesLayerInstance) {
        setTimeout(() => notesLayerInstance.init(), 500);
      } else {
        // Recreate instance if it was lost
        createNotesLayer();
      }
    }
    reinitNotesLayer();
  }
}).observe(document, { subtree: true, childList: true });

// Handle page reload and restore from cache
window.addEventListener('pageshow', (event) => {
  // event.persisted is true when page is restored from cache (back/forward navigation)
  // or when page is reloaded
  const isCopilot = typeof AnchorManager !== 'undefined' && AnchorManager.isCopilotPage();
  console.log('Notes Layer Pro: pageshow event', { persisted: event.persisted, readyState: document.readyState, isCopilot });
  
  // Reset initialization state to force re-initialization
  if (notesLayerInstance) {
    notesLayerInstance.isInitialized = false;
    notesLayerInstance.closeAllCards();
    notesLayerInstance.highlighter.clearAll();
  }
  
  // Function to re-initialize with retries
  const reinitWithRetry = async (attempt = 0) => {
    const maxAttempts = isCopilot ? 15 : 10; // More attempts for Copilot
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }
    
    // Additional wait for dynamic content (longer for Copilot)
    const waitTime = isCopilot ? 800 + attempt * 200 : 300 + attempt * 100;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    if (notesLayerInstance) {
      try {
        console.log(`Notes Layer Pro: Re-initializing after pageshow (attempt ${attempt + 1})`);
        await notesLayerInstance.init();
        
        // Verify that notes were restored
        if (notesLayerInstance.currentPage) {
          const notesResponse = await safeSendMessage({
            action: 'getNotesByPageId',
            pageId: notesLayerInstance.currentPage.id
          });
          
          if (notesResponse.success && notesResponse.notes && notesResponse.notes.length > 0) {
            const restoredCount = notesLayerInstance.highlighter.highlights.size;
            console.log(`Notes Layer Pro: Restoration check - ${restoredCount} highlights restored from ${notesResponse.notes.length} notes`);
            
            // If we have notes but no highlights, try restoring again
            // For Copilot, be more aggressive
            const retryDelay = isCopilot ? 1000 : 500;
            if (restoredCount === 0 && attempt < maxAttempts - 1) {
              console.log(`Notes Layer Pro: No highlights restored, retrying in ${retryDelay}ms...`);
              setTimeout(() => reinitWithRetry(attempt + 1), retryDelay);
              return;
            }
            
            // For Copilot, also retry if not all notes restored
            if (isCopilot && restoredCount > 0 && restoredCount < notesResponse.notes.length && attempt < maxAttempts - 1) {
              console.log(`Notes Layer Pro: Only ${restoredCount}/${notesResponse.notes.length} restored, retrying...`);
              setTimeout(() => reinitWithRetry(attempt + 1), retryDelay);
              return;
            }
          }
        }
        } catch (error) {
          console.error('Notes Layer Pro: Error during re-initialization:', error);
          const retryDelay = isCopilot ? 1000 : 500;
          if (attempt < maxAttempts - 1) {
            setTimeout(() => reinitWithRetry(attempt + 1), retryDelay);
          }
        }
      } else {
        // Recreate instance if it was lost
        const retryDelay = isCopilot ? 1000 : 500;
        if (attempt < maxAttempts - 1) {
          createNotesLayer();
          setTimeout(() => reinitWithRetry(attempt + 1), retryDelay);
        } else {
          initializeNotesLayer();
        }
      }
  };
  
  // Start re-initialization
  reinitWithRetry();
});

// Also handle load event as backup
window.addEventListener('load', () => {
  const isCopilot = typeof AnchorManager !== 'undefined' && AnchorManager.isCopilotPage();
  console.log('Notes Layer Pro: load event fired', { readyState: document.readyState, isCopilot });
  
  // If instance exists but not initialized, try to initialize
  // For Copilot, wait longer
  const waitTime = isCopilot ? 1000 : 500;
  if (notesLayerInstance && !notesLayerInstance.isInitialized) {
    setTimeout(() => {
      if (notesLayerInstance && !notesLayerInstance.isInitialized) {
        console.log('Notes Layer Pro: Initializing after load event');
        notesLayerInstance.init();
      }
    }, waitTime);
  }
});

// Also handle beforeunload to ensure we can restore properly
window.addEventListener('beforeunload', () => {
  console.log('Notes Layer Pro: Page unloading');
});
