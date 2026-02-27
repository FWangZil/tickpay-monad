# Minimal TickPay Relayer Example

Minimal runnable relayer using:

- `@tickpay/sdk/server/sessionEngine`
- `@tickpay/sdk/server/eip7702`
- `@tickpay/sdk/server/sessionStore`

## Run

```bash
cd examples/minimal-relayer
npm install
cp .env.example .env
# edit .env values
npm run dev
```

Server starts on `http://localhost:3002` by default.

## Endpoints

- `GET /health`
- `POST /api/session/create`
- `POST /api/session/start`
- `POST /api/session/stop`
- `GET /api/session/status/:sessionId`
- `GET /api/sessions/active`

The endpoint contracts are compatible with the main relayer.
