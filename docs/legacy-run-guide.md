## Running the app 

### Prerequisites (one time)
- Node.js **22.12+**
- Visual Studio Build Tools 2022 with **"Desktop development with C++"** (to compile better-sqlite3)
- Docker Desktop (WSL2)

### First-time setup
Start **Docker Desktop** and wait until it shows *Engine running*. Then, from the repo root:

```
cd packages\compile-service\docker
docker build -t ltx-sandbox:1 .
cd ..
npm install && npm run build
cd ..\..\server
echo DATABASE_URL="file:./dev.db"> .env
npm install
npx prisma generate
npx prisma migrate deploy
cd ..\client
npm install
```

### Run (every time)
1. Start **Docker Desktop** (Engine running).
2. Terminal 1, backend:
   ```
   cd server
   npm run dev
   ```
   Wait for `running HTTP fallback on port 3443`.
3. Terminal 2, app:
   ```
   cd client
   npm start
   ```

