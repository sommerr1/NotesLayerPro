// Anchor management: creating and restoring anchors

class AnchorManager {
  /**
   * Check if current page is Copilot (GitHub Copilot, Microsoft Copilot, etc.)
   */
  static isCopilotPage() {
    const hostname = window.location.hostname.toLowerCase();
    const url = window.location.href.toLowerCase();
    
    // Check for various Copilot services
    return hostname.includes('copilot') || 
           hostname.includes('github.com') && url.includes('copilot') ||
           hostname.includes('bing.com') && url.includes('copilot') ||
           hostname.includes('microsoft.com') && url.includes('copilot') ||
           document.querySelector('[data-copilot], .copilot, #copilot, [aria-label*="Copilot"]') !== null;
  }
  /**
   * Create anchor from text selection
   */
  static createAnchor(selection) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();

    if (!text) {
      return null;
    }

    // Get container element
    const container = range.commonAncestorContainer;
    const containerElement = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container;

    // Get context (30-50 characters left and right)
    const containerText = containerElement.textContent || '';
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    
    // Find text position in container
    let textPosition = 0;
    const walker = document.createTreeWalker(
      containerElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while (node = walker.nextNode()) {
      if (node === range.startContainer) {
        textPosition += startOffset;
        break;
      }
      textPosition += node.textContent.length;
    }

    const contextLeft = containerText.substring(
      Math.max(0, textPosition - 50),
      textPosition
    ).trim();
    
    const contextRight = containerText.substring(
      textPosition + text.length,
      Math.min(containerText.length, textPosition + text.length + 50)
    ).trim();

    // Generate DOM path
    const domPath = this.generateDOMPath(range.startContainer);

    // Calculate relative coordinates
    const rect = range.getBoundingClientRect();
    const containerRect = containerElement.getBoundingClientRect();
    const coords = {
      xPercent: ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100,
      yPercent: ((rect.top + rect.height / 2 - containerRect.top) / containerRect.height) * 100
    };

    return {
      text,
      contextLeft,
      contextRight,
      domPath,
      coords,
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset
    };
  }

