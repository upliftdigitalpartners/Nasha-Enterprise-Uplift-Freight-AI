# Setup guide — Nasha Enterprise Smart Quoting Engine

This guide walks through setting up both the **web-based** and **desktop** versions of the application from the files in this repository. Follow each section in order.

---

## Prerequisites

Install these on the **development machine** before starting.

| Tool | Version | Download |
|------|---------|----------|
| .NET SDK | 8.0+ | https://dotnet.microsoft.com/download/dotnet/8.0 |
| Node.js | 20 LTS+ | https://nodejs.org |
| SQL Server | 2019+ or Express | https://www.microsoft.com/sql-server (or Docker) |
| Git | Latest | https://git-scm.com |
| Docker Desktop | Latest (optional) | https://www.docker.com/products/docker-desktop |
| Rust + Cargo | Latest (desktop only) | https://rustup.rs |

You will also need an **OpenAI API key** from https://platform.openai.com/api-keys.

---

## Part A — Server setup (in-house server)

This runs on Nasha's office server. All employee laptops connect to it over LAN.

### A1. Install SQL Server

If SQL Server is not already installed on the server:

```bash
# Option 1: Install SQL Server Express directly on Windows
# Download from: https://www.microsoft.com/sql-server/sql-server-downloads
# Choose "Express" edition (free)

# Option 2: Run via Docker (Linux or Windows with Docker)
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=NashaEnterprise@2026" \
  -p 1433:1433 --name nasha-sql --restart unless-stopped \
  -v sqldata:/var/opt/mssql \
  -d mcr.microsoft.com/mssql/server:2022-latest
```

Note your server's LAN IP address (e.g. `10.0.0.100` or `192.168.1.100`):

```bash
# Windows
ipconfig

# Linux
ip addr show
```

### A2. Clone and configure

```bash
git clone <your-repo-url> smart-quoting-engine
cd smart-quoting-engine
```

Edit `src/SmartQuoting.Api/appsettings.json`:

```json
{
  "ConnectionStrings": {
    "QuotingDb": "Server=localhost;Database=SmartQuoting;User Id=sa;Password=NashaEnterprise@2026;TrustServerCertificate=True"
  },
  "Jwt": {
    "Secret": "<PASTE A 64-CHAR RANDOM STRING>"
  },
  "OpenAi": {
    "ApiKey": "sk-your-real-openai-key"
  }
}
```

Generate a JWT secret:

```bash
# Linux/Mac
openssl rand -base64 48

# PowerShell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

### A3. Build and run the API

```bash
# Restore packages
dotnet restore SmartQuoting.sln

# Run database migrations (creates the database + seeds data)
cd src/SmartQuoting.Api
dotnet ef database update --project ../SmartQuoting.Infrastructure

# Run the API server
dotnet run --configuration Release
```

The API is now running at `http://0.0.0.0:5000`. Test it:

```bash
curl http://localhost:5000/api/health
# Should return: Healthy
```

### A4. Run the BDD tests

```bash
cd src/SmartQuoting.Tests
dotnet test
```

All 9 scenarios should pass (happy path, hallucination guard, missing rates, currency conversion, low confidence, alias resolution, VIP markup).

### A5. Verify the default users

The startup code seeds two users automatically:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `jakir.rana` | `nasha2026` | Manager |

**Change these passwords immediately after first login.**

---

## Part B — Web-based version

This serves the React frontend directly from the .NET API, so employees can access it from any browser on the LAN at `http://<SERVER_IP>:5000`.

### B1. Build the React frontend

```bash
cd frontend
npm install
npm run build
```

This creates a `frontend/dist/` folder with the compiled SPA.

### B2. Copy the build into the API's static files

```bash
# From the project root
cp -r frontend/dist/* src/SmartQuoting.Api/wwwroot/

# Windows (PowerShell)
Copy-Item -Recurse frontend\dist\* src\SmartQuoting.Api\wwwroot\
```

