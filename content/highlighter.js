// Text highlighting and markers

class Highlighter {
  constructor() {
    this.highlights = new Map(); // noteId -> { range, marker, element }
  }

  /**
   * Highlight text and add marker
   */
  highlightText(range, noteId, warningLevel = 'none') {
    if (!range || !noteId) {
      console.warn('highlightText: Invalid range or noteId');
      return;
    }

    // Validate range
    try {
      if (!range.startContainer || !range.endContainer) {
        console.warn('highlightText: Range has invalid containers');
        return;
      }
      
      // Check if range is in the same document
      if (range.startContainer.ownerDocument !== document || 
          range.endContainer.ownerDocument !== document) {
        console.warn('highlightText: Range is in different document');
        return;
      }
    } catch (error) {
      console.error('highlightText: Range validation failed:', error);
      return;
    }

    // Remove existing highlight if any
    this.removeHighlight(noteId);

    try {
      // Check if range can be surrounded (not crossing element boundaries incorrectly)
      const canSurround = this.canSurroundRange(range);
      
      if (canSurround) {
        // Method 1: Use surroundContents (preferred)
        const highlight = document.createElement('span');
        highlight.className = 'notes-layer-highlight';
        highlight.dataset.noteId = noteId;

        // Add warning class if needed
        if (warningLevel === 'yellow') {
          highlight.classList.add('notes-layer-warning-yellow');
        } else if (warningLevel === 'red') {
          highlight.classList.add('notes-layer-warning-red');
        }

        // Clone range to avoid issues
        const clonedRange = range.cloneRange();
        clonedRange.surroundContents(highlight);

        // Add marker icon (DISABLED - using click on highlight instead)
        // const marker = this.addMarker(noteId, range, warningLevel);

        // Store reference
        this.highlights.set(noteId, {
          range: clonedRange,
          marker: null,
          element: highlight
        });
        return;
      }
    } catch (error) {
      console.warn('Error highlighting text with surroundContents:', error);
      // Continue to fallback methods
    }

    // Method 2: Fallback - try multi-node highlighting (for cross-element ranges)
    try {
      const elements = this.highlightMultiNode(range, noteId, warningLevel);
      if (elements && elements.length > 0) {
        // const marker = this.addMarker(noteId, range, warningLevel);
        this.highlights.set(noteId, {
          range,
          marker: null,
          element: elements[0], // Store first element as reference
          elements // Store all elements for cleanup
        });
        return;
      }
    } catch (multiNodeError) {
      console.warn('Multi-node highlighting failed:', multiNodeError);
    }

    // Method 3: Fallback - wrap parent element (only if parent text matches selection)
    // This method is risky as it can highlight more than intended, so we use it only as last resort
    try {
      const selectedText = range.toString().trim();
      const commonAncestor = range.commonAncestorContainer;
      const parent = commonAncestor.nodeType === Node.TEXT_NODE
        ? commonAncestor.parentElement
        : (commonAncestor.nodeType === Node.ELEMENT_NODE ? commonAncestor : commonAncestor.parentElement);

        // Only use this method if parent's text content matches the selected text exactly
        // This prevents highlighting entire lines when only a word was selected
        if (parent && parent.parentNode) {
          const parentText = parent.textContent?.trim() || '';
          // Check if parent text is significantly longer than selection (more than 20% difference)
          // If so, don't use this method as it would highlight too much
          if (parentText.length > selectedText.length * 1.2) {
            // Silently skip - this is expected behavior to prevent over-highlighting
            throw new Error('Parent contains too much text');
          }
        
        const highlight = document.createElement('span');
        highlight.className = 'notes-layer-highlight';
        highlight.dataset.noteId = noteId;
        if (warningLevel === 'yellow') {
          highlight.classList.add('notes-layer-warning-yellow');
        } else if (warningLevel === 'red') {
          highlight.classList.add('notes-layer-warning-red');
        }
        
        // Wrap parent element
        parent.parentNode.insertBefore(highlight, parent);
        highlight.appendChild(parent);

        // const marker = this.addMarker(noteId, range, warningLevel);
        this.highlights.set(noteId, {
          range,
          marker: null,
          element: highlight
        });
        return;
      }
    } catch (fallbackError) {
      // Silently fail - this is expected when parent contains too much text
      // The note is still saved, just without visual highlight
      // Other methods (surroundContents, multi-node) should have been tried first
    }

    // Method 4: Last resort - just add marker without highlight (DISABLED)
    /*
    try {
      const marker = this.addMarker(noteId, range, warningLevel);
      this.highlights.set(noteId, {
        range,
        marker,
        element: null // No highlight element, just marker
      });
      console.warn('Highlighting failed, but marker added for note:', noteId);
    } catch (markerError) {
      console.error('Failed to add marker:', markerError);
      // Note is still saved, just without visual highlight
    }
    */
  }