  /**
   * Generate DOM path for an element
   */
  static generateDOMPath(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (!node) {
      return '';
    }

    const path = [];
    let current = node;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      } else {
        // Add index if there are siblings with same tag
        const siblings = Array.from(current.parentElement?.children || [])
          .filter(el => el.tagName === current.tagName);
        
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          selector += `:nth-of-type(${index + 1})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Restore anchor on page
   * Returns: { range, warningLevel }
   */
  static restoreAnchor(anchor) {
    if (!anchor || !anchor.text) {
      console.warn('restoreAnchor: Invalid anchor data');
      return { range: null, warningLevel: 'red' };
    }

    // Special handling for Copilot pages
    if (this.isCopilotPage()) {
      return this.restoreAnchorForCopilot(anchor);
    }

    // Standard restoration for other pages
    // Strategy 1: Text match (exact) - try with context first
    let exactMatch = this.findTextMatch(anchor.text, anchor.contextLeft, anchor.contextRight);
    if (exactMatch) {
      return { range: exactMatch, warningLevel: 'none' };
    }

    // Strategy 1b: Text match without context (text might have moved)
    exactMatch = this.findTextMatch(anchor.text, '', '');
    if (exactMatch) {
      return { range: exactMatch, warningLevel: 'yellow' };
    }

    // Strategy 2: Fuzzy match (text + context)
    let fuzzyMatch = this.findFuzzyMatch(anchor.text, anchor.contextLeft, anchor.contextRight);
    if (fuzzyMatch) {
      return { range: fuzzyMatch, warningLevel: 'yellow' };
    }

    // Strategy 2b: Fuzzy match without context
    fuzzyMatch = this.findFuzzyMatch(anchor.text, '', '');
    if (fuzzyMatch) {
      return { range: fuzzyMatch, warningLevel: 'yellow' };
    }

    // Strategy 3: DOM match
    if (anchor.domPath) {
      const domMatch = this.findDOMMatch(anchor.domPath);
      if (domMatch) {
        return { range: domMatch, warningLevel: 'red' };
      }
    }

    // Strategy 4: Coordinates fallback
    if (anchor.coords) {
      const coordsMatch = this.findCoordsMatch(anchor.coords, anchor.text);
      if (coordsMatch) {
        return { range: coordsMatch, warningLevel: 'red' };
      }
    }

    // Strategy 5: Search for text anywhere on page (last resort)
    const anywhereMatch = this.findTextAnywhere(anchor.text);
    if (anywhereMatch) {
      return { range: anywhereMatch, warningLevel: 'red' };
    }

    return { range: null, warningLevel: 'red' };
  }

  /**
   * Restore anchor specifically optimized for Copilot pages
   * Uses multiple strategies with longer waits and more aggressive searching
   */
  static restoreAnchorForCopilot(anchor) {
    console.log('AnchorManager: Using Copilot-optimized restoration for text:', anchor.text);
    
    // Strategy 1: Find in Copilot-specific containers (chat messages, code blocks, etc.)
    const copilotMatch = this.findInCopilotContainers(anchor.text, anchor.contextLeft, anchor.contextRight);
    if (copilotMatch) {
      console.log('AnchorManager: Found in Copilot containers');
      return { range: copilotMatch, warningLevel: 'none' };
    }

    // Strategy 1.5: Cross-node search (handles split text nodes common in AI streaming)
    const crossNodeMatch = this.findTextAcrossNodes(document.body, anchor.text, anchor.contextLeft, anchor.contextRight);
    if (crossNodeMatch) {
      console.log('AnchorManager: Found with cross-node search');
      return { range: crossNodeMatch, warningLevel: 'yellow' };
    }

    // Strategy 2: Exact text match with extended context (Copilot often has longer context)
    let exactMatch = this.findTextMatchExtended(anchor.text, anchor.contextLeft, anchor.contextRight, 100);
    if (exactMatch) {
      console.log('AnchorManager: Found with extended context');
      return { range: exactMatch, warningLevel: 'none' };
    }

    // Strategy 3: Exact text match without context (text might have moved in chat)
    exactMatch = this.findTextMatch(anchor.text, '', '');
    if (exactMatch) {
      console.log('AnchorManager: Found without context');
      return { range: exactMatch, warningLevel: 'yellow' };
    }

    // Strategy 4: Fuzzy match with lower threshold for Copilot (more forgiving)
    let fuzzyMatch = this.findFuzzyMatchCopilot(anchor.text, anchor.contextLeft, anchor.contextRight);
    if (fuzzyMatch) {
      console.log('AnchorManager: Found with fuzzy match');
      return { range: fuzzyMatch, warningLevel: 'yellow' };
    }

    // Strategy 5: Search in all visible text nodes (Copilot has dynamic content)
    const visibleMatch = this.findInVisibleText(anchor.text);
    if (visibleMatch) {
      console.log('AnchorManager: Found in visible text');
      return { range: visibleMatch, warningLevel: 'yellow' };
    }

    // Strategy 6: DOM match with retries (Copilot DOM changes frequently)
    if (anchor.domPath) {
      const domMatch = this.findDOMMatchWithRetry(anchor.domPath, anchor.text);
      if (domMatch) {
        console.log('AnchorManager: Found via DOM path');
        return { range: domMatch, warningLevel: 'red' };
      }
    }

    // Strategy 7: Search anywhere (last resort)
    const anywhereMatch = this.findTextAnywhere(anchor.text);
    if (anywhereMatch) {
      console.log('AnchorManager: Found anywhere on page');
      return { range: anywhereMatch, warningLevel: 'red' };
    }

    console.warn('AnchorManager: Could not restore anchor for Copilot, text:', anchor.text);
    return { range: null, warningLevel: 'red' };
  }

  /**
   * Find text in Copilot-specific containers (chat messages, code blocks, etc.)
   */
  static findInCopilotContainers(text, contextLeft, contextRight) {
    if (!document.body) return null;

    // Common Copilot container selectors
    const copilotSelectors = [
      '[role="log"]', // Chat log
      '[role="article"]', // Chat messages
      '.markdown-body', // Markdown content
      'pre code', // Code blocks
      '[data-testid*="message"]', // Message containers
      '[class*="message"]', // Message classes
      '[class*="chat"]', // Chat containers
      '[class*="copilot"]', // Copilot-specific
      'main', // Main content area
      '[role="main"]' // Main role
    ];

    for (const selector of copilotSelectors) {
      try {
        const containers = document.querySelectorAll(selector);
        for (const container of containers) {
          // Try cross-node search first as it's more robust for split nodes
          const match = this.findTextAcrossNodes(container, text, contextLeft, contextRight);
          if (match) {
            return match;
          }
          
          // Fallback to simple container search
          const simpleMatch = this.findTextInContainer(container, text, contextLeft, contextRight);
          if (simpleMatch) {
            return simpleMatch;
          }
        }
      } catch (error) {
        // Skip invalid selectors
        continue;
      }
    }

    return null;
  }

  /**
   * Find text across multiple nodes (handles split text nodes)
   */
  static findTextAcrossNodes(container, text, contextLeft, contextRight) {
    if (!container || !text) return null;

    try {
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Only skip if parent is hidden
            const element = node.parentElement;
            if (element) {
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_REJECT;
              }
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      let fullText = '';
      const nodeMap = [];

      while (node = walker.nextNode()) {
        const nodeText = node.textContent;
        // Keep track of where each node's text starts in the full string
        nodeMap.push({
            node,
            start: fullText.length,
            length: nodeText.length
        });
        fullText += nodeText;
      }

      const index = fullText.indexOf(text);
      
      if (index !== -1) {
          // Check context
          let contextMatch = true;
          if (contextLeft || contextRight) {
            const beforeText = fullText.substring(Math.max(0, index - 100), index).trim();
            const afterText = fullText.substring(
              index + text.length,
              Math.min(fullText.length, index + text.length + 100)
            ).trim();

            contextMatch = 
              (!contextLeft || beforeText.includes(contextLeft.slice(-30)) || contextLeft.length === 0) &&
              (!contextRight || afterText.includes(contextRight.slice(0, 30)) || contextRight.length === 0);
          }

          if (contextMatch || (!contextLeft && !contextRight)) {
            // Map back to nodes
            const startMap = nodeMap.find(m => index >= m.start && index < m.start + m.length);
            // For end node, be careful with exact boundary
            // The text ends at index + text.length
            // We want the node that contains the character at (endIndex - 1)
            const endIndex = index + text.length;
            const endMap = nodeMap.find(m => endIndex > m.start && endIndex <= m.start + m.length);
            
            // Special case: if endIndex is exactly at the start of a new node (unlikely with > m.start)
            // or if the text spans exactly to the end of a node.

            if (startMap && endMap) {
                const range = document.createRange();
                range.setStart(startMap.node, index - startMap.start);
                range.setEnd(endMap.node, endIndex - endMap.start);
                return range;
            }
          }
      }
      
      return null;
    } catch (e) {
        console.warn('findTextAcrossNodes error:', e);
        return null;
    }
  }

  /**
   * Find text in a specific container
   */
  static findTextInContainer(container, text, contextLeft, contextRight) {
    if (!container || !text) return null;

    try {
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;

          const index = nodeText.indexOf(text);
          if (index !== -1) {
            // Check context if available
            let contextMatch = true;
            if (contextLeft || contextRight) {
              const beforeText = nodeText.substring(Math.max(0, index - 100), index).trim();
              const afterText = nodeText.substring(
                index + text.length,
                Math.min(nodeText.length, index + text.length + 100)
              ).trim();

              contextMatch = 
                (!contextLeft || beforeText.includes(contextLeft.slice(-30)) || contextLeft.length === 0) &&
                (!contextRight || afterText.includes(contextRight.slice(0, 30)) || contextRight.length === 0);
            }

            if (contextMatch || !contextLeft && !contextRight) {
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + text.length);
              return range;
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  /**
   * Find text match with extended context window
   */
  static findTextMatchExtended(text, contextLeft, contextRight, contextSize = 100) {
    if (!text || !document.body) return null;

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;

          const index = nodeText.indexOf(text);
          if (index !== -1) {
            let contextMatch = true;
            if (contextLeft || contextRight) {
              const beforeText = nodeText.substring(Math.max(0, index - contextSize), index).trim();
              const afterText = nodeText.substring(
                index + text.length,
                Math.min(nodeText.length, index + text.length + contextSize)
              ).trim();

              contextMatch = 
                (!contextLeft || beforeText.includes(contextLeft.slice(-30)) || contextLeft.length === 0) &&
                (!contextRight || afterText.includes(contextRight.slice(0, 30)) || contextRight.length === 0);
            }

            if (contextMatch) {
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + text.length);
              return range;
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      console.error('findTextMatchExtended: Error:', error);
    }

    return null;
  }

  /**
   * Fuzzy match optimized for Copilot (more forgiving)
   */
  static findFuzzyMatchCopilot(text, contextLeft, contextRight) {
    if (!text || !document.body) return null;

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      const matches = [];

      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;

          const nodeTextLower = nodeText.toLowerCase();
          const searchText = text.toLowerCase();

          // Try to find similar text with lower threshold (0.6 instead of 0.7)
          for (let i = 0; i <= nodeTextLower.length - searchText.length; i++) {
            const substring = nodeTextLower.substring(i, i + searchText.length);
            const similarity = this.calculateSimilarity(substring, searchText);

            if (similarity > 0.6) { // Lower threshold for Copilot
              const beforeText = nodeTextLower.substring(Math.max(0, i - 50), i);
              const afterText = nodeTextLower.substring(
                i + searchText.length,
                Math.min(nodeTextLower.length, i + searchText.length + 50)
              );

              const contextMatch = 
                (!contextLeft || beforeText.includes(contextLeft.toLowerCase().slice(-20)) || contextLeft.length === 0) &&
                (!contextRight || afterText.includes(contextRight.toLowerCase().slice(0, 20)) || contextRight.length === 0);

              if (contextMatch || !contextLeft && !contextRight) {
                try {
                  const range = document.createRange();
                  range.setStart(node, i);
                  range.setEnd(node, i + text.length);
                  matches.push({ range, similarity, contextMatch });
                } catch (rangeError) {
                  continue;
                }
              }
            }
          }
        } catch (error) {
          continue;
        }
      }

      if (matches.length > 0) {
        matches.sort((a, b) => {
          if (a.contextMatch && !b.contextMatch) return -1;
          if (!a.contextMatch && b.contextMatch) return 1;
          return b.similarity - a.similarity;
        });
        return matches[0].range;
      }
    } catch (error) {
      console.error('findFuzzyMatchCopilot: Error:', error);
    }

    return null;
  }

  /**
   * Find text only in visible elements (for dynamic content like Copilot)
   */
  static findInVisibleText(text) {
    if (!text || !document.body) return null;

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Only check visible text nodes
            const element = node.parentElement;
            if (!element) return NodeFilter.FILTER_REJECT;
            
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return NodeFilter.FILTER_REJECT;
            }
            
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;

          const index = nodeText.indexOf(text);
          if (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + text.length);
            return range;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      console.error('findInVisibleText: Error:', error);
    }

    return null;
  }

  /**
   * Find DOM match with retry logic (for dynamic DOM like Copilot)
   */
  static findDOMMatchWithRetry(domPath, text) {
    // Try standard DOM match first
    let match = this.findDOMMatch(domPath);
    if (match) return match;

    // Try with partial path (remove last few selectors)
    const selectors = domPath.split(' > ');
    for (let i = selectors.length - 1; i > 0; i--) {
      const partialPath = selectors.slice(0, i).join(' > ');
      match = this.findDOMMatch(partialPath);
      if (match) {
        // Try to find text within the range's container
        const container = match.commonAncestorContainer || 
                         (match.startContainer.nodeType === Node.TEXT_NODE ? match.startContainer.parentElement : match.startContainer);
        if (container) {
          const textMatch = this.findTextInContainer(container, text, '', '');
          if (textMatch) return textMatch;
        }
      }
    }

    return null;
  }

  /**
   * Find text anywhere on the page (last resort)
   */
  static findTextAnywhere(text) {
    if (!text || !document.body) {
      return null;
    }

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;
          
          const index = nodeText.indexOf(text);
          if (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + text.length);
            return range;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      console.error('findTextAnywhere: Error:', error);
    }

    return null;
  }

  /**
   * Find exact text match
   */
  static findTextMatch(text, contextLeft, contextRight) {
    if (!text || !document.body) {
      return null;
    }

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      const matches = [];
      
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;
          
          // Find all occurrences of text in this node
          let searchIndex = 0;
          while ((searchIndex = nodeText.indexOf(text, searchIndex)) !== -1) {
            // Check context if available
            let contextMatch = true;
            if (contextLeft || contextRight) {
              const beforeText = nodeText.substring(Math.max(0, searchIndex - 50), searchIndex).trim();
              const afterText = nodeText.substring(
                searchIndex + text.length,
                Math.min(nodeText.length, searchIndex + text.length + 50)
              ).trim();

              contextMatch = 
                (!contextLeft || beforeText.includes(contextLeft.slice(-20)) || contextLeft.length === 0) &&
                (!contextRight || afterText.includes(contextRight.slice(0, 20)) || contextRight.length === 0);
            }

            if (contextMatch) {
              try {
                const range = document.createRange();
                range.setStart(node, searchIndex);
                range.setEnd(node, searchIndex + text.length);
                matches.push({ range, contextMatch: true });
              } catch (rangeError) {
                // Skip invalid range
                console.warn('findTextMatch: Error creating range:', rangeError);
              }
            }
            
            searchIndex += text.length;
          }
        } catch (error) {
          // Skip nodes that cause errors
          continue;
        }
      }

      // Return first match with context, or first match without context
      if (matches.length > 0) {
        const contextMatch = matches.find(m => m.contextMatch);
        return contextMatch ? contextMatch.range : matches[0].range;
      }
    } catch (error) {
      console.error('findTextMatch: Error during search:', error);
    }

    return null;
  }

  /**
   * Find fuzzy text match
   */
  static findFuzzyMatch(text, contextLeft, contextRight) {
    if (!text || !document.body) {
      return null;
    }

    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      const matches = [];
      
      while (node = walker.nextNode()) {
        try {
          const nodeText = node.textContent;
          if (!nodeText) continue;
          
          const nodeTextLower = nodeText.toLowerCase();
          const searchText = text.toLowerCase();

          // Try to find similar text
          for (let i = 0; i <= nodeTextLower.length - searchText.length; i++) {
            const substring = nodeTextLower.substring(i, i + searchText.length);
            const similarity = this.calculateSimilarity(substring, searchText);

            if (similarity > 0.7) { // Lowered threshold from 0.8 to 0.7
              // Check context
              const beforeText = nodeTextLower.substring(Math.max(0, i - 30), i);
              const afterText = nodeTextLower.substring(
                i + searchText.length,
                Math.min(nodeTextLower.length, i + searchText.length + 30)
              );

              const contextMatch = 
                (!contextLeft || beforeText.includes(contextLeft.toLowerCase().slice(-15)) || contextLeft.length === 0) &&
                (!contextRight || afterText.includes(contextRight.toLowerCase().slice(0, 15)) || contextRight.length === 0);

              if (contextMatch || !contextLeft && !contextRight) {
                try {
                  const range = document.createRange();
                  range.setStart(node, i);
                  range.setEnd(node, i + text.length);
                  matches.push({ range, similarity, contextMatch });
                } catch (rangeError) {
                  // Skip invalid range
                  continue;
                }
              }
            }
          }
        } catch (error) {
          // Skip nodes that cause errors
          continue;
        }
      }

      // Return best match (highest similarity with context)
      if (matches.length > 0) {
        matches.sort((a, b) => {
          if (a.contextMatch && !b.contextMatch) return -1;
          if (!a.contextMatch && b.contextMatch) return 1;
          return b.similarity - a.similarity;
        });
        return matches[0].range;
      }
    } catch (error) {
      console.error('findFuzzyMatch: Error during search:', error);
    }

    return null;
  }

  /**
   * Calculate string similarity (simple Levenshtein-based)
   */
  static calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  static levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Find element by DOM path
   */
  static findDOMMatch(domPath) {
    if (!domPath || !document.body) {
      return null;
    }

    try {
      const selectors = domPath.split(' > ').filter(s => s.trim());
      if (selectors.length === 0) {
        return null;
      }

      let element = document.body;

      for (let i = 0; i < selectors.length; i++) {
        const selector = selectors[i].trim();
        if (!selector || !element) {
          return null;
        }

        try {
          // Handle nth-of-type
          if (selector.includes(':nth-of-type')) {
            const match = selector.match(/^([^:]+):nth-of-type\((\d+)\)$/);
            if (match) {
              const tag = match[1].toLowerCase();
              const index = parseInt(match[2]) - 1;
              
              if (index < 0) {
                return null;
              }
              
              const children = Array.from(element.children || [])
                .filter(el => el.tagName && el.tagName.toLowerCase() === tag);
              
              if (children[index]) {
                element = children[index];
              } else {
                // Try partial match - find any element with this tag
                const allWithTag = Array.from(element.querySelectorAll(tag));
                if (allWithTag[index]) {
                  element = allWithTag[index];
                } else {
                  return null;
                }
              }
            } else {
              return null;
            }
          } else {
            // Try direct querySelector
            try {
              const found = element.querySelector(selector);
              if (found) {
                element = found;
              } else {
                // Try to find by tag name only if selector is just a tag
                if (/^[a-z][a-z0-9]*$/i.test(selector)) {
                  const byTag = element.querySelector(selector);
                  if (byTag) {
                    element = byTag;
                  } else {
                    return null;
                  }
                } else {
                  return null;
                }
              }
            } catch (queryError) {
              // Invalid selector, try to continue with next part
              console.warn('findDOMMatch: Invalid selector:', selector, queryError);
              if (i === selectors.length - 1) {
                // Last selector, try to use current element
                break;
              }
              return null;
            }
          }
        } catch (stepError) {
          console.warn('findDOMMatch: Error at step', i, 'selector:', selector, stepError);
          // Try to continue with partial path
          if (i === selectors.length - 1 && element) {
            break;
          }
          return null;
        }
      }

      if (element && element.textContent) {
        try {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range;
        } catch (rangeError) {
          console.warn('findDOMMatch: Error creating range:', rangeError);
          return null;
        }
      }
    } catch (error) {
      console.error('Error finding DOM match:', error);
      // Don't log DOMException details as they're not helpful
      if (!(error instanceof DOMException)) {
        console.error('Error details:', error.message, error.stack);
      }
    }

    return null;
  }

  /**
   * Find text near coordinates
   */
  static findCoordsMatch(coords, text) {
    if (!coords) {
      return null;
    }

    // Find container element at coordinates
    const elements = document.elementsFromPoint(
      window.innerWidth * (coords.xPercent / 100),
      window.innerHeight * (coords.yPercent / 100)
    );

    for (const element of elements) {
      if (element.textContent && element.textContent.includes(text)) {
        const index = element.textContent.indexOf(text);
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        let currentIndex = 0;
        while (node = walker.nextNode()) {
          if (currentIndex + node.textContent.length >= index) {
            const range = document.createRange();
            const offset = index - currentIndex;
            range.setStart(node, offset);
            range.setEnd(node, offset + text.length);
            return range;
          }
          currentIndex += node.textContent.length;
        }
      }
    }

    return null;
  }
}
