# Developing a capability module

Modules are **separate processes** that connect to the controller at `/ws/modules` using `@echo/module-sdk`.

## Quick start

1. Copy `modules/mock` as a template (new folder under `modules/`).
2. Add the package to `pnpm-workspace.yaml` (already includes `modules/*`).
3. Declare capabilities in registration and `registerHandler(capabilityId, fn)` for each.
4. Set `ECHO_CONTROLLER_MODULE_WS` if the controller is not on `ws://127.0.0.1:8787/ws/modules`.
5. Set `ECHO_MODULE_AUTH_TOKEN` if the controller requires it.

## Contract

- Message envelopes and types: `@echo/protocol` (see [WEBSOCKET_PROTOCOL.md](protocol/WEBSOCKET_PROTOCOL.md)).
- Reconnect, heartbeats, and request handling: `@echo/module-sdk`.

## Language agnostic

Any language may implement the same JSON envelope over WebSocket. The TypeScript SDK is the reference client for Node modules.