  /**
   * Check if range can be safely surrounded
   */
  canSurroundRange(range) {
    try {
      // Check if range is collapsed
      if (range.collapsed) {
        return false;
      }

      // Check if start and end are in the same container
      if (range.startContainer === range.endContainer) {
        return true;
      }

      // Check if range crosses element boundaries in a way that would break surroundContents
      let node = range.startContainer;
      const endContainer = range.endContainer;
      
      // Walk up the tree to find common ancestor
      while (node && node !== endContainer) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // If we hit an element boundary, check if it's safe
          const element = node;
          if (range.startOffset > 0 || range.endOffset < (element.textContent?.length || 0)) {
            // Range doesn't fully contain the element, might be problematic
            return false;
          }
        }
        node = node.parentNode;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Add marker icon near highlighted text
   */
  addMarker(noteId, range, warningLevel = 'none') {
    try {
      if (!range || !noteId) {
        console.warn('addMarker: Invalid range or noteId');
        return null;
      }

      let rect;
      try {
        rect = range.getBoundingClientRect();
      } catch (error) {
        console.warn('addMarker: Could not get bounding rect, using fallback position');
        // Fallback position
        rect = {
          right: window.innerWidth / 2,
          top: window.innerHeight / 2,
          width: 0,
          height: 0
        };
      }

      const marker = document.createElement('span');
      marker.className = 'notes-layer-marker';
      marker.dataset.noteId = noteId;
      marker.innerHTML = '📝';
      marker.title = 'Click to view note';

      if (warningLevel !== 'none') {
        marker.innerHTML = '⚠️';
        marker.title = 'Note anchor may be inaccurate';
      }

      // Position marker
      marker.style.position = 'absolute'; // Use absolute so it scrolls with the page
      marker.style.left = `${window.scrollX + rect.right + 5}px`;
      marker.style.top = `${window.scrollY + rect.top}px`;
      marker.style.cursor = 'pointer';
      marker.style.zIndex = '10000';
      marker.style.fontSize = '14px';
      marker.style.userSelect = 'none';
      marker.style.pointerEvents = 'auto';
      marker.style.display = 'block';
      marker.style.visibility = 'visible';
      marker.style.opacity = '1';

      if (document.body) {
        // Remove marker if it already exists
        const existingMarker = document.querySelector(`.notes-layer-marker[data-note-id="${noteId}"]`);
        if (existingMarker) {
          existingMarker.remove();
        }
        
        document.body.appendChild(marker);
        console.log('addMarker: Marker added to DOM for note', noteId, 'at position', marker.style.left, marker.style.top);
      } else {
        console.warn('addMarker: document.body not available');
        // Try to add to documentElement as fallback
        if (document.documentElement) {
          document.documentElement.appendChild(marker);
          console.log('addMarker: Marker added to documentElement as fallback');
        } else {
          return null;
        }
      }

      return marker;
    } catch (error) {
      console.error('addMarker: Error creating marker:', error);
      return null;
    }
  }

  /**
   * Remove highlight
   */
  removeHighlight(noteId) {
    const highlight = this.highlights.get(noteId);
    if (highlight) {
      // Remove marker
      if (highlight.marker && highlight.marker.parentNode) {
        highlight.marker.parentNode.removeChild(highlight.marker);
      }

      // Unwrap highlight element(s)
      if (highlight.elements) {
        // Handle multi-node highlights
        highlight.elements.forEach(el => {
          if (el && el.parentNode) {
            const parent = el.parentNode;
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
          }
        });
      } else if (highlight.element && highlight.element.parentNode) {
        const parent = highlight.element.parentNode;
        while (highlight.element.firstChild) {
          parent.insertBefore(highlight.element.firstChild, highlight.element);
        }
        parent.removeChild(highlight.element);
      }

      this.highlights.delete(noteId);
    }
  }

  /**
   * Highlight text across multiple nodes by wrapping each text segment
   */
  highlightMultiNode(range, noteId, warningLevel) {
    // 1. Collect all text nodes in the range
    const textNodes = [];
    
    // Handle simple case where start and end are same
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        textNodes.push(range.startContainer);
    } else {
        // Collect nodes between start and end
        // Use a TreeWalker from commonAncestor
        const walker = document.createTreeWalker(
          range.commonAncestorContainer,
          NodeFilter.SHOW_TEXT,
          {
              acceptNode: (node) => {
                  if (range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT;
                  return NodeFilter.FILTER_REJECT;
              }
          }
        );
        
        while(walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }
    }
    
    if (textNodes.length === 0) return null;

    // 2. Wrap each part
    const highlightElements = [];
    
    // Process in reverse to avoid invalidating offsets of earlier nodes if they happen to be same (unlikely with tree walker distinct nodes, but safe)
    // Actually, for text nodes, wrapping one doesn't affect the object reference of others usually.
    
    for (const node of textNodes) {
        let start = 0;
        let end = node.textContent.length;
        
        if (node === range.startContainer) start = range.startOffset;
        if (node === range.endContainer) end = range.endOffset;
        
        // Skip empty wraps
        if (start >= end) continue;
        
        try {
            const span = document.createElement('span');
            span.className = 'notes-layer-highlight';
            span.dataset.noteId = noteId;
             if (warningLevel === 'yellow') {
                span.classList.add('notes-layer-warning-yellow');
            } else if (warningLevel === 'red') {
                span.classList.add('notes-layer-warning-red');
            }
            
            const rangePart = document.createRange();
            rangePart.setStart(node, start);
            rangePart.setEnd(node, end);
            rangePart.surroundContents(span);
            highlightElements.push(span);
        } catch (e) {
            console.warn('Failed to wrap node part', e);
        }
    }
    
    return highlightElements;
  }

  /**
   * Restore highlights for notes
   */
  async restoreHighlights(notes, anchors) {
    console.log('Highlighter: Restoring highlights', { notesCount: notes.length, anchorsCount: anchors.length });
    
    // Clear existing highlights
    for (const noteId of this.highlights.keys()) {
      this.removeHighlight(noteId);
    }

    // Create anchor map
    const anchorMap = new Map();
    anchors.forEach(anchor => {
      anchorMap.set(anchor.id, anchor);
    });

    let restoredCount = 0;
    let failedCount = 0;

    // Ensure document body is ready
    if (!document.body) {
      console.warn('Highlighter: document.body not ready, waiting...');
      await new Promise(resolve => {
        const checkBody = setInterval(() => {
          if (document.body) {
            clearInterval(checkBody);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkBody);
          resolve();
        }, 2000);
      });
    }

    // Restore each note
    for (const note of notes) {
      const anchor = anchorMap.get(note.anchorId);
      if (!anchor) {
        // Silently skip - anchor might have been deleted
        failedCount++;
        continue;
      }

      try {
        // Use AnchorManager (loaded before this script)
        const result = AnchorManager.restoreAnchor(anchor);

        if (result.range) {
          // Verify range is valid
          try {
            const rect = result.range.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              this.highlightText(result.range, note.id, note.warningLevel || result.warningLevel);
              restoredCount++;
              console.log('Highlighter: Restored highlight for note', note.id, 'warningLevel:', result.warningLevel, 'text:', anchor.text);
            } else {
              // Range has zero dimensions - silently skip
              failedCount++;
            }
          } catch (rangeError) {
            // Invalid range - silently skip (expected for dynamic content)
            failedCount++;
          }
        } else {
          // Silently fail - this is expected for dynamic pages or changed content
          // Note is still saved and accessible, just without visual highlight
          failedCount++;
        }
      } catch (error) {
        // Silently skip errors during restoration (expected for dynamic pages)
        failedCount++;
      }
    }

    console.log('Highlighter: Restoration complete', { restored: restoredCount, failed: failedCount, total: notes.length });
    
    // Check if this is a Copilot page for longer delays
    const isCopilot = typeof AnchorManager !== 'undefined' && AnchorManager.isCopilotPage();
    
    // Update marker positions after a short delay to ensure layout is stable
    // For Copilot, wait longer as content loads dynamically
    const firstDelay = isCopilot ? 800 : 300;
    const secondDelay = isCopilot ? 2000 : 1000;
    
    setTimeout(() => {
      this.updateMarkerPositions();
    }, firstDelay);
    
    // Also update after a longer delay for dynamic content
    setTimeout(() => {
      this.updateMarkerPositions();
    }, secondDelay);
    
    // For Copilot, add one more update after even longer delay
    if (isCopilot) {
      setTimeout(() => {
        this.updateMarkerPositions();
      }, 4000);
    }
  }

  /**
   * Update positions of all markers (useful after page load or scroll)
   * Deprecated: Markers are no longer used, highlighting is inline
   */
  updateMarkerPositions() {
    // No-op
  }

  /**
   * Get highlight by note ID
   */
  getHighlight(noteId) {
    return this.highlights.get(noteId);
  }

  /**
   * Clear all highlights
   */
  clearAll() {
    for (const noteId of this.highlights.keys()) {
      this.removeHighlight(noteId);
    }
  }
}
