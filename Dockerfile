# ══════════════════════════════════════════════════════════════════
#  Stage 1: Build the React frontend
# ══════════════════════════════════════════════════════════════════
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ══════════════════════════════════════════════════════════════════
#  Stage 2: Build the .NET API
# ══════════════════════════════════════════════════════════════════
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS api-build
WORKDIR /src
COPY SmartQuoting.sln ./
COPY src/SmartQuoting.Domain/SmartQuoting.Domain.csproj src/SmartQuoting.Domain/
COPY src/SmartQuoting.Infrastructure/SmartQuoting.Infrastructure.csproj src/SmartQuoting.Infrastructure/
COPY src/SmartQuoting.Api/SmartQuoting.Api.csproj src/SmartQuoting.Api/
COPY src/SmartQuoting.Tests/SmartQuoting.Tests.csproj src/SmartQuoting.Tests/
RUN dotnet restore
COPY src/ src/
RUN dotnet publish src/SmartQuoting.Api/SmartQuoting.Api.csproj -c Release -o /app/publish --no-restore

# ══════════════════════════════════════════════════════════════════
#  Stage 3: Production image
# ══════════════════════════════════════════════════════════════════
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Copy the published .NET API
COPY --from=api-build /app/publish ./

# Copy the built React SPA into wwwroot so ASP.NET serves it
COPY --from=frontend-build /app/frontend/dist ./wwwroot/

# Create directory for file storage
RUN mkdir -p /data/documents

ENV ASPNETCORE_URLS=http://+:5000
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5000

ENTRYPOINT ["dotnet", "SmartQuoting.Api.dll"]
