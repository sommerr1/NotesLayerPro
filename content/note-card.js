// Note card component

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

class NoteCard {
  constructor(noteId, noteData = null) {
    this.noteId = noteId;
    this.noteData = noteData;
    this.quill = null;
    this.container = null;
    this.mode = noteData?.type || 'annotation'; // 'annotation' or 'question'
    this.warningLevel = noteData?.warningLevel || 'none';
    this.isPinned = noteData?.isPinned || false;
    
    // Drag & drop state
    this.isDragging = false;
    this._justFinishedDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.initialX = 0;
    this.initialY = 0;
    this.cardWidth = 0;
    this.cardHeight = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.dragAnimationFrame = null;

    // Resize state
    this.isResizing = false;
    this.resizeStartX = 0;
    this.resizeStartY = 0;
    this.resizeStartWidth = 0;
    this.resizeStartHeight = 0;
    this.lastResizeMouseX = 0;
    this.lastResizeMouseY = 0;
    this.resizeAnimationFrame = null;
    
    // Connection line
    this.connectionLine = null;
    this.lineUpdateAnimationFrame = null;
  }

  /**
   * Create and show note card
   */
  async create(position = { x: 0, y: 0 }) {
    // Load template
    const templateUrl = chrome.runtime.getURL('ui/note-card.html');
    const response = await fetch(templateUrl);
    const html = await response.text();

    // Create container
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    this.container = tempDiv.firstElementChild;
    this.container.dataset.noteId = this.noteId;

    // Add warning class if needed
    if (this.warningLevel === 'yellow') {
      this.container.classList.add('notes-layer-warning-yellow');
    } else if (this.warningLevel === 'red') {
      this.container.classList.add('notes-layer-warning-red');
    }

    // Position card (document coordinates)
    const scroll = this._getScrollXY ? this._getScrollXY() : { x: window.scrollX || 0, y: window.scrollY || 0 };
    const highlightDoc = this._getHighlightDocRect ? this._getHighlightDocRect() : null;

    let docLeft = Number(position?.x) || 0;
    let docTop = Number(position?.y) || 0;

    if (this.noteData) {
      const offsetX = Number(this.noteData.offsetX);
      const offsetY = Number(this.noteData.offsetY);

      if (Number.isFinite(offsetX) && Number.isFinite(offsetY) && highlightDoc) {
        docLeft = highlightDoc.left + offsetX;
        docTop = highlightDoc.top + offsetY;
      } else if (this.noteData.positionX !== undefined && this.noteData.positionY !== undefined) {
        // Legacy: saved as viewport coords when card was `position: fixed`
        const legacyViewportX = Number(this.noteData.positionX);
        const legacyViewportY = Number(this.noteData.positionY);
        if (Number.isFinite(legacyViewportX) && Number.isFinite(legacyViewportY)) {
          docLeft = legacyViewportX + scroll.x;
          docTop = legacyViewportY + scroll.y;
        }
      }
    }

    this.container.style.left = `${docLeft}px`;
    this.container.style.top = `${docTop}px`;

    // Apply saved size (if any)
    if (this.noteData) {
      const savedW = Number(this.noteData.cardWidth);
      const savedH = Number(this.noteData.cardHeight);
      if (Number.isFinite(savedW) && savedW > 0) {
        this.container.style.width = `${savedW}px`;
      }
      if (Number.isFinite(savedH) && savedH > 0) {
        this.container.style.height = `${savedH}px`;
      }
    }

    // Append to body
    document.body.appendChild(this.container);

    // Hide any existing tooltips from other cards
    this.hideAllTooltips();

    // Keep card positioned relative to highlight (and migrate legacy positions if needed)
    this.setupScrollTracking();
    this.updatePosition();

    // Initialize Quill editor
    await this.initQuill();

    // Load note data
    if (this.noteData) {
      await this.loadNoteData(this.noteData);
    }

    // Setup event listeners
    this.setupEventListeners();
    
    // Setup drag and drop
    this.setupDragAndDrop();

    // Setup resize (bottom-right handle)
    this.setupResize();
    
    // Show connection line after card is created (if not dragging)
    // Use setTimeout to ensure card is fully rendered
    setTimeout(() => {
      if (!this.isDragging) {
        this.showConnectionLine();
      }
    }, 100);

    // Set initial mode
    this.setMode(this.mode);
    
    // Update pin button visual state
    this.updatePinButtonState();
    
    // Hide tooltips from other cards after a short delay (in case they appear after initialization)
    setTimeout(() => {
      this.hideOtherCardsTooltips();
    }, 200);
    setTimeout(() => {
      this.hideOtherCardsTooltips();
    }, 500);
  }

