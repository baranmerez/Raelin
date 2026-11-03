import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { isDesktop } from "../platform/storage";
import { clientLabel, createRaelinServer } from "./tools";

/**
 * MCP over the app's named pipe. Rust only relays lines and checks the bridge token;
 * each pipe connection gets its own McpServer here, next to the command layer.
 */

class PipeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly session: number) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    await invoke("mcp_send", { session: this.session, message: JSON.stringify(message) });
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  receive(text: string) {
    try {
      this.onmessage?.(JSON.parse(text) as JSONRPCMessage);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

interface McpStatus {
  clients: Record<number, string>;
}

export const useMcpStatus = create<McpStatus>()(() => ({ clients: {} }));

const sessions = new Map<number, { server: McpServer; transport: PipeTransport }>();

function open(session: number) {
  if (sessions.has(session)) return sessions.get(session);
  const server = createRaelinServer();
  const transport = new PipeTransport(session);
  void server.connect(transport);
  // Name the client in the status chip once it has introduced itself.
  server.server.oninitialized = () => {
    const name = clientLabel(server.server.getClientVersion()?.name);
    useMcpStatus.setState((s) => ({ clients: { ...s.clients, [session]: name } }));
  };
  useMcpStatus.setState((s) => ({
    clients: { ...s.clients, [session]: s.clients[session] ?? "AI" },
  }));
  const entry = { server, transport };
  sessions.set(session, entry);
  return entry;
}

function close(session: number) {
  const entry = sessions.get(session);
  sessions.delete(session);
  void entry?.server.close();
  useMcpStatus.setState((s) => {
    const clients = { ...s.clients };
    delete clients[session];
    return { clients };
  });
}

let started = false;

// Event listeners outlive hot updates, so old tool code would keep serving clients.
// In dev, any change under the MCP host reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

/** Registers the event listeners, then tells Rust it may accept bridge connections. */
export async function startMcpHost(): Promise<void> {
  if (!isDesktop || started) return;
  started = true;
  await listen<{ session: number }>("mcp:open", (e) => open(e.payload.session));
  await listen<{ session: number; message: string }>("mcp:message", (e) => {
    // A page reload loses the servers; recreate one lazily for a still-open pipe.
    open(e.payload.session)?.transport.receive(e.payload.message);
  });
  await listen<{ session: number }>("mcp:close", (e) => close(e.payload.session));
  await invoke("mcp_ready");
}
