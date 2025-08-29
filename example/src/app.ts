/**
 * @fileoverview Defines the main application class for the LLM Conversation Example.
 *
 * This class orchestrates the conversation flow, including:
 * - Initializing the LLMModule based on provided configuration.
 * - Setting up a conversation with an initial system message.
 * - Handling the user input loop.
 * - Sending user messages to the LLM.
 * - Streaming and displaying the LLM's response.
 * - Handling exit commands and errors.
 */

import readlineSync from 'readline-sync';
import { LLMModule, LLMConfig, LLMOptions } from 'ubc-genai-toolkit-llm';
import { ToolkitError } from 'ubc-genai-toolkit-core';

/**
 * Represents the core logic for the interactive LLM conversation application.
 */
export class ConversationApp {
	// Instance of the LLMModule to interact with the configured LLM provider.
	private llm: LLMModule;

	/**
	 * Creates an instance of ConversationApp.
	 *
	 * @param {LLMConfig} config The configuration object used to initialize the LLMModule.
	 *                            This determines the provider, model, API keys/endpoints, etc.
	 */
	constructor(config: Partial<LLMConfig>) {
		// Initialize the LLMModule with the given configuration.
		// The LLMModule acts as a facade to the underlying LLM provider (OpenAI, Ollama, etc.).
		this.llm = new LLMModule(config);
	}

	/**
	 * Runs the main interactive conversation loop.
	 *
	 * - Displays a welcome message and the configured provider.
	 * - Creates a new conversation instance via the LLMModule.
	 * - Adds an initial system prompt to guide the LLM's behavior.
	 * - Enters a loop that:
	 *   - Prompts the user for input.
	 *   - Exits if the user types 'exit' or 'quit'.
	 *   - Adds the user's message to the conversation history.
	 *   - Streams the LLM's response back to the console.
	 * - Includes error handling for ToolkitErrors and other unexpected errors.
	 */
	async run(): Promise<void> {
		console.log(`=== UBC GenAI Toolkit - LLM Conversation Example ===`);
		// Display the name of the LLM provider being used (e.g., 'openai', 'ollama').
		console.log(`Provider: ${this.llm.getProviderName()}`);

		// Obtain a new Conversation object from the LLM module.
		// This object manages the message history for a single chat session.
		const conversation = this.llm.createConversation();

		// Add an initial system message to set the context or persona for the LLM.
		// This message is part of the history sent to the LLM but not typically displayed to the user.
		conversation.addMessage(
			'system',
			'You are a helpful assistant that provides clear, concise answers.'
		);

		// --- LLMOptions Examples ---
		// The `LLMOptions` object allows you to control the behavior of the model.
		// You can uncomment one of the examples below and pass it to the `conversation.stream()`
		// method to see how it affects the response.

		// Example 1: Default creative response
		const creativeOptions: LLMOptions = {
			temperature: 0.7, // Higher temperature for more creative, less predictable responses
		};

		// Example 2: More deterministic and concise response
		const deterministicOptions: LLMOptions = {
			temperature: 0.1, // Lower temperature for more focused and predictable output
			maxTokens: 50,      // Limit the response to a maximum of 50 tokens
		};

		// Example 3: JSON response format (provider support varies)
		// Note: You might need to adjust the user prompt to specifically ask for a JSON object.
		const jsonOptions: LLMOptions = {
			responseFormat: 'json',
			systemPrompt: 'You are a helpful assistant that only responds in JSON format.',
			temperature: 0.1,
		};

		// Example 4: Using a different model (if available on your provider)
		const differentModelOptions: LLMOptions = {
			model: 'gpt-3.5-turbo', // Example for OpenAI
			// model: 'claude-3-haiku-20240307', // Example for Anthropic
			// model: 'llama3', // Example for Ollama
		};

		// Example 5: Setting provider-specific options (e.g., context window for Ollama)
		// This demonstrates passing parameters that are not part of the standard LLMOptions.
		// `num_ctx` is specific to Ollama and controls the context window size.
		const customOptions: LLMOptions = {
			num_ctx: 4096, // Set Ollama's context window to 4096 tokens
			temperature: 0.5,
		};

		// --- Active Options ---
		// To experiment, change the value of `activeOptions` to one of the examples above.
		const activeOptions = customOptions;
		console.log('Using LLM Options:', activeOptions);

		try {
			// Start the interactive loop.
			while (true) {
				// Prompt the user for input using readline-sync.
				const userInput = readlineSync.question('\nYou: ');

				// Check for exit commands.
				if (
					userInput.toLowerCase() === 'exit' ||
					userInput.toLowerCase() === 'quit'
				) {
					console.log('Goodbye!');
					break; // Exit the loop.
				}

				// Add the user's input to the conversation history.
				conversation.addMessage('user', userInput);

				// Indicate that the assistant is generating a response.
				console.log('\nAssistant: ');

				// Call the conversation's stream method to send the history and get a streamed response.
				// The callback function `(chunk) => process.stdout.write(chunk)` prints each piece
				// of the response to the console as it arrives.
				// Options like `temperature` can be passed to control the LLM's generation.
				await conversation.stream(
					(chunk) => process.stdout.write(chunk),
					activeOptions // <-- The active options are passed here
				);

				// Add a newline after the streamed response for better formatting.
				console.log('\n');
			}
		} catch (error) {
			// Handle errors gracefully.
			if (error instanceof ToolkitError) {
				// Specifically handle errors originating from the toolkit modules.
				// These errors have a code and potentially details.
				console.error(`Error: ${error.message} (Code: ${error.code})`);
				if (error.details) {
					console.error('Details:', error.details);
				}
			} else {
				// Handle any other unexpected errors.
				console.error('An unexpected error occurred:', error);
			}
		}
	}
}