Create the `wwwroot` folder first if it does not exist:

```bash
mkdir -p src/SmartQuoting.Api/wwwroot
```

### B3. Publish and deploy

```bash
cd src/SmartQuoting.Api
dotnet publish -c Release -o ../../publish
```

Copy the `publish/` folder to the server and run:

```bash
cd publish
dotnet SmartQuoting.Api.dll
```

**Every employee** can now open a browser and go to:

```
http://10.0.0.100:5000
```

They will see the login screen. No installation needed on their machines.

### B4. Run as a Windows Service (production)

So the API starts automatically when the server boots:

```bash
# Install as a Windows Service
sc create NashaQuoting binPath= "C:\nasha\publish\SmartQuoting.Api.exe" start= auto
sc start NashaQuoting

# Or use NSSM (Non-Sucking Service Manager) for better control
nssm install NashaQuoting "C:\nasha\publish\SmartQuoting.Api.exe"
nssm set NashaQuoting AppDirectory "C:\nasha\publish"
nssm start NashaQuoting
```

### B5. Alternative — Docker deployment

If Docker is available on the server:

```bash
# From the project root
cp .env.example .env
# Edit .env with your real passwords and API key

docker compose up -d
```

This starts both SQL Server and the API+frontend container. Access at `http://<SERVER_IP>:5000`.

---

## Part C — Desktop app (Tauri)

The desktop app is a native Windows executable that connects to the same API server. It offers offline caching, native notifications, and file export.

### C1. Install Rust

```bash
# Windows — download and run rustup-init.exe from https://rustup.rs
# Linux/Mac
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Verify:

```bash
rustc --version
cargo --version
```

### C2. Install Tauri CLI

```bash
cargo install tauri-cli
```

### C3. Configure the server IP

Edit `desktop/src-tauri/tauri.conf.json`:

Find the CSP line and replace `10.0.0.*` with your server's actual subnet if different.

Edit `frontend/vite.config.ts`:

Replace `10.0.0.100:5000` in the proxy target with your server's actual IP.

Create `frontend/.env`:

```bash
VITE_API_BASE=http://10.0.0.100:5000
```

### C4. Development mode

```bash
# Terminal 1 — start the frontend dev server
cd frontend
npm install
npm run dev

# Terminal 2 — start Tauri in dev mode
cd desktop
cargo tauri dev
```

A native window will open with the app connected to the API server.

### C5. Build the installer

```bash
cd desktop
cargo tauri build
```

This produces:

```
desktop/src-tauri/target/release/bundle/
├── msi/
│   └── Nasha Enterprise_1.0.0_x64_en-US.msi    ← Windows installer
└── nsis/
    └── Nasha Enterprise_1.0.0_x64-setup.exe     ← NSIS installer
```

### C6. Distribute to employees

Copy the `.msi` file to a shared network drive:

```
\\10.0.0.100\Software\NashaEnterprise_1.0.0.msi
```

Each employee double-clicks to install. The app:
- Connects to `http://10.0.0.100:5000` over LAN
- Shows a login screen with their personal credentials
- Caches recent data locally for offline use
- Receives real-time notifications via SignalR

---

## Part D — Creating user accounts

Only Admin users can create accounts. After logging in as `admin`:

**Via the API (Swagger):**

```bash
# Open http://10.0.0.100:5000/swagger in a browser
# POST /api/auth/login with admin credentials to get a JWT
# POST /api/users with the new user details
```

**Via the UI:**

Navigate to Users in the sidebar and click "+ Add user". Set:
- Username (e.g. `rahim.khan`)
- Full name
- Email
- Role (Agent for most employees, Manager for supervisors)
- Temporary password (employee changes on first login)

---

## Part E — Daily operations checklist

### For the server administrator

