import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";

import { Users } from "./collections/Users";
import { Sources } from "./collections/Sources";
import { Runs } from "./collections/Runs";
import { Blocks } from "./collections/Blocks";
import { SaveeUsers } from "./collections/SaveeUsers";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const corsOrigins = (
  process.env.CORS_ORIGINS ||
  ["https://visualcms.vercel.app", "http://localhost:3000"].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default buildConfig({
  // Admin Configuration
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: "- Savee Scraper CMS",
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      views: {
        "/engine": {
          Component: "@/components/EngineUI",
          path: "/engine",
        },
        // Sub-routes for tab-aware URLs
        "/engine/add": {
          Component: "@/components/EngineUI",
          path: "/engine/add",
        },
        "/engine/jobs": {
          Component: "@/components/EngineUI",
          path: "/engine/jobs",
        },
        "/ui": {
          Component: "@/components/EngineSandbox",
          path: "/ui",
        },
      },
    },
  },

  // Collections - Clean & Organized
  collections: [Users, Sources, Runs, Blocks, SaveeUsers],

  // No globals needed for this application
  globals: [],

  // Editor
  editor: lexicalEditor(),

  // Security
  secret: process.env.PAYLOAD_SECRET || "",

  // TypeScript
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },

  // Database - Clean Production Setup
  db: postgresAdapter({
    pool: {
      connectionString:
        process.env.DATABASE_URL || process.env.DATABASE_URI || "",
    },
    migrationDir: "./src/migrations",
    // Prevent Payload from managing external tables
    push: false,
  }),

  // Media handling
  sharp,

  // No additional plugins needed
  plugins: [],

  // CORS settings (env-driven to support multiple frontends/subdomains)
  cors: corsOrigins,

  // Disable features not needed
  localization: false,

  // File upload limits
  upload: {
    limits: {
      fileSize: 5000000, // 5MB
    },
  },
  onInit: async (payload) => {
    try {
      const db = (payload.db as any).pool;
      // Ensure new filterable columns exist on blocks
      await db.query(
        `ALTER TABLE blocks 
         ADD COLUMN IF NOT EXISTS origin_text TEXT,
         ADD COLUMN IF NOT EXISTS saved_by_usernames TEXT`
      );
      // Tombstone table to prevent re-adding deleted items
      await db.query(
        `CREATE TABLE IF NOT EXISTS deleted_blocks (
           external_id TEXT PRIMARY KEY,
           source_id INTEGER,
           deleted_at TIMESTAMPTZ DEFAULT now()
         )`
      );
      // Backfill for all blocks once
      await db.query(
        `UPDATE blocks AS b
         SET origin_text = COALESCE(
               b.origin_text,
               CASE
                 WHEN s.source_type::text = 'user' THEN s.username
                 ELSE s.source_type::text
               END
             ),
             saved_by_usernames = COALESCE(b.saved_by_usernames, sub.usernames)
         FROM sources AS s,
              (
                SELECT ub.block_id,
                       string_agg(u.username, ',') AS usernames
                FROM user_blocks AS ub
                JOIN savee_users AS u ON u.id = ub.user_id
                GROUP BY ub.block_id
              ) AS sub
         WHERE b.source_id = s.id
           AND sub.block_id = b.id`
      );
    } catch (e) {
      console.warn("[onInit] Failed to ensure blocks columns:", e);
    }
  },
});
