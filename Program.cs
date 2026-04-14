using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SmartQuoting.Api.Hubs;
using SmartQuoting.Api.Middleware;
using SmartQuoting.Infrastructure.Audit;
using SmartQuoting.Infrastructure.Auth;
using SmartQuoting.Infrastructure.Chatbot;
using SmartQuoting.Infrastructure.Configuration;
using SmartQuoting.Infrastructure.Data;
using SmartQuoting.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// ══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════════

builder.Services.Configure<OpenAiSettings>(
    builder.Configuration.GetSection(OpenAiSettings.SectionName));
builder.Services.Configure<JwtSettings>(
    builder.Configuration.GetSection(JwtSettings.SectionName));

// ══════════════════════════════════════════════════════════════════
//  DATABASE
// ══════════════════════════════════════════════════════════════════

var connectionString = builder.Configuration.GetConnectionString("QuotingDb")
    ?? throw new InvalidOperationException("ConnectionStrings:QuotingDb is not configured.");

builder.Services.AddDbContext<QuotingDbContext>(opts =>
    opts.UseSqlServer(connectionString, sql =>
    {
        sql.MigrationsAssembly("SmartQuoting.Infrastructure");
        sql.EnableRetryOnFailure(3, TimeSpan.FromSeconds(5), null);
    }));

// ══════════════════════════════════════════════════════════════════
//  AUTHENTICATION (JWT)
// ══════════════════════════════════════════════════════════════════

var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret is not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        opts.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "SmartQuoting",
            ValidAudience = builder.Configuration["Jwt:Issuer"] ?? "SmartQuoting",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        // Allow SignalR to receive the token via query string
        opts.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ══════════════════════════════════════════════════════════════════
//  HTTP CLIENTS
// ══════════════════════════════════════════════════════════════════

builder.Services.AddHttpClient<IRequestParserService, OpenAiRequestParserService>(client =>
{
    var apiKey = builder.Configuration["OpenAi:ApiKey"]
        ?? throw new InvalidOperationException("OpenAi:ApiKey is not configured.");
    client.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
    client.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddHttpClient<INlQueryService, NlQueryService>(client =>
{
    var apiKey = builder.Configuration["OpenAi:ApiKey"]
        ?? throw new InvalidOperationException("OpenAi:ApiKey is not configured.");
    client.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
    client.Timeout = TimeSpan.FromSeconds(30);
});

// ══════════════════════════════════════════════════════════════════
//  APPLICATION SERVICES
// ══════════════════════════════════════════════════════════════════

builder.Services.AddScoped<IJwtService, JwtService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<IPortResolver, PortResolver>();
builder.Services.AddScoped<ICurrencyConverter, CurrencyConverter>();
builder.Services.AddScoped<IQuoteService, QuoteService>();

// ══════════════════════════════════════════════════════════════════
//  ASP.NET CORE + SIGNALR
// ══════════════════════════════════════════════════════════════════

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Smart Quoting Engine API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Description = "JWT Authorization header. Example: 'Bearer {token}'",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// CORS — allow both the web frontend (port 5173) and desktop Tauri app
builder.Services.AddCors(opts =>
{
    opts.AddDefaultPolicy(policy =>
    {
        policy
            .WithOrigins(
                "http://localhost:5173",     // Vite dev server
                "http://localhost:1420",     // Tauri dev server
                "https://tauri.localhost",   // Tauri production
                "http://10.0.0.100:3000"    // Web production (adjust IP)
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();            // Required for SignalR
    });
});

// Health check for Tauri offline detection
builder.Services.AddHealthChecks()
    .AddDbContextCheck<QuotingDbContext>();

var app = builder.Build();

// ══════════════════════════════════════════════════════════════════
//  MIDDLEWARE PIPELINE
// ══════════════════════════════════════════════════════════════════

app.UseGlobalExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Serve the React SPA for the web-based version
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<NotificationHub>("/hubs/notifications");
app.MapHealthChecks("/api/health");

// SPA fallback — any unmatched route serves index.html (for React Router)
app.MapFallbackToFile("index.html");

// ══════════════════════════════════════════════════════════════════
//  DATABASE MIGRATION + SEED ON STARTUP
// ══════════════════════════════════════════════════════════════════

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<QuotingDbContext>();
    db.Database.Migrate();

    // Seed the default admin user if none exists
    if (!db.Set<SmartQuoting.Domain.Entities.User>().Any())
    {
        db.Set<SmartQuoting.Domain.Entities.User>().Add(new SmartQuoting.Domain.Entities.User
        {
            Id = Guid.NewGuid(),
            Username = "admin",
            FullName = "System Administrator",
            Email = "admin@nasha.bd",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("admin123"),
            Role = "Admin",
            Language = "en",
            PreferredCurrency = "BDT",
            IsActive = true
        });
        db.Set<SmartQuoting.Domain.Entities.User>().Add(new SmartQuoting.Domain.Entities.User
        {
            Id = Guid.NewGuid(),
            Username = "jakir.rana",
            FullName = "Md Jakir Hossain Rana",
            Email = "jakir.rana@nasha.bd",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("nasha2026"),
            Role = "Manager",
            Language = "bn",
            PreferredCurrency = "BDT",
            IsActive = true
        });
        db.SaveChanges();
    }
}

app.Run();

// Required for WebApplicationFactory in integration tests
public partial class Program;