| Task | Frequency | How |
|------|-----------|-----|
| Database backup | Daily | SQL Server Agent job or `sqlcmd` script |
| Check API health | Daily | `curl http://localhost:5000/api/health` |
| Update exchange rates | Weekly | PUT `/api/rates/exchange` with latest BDT/USD |
| Review audit log | Weekly | Audit Log section in the UI |
| Update carrier rates | As received | Carrier Rates section or direct DB insert |
| Update desktop app | As released | Replace MSI on shared drive, Tauri auto-updater notifies users |

### Database backup script (Windows Task Scheduler)

```bat
@echo off
set TIMESTAMP=%date:~-4%%date:~-7,2%%date:~-10,2%
sqlcmd -S localhost -U sa -P NashaEnterprise@2026 -Q "BACKUP DATABASE SmartQuoting TO DISK='D:\Backups\SmartQuoting_%TIMESTAMP%.bak'"
```

---

## Part F — Troubleshooting

**"Server unreachable" banner in the desktop app**
The app cannot reach the API. Check: is the server running? Is the LAN cable connected? Can you ping the server IP?

**"Invalid username or password"**
Verify the username is correct (case-sensitive). After 5 failed attempts, the account locks for 15 minutes.

**"Port not recognised" when generating a quote**
The LLM extracted a port name that is not in the database. Add it to the Ports table or add an alias.

**"No active carrier rates found"**
No rate exists for that origin-destination-container combination with a valid date range. Add rates through the admin panel.

**Database migration fails**
Ensure SQL Server is running and the connection string in `appsettings.json` is correct. Test connectivity:

```bash
sqlcmd -S 10.0.0.100 -U sa -P YourPassword -Q "SELECT 1"
```

**Frontend build fails with TypeScript errors**
Ensure Node.js 20+ is installed. Run `npm install` again to restore packages.

---

## Part G — Security hardening (before go-live)

1. **Change all default passwords** — admin, jakir.rana, SQL Server SA
2. **Generate a real JWT secret** — 64+ random characters, never commit to Git
3. **Restrict SQL Server** — only allow connections from the API server IP
4. **Enable Windows Firewall** — only open port 5000 for LAN traffic
5. **Set up HTTPS** — use a self-signed cert or Let's Encrypt for the API
6. **Enable 2FA** — for Admin accounts via the Settings panel
7. **Schedule automated backups** — see Part E above
8. **Restrict OpenAI API key** — set usage limits in the OpenAI dashboard

---

## File structure reference

```
smart-quoting-engine/
├── SmartQuoting.sln              ← .NET solution file (open in Visual Studio / Rider)
├── Dockerfile                    ← Multi-stage build for web deployment
├── docker-compose.yml            ← Full stack: SQL Server + API + frontend
├── .env.example                  ← Template for Docker secrets
├── ARCHITECTURE.md               ← System design document
├── SETUP_GUIDE.md                ← This file
│
├── src/
│   ├── SmartQuoting.Domain/      ← Entities, value objects, enums (no dependencies)
│   ├── SmartQuoting.Infrastructure/  ← EF Core, OpenAI, JWT, audit, chatbot services
│   ├── SmartQuoting.Api/         ← ASP.NET 8 Web API (controllers, hubs, middleware)
│   └── SmartQuoting.Tests/       ← Reqnroll BDD tests
│
├── frontend/                     ← React + TypeScript SPA (shared by web and desktop)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx              ← Entry point
│       ├── App.tsx               ← Root component
│       ├── components/           ← UI components
│       ├── contexts/             ← AuthContext, I18nContext
│       ├── i18n/                 ← English + Bangla translations
│       ├── hooks/                ← useQuote, etc.
│       └── types/                ← TypeScript interfaces
│
└── desktop/
    └── src-tauri/                ← Tauri (Rust) desktop shell
        ├── Cargo.toml
        ├── tauri.conf.json       ← Window config, permissions, auto-updater
        └── src/main.rs           ← IPC commands: offline cache, notifications, export
```
