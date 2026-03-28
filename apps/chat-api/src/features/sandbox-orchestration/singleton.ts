import { InMemoryDocumentRepository } from "./document-repository";
import { SandboxManager } from "./sandbox-manager";
import { SessionStore } from "./session-store";

/**
 * Module-level singletons for sandbox orchestration.
 * Shared across the application lifetime.
 */
export const documentRepository = new InMemoryDocumentRepository();
export const sessionStore = new SessionStore();
export const sandboxManager = new SandboxManager();
