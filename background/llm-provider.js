// LLM Provider abstraction

export class LLMProvider {
  /**
   * Ask a question and get an answer
   * @param {string} question - The question to ask
   * @returns {Promise<string>} The answer from the LLM
   */
  async askQuestion(question) {
    throw new Error('askQuestion must be implemented by subclass');
  }
}