  /**
   * Initialize Quill editor
   */
  async initQuill() {
    // Load Quill CSS
    const quillCssUrl = chrome.runtime.getURL('lib/quill.snow.css');
    if (!document.querySelector(`link[href="${quillCssUrl}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = quillCssUrl;
      document.head.appendChild(link);
    }

    // Wait for Quill to be available (loaded in manifest)
    let retries = 0;
    const maxRetries = 50; // 5 seconds total
    while (typeof Quill === 'undefined' && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }

    if (typeof Quill === 'undefined') {
      console.error('Quill library not loaded after waiting');
      return;
    }

    const editorElement = this.container.querySelector('.notes-layer-quill-editor');
    if (!editorElement) {
      console.error('Quill editor element not found');
      return;
    }

    try {
      this.quill = new Quill(editorElement, {
        theme: 'snow',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            ['link']
          ]
        }
      });

      // Auto-save on text change (with debounce)
      let saveTimeout = null;
      this.quill.on('text-change', () => {
        if (saveTimeout) {
          clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
          this.saveAnnotation();
        }, 500); // Save 500ms after user stops typing
      });

      // Track selection changes to save last selection
      this.lastSelection = null;
      this.quill.on('selection-change', (range) => {
        if (range && range.length > 0) {
          try {
            const text = this.quill.getText(range.index, range.length).trim();
            if (text) {
              this.lastSelection = text;
            }
          } catch (error) {
            // Ignore errors
          }
        }
      });

      // Fix tooltip positioning when it appears
      this.setupTooltipPositionFix();

      // Header color squares in toolbar (pastel red, gray = current header, green)
      this.setupHeaderColorButtons();

      console.log('Quill editor initialized successfully');
    } catch (error) {
      console.error('Error initializing Quill:', error);
    }
  }

  /**
   * Load note data into card
   */
  async loadNoteData(noteData) {
    this.noteData = noteData;
    this.mode = noteData.type || 'annotation';
    this.warningLevel = noteData.warningLevel || 'none';

    // Load annotation content
    if (this.quill) {
        if (noteData.annotationContent) {
            try {
                const delta = typeof noteData.annotationContent === 'string'
                ? JSON.parse(noteData.annotationContent)
                : noteData.annotationContent;
                this.quill.setContents(delta);
            } catch (error) {
                console.error('Error loading annotation content:', error);
            }
        } else {
            // New note: auto-fill with anchor text
            this.insertAnchorText(noteData.anchorId);
        }
    }

    // Set header text based on note title or anchor
    // setHeaderText already adds the edit button at the end, so we don't need to add it again
    await this.setHeaderText(noteData.anchorId);

    // Apply saved header color if any
    const headerEl = this.container.querySelector('.notes-layer-card-header');
    if (headerEl && noteData.headerColor) {
      headerEl.style.backgroundColor = noteData.headerColor;
    } else if (headerEl) {
      headerEl.style.backgroundColor = '';
    }

    // Load question content
    const questionInput = this.container.querySelector('.notes-layer-question-input');
    if (questionInput && noteData.questionContent) {
      questionInput.value = noteData.questionContent;
    }

    // Load AI answer
    if (noteData.aiAnswer) {
      const answerContainer = this.container.querySelector('.notes-layer-answer-container');
      const answerText = this.container.querySelector('.notes-layer-answer-text');
      if (answerContainer && answerText) {
        answerText.textContent = noteData.aiAnswer;
        answerContainer.style.display = 'block';
      }
    }
  }

  /**
   * Set header text based on note title or anchor text
   */
  async setHeaderText(anchorId) {
    try {
        const titleElement = this.container.querySelector('.notes-layer-card-title');
        if (!titleElement) return;

        // Remove all children (including any existing edit buttons)
        while (titleElement.firstChild) {
          titleElement.removeChild(titleElement.firstChild);
        }

        // Helper function to create edit button
        const createEditButton = () => {
          const newEditBtn = document.createElement('button');
          newEditBtn.className = 'notes-layer-card-edit-title';
          newEditBtn.title = 'Rename note';
          newEditBtn.setAttribute('aria-label', 'Rename note');
          newEditBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
          newEditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startEditingTitle();
          });
          return newEditBtn;
        };

        // First, try to use note title if available
        if (this.noteData && this.noteData.title && this.noteData.title !== 'annotation') {
            const fullTitle = this.noteData.title;
            // Truncate title to 30 characters with ellipsis if longer
            let displayText = fullTitle;
            if (displayText.length > 30) {
              displayText = displayText.substring(0, 30) + '...';
            }
            titleElement.appendChild(document.createTextNode(displayText));
            titleElement.appendChild(createEditButton());
            titleElement.title = fullTitle; // Full title on hover
            return;
        }

        // Fallback to anchor text
        const response = await safeSendMessage({
            action: 'getAnchorById',
            anchorId: anchorId
        });

        if (response.success && response.anchor && response.anchor.text) {
            let text = response.anchor.text.trim();
            const fullText = text;
            if (text.length > 30) {
                text = text.substring(0, 30) + '...';
            }
            
            titleElement.appendChild(document.createTextNode(text));
            titleElement.appendChild(createEditButton());
            titleElement.title = fullText; // Show full text on hover
        }
        
        // Hide the default mode label
        const modeLabel = this.container.querySelector('.notes-layer-card-mode');
        if (modeLabel) {
            modeLabel.style.display = 'none';
        }
    } catch (error) {
        console.error('Error setting header text:', error);
    }
  }

  /**
   * Start editing title
   */
  startEditingTitle() {
    const titleElement = this.container.querySelector('.notes-layer-card-title');
    const editBtn = titleElement?.querySelector('.notes-layer-card-edit-title');
    
    if (!titleElement) return;

    // Get current title (full text, not truncated)
    let currentTitle = '';
    if (this.noteData && this.noteData.title && this.noteData.title !== 'annotation') {
      currentTitle = this.noteData.title;
    } else {
      // Get from title attribute or extract from text nodes
      currentTitle = titleElement.title || '';
      if (!currentTitle) {
        // Extract text from text nodes only (excluding button)
        let text = '';
        for (let node of titleElement.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
          }
        }
        currentTitle = text.replace('...', '').trim() || '';
      }
    }

    // Hide edit button while editing
    if (editBtn) {
      editBtn.style.display = 'none';
    }

    // Store edit button reference for later restoration
    const editBtnClone = editBtn ? editBtn.cloneNode(true) : null;

    // Make title editable - replace content with just text
    titleElement.contentEditable = 'true';
    titleElement.classList.add('editing');
    
    // Remove all children and set text
    while (titleElement.firstChild) {
      titleElement.removeChild(titleElement.firstChild);
    }
    
    // Store full title in data attribute
    titleElement.dataset.fullTitle = currentTitle;
    
    // Truncate title to 30 characters with ellipsis if longer for display
    let displayTitle = currentTitle;
    if (displayTitle.length > 30) {
      displayTitle = displayTitle.substring(0, 30) + '...';
    }
    titleElement.textContent = displayTitle;
    
    // On focus, show full text for editing
    const showFullTitle = () => {
      if (titleElement.textContent.includes('...') && titleElement.dataset.fullTitle) {
        titleElement.textContent = titleElement.dataset.fullTitle;
      }
    };
    
    titleElement.addEventListener('focus', showFullTitle, { once: true });
    titleElement.focus();
    
    // Select all text after a short delay to ensure full text is shown
    setTimeout(() => {
      const range = document.createRange();
      range.selectNodeContents(titleElement);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, 10);

    // Save on blur or Enter key
    const saveTitle = async () => {
      let newTitle = titleElement.textContent.trim();
      // If title was truncated and user didn't edit it, use full title
      if (newTitle.endsWith('...') && titleElement.dataset.fullTitle) {
        // Check if user actually edited (if text is different from truncated version)
        const truncated = titleElement.dataset.fullTitle.length > 30 
          ? titleElement.dataset.fullTitle.substring(0, 30) + '...'
          : titleElement.dataset.fullTitle;
        if (newTitle === truncated) {
          // User didn't edit, use full title
          newTitle = titleElement.dataset.fullTitle;
        } else {
          // User edited, remove ellipsis if present
          newTitle = newTitle.replace(/\.\.\.$/, '');
        }
      }
      titleElement.contentEditable = 'false';
      titleElement.classList.remove('editing');
      delete titleElement.dataset.fullTitle;

      // Update title if changed
      if (newTitle && newTitle !== currentTitle) {
        // saveTitle() will update the display and add the edit button
        await this.saveTitle(newTitle);
      } else if (!newTitle) {
        // Restore original title if empty
        const restoredTitle = currentTitle || 'Note';
        // Remove all children and restore
        while (titleElement.firstChild) {
          titleElement.removeChild(titleElement.firstChild);
        }
        // Truncate title to 30 characters with ellipsis if longer
        let displayTitle = restoredTitle;
        if (displayTitle.length > 30) {
          displayTitle = displayTitle.substring(0, 30) + '...';
        }
        titleElement.appendChild(document.createTextNode(displayTitle));
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
        titleElement.title = restoredTitle; // Full title on hover
      } else {
        // Title unchanged, just restore display
        while (titleElement.firstChild) {
          titleElement.removeChild(titleElement.firstChild);
        }
        // Truncate title to 30 characters with ellipsis if longer
        let displayTitle = newTitle;
        if (displayTitle.length > 30) {
          displayTitle = displayTitle.substring(0, 30) + '...';
        }
        titleElement.appendChild(document.createTextNode(displayTitle));
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
        titleElement.title = newTitle; // Full title on hover
      }
    };

    titleElement.addEventListener('blur', saveTitle, { once: true });
    titleElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleElement.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const restoredTitle = currentTitle || 'Note';
        // Remove all children
        while (titleElement.firstChild) {
          titleElement.removeChild(titleElement.firstChild);
        }
        // Truncate title to 30 characters with ellipsis if longer
        let displayTitle = restoredTitle;
        if (displayTitle.length > 30) {
          displayTitle = displayTitle.substring(0, 30) + '...';
        }
        titleElement.textContent = displayTitle;
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
        titleElement.title = restoredTitle; // Full title on hover
        titleElement.contentEditable = 'false';
        titleElement.classList.remove('editing');
      }
    }, { once: true });
  }

  /**
   * Save title to note
   */
  async saveTitle(newTitle) {
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.title = newTitle || 'annotation';
        note.updatedAt = Date.now();

        const saveResponse = await safeSendMessage({
          action: 'saveNote',
          note
        });

        if (saveResponse.success) {
          // Update local note data
          this.noteData = saveResponse.note;
          
          // Update title display
          const titleElement = this.container.querySelector('.notes-layer-card-title');
          const editBtn = titleElement?.querySelector('.notes-layer-card-edit-title');
          if (titleElement) {
            // Remove all children
            while (titleElement.firstChild) {
              titleElement.removeChild(titleElement.firstChild);
            }
            // Truncate title to 30 characters with ellipsis if longer
            let displayTitle = newTitle;
            if (displayTitle.length > 30) {
              displayTitle = displayTitle.substring(0, 30) + '...';
            }
            // Add text and edit button
            titleElement.appendChild(document.createTextNode(displayTitle));
            if (editBtn) {
              titleElement.appendChild(editBtn);
            } else {
              // Recreate edit button if it doesn't exist
              const newEditBtn = document.createElement('button');
              newEditBtn.className = 'notes-layer-card-edit-title';
              newEditBtn.title = 'Rename note';
              newEditBtn.setAttribute('aria-label', 'Rename note');
              newEditBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
              newEditBtn.addEventListener('click', () => this.startEditingTitle());
              titleElement.appendChild(newEditBtn);
            }
            titleElement.title = newTitle; // Full title on hover
          }

          console.log('Title saved successfully:', newTitle);
        } else {
          console.error('Failed to save title:', saveResponse.error);
        }
      }
    } catch (error) {
      console.error('Error saving title:', error);
    }
  }

  /**
   * Update pin button visual state
   */
  updatePinButtonState() {
    if (!this.container) return;
    
    const pinBtn = this.container.querySelector('.notes-layer-pin-btn');
    if (pinBtn) {
      if (this.isPinned) {
        pinBtn.classList.add('pinned');
        pinBtn.title = 'Unpin Note';
        pinBtn.setAttribute('aria-label', 'Unpin Note');
      } else {
        pinBtn.classList.remove('pinned');
        pinBtn.title = 'Pin Note';
        pinBtn.setAttribute('aria-label', 'Pin Note');
      }
    }
    
    // Update container class
    if (this.isPinned) {
      this.container.classList.add('pinned');
    } else {
      this.container.classList.remove('pinned');
    }
  }

  /**
   * Toggle pin state
   */
  async togglePin() {
    this.isPinned = !this.isPinned;
    this.updatePinButtonState();
    
    // Save pin state to database
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.isPinned = this.isPinned;
        note.updatedAt = Date.now();

        await safeSendMessage({
          action: 'saveNote',
          note
        });

        // Update local note data
        if (this.noteData) {
          this.noteData.isPinned = this.isPinned;
        }

        console.log('Pin state saved:', this.isPinned);
      }
    } catch (error) {
      console.error('Error saving pin state:', error);
    }
  }

  /**
   * Insert anchor text into editor
   */
  async insertAnchorText(anchorId) {
    if (!this.quill) return;

    try {
        const response = await safeSendMessage({
            action: 'getAnchorById',
            anchorId: anchorId
        });

        if (response.success && response.anchor && response.anchor.text) {
            const anchorText = response.anchor.text.trim();
            // Insert as plain text (no bold), no extra newlines
            this.quill.insertText(0, anchorText, 'user');
            // Select the inserted phrase for copying
            this.quill.setSelection(0, anchorText.length);
            this.quill.focus();
        }
    } catch (error) {
        console.error('Error fetching anchor text:', error);
    }
  }

  /**
   * Hide all Quill tooltips (from any card)
   */
  hideAllTooltips() {
    const tooltips = document.querySelectorAll('.ql-tooltip');
    tooltips.forEach(tooltip => {
      if (tooltip.parentNode) {
        tooltip.remove();
      }
    });
  }

  /**
   * Hide tooltips that don't belong to this card
   */
  hideOtherCardsTooltips() {
    if (!this.container || !this.quill) return;
    
    const tooltips = document.querySelectorAll('.ql-tooltip');
    const editorElement = this.container.querySelector('.notes-layer-quill-editor');
    
    tooltips.forEach(tooltip => {
      // Check if tooltip belongs to this card
      const isOurTooltip = tooltip.closest('.notes-layer-card-container') === this.container ||
                          (document.body.contains(tooltip) && 
                           (this.quill.hasFocus() || document.activeElement === editorElement));
      
      if (!isOurTooltip) {
        // Hide tooltip from other cards
        if (tooltip.parentNode) {
          tooltip.remove();
        }
      }
    });
  }

  /**
   * Setup tooltip position fix to ensure link editing tooltip is visible
   */
  setupTooltipPositionFix() {
    if (!this.container || !this.quill) return;

    // Check for tooltip and fix its position
    const checkAndFixTooltip = () => {
      // Quill may append tooltip to body or to the editor container
      const tooltips = document.querySelectorAll('.ql-tooltip');
      const editorElement = this.container.querySelector('.notes-layer-quill-editor');
      
      tooltips.forEach(tooltip => {
        if (tooltip && tooltip.offsetParent !== null) {
          // Check if this tooltip belongs to our editor
          if (editorElement) {
            // Check if tooltip is related to our editor
            // Quill typically adds tooltip to body, so we check if our editor is focused/active
            const isOurTooltip = tooltip.closest('.notes-layer-card-container') === this.container ||
                                 (document.body.contains(tooltip) && 
                                  (this.quill.hasFocus() || document.activeElement === editorElement));
            
            if (isOurTooltip) {
              // Fix position with multiple attempts to ensure it works
              this.fixTooltipPosition(tooltip);
              // Re-check after a short delay to handle any layout changes
              setTimeout(() => this.fixTooltipPosition(tooltip), 100);
              setTimeout(() => this.fixTooltipPosition(tooltip), 300);
            } else {
              // Hide tooltip from other cards
              if (tooltip.parentNode) {
                tooltip.remove();
              }
            }
          }
        }
      });
    };

    // Listen for selection changes (tooltip appears when link is clicked)
    this.quill.on('selection-change', () => {
      setTimeout(checkAndFixTooltip, 50);
    });

    // Use MutationObserver to detect when tooltip appears in DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('ql-tooltip')) {
              // Check if this tooltip belongs to our card
              const isOurTooltip = node.closest('.notes-layer-card-container') === this.container ||
                                  (document.body.contains(node) && 
                                   (this.quill.hasFocus() || document.activeElement === this.container.querySelector('.notes-layer-quill-editor')));
              
              if (isOurTooltip) {
                setTimeout(() => this.fixTooltipPosition(node), 50);
                setTimeout(() => this.fixTooltipPosition(node), 150);
              } else {
                // Hide tooltip from other cards immediately
                if (node.parentNode) {
                  node.remove();
                }
              }
            }
            // Also check for tooltip in added nodes
            const tooltip = node.querySelector && node.querySelector('.ql-tooltip');
            if (tooltip) {
              const isOurTooltip = tooltip.closest('.notes-layer-card-container') === this.container ||
                                  (document.body.contains(tooltip) && 
                                   (this.quill.hasFocus() || document.activeElement === this.container.querySelector('.notes-layer-quill-editor')));
              
              if (isOurTooltip) {
                setTimeout(() => this.fixTooltipPosition(tooltip), 50);
                setTimeout(() => this.fixTooltipPosition(tooltip), 150);
              } else {
                if (tooltip.parentNode) {
                  tooltip.remove();
                }
              }
            }
          }
        });
      });
    });

    // Observe both container and body (Quill may append tooltip to either)
    observer.observe(this.container, {
      childList: true,
      subtree: true
    });

    observer.observe(document.body, {
      childList: true,
      subtree: false // Only direct children of body
    });

    // Fix position on window resize and scroll
    const handleResize = () => {
      checkAndFixTooltip();
      // Also hide tooltips from other cards
      this.hideOtherCardsTooltips();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    
    // Periodically check and hide tooltips from other cards
    this._tooltipCleanupInterval = setInterval(() => {
      this.hideOtherCardsTooltips();
    }, 500); // Check every 500ms

    // Store cleanup function
    this._tooltipCleanup = () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      if (this._tooltipCleanupInterval) {
        clearInterval(this._tooltipCleanupInterval);
        this._tooltipCleanupInterval = null;
      }
    };

    // Initial check
    setTimeout(checkAndFixTooltip, 100);
    setTimeout(checkAndFixTooltip, 300);
  }

  /**
   * Add header color squares to Quill toolbar (pastel red, gray = current header, green)
   */
  setupHeaderColorButtons() {
    const toolbar = this.container.querySelector('.ql-toolbar');
    if (!toolbar) return;

    const colors = [
      { value: '#e8b4b8', title: 'questions' },
      { value: '#f5f5f5', title: 'info' },
      { value: '#b8d4b8', title: 'additional' },
      { value: '#f0e68c', title: 'accent' },
      { value: '#b0d4e8', title: 'additional 2' }
    ];

    const wrap = document.createElement('span');
    wrap.className = 'ql-formats notes-layer-header-color-formats';

    const separator = document.createElement('span');
    separator.className = 'notes-layer-header-color-sep';
    wrap.appendChild(separator);

    colors.forEach(({ value, title }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notes-layer-header-color-btn';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.style.backgroundColor = value;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const header = this.container.querySelector('.notes-layer-card-header');
        if (header) {
          header.style.backgroundColor = value;
          this.noteData.headerColor = value;
          this.saveHeaderColor();
        }
      });
      wrap.appendChild(btn);
    });

    toolbar.appendChild(wrap);
  }

  /**
   * Persist header color to note
   */
  async saveHeaderColor() {
    try {
      const getResponse = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });
      if (!getResponse?.success || !getResponse.note) return;
      const note = getResponse.note;
      note.headerColor = this.noteData?.headerColor ?? null;
      note.updatedAt = Date.now();
      await safeSendMessage({ action: 'saveNote', note });
    } catch (error) {
      console.error('Error saving header color:', error);
    }
  }

  /**
   * Fix tooltip position to ensure it's visible inside the note card, centered
   */
  fixTooltipPosition(tooltip) {
    if (!tooltip || !this.container) return;

    // Get editor container (where the text is)
    const editorContainer = this.container.querySelector('.notes-layer-editor-container');
    if (!editorContainer) return;

    const containerRect = this.container.getBoundingClientRect();
    
    // Check if container is visible
    if (containerRect.width === 0 || containerRect.height === 0) {
      return; // Container is not visible
    }
    
    // Force tooltip to be visible to measure it properly
    const originalDisplay = tooltip.style.display;
    const originalVisibility = tooltip.style.visibility;
    tooltip.style.display = 'block';
    tooltip.style.visibility = 'visible';
    
    // Get tooltip dimensions - measure after making it visible
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || tooltip.offsetWidth || 350;
    const tooltipHeight = tooltipRect.height || tooltip.offsetHeight || 60;
    
    const padding = 15; // Padding from edges of card

    // Calculate centered position within the card container
    // Center horizontally within the card
    let left = containerRect.left + (containerRect.width / 2) - (tooltipWidth / 2);
    
    // Position vertically in the upper-middle part of the card body
    // Get the body area (below header)
    const cardBody = this.container.querySelector('.notes-layer-card-body');
    const bodyRect = cardBody ? cardBody.getBoundingClientRect() : containerRect;
    
    // Position in upper part of body area
    let top = bodyRect.top + padding + 20; // Start a bit below body top

    // Ensure tooltip stays within container bounds (left edge)
    const minLeft = containerRect.left + padding;
    if (left < minLeft) {
      left = minLeft;
    }

    // Ensure tooltip stays within container bounds (right edge)
    const maxLeft = containerRect.right - tooltipWidth - padding;
    if (left > maxLeft) {
      left = Math.max(minLeft, maxLeft);
    }

    // Ensure tooltip stays within container bounds (top edge)
    const minTop = containerRect.top + padding;
    if (top < minTop) {
      top = minTop;
    }

    // Ensure tooltip stays within container bounds (bottom edge)
    const maxTop = containerRect.bottom - tooltipHeight - padding;
    if (top > maxTop) {
      top = Math.max(minTop, maxTop);
    }

    // Final viewport bounds check (safety check)
    const viewportPadding = 5;
    if (left < viewportPadding) {
      left = viewportPadding;
    }
    if (left + tooltipWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - tooltipWidth - viewportPadding;
    }
    if (top < viewportPadding) {
      top = viewportPadding;
    }
    if (top + tooltipHeight > window.innerHeight - viewportPadding) {
      top = window.innerHeight - tooltipHeight - viewportPadding;
    }

    // Apply position - use fixed positioning relative to viewport
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.zIndex = '100001';
    tooltip.style.transform = 'none';
    tooltip.style.margin = '0';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
    
    // Restore original display/visibility if needed
    if (originalDisplay) tooltip.style.display = originalDisplay;
    if (originalVisibility) tooltip.style.visibility = originalVisibility;
  }

  /**
   * Set mode (annotation or question)
   * @param {string} mode - 'annotation' or 'question'
   * @param {string} savedSelectedText - Optional: pre-saved selected text to insert into question field
   */
  setMode(mode, savedSelectedText = '') {
    // If switching to question mode, check for selected text BEFORE switching
    let selectedText = savedSelectedText;
    
    // If no saved text provided, try to get it now
    if (!selectedText && mode === 'question' && this.quill) {
      // First, try to get selection from DOM (more reliable for user selections)
      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0) {
        const range = domSelection.getRangeAt(0);
        const quillEditor = this.container.querySelector('.notes-layer-quill-editor');
        if (quillEditor && quillEditor.contains(range.commonAncestorContainer)) {
          // Selection is inside Quill editor
          selectedText = domSelection.toString().trim();
        }
      }
      
      // If no DOM selection, try Quill API
      if (!selectedText) {
        try {
          const quillSelection = this.quill.getSelection();
          if (quillSelection && quillSelection.length > 0) {
            selectedText = this.quill.getText(quillSelection.index, quillSelection.length).trim();
          }
        } catch (error) {
          console.warn('Error getting Quill selection:', error);
        }
      }
    }

    this.mode = mode;

    const annotationMode = this.container.querySelector('.notes-layer-annotation-mode');
    const questionMode = this.container.querySelector('.notes-layer-question-mode');
    const switchToAnnotationBtn = this.container.querySelector('.notes-layer-switch-to-annotation');
    const acceptAnswerBtn = this.container.querySelector('.notes-layer-accept-answer');
    const deleteQuestionBtn = this.container.querySelector('.notes-layer-delete-question');
    const backToAnnotationBtn = this.container.querySelector('.notes-layer-back-to-annotation-btn');
    const askQuestionBtn = this.container.querySelector('.notes-layer-ask-question-btn');
    const modeLabel = this.container.querySelector('.notes-layer-card-mode');

    if (mode === 'annotation') {
      if (annotationMode) annotationMode.style.display = 'block';
      if (questionMode) questionMode.style.display = 'none';
      if (switchToAnnotationBtn) switchToAnnotationBtn.style.display = 'none';
      if (acceptAnswerBtn) acceptAnswerBtn.style.display = 'none';
      if (deleteQuestionBtn) deleteQuestionBtn.style.display = 'none';
      if (backToAnnotationBtn) backToAnnotationBtn.style.display = 'none';
      if (askQuestionBtn) askQuestionBtn.style.display = 'inline-flex';
      // Mode label is hidden - no longer needed
    } else {
      if (annotationMode) annotationMode.style.display = 'none';
      if (questionMode) questionMode.style.display = 'block';
      if (switchToAnnotationBtn) switchToAnnotationBtn.style.display = 'inline-block';
      if (backToAnnotationBtn) backToAnnotationBtn.style.display = 'inline-flex';
      if (askQuestionBtn) askQuestionBtn.style.display = 'none';
      // Mode label is hidden - no longer needed

      // Focus question input field when switching to question mode
      const questionInput = this.container.querySelector('.notes-layer-question-input');
      if (questionInput) {
        // If we found selected text, insert it into question input field
        if (selectedText) {
          questionInput.value = selectedText;
        }
        
        // Always focus the input field after a short delay to ensure DOM is updated
        setTimeout(() => {
          questionInput.focus();
          // Select all text if there's text, otherwise just focus
          if (questionInput.value) {
            questionInput.select();
          }
        }, 50);
      }
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Toggle panels button
    const toggleButton = this.container.querySelector('.notes-layer-toggle-panels');
    if (toggleButton) {
      toggleButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.container.classList.toggle('notes-layer-panels-expanded');
      });
    }

    // Close button
    const closeBtn = this.container.querySelector('.notes-layer-card-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Back to annotation button (visible only in question mode)
    const backToAnnotationBtn = this.container.querySelector('.notes-layer-back-to-annotation-btn');
    if (backToAnnotationBtn) {
      backToAnnotationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMode('annotation');
      });
    }

    // Ask question button (new small button in header)
    const askQuestionBtn = this.container.querySelector('.notes-layer-ask-question-btn');
    if (askQuestionBtn) {
      let savedSelection = null;
      
      // Save selection on mousedown (before click loses it)
      askQuestionBtn.addEventListener('mousedown', (e) => {
        if (this.quill) {
          // Try to save selection from DOM first
          const domSelection = window.getSelection();
          if (domSelection && domSelection.rangeCount > 0) {
            const range = domSelection.getRangeAt(0);
            const quillEditor = this.container.querySelector('.notes-layer-quill-editor');
            if (quillEditor && quillEditor.contains(range.commonAncestorContainer)) {
              savedSelection = domSelection.toString().trim();
            }
          }
          
          // If no DOM selection, try Quill API
          if (!savedSelection) {
            try {
              const quillSelection = this.quill.getSelection();
              if (quillSelection && quillSelection.length > 0) {
                savedSelection = this.quill.getText(quillSelection.index, quillSelection.length).trim();
              }
            } catch (error) {
              console.warn('Error getting Quill selection:', error);
            }
          }
          
          // Fallback to last tracked selection
          if (!savedSelection && this.lastSelection) {
            savedSelection = this.lastSelection;
          }
        }
      });
      
      askQuestionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMode('question', savedSelection || '');
        savedSelection = null; // Clear after use
      });
    }

    // Delete note button (new small button in header)
    const deleteNoteBtn = this.container.querySelector('.notes-layer-delete-note-btn');
    if (deleteNoteBtn) {
      deleteNoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteNote();
      });
    }

    // Pin note button
    const pinBtn = this.container.querySelector('.notes-layer-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePin();
      });
    }

    // Switch to annotation mode
    const switchToAnnotationBtn = this.container.querySelector('.notes-layer-switch-to-annotation');
    if (switchToAnnotationBtn) {
      switchToAnnotationBtn.addEventListener('click', () => this.setMode('annotation'));
    }

    // Ask question on Enter key press in input field
    const questionInput = this.container.querySelector('.notes-layer-question-input');
    if (questionInput) {
      questionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.askQuestion();
        }
      });
    }

    // Send icon inside Ask AI input
    const questionSendBtn = this.container.querySelector('.notes-layer-question-send');
    if (questionSendBtn) {
      questionSendBtn.addEventListener('click', () => this.askQuestion());
    }

    // Accept answer as annotation
    const acceptAnswerBtn = this.container.querySelector('.notes-layer-accept-answer');
    if (acceptAnswerBtn) {
      acceptAnswerBtn.addEventListener('click', () => this.acceptAnswerAsAnnotation());
    }

    // Delete question
    const deleteQuestionBtn = this.container.querySelector('.notes-layer-delete-question');
    if (deleteQuestionBtn) {
      deleteQuestionBtn.addEventListener('click', () => this.deleteQuestion());
    }

    // Re-anchor note
    const reanchorBtn = this.container.querySelector('.notes-layer-reanchor');
    if (reanchorBtn) {
      reanchorBtn.addEventListener('click', () => this.reanchorNote());
    }

    // Edit title button (may be inside title element)
    const editTitleBtn = this.container.querySelector('.notes-layer-card-edit-title');
    if (editTitleBtn) {
      editTitleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startEditingTitle();
      });
    }

    // Body scroll: show scrollbar while scrolling, hide after idle (no text jump thanks to scrollbar-gutter)
    const cardBody = this.container.querySelector('.notes-layer-card-body');
    if (cardBody) {
      this._bodyScrollTimeout = null;
      cardBody.addEventListener('scroll', () => {
        cardBody.classList.add('notes-layer-body-scrolling');
        if (this._bodyScrollTimeout) clearTimeout(this._bodyScrollTimeout);
        this._bodyScrollTimeout = setTimeout(() => {
          cardBody.classList.remove('notes-layer-body-scrolling');
          this._bodyScrollTimeout = null;
        }, 800);
      });
    }

    // Close on outside click
    // Store reference to handler for cleanup
    this._outsideClickHandler = (e) => {
      // Don't close if pinned
      if (this.isPinned) {
        return;
      }
      
      // Don't close if we're dragging or just finished dragging
      if (this.isDragging || this._justFinishedDragging) {
        return;
      }
      
      if (this.container && !this.container.contains(e.target)) {
        // Don't close if clicking on marker or connection line
        if (!e.target.classList.contains('notes-layer-marker') &&
            !e.target.closest('.notes-layer-connection-line')) {
          // Small delay to allow marker clicks to work
          setTimeout(() => {
            if (this.container && !document.querySelector('.notes-layer-marker:hover')) {
              this.close();
            }
          }, 100);
        }
      }
    };
    document.addEventListener('click', this._outsideClickHandler, true);
  }

  /**
   * Setup drag and drop functionality
   */
  setupDragAndDrop() {
    const header = this.container.querySelector('.notes-layer-card-header');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
      // Don't start drag if clicking on buttons, interactive elements, or editable title
      const target = e.target;
      if (
        target.closest('button') || 
        target.closest('.notes-layer-card-edit-title') ||
        target.closest('.notes-layer-card-title.editing') ||
        (target.classList.contains('notes-layer-card-title') && target.contentEditable === 'true')
      ) {
        return;
      }

      // Start drag immediately
      this.startDrag(e);
    }, true); // Use capture phase to run before other handlers
  }

  /**
   * Setup resize interactions via bottom-right handle
   */
  setupResize() {
    const handle = this.container.querySelector('.notes-layer-resize-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      this.startResize(e);
    }, true);
  }

  /**
   * Start resizing the card
   */
  startResize(e) {
    if (this.isResizing) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Cancel any pending resize RAF
    if (this.resizeAnimationFrame) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }

    this.isResizing = true;

    const rect = this.container.getBoundingClientRect();
    this.resizeStartWidth = rect.width;
    this.resizeStartHeight = rect.height;
    this.resizeStartX = e.clientX;
    this.resizeStartY = e.clientY;
    this.lastResizeMouseX = e.clientX;
    this.lastResizeMouseY = e.clientY;

    // UX: keep cursor consistent while resizing
    this._prevBodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'nwse-resize';

    // Hide connection line during resizing for smoother feel
    this.hideConnectionLine();

    document.addEventListener('mousemove', this.onResizeBound = this.onResize.bind(this), { capture: true, passive: false });
    document.addEventListener('mouseup', this.endResizeBound = this.endResize.bind(this), { capture: true, passive: false });

    window.addEventListener('mousemove', this.onResizeBound, { capture: true, passive: false });
    window.addEventListener('mouseup', this.endResizeBound, { capture: true, passive: false });
    window.addEventListener('blur', this.endResizeBound, { capture: true, passive: false });
  }

  /**
   * Handle resize movement
   */
  onResize(e) {
    if (!this.isResizing) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    this.lastResizeMouseX = e.clientX;
    this.lastResizeMouseY = e.clientY;

    // Update immediately for responsiveness
    this._updateResizeSize();

    // Also schedule RAF update to catch missed frames
    if (!this.resizeAnimationFrame) {
      this.resizeAnimationFrame = requestAnimationFrame(() => {
        this.resizeAnimationFrame = null;
        if (this.isResizing) {
          this._updateResizeSize();
        }
      });
    }
  }

  /**
   * Apply computed size to card
   */
  _updateResizeSize() {
    if (!this.isResizing) return;

    const dx = this.lastResizeMouseX - this.resizeStartX;
    const dy = this.lastResizeMouseY - this.resizeStartY;

    const computed = window.getComputedStyle(this.container);
    const minW = Number.parseFloat(computed.minWidth) || 150;
    const minH = Number.parseFloat(computed.minHeight) || 90;

    // No maximum limit: allow resize to any size (CSS max-* removed for editor card)
    const cssMaxW = Number.parseFloat(computed.maxWidth);
    const cssMaxH = Number.parseFloat(computed.maxHeight);
    const noMax = 1e6; // effective no-limit when CSS max is not set
    const maxW = Number.isFinite(cssMaxW) ? cssMaxW : noMax;
    const maxH = Number.isFinite(cssMaxH) ? cssMaxH : noMax;

    const newW = Math.max(minW, Math.min(this.resizeStartWidth + dx, maxW));
    const newH = Math.max(minH, Math.min(this.resizeStartHeight + dy, maxH));

    this.container.style.width = `${newW}px`;
    this.container.style.height = `${newH}px`;
  }

  /**
   * End resizing
   */
  endResize(e) {
    if (!this.isResizing) return;

    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (this.resizeAnimationFrame) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }

    // Final update to the latest mouse position
    this._updateResizeSize();

    this.isResizing = false;

    // Restore cursor
    document.body.style.cursor = this._prevBodyCursor || '';
    this._prevBodyCursor = undefined;

    // Remove global listeners
    if (this.onResizeBound) {
      document.removeEventListener('mousemove', this.onResizeBound, { capture: true });
      window.removeEventListener('mousemove', this.onResizeBound, { capture: true });
      this.onResizeBound = null;
    }
    if (this.endResizeBound) {
      document.removeEventListener('mouseup', this.endResizeBound, { capture: true });
      window.removeEventListener('mouseup', this.endResizeBound, { capture: true });
      window.removeEventListener('blur', this.endResizeBound, { capture: true });
      this.endResizeBound = null;
    }

    // Show connection line after resize ends
    setTimeout(() => {
      if (!this.isDragging && !this.isResizing) {
        this.showConnectionLine();
      }
    }, 150);

    // Save size (async; no need to block UI)
    try {
      const rect = this.container.getBoundingClientRect();
      this.saveSize(Math.round(rect.width), Math.round(rect.height));
    } catch (error) {
      console.error('Error reading size for save:', error);
    }
  }

  /**
   * Save card size to database
   */
  async saveSize(width, height) {
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.cardWidth = width;
        note.cardHeight = height;
        note.updatedAt = Date.now();

        await safeSendMessage({
          action: 'saveNote',
          note
        });

        // Update local note data
        if (this.noteData) {
          this.noteData.cardWidth = width;
          this.noteData.cardHeight = height;
        }

        console.log('Note size saved:', { width, height });
      }
    } catch (error) {
      console.error('Error saving note size:', error);
    }
  }

  /**
   * Start dragging the card
   */
  startDrag(e) {
    // Prevent default behavior and stop propagation
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation(); // Prevent other handlers from running
    
    // Clear any pending line show timeout
    if (this._showLineTimeout) {
      clearTimeout(this._showLineTimeout);
      this._showLineTimeout = null;
    }
    
    // Cancel any pending animation frame
    if (this.dragAnimationFrame) {
      cancelAnimationFrame(this.dragAnimationFrame);
      this.dragAnimationFrame = null;
    }
    
    this.isDragging = true;
    this._justFinishedDragging = false; // Clear flag when starting new drag
    this.container.classList.add('notes-layer-dragging');
    
    const rect = this.container.getBoundingClientRect();
    // Store initial position in *document* coordinates (since card is `position: absolute`)
    const scroll = this._getScrollXY();
    this.initialX = rect.left + scroll.x;
    this.initialY = rect.top + scroll.y;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    
    // Cache card dimensions to avoid expensive getBoundingClientRect calls during drag
    this.cardWidth = rect.width;
    this.cardHeight = rect.height;
    
    // Initialize final position
    this._finalX = this.initialX;
    this._finalY = this.initialY;

    // Hide connection line during dragging
    this.hideConnectionLine();

    // Enable will-change for better performance during drag
    this.container.style.willChange = 'transform';

    // Add global event listeners with capture to ensure they fire
    // Use passive: false to allow preventDefault
    document.addEventListener('mousemove', this.onDragBound = this.onDrag.bind(this), { capture: true, passive: false });
    document.addEventListener('mouseup', this.endDragBound = this.endDrag.bind(this), { capture: true, passive: false });
    
    // Listen on window for better tracking when mouse leaves document
    window.addEventListener('mousemove', this.onDragBound, { capture: true, passive: false });
    window.addEventListener('mouseup', this.endDragBound, { capture: true, passive: false });
    window.addEventListener('blur', this.endDragBound, { capture: true, passive: false });
    
    // Handle mouse leaving window - only end drag if mouse actually leaves the viewport
    this.windowMouseoutBound = (e) => {
      // Check if mouse coordinates are outside viewport bounds
      if (e.clientX <= 0 || e.clientY <= 0 || 
          e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        this.endDrag(e);
      }
    };
    window.addEventListener('mouseout', this.windowMouseoutBound, { capture: true, passive: false });
  }

  /**
   * Handle drag movement
   */
  onDrag(e) {
    if (!this.isDragging) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation(); // Prevent other handlers from interfering

    // Store latest mouse coordinates immediately
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Update position immediately for responsiveness, but also schedule RAF for smooth rendering
    this._updateDragPosition();

    // Also schedule RAF update to catch any missed frames
    if (!this.dragAnimationFrame) {
      this.dragAnimationFrame = requestAnimationFrame(() => {
        this.dragAnimationFrame = null;
        // Update again with latest coordinates in case we missed some events
        if (this.isDragging) {
          this._updateDragPosition();
        }
      });
    }
  }

  /**
   * Update drag position
   */
  _updateDragPosition() {
    if (!this.isDragging) return;

    const deltaX = this.lastMouseX - this.dragStartX;
    const deltaY = this.lastMouseY - this.dragStartY;

    let newX = this.initialX + deltaX;
    let newY = this.initialY + deltaY;

    // Constrain to current viewport bounds (in document coordinates)
    const scroll = this._getScrollXY();
    const minX = scroll.x;
    const minY = scroll.y;
    const maxX = scroll.x + window.innerWidth - this.cardWidth;
    const maxY = scroll.y + window.innerHeight - this.cardHeight;
    newX = Math.max(minX, Math.min(newX, maxX));
    newY = Math.max(minY, Math.min(newY, maxY));

    // Disable transitions and use transform for smooth GPU-accelerated dragging
    this.container.style.transition = 'none';
    this.container.style.willChange = 'transform';
    
    // Use transform for smooth dragging (better performance, GPU accelerated)
    // Calculate offset from initial position
    const offsetX = newX - this.initialX;
    const offsetY = newY - this.initialY;
    this.container.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

    // Store final position for when drag ends (but don't apply left/top during drag to avoid conflicts)
    this._finalX = newX;
    this._finalY = newY;

    // Don't update connection line during dragging - it will be shown after drag ends
  }

  /**
   * End dragging and save position
   */
  async endDrag(e) {
    if (!this.isDragging) return;
    
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Cancel any pending animation frame
    if (this.dragAnimationFrame) {
      cancelAnimationFrame(this.dragAnimationFrame);
      this.dragAnimationFrame = null;
    }

    // Final position update to ensure we're at the latest mouse position
    this._updateDragPosition();

    // Remove transform and apply final left/top position
    const finalX = this._finalX !== undefined ? this._finalX : this.initialX;
    const finalY = this._finalY !== undefined ? this._finalY : this.initialY;
    
    this.container.style.transform = 'none';
    this.container.style.willChange = 'auto';
    this.container.style.left = `${finalX}px`;
    this.container.style.top = `${finalY}px`;

    this.isDragging = false;
    this._justFinishedDragging = true; // Flag to prevent immediate close
    this.container.classList.remove('notes-layer-dragging');
    
    // Restore transitions after dragging
    this.container.style.transition = '';

    // Remove global event listeners from both document and window
    if (this.onDragBound) {
      document.removeEventListener('mousemove', this.onDragBound, { capture: true });
      window.removeEventListener('mousemove', this.onDragBound, { capture: true });
      this.onDragBound = null;
    }
    if (this.endDragBound) {
      document.removeEventListener('mouseup', this.endDragBound, { capture: true });
      window.removeEventListener('mouseup', this.endDragBound, { capture: true });
      window.removeEventListener('blur', this.endDragBound, { capture: true });
      this.endDragBound = null;
    }
    if (this.windowMouseoutBound) {
      window.removeEventListener('mouseout', this.windowMouseoutBound, { capture: true });
      this.windowMouseoutBound = null;
    }

    // Save position as offset relative to highlight
    const highlightDoc = this._getHighlightDocRect();
    if (highlightDoc) {
      const offsetX = finalX - highlightDoc.left;
      const offsetY = finalY - highlightDoc.top;
      await this.savePosition(offsetX, offsetY);
    } else {
      // If highlight is missing, keep runtime offset only (cannot anchor)
      this._runtimeOffsetX = undefined;
      this._runtimeOffsetY = undefined;
    }
    
    // Clear cached dimensions and final position
    this.cardWidth = 0;
    this.cardHeight = 0;
    this._finalX = undefined;
    this._finalY = undefined;
    
    // Clear the flag after a short delay to allow normal click handling
    setTimeout(() => {
      this._justFinishedDragging = false;
    }, 200);
    
    // Show connection line after 0.5 seconds delay
    // Clear any existing timeout
    if (this._showLineTimeout) {
      clearTimeout(this._showLineTimeout);
    }
    this._showLineTimeout = setTimeout(() => {
      if (!this.isDragging) {
        this.showConnectionLine();
      }
      this._showLineTimeout = null;
    }, 500);
  }

  /**
   * Save card position to database
   */
  async savePosition(offsetX, offsetY) {
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.offsetX = offsetX;
        note.offsetY = offsetY;
        // Clear legacy fields (viewport-based) to avoid ambiguity
        try {
          delete note.positionX;
          delete note.positionY;
        } catch (e) {
          // ignore
        }
        note.updatedAt = Date.now();

        await safeSendMessage({
          action: 'saveNote',
          note
        });

        // Update local note data
        if (this.noteData) {
          this.noteData.offsetX = offsetX;
          this.noteData.offsetY = offsetY;
          try {
            delete this.noteData.positionX;
            delete this.noteData.positionY;
          } catch (e) {
            // ignore
          }
        }

        console.log('Note position saved (offset):', { offsetX, offsetY });
      }
    } catch (error) {
      console.error('Error saving note position:', error);
    }
  }

  /**
   * Create connection line SVG element
   */
  createConnectionLine() {
    if (this.connectionLine) {
      return; // Already created
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Use setAttribute for SVG elements instead of className
    svg.setAttribute('class', 'notes-layer-connection-line');
    svg.style.position = 'fixed';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '99999';
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    
    // Set color based on warning level
    let strokeColor = '#4a90e2'; // Default blue
    if (this.warningLevel === 'yellow') {
      strokeColor = '#ffa500';
    } else if (this.warningLevel === 'red') {
      strokeColor = '#ff4444';
    }
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('opacity', '0.6');
    
    svg.appendChild(path);
    document.body.appendChild(svg);
    
    this.connectionLine = { svg, path };
  }

  /**
   * Show connection line (when card is not being dragged)
   */
  showConnectionLine() {
    // Don't show line during dragging
    if (this.isDragging) {
      return;
    }
    
    if (!this.connectionLine) {
      this.createConnectionLine();
    }
    if (this.connectionLine && this.connectionLine.svg) {
      this.connectionLine.svg.style.display = 'block';
      this.updateConnectionLine();
      
      // Setup scroll and resize listeners for line updates
      if (!this._scrollListener) {
        this._scrollListener = () => {
          // Only update if not dragging
          if (!this.isDragging && this.connectionLine) {
            this.updateConnectionLine();
          }
        };
        window.addEventListener('scroll', this._scrollListener, true);
        window.addEventListener('resize', this._scrollListener);
      }
    }
  }

  /**
   * Hide connection line
   */
  hideConnectionLine() {
    if (this.connectionLine && this.connectionLine.svg) {
      this.connectionLine.svg.style.display = 'none';
    }
    if (this.lineUpdateAnimationFrame) {
      cancelAnimationFrame(this.lineUpdateAnimationFrame);
      this.lineUpdateAnimationFrame = null;
    }
    
    // Remove scroll and resize listeners
    if (this._scrollListener) {
      window.removeEventListener('scroll', this._scrollListener, true);
      window.removeEventListener('resize', this._scrollListener);
      this._scrollListener = null;
    }
  }

  /**
   * Update connection line position
   */
  updateConnectionLine() {
    if (!this.connectionLine || !this.connectionLine.path) {
      return;
    }

    // Cancel previous animation frame if any
    if (this.lineUpdateAnimationFrame) {
      cancelAnimationFrame(this.lineUpdateAnimationFrame);
    }

    // Use requestAnimationFrame for smooth updates
    this.lineUpdateAnimationFrame = requestAnimationFrame(() => {
      this._updateConnectionLinePath();
    });
  }

  /**
   * Update the actual path of the connection line
   */
  _updateConnectionLinePath() {
    if (!this.connectionLine || !this.connectionLine.path) {
      return;
    }

    // Find highlight element
    const highlightElement = this.findHighlightElement();
    if (!highlightElement) {
      // No highlight found, hide line
      if (this.connectionLine.svg) {
        this.connectionLine.svg.style.display = 'none';
      }
      return;
    }

    // Get card position
    const cardRect = this.container.getBoundingClientRect();
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top + cardRect.height / 2;

    // Get highlight position
    const highlightRect = highlightElement.getBoundingClientRect();
    const highlightCenterX = highlightRect.left + highlightRect.width / 2;
    const highlightCenterY = highlightRect.top + highlightRect.height / 2;

    // Calculate connection points
    // Start from highlight center
    const startX = highlightCenterX;
    const startY = highlightCenterY;

    // End at card edge (closest point to highlight)
    let endX, endY;
    const dx = cardCenterX - highlightCenterX;
    const dy = cardCenterY - highlightCenterY;
    const angle = Math.atan2(dy, dx);

    // Find intersection point with card rectangle
    const halfWidth = cardRect.width / 2;
    const halfHeight = cardRect.height / 2;

    // Calculate which edge to connect to
    const tan = Math.abs(dy / dx);
    const cardTan = halfHeight / halfWidth;

    if (tan < cardTan) {
      // Connect to left or right edge
      endX = dx > 0 ? cardRect.left : cardRect.right;
      endY = cardCenterY + (endX - cardCenterX) * Math.tan(angle);
    } else {
      // Connect to top or bottom edge
      endY = dy > 0 ? cardRect.top : cardRect.bottom;
      endX = cardCenterX + (endY - cardCenterY) / Math.tan(angle);
    }

    // Control points for Bezier curve
    const distance = Math.sqrt(dx * dx + dy * dy);
    const controlOffset = Math.min(distance * 0.3, 100);

    const controlX1 = startX + controlOffset * Math.cos(angle);
    const controlY1 = startY + controlOffset * Math.sin(angle);
    const controlX2 = endX - controlOffset * Math.cos(angle);
    const controlY2 = endY - controlOffset * Math.sin(angle);

    // Create Bezier curve path
    const pathData = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    this.connectionLine.path.setAttribute('d', pathData);
  }

  /**
   * Find highlight element for this note
   */
  findHighlightElement() {
    // Try to find through highlighter instance (if available globally)
    if (typeof Highlighter !== 'undefined' && window.notesLayerContent?.highlighter) {
      const highlight = window.notesLayerContent.highlighter.getHighlight(this.noteId);
      if (highlight) {
        return highlight.element || (highlight.elements && highlight.elements[0]) || null;
      }
    }

    // Fallback: find via DOM
    const highlightElement = document.querySelector(`.notes-layer-highlight[data-note-id="${this.noteId}"]`);
    return highlightElement || null;
  }

  /**
   * Extract title from Quill Delta
   * Gets the first line or first 60 characters of text
   */
  extractTitleFromDelta(delta) {
    if (!delta || !delta.ops) {
      return null;
    }

    try {
      let text = '';
      let firstLine = '';
      
      // Extract all text from delta
      for (const op of delta.ops) {
        if (typeof op.insert === 'string') {
          text += op.insert;
        }
      }

      // Get first line (up to newline) or first 60 characters
      const newlineIndex = text.indexOf('\n');
      if (newlineIndex !== -1) {
        firstLine = text.substring(0, newlineIndex).trim();
      } else {
        firstLine = text.trim();
      }

      // Limit to 60 characters for title
      if (firstLine.length > 60) {
        firstLine = firstLine.substring(0, 60).trim();
        // Don't cut in the middle of a word if possible
        const lastSpace = firstLine.lastIndexOf(' ');
        if (lastSpace > 40) {
          firstLine = firstLine.substring(0, lastSpace);
        }
      }

      return firstLine || null;
    } catch (error) {
      console.error('Error extracting title from delta:', error);
      return null;
    }
  }

  /**
   * Save annotation content
   */
  async saveAnnotation() {
    if (!this.quill) {
      console.warn('Quill editor not initialized');
      return;
    }

    const delta = this.quill.getContents();
    
    try {
      // Get note data
      const getResponse = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (!getResponse || !getResponse.success) {
        console.error('Failed to get note:', getResponse?.error || 'Unknown error');
        return;
      }

      if (!getResponse.note) {
        console.error('Note not found:', this.noteId);
        return;
      }

      // Get note object
      const note = getResponse.note;

      // Extract title from content (only if title wasn't manually set)
      // If note already has a custom title (not 'annotation'), keep it
      const hasCustomTitle = note.title && note.title !== 'annotation';
      
      let title = note.title; // Keep existing title by default
      if (!hasCustomTitle) {
        // Only extract from content if no custom title was set
        const extractedTitle = this.extractTitleFromDelta(delta);
        title = extractedTitle || 'annotation';
      }

      // Update note with annotation content
      note.annotationContent = delta;
      note.type = 'annotation';
      note.title = title;
      note.updatedAt = Date.now();

      // Save note
      const saveResponse = await safeSendMessage({
        action: 'saveNote',
        note
      });

      if (!saveResponse || !saveResponse.success) {
        console.error('Failed to save annotation:', saveResponse?.error || 'Unknown error');
        return;
      }

      console.log('Annotation saved successfully', title ? `with title: ${title}` : '');
    } catch (error) {
      console.error('Error saving annotation:', error);
    }
  }

  /**
   * Ask question to AI
   */
  async askQuestion() {
    const questionInput = this.container.querySelector('.notes-layer-question-input');
    const question = questionInput?.value?.trim();

    if (!question) {
      alert('Please enter a question');
      return;
    }

    // Send request to Google; return to editor mode immediately (do not wait for response)
    const responsePromise = safeSendMessage({
      action: 'askAI',
      question
    });
    this.setMode('annotation');
    if (questionInput) {
      questionInput.disabled = false;
      questionInput.placeholder = 'Enter your question...';
    }

    try {
      const response = await responsePromise;

      if (response.success && response.answer) {
        // Handle both text and screenshot responses (save in background; user already in editor)
        let answer;
        if (typeof response.answer === 'string') {
          answer = response.answer;
        } else if (response.answer && typeof response.answer === 'object' && response.answer.text) {
          answer = response.answer.text;
        } else if (response.answer && typeof response.answer === 'object') {
          answer = JSON.stringify(response.answer);
        } else {
          answer = String(response.answer);
        }
        let answerTextToSave;
        if (typeof response.answer === 'string') {
          answerTextToSave = response.answer;
        } else if (response.answer && typeof response.answer === 'object' && response.answer.text) {
          answerTextToSave = response.answer.text;
        } else if (response.answer && typeof response.answer === 'object') {
          answerTextToSave = JSON.stringify(response.answer);
        } else {
          answerTextToSave = String(answer || '');
        }
        await this.saveQuestionAndAnswer(question, answerTextToSave);
      } else {
        const errorMsg = response?.error || 'Unknown error';
        let userMessage = 'Не удалось получить ответ. ';
        
        // Solution 4: Improved error handling with specific error types
        if (errorMsg.includes('GOOGLE_BLOCKED')) {
          userMessage += 'Google заблокировал автоматический запрос.\n\n' +
            'Возможные решения:\n' +
            '• Подождите 1-2 минуты и попробуйте снова\n' +
            '• Используйте более простой вопрос\n' +
            '• Переформулируйте запрос другими словами';
        } else if (errorMsg.includes('REDIRECT_ERROR')) {
          userMessage += 'Google Search перенаправил на другую страницу.\n\n' +
            'Попробуйте:\n' +
            '• Подождать несколько секунд\n' +
            '• Переформулировать вопрос\n' +
            '• Использовать более конкретный запрос';
        } else if (errorMsg.includes('EXTENSION_ERROR') || errorMsg.includes('Tab closed')) {
          userMessage += 'Вкладка была закрыта неожиданно.\n\n' +
            'Попробуйте:\n' +
            '• Перезагрузить расширение\n' +
            '• Попробовать еще раз\n' +
            '• Проверить, не блокирует ли антивирус расширение';
        } else if (errorMsg.includes('EXTRACTION_FAILED') || errorMsg.includes('Could not extract') || errorMsg.includes('Не удалось извлечь')) {
          userMessage += 'Не удалось извлечь ответ из Google Search.\n\n' +
            'Возможные причины:\n' +
            '• Google заблокировал автоматический запрос\n' +
            '• Вопрос слишком сложный или неоднозначный\n' +
            '• Страница не загрузилась полностью\n\n' +
            'Попробуйте:\n' +
            '• Переформулировать вопрос более просто\n' +
            '• Использовать более конкретный запрос\n' +
            '• Подождать 30 секунд и попробовать снова';
        } else if (errorMsg.includes('EXTRACTION_ERROR')) {
          userMessage += 'Ошибка при извлечении ответа: ' + errorMsg.replace('EXTRACTION_ERROR: ', '');
        } else {
          userMessage += errorMsg;
        }
        
        alert(userMessage);
      }
    } catch (error) {
      console.error('Error asking question:', error);
      let userMessage = 'Ошибка при запросе: ';
      
      // Solution 4: Improved error handling with specific error types
      if (error.message.includes('GOOGLE_BLOCKED')) {
        userMessage += 'Google заблокировал автоматический запрос.\n\n' +
          'Возможные решения:\n' +
          '• Подождите 1-2 минуты и попробуйте снова\n' +
          '• Используйте более простой вопрос\n' +
          '• Переформулируйте запрос другими словами';
      } else if (error.message.includes('REDIRECT_ERROR')) {
        userMessage += 'Google Search перенаправил на другую страницу.\n\n' +
          'Попробуйте:\n' +
          '• Подождать несколько секунд\n' +
          '• Переформулировать вопрос\n' +
          '• Использовать более конкретный запрос';
      } else if (error.message.includes('EXTENSION_ERROR') || error.message.includes('Tab closed')) {
        userMessage += 'Вкладка была закрыта неожиданно.\n\n' +
          'Попробуйте:\n' +
          '• Перезагрузить расширение\n' +
          '• Попробовать еще раз\n' +
          '• Проверить, не блокирует ли антивирус расширение';
      } else if (error.message.includes('EXTRACTION_FAILED') || error.message.includes('Could not extract') || error.message.includes('Не удалось извлечь')) {
        userMessage += 'Не удалось извлечь ответ из Google Search.\n\n' +
          'Возможные причины:\n' +
          '• Google заблокировал автоматический запрос\n' +
          '• Вопрос слишком сложный или неоднозначный\n' +
          '• Страница не загрузилась полностью\n\n' +
          'Попробуйте:\n' +
          '• Переформулировать вопрос более просто\n' +
          '• Использовать более конкретный запрос\n' +
          '• Подождать 30 секунд и попробовать снова';
      } else if (error.message.includes('EXTRACTION_ERROR')) {
        userMessage += 'Ошибка при извлечении ответа: ' + error.message.replace('EXTRACTION_ERROR: ', '');
      } else {
        userMessage += error.message;
      }
      
      alert(userMessage);
    } finally {
      // Restore input field
      if (questionInput) {
        questionInput.disabled = false;
        questionInput.placeholder = 'Enter your question...';
      }
    }
  }

  /**
   * Save question and answer
   */
  async saveQuestionAndAnswer(question, answer) {
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.questionContent = question;
        note.aiAnswer = answer;
        note.type = 'question';
        // Extract title from question (first 60 characters)
        note.title = question ? question.substring(0, 60).trim() : 'question';
        note.updatedAt = Date.now();

        // Save link with query in annotationContent (shortened text, but as link)
        if (this.quill && question) {
          // Create Google Search URL with query
          const query = encodeURIComponent(`Кратко и понятно объясни: ${question}`);
          const searchUrl = `https://www.google.com/ai?q=${query}`;
          
          // Get current content length
          const currentLength = this.quill.getLength();
          
          // Insert newline if there's existing content
          let insertIndex = currentLength - 1;
          if (currentLength > 1) {
            this.quill.insertText(insertIndex, '\n', 'user');
            insertIndex = this.quill.getLength() - 1; // Update index after inserting newline
          }
          
          // Insert link with shortened text (just the question text)
          // Quill uses Delta format for links - insert text and then format it as link
          const linkText = question.length > 60 ? question.substring(0, 60) + '...' : question;
          this.quill.insertText(insertIndex, linkText, 'user');
          
          // Format the inserted text as a link
          this.quill.formatText(insertIndex, linkText.length, 'link', searchUrl);
          
          // Save annotation with the link
          await this.saveAnnotation();
        }

        await safeSendMessage({
          action: 'saveNote',
          note
        });
      }
    } catch (error) {
      console.error('Error saving question and answer:', error);
    }
  }

  /**
   * Accept answer as annotation
   */
  async acceptAnswerAsAnnotation() {
    const answerText = this.container.querySelector('.notes-layer-answer-text');
    const answer = answerText?.textContent;

    if (!answer || !this.quill) {
      return;
    }

    // Insert answer into Quill editor
    this.quill.insertText(this.quill.getLength(), answer, 'user');
    
    // Switch to annotation mode
    this.setMode('annotation');

    // Clear question and answer
    const questionInput = this.container.querySelector('.notes-layer-question-input');
    if (questionInput) questionInput.value = '';
    
    const answerContainer = this.container.querySelector('.notes-layer-answer-container');
    if (answerContainer) answerContainer.style.display = 'none';

    // Save annotation
    await this.saveAnnotation();

    // Clear question data
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.questionContent = null;
        note.aiAnswer = null;
        note.type = 'annotation';

        await safeSendMessage({
          action: 'saveNote',
          note
        });
      }
    } catch (error) {
      console.error('Error clearing question:', error);
    }
  }

  /**
   * Delete question
   */
  async deleteQuestion() {
    const questionInput = this.container.querySelector('.notes-layer-question-input');
    const answerContainer = this.container.querySelector('.notes-layer-answer-container');
    
    if (questionInput) questionInput.value = '';
    if (answerContainer) answerContainer.style.display = 'none';

    // Hide buttons
    const acceptBtn = this.container.querySelector('.notes-layer-accept-answer');
    const deleteBtn = this.container.querySelector('.notes-layer-delete-question');
    if (acceptBtn) acceptBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';

    // Clear question data
    try {
      const response = await safeSendMessage({
        action: 'getNoteById',
        noteId: this.noteId
      });

      if (response.success && response.note) {
        const note = response.note;
        note.questionContent = null;
        note.aiAnswer = null;
        note.type = 'annotation';

        await safeSendMessage({
          action: 'saveNote',
          note
        });
      }
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  }

  /**
   * Delete note
   */
  async deleteNote() {
    try {
      await safeSendMessage({
        action: 'deleteNote',
        noteId: this.noteId
      });

      // Remove highlight
      const event = new CustomEvent('notes-layer-delete-note', {
        detail: { noteId: this.noteId }
      });
      document.dispatchEvent(event);

      this.close();
    } catch (error) {
      console.error('Error deleting note:', error);
      alert('Error deleting note: ' + error.message);
    }
  }

  /**
   * Re-anchor note
   */
  reanchorNote() {
    // Dispatch event to content script to handle re-anchoring
    const event = new CustomEvent('notes-layer-reanchor', {
      detail: { noteId: this.noteId }
    });
    document.dispatchEvent(event);
    this.close();
  }

  /**
   * Close card
   */
  close() {
    // Hide tooltip if visible
    this.hideAllTooltips();
    
    // Clean up tooltip position fix listeners
    if (this._tooltipCleanup) {
      this._tooltipCleanup();
      this._tooltipCleanup = null;
    }

    // Clean up drag & drop
    if (this.isDragging) {
      this.endDrag();
    }
    
    // Cancel any pending drag animation frame
    if (this.dragAnimationFrame) {
      cancelAnimationFrame(this.dragAnimationFrame);
      this.dragAnimationFrame = null;
    }
    
    // Clear line show timeout
    if (this._showLineTimeout) {
      clearTimeout(this._showLineTimeout);
      this._showLineTimeout = null;
    }
    
    // Remove outside click handler
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler, true);
      this._outsideClickHandler = null;
    }

    // Remove connection line
    this.hideConnectionLine();
    if (this.connectionLine && this.connectionLine.svg && this.connectionLine.svg.parentNode) {
      this.connectionLine.svg.parentNode.removeChild(this.connectionLine.svg);
    }
    this.connectionLine = null;
    
    // Clean up scroll listener if still exists
    if (this._scrollListener) {
      window.removeEventListener('scroll', this._scrollListener, true);
      window.removeEventListener('resize', this._scrollListener);
      this._scrollListener = null;
    }

    // Clean up anchor tracking listeners (card follows highlight)
    if (this._anchorScrollListener) {
      window.removeEventListener('scroll', this._anchorScrollListener, true);
      window.removeEventListener('resize', this._anchorScrollListener);
      this._anchorScrollListener = null;
    }
    if (this._anchorTrackingRaf) {
      cancelAnimationFrame(this._anchorTrackingRaf);
      this._anchorTrackingRaf = null;
    }

    // Dispatch event to notify that card is closing
    if (this.noteId) {
      const event = new CustomEvent('notes-layer-card-closed', {
        detail: { noteId: this.noteId }
      });
      document.dispatchEvent(event);
    }
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.quill = null;
  }

  /**
   * Setup scroll/resize tracking so the card follows the highlight.
   * With `position: absolute`, the card will naturally move with the page,
   * but this keeps the anchor-relative offset consistent if layout shifts.
   */
  setupScrollTracking() {
    if (this._anchorScrollListener) return;

    this._anchorScrollListener = () => {
      if (this.isDragging || this.isResizing) return;

      if (this._anchorTrackingRaf) return;
      this._anchorTrackingRaf = requestAnimationFrame(() => {
        this._anchorTrackingRaf = null;
        this.updatePosition();
      });
    };

    window.addEventListener('scroll', this._anchorScrollListener, true);
    window.addEventListener('resize', this._anchorScrollListener);
  }

  _getScrollXY() {
    return {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0
    };
  }

  _getHighlightDocRect() {
    const highlightElement = this.findHighlightElement();
    if (!highlightElement) return null;

    const r = highlightElement.getBoundingClientRect();
    const s = this._getScrollXY();
    return {
      left: r.left + s.x,
      top: r.top + s.y,
      right: r.right + s.x,
      bottom: r.bottom + s.y,
      width: r.width,
      height: r.height
    };
  }

  _getCardDocLeftTop() {
    if (!this.container) return null;

    const r = this.container.getBoundingClientRect();
    const s = this._getScrollXY();
    return { left: r.left + s.x, top: r.top + s.y, width: r.width, height: r.height };
  }

  /**
   * Update card position.
   * - If called with (x,y): set absolute document position directly.
   * - If called without args: position relative to highlight using saved offsets.
   */
  updatePosition(x, y) {
    if (!this.container) return;

    // Backward-compatible direct set
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
      return;
    }

    if (this.isDragging || this.isResizing) return;

    const highlightDoc = this._getHighlightDocRect();
    if (!highlightDoc) return;

    // Determine offsets
    let offsetX = this.noteData ? Number(this.noteData.offsetX) : NaN;
    let offsetY = this.noteData ? Number(this.noteData.offsetY) : NaN;

    // Legacy migration path: positionX/positionY were viewport coords (fixed positioning)
    if ((!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) && this.noteData &&
        this.noteData.positionX !== undefined && this.noteData.positionY !== undefined) {
      const s = this._getScrollXY();
      const legacyViewportX = Number(this.noteData.positionX);
      const legacyViewportY = Number(this.noteData.positionY);
      const legacyDocX = legacyViewportX + s.x;
      const legacyDocY = legacyViewportY + s.y;

      offsetX = legacyDocX - highlightDoc.left;
      offsetY = legacyDocY - highlightDoc.top;

      // Save migrated offsets (async, don't block UI)
      this.savePosition(offsetX, offsetY);
    }

    // If still no offsets, derive runtime offsets from current card position
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      const cardDoc = this._getCardDocLeftTop();
      if (!cardDoc) return;
      offsetX = cardDoc.left - highlightDoc.left;
      offsetY = cardDoc.top - highlightDoc.top;

      // Persist computed offsets for new notes so subsequent scrolls use stable values
      if (this.noteData && this.noteData.offsetX === undefined && this.noteData.offsetY === undefined) {
        try {
          // Async, fire-and-forget
          this.savePosition(offsetX, offsetY);
        } catch (err) {
          console.error('Error saving computed offset:', err);
        }
      }

      this._runtimeOffsetX = offsetX;
      this._runtimeOffsetY = offsetY;
    }

    // Use runtime offsets if present and noteData is missing
    if ((!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) &&
        Number.isFinite(this._runtimeOffsetX) && Number.isFinite(this._runtimeOffsetY)) {
      offsetX = this._runtimeOffsetX;
      offsetY = this._runtimeOffsetY;
    }

    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;

    const newLeft = highlightDoc.left + offsetX;
    const newTop = highlightDoc.top + offsetY;
    this.container.style.left = `${newLeft}px`;
    this.container.style.top = `${newTop}px`;
  }
}
