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

    // Position card
    this.container.style.left = `${position.x}px`;
    this.container.style.top = `${position.y}px`;

    // Append to body
    document.body.appendChild(this.container);

    // Initialize Quill editor
    await this.initQuill();

    // Load note data
    if (this.noteData) {
      await this.loadNoteData(this.noteData);
    }

    // Setup event listeners
    this.setupEventListeners();

    // Set initial mode
    this.setMode(this.mode);
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
            [{ 'list': 'ordered'}, { 'list': 'bullet' }]
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
            const displayText = this.noteData.title;
            titleElement.appendChild(document.createTextNode(displayText));
            titleElement.appendChild(createEditButton());
            titleElement.title = this.noteData.title;
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
    titleElement.textContent = currentTitle;
    titleElement.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleElement);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // Save on blur or Enter key
    const saveTitle = async () => {
      const newTitle = titleElement.textContent.trim();
      titleElement.contentEditable = 'false';
      titleElement.classList.remove('editing');

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
        titleElement.appendChild(document.createTextNode(restoredTitle));
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
        titleElement.title = restoredTitle;
      } else {
        // Title unchanged, just restore display
        while (titleElement.firstChild) {
          titleElement.removeChild(titleElement.firstChild);
        }
        titleElement.appendChild(document.createTextNode(newTitle));
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
        titleElement.title = newTitle;
      }
    };

    titleElement.addEventListener('blur', saveTitle, { once: true });
    titleElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleElement.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        titleElement.textContent = currentTitle || 'Note';
        if (editBtnClone) {
          titleElement.appendChild(editBtnClone);
        }
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
            // Add text and edit button
            titleElement.appendChild(document.createTextNode(newTitle));
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
            titleElement.title = newTitle;
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
            // Insert text as quote or bold
            this.quill.insertText(0, response.anchor.text + '\n\n', 'bold', true);
            // Move cursor to end
            this.quill.setSelection(this.quill.getLength(), 0);
            this.quill.focus();
        }
    } catch (error) {
        console.error('Error fetching anchor text:', error);
    }
  }

  /**
   * Set mode (annotation or question)
   */
  setMode(mode) {
    this.mode = mode;

    const annotationMode = this.container.querySelector('.notes-layer-annotation-mode');
    const questionMode = this.container.querySelector('.notes-layer-question-mode');
    const switchToQuestionBtn = this.container.querySelector('.notes-layer-switch-to-question');
    const switchToAnnotationBtn = this.container.querySelector('.notes-layer-switch-to-annotation');
    const acceptAnswerBtn = this.container.querySelector('.notes-layer-accept-answer');
    const deleteQuestionBtn = this.container.querySelector('.notes-layer-delete-question');
    const modeLabel = this.container.querySelector('.notes-layer-card-mode');

    if (mode === 'annotation') {
      if (annotationMode) annotationMode.style.display = 'block';
      if (questionMode) questionMode.style.display = 'none';
      if (switchToQuestionBtn) switchToQuestionBtn.style.display = 'inline-block';
      if (switchToAnnotationBtn) switchToAnnotationBtn.style.display = 'none';
      if (acceptAnswerBtn) acceptAnswerBtn.style.display = 'none';
      if (deleteQuestionBtn) deleteQuestionBtn.style.display = 'none';
      // Mode label is hidden dynamically in setHeaderText, no need to set text here if overridden
      if (modeLabel && modeLabel.style.display !== 'none') modeLabel.textContent = 'Annotation Mode';
    } else {
      if (annotationMode) annotationMode.style.display = 'none';
      if (questionMode) questionMode.style.display = 'block';
      if (switchToQuestionBtn) switchToQuestionBtn.style.display = 'none';
      if (switchToAnnotationBtn) switchToAnnotationBtn.style.display = 'inline-block';
      // Only show mode label for Question Mode if we want to differentiate, or keep it hidden if we want header to be just the text
      if (modeLabel) {
          modeLabel.style.display = 'inline-block';
          modeLabel.textContent = 'Question Mode';
      }
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.notes-layer-card-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Switch to question mode
    const switchToQuestionBtn = this.container.querySelector('.notes-layer-switch-to-question');
    if (switchToQuestionBtn) {
      switchToQuestionBtn.addEventListener('click', () => this.setMode('question'));
    }

    // Switch to annotation mode
    const switchToAnnotationBtn = this.container.querySelector('.notes-layer-switch-to-annotation');
    if (switchToAnnotationBtn) {
      switchToAnnotationBtn.addEventListener('click', () => this.setMode('annotation'));
    }

    // Ask question
    const askBtn = this.container.querySelector('.notes-layer-ask-btn');
    if (askBtn) {
      askBtn.addEventListener('click', () => this.askQuestion());
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

    // Delete note
    const deleteNoteBtn = this.container.querySelector('.notes-layer-delete-note');
    if (deleteNoteBtn) {
      deleteNoteBtn.addEventListener('click', () => this.deleteNote());
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

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.container && !this.container.contains(e.target)) {
        // Don't close if clicking on marker
        if (!e.target.classList.contains('notes-layer-marker')) {
          // Small delay to allow marker clicks to work
          setTimeout(() => {
            if (this.container && !document.querySelector('.notes-layer-marker:hover')) {
              this.close();
            }
          }, 100);
        }
      }
    }, true);
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

    // Show loading
    const askBtn = this.container.querySelector('.notes-layer-ask-btn');
    const originalText = askBtn?.textContent;
    if (askBtn) {
      askBtn.textContent = 'Loading...';
      askBtn.disabled = true;
    }

    try {
      const response = await safeSendMessage({
        action: 'askAI',
        question
      });

      if (response.success && response.answer) {
        // Handle both text and screenshot responses
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
        const screenshot = response.screenshot || (response.answer && typeof response.answer === 'object' && response.answer.screenshot) || null;
        
        // Show answer
        const answerContainer = this.container.querySelector('.notes-layer-answer-container');
        const answerText = this.container.querySelector('.notes-layer-answer-text');
        if (answerContainer && answerText) {
          if (screenshot) {
            // Show screenshot with text
            answerText.innerHTML = `
              <div style="margin-bottom: 12px;">
                <img src="${screenshot}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" alt="AI Answer Screenshot" />
              </div>
              <div style="margin-top: 12px;">${answer}</div>
            `;
          } else {
            answerText.textContent = answer;
          }
          answerContainer.style.display = 'block';
        }

        // Show accept/delete buttons
        const acceptBtn = this.container.querySelector('.notes-layer-accept-answer');
        const deleteBtn = this.container.querySelector('.notes-layer-delete-question');
        if (acceptBtn) acceptBtn.style.display = 'inline-block';
        if (deleteBtn) deleteBtn.style.display = 'inline-block';

        // Save question and answer (extract text if it's an object)
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
      if (askBtn) {
        askBtn.textContent = originalText;
        askBtn.disabled = false;
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
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.quill = null;
  }

  /**
   * Update position
   */
  updatePosition(x, y) {
    if (this.container) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
    }
  }
}
