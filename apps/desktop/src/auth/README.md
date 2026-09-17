# Native client-session account

English | [中文](README.zh.md)

Electron Main owns LOOPBACK/PKCE authorization through `/api/auth/client/sessions` and `/api/auth/client/token`. Production defaults to `https://hub.mantur.ai`; test environments require explicit configuration. The browser returns to an ephemeral `127.0.0.1` listener at `/callback`. Main checks state and accepts one code; cancellation closes the listener. An interrupted one-use exchange requires a new login.

Main stores account tokens and a dedicated ninety-day API Key in an OS-encrypted `client-session` record for the selected origin. There is no plaintext desktop storage. Expiring tokens rotate through a shared refresh operation. The Key is created once through `/api/agent/v1/api-keys`; uncertain creation remains blocked for manual account-Key review. Broker-v2 carries only short-lived command authority to the CLI, and Main attaches the Key to OpenAPI requests.

Logout disables local access, aborts commands and waits for their cleanup before deleting local credentials. It attempts remote Key revocation and client logout; offline logout still clears local state. Shutdown waits for accepted network and encryption work. The retired device-grant database is not converted into a client session; users authorize again. See the [migration decision](../../../../.agents/notes/implemented/architecture/2026-09-17-client-session-migration.md).
