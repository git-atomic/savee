# 🎯 ScrapeSavee - Production Content Management System

A professional-grade content scraping and management platform built with **Payload CMS v3** and **Python workers**.

## 📋 Project Structure

```
scrapesavee/
├── apps/
│   ├── cms/              # Payload CMS v3 (Next.js + Admin UI)
│   │   ├── src/
│   │   │   ├── collections/    # Database schemas (Users, Sources, Runs, Blocks)
│   │   │   ├── components/     # Custom admin components (EngineView)
│   │   │   ├── lib/           # Utilities (URL parsing, types)
│   │   │   └── migrations/     # Database migrations
│   │   └── package.json
│   │
│   └── worker/           # Python scraping worker
│       ├── app/
│       │   ├── cli.py          # Command-line interface
│       │   ├── config.py       # Environment configuration
│       │   ├── database/       # Database operations
│       │   ├── models/         # SQLAlchemy models
│       │   ├── scraper/        # Savee.it scraping logic
│       │   └── storage/        # Cloudflare R2 integration
│       └── requirements.txt
│
├── .gitignore            # Comprehensive ignore rules
└── README.md            # This file
```

## 🚀 Technology Stack

### **CMS (Admin Panel)**

- **Payload CMS v3** - Modern headless CMS
- **Next.js 15** - React framework with App Router
- **PostgreSQL** - Primary database (Neon)
- **TypeScript** - Type-safe development

### **Worker (Scraping Engine)**

- **Python 3.11+** - Async scraping operations
- **SQLAlchemy** - Database ORM with async support
- **Cloudflare R2** - Object storage for media
- **Advanced scraping** - Handles dynamic content, sessions

### **Database Schema**

- **`users`** - Admin authentication
- **`sources`** - Scraping sources (URLs, types, status)
- **`runs`** - Job execution tracking with metrics
- **`blocks`** - Scraped content with rich metadata

## 🔧 Quick Start

### **Prerequisites**

- Node.js 18+
- Python 3.11+
- PostgreSQL database
- Cloudflare R2 credentials

### **Setup CMS**

```bash
cd apps/cms
npm install
cp .env.example .env
# Configure DATABASE_URI and PAYLOAD_SECRET
npm run dev
```

### **Setup Worker**

```bash
cd apps/worker
pip install -r requirements.txt
cp .env.example .env
# Configure database and R2 credentials
python -m app.cli --help
```

## 📊 Features

### **Content Management**

- ✅ **Auto-categorization** by source type (home, pop, user profiles)
- ✅ **Rich metadata** with tags and color palettes
- ✅ **Direct R2 uploads** for immediate storage
- ✅ **Real-time job monitoring** with live counters

### **Scraping Engine**

- ✅ **Multi-source support** (savee.it feeds and user profiles)
- ✅ **Session management** with persistent cookies
- ✅ **Advanced media detection** (images, videos, GIFs)
- ✅ **Automatic user profile creation** from URLs

### **Admin Interface**

- ✅ **Integrated engine UI** within Payload admin
- ✅ **Job control** (start, pause, resume, cancel)
- ✅ **Live progress tracking** with detailed logs
- ✅ **Content preview** and management

## 🔐 Environment Variables

### **CMS (.env)**

```env
DATABASE_URI=postgresql://user:pass@host:5432/db
PAYLOAD_SECRET=your-secret-key
NODE_ENV=development
```

### **Worker (.env)**

```env
DATABASE_URL=postgresql://user:pass@host:5432/db
R2_ENDPOINT_URL=https://your-account.r2.cloudflarestorage.com
R2_BUCKET_NAME=your-bucket
R2_ACCESS_KEY_ID=your-key
R2_SECRET_ACCESS_KEY=your-secret
COOKIES_PATH=./savee_cookies.json
```

## 📝 Usage

### **Start a Scraping Job**

1. Access admin at `http://localhost:3000/admin`
2. Navigate to **Engine** tab
3. Enter savee.it URL (home, pop, or user profile)
4. Set max items and click **Start Job**
5. Monitor progress in real-time

### **Manage Content**

- View scraped blocks in **Blocks** collection
- Track job history in **Runs** collection
- Manage sources in **Sources** collection

## 🏗️ Production Deployment

- **CMS**: Deploy to Vercel/Railway with Neon PostgreSQL
- **Worker**: Run as scheduled jobs on GitHub Actions or dedicated server
- **Storage**: Cloudflare R2 for media files
- **Database**: Neon PostgreSQL with connection pooling

## 🛠️ Development

### **Database Migrations**

```bash
# CMS (Payload migrations)
cd apps/cms
npx payload migrate

# Worker (Alembic migrations)
cd apps/worker
alembic upgrade head
```

### **Code Quality**

- TypeScript strict mode enabled
- Comprehensive error handling
- Production-ready logging
- Clean, maintainable architecture

---

**Built for production use with enterprise-grade reliability and performance.**
