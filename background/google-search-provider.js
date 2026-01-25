// Google Search provider for AI answers (Gemini)

import { LLMProvider } from './llm-provider.js';

export class GoogleSearchProvider extends LLMProvider {
  /**
   * Generate random delay to mimic human behavior
   */
  static randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Ask a question via Google Search and parse Gemini answer
   */
  async askQuestion(question) {
    const query = encodeURIComponent(`Кратко и понятно объясни: ${question}`);
    // Use google.com/ai for direct AI mode access
    const searchUrl = `https://www.google.com/ai?q=${query}`;

    return new Promise((resolve, reject) => {
      // Solution 2: Create a visible tab briefly to mimic human behavior
      // Then hide it after a short delay
      chrome.tabs.create({
        url: searchUrl,
        active: true // Start as visible
      }, (tab) => {
        // Solution 1 & 3: Add random delay before hiding (mimic human behavior)
        const hideDelay = GoogleSearchProvider.randomDelay(500, 1500);
        setTimeout(() => {
          chrome.tabs.update(tab.id, { active: false });
        }, hideDelay);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Solution 1 & 3: Wait for page to load with variable delays
        let attempts = 0;
        const maxAttempts = 30; // 15 seconds total with variable delays
        
        const checkComplete = () => {
          attempts++;
          
          chrome.tabs.get(tab.id, (currentTab) => {
            if (chrome.runtime.lastError) {
              chrome.tabs.remove(tab.id);
              reject(new Error('EXTENSION_ERROR: Вкладка была закрыта неожиданно. Попробуйте еще раз.'));
              return;
            }

            if (currentTab.status === 'complete' || attempts >= maxAttempts) {
              // Check if we're on the right page (not redirected)
              if (!currentTab.url || (!currentTab.url.includes('google.com/ai') && !currentTab.url.includes('google.com/search'))) {
                // Check if redirected to captcha or blocked page
                if (currentTab.url && (currentTab.url.includes('sorry') || currentTab.url.includes('captcha') || currentTab.url.includes('blocked'))) {
                  chrome.tabs.remove(tab.id);
                  reject(new Error('GOOGLE_BLOCKED: Google заблокировал автоматический запрос. Пожалуйста, попробуйте позже или используйте другой вопрос.'));
                  return;
                }
                chrome.tabs.remove(tab.id);
                reject(new Error('REDIRECT_ERROR: Google Search перенаправил на другую страницу. Попробуйте еще раз или переформулируйте вопрос.'));
                return;
              }

              // Solution 1: Add random delay before extraction (mimic human reading time)
              const readDelay = GoogleSearchProvider.randomDelay(2000, 4000);
              setTimeout(() => {
                // Solution 1: Simulate human behavior - scroll and interact
                chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: GoogleSearchProvider.simulateHumanBehavior
                }, () => {
                  // Solution 1 & 3: Add random delay after human simulation
                  const behaviorDelay = GoogleSearchProvider.randomDelay(1000, 2000);
                  setTimeout(() => {
                    // First, try to activate AI mode
                    chrome.scripting.executeScript({
                      target: { tabId: tab.id },
                      func: GoogleSearchProvider.activateAIMode
                    }, (activateResults) => {
                      // Solution 1 & 3: Wait longer for AI mode with random delay
                      const aiLoadDelay = GoogleSearchProvider.randomDelay(4000, 6000);
                      setTimeout(() => {
                        // Try multiple times with increasing delays
                        let extractAttempts = 0;
                        const maxExtractAttempts = 5; // Increased attempts for AI mode
                        
                        const tryExtract = () => {
                          extractAttempts++;
                          
                          // Inject script to extract AI answer
                          chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: GoogleSearchProvider.extractAIAnswer
                          }, (results) => {
                            if (chrome.runtime.lastError) {
                              if (extractAttempts < maxExtractAttempts) {
                                // Solution 3: Retry after random delay
                                const retryDelay = GoogleSearchProvider.randomDelay(1500, 3000);
                                setTimeout(tryExtract, retryDelay);
                                return;
                              }
                              chrome.tabs.remove(tab.id);
                              reject(new Error(`EXTRACTION_ERROR: ${chrome.runtime.lastError.message}`));
                              return;
                            }

                            if (results && results[0] && results[0].result) {
                              // Try to capture screenshot as well
                              GoogleSearchProvider.captureAnswerScreenshot(tab.id)
                                .then(screenshot => {
                                  chrome.tabs.remove(tab.id);
                                  // Return both text and screenshot
                                  resolve({
                                    text: results[0].result,
                                    screenshot: screenshot
                                  });
                                })
                                .catch(() => {
                                  // If screenshot fails, just return text
                                  chrome.tabs.remove(tab.id);
                                  resolve({
                                    text: results[0].result,
                                    screenshot: null
                                  });
                                });
                            } else if (extractAttempts < maxExtractAttempts) {
                              // Solution 3: Retry extraction after random delay
                              const retryDelay = GoogleSearchProvider.randomDelay(2000, 4000);
                              setTimeout(tryExtract, retryDelay);
                            } else {
                              // Final attempt - try to get at least first search result as fallback
                              chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                func: GoogleSearchProvider.extractFirstResult
                              }, (fallbackResults) => {
                                chrome.tabs.remove(tab.id);
                                
                                if (fallbackResults && fallbackResults[0] && fallbackResults[0].result) {
                                  // Try to capture screenshot as fallback
                                  GoogleSearchProvider.captureAnswerScreenshot(tab.id)
                                    .then(screenshot => {
                                      chrome.tabs.remove(tab.id);
                                      resolve({
                                        text: fallbackResults[0].result,
                                        screenshot: screenshot
                                      });
                                    })
                                    .catch(() => {
                                      chrome.tabs.remove(tab.id);
                                      resolve({
                                        text: fallbackResults[0].result,
                                        screenshot: null
                                      });
                                    });
                                } else {
                                  reject(new Error('EXTRACTION_FAILED: Не удалось извлечь ответ из Google Search. Возможные причины:\n• Google заблокировал автоматический запрос\n• Вопрос слишком сложный\n• Страница не загрузилась полностью\n\nПопробуйте переформулировать вопрос или использовать более простой запрос.'));
                                }
                              });
                            }
                          });
                        };
                        
                        tryExtract();
                      }, aiLoadDelay);
                    });
                  }, behaviorDelay);
                });
              }, readDelay);
            } else {
              // Solution 3: Variable delay between checks
              const checkDelay = GoogleSearchProvider.randomDelay(400, 700);
              setTimeout(checkComplete, checkDelay);
            }
          });
        };

        // Solution 1 & 3: Start checking after random delay
        const initialDelay = GoogleSearchProvider.randomDelay(2000, 4000);
        setTimeout(checkComplete, initialDelay);
      });
    });
  }

  /**
   * Capture screenshot of AI answer area
   */
  static async captureAnswerScreenshot(tabId) {
    return new Promise((resolve, reject) => {
      // First, get the coordinates of the answer area
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: GoogleSearchProvider.getAnswerAreaBounds
      }, (boundsResult) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const bounds = boundsResult && boundsResult[0] && boundsResult[0].result;
        
        // Make tab visible temporarily for screenshot
        chrome.tabs.update(tabId, { active: true }, () => {
          // Wait a bit for tab to become visible
          setTimeout(() => {
            // Capture visible tab
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
              // Hide tab again
              chrome.tabs.update(tabId, { active: false });
              
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              if (!dataUrl) {
                reject(new Error('Failed to capture screenshot'));
                return;
              }

              // Return full screenshot (cropping can be done client-side if needed)
              // For now, we return the full screenshot which includes the answer area
              resolve(dataUrl);
            });
          }, 500);
        });
      });
    });
  }

  /**
   * Get bounds of AI answer area
   * This function runs in the context of the Google Search page
   */
  static getAnswerAreaBounds() {
    // Try to find AI answer container
    const aiSelectors = [
      '[jsname="coFSxe"]',
      '[jscontroller="LqPFqc"]',
      '[data-ce-elrc]',
      'section[data-ck*="aim"]',
      'div[data-gcid]',
      '.AIr7Nd',
      '.LGOjhe',
      '[data-ved] .MjjYud'
    ];

    for (const selector of aiSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              x: Math.max(0, rect.left),
              y: Math.max(0, rect.top + window.scrollY),
              width: rect.width,
              height: rect.height
            };
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // Fallback: return main content area
    const main = document.querySelector('main, [role="main"], #main, #search') || document.body;
    const rect = main.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top + window.scrollY),
      width: rect.width,
      height: Math.min(rect.height, 2000) // Limit height
    };
  }

  /**
   * Crop screenshot to specific bounds
   * Note: This needs to run in a context with DOM access (content script)
   * For now, we'll return the full screenshot and crop can be done client-side if needed
   */
  static cropScreenshot(dataUrl, bounds) {
    // For service worker, we can't use canvas directly
    // Return full screenshot for now, cropping can be done in content script if needed
    return Promise.resolve(dataUrl);
  }

  /**
   * Simulate human behavior to avoid detection
   * This function runs in the context of the Google Search page
   */
  static simulateHumanBehavior() {
    // Solution 1: Simulate human-like scrolling and mouse movements
    try {
      // Small random scroll
      const scrollAmount = Math.random() * 200 + 100;
      window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
      });
      
      // Wait a bit
      setTimeout(() => {
        // Scroll back a bit
        window.scrollBy({
          top: -scrollAmount / 2,
          behavior: 'smooth'
        });
      }, 500 + Math.random() * 500);
    } catch (e) {
      // Ignore errors
    }
  }

  /**
   * Activate AI mode in Google Search
   * This function runs in the context of the Google Search page
   */
  static activateAIMode() {
    // Helper function to check if element is AI-related
    const isAIModeElement = (element) => {
      const text = (element.textContent || element.innerText || '').toLowerCase();
      const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
      const title = (element.getAttribute('title') || '').toLowerCase();
      const id = (element.getAttribute('id') || '').toLowerCase();
      const className = (element.getAttribute('class') || '').toLowerCase();
      
      const aiKeywords = ['ai', 'ии', 'overview', 'обзор', 'gemini', 'sge'];
      const allText = `${text} ${ariaLabel} ${title} ${id} ${className}`.toLowerCase();
      
      return aiKeywords.some(keyword => allText.includes(keyword));
    };

    // Method 1: Try specific selectors for AI mode button
    const aiModeSelectors = [
      // Common AI Overview buttons
      'button[aria-label*="AI Overview"]',
      'button[aria-label*="Обзор ИИ"]',
      'button[aria-label*="AI"]',
      'a[aria-label*="AI Overview"]',
      'a[aria-label*="Обзор ИИ"]',
      // Tab/button elements
      'button[data-ved]',
      'a[data-ved]',
      // Specific classes that might indicate AI mode
      '.AIr7Nd',
      '[data-ved*="AI"]',
      // Search result header buttons
      '#search header button',
      '#search header a',
      '.MUFPAc button',
      '.MUFPAc a'
    ];

    // Try clicking on AI mode button using selectors
    for (const selector of aiModeSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (isAIModeElement(element)) {
            // Scroll element into view
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Wait a bit and click
            setTimeout(() => {
              element.click();
            }, 100);
            return true;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Method 2: Search all buttons and links for AI-related text
    try {
      const allClickable = document.querySelectorAll('button, a[role="button"], a[href]');
      for (const element of allClickable) {
        if (isAIModeElement(element)) {
          // Check if it's visible and clickable
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
              element.click();
            }, 100);
            return true;
          }
        }
      }
    } catch (e) {
      // Fall through
    }

    // Method 3: Try URL-based approach
    try {
      const currentUrl = window.location.href;
      // Check if AI mode is already active
      if (currentUrl.includes('udm=14')) {
        return true; // Already in AI mode
      }
      
      // Try to add AI parameter
      const url = new URL(currentUrl);
      url.searchParams.set('udm', '14'); // Google's AI search parameter
      // Don't navigate immediately, return false to let extraction try anyway
      // The URL approach might not work due to Google's restrictions
    } catch (e) {
      // URL manipulation failed
    }

    return false; // Could not activate AI mode (but extraction might still work)
  }

  /**
   * Extract AI answer from Google Search page
   * This function runs in the context of the Google Search page
   */
  static extractAIAnswer() {
    // Helper function to extract text from element
    const getText = (element) => {
      if (!element) return null;
      // Try to get text, prioritizing innerText over textContent
      let text = '';
      if (element.innerText) {
        text = element.innerText;
      } else if (element.textContent) {
        text = element.textContent;
      }
      return text.trim();
    };

    // Helper function to check if text is meaningful
    const isMeaningful = (text, minLength = 20) => {
      if (!text || text.length < minLength) return false;
      // Filter out navigation, ads, and other non-content text
      const lowerText = text.toLowerCase();
      const skipPatterns = [
        'cookie', 'privacy', 'terms', 'sign in', 'menu', 'search', 'google',
        'images', 'videos', 'maps', 'news', 'shopping', 'more', 'tools',
        'settings', 'language', 'about', 'advertising', 'business'
      ];
      // Check if text is mostly skip patterns
      const skipCount = skipPatterns.filter(pattern => lowerText.includes(pattern)).length;
      if (skipCount > 2) return false;
      // Check if it's a valid answer (not just navigation)
      return text.length >= minLength && !/^(search|google|menu|settings)/i.test(text);
    };

    // Helper to clean and format text
    const cleanText = (text, maxLength = 1000) => {
      if (!text) return null;
      // Preserve line breaks for structured content
      // First, normalize whitespace but keep line breaks
      text = text.replace(/[ \t]+/g, ' '); // Replace multiple spaces/tabs with single space
      text = text.replace(/\n\s*\n\s*\n+/g, '\n\n'); // Replace multiple newlines with double newline
      text = text.trim();
      
      // If text is structured (has bullet points or multiple paragraphs), preserve structure
      if (text.includes('•') || text.includes('\n\n') || text.split('\n').length > 3) {
        // Keep structured format, just limit length
        if (text.length > maxLength) {
          // Try to cut at paragraph boundary
          const paragraphs = text.split('\n\n');
          let result = '';
          for (const para of paragraphs) {
            if (result.length + para.length + 2 > maxLength) break;
            if (result) result += '\n\n';
            result += para.trim();
          }
          return result || text.substring(0, maxLength);
        }
        return text;
      }
      
      // For plain text, take first meaningful part
      const sentences = text.split(/[.!?]\s+/);
      let result = '';
      for (const sentence of sentences) {
        if (result.length + sentence.length > maxLength) break;
        if (result) result += '. ';
        result += sentence;
      }
      return result || text.substring(0, maxLength);
    };

    // Method 1: Look for AI Overview / Gemini answer (prioritize AI-specific selectors)
    // Special selectors for google.com/ai page
    const aiSelectors = [
      // Google AI page specific (highest priority for google.com/ai)
      '[jsname="coFSxe"]',
      '[jscontroller="LqPFqc"]',
      '[data-ce-elrc]',
      'div[jsname] div[jsname]',
      // AI response containers on google.com/ai
      'section[data-ck*="aim"]',
      'div[data-gcid]',
      // AI Overview specific
      '.AIr7Nd',
      '.LGOjhe',
      '[data-ved] .AIr7Nd',
      '[data-ved] .LGOjhe',
      // AI Overview containers
      '.MjjYud .AIr7Nd',
      '.MjjYud .LGOjhe',
      '.kp-blk .AIr7Nd',
      '.kp-blk .LGOjhe',
      '.xpdopen .AIr7Nd',
      '.xpdopen .LGOjhe',
      // General AI containers
      '[data-ved] .MjjYud',
      '.kp-blk',
      '.xpdopen',
      // Featured snippets (may contain AI answers)
      '.hgKElc',
      '.IZ6rdc',
      '.s3v9rd',
      '.kno-fv',
      // Answer boxes
      '.Z0LcW',
      '.XcVN5d',
      // Combined selectors
      '.xpdopen .hgKElc',
      '.kp-blk .hgKElc',
      '[data-ved] .hgKElc',
      // Knowledge panel
      '.kp-blk .LGOjhe',
      '.xpdopen .LGOjhe',
      // New AI Overview containers
      '[data-ved*="AI"] .MjjYud',
      '[aria-label*="AI"] .MjjYud'
    ];

    for (const selector of aiSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = getText(element);
          if (text && isMeaningful(text, 30)) {
            // For google.com/ai, try to extract structured content
            // Look for bullet points or structured lists
            const listItems = element.querySelectorAll('li, [role="listitem"], ul li, ol li');
            if (listItems.length > 0) {
              // Extract structured content with bullet points
              let structuredText = '';
              for (const item of listItems) {
                const itemText = getText(item);
                if (itemText && itemText.length > 10) {
                  structuredText += '• ' + itemText + '\n';
                }
              }
              if (structuredText.length > 50) {
                // Combine with main text
                const mainText = text.split('\n')[0]; // First paragraph
                return cleanText(mainText + '\n\n' + structuredText, 1000);
              }
            }
            const cleaned = cleanText(text, 1000); // Increased length for structured answers
            if (cleaned) return cleaned;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Method 2: Look for featured snippet in various containers
    const snippetSelectors = [
      '.hgKElc',
      '.IZ6rdc',
      '.s3v9rd',
      '.kno-fv',
      '.Z0LcW',
      '.XcVN5d',
      '.LGOjhe',
      '.AIr7Nd'
    ];

    for (const selector of snippetSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = getText(element);
        if (text && isMeaningful(text, 30)) {
          return text.substring(0, 500);
        }
      }
    }

    // Method 3: Look for answer box or knowledge panel
    const answerBoxSelectors = [
      '.Z0LcW',
      '.XcVN5d',
      '.kno-fv',
      '.kp-blk',
      '.xpdopen'
    ];

    for (const selector of answerBoxSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = getText(element);
        if (text && isMeaningful(text, 20)) {
          return text.substring(0, 500);
        }
      }
    }

    // Method 4: Get first meaningful search result (fallback)
    const resultSelectors = [
      '.g .VwiC3b',
      '.g .IsZvec',
      '.g .LC20lb',
      '.g .yuRUbf .VwiC3b',
      '.tF2C9 .VwiC3b',
      '.g .s .VwiC3b',
      '.g .IsZvec .VwiC3b'
    ];

    for (const selector of resultSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = getText(element);
          if (text && isMeaningful(text, 50)) {
            // Take first meaningful paragraph
            const paragraphs = text.split('\n').filter(p => isMeaningful(p, 30));
            if (paragraphs.length > 0) {
              const cleaned = cleanText(paragraphs[0]);
              if (cleaned) return cleaned;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Method 5: Special handling for google.com/ai - look for main AI response area
    try {
      // Check if we're on google.com/ai
      const isAIPage = window.location.href.includes('google.com/ai');
      
      if (isAIPage) {
        // Look for main AI response container
        const aiContainers = [
          '[jsname="coFSxe"]',
          '[jscontroller="LqPFqc"]',
          'section[data-ck*="aim"]',
          'div[data-gcid]',
          'main',
          '[role="main"]'
        ];
        
        for (const containerSelector of aiContainers) {
          const container = document.querySelector(containerSelector);
          if (container) {
            // Extract all text from container, preserving structure
            const allText = getText(container);
            if (allText && allText.length > 100) {
              // Try to preserve structure (bullet points, paragraphs)
              const paragraphs = allText.split('\n').filter(p => p.trim().length > 20);
              if (paragraphs.length > 0) {
                // Combine paragraphs, preserving structure
                let result = '';
                for (const para of paragraphs) {
                  if (result.length + para.length > 1000) break;
                  if (result) result += '\n\n';
                  result += para.trim();
                }
                if (result.length > 50) {
                  return result;
                }
              }
            }
          }
        }
      }
      
      // Fallback: Try to find any meaningful text block in main content
      const mainContent = document.querySelector('#main, #search, #center_col, [role="main"]') || document.body;
      const allTextElements = mainContent.querySelectorAll('p, div, span, li');
      const candidates = [];
      
      for (const element of allTextElements) {
        const text = getText(element);
        if (text && isMeaningful(text, 50)) {
          // Check if it's not in navigation, footer, or ads
          const parent = element.closest('header, nav, footer, [role="navigation"], .ads, #tads, #rhs');
          if (!parent) {
            candidates.push({ text, length: text.length });
          }
        }
      }
      
      // Sort by length (longer is usually better) and take the best
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.length - a.length);
        const best = candidates[0];
        const cleaned = cleanText(best.text, 1000);
        if (cleaned) return cleaned;
      }
    } catch (e) {
      // Fall through to final fallback
    }

    // Method 6: Final fallback - get any substantial text from page
    try {
      const bodyText = getText(document.body);
      if (bodyText && bodyText.length > 100) {
        // Extract first meaningful sentence
        const sentences = bodyText.split(/[.!?]\s+/).filter(s => isMeaningful(s, 30));
        if (sentences.length > 0) {
          return cleanText(sentences[0]);
        }
      }
    } catch (e) {
      // Last resort failed
    }

    return null;
  }

  /**
   * Extract first search result as fallback
   * This function runs in the context of the Google Search page
   */
  static extractFirstResult() {
    // Helper function to extract text from element
    const getText = (element) => {
      if (!element) return null;
      const text = element.innerText || element.textContent || '';
      return text.trim();
    };

    // Try to get first search result snippet
    const resultSelectors = [
      '.g .VwiC3b',
      '.g .IsZvec',
      '.g .s .VwiC3b',
      '.g .yuRUbf + div .VwiC3b',
      '.tF2C9 .VwiC3b',
      '.g .LC20lb + div',
      '.g .s .st'
    ];

    for (const selector of resultSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = getText(element);
          if (text && text.length > 30) {
            // Clean and return first paragraph
            const firstPara = text.split('\n')[0].trim();
            if (firstPara.length > 30) {
              return firstPara.substring(0, 300);
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // Try to get any text from first result block
    try {
      const firstResult = document.querySelector('.g');
      if (firstResult) {
        const text = getText(firstResult);
        if (text && text.length > 50) {
          // Extract first meaningful sentence
          const sentences = text.split(/[.!?]\s+/).filter(s => s.length > 30);
          if (sentences.length > 0) {
            return sentences[0].substring(0, 300);
          }
        }
      }
    } catch (e) {
      // Fall through
    }

    return null;
  }
}
