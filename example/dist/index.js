"use strict";
/**
 * @fileoverview **Program entry** for the interactive example (`npm start`).
 *
 * ## What happens
 *
 * 1. `loadConfig()` reads `.env` / environment variables (see `config.ts`).
 * 2. `ConversationApp` wraps `LLMModule` and owns the CLI menu + chat loops (`app.ts`).
 * 3. `app.run()` is async — we `await` it so errors bubble to the `try/catch` below.
 *
 * ## Commands (from `example/` directory)
 *
 * | Command | What it runs |
 * |---------|----------------|
 * | `npm run build` | Compile TypeScript → `dist/` |
 * | `npm start` | `node dist/index.js` — this file |
 * | `npm run structured-demo` | One-shot structured JSON test (`structured-paragraph-demo.ts`) |
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const app_1 = require("./app");
/**
 * Main asynchronous function to set up and run the application.
 */
async function main() {
    try {
        // Load configuration from environment variables using the config module.
        // This determines which LLM provider, model, keys, etc., to use.
        const config = (0, config_1.loadConfig)();
        // Create a new instance of the main application class, passing the loaded configuration.
        const app = new app_1.ConversationApp(config);
        // Start the application's main execution loop (handles user interaction, LLM calls).
        await app.run();
    }
    catch (error) {
        // Catch any errors that occur during initialization or setup.
        console.error('Failed to start application:', error);
        // Exit the process with an error code to indicate failure.
        process.exit(1);
    }
}
// Execute the main function to start the application.
main();